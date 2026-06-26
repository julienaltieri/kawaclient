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

/**
 * Finds unmatched Amazon refund credits in a zero-sum stream whose corresponding charge
 * was never split to include the refunded portion (the common pattern: buy → categorize →
 * return later → put refund(s) in zero-sum stream but forget to revisit the original charge).
 *
 * Supports multiple refunds for the same order: if there are N credits and exactly 1 debit,
 * the debit is split so the total refund amount moves to the zero-sum stream.
 * Ambiguous only when there are 2+ eligible charge debits for the same order.
 *
 * Returns: [{ credits: [...], debit, splitAmount }]
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
        // Find the charge debit(s) for this order that are NOT yet in the zero-sum stream
        const debitCandidates = allTransactions.filter(t =>
            !credits.includes(t) &&
            t.amazonOrderDetails?.orderNumber === orderNumber &&
            t.amount < 0 &&
            t.moneyInForStream(stream) === 0 &&
            t.streamAllocation?.length === 1  // only debits that haven't been split already
        )

        if (debitCandidates.length !== 1) return  // 0 or 2+ charge debits → ambiguous, skip

        const debit = debitCandidates[0]
        const splitAmount = credits.reduce((sum, c) => sum + Math.abs(c.amount), 0)

        if (splitAmount > Math.abs(debit.amount) + 0.001) return  // total refunds exceed charge → invalid

        candidates.push({ credits, debit, splitAmount })
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
