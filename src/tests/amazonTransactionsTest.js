/**
 * amazonTransactionsTest.js
 *
 * Tests for Core._performAmazonReconciliation().
 *
 * Design principles:
 *  - Zero real data touched. All transactions and orders are fully mocked.
 *  - The function under test is called with its optional _testTransactions
 *    parameter so that Core.globalState is never read from or written to
 *    during a test run.
 *  - Core.categorizeTransactionsAllocationsTupples is temporarily stubbed to
 *    a no-op to prevent any API calls (it only fires for already-categorised
 *    transactions, which these tests don't exercise).
 */

import Core from '../core'

// ---------------------------------------------------------------------------
// Test runner – each test collapses to ONE console line.
// Click the ▶ arrow in DevTools to expand and see per-assertion details.
//
// Usage:
//   runTest('My test label', assert => {
//     assert(someCondition, 'description', optionalPayloadObject)
//   })
// ---------------------------------------------------------------------------
function runTest(label, fn) {
	const results = []
	const assert = (condition, detail, payload) => results.push({ ok: condition, detail, payload })

	try { fn(assert) } catch (e) { results.push({ ok: false, detail: 'Threw: ' + e.message }) }

	const allPassed = results.every(r => r.ok)
	const summary = {
		passed: results.filter(r => r.ok).length,
		failed: results.filter(r => !r.ok).length,
		assertions: results.map(r => ({
			result: r.ok ? '✅ PASS' : '❌ FAIL',
			detail: r.detail,
			...(r.payload !== undefined ? { payload: r.payload } : {})
		}))
	}
	console.groupCollapsed(`${allPassed ? '✅' : '❌'}  ${label}`)
	console.log(summary)
	console.groupEnd()
}

// ---------------------------------------------------------------------------
// Mock-transaction factory
// Produces a minimal plain object that satisfies everything
// _performAmazonReconciliation reads from a bank transaction.
// ---------------------------------------------------------------------------
function makeMockBankTransaction({ description, amount, date, id = 'mock-txn-001' }) {
	return {
		description,
		amount,                        // negative for a debit
		date: date instanceof Date ? date : new Date(date),
		id,
		userInstitutionAccountId: 'mock-account',
		categorized: false,
		amazonOrderDetails: undefined,
		// Mirrors the real GenericTransaction.getTransactionHash() signature
		getTransactionHash() {
			return (
				this.description.replace(/\s\s+/g, ' ').split(' ').slice(0, 3).join(' ') +
				'::' + this.amount +
				'::' + this.id +
				'::' + this.userInstitutionAccountId +
				'::' + this.date.toUTCString()
			)
		}
	}
}

// ---------------------------------------------------------------------------
// Stub helper – swaps a method for the duration of fn, then restores it.
// ---------------------------------------------------------------------------
function withStub(obj, methodName, stub, fn) {
	const original = obj[methodName]
	obj[methodName] = stub
	try { fn() } finally { obj[methodName] = original }
}

// Formats a Date the same way Amazon stores dates (e.g. "June 21, 2026")
function toAmazonDateString(date) {
	return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// Returns a Date offset by `n` days from today, normalised to noon
function daysAgo(n) {
	const d = new Date()
	d.setDate(d.getDate() - n)
	d.setHours(12, 0, 0, 0)
	return d
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Test 1 – Transaction-level match (Pass 0), single charge, same date
 *
 * Scenario:
 *   • Bank debit of -$29.34 posted yesterday, description "AMZN Mktp US"
 *   • Amazon order: orderAmount $29.34, one transactions[] entry for the
 *     same amount on the same date.
 *
 * Expected:
 *   • amazonOrderDetails is set on the bank transaction
 *   • orderNumber matches the mock order
 *   • algo === "transactionLevelMatch"
 */
function test1_singleCharge_sameDate() {
	runTest('Test 1 – Single charge matched, same date', assert => {
		const yesterday = daysAgo(1)
		const dateStr = toAmazonDateString(yesterday)

		const mockBankTxn = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: -29.34, date: yesterday, id: 'test1-txn'
		})

		const mockOrders = [{
			accountName: 'TestAccount',
			orderNumber: '111-0000001-0000001',
			orderAmount: 29.34,
			date: dateStr,
			items: [],
			transactions: [{ amount: 29.34, date: dateStr, description: 'AMZN Mktp US', last4: '1234' }]
		}]

		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation(mockOrders, [mockBankTxn])
		})

		assert(mockBankTxn.amazonOrderDetails !== undefined, 'amazonOrderDetails is set', mockBankTxn.amazonOrderDetails)
		assert(mockBankTxn.amazonOrderDetails?.orderNumber === '111-0000001-0000001', `orderNumber matches (got: "${mockBankTxn.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankTxn.amazonOrderDetails?.algo === 'transactionLevelMatch', `algo === "transactionLevelMatch" (got: "${mockBankTxn.amazonOrderDetails?.algo}")`)
	})
}

/**
 * Test 2 – Two charges on different dates matched to the same order
 *
 * Scenario:
 *   • Bank txn1: -$30, 3 days ago
 *   • Bank txn2: -$15, yesterday
 *   • Amazon order has both charges in transactions[]
 *
 * Expected:
 *   • Both bank transactions get amazonOrderDetails pointing to the same order
 *   • Both use algo "transactionLevelMatch"
 */
function test2_twoCharges_differentDates_sameOrder() {
	runTest('Test 2 – Two charges on different dates, same order', assert => {
		const date1 = daysAgo(3)
		const date2 = daysAgo(1)
		const dateStr1 = toAmazonDateString(date1)
		const dateStr2 = toAmazonDateString(date2)

		const mockBankTxn1 = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: -30.00, date: date1, id: 'test2-txn-1'
		})
		const mockBankTxn2 = makeMockBankTransaction({
			description: 'AMAZON MKTPLACE PMTS', amount: -15.00, date: date2, id: 'test2-txn-2'
		})

		const mockOrders = [{
			accountName: 'TestAccount',
			orderNumber: '111-0000002-0000002',
			orderAmount: 45.00,
			date: dateStr1,
			items: [],
			transactions: [
				{ amount: 30.00, date: dateStr1, description: 'AMZN Mktp US', last4: '1234' },
				{ amount: 15.00, date: dateStr2, description: 'AMAZON MKTPLACE PMTS', last4: '1234' }
			]
		}]

		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation(mockOrders, [mockBankTxn1, mockBankTxn2])
		})

		assert(mockBankTxn1.amazonOrderDetails !== undefined, 'txn1 amazonOrderDetails is set', mockBankTxn1.amazonOrderDetails)
		assert(mockBankTxn1.amazonOrderDetails?.orderNumber === '111-0000002-0000002', `txn1 orderNumber matches (got: "${mockBankTxn1.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankTxn1.amazonOrderDetails?.algo === 'transactionLevelMatch', `txn1 algo === "transactionLevelMatch" (got: "${mockBankTxn1.amazonOrderDetails?.algo}")`)
		assert(mockBankTxn2.amazonOrderDetails !== undefined, 'txn2 amazonOrderDetails is set', mockBankTxn2.amazonOrderDetails)
		assert(mockBankTxn2.amazonOrderDetails?.orderNumber === '111-0000002-0000002', `txn2 orderNumber matches (got: "${mockBankTxn2.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankTxn2.amazonOrderDetails?.algo === 'transactionLevelMatch', `txn2 algo === "transactionLevelMatch" (got: "${mockBankTxn2.amazonOrderDetails?.algo}")`)
	})
}

/**
 * Test 3 – One charge posted, one charge still pending (not yet in bank feed)
 *
 * Scenario:
 *   • Only 1 bank transaction (-$30, 3 days ago)
 *   • Amazon order reports 2 charges: $30 (3 days ago) and $15 (tomorrow — not posted yet)
 *
 * Expected:
 *   • The posted bank txn is matched
 *   • The pending charge has no bank transaction to match against — that's fine
 */
function test3_oneChargePosted_oneChargePending() {
	runTest('Test 3 – One charge posted, one charge still pending in bank feed', assert => {
		const date1 = daysAgo(3)
		const dateFuture = daysAgo(-1) // tomorrow
		const dateStr1 = toAmazonDateString(date1)
		const dateStrFuture = toAmazonDateString(dateFuture)

		const mockBankTxn = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: -30.00, date: date1, id: 'test3-txn'
		})

		const mockOrders = [{
			accountName: 'TestAccount',
			orderNumber: '111-0000003-0000003',
			orderAmount: 45.00,
			date: dateStr1,
			items: [],
			transactions: [
				{ amount: 30.00, date: dateStr1, description: 'AMZN Mktp US', last4: '1234' },
				{ amount: 15.00, date: dateStrFuture, description: 'AMZN Mktp US', last4: '1234' } // not yet posted
			]
		}]

		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation(mockOrders, [mockBankTxn])
		})

		assert(mockBankTxn.amazonOrderDetails !== undefined, 'posted bank txn is matched', mockBankTxn.amazonOrderDetails)
		assert(mockBankTxn.amazonOrderDetails?.orderNumber === '111-0000003-0000003', `orderNumber matches (got: "${mockBankTxn.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankTxn.amazonOrderDetails?.algo === 'transactionLevelMatch', `algo === "transactionLevelMatch" (got: "${mockBankTxn.amazonOrderDetails?.algo}")`)
	})
}

/**
 * Test 4 – Gift card split payment (mirrors real order 112-0846799-3109043)
 *
 * Scenario:
 *   • orderAmount = $75.55 = $55.75 (card charge) + $19.80 (Amazon gift card — never hits bank)
 *   • The gift card entry (last4: '') appears in order.transactions[] but will NEVER have a
 *     corresponding bank transaction
 *   • A third $26.23 shipment charge is future-dated (not yet posted)
 *   • Bank feed contains ONLY the $55.75 card charge
 *
 * Key gap this test guards against:
 *   • Pass 1 (directMatch) looks for a single bank txn == orderAmount ($75.55) → will NEVER find it
 *   • Pass 0 (transactionLevelMatch) must match the $55.75 entry and NOT crash or false-match
 *     on the $19.80 gift card entry that has no bank counterpart
 *
 * Expected:
 *   • $55.75 bank txn → matched to order 112-0846799-3109043 via transactionLevelMatch
 */
function test4_giftCardSplitPayment_onlyCardChargeMatchable() {
	runTest('Test 4 – Gift card split: $55.75 card charge matched; $19.80 gift-card entry has no bank counterpart', assert => {
		const orderDate  = daysAgo(5)  // order placed — gift card applied at placement
		const chargeDate = daysAgo(2)  // card charge posted at shipment
		const futureDate = daysAgo(-7) // $26.23 second shipment not yet posted

		const orderDateStr  = toAmazonDateString(orderDate)
		const chargeDateStr = toAmazonDateString(chargeDate)
		const futureDateStr = toAmazonDateString(futureDate)

		// Only the $55.75 card charge is in the bank feed
		const mockBankTxnCard = makeMockBankTransaction({
			description: 'AMZN Mktp US',
			amount: -55.75,
			date: chargeDate,
			id: 'test4-txn-card'
		})

		const mockOrders = [{
			accountName: 'Fanny',
			orderNumber: '112-0846799-3109043',
			orderAmount: 75.55,  // ← does NOT equal $55.75 — gift card covered the rest
			date: orderDateStr,
			items: [
				{ itemDescription: 'Thinkbaby SPF 50+ Baby Sunscreen, 3 Oz.', image: '' },
				{ itemDescription: 'Method Antibacterial All-Purpose Cleaner Spray', image: '' },
				{ itemDescription: 'The Snail and the Whale', image: '' },
				{ itemDescription: "Simple Joys by Carter's Girls' 3-Piece Rashguard Sets, Watermelon", image: '' },
				{ itemDescription: "Simple Joys by Carter's Girls' 3-Piece Rashguard Sets, Yellow/Green", image: '' }
			],
			transactions: [
				// Card charge — should match mockBankTxnCard
				{ amount: 55.75, date: chargeDateStr, description: 'Pending', last4: '9076' },
				// Gift card portion — applied at order placement (earlier date), will never have a bank match
				{ amount: 19.80, date: orderDateStr, description: 'Pending', last4: '' },
				// Future shipment — not yet posted
				{ amount: 26.23, date: futureDateStr, description: 'AMZN Mktp US', last4: '9076' }
			]
		}]

		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation(mockOrders, [mockBankTxnCard])
		})

		assert(mockBankTxnCard.amazonOrderDetails !== undefined, '$55.75 card charge is matched', mockBankTxnCard.amazonOrderDetails)
		assert(mockBankTxnCard.amazonOrderDetails?.orderNumber === '112-0846799-3109043', `orderNumber matches (got: "${mockBankTxnCard.amazonOrderDetails?.orderNumber}")`)
		assert(
			mockBankTxnCard.amazonOrderDetails?.algo === 'transactionLevelMatch',
			`algo === "transactionLevelMatch" — Pass 0 matched it despite orderAmount mismatch (got: "${mockBankTxnCard.amazonOrderDetails?.algo}")`
		)
	})
}

/**
 * Test 5 – First charge already matched (from a prior run), second charge matched on this run
 *
 * Scenario:
 *   • Amazon order reports 2 charges: $20 (5 days ago) and $15 (2 days ago)
 *   • Bank txn1 (-$20) already has amazonOrderDetails set (matched in a previous run)
 *   • Bank txn2 (-$15) is unmatched — this run should pick it up
 *
 * Expected:
 *   • txn1 retains its existing amazonOrderDetails (untouched by this run)
 *   • txn2 is now matched to the same order
 */
function test5_firstChargeAlreadyMatched_secondChargeMatchedNow() {
	runTest('Test 5 – First charge already matched, second charge matched on this run', assert => {
		const date1 = daysAgo(5)
		const date2 = daysAgo(2)
		const dateStr1 = toAmazonDateString(date1)
		const dateStr2 = toAmazonDateString(date2)

		const orderStub = {
			accountName: 'TestAccount',
			orderNumber: '111-0000005-0000005',
			orderAmount: 35.00,
			date: dateStr1,
			items: [],
			transactions: [
				{ amount: 20.00, date: dateStr1, description: 'AMZN Mktp US', last4: '1234' },
				{ amount: 15.00, date: dateStr2, description: 'AMZN Mktp US', last4: '1234' }
			]
		}

		// txn1: already attributed from a prior reconciliation run
		const mockBankTxn1 = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: -20.00, date: date1, id: 'test5-txn-1'
		})
		mockBankTxn1.amazonOrderDetails = {
			...orderStub,
			algo: 'transactionLevelMatch',
			matchedTxnDate: dateStr1,
			matchedTxnLast4: '1234'
		}

		// txn2: not yet matched — should be matched on this run
		const mockBankTxn2 = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: -15.00, date: date2, id: 'test5-txn-2'
		})

		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation([orderStub], [mockBankTxn1, mockBankTxn2])
		})

		// txn1 should be untouched
		assert(mockBankTxn1.amazonOrderDetails?.orderNumber === '111-0000005-0000005', `txn1 still attributed to same order (got: "${mockBankTxn1.amazonOrderDetails?.orderNumber}")`)
		// txn2 should now be matched
		assert(mockBankTxn2.amazonOrderDetails !== undefined, 'txn2 (second charge) is now matched', mockBankTxn2.amazonOrderDetails)
		assert(mockBankTxn2.amazonOrderDetails?.orderNumber === '111-0000005-0000005', `txn2 orderNumber matches (got: "${mockBankTxn2.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankTxn2.amazonOrderDetails?.algo === 'transactionLevelMatch', `txn2 algo === "transactionLevelMatch" (got: "${mockBankTxn2.amazonOrderDetails?.algo}")`)
	})
}

// ---------------------------------------------------------------------------
// Public entry point – called from clientTestRoutine.js
// ---------------------------------------------------------------------------
export function runAmazonTransactionTests() {
	console.group('Amazon Reconciliation Tests')
	test1_singleCharge_sameDate()
	test2_twoCharges_differentDates_sameOrder()
	test3_oneChargePosted_oneChargePending()
	test4_giftCardSplitPayment_onlyCardChargeMatchable()
	test5_firstChargeAlreadyMatched_secondChargeMatchedNow()
	console.groupEnd()
}
