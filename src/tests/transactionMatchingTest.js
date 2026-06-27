/**
 * transactionMatchingTest.js
 *
 * Tests for transaction-matching algorithms in transactionMatching.js.
 *
 * Covers:
 *  - reconcileAmazonTransactions (via Core._performAmazonReconciliation orchestration)
 *  - reconcileZeroSumStreamTransactions
 *
 * Design principles:
 *  - Zero real data touched. All transactions and orders are fully mocked.
 *  - Amazon tests call Core._performAmazonReconciliation with its optional
 *    _testTransactions parameter so that Core.globalState is never read from
 *    or written to during a test run.
 *  - Core.categorizeTransactionsAllocationsTupples is temporarily stubbed to
 *    a no-op to prevent any API calls.
 */

import Core from '../core'
import { reconcileZeroSumStreamTransactions, suggestAmazonReturnSplits } from '../transactionMatching'

// ---------------------------------------------------------------------------
// Test runner – each test collapses to ONE console line.
// Click the ▶ arrow in DevTools to expand and see per-assertion details.
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
// Shared helpers
// ---------------------------------------------------------------------------

// Stub helper – swaps a method for the duration of fn, then restores it.
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
// Amazon mock factories
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
// Amazon tests (Tests 1–9)
// ---------------------------------------------------------------------------

/**
 * Test 1 – Transaction-level match (Pass 0), single charge, same date
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
 */
function test3_oneChargePosted_oneChargePending() {
	runTest('Test 3 – One charge posted, one charge still pending in bank feed', assert => {
		const date1 = daysAgo(3)
		const dateFuture = daysAgo(-1)
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
				{ amount: 15.00, date: dateStrFuture, description: 'AMZN Mktp US', last4: '1234' }
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
 * Test 4 – Gift card split payment
 */
function test4_giftCardSplitPayment_onlyCardChargeMatchable() {
	runTest('Test 4 – Gift card split: $55.75 card charge matched; $19.80 gift-card entry has no bank counterpart', assert => {
		const orderDate  = daysAgo(5)
		const chargeDate = daysAgo(2)
		const futureDate = daysAgo(-7)

		const orderDateStr  = toAmazonDateString(orderDate)
		const chargeDateStr = toAmazonDateString(chargeDate)
		const futureDateStr = toAmazonDateString(futureDate)

		const mockBankTxnCard = makeMockBankTransaction({
			description: 'AMZN Mktp US',
			amount: -55.75,
			date: chargeDate,
			id: 'test4-txn-card'
		})

		const mockOrders = [{
			accountName: 'Fanny',
			orderNumber: '112-0846799-3109043',
			orderAmount: 75.55,
			date: orderDateStr,
			items: [
				{ itemDescription: 'Thinkbaby SPF 50+ Baby Sunscreen, 3 Oz.', image: '' },
				{ itemDescription: 'Method Antibacterial All-Purpose Cleaner Spray', image: '' },
				{ itemDescription: 'The Snail and the Whale', image: '' },
				{ itemDescription: "Simple Joys by Carter's Girls' 3-Piece Rashguard Sets, Watermelon", image: '' },
				{ itemDescription: "Simple Joys by Carter's Girls' 3-Piece Rashguard Sets, Yellow/Green", image: '' }
			],
			transactions: [
				{ amount: 55.75, date: chargeDateStr, description: 'Pending', last4: '9076' },
				{ amount: 19.80, date: orderDateStr, description: 'Pending', last4: '' },
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
			`algo === "transactionLevelMatch" (got: "${mockBankTxnCard.amazonOrderDetails?.algo}")`
		)
	})
}

/**
 * Test 5 – First charge already matched, second charge matched on this run
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

		const mockBankTxn1 = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: -20.00, date: date1, id: 'test5-txn-1'
		})
		mockBankTxn1.amazonOrderDetails = {
			...orderStub,
			algo: 'transactionLevelMatch',
			matchedTxnDate: dateStr1,
			matchedTxnLast4: '1234'
		}

		const mockBankTxn2 = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: -15.00, date: date2, id: 'test5-txn-2'
		})

		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation([orderStub], [mockBankTxn1, mockBankTxn2])
		})

		assert(mockBankTxn1.amazonOrderDetails?.orderNumber === '111-0000005-0000005', `txn1 still attributed to same order (got: "${mockBankTxn1.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankTxn2.amazonOrderDetails !== undefined, 'txn2 (second charge) is now matched', mockBankTxn2.amazonOrderDetails)
		assert(mockBankTxn2.amazonOrderDetails?.orderNumber === '111-0000005-0000005', `txn2 orderNumber matches (got: "${mockBankTxn2.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankTxn2.amazonOrderDetails?.algo === 'transactionLevelMatch', `txn2 algo === "transactionLevelMatch" (got: "${mockBankTxn2.amazonOrderDetails?.algo}")`)
	})
}

/**
 * Test 6 – Partial Amazon refund gets linked to the original order
 */
function test6_partialRefund_getsLinkedToOriginalOrder() {
	runTest('Test 6 – Partial refund (+$22) gets linked to original -$68 order', assert => {
		const purchaseDate    = daysAgo(20)
		const refundDate      = daysAgo(6)
		const purchaseDateStr = toAmazonDateString(purchaseDate)
		const refundDateStr   = toAmazonDateString(refundDate)

		const mockBankDebit = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: -68.00, date: purchaseDate, id: 'test6-txn-debit'
		})
		const mockBankCredit = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: 22.00, date: refundDate, id: 'test6-txn-credit'
		})

		const mockOrders = [{
			accountName: 'TestAccount',
			orderNumber: '111-0000006-0000006',
			orderAmount: 68.00,
			date: purchaseDateStr,
			items: [{ itemDescription: 'Some product', image: '' }],
			transactions: [
				{ amount: 68.00, date: purchaseDateStr, description: 'AMZN Mktp US', last4: '1234' },
				{ amount: -22.00, date: refundDateStr, description: 'AMZN Mktp US', last4: '1234' }
			]
		}]

		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation(mockOrders, [mockBankDebit, mockBankCredit])
		})

		assert(mockBankDebit.amazonOrderDetails !== undefined, 'debit amazonOrderDetails is set', mockBankDebit.amazonOrderDetails)
		assert(mockBankDebit.amazonOrderDetails?.orderNumber === '111-0000006-0000006', `debit orderNumber matches (got: "${mockBankDebit.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankDebit.amazonOrderDetails?.algo === 'transactionLevelMatch', `debit algo === "transactionLevelMatch" (got: "${mockBankDebit.amazonOrderDetails?.algo}")`)
		assert(mockBankCredit.amazonOrderDetails !== undefined, 'credit (refund) amazonOrderDetails is set', mockBankCredit.amazonOrderDetails)
		assert(mockBankCredit.amazonOrderDetails?.orderNumber === '111-0000006-0000006', `credit orderNumber matches (got: "${mockBankCredit.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankCredit.amazonOrderDetails?.algo === 'transactionLevelMatch', `credit algo === "transactionLevelMatch" (got: "${mockBankCredit.amazonOrderDetails?.algo}")`)
	})
}

/**
 * Test 7 – Refund posts after the original debit is already categorized & mapped to an order
 */
function test7_refundPostsAfterDebitAlreadyCategorizedAndMapped() {
	runTest('Test 7 – Refund posts after debit is already categorized & mapped to order', assert => {
		const purchaseDate    = daysAgo(30)
		const refundDate      = daysAgo(5)
		const purchaseDateStr = toAmazonDateString(purchaseDate)
		const refundDateStr   = toAmazonDateString(refundDate)

		const orderStub = {
			accountName: 'TestAccount',
			orderNumber: '111-0000007-0000007',
			orderAmount: 68.00,
			date: purchaseDateStr,
			items: [{ itemDescription: 'Some product', image: '' }],
			transactions: [
				{ amount: 68.00, date: purchaseDateStr, description: 'AMZN Mktp US', last4: '1234' },
				{ amount: -22.00, date: refundDateStr, description: 'AMZN Mktp US', last4: '1234' }
			]
		}

		const mockBankDebit = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: -68.00, date: purchaseDate, id: 'test7-txn-debit'
		})
		mockBankDebit.categorized = true
		mockBankDebit.transactionId = 'test7-txn-debit-cat'
		mockBankDebit.streamAllocation = [{ streamId: 'some-stream-id', amount: -68.00, type: 'value' }]
		mockBankDebit.amazonOrderDetails = {
			...orderStub,
			algo: 'transactionLevelMatch',
			matchedTxnDate: purchaseDateStr,
			matchedTxnLast4: '1234'
		}

		const mockBankCredit = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: 22.00, date: refundDate, id: 'test7-txn-credit'
		})

		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation([orderStub], [mockBankDebit, mockBankCredit])
		})

		assert(mockBankDebit.amazonOrderDetails?.orderNumber === '111-0000007-0000007', `debit still attributed to same order (got: "${mockBankDebit.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankDebit.amazonOrderDetails?.algo === 'transactionLevelMatch', `debit algo unchanged (got: "${mockBankDebit.amazonOrderDetails?.algo}")`)
		assert(mockBankCredit.amazonOrderDetails !== undefined, 'credit (refund) amazonOrderDetails is set', mockBankCredit.amazonOrderDetails)
		assert(mockBankCredit.amazonOrderDetails?.orderNumber === '111-0000007-0000007', `credit orderNumber matches (got: "${mockBankCredit.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankCredit.amazonOrderDetails?.algo === 'transactionLevelMatch', `credit algo === "transactionLevelMatch" (got: "${mockBankCredit.amazonOrderDetails?.algo}")`)
	})
}

/**
 * Test 8 – Amazon credit with NO negative entries in order.transactions[] → stays unmatched
 */
function test8_creditWithNoRefundEntryInOrder_staysUnmatched() {
	runTest('Test 8 – Amazon credit stays unmatched when order has no negative transactions[] entries', assert => {
		const purchaseDate    = daysAgo(20)
		const refundDate      = daysAgo(5)
		const purchaseDateStr = toAmazonDateString(purchaseDate)

		const mockBankDebit = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: -68.00, date: purchaseDate, id: 'test8-txn-debit'
		})
		const mockBankCredit = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: 22.00, date: refundDate, id: 'test8-txn-credit'
		})

		const mockOrders = [{
			accountName: 'TestAccount',
			orderNumber: '111-0000008-0000008',
			orderAmount: 68.00,
			date: purchaseDateStr,
			items: [{ itemDescription: 'Some product', image: '' }],
			transactions: [
				{ amount: 68.00, date: purchaseDateStr, description: 'AMZN Mktp US', last4: '1234' }
			]
		}]

		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation(mockOrders, [mockBankDebit, mockBankCredit])
		})

		assert(mockBankDebit.amazonOrderDetails !== undefined, 'debit is matched', mockBankDebit.amazonOrderDetails)
		assert(mockBankDebit.amazonOrderDetails?.orderNumber === '111-0000008-0000008', `debit orderNumber matches (got: "${mockBankDebit.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankCredit.amazonOrderDetails === undefined, 'credit stays unmatched (no refund entry in order data)', mockBankCredit.amazonOrderDetails)
	})
}

/**
 * Test 9 – Multiple orders, none with refund entries → credit stays unmatched
 */
function test9_multipleOrders_noRefundEntries_creditStaysUnmatched() {
	runTest('Test 9 – Multiple orders with no refund entries → credit stays unmatched (no false positive)', assert => {
		const date1      = daysAgo(30)
		const date2      = daysAgo(15)
		const refundDate = daysAgo(3)
		const dateStr1   = toAmazonDateString(date1)
		const dateStr2   = toAmazonDateString(date2)

		const orderA = {
			accountName: 'TestAccount', orderNumber: '111-0000009-A', orderAmount: 37.09,
			date: dateStr1, items: [],
			transactions: [{ amount: 37.09, date: dateStr1, description: 'AMZN Mktp US', last4: '1234' }]
		}
		const orderB = {
			accountName: 'TestAccount', orderNumber: '111-0000009-B', orderAmount: 55.00,
			date: dateStr2, items: [],
			transactions: [{ amount: 55.00, date: dateStr2, description: 'AMZN Mktp US', last4: '5678' }]
		}

		const mockDebitA = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: -37.09, date: date1, id: 'test9-txn-A'
		})
		const mockDebitB = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: -55.00, date: date2, id: 'test9-txn-B'
		})
		const mockBankCredit = makeMockBankTransaction({
			description: 'AMZN Mktp US', amount: 22.00, date: refundDate, id: 'test9-txn-credit'
		})

		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation([orderA, orderB], [mockDebitA, mockDebitB, mockBankCredit])
		})

		assert(mockDebitA.amazonOrderDetails?.orderNumber === '111-0000009-A', `debitA matched to order A (got: "${mockDebitA.amazonOrderDetails?.orderNumber}")`)
		assert(mockDebitB.amazonOrderDetails?.orderNumber === '111-0000009-B', `debitB matched to order B (got: "${mockDebitB.amazonOrderDetails?.orderNumber}")`)
		assert(mockBankCredit.amazonOrderDetails === undefined, 'credit stays unmatched — no refund entry in any order', mockBankCredit.amazonOrderDetails)
	})
}

// ---------------------------------------------------------------------------
// Zero-sum stream mock factories
// ---------------------------------------------------------------------------

// streamAmount: optional override for moneyInForStream — use when the transaction is
// split-allocated and only a portion belongs to the zero-sum stream (e.g. -$64 total,
// $25 to the reimbursement stream → streamAmount: -25). Defaults to amount.
function makeMockZeroSumTransaction({ amount, date, transactionId, streamAmount }) {
	return {
		amount,
		date: date instanceof Date ? date : new Date(date),
		transactionId,
		moneyInForStream(_stream) { return streamAmount !== undefined ? streamAmount : this.amount }
	}
}

// Hybrid factory for tests that need both Amazon reconciliation (requires getTransactionHash,
// description, id) AND zero-sum matching (requires moneyInForStream).
function makeMockHybridTransaction({ description, amount, date, id, streamAmount }) {
	return {
		description,
		amount,
		date: date instanceof Date ? date : new Date(date),
		id,
		transactionId: id,
		userInstitutionAccountId: 'mock-account',
		categorized: false,
		amazonOrderDetails: undefined,
		getTransactionHash() {
			return (
				this.description.replace(/\s\s+/g, ' ').split(' ').slice(0, 3).join(' ') +
				'::' + this.amount +
				'::' + this.id +
				'::' + this.userInstitutionAccountId +
				'::' + this.date.toUTCString()
			)
		},
		moneyInForStream(_stream) { return streamAmount !== undefined ? streamAmount : this.amount }
	}
}

function makeMockZeroSumStream() {
	return { id: 'test-reimb', isZeroSumStream: true, isSavings: false, isInterestIncome: false }
}

// ---------------------------------------------------------------------------
// Zero-sum stream tests
// ---------------------------------------------------------------------------

/**
 * Test ZS-1 – 1:1 match: one debit matched by one credit
 *
 * Scenario:
 *   • Debit of -$100 posted 10 days ago (e.g. an expense paid on behalf of someone)
 *   • Credit of +$100 posted 5 days ago (the reimbursement arrives within the same week)
 *
 * Expected:
 *   • Exactly one match entry: { debit: [debit], credit: [credit] }
 *   • No leftover unmatched transactions
 */
function testZS1_oneToOneMatch() {
	runTest('Test ZS-1 – 1:1 match: debit is matched by its credit', assert => {
		const stream = makeMockZeroSumStream()
		const debit  = makeMockZeroSumTransaction({ amount: -100, date: daysAgo(10), transactionId: 'debit-1' })
		const credit = makeMockZeroSumTransaction({ amount:  100, date: daysAgo(5),  transactionId: 'credit-1' })

		const result = reconcileZeroSumStreamTransactions([debit, credit], stream)

		assert(result.matches.length === 1, `1 match expected (got: ${result.matches.length})`, result.matches)
		assert(result.unmatched.length === 0, `0 unmatched expected (got: ${result.unmatched.length})`, result.unmatched)
		const match = result.matches[0]
		assert(
			match.debit?.map(t => t.transactionId).includes('debit-1'),
			'debit-1 is in match.debit',
			match.debit
		)
		assert(
			match.credit?.map(t => t.transactionId).includes('credit-1'),
			'credit-1 is in match.credit',
			match.credit
		)
	})
}

/**
 * Test ZS-2 – 1:1 match where both sides are already linked to the same Amazon order
 *
 * Scenario:
 *   • Amazon reconciliation has already run: both the -$50 debit and the +$50 credit
 *     carry amazonOrderDetails pointing to the same order.
 *   • The zero-sum reconciliation now runs and should pair them.
 *
 * Expected:
 *   • One match entry — debit and credit are paired
 *   • BOTH sides of the match carry amazonOrderDetails for the same orderNumber
 *     (the zero-sum matcher must not strip existing metadata)
 */
function testZS2_oneToOneMatch_linkedToSameAmazonOrder() {
	runTest('Test ZS-2 – 1:1 match: both debit and credit carry the same amazonOrderDetails', assert => {
		const stream = makeMockZeroSumStream()
		const orderStub = {
			orderNumber: 'order-zs2',
			orderAmount: 50.00,
			date: toAmazonDateString(daysAgo(12)),
			accountName: 'TestAccount',
			items: [],
			algo: 'transactionLevelMatch'
		}

		const debit  = makeMockZeroSumTransaction({ amount: -50, date: daysAgo(10), transactionId: 'debit-zs2' })
		const credit = makeMockZeroSumTransaction({ amount:  50, date: daysAgo(5),  transactionId: 'credit-zs2' })

		// Pre-attach Amazon order details (as if _performAmazonReconciliation already ran)
		debit.amazonOrderDetails  = { ...orderStub }
		credit.amazonOrderDetails = { ...orderStub }

		const result = reconcileZeroSumStreamTransactions([debit, credit], stream)

		assert(result.matches.length === 1, `1 match expected (got: ${result.matches.length})`, result.matches)
		assert(result.unmatched.length === 0, `0 unmatched expected (got: ${result.unmatched.length})`, result.unmatched)
		const match = result.matches[0]
		assert(match.debit?.[0]?.transactionId === 'debit-zs2', 'debit-zs2 is in match.debit', match.debit)
		assert(match.credit?.[0]?.transactionId === 'credit-zs2', 'credit-zs2 is in match.credit', match.credit)
		assert(
			match.debit?.[0]?.amazonOrderDetails?.orderNumber === 'order-zs2',
			'matched debit carries amazonOrderDetails for order-zs2',
			match.debit?.[0]?.amazonOrderDetails
		)
		assert(
			match.credit?.[0]?.amazonOrderDetails?.orderNumber === 'order-zs2',
			'matched credit (refund) carries amazonOrderDetails for the same order',
			match.credit?.[0]?.amazonOrderDetails
		)
	})
}

/**
 * Test ZS-3 – Amazon refund stranded in zero-sum stream (charge in different stream): correctly unmatched, split candidate identified
 *
 * Scenario (mirrors production order #112-0846799-3109043):
 *   • An Amazon order is paid with a card ($55.75) and a gift card ($19.80).
 *   • The -$55.75 bank debit is categorized to stream A (a different stream).
 *   • The +$26.23 refund credit is categorized to stream B (the zero-sum stream).
 *   • The user forgot to split the original charge when they made the return.
 *
 * Expected behavior:
 *   • Amazon reconciliation links both transactions to the order (Pass 0).
 *   • Zero-sum reconciliation correctly finds 0 matches — the credit IS stranded (this is right).
 *   • suggestAmazonReturnSplits identifies the debit as the unambiguous split target.
 *   • Ambiguity guard: two credits for the same order → 0 candidates.
 */
function testZS3_amazonRefundStranded_correctlyUnmatched_splitCandidateIdentified() {
	runTest('Test ZS-3 – Amazon refund stranded in zero-sum stream: 0 matches (correct), split candidate identified', assert => {
		const stream = makeMockZeroSumStream()

		// Real production order #112-0846799-3109043
		const mockOrders = [{
			accountName: 'Fanny',
			orderNumber: '112-0846799-3109043',
			orderAmount: 75.55,
			date: 'June 4, 2026',
			items: [
				{ itemDescription: 'Thinkbaby SPF 50+ Baby Sunscreen, 3 Oz.', image: '' },
				{ itemDescription: 'Method Antibacterial All-Purpose Cleaner Spray, Citron, 28 Fl Oz', image: '' },
				{ itemDescription: 'The Snail and the Whale', image: '' },
				{ itemDescription: "Simple Joys by Carter's Girls' 3-Piece Rashguard Sets, Watermelon, 6-9 Months", image: '' },
				{ itemDescription: "Simple Joys by Carter's Girls' 3-Piece Rashguard Sets, Yellow/Green, 6-9M", image: '' }
			],
			transactions: [
				{ amount: 55.75,  date: 'June 6, 2026',  description: 'Pending',      last4: '9076' },
				{ amount: 19.80,  date: 'June 6, 2026',  description: 'Pending',      last4: ''     },
				{ amount: -26.23, date: 'June 19, 2026', description: 'AMZN Mktp US', last4: '9076' }
			]
		}]

		// -$55.75 debit: in stream A, NOT in the zero-sum stream (streamAmount: 0)
		const debit = makeMockHybridTransaction({
			description: 'Amazon', amount: -55.75, date: new Date('2026-06-07T00:00:00.000Z'), id: 'zs3-debit', streamAmount: 0
		})
		debit.streamAllocation = [{ streamId: 'stream-A-id', amount: -55.75, type: 'value' }]

		// +$26.23 credit: in the zero-sum stream
		const credit = makeMockHybridTransaction({
			description: 'Refund: Amazon', amount: 26.23, date: new Date('2026-06-19T00:00:00.000Z'), id: 'zs3-credit'
		})

		// Step 1: Amazon reconciliation links both to the order
		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation(mockOrders, [debit, credit])
		})

		assert(
			debit.amazonOrderDetails?.orderNumber === '112-0846799-3109043',
			`debit linked to Amazon order (got: "${debit.amazonOrderDetails?.orderNumber}")`,
			debit.amazonOrderDetails
		)
		assert(
			credit.amazonOrderDetails?.orderNumber === '112-0846799-3109043',
			`credit linked to same Amazon order (got: "${credit.amazonOrderDetails?.orderNumber}")`,
			credit.amazonOrderDetails
		)

		// Step 2: zero-sum reconciliation sees only the credit — 0 matches is correct
		const { matches, unmatched } = reconcileZeroSumStreamTransactions([credit], stream)

		assert(matches.length === 0, `0 zero-sum matches expected — credit is correctly stranded (got: ${matches.length})`, matches)
		assert(unmatched.length === 1, `1 unmatched expected (got: ${unmatched.length})`, unmatched)
		assert(unmatched[0]?.id === 'zs3-credit', 'stranded transaction is zs3-credit', unmatched[0])

		// Step 3: suggestAmazonReturnSplits identifies the debit as the correct split target
		const unmatchedAmazonCredits = unmatched.filter(t => t.amount > 0 && t.amazonOrderDetails)
		const candidates = suggestAmazonReturnSplits(unmatchedAmazonCredits, [debit, credit], stream)

		assert(candidates.length === 1, `1 split candidate expected (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.credits?.[0]?.id === 'zs3-credit', 'candidate credits[0] is zs3-credit', candidates[0])
		assert(candidates[0]?.debit?.id === 'zs3-debit', 'candidate debit is zs3-debit', candidates[0])
		assert(
			Math.abs((candidates[0]?.splitAmount ?? NaN) - 26.23) < 0.001,
			`splitAmount is 26.23 (got: ${candidates[0]?.splitAmount})`,
			candidates[0]
		)

		// Multi-refund: two credits for same order + one debit → still 1 candidate (total split = sum of both)
		const credit2 = makeMockHybridTransaction({
			description: 'Refund: Amazon', amount: 10.00, date: new Date('2026-06-20T00:00:00.000Z'), id: 'zs3-credit2'
		})
		credit2.amazonOrderDetails = { ...credit.amazonOrderDetails }
		const multiCandidates = suggestAmazonReturnSplits([credit, credit2], [debit, credit, credit2], stream)
		assert(multiCandidates.length === 1, `1 candidate for 2 credits + 1 debit (got: ${multiCandidates.length})`, multiCandidates)
		assert(multiCandidates[0]?.credits?.length === 2, `candidate covers 2 credits (got: ${multiCandidates[0]?.credits?.length})`, multiCandidates[0])
		assert(
			Math.abs((multiCandidates[0]?.splitAmount ?? NaN) - 36.23) < 0.001,
			`splitAmount is 36.23 ($26.23 + $10.00) (got: ${multiCandidates[0]?.splitAmount})`,
			multiCandidates[0]
		)
	})
}

/**
 * Test ZS-4 – Multiple refunds for one Amazon order: split debit covers all refunds in one pass
 *
 * Scenario: -$45 original charge, +$5 and +$9 as two separate refunds, all on the same order.
 * The charge is in stream A (not split). Both refunds land in the zero-sum stream.
 *
 *   -1- Amazon reconciliation links all three bank transactions to the same order.
 *   -2- Zero-sum reconciliation finds 0 matches — both refunds are stranded (correct).
 *   -3- suggestAmazonReturnSplits returns 1 candidate: split the debit so $14 ($5+$9)
 *       moves to the zero-sum stream and $31 remains in stream A.
 */
function testZS4_multipleRefundsForSameOrder_splitNeeded_currentlyFailing() {
	runTest('Test ZS-4 – Multiple refunds for same order: debit split covers all refunds in one pass', assert => {
		const stream = makeMockZeroSumStream()

		const mockOrders = [{
			accountName: 'TestAccount',
			orderNumber: 'order-zs4-multi',
			orderAmount: 45.00,
			date: 'June 1, 2026',
			items: [{ itemDescription: 'Some product', image: '' }],
			transactions: [
				{ amount:  45.00, date: 'June 3, 2026',  description: 'Pending',      last4: '9076' },
				{ amount:  -5.00, date: 'June 12, 2026', description: 'AMZN Mktp US', last4: '9076' },
				{ amount:  -9.00, date: 'June 15, 2026', description: 'AMZN Mktp US', last4: '9076' }
			]
		}]

		// -$45 debit: in stream A, NOT in the zero-sum stream
		const debit = makeMockHybridTransaction({
			description: 'Amazon', amount: -45.00, date: new Date('2026-06-03T00:00:00.000Z'), id: 'zs4-debit', streamAmount: 0
		})
		debit.streamAllocation = [{ streamId: 'stream-A-id', amount: -45.00, type: 'value' }]

		// +$5 refund credit: in the zero-sum stream
		const credit1 = makeMockHybridTransaction({
			description: 'Refund: Amazon', amount: 5.00, date: new Date('2026-06-12T00:00:00.000Z'), id: 'zs4-credit1'
		})
		// +$9 refund credit: in the zero-sum stream
		const credit2 = makeMockHybridTransaction({
			description: 'Refund: Amazon', amount: 9.00, date: new Date('2026-06-15T00:00:00.000Z'), id: 'zs4-credit2'
		})

		// Step 1: Amazon reconciliation links all three to the order
		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation(mockOrders, [debit, credit1, credit2])
		})

		assert(
			debit.amazonOrderDetails?.orderNumber === 'order-zs4-multi',
			`debit linked to order (got: "${debit.amazonOrderDetails?.orderNumber}")`,
			debit.amazonOrderDetails
		)
		assert(
			credit1.amazonOrderDetails?.orderNumber === 'order-zs4-multi',
			`credit1 (+$5) linked to order (got: "${credit1.amazonOrderDetails?.orderNumber}")`,
			credit1.amazonOrderDetails
		)
		assert(
			credit2.amazonOrderDetails?.orderNumber === 'order-zs4-multi',
			`credit2 (+$9) linked to order (got: "${credit2.amazonOrderDetails?.orderNumber}")`,
			credit2.amazonOrderDetails
		)

		// Step 2: zero-sum reconciliation — both refunds are stranded (0 matches is correct)
		const { matches, unmatched } = reconcileZeroSumStreamTransactions([credit1, credit2], stream)

		assert(matches.length === 0, `0 zero-sum matches (both refunds are stranded) (got: ${matches.length})`, matches)
		assert(unmatched.length === 2, `2 unmatched (both refunds stranded) (got: ${unmatched.length})`, unmatched)

		// Step 3: suggestAmazonReturnSplits returns 1 candidate — debit split covers both refunds
		const unmatchedAmazonCredits = unmatched.filter(t => t.amount > 0 && t.amazonOrderDetails)
		const candidates = suggestAmazonReturnSplits(unmatchedAmazonCredits, [debit, credit1, credit2], stream)

		assert(candidates.length === 1, `1 split candidate expected (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.debit?.id === 'zs4-debit', 'candidate debit is zs4-debit', candidates[0])
		assert(candidates[0]?.credits?.length === 2, `candidate covers 2 credits (got: ${candidates[0]?.credits?.length})`, candidates[0])
		assert(
			Math.abs((candidates[0]?.splitAmount ?? NaN) - 14.00) < 0.001,
			`splitAmount is $14 ($5 + $9) (got: ${candidates[0]?.splitAmount})`,
			candidates[0]
		)
	})
}

/**
 * Test ZS-5 – Refund in zero-sum stream whose original charge is from a prior year (not present)
 *
 * Scenario: an item was bought in December 2025 (prior year) and returned in June 2026.
 * The original -$55.75 charge debit is NOT in the current transaction set (it's from the
 * prior reporting year). Only the +$26.23 refund credit is present, sitting in the zero-sum stream.
 *
 * Expected behavior:
 *   -1- Amazon reconciliation STILL attaches amazonOrderDetails to the refund credit, using the
 *       order's negative refund entry (Pass 0 transaction-level match) — no debit required.
 *   -2- Zero-sum reconciliation finds 0 matches (the credit is correctly stranded).
 *   -3- suggestAmazonReturnSplits returns 0 candidates — there is no debit to split.
 */
function testZS5_refundWithoutOriginalDebit_orderStillAttachedToRefund() {
	runTest('Test ZS-5 – Refund without original debit (prior-year charge): order still attached to refund', assert => {
		const stream = makeMockZeroSumStream()

		// Order spans the year boundary: charge in Dec 2025, refund in June 2026
		const mockOrders = [{
			accountName: 'Fanny',
			orderNumber: '112-9999999-0000005',
			orderAmount: 55.75,
			date: 'December 15, 2025',
			items: [{ itemDescription: 'Some prior-year product', image: '' }],
			transactions: [
				{ amount:  55.75, date: 'December 15, 2025', description: 'AMZN Mktp US', last4: '9076' },
				{ amount: -26.23, date: 'June 19, 2026',     description: 'AMZN Mktp US', last4: '9076' }
			]
		}]

		// Only the +$26.23 refund credit is present (the original charge is from the prior year)
		const credit = makeMockHybridTransaction({
			description: 'Refund: Amazon', amount: 26.23, date: new Date('2026-06-19T00:00:00.000Z'), id: 'zs5-credit'
		})

		// Step 1: Amazon reconciliation attaches the order to the refund via the negative refund entry
		Core.globalState.remainingAmazonTransactionsCount = undefined
		withStub(Core, 'categorizeTransactionsAllocationsTupples', () => Promise.resolve(), () => {
			Core._performAmazonReconciliation(mockOrders, [credit])
		})

		assert(
			credit.amazonOrderDetails?.orderNumber === '112-9999999-0000005',
			`refund linked to Amazon order even without the original debit (got: "${credit.amazonOrderDetails?.orderNumber}")`,
			credit.amazonOrderDetails
		)
		assert(
			credit.amazonOrderDetails?.algo === 'transactionLevelMatch',
			`algo === "transactionLevelMatch" (got: "${credit.amazonOrderDetails?.algo}")`,
			credit.amazonOrderDetails
		)

		// Step 2: zero-sum reconciliation — the credit is stranded (0 matches is correct)
		const { matches, unmatched } = reconcileZeroSumStreamTransactions([credit], stream)

		assert(matches.length === 0, `0 zero-sum matches expected (got: ${matches.length})`, matches)
		assert(unmatched.length === 1, `1 unmatched expected (got: ${unmatched.length})`, unmatched)

		// Step 3: suggestAmazonReturnSplits returns 0 candidates — no debit available to split
		const unmatchedAmazonCredits = unmatched.filter(t => t.amount > 0 && t.amazonOrderDetails)
		const candidates = suggestAmazonReturnSplits(unmatchedAmazonCredits, [credit], stream)

		assert(candidates.length === 0, `0 split candidates expected — no debit to split (got: ${candidates.length})`, candidates)
	})
}

// ---------------------------------------------------------------------------
// Public entry point – called from clientTestRoutine.js
// ---------------------------------------------------------------------------
export function runTransactionMatchingTests() {
	console.group('Transaction Matching Tests')

	console.group('Amazon Reconciliation')
	test1_singleCharge_sameDate()
	test2_twoCharges_differentDates_sameOrder()
	test3_oneChargePosted_oneChargePending()
	test4_giftCardSplitPayment_onlyCardChargeMatchable()
	test5_firstChargeAlreadyMatched_secondChargeMatchedNow()
	test6_partialRefund_getsLinkedToOriginalOrder()
	test7_refundPostsAfterDebitAlreadyCategorizedAndMapped()
	test8_creditWithNoRefundEntryInOrder_staysUnmatched()
	test9_multipleOrders_noRefundEntries_creditStaysUnmatched()
	console.groupEnd()

	console.group('Zero-Sum Stream Reconciliation')
	testZS1_oneToOneMatch()
	testZS2_oneToOneMatch_linkedToSameAmazonOrder()
	testZS3_amazonRefundStranded_correctlyUnmatched_splitCandidateIdentified()
	testZS4_multipleRefundsForSameOrder_splitNeeded_currentlyFailing()
	testZS5_refundWithoutOriginalDebit_orderStillAttachedToRefund()
	console.groupEnd()

	console.groupEnd()
}
