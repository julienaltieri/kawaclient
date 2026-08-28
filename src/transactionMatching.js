import utils from './utils'
import {timeIntervals} from './Time'

// ---------------------------------------------------------------------------
// Zero-sum stream reconciliation
// ---------------------------------------------------------------------------

/**
 * Matches debits against credits (and vice-versa) within a zero-sum stream.
 * Transactions in the stream should sum to zero when properly matched.
 *
 * Returns { matches: [{ debit: [txn,...], credit: [txn,...] }], unmatched: [txn,...] }
 */
export function reconcileZeroSumStreamTransactions(txnArr, stream) {
	let debits = [], credits = [], matches = [];

	txnArr.forEach(t => {
		const m = t.moneyInForStream(stream)
		if (m > 0) { credits.push(t) }
		else if (m < 0) { debits.push(t) }
	})
	debits  = debits.sort(utils.sorters.asc(bt => bt.date.getTime()))
	credits = credits.sort(utils.sorters.asc(bt => bt.date.getTime()))

	function computeMatches(o) {
		if (stream.isSavings || stream.isInterestIncome) { return }
		let toRemove = [], getKeyForTransaction = (t) => t.moneyInForStream(stream) > 0 ? "credit" : "debit"
		o.elements.forEach(at => {
			let pool = o.matchPool.filter(bt => o.poolDateFilter(at, bt))
			let possibleMatches = (o.oneToMany ? utils.combine(pool, 2) : pool.map(t => [t]))
				.sort(utils.sorters.asc(arr => utils.sum(arr.map(c => c.date.getTime()))))
				.filter(bt => Math.abs(utils.sum([at, ...bt], t => t.moneyInForStream(stream))) < 0.001)
			let matchedCandidate = possibleMatches[0]
			if (!matchedCandidate || matchedCandidate.length === 0) { return }
			matches.push({ [getKeyForTransaction(at)]: [at], [getKeyForTransaction(matchedCandidate[0])]: matchedCandidate })
			o.matchPool.splice(0, o.matchPool.length, ...o.matchPool.filter(bt => !matchedCandidate.includes(bt)))
			toRemove.push(at.transactionId)
		})
		o.elements.splice(0, o.elements.length, ...o.elements.filter(ct => !toRemove.includes(ct.transactionId)))
	}

	function match(weekWindows, reverseTiming) {
		weekWindows.forEach(i => {
			let filter = (ct, dt) => (reverseTiming ? (ct.date.getTime() < dt.date.getTime()) : (ct.date.getTime() >= dt.date.getTime()))
				&& (reverseTiming ? -1 : 1) * (ct.date.getTime() - dt.date.getTime()) <= (timeIntervals.oneWeek * i)
			computeMatches({ elements: credits, matchPool: debits,  oneToMany: false, poolDateFilter: (a, b) => filter(a, b) })
			computeMatches({ elements: credits, matchPool: debits,  oneToMany: true,  poolDateFilter: (a, b) => filter(a, b) })
			computeMatches({ elements: debits,  matchPool: credits, oneToMany: true,  poolDateFilter: (a, b) => filter(b, a) })
		})
	}

	match([1, 5, 8, 16], false)
	match([1, 5, 8, 16], true)

	// Amazon-aware pass: when an Amazon order has multiple payment transactions
	// (e.g. card + gift card), a partial refund credit and its charge debit share the
	// same orderNumber but their moneyInForStream amounts don't cancel — so the
	// sum-to-zero check above never fires. Use the order linkage as the match signal.
	;(function amazonAwareMatch() {
		[...credits].forEach(credit => {
			if (!credit.amazonOrderDetails) return
			const orderNumber = credit.amazonOrderDetails.orderNumber
			const debit = debits.find(d => d.amazonOrderDetails?.orderNumber === orderNumber)
			if (!debit) return
			matches.push({ credit: [credit], debit: [debit] })
			credits.splice(credits.indexOf(credit), 1)
			debits.splice(debits.indexOf(debit), 1)
		})
	})()

	return { matches, unmatched: [...credits, ...debits] }
}

// ---------------------------------------------------------------------------
// Refund matching - deciding which charge a stranded refund credit belongs to
//
// Two rails, in descending order of confidence:
//   Amazon  - credit and charge carry the same order number. Unambiguous.
//   Generic - merchant name, amount and proximity. Heuristic, and deliberately narrower.
//
// Both emit the same candidate shape so that one writer can apply either:
//   { credits: [txn,...], debit: txn, amount: number, mode: "move" | "split" }
// "move" means the refund covers the whole charge, so the charge belongs in the zero-sum stream
// outright; "split" means only part of it does.
// ---------------------------------------------------------------------------

/* Tunables for the generic rail. Amazon never comes through it: an order number is far stronger
   evidence than anything below, and "Amazon" as a description is too generic to match on. */
export const refundMatchingConfig = {
	maxDaysBetweenChargeAndRefund: 90,	//longest gap seen in real data is 37 days, so this is generous
	refundDescriptionPatterns: [/^\s*refunds?\s*[:\-]\s*/i],	//stripped before comparing; never required
	minMerchantKeyLength: 3,			//"CVS" is a real merchant, so this cannot go higher
	amountTolerance: 0.005
}

/**
 * "Refund: Carter's #123" -> "carters123". Lowercased alphanumerics with every separator removed,
 * so that punctuation ("Carter's" vs "Carters") and bank truncation don't defeat the comparison.
 * Tokens mixing letters and digits are dropped: those are reference codes, not merchant names.
 */
export function getMerchantKey(description) {
	let s = description || ''
	refundMatchingConfig.refundDescriptionPatterns.forEach(p => { s = s.replace(p, '') })
	return s.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(w => !!w)
		.filter(w => !(/[a-z]/.test(w) && /[0-9]/.test(w)))
		.join('')
}

/**
 * Two descriptions name the same merchant when one key is a prefix of the other. Prefix rather than
 * equality because banks truncate ("Amazon Reta*" for "Amazon Retail") and append store numbers.
 * The minimum length stops a degenerate short key from matching everything.
 */
export function merchantKeysMatch(a, b) {
	if (!a || !b) return false
	if (a.length < refundMatchingConfig.minMerchantKeyLength) return false
	if (b.length < refundMatchingConfig.minMerchantKeyLength) return false
	return a.startsWith(b) || b.startsWith(a)
}

/**
 * Where a refund's money comes from inside a charge. Two shapes:
 *
 *   {wholeTransaction:true} - the refund covers the entire charge, so every share of it moves to
 *      the refund stream however many streams it was split across. A $12.06 charge booked as $8.00
 *      of Repair and $4.06 of Medical, refunded in full, comes back in full.
 *   {allocation}            - the refund covers part of the charge, and came out of one share of
 *      it: the **smallest share still large enough to contain it**. A $122.03 Columbia charge
 *      booked as $87.03 of Repair and $35.00 of Emile, refunded $54.95, comes out of the $87.03 -
 *      the $35.00 share could not have produced it. Smallest-that-fits leaves the larger shares
 *      alone and is usually the only share that fits at all.
 *
 * Returns undefined when neither applies, which disqualifies the charge: the refund came from one
 * part of the purchase, and spreading it across several shares is a guess with nothing behind it.
 */
export function getRefundFunding(debit, amount) {
	if (Math.abs(Math.abs(debit.amount) - amount) < refundMatchingConfig.amountTolerance) return { wholeTransaction: true }
	const allocation = (debit.streamAllocation || [])
		.filter(al => Math.abs(al.amount) + refundMatchingConfig.amountTolerance >= amount)
		.sort(utils.sorters.asc(al => Math.abs(al.amount)))[0]
	return allocation ? { allocation } : undefined
}

/* Whether the refund consumes what funds it entirely ("move") or only part of it ("split"). Purely
   descriptive - the writer rebuilds the allocation list either way - but a full consumption must
   not leave a zero-amount allocation behind, which is what the writer uses this to avoid. */
function getRefundMode(amount, funding) {
	if (funding.wholeTransaction) return "move"
	return Math.abs(Math.abs(funding.allocation.amount) - amount) < refundMatchingConfig.amountTolerance ? "move" : "split"
}

/**
 * Amazon rail. Finds refund credits in a zero-sum stream whose charge was never revisited (the
 * common pattern: buy -> categorize -> return later -> file the refund but forget the charge).
 *
 * Supports several refunds against one order: N credits resolve in a single write. An order billed
 * as several charges is resolved by amount - exact match first, then the only charge that can fund
 * it. Ambiguous only when two charges could equally have funded the refund.
 *
 * `allTransactions` must contain categorized transactions only - moneyInForStream throws otherwise.
 */
export function suggestAmazonReturnSplits(unmatchedCredits, allTransactions, stream) {
    const candidates = []

    // Group unmatched Amazon credits by order number
    const creditsByOrder = {}
    unmatchedCredits.forEach(credit => {
        if (!credit.amazonOrderDetails) return
        const key = credit.amazonOrderDetails.orderNumber
        if (!creditsByOrder[key]) creditsByOrder[key] = []
        creditsByOrder[key].push(credit)
    })

    Object.entries(creditsByOrder).forEach(([orderNumber, credits]) => {
        const amount = credits.reduce((sum, c) => sum + Math.abs(c.amount), 0)

        // Charge debits for this order that are not yet in the zero-sum stream and hold a share
        // large enough to have funded the refund.
        const debitCandidates = allTransactions.filter(t =>
            !credits.includes(t) &&
            t.amazonOrderDetails?.orderNumber === orderNumber &&
            t.amount < 0 &&
            t.moneyInForStream(stream) === 0 &&
            !!getRefundFunding(t, amount)
        )

        // Narrow by amount before declaring ambiguity. An order billed as several charges (card +
        // gift card, or two shipments) is the ordinary case, and having two charge debits does not
        // make it ambiguous: a refund that exactly matches one of them, or that only one of them
        // could have funded, has exactly one possible source.
        const exact = debitCandidates.filter(d => Math.abs(Math.abs(d.amount) - amount) < refundMatchingConfig.amountTolerance)
        const debit = exact.length === 1 ? exact[0] : (debitCandidates.length === 1 ? debitCandidates[0] : undefined)

        // Nothing could have funded it, or two charges equally could - refuse rather than guess
        if (!debit) return

        const funding = getRefundFunding(debit, amount)
        candidates.push({ credits, debit, amount, sourceAllocation: funding.allocation,
            fundsWholeTransaction: !!funding.wholeTransaction, mode: getRefundMode(amount, funding) })
    })

    return candidates
}

/**
 * Generic rail. Finds the charge that a non-Amazon refund credit is paying back, using merchant
 * name, amount and proximity.
 *
 * The credit must already be categorized into `refundStream`: that categorization is the user's
 * assertion that the transaction is a refund, which is why no "Refund:" marker is required - real
 * data shows the marker missing often enough that requiring it would lose a fifth of the matches.
 *
 * `allTransactions` must contain categorized transactions only.
 *
 * options.excludedMerchantKeys   - keys seen on a zero-sum stream that isn't the refund stream
 * options.isExcludedDescription  - predicate for descriptions this rail must not touch (Amazon)
 */
export function suggestRefundMatches(unmatchedCredits, allTransactions, refundStream, options = {}) {
	const { excludedMerchantKeys = [], isExcludedDescription = () => false } = options
	const candidates = [], consumedDebits = []
	const maxGap = timeIntervals.oneDay * refundMatchingConfig.maxDaysBetweenChargeAndRefund

	// Sorted most recent first: where several charges could fund a partial refund, the latest wins
	const eligibleDebits = allTransactions.filter(t =>
		t.amount < 0 &&
		t.moneyInForStream(refundStream) === 0 &&	//not already reconciled into the refund stream
		!isExcludedDescription(t.description)
	).sort(utils.sorters.desc(t => t.date.getTime()))

	unmatchedCredits
		.filter(c => c.amount > 0
			&& !c.amazonOrderDetails				//the order-number rail owns these
			&& !c.pairedTransferTransactionId		//a tagged transfer is a card payment, not a merchant refund
			&& !isExcludedDescription(c.description))
		.sort(utils.sorters.asc(c => c.date.getTime()))	//oldest refund claims its charge first
		.forEach(credit => {
			const key = getMerchantKey(credit.description)
			if (key.length < refundMatchingConfig.minMerchantKeyLength) return
			if (excludedMerchantKeys.some(k => merchantKeysMatch(key, k))) return

			const pool = eligibleDebits.filter(d =>
				consumedDebits.indexOf(d) === -1 &&
				merchantKeysMatch(key, getMerchantKey(d.description)) &&
				credit.date.getTime() >= d.date.getTime() &&	//same-day refunds are real, so this is >= not >
				credit.date.getTime() - d.date.getTime() <= maxGap &&
				!!getRefundFunding(d, credit.amount)		//the whole charge, or one share of it, can fund the refund
			)
			if (!pool.length) return

			// An exact-amount charge is much stronger evidence than a merely recent one
			const exact = pool.find(d => Math.abs(Math.abs(d.amount) - credit.amount) < refundMatchingConfig.amountTolerance)
			const debit = exact || pool[0]
			const funding = getRefundFunding(debit, credit.amount)
			consumedDebits.push(debit)
			candidates.push({ credits: [credit], debit, amount: credit.amount, sourceAllocation: funding.allocation,
				fundsWholeTransaction: !!funding.wholeTransaction, mode: getRefundMode(credit.amount, funding) })
		})

	return candidates
}


// ---------------------------------------------------------------------------
// Amazon transaction reconciliation — pure matching passes only.
// Orchestration (globalState guard, categorize side-effect) stays in Core.
// ---------------------------------------------------------------------------

/**
 * Returns all Amazon bank transactions that have not yet been matched to an order.
 * Covers both debits and credits (unified).
 */
export function getUnmatchedAmazonTransactions(transactions, isAmazonTransaction) {
	return transactions
		.filter(isAmazonTransaction)
		.filter(t => !t.amazonOrderDetails)
		.sort(utils.sorters.desc(t => t.date))
}

/**
 * Runs the four matching passes (Pass 0–3) against the provided bank transactions,
 * mutating `amazonOrderDetails` on matching transactions in place.
 *
 * @param {object[]} transactions - bank transactions to match (the full source array)
 * @param {object[]} amz          - Amazon orders (with optional .transactions[] entries)
 * @param {Function} isAmazonTransaction - predicate that returns true for Amazon bank txns
 */
export function reconcileAmazonTransactions(transactions, amz, isAmazonTransaction) {
	const getRemainingUnmatchedAmazonTxns = () => getUnmatchedAmazonTransactions(transactions, isAmazonTransaction)
	const getRemainingAmazonTransactions   = () => getRemainingUnmatchedAmazonTxns().filter(t => t.amount < 0)

	const absAmountsMatch = (a, b) => Math.abs(Math.abs(a) - Math.abs(b)) < 0.000001
	const dateMatch = (order, transaction) =>
		new Date(order.date) <= new Date(transaction.date.getTime() + timeIntervals.oneDay * 1) &&
		new Date(order.date) >= new Date(transaction.date.getTime() - timeIntervals.oneDay * 35)

	const getAttributedAmazonTransactions = () =>
		transactions.filter(isAmazonTransaction).filter(t => !!t.amazonOrderDetails).sort(utils.sorters.desc(t => t.date))
	const getUnattributedAmzItems = () => {
		const orderNumberConsumed = getAttributedAmazonTransactions().map(t => t.amazonOrderDetails.orderNumber)
		return amz.filter(am => orderNumberConsumed.indexOf(am.orderNumber) === -1 && am.orderAmount != null && am.orderAmount !== 0)
	}

	// PASS 0: Transaction-level match (highest confidence)
	// Unified match for both charges and refunds using order.transactions[] entries.
	// Sign convention:
	//   Bank debit (charge): negative amount  e.g. -$68
	//   Bank credit (refund): positive amount  e.g. +$22
	//   order.transactions[].amount: positive for charges (+$68), negative for refunds (-$22)
	// Match condition (symmetrical): bankTxn.amount + txn.amount ≈ 0
	//   Charge:  (-68) + 68  = 0  ✓
	//   Refund:  (+22) + (-22) = 0  ✓
	{
		const consumedTxnKeys = new Set()

		amz.filter(am => am.transactions && am.transactions.length > 0).forEach(order => {
			order.transactions.forEach(txn => {
				if (!txn.amount) return
				const isPending = !txn.date
				const txnDate = isPending ? null : new Date(txn.date)
				if (!isPending && isNaN(txnDate.getTime())) return

				const txnKey = `${order.orderNumber}::${txn.amount}::${txn.date}`
				if (consumedTxnKeys.has(txnKey)) return

				const amountMatches = bankTxn => Math.abs(bankTxn.amount + txn.amount) < 0.000001
				const candidates = getRemainingUnmatchedAmazonTxns().filter(amountMatches)

				const match = isPending
					? candidates[0]
					: candidates
						.sort((a, b) => Math.abs(a.date - txnDate) - Math.abs(b.date - txnDate))
						.find(bankTxn => Math.abs(bankTxn.date - txnDate) <= timeIntervals.oneDay * 2)

				if (match) {
					match.amazonOrderDetails = {
						...order,
						algo: "transactionLevelMatch",
						matchedTxnDate: txn.date,
						matchedTxnLast4: txn.last4 || ''
					}
					consumedTxnKeys.add(txnKey)
				}
			})
		})
	}

	// PASS 1: Direct match (one bank transaction == one order total)
	getRemainingAmazonTransactions().forEach(t => {
		const directItemMatch = amz.filter(am => dateMatch(am, t) && absAmountsMatch(am.orderAmount, t.amount))[0]
		if (directItemMatch) { t.amazonOrderDetails = { ...directItemMatch, algo: "directMatch" } }
	})

	// PASS 2: Same-date cluster (multiple transactions on the same date summing to one order)
	utils.flatGroupBy(getRemainingAmazonTransactions(), t => t.date).filter(a => a.length > 1).forEach(g => {
		const sum = utils.sum(g, t => t.amount)
		const clusterMatch = amz.filter(am => dateMatch(am, g[0]) && absAmountsMatch(am.orderAmount, sum))[0]
		if (clusterMatch) { g.forEach((t, i) => { t.amazonOrderDetails = { ...clusterMatch, algo: "sameDate", part: i } }) }
	})

	// PASS 3: Combo — transactions spread across nearby dates whose sum matches an order
	if (getRemainingAmazonTransactions().length < 20) {
		for (let d = 1; d < 15; d++) {
			const looseCombos = utils.combine(getRemainingAmazonTransactions(), 2)
				.filter(g => utils.max(g, t => t.date) - utils.min(g, t => t.date) <= timeIntervals.oneDay * d)
				.filter(g => getUnattributedAmzItems().filter(am =>
					dateMatch(am, { date: new Date(utils.min(g, t => t.date)) }) &&
					absAmountsMatch(am.orderAmount, utils.sum(g, t => t.amount))
				)[0])
			const touchedTransactions = [], trash = []
			looseCombos.forEach(g => {
				g.forEach(t => {
					if (touchedTransactions.indexOf(t.getTransactionHash()) === -1) { touchedTransactions.push(t.getTransactionHash()) }
					else { trash.push(t.getTransactionHash()) }
				})
			})
			looseCombos
				.filter(g => g.map(t => t.getTransactionHash()).filter(h => trash.indexOf(h) > -1).length === 0)
				.forEach(g => {
					const comboMatch = getUnattributedAmzItems().filter(am =>
						dateMatch(am, { date: new Date(utils.min(g, t => t.date)) }) &&
						absAmountsMatch(am.orderAmount, utils.sum(g, t => t.amount))
					)[0]
					if (comboMatch) { g.forEach((t, i) => { t.amazonOrderDetails = { ...comboMatch, algo: "multipleDaysAppart", part: i } }) }
				})
		}
	}
}
