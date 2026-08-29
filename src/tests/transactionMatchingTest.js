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
import utils from '../utils'
import { reconcileZeroSumStreamTransactions, suggestAmazonReturnSplits, suggestRefundMatches, getMerchantKey, merchantKeysMatch, refundMatchingConfig } from '../transactionMatching'
import { getAmazonChargeItems, canSplitAmazonByItem, getAmazonOrderData, mapAllocationsToItems, getAmazonItemSplit } from '../components/CategorizeAction'

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
			Math.abs((candidates[0]?.amount ?? NaN) - 26.23) < 0.001,
			`amount is 26.23 (got: ${candidates[0]?.amount})`,
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
			Math.abs((multiCandidates[0]?.amount ?? NaN) - 36.23) < 0.001,
			`amount is 36.23 ($26.23 + $10.00) (got: ${multiCandidates[0]?.amount})`,
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
			Math.abs((candidates[0]?.amount ?? NaN) - 14.00) < 0.001,
			`amount is $14 ($5 + $9) (got: ${candidates[0]?.amount})`,
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

/**
 * Test ZS-17 - Order billed as two charges, refund matches one of them exactly
 *
 * Real scenario: an Amazon order arrives as two separate bank transactions (two shipments, or a
 * card/gift-card split), and only one of them is later refunded. Both charges carry the order
 * number, so counting candidates calls it ambiguous - but it is not: the refund equals one of them
 * exactly, so there is only one possible source.
 */
function testZS17_twoChargesOneRefundedExactly() {
	runTest('Test ZS-17 - Order billed as two charges: exact-amount refund resolves the charge', assert => {
		const stream = makeMockZeroSumStream()
		const order = { orderNumber: 'order-zs17' }

		const charge1 = makeMockHybridTransaction({ description: 'Amazon', amount: -43.89, date: new Date('2026-05-09T00:00:00.000Z'), id: 'zs17-charge1', streamAmount: 0 })
		const charge2 = makeMockHybridTransaction({ description: 'Amazon', amount: -30.00, date: new Date('2026-05-09T00:00:00.000Z'), id: 'zs17-charge2', streamAmount: 0 })
		const credit  = makeMockHybridTransaction({ description: 'Refund: Amazon', amount: 43.89, date: new Date('2026-08-16T00:00:00.000Z'), id: 'zs17-credit' })
		;[charge1, charge2].forEach(t => { t.streamAllocation = [{ streamId: 'stream-A-id', amount: t.amount, type: 'value' }] })
		;[charge1, charge2, credit].forEach(t => { t.amazonOrderDetails = { ...order } })

		const candidates = suggestAmazonReturnSplits([credit], [charge1, charge2, credit], stream)

		assert(candidates.length === 1, `1 candidate expected - two charges is not ambiguous here (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.debit?.id === 'zs17-charge1', `the exactly-matching charge is chosen (got: "${candidates[0]?.debit?.id}")`, candidates[0])
		assert(candidates[0]?.mode === 'move', `mode is "move" (got: "${candidates[0]?.mode}")`, candidates[0])
	})
}

/**
 * Test ZS-18 - Order billed as two charges, only one large enough to have funded the refund
 *
 * No exact match, but the smaller charge cannot possibly be the source, so the larger one is the
 * only candidate left and gets split.
 */
function testZS18_twoChargesOnlyOneCanFundTheRefund() {
	runTest('Test ZS-18 - Order billed as two charges: only the feasible one is split', assert => {
		const stream = makeMockZeroSumStream()
		const order = { orderNumber: 'order-zs18' }

		const big   = makeMockHybridTransaction({ description: 'Amazon', amount: -100.00, date: new Date('2026-05-09T00:00:00.000Z'), id: 'zs18-big', streamAmount: 0 })
		const small = makeMockHybridTransaction({ description: 'Amazon', amount: -5.00, date: new Date('2026-05-09T00:00:00.000Z'), id: 'zs18-small', streamAmount: 0 })
		const credit = makeMockHybridTransaction({ description: 'Refund: Amazon', amount: 50.00, date: new Date('2026-06-16T00:00:00.000Z'), id: 'zs18-credit' })
		;[big, small].forEach(t => { t.streamAllocation = [{ streamId: 'stream-A-id', amount: t.amount, type: 'value' }] })
		;[big, small, credit].forEach(t => { t.amazonOrderDetails = { ...order } })

		const candidates = suggestAmazonReturnSplits([credit], [big, small, credit], stream)

		assert(candidates.length === 1, `1 candidate expected (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.debit?.id === 'zs18-big', `the only charge large enough is chosen (got: "${candidates[0]?.debit?.id}")`, candidates[0])
		assert(candidates[0]?.mode === 'split', `mode is "split" (got: "${candidates[0]?.mode}")`, candidates[0])
	})
}

/**
 * Test ZS-19 - Order billed as two charges, either could have funded the refund: refuse
 *
 * The complement of ZS-17 and ZS-18. Narrowing by amount must not become guessing: when two
 * charges could equally be the source, no candidate is produced and the refund stays stranded.
 */
function testZS19_twoChargesGenuinelyAmbiguous() {
	runTest('Test ZS-19 - Two charges that could equally have funded the refund: no candidate', assert => {
		const stream = makeMockZeroSumStream()
		const order = { orderNumber: 'order-zs19' }

		const a = makeMockHybridTransaction({ description: 'Amazon', amount: -100.00, date: new Date('2026-05-09T00:00:00.000Z'), id: 'zs19-a', streamAmount: 0 })
		const b = makeMockHybridTransaction({ description: 'Amazon', amount: -90.00, date: new Date('2026-05-09T00:00:00.000Z'), id: 'zs19-b', streamAmount: 0 })
		const credit = makeMockHybridTransaction({ description: 'Refund: Amazon', amount: 20.00, date: new Date('2026-06-16T00:00:00.000Z'), id: 'zs19-credit' })
		;[a, b].forEach(t => { t.streamAllocation = [{ streamId: 'stream-A-id', amount: t.amount, type: 'value' }] })
		;[a, b, credit].forEach(t => { t.amazonOrderDetails = { ...order } })

		const candidates = suggestAmazonReturnSplits([credit], [a, b, credit], stream)

		assert(candidates.length === 0, `0 candidates expected - refuse rather than guess (got: ${candidates.length})`, candidates)
	})
}

// ---------------------------------------------------------------------------
// Generic (non-Amazon) refund matching
//
// Every scenario below is taken from a real row of the user's Returns stream export.
// ---------------------------------------------------------------------------

// A categorized transaction for the generic rail. `streamAmount` is what it reports for the refund
// stream: 0 means "not reconciled into it yet", which is what makes a charge eligible. `allocations`
// is the list of per-stream amounts, which must sum to `amount`; it defaults to a single share.
function makeMockRefundTransaction({ description, amount, date, id, streamAmount = 0, allocations }) {
	return {
		description,
		amount,
		date: date instanceof Date ? date : new Date(date),
		id,
		transactionId: id,
		categorized: true,
		streamAllocation: (allocations || [amount]).map((a, i) => ({ streamId: 'stream-' + i, amount: a, type: 'value' })),
		moneyInForStream(_stream) { return streamAmount }
	}
}

function makeMockRefundStream() {
	return { id: 'test-returns', isZeroSumStream: true, isSavings: false, isInterestIncome: false }
}

/**
 * Test ZS-6 - Merchant keys survive punctuation, truncation and reference codes
 *
 * The normaliser is what the whole generic rail rests on, so it is asserted directly:
 * apostrophes ("Carter's"), the "Refund: " prefix, multi-word names, bank truncation
 * ("Amazon Reta*" for "Amazon Retail") and trailing reference codes.
 */
function testZS6_merchantKeyNormalisation() {
	runTest('Test ZS-6 - Merchant key normalisation and prefix matching', assert => {
		assert(getMerchantKey("Refund: Carter's") === 'carters', `"Refund: Carter's" -> carters (got: "${getMerchantKey("Refund: Carter's")}")`)
		assert(getMerchantKey('Refund: Sports Basement') === 'sportsbasement', `multi-word name (got: "${getMerchantKey('Refund: Sports Basement')}")`)
		assert(getMerchantKey('CVS') === 'cvs', `3-letter merchant survives (got: "${getMerchantKey('CVS')}")`)
		assert(getMerchantKey('Refund: Amazon Reta* B89as59y1') === 'amazonreta', `reference code dropped (got: "${getMerchantKey('Refund: Amazon Reta* B89as59y1')}")`)

		assert(merchantKeysMatch('cvs', 'cvs'), 'CVS matches itself - a 3-char key is not rejected')
		assert(merchantKeysMatch('amazonreta', 'amazonretail'), 'truncated key prefix-matches the full one')
		assert(!merchantKeysMatch('atmfeereimbursement', 'chasepaloaltocaus'), 'unrelated descriptions do not match')
		assert(!merchantKeysMatch('', 'target'), 'an empty key matches nothing')
	})
}

/**
 * Test ZS-7 - Exact-amount refund moves the whole charge (real: CVS, 2026-07-04)
 *
 * Scenario: -$20.75 CVS charge and a +$20.75 "Refund: CVS" credit posted the SAME DAY.
 * Expected: one candidate, mode "move" - the charge belongs in the refund stream outright,
 * and the same-day case must not be excluded by the date test.
 */
function testZS7_exactRefundMovesWholeCharge() {
	runTest('Test ZS-7 - Exact-amount refund, same day: whole charge is moved', assert => {
		const stream = makeMockRefundStream()
		const debit  = makeMockRefundTransaction({ description: 'CVS', amount: -20.75, date: '2026-07-04T00:00:00.000Z', id: 'zs7-debit' })
		const credit = makeMockRefundTransaction({ description: 'Refund: CVS', amount: 20.75, date: '2026-07-04T00:00:00.000Z', id: 'zs7-credit' })

		const candidates = suggestRefundMatches([credit], [debit, credit], stream)

		assert(candidates.length === 1, `1 candidate expected (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.debit?.id === 'zs7-debit', 'candidate charge is the CVS debit', candidates[0])
		assert(candidates[0]?.mode === 'move', `mode is "move" (got: "${candidates[0]?.mode}")`, candidates[0])
		assert(Math.abs((candidates[0]?.amount ?? NaN) - 20.75) < 0.001, `amount is 20.75 (got: ${candidates[0]?.amount})`, candidates[0])
	})
}

/**
 * Test ZS-8 - Partial refund splits the most recent matching charge (real: Lululemon, 2026-06)
 *
 * Scenario: a -$204.14 Lululemon charge on 06-16 and an older -$150 Lululemon charge on 05-02,
 * then a +$107.56 "Refund: Lululemon" credit on 06-26.
 * Expected: mode "split" against the MORE RECENT charge, per the agreed selection rule.
 */
function testZS8_partialRefundSplitsMostRecentCharge() {
	runTest('Test ZS-8 - Partial refund splits the most recent matching charge', assert => {
		const stream = makeMockRefundStream()
		const older  = makeMockRefundTransaction({ description: 'Lululemon', amount: -150.00, date: '2026-05-02T00:00:00.000Z', id: 'zs8-older' })
		const recent = makeMockRefundTransaction({ description: 'Lululemon', amount: -204.14, date: '2026-06-16T00:00:00.000Z', id: 'zs8-recent' })
		const credit = makeMockRefundTransaction({ description: 'Refund: Lululemon', amount: 107.56, date: '2026-06-26T00:00:00.000Z', id: 'zs8-credit' })

		const candidates = suggestRefundMatches([credit], [older, recent, credit], stream)

		assert(candidates.length === 1, `1 candidate expected (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.debit?.id === 'zs8-recent', `most recent charge chosen (got: "${candidates[0]?.debit?.id}")`, candidates[0])
		assert(candidates[0]?.mode === 'split', `mode is "split" (got: "${candidates[0]?.mode}")`, candidates[0])
		assert(Math.abs((candidates[0]?.amount ?? NaN) - 107.56) < 0.001, `amount is 107.56 (got: ${candidates[0]?.amount})`, candidates[0])
	})
}

/**
 * Test ZS-9 - Two identical charges, one refund: exact amount beats recency (real: Quince)
 *
 * Scenario (mirrors 2026-05-03 / 2026-06-04 / 2026-07-08): a -$350.98 charge and a later
 * -$219.50 charge, then a +$219.50 refund. Recency alone would pick the -$219.50 charge here
 * too, so the test also asserts the reverse ordering: an exact match that is NOT the most
 * recent still wins, because amount equality is stronger evidence than proximity.
 */
function testZS9_exactAmountBeatsRecency() {
	runTest('Test ZS-9 - Exact-amount charge wins over a more recent inexact one', assert => {
		const stream = makeMockRefundStream()
		const exact  = makeMockRefundTransaction({ description: 'Quince', amount: -219.50, date: '2026-06-04T00:00:00.000Z', id: 'zs9-exact' })
		const newer  = makeMockRefundTransaction({ description: 'Quince', amount: -350.98, date: '2026-06-20T00:00:00.000Z', id: 'zs9-newer' })
		const credit = makeMockRefundTransaction({ description: 'Refund: Quince', amount: 219.50, date: '2026-07-08T00:00:00.000Z', id: 'zs9-credit' })

		const candidates = suggestRefundMatches([credit], [exact, newer, credit], stream)

		assert(candidates.length === 1, `1 candidate expected (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.debit?.id === 'zs9-exact', `exact-amount charge chosen over the newer one (got: "${candidates[0]?.debit?.id}")`, candidates[0])
		assert(candidates[0]?.mode === 'move', `mode is "move" (got: "${candidates[0]?.mode}")`, candidates[0])
	})
}

/**
 * Test ZS-10 - The 90-day window is enforced (real: Refund: Columbia with no charge in range)
 *
 * Scenario: the charge sits one day beyond maxDaysBetweenChargeAndRefund.
 * Expected: 0 candidates. A refund whose charge is out of range stays stranded rather than
 * being fitted to whatever happens to be nearby.
 */
function testZS10_windowIsEnforced() {
	runTest('Test ZS-10 - Charge beyond the 90-day window yields no candidate', assert => {
		const stream = makeMockRefundStream()
		const within = new Date('2026-07-31T00:00:00.000Z').getTime() - 24 * 3600 * 1000 * refundMatchingConfig.maxDaysBetweenChargeAndRefund
		const justInside  = makeMockRefundTransaction({ description: 'Columbia', amount: -54.95, date: new Date(within), id: 'zs10-inside' })
		const justOutside = makeMockRefundTransaction({ description: 'Columbia', amount: -54.95, date: new Date(within - 24 * 3600 * 1000), id: 'zs10-outside' })
		const credit = makeMockRefundTransaction({ description: 'Refund: Columbia', amount: 54.95, date: '2026-07-31T00:00:00.000Z', id: 'zs10-credit' })

		const outsideOnly = suggestRefundMatches([credit], [justOutside, credit], stream)
		assert(outsideOnly.length === 0, `0 candidates when the only charge is out of window (got: ${outsideOnly.length})`, outsideOnly)

		const insideOnly = suggestRefundMatches([credit], [justInside, credit], stream)
		assert(insideOnly.length === 1, `1 candidate at exactly the window boundary (got: ${insideOnly.length})`, insideOnly)
	})
}

/**
 * Test ZS-11 - A merchant seen on another zero-sum stream is never routed
 *
 * Scenario: a credit card tracked on its own zero-sum stream. Its payments look exactly like
 * refunds - a credit that cancels an earlier debit of the same name - but they are not, so the
 * exclusion list must stop them, however well the amount and date line up.
 */
function testZS11_merchantOnAnotherZeroSumStreamIsExcluded() {
	runTest('Test ZS-11 - Merchant seen on a non-refund zero-sum stream is excluded', assert => {
		const stream = makeMockRefundStream()
		const debit  = makeMockRefundTransaction({ description: 'Robinhood Card', amount: -300.00, date: '2026-06-01T00:00:00.000Z', id: 'zs11-debit' })
		const credit = makeMockRefundTransaction({ description: 'Refund: Robinhood Card', amount: 300.00, date: '2026-06-10T00:00:00.000Z', id: 'zs11-credit' })

		const withoutExclusion = suggestRefundMatches([credit], [debit, credit], stream)
		assert(withoutExclusion.length === 1, `matches when nothing is excluded (got: ${withoutExclusion.length})`, withoutExclusion)

		const withExclusion = suggestRefundMatches([credit], [debit, credit], stream, {
			excludedMerchantKeys: [getMerchantKey('Robinhood Card Payment')]
		})
		assert(withExclusion.length === 0, `0 candidates once the merchant is seen elsewhere (got: ${withExclusion.length})`, withExclusion)
	})
}

/**
 * Test ZS-12 - Amazon never enters the generic rail
 *
 * Amazon is owned by the order-number rail. Its bank descriptions are far too generic to pair
 * on - the real data has several unmatched "Refund: Amazon" credits and many "Amazon" charges
 * within any 90-day window - so an unmatched Amazon refund must stay stranded here rather than
 * be fitted to the nearest Amazon charge.
 */
function testZS12_amazonIsExcludedFromGenericRail() {
	runTest('Test ZS-12 - Amazon descriptions are excluded from the generic rail', assert => {
		const stream = makeMockRefundStream()
		const isAmazon = (d) => /amz|amazon/i.test(d || '')
		const debit  = makeMockRefundTransaction({ description: 'Amazon', amount: -43.89, date: '2026-05-09T00:00:00.000Z', id: 'zs12-debit' })
		const credit = makeMockRefundTransaction({ description: 'Refund: Amazon', amount: 43.89, date: '2026-08-16T00:00:00.000Z', id: 'zs12-credit' })
		credit.date = new Date('2026-05-15T00:00:00.000Z')

		const candidates = suggestRefundMatches([credit], [debit, credit], stream, { isExcludedDescription: isAmazon })
		assert(candidates.length === 0, `0 candidates - Amazon is left to the order-number rail (got: ${candidates.length})`, candidates)

		// and a credit already linked to an order is skipped even without the predicate
		const linked = makeMockRefundTransaction({ description: 'Refund: Something', amount: 43.89, date: '2026-05-15T00:00:00.000Z', id: 'zs12-linked' })
		linked.amazonOrderDetails = { orderNumber: 'order-zs12' }
		const other = makeMockRefundTransaction({ description: 'Something', amount: -43.89, date: '2026-05-09T00:00:00.000Z', id: 'zs12-other' })
		const linkedCandidates = suggestRefundMatches([linked], [other, linked], stream)
		assert(linkedCandidates.length === 0, `0 candidates for a credit carrying amazonOrderDetails (got: ${linkedCandidates.length})`, linkedCandidates)
	})
}

/**
 * Test ZS-13 - A refund credit with no "Refund:" marker still matches (real: Carter's)
 *
 * Two of the real non-Amazon refunds arrive described simply "Carter's". The credit already
 * being categorized into the refund stream is the assertion that it is a refund, so the marker
 * is stripped when present and never required.
 */
function testZS13_missingRefundMarkerStillMatches() {
	runTest('Test ZS-13 - Credit with no "Refund:" prefix still matches its charge', assert => {
		const stream = makeMockRefundStream()
		const debit  = makeMockRefundTransaction({ description: "Carter's", amount: -122.96, date: '2026-06-05T00:00:00.000Z', id: 'zs13-debit' })
		const credit = makeMockRefundTransaction({ description: "Carter's", amount: 40.63, date: '2026-07-02T00:00:00.000Z', id: 'zs13-credit' })

		const candidates = suggestRefundMatches([credit], [debit, credit], stream)

		assert(candidates.length === 1, `1 candidate expected (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.mode === 'split', `mode is "split" (got: "${candidates[0]?.mode}")`, candidates[0])
		assert(Math.abs((candidates[0]?.amount ?? NaN) - 40.63) < 0.001, `amount is 40.63 (got: ${candidates[0]?.amount})`, candidates[0])
	})
}

/**
 * Test ZS-14 - Guards: already-reconciled, already-split, and refunds exceeding the charge
 */
function testZS14_guards() {
	runTest('Test ZS-14 - Charges already in the stream, already split, or too small are skipped', assert => {
		const stream = makeMockRefundStream()
		const credit = makeMockRefundTransaction({ description: 'Refund: Target', amount: 16.35, date: '2026-06-20T00:00:00.000Z', id: 'zs14-credit' })

		const alreadyInStream = makeMockRefundTransaction({ description: 'Target', amount: -70.35, date: '2026-05-18T00:00:00.000Z', id: 'zs14-in', streamAmount: -16.35 })
		assert(suggestRefundMatches([credit], [alreadyInStream, credit], stream).length === 0, 'a charge already reconciled into the stream is skipped')

		const tooSmall = makeMockRefundTransaction({ description: 'Target', amount: -10.00, date: '2026-05-18T00:00:00.000Z', id: 'zs14-small' })
		assert(suggestRefundMatches([credit], [tooSmall, credit], stream).length === 0, 'a refund larger than the charge is not matched to it')

		// a charge big enough overall, but split so finely that no single share could have funded it
		const noShareBigEnough = makeMockRefundTransaction({ description: 'Target', amount: -70.35, date: '2026-05-18T00:00:00.000Z', id: 'zs14-fine', allocations: [-14.07, -14.07, -14.07, -14.07, -14.07] })
		assert(suggestRefundMatches([credit], [noShareBigEnough, credit], stream).length === 0, 'no single share large enough to fund the refund is skipped')

		const eligible = makeMockRefundTransaction({ description: 'Target', amount: -70.35, date: '2026-05-18T00:00:00.000Z', id: 'zs14-ok' })
		assert(suggestRefundMatches([credit], [eligible, credit], stream).length === 1, 'the same charge with no guard tripped does match')
	})
}

/**
 * Test ZS-20 - The charge was already split across streams (real: Columbia, 2026-07)
 *
 * Scenario: a -$122.03 Columbia charge already split into $87.03 of Repair/replacements and $35.00
 * of Emile, then a +$54.95 "Refund: Columbia" credit ten days later.
 *
 * A charge being split is not a reason to skip it - the refund came out of one of its shares. Only
 * the $87.03 share is large enough, so it funds the refund and the $35.00 share is left alone.
 */
function testZS20_chargeAlreadySplitAcrossStreams() {
	runTest('Test ZS-20 - Refund is funded from the share of an already-split charge', assert => {
		const stream = makeMockRefundStream()
		const debit = makeMockRefundTransaction({
			description: 'Columbia', amount: -122.03, date: '2026-07-21T00:00:00.000Z', id: 'zs20-debit',
			allocations: [-87.03, -35.00]
		})
		const credit = makeMockRefundTransaction({ description: 'Refund: Columbia', amount: 54.95, date: '2026-07-31T00:00:00.000Z', id: 'zs20-credit' })

		const candidates = suggestRefundMatches([credit], [debit, credit], stream)

		assert(candidates.length === 1, `1 candidate expected - a split charge is still eligible (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.debit?.id === 'zs20-debit', 'the Columbia charge is the candidate', candidates[0])
		assert(
			Math.abs((candidates[0]?.sourceAllocation?.amount ?? NaN) - (-87.03)) < 0.001,
			`funded from the -87.03 share, the only one big enough (got: ${candidates[0]?.sourceAllocation?.amount})`,
			candidates[0]
		)
		assert(candidates[0]?.mode === 'split', `mode is "split" - the share is only partly consumed (got: "${candidates[0]?.mode}")`, candidates[0])
	})
}

/**
 * Test ZS-21 - Where several shares could fund the refund, the smallest one does
 *
 * The refund came out of one part of the purchase, and the tightest share that can hold it is the
 * least disruptive reading: it leaves the larger shares of the charge untouched.
 */
function testZS21_smallestSufficientShareFundsTheRefund() {
	runTest('Test ZS-21 - The smallest share large enough funds the refund', assert => {
		const stream = makeMockRefundStream()
		const debit = makeMockRefundTransaction({
			description: 'Quince', amount: -160.00, date: '2026-06-01T00:00:00.000Z', id: 'zs21-debit',
			allocations: [-100.00, -60.00]
		})
		const credit = makeMockRefundTransaction({ description: 'Refund: Quince', amount: 55.00, date: '2026-06-20T00:00:00.000Z', id: 'zs21-credit' })

		const candidates = suggestRefundMatches([credit], [debit, credit], stream)

		assert(candidates.length === 1, `1 candidate expected (got: ${candidates.length})`, candidates)
		assert(
			Math.abs((candidates[0]?.sourceAllocation?.amount ?? NaN) - (-60.00)) < 0.001,
			`funded from the -60.00 share, not the -100.00 one (got: ${candidates[0]?.sourceAllocation?.amount})`,
			candidates[0]
		)
	})
}

/**
 * Test ZS-22 - A refund that consumes a whole share is a "move" of that share
 *
 * The share is fully refunded, so nothing of it remains. The writer must not leave a zero-amount
 * allocation behind - that is junk, and it also blocks the charge from any later reconciliation.
 */
function testZS22_refundConsumingAWholeShare() {
	runTest('Test ZS-22 - Refund equal to one share of a split charge is a move of that share', assert => {
		const stream = makeMockRefundStream()
		const debit = makeMockRefundTransaction({
			description: 'Columbia', amount: -122.03, date: '2026-07-21T00:00:00.000Z', id: 'zs22-debit',
			allocations: [-87.03, -35.00]
		})
		const credit = makeMockRefundTransaction({ description: 'Refund: Columbia', amount: 35.00, date: '2026-07-31T00:00:00.000Z', id: 'zs22-credit' })

		const candidates = suggestRefundMatches([credit], [debit, credit], stream)

		assert(candidates.length === 1, `1 candidate expected (got: ${candidates.length})`, candidates)
		assert(
			Math.abs((candidates[0]?.sourceAllocation?.amount ?? NaN) - (-35.00)) < 0.001,
			`funded from the -35.00 share (got: ${candidates[0]?.sourceAllocation?.amount})`,
			candidates[0]
		)
		assert(candidates[0]?.mode === 'move', `mode is "move" - the share is consumed whole (got: "${candidates[0]?.mode}")`, candidates[0])
	})
}

/**
 * Test ZS-23 - A fully refunded charge moves whole, however many shares it was split into
 *
 * Real scenario, Amazon order #112-7078452-6127462: billed as two charges, -$4.06 and -$12.06.
 * The -$12.06 one was booked as $8.00 of Repair/replacements and $4.06 of Medical, then refunded
 * in full at +$12.06.
 *
 * Two things have to hold at once for this to resolve. No single share of the -$12.06 charge is
 * large enough to fund a $12.06 refund, so share-based funding alone would disqualify it - but the
 * whole purchase came back, so the whole charge moves. And the order has two charge debits, which
 * is not ambiguous here: the -$4.06 one could not have funded a $12.06 refund at all, leaving one
 * candidate.
 *
 * This runs on the Amazon rail because that is where it belongs - the generic rail excludes every
 * Amazon description on purpose.
 */
function testZS23_fullyRefundedSplitChargeMovesWhole() {
	runTest('Test ZS-23 - Fully refunded charge moves whole even when split across streams', assert => {
		const stream = makeMockZeroSumStream()
		const order = { orderNumber: '112-7078452-6127462' }

		const smallCharge = makeMockHybridTransaction({ description: 'Amazon', amount: -4.06, date: new Date('2026-07-14T00:00:00.000Z'), id: 'zs23-small', streamAmount: 0 })
		smallCharge.streamAllocation = [{ streamId: 'stream-A-id', amount: -4.06, type: 'value' }]

		const splitCharge = makeMockHybridTransaction({ description: 'Amazon', amount: -12.06, date: new Date('2026-07-23T00:00:00.000Z'), id: 'zs23-split', streamAmount: 0 })
		splitCharge.streamAllocation = [{ streamId: 'repair', amount: -8.00, type: 'value' }, { streamId: 'medical', amount: -4.06, type: 'value' }]

		const credit = makeMockHybridTransaction({ description: 'Refund: Amazon', amount: 12.06, date: new Date('2026-08-16T00:00:00.000Z'), id: 'zs23-credit' })
		;[smallCharge, splitCharge, credit].forEach(t => { t.amazonOrderDetails = { ...order } })

		const candidates = suggestAmazonReturnSplits([credit], [smallCharge, splitCharge, credit], stream)

		assert(candidates.length === 1, `1 candidate expected (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.debit?.id === 'zs23-split', `the -12.06 charge is chosen; -4.06 could not have funded it (got: "${candidates[0]?.debit?.id}")`, candidates[0])
		assert(candidates[0]?.fundsWholeTransaction === true, 'the whole transaction funds the refund, not one share', candidates[0])
		assert(candidates[0]?.sourceAllocation === undefined, 'no single funding share is nominated', candidates[0])
		assert(candidates[0]?.mode === 'move', `mode is "move" (got: "${candidates[0]?.mode}")`, candidates[0])
	})
}

/**
 * Test ZS-24 - The same whole-transaction rule on the generic rail, and its limit
 *
 * A non-Amazon charge split across two streams and refunded in full moves whole; a refund larger
 * than the whole charge is still refused.
 */
function testZS24_genericFullRefundOfSplitCharge() {
	runTest('Test ZS-24 - Generic rail: fully refunded split charge moves whole', assert => {
		const stream = makeMockRefundStream()
		const debit = makeMockRefundTransaction({
			description: 'Sports Basement', amount: -12.06, date: '2026-07-23T00:00:00.000Z', id: 'zs24-debit',
			allocations: [-8.00, -4.06]
		})
		const credit = makeMockRefundTransaction({ description: 'Refund: Sports Basement', amount: 12.06, date: '2026-08-16T00:00:00.000Z', id: 'zs24-credit' })

		const candidates = suggestRefundMatches([credit], [debit, credit], stream)
		assert(candidates.length === 1, `1 candidate expected - neither share alone could fund it (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.fundsWholeTransaction === true, 'the whole transaction funds the refund', candidates[0])
		assert(candidates[0]?.mode === 'move', `mode is "move" (got: "${candidates[0]?.mode}")`, candidates[0])

		const tooBig = makeMockRefundTransaction({ description: 'Refund: Sports Basement', amount: 20.00, date: '2026-08-16T00:00:00.000Z', id: 'zs24-toobig' })
		assert(suggestRefundMatches([tooBig], [debit, tooBig], stream).length === 0, 'a refund exceeding the whole charge is refused')
	})
}

/**
 * Test ZS-15 - One charge cannot fund two refunds in the same pass
 *
 * Two credits of the same merchant both point at one charge. The first to claim it (the oldest)
 * consumes it; the second must find nothing rather than double-allocating the same charge.
 */
function testZS15_oneChargeIsNotClaimedTwice() {
	runTest('Test ZS-15 - A charge consumed by one refund is not offered to the next', assert => {
		const stream = makeMockRefundStream()
		const debit   = makeMockRefundTransaction({ description: 'Quince', amount: -350.98, date: '2026-05-03T00:00:00.000Z', id: 'zs15-debit' })
		const first   = makeMockRefundTransaction({ description: 'Refund: Quince', amount: 100.00, date: '2026-05-25T00:00:00.000Z', id: 'zs15-first' })
		const second  = makeMockRefundTransaction({ description: 'Refund: Quince', amount: 100.00, date: '2026-06-10T00:00:00.000Z', id: 'zs15-second' })

		const candidates = suggestRefundMatches([second, first], [debit, first, second], stream)

		assert(candidates.length === 1, `1 candidate expected (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.credits?.[0]?.id === 'zs15-first', `the oldest refund claims the charge (got: "${candidates[0]?.credits?.[0]?.id}")`, candidates[0])
	})
}

/**
 * Test ZS-16 - Amazon regression: a refund covering the whole charge now moves it
 *
 * Previously this went through the split path and wrote a second allocation of -0, which also
 * marked the charge as split and disqualified it from any later reconciliation.
 */
function testZS16_amazonFullRefundMovesRatherThanSplits() {
	runTest('Test ZS-16 - Amazon full refund produces mode "move", not a -0 split', assert => {
		const stream = makeMockZeroSumStream()
		const order = { orderNumber: 'order-zs16', orderAmount: 36.16, date: 'April 27, 2025', accountName: 'TestAccount', items: [] }

		const debit = makeMockHybridTransaction({
			description: 'Amazon', amount: -36.16, date: new Date('2025-04-27T00:00:00.000Z'), id: 'zs16-debit', streamAmount: 0
		})
		debit.streamAllocation = [{ streamId: 'stream-A-id', amount: -36.16, type: 'value' }]
		debit.amazonOrderDetails = { ...order }

		const credit = makeMockHybridTransaction({
			description: 'Refund: Amazon', amount: 36.16, date: new Date('2025-05-16T00:00:00.000Z'), id: 'zs16-credit'
		})
		credit.amazonOrderDetails = { ...order }

		const candidates = suggestAmazonReturnSplits([credit], [debit, credit], stream)

		assert(candidates.length === 1, `1 candidate expected (got: ${candidates.length})`, candidates)
		assert(candidates[0]?.mode === 'move', `mode is "move" (got: "${candidates[0]?.mode}")`, candidates[0])
		assert(Math.abs((candidates[0]?.amount ?? NaN) - 36.16) < 0.001, `amount is 36.16 (got: ${candidates[0]?.amount})`, candidates[0])
	})
}

// ---------------------------------------------------------------------------
// Amazon charge inference
//
// An order billed as several charges carries the whole order's item list on every one of them.
// These cover working out which items a given charge actually paid for, and how the order's
// payment history is presented so two charges of one order can be told apart.
// ---------------------------------------------------------------------------

// The real order #112-7078452-6127462 shape: $16.12 of items billed as $4.06 + $12.06
function makeMockAmazonOrder(extra = {}) {
	return {
		orderNumber: 'order-charge-inference',
		orderAmount: 16.12,
		items: [
			{ itemPrice: 4.06, itemDescription: 'Amazon Basics Epsom Salt', image: '' },
			{ itemPrice: 12.06, itemDescription: 'Other thing', image: '' }
		],
		...extra
	}
}

function makeMockChargeTransaction(amount, dateString, order) {
	return { amount, date: new Date(dateString), transactionId: dateString + amount, amazonOrderDetails: order }
}

/**
 * Test AC-1 - A whole order billed as one charge still covers every item
 *
 * The ordinary case, and the one that must not regress: charge amount equals the order total, so
 * every item belongs to it and the item-wise split is offered exactly as before.
 */
function testAC1_wholeOrderOnOneCharge() {
	runTest('Test AC-1 - Whole order on one charge covers every item', assert => {
		const txn = makeMockChargeTransaction(-16.12, '2026-07-23', makeMockAmazonOrder())
		const charge = getAmazonChargeItems(txn)

		assert(!!charge, 'a subset is found', charge)
		assert(charge?.items.length === 2, `both items belong to it (got: ${charge?.items.length})`, charge)
		assert(Math.abs(utils.sum(charge?.prices || []) - 16.12) < 0.005, 'the prices sum to the charge', charge)
		assert(canSplitAmazonByItem(txn) === true, 'the item-wise split is offered')
	})
}

/**
 * Test AC-2 - One charge of several covers only its own items
 *
 * The bug this was written for: the $12.06 charge used to open a split dialog listing BOTH items,
 * re-priced onto $12.06 - roughly $3.05 and $9.01, neither of which is a real price, and one of
 * which was billed on the other charge entirely.
 */
function testAC2_oneChargeOfSeveral() {
	runTest('Test AC-2 - One charge of several covers only the items it paid for', assert => {
		const txn = makeMockChargeTransaction(-12.06, '2026-07-23', makeMockAmazonOrder())
		const charge = getAmazonChargeItems(txn)

		assert(charge?.items.length === 1, `1 item on this charge (got: ${charge?.items.length})`, charge)
		assert(charge?.items[0]?.itemDescription === 'Other thing', `the right item (got: "${charge?.items[0]?.itemDescription}")`, charge)
		assert(Math.abs((charge?.prices[0] ?? NaN) - 12.06) < 0.005, `priced at the charge, not a re-spread fiction (got: ${charge?.prices[0]})`, charge)
		assert(canSplitAmazonByItem(txn) === false, 'no item-wise split for a single-item charge - there is nothing to divide')
	})
}

/**
 * Test AC-3 - Two subsets that both fit means we do not know
 *
 * Two $5 items and a $5 charge: either could be the one. Inference must decline rather than pick,
 * because the consequence of picking is a real product picture with someone else's price on it.
 */
function testAC3_ambiguousSubsetDeclines() {
	runTest('Test AC-3 - Ambiguous item subset declines rather than guessing', assert => {
		const order = { orderNumber: 'order-ac3', orderAmount: 20.00, items: [
			{ itemPrice: 5, itemDescription: 'A' }, { itemPrice: 5, itemDescription: 'B' }, { itemPrice: 10, itemDescription: 'C' }] }
		const txn = makeMockChargeTransaction(-5.00, '2026-07-23', order)

		assert(getAmazonChargeItems(txn) === undefined, 'two subsets fit, so no answer is given')
		assert(canSplitAmazonByItem(txn) === false, 'falls back to the amount-based split')
	})
}

/**
 * Test AC-4 - An order with no item prices supports no inference
 *
 * Amazon Fresh and digital orders never get per-item prices, and they keep the amount-based split.
 */
function testAC4_unpricedOrder() {
	runTest('Test AC-4 - Unpriced order supports no inference', assert => {
		const order = { orderNumber: 'order-ac4', orderAmount: 20.00, items: [{ itemDescription: 'A' }, { itemDescription: 'B' }] }
		const txn = makeMockChargeTransaction(-20.00, '2026-07-23', order)
		assert(getAmazonChargeItems(txn) === undefined, 'no prices, no subset')
		assert(canSplitAmazonByItem(txn) === false, 'falls back to the amount-based split')
	})
}

/**
 * Test AC-5 - A stale order snapshot on a transaction is resolved from the live history
 *
 * `amazonOrderDetails` is persisted with the categorization and never re-attached once set, so each
 * transaction of an order keeps the order as it looked when THAT transaction was first matched. The
 * scraper backfills item prices later, so two charges of one order can disagree about whether their
 * items have prices at all - which showed up as one charge displaying a single item and its sibling
 * displaying the whole carousel with no price tags.
 *
 * Reading the live order fixes it, while the stored copy still supplies the match metadata the order
 * itself does not carry.
 */
function testAC5_staleOrderSnapshotResolvedFromLiveHistory() {
	runTest('Test AC-5 - Stale order snapshot on a transaction is resolved from the live order', assert => {
		// what the credit carries: matched before the scraper had item prices
		const stale = {
			orderNumber: 'order-charge-inference', orderAmount: 16.12, algo: 'transactionLevelMatch',
			items: [{ itemDescription: 'Amazon Basics Epsom Salt' }, { itemDescription: 'Other thing' }]
		}
		const credit = makeMockChargeTransaction(12.06, '2026-08-16', stale)

		withStub(Core, 'getAmazonOrder', () => undefined, () => {
			assert(getAmazonChargeItems(credit) === undefined,
				'with only the stale copy, the items have no prices and nothing can be inferred')
		})

		withStub(Core, 'getAmazonOrder', () => makeMockAmazonOrder(), () => {
			const resolved = getAmazonOrderData(credit)
			assert(resolved?.items[0]?.itemPrice === 4.06, `the live order's priced items win (got: ${resolved?.items[0]?.itemPrice})`, resolved)
			assert(resolved?.algo === 'transactionLevelMatch', 'the stored copy still supplies the match metadata', resolved)

			const charge = getAmazonChargeItems(credit)
			assert(charge?.items.length === 1, `the single item is inferred again (got: ${charge?.items.length})`, charge)
			assert(charge?.items[0]?.itemDescription === 'Other thing', `and it is the right one (got: "${charge?.items[0]?.itemDescription}")`, charge)
		})
	})
}

// ---------------------------------------------------------------------------
// AC-6 .. AC-13 - order-level resolution
//
// Which items a charge paid for, and what each item costs, are answers about the ORDER, not about one
// charge. These cover the scenario axes that change the answer: whether Amazon's payments page tells us
// the whole charge list, how many charges there are, whether they have all posted, and whether a gift
// card or discount means the items cost more than the bill.
// ---------------------------------------------------------------------------

// $100 of items shipped in two parcels. `ledger` is the payments page as Amazon reports it, positive per
// charge - omit it to model an order matched before the payments page was read.
function makeTwoShipmentOrder(ledger) {
	return {
		orderNumber: 'order-two-shipments',
		orderAmount: 100,
		items: [
			{ itemPrice: 30, itemDescription: 'Parcel A item', image: '' },
			{ itemPrice: 70, itemDescription: 'Parcel B item', image: '' }
		],
		...(ledger ? { transactions: ledger.map(amount => ({ amount })) } : {})
	}
}

/**
 * Test AC-6 - Each charge of a two-shipment order scopes to its own shipment
 *
 * The payments page lists both charges, so the split is knowable and each charge shows only what it paid
 * for, at the price it really cost.
 */
function testAC6_twoShipmentsEachScopeToTheirOwn() {
	runTest('Test AC-6 - Each charge of a two-shipment order scopes to its own shipment', assert => {
		const order = makeTwoShipmentOrder([30, 70])
		const a = getAmazonChargeItems(makeMockChargeTransaction(-30, '2026-07-23', order))
		const b = getAmazonChargeItems(makeMockChargeTransaction(-70, '2026-07-25', order))

		assert(a?.items.length === 1 && a?.items[0].itemDescription === 'Parcel A item', 'the $30 charge holds parcel A', a)
		assert(Math.abs((a?.prices[0] ?? NaN) - 30) < 0.005, `at its real price (got: ${a?.prices[0]})`, a)
		assert(b?.items.length === 1 && b?.items[0].itemDescription === 'Parcel B item', 'the $70 charge holds parcel B', b)
		assert(Math.abs((b?.prices[0] ?? NaN) - 70) < 0.005, `at its real price (got: ${b?.prices[0]})`, b)
	})
}

/**
 * Test AC-7 - A charge still in transit does not cost its sibling its items
 *
 * The bank has posted one of the two charges. The payments page still lists both, so the order accounts
 * for itself and the posted charge resolves exactly as it would once its sibling lands. Reading only what
 * the bank posted would leave $70 of items unaccounted for and scope nothing.
 */
function testAC7_unpostedSiblingStillResolves() {
	runTest('Test AC-7 - A charge still in transit does not cost its sibling its items', assert => {
		const order = makeTwoShipmentOrder([30, 70])
		withStub(Core, 'getTransactionsForOrderNumber', () => [{ amount: -30 }], () => {
			const a = getAmazonChargeItems(makeMockChargeTransaction(-30, '2026-07-23', order))
			assert(a?.items.length === 1 && a?.items[0].itemDescription === 'Parcel A item',
				`the posted charge still resolves (got: ${a?.items.length} items)`, a)
		})
	})
}

/**
 * Test AC-8 - A gift card taken off one shipment is absorbed by that shipment
 *
 * $100 of items billed as $30 + $50. The $30 charge matches an item exactly, so it keeps the price that
 * item really had; the $20 that never got billed lands on the shipment it was actually taken off. Spreading
 * it across both would have re-priced an item nobody discounted.
 */
function testAC8_giftCardOnOneShipment() {
	runTest('Test AC-8 - A gift card on one shipment is absorbed by that shipment', assert => {
		const order = makeTwoShipmentOrder([30, 50])
		const a = getAmazonChargeItems(makeMockChargeTransaction(-30, '2026-07-23', order))
		const b = getAmazonChargeItems(makeMockChargeTransaction(-50, '2026-07-25', order))

		assert(Math.abs((a?.prices[0] ?? NaN) - 30) < 0.005, `the untouched shipment keeps its real price (got: ${a?.prices[0]})`, a)
		assert(b?.items[0]?.itemDescription === 'Parcel B item', 'the discounted shipment keeps its own item', b)
		assert(Math.abs((b?.prices[0] ?? NaN) - 50) < 0.005, `and absorbs the gift card (got: ${b?.prices[0]})`, b)
	})
}

/**
 * Test AC-9 - A discount spread over every shipment re-prices every item
 *
 * $100 of items billed as $24 + $56. No charge matches any subset at full price, so the items are re-priced
 * against what was actually billed and matched again - and then both charges resolve.
 */
function testAC9_discountSpreadOverShipments() {
	runTest('Test AC-9 - A discount spread over every shipment re-prices every item', assert => {
		const order = makeTwoShipmentOrder([24, 56])
		const a = getAmazonChargeItems(makeMockChargeTransaction(-24, '2026-07-23', order))
		const b = getAmazonChargeItems(makeMockChargeTransaction(-56, '2026-07-25', order))

		assert(a?.items[0]?.itemDescription === 'Parcel A item' && Math.abs((a?.prices[0] ?? NaN) - 24) < 0.005,
			`charge 1 resolves at its billed price (got: ${a?.prices[0]})`, a)
		assert(b?.items[0]?.itemDescription === 'Parcel B item' && Math.abs((b?.prices[0] ?? NaN) - 56) < 0.005,
			`charge 2 resolves at its billed price (got: ${b?.prices[0]})`, b)
	})
}

/**
 * Test AC-10 - A gift card on a single-charge order still covers every item
 *
 * One charge for the whole order, but $80 billed against $100 of items. Every item belongs to it, priced
 * against the bill so the split adds up to what was actually taken.
 */
function testAC10_giftCardOnSingleCharge() {
	runTest('Test AC-10 - A gift card on a single-charge order still covers every item', assert => {
		const order = makeTwoShipmentOrder([80])
		const c = getAmazonChargeItems(makeMockChargeTransaction(-80, '2026-07-23', order))

		assert(c?.items.length === 2, `both items belong to it (got: ${c?.items.length})`, c)
		assert(Math.abs(utils.sum(c?.prices || []) - 80) < 0.005,
			`and the prices sum to what was billed (got: ${utils.sum(c?.prices || [])})`, c)
	})
}

/**
 * Test AC-11 - Without the payments page, a gap between order and bill is not read as a discount
 *
 * The same $80 charge with no payments page to confirm it is the only one. The missing $20 could equally be
 * a second charge still in transit, so absorbing it would invent prices. Nothing is scoped.
 */
function testAC11_incompleteInventoryAbsorbsNothing() {
	runTest('Test AC-11 - Without the payments page, order-to-bill gap is not read as a discount', assert => {
		const order = makeTwoShipmentOrder()
		withStub(Core, 'getTransactionsForOrderNumber', () => [{ amount: -80 }], () => {
			assert(getAmazonChargeItems(makeMockChargeTransaction(-80, '2026-07-23', order)) === undefined,
				'no answer is given while the charge list may be incomplete')
		})
	})
}

/**
 * Test AC-12 - Interchangeable items across two charges decline rather than guess
 *
 * Three $10 items billed as $10 + $20. Every way of dealing them out fits, so which picture belongs to
 * which charge is not knowable and neither charge claims any.
 */
function testAC12_interchangeableItemsDecline() {
	runTest('Test AC-12 - Interchangeable items across two charges decline rather than guess', assert => {
		const order = { orderNumber: 'order-ac12', orderAmount: 30, transactions: [{ amount: 10 }, { amount: 20 }],
			items: [{ itemPrice: 10, itemDescription: 'A' }, { itemPrice: 10, itemDescription: 'B' }, { itemPrice: 10, itemDescription: 'C' }] }

		assert(getAmazonChargeItems(makeMockChargeTransaction(-10, '2026-07-23', order)) === undefined, 'the $10 charge claims nothing')
		assert(getAmazonChargeItems(makeMockChargeTransaction(-20, '2026-07-23', order)) === undefined, 'and neither does the $20 charge')
	})
}

/**
 * Test AC-13 - An item costs the same whichever charge is open, and belongs to only one
 *
 * The invariant the whole order-level resolution exists to hold. If prices moved with the charge you
 * happened to open, the price was never a property of the item; if an item appeared on two charges, it
 * would be categorized twice.
 */
function testAC13_pricesAreStableAndItemsUnshared() {
	runTest('Test AC-13 - An item costs the same whichever charge is open, and belongs to only one', assert => {
		const order = makeTwoShipmentOrder([30, 50])
		const a = getAmazonChargeItems(makeMockChargeTransaction(-30, '2026-07-23', order))
		const b = getAmazonChargeItems(makeMockChargeTransaction(-50, '2026-07-25', order))

		const priceOf = (charge, description) => charge?.items.reduce((p, it, i) => it.itemDescription === description ? charge.prices[i] : p, undefined)
		assert(priceOf(a, 'Parcel B item') === undefined && priceOf(b, 'Parcel A item') === undefined,
			'no item is claimed by both charges', [a, b])
		assert(Math.abs(utils.sum(a?.prices || []) - 30) < 0.005 && Math.abs(utils.sum(b?.prices || []) - 50) < 0.005,
			'each charge\'s items sum exactly to it, with no rounding drift', [a?.prices, b?.prices])

		// equal weights over an odd total: the largest-remainder spread must still land on the charge
		const awkward = { orderNumber: 'order-ac13', orderAmount: 43.06, transactions: [{ amount: 43.06 }],
			items: [1, 2, 3].map(n => ({ itemPrice: 12.99, itemDescription: 'x' + n })) }
		const c = getAmazonChargeItems(makeMockChargeTransaction(-43.06, '2026-07-23', awkward))
		assert(Math.abs(utils.sum(c?.prices || []) - 43.06) < 0.005,
			`three equal items over an odd total still sum to the charge (got: ${utils.sum(c?.prices || [])})`, c)
	})
}


// ---------------------------------------------------------------------------
// Reading an item split back
//
// streamAllocation records stream and amount only. These cover recovering which item went to which
// stream by inverting that sum, and - more importantly - declining to when the answer is not unique.
// ---------------------------------------------------------------------------

const valueAllocation = (streamId, amount) => ({ streamId, amount, type: 'value' })

/**
 * Test AC-14 - An item-wise split can be read back item by item
 *
 * The whole basis for editing an item split in the view it was made in. Two items, two streams, each
 * allocation exactly one item's price.
 */
function testAC14_itemSplitReadsBack() {
	runTest('Test AC-14 - An item-wise split reads back onto its items', assert => {
		const txn = makeMockChargeTransaction(-16.12, '2026-07-23', makeMockAmazonOrder({ transactions: [{ amount: 16.12 }] }))
		txn.streamAllocation = [valueAllocation('stream-food', -4.06), valueAllocation('stream-home', -12.06)]

		const split = getAmazonItemSplit(txn)
		assert(split?.items.length === 2, 'both items are still there', split?.items.length)
		assert(JSON.stringify(split?.streamIds) === JSON.stringify(['stream-food', 'stream-home']),
			'each item carries the stream its own price was allocated to', split?.streamIds)
	})
}

/**
 * Test AC-15 - A charge categorized whole puts every item on that stream
 *
 * The commonest case by far: a stream chip writes one percent allocation covering everything. There is
 * only one possible reading, so it must never fall back - and it must not depend on the arithmetic
 * agreeing to the cent.
 */
function testAC15_wholeChargeAllocationCoversEveryItem() {
	runTest('Test AC-15 - One allocation over the whole charge puts every item on it', assert => {
		const txn = makeMockChargeTransaction(-16.12, '2026-07-23', makeMockAmazonOrder({ transactions: [{ amount: 16.12 }] }))
		txn.streamAllocation = [{ streamId: 'stream-shopping', amount: 1.0, type: 'percent' }]
		assert(JSON.stringify(getAmazonItemSplit(txn)?.streamIds) === JSON.stringify(['stream-shopping', 'stream-shopping']),
			'every item reads as being on the one stream', getAmazonItemSplit(txn)?.streamIds)

		const byValue = makeMockChargeTransaction(-16.12, '2026-07-23', makeMockAmazonOrder({ transactions: [{ amount: 16.12 }] }))
		byValue.streamAllocation = [valueAllocation('stream-shopping', -16.13)]//a cent adrift on purpose
		assert(JSON.stringify(getAmazonItemSplit(byValue)?.streamIds) === JSON.stringify(['stream-shopping', 'stream-shopping']),
			'and a rounding cent cannot cost it the item view', getAmazonItemSplit(byValue)?.streamIds)
	})
}

/**
 * Test AC-16 - Two readings means no reading
 *
 * The refusal that makes the rest safe. Items priced alike on different streams could be swapped and
 * the result would look exactly as convincing, so the inversion declines and the caller shows amounts.
 */
function testAC16_ambiguousSplitDeclines() {
	runTest('Test AC-16 - An ambiguous split declines rather than picking', assert => {
		assert(mapAllocationsToItems([10, 10], [valueAllocation('a', -10), valueAllocation('b', -10)], -20) === undefined,
			'two identical prices on two streams is not knowable')
		assert(JSON.stringify(mapAllocationsToItems([10, 10], [valueAllocation('a', -20)], -20)) === JSON.stringify(['a', 'a']),
			'but identical prices on ONE stream are, because there is nothing to choose')
	})
}

/**
 * Test AC-17 - An amount-based split is not an item split and must not pretend to be
 *
 * Halves typed by hand line up with no subset of the item prices. This is the case the fallback exists
 * for, and the one that would be most convincing if it were faked.
 */
function testAC17_amountSplitDeclines() {
	runTest('Test AC-17 - An amount-based split falls back to amounts', assert => {
		const txn = makeMockChargeTransaction(-16.12, '2026-07-23', makeMockAmazonOrder({ transactions: [{ amount: 16.12 }] }))
		txn.streamAllocation = [valueAllocation('a', -8.06), valueAllocation('b', -8.06)]
		assert(getAmazonItemSplit(txn)?.streamIds === undefined,
			'halves that match no subset of the items are not an item split', getAmazonItemSplit(txn)?.streamIds)
		assert(getAmazonItemSplit(txn)?.items.length === 2,
			'the items are still known - only the mapping is not', getAmazonItemSplit(txn)?.items.length)
	})
}

/**
 * Test AC-18 - A charge with a single item can still be split by item
 *
 * One row is still where a stream is chosen and where a refund is shown. A single-item charge dropping
 * to the amount-based view would be the one charge in an order whose rows looked unlike its siblings'.
 */
function testAC18_singleItemChargeIsStillItemWise() {
	runTest('Test AC-18 - One item is enough for the item-wise view', assert => {
		const order = { orderNumber: 'order-ac18', orderAmount: 12.06, transactions: [{ amount: 12.06 }],
			items: [{ itemPrice: 12.06, itemDescription: 'Only thing', image: '' }] }
		const txn = makeMockChargeTransaction(-12.06, '2026-07-23', order)
		assert(canSplitAmazonByItem(txn) === true, 'a one-item charge is splittable by item', canSplitAmazonByItem(txn))
		assert(getAmazonItemSplit(txn)?.streamIds === undefined,
			'and with nothing allocated yet it has no streams to show', getAmazonItemSplit(txn)?.streamIds)
	})
}

/**
 * Test AC-19 - A refund split reads back, so the returned item can be named
 *
 * A return reconciles by splitting the charge and allocating part of it to the refund stream. Inverting
 * that is what lets the item itself carry the refund state instead of the whole charge.
 */
function testAC19_refundSplitNamesTheReturnedItem() {
	runTest('Test AC-19 - The item a refund landed on is recoverable', assert => {
		const order = { orderNumber: 'order-ac19', orderAmount: 43.44, transactions: [{ amount: 43.44 }],
			items: [{ itemPrice: 18.49, itemDescription: 'Kept', image: '' },
					{ itemPrice: 24.95, itemDescription: 'Returned', image: '' }] }
		const txn = makeMockChargeTransaction(-43.44, '2026-07-23', order)
		txn.streamAllocation = [valueAllocation('stream-returns', -24.95), valueAllocation('stream-baby', -18.49)]

		const split = getAmazonItemSplit(txn)
		const returned = split?.items.filter((it, i) => split.streamIds?.[i] === 'stream-returns')
		assert(returned?.length === 1 && returned[0].itemDescription === 'Returned',
			'the refund stream resolves to exactly the item that was sent back', returned?.map(it => it.itemDescription))
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
	testZS16_amazonFullRefundMovesRatherThanSplits()
	testZS17_twoChargesOneRefundedExactly()
	testZS18_twoChargesOnlyOneCanFundTheRefund()
	testZS19_twoChargesGenuinelyAmbiguous()
	testZS23_fullyRefundedSplitChargeMovesWhole()
	console.groupEnd()

	console.group('Generic Refund Matching')
	testZS6_merchantKeyNormalisation()
	testZS7_exactRefundMovesWholeCharge()
	testZS8_partialRefundSplitsMostRecentCharge()
	testZS9_exactAmountBeatsRecency()
	testZS10_windowIsEnforced()
	testZS11_merchantOnAnotherZeroSumStreamIsExcluded()
	testZS12_amazonIsExcludedFromGenericRail()
	testZS13_missingRefundMarkerStillMatches()
	testZS14_guards()
	testZS15_oneChargeIsNotClaimedTwice()
	testZS20_chargeAlreadySplitAcrossStreams()
	testZS21_smallestSufficientShareFundsTheRefund()
	testZS22_refundConsumingAWholeShare()
	testZS24_genericFullRefundOfSplitCharge()
	console.groupEnd()

	console.group('Amazon Charge Inference')
	testAC1_wholeOrderOnOneCharge()
	testAC2_oneChargeOfSeveral()
	testAC3_ambiguousSubsetDeclines()
	testAC4_unpricedOrder()
	testAC5_staleOrderSnapshotResolvedFromLiveHistory()
	testAC6_twoShipmentsEachScopeToTheirOwn()
	testAC7_unpostedSiblingStillResolves()
	testAC8_giftCardOnOneShipment()
	testAC9_discountSpreadOverShipments()
	testAC10_giftCardOnSingleCharge()
	testAC11_incompleteInventoryAbsorbsNothing()
	testAC12_interchangeableItemsDecline()
	testAC13_pricesAreStableAndItemsUnshared()
	console.groupEnd()

	console.group('Reading an item split back')
	testAC14_itemSplitReadsBack()
	testAC15_wholeChargeAllocationCoversEveryItem()
	testAC16_ambiguousSplitDeclines()
	testAC17_amountSplitDeclines()
	testAC18_singleItemChargeIsStillItemWise()
	testAC19_refundSplitNamesTheReturnedItem()
	console.groupEnd()

	console.groupEnd()
}
