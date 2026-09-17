/**
 * balanceReadout.test.js — the instrument reads the same numbers the tile draws.
 *
 * Its whole value is being trustworthy when the tile is under suspicion, so the thing worth asserting
 * is the arithmetic itself: today is the anchor, the last closed day is that less what posted today,
 * and the transactions named are the ones that bridge them. A panel that re-derives any of those
 * differently from the tile would answer "the balance went rogue" with a second opinion, which is the
 * failure it exists to prevent.
 */
jest.mock('dateformat', () => ({__esModule: true, default: () => ''}))

import React from 'react'
import {render, act, cleanup} from '@testing-library/react'
import Core from '../core'
import ApiCaller from '../ApiCaller'
import BalanceReadout from '../components/BalanceReadout'
import {AccountTypes} from '../Bank'

const DAY = 86400000
const CHK = "ins::1111::depository", SAV = "ins::2222::depository", CARD = "ins::3333::credit"
//the tile's own day boundary
const utcMidnight = () => {const n = new Date()
	return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()))}
const at = (day, ms) => new Date(utcMidnight().getTime() - day*DAY + (ms || 0))
/* PLAIN ROWS, ON PURPOSE. The panel reads five fields off a transaction and nothing else; building
   real GenericTransactions here would drag the evaluator and a whole stream tree into a test about
   arithmetic, and would test the model rather than the instrument. */
const txn = (day, amount, desc, acct, frontendDate) => ({
	date: at(day, 12*3600*1000), amount: amount, description: desc,
	userInstitutionAccountId: acct || CHK,
	frontendDate: frontendDate ? new Date(frontendDate) : undefined
})

const ACCOUNTS = [
	{hash: CHK, name: "Spending", mask: "1111", type: "depository", current: 692.13, available: 692.13},
	{hash: SAV, name: "Savings", mask: "2222", type: "depository", current: 36347.69},
	{hash: CARD, name: "Card", mask: "3333", type: "credit", current: 554.21}
]

beforeEach(() => {
	cleanup()
	Core.globalState = Object.assign({}, Core.globalState, {
		userData: {savingAccounts: [], preferredCurrency: "USD", userPreferences: {},
			getAllStreams: () => []}
	})
})

const mount = async (txns) => {
	Core.getAccountsWithBalances = () => Promise.resolve(ACCOUNTS)
	ApiCaller.getBalanceHistory = () => Promise.resolve([])
	ApiCaller.bankGetRawAccountsForUser = () => Promise.resolve([])
	Core.accountTypeOf = a => a.hash === SAV ? AccountTypes.savings
		: (a.hash === CARD ? AccountTypes.credit : AccountTypes.checking)
	const ref = React.createRef()
	await act(async () => {render(<BalanceReadout ref={ref} transactions={txns}/>)})
	return ref
}
const text = () => document.body.textContent

test("today is the anchor, and only the spending account is in it", async () => {
	await mount([])
	//not 692.13 + 36347.69: savings is not a runway, and a card is not money you have
	expect(text()).toContain("$692.13")
	expect(text()).not.toContain("$37,039.82")
})

test("the last closed day is today less what posted today, on the named transactions", async () => {
	/* THE ONE PIECE OF ARITHMETIC THE WHOLE PANEL IS FOR. Two postings today, one either sign, so a
	   sum that silently took absolute values or dropped a sign would not survive. */
	const ref = await mount([
		txn(0, -1700, "Check Paid #1050"),
		txn(0, 7.5, "Expensify"),
		txn(1, -250, "Yesterday only"),
		txn(0, -99, "On the card, not counted", CARD)
	])
	const c = ref.current
	expect(c.anchor()).toBeCloseTo(692.13, 6)
	//692.13 - (-1700 + 7.50) = 2384.63
	expect(text()).toContain("$2,384.63")
	expect(text()).toContain("Check Paid #1050")
	expect(text()).toContain("Expensify")
	//the card's posting is on an account the reading does not cover, so it is not in the bridge
	expect(text()).not.toContain("On the card, not counted")
	//and the closed day's own movement is shown for what it is
	expect(text()).toContain("Yesterday only")
})

test("with nothing posted today the two figures are the same number, and it says so", async () => {
	await mount([txn(1, -250, "Yesterday only")])
	expect(text()).toContain("nothing has posted today")
})

test("the panel covers only what the tile covers, so its ledger is the tile's ledger", async () => {
	const ref = await mount([
		txn(0, -10, "spending", CHK), txn(0, -20, "savings", SAV), txn(0, -30, "card", CARD)
	])
	expect(ref.current.ledger().length).toBe(1)
	expect(ref.current.ledger()[0].description).toBe("spending")
})

test("a transaction the reader would date differently is flagged, not silently walked", async () => {
	/* getDisplayDate() prefers frontendDate; the walk uses date. Where they differ the reader sees a
	   posting on one day and the line steps on another - which is exactly what "the balance went
	   rogue" looks like from the outside, so the panel has to name it rather than average over it. */
	const backdated = txn(0, -500, "Backdated", CHK, at(3).toISOString())
	await mount([backdated])
	expect(text()).toContain("shown " + at(3).toISOString().slice(0, 10))
})

test("a day only some accounts reported is not an observation, so it is not compared", async () => {
	/* A sum missing an account is a different quantity from a sum containing it. Comparing the two
	   would manufacture a gap on the day an account started reporting - a rogue balance invented by
	   the instrument built to find them. */
	Core.getAccountsWithBalances = () => Promise.resolve(ACCOUNTS)
	Core.accountTypeOf = a => a.hash === SAV ? AccountTypes.savings
		: (a.hash === CARD ? AccountTypes.credit : AccountTypes.checking)
	ApiCaller.bankGetRawAccountsForUser = () => Promise.resolve([])
	//two spending accounts now, and only one of them reported that day
	const two = ACCOUNTS.concat([{hash: "ins::4444::depository", name: "Second", mask: "4444",
		type: "depository", current: 100}])
	Core.getAccountsWithBalances = () => Promise.resolve(two)
	ApiCaller.getBalanceHistory = () => Promise.resolve(
		[{accountHash: CHK, date: at(1).toISOString(), current: 500}])
	const ref = React.createRef()
	await act(async () => {render(<BalanceReadout ref={ref} transactions={[]}/>)})
	expect(Object.keys(ref.current.observedByDay()).length).toBe(0)
})

test("the raw Plaid response is shown cached against a forced fresh read, and the gap between them", async () => {
	/* THE POINT OF THE WHOLE PANEL. cached is /accounts/get - what every balance in this app is built
	   from; fresh is /accounts/balance/get - a forced call to the institution. A reader comparing the
	   two on screen is the thing this instrument exists to make possible. */
	const ref = await mount([])
	await act(async () => {ref.current.updateState({raw: [{
		itemId: "item1", institutionId: "ins_25", connector: "plaid",
		raw: {
			cached: {accounts: [{account_id: "a1", name: "Spending", mask: "4759",
				balances: {current: 2392.13, available: 2392.13}}]},
			fresh: {accounts: [{account_id: "a1", name: "Spending", mask: "4759",
				balances: {current: 692.13, available: 692.13}}]}
		}
	}]})})
	expect(text()).toContain("$2,392.13")
	expect(text()).toContain("$692.13")
	//the gap itself, flagged - the whole reason to run both
	expect(text()).toContain("$1,700.00")
})

test("a connector with no raw response says so, rather than crashing on a shape it does not have", async () => {
	const ref = await mount([])
	await act(async () => {ref.current.updateState({raw: [{
		itemId: "item2", institutionId: "ins_99", connector: "powens",
		raw: {unsupported: true, connector: "powens"}
	}]})})
	expect(text()).toContain("not a Plaid connection")
})

test("a second checking-typed account is named, not silently netted into the anchor", async () => {
	/* THE ACTUAL FIX. "anchor is wrong" was diagnosed live as "which transactions are subtracted",
	   which is structurally impossible - reconstruct() seeds today at the anchor with nothing taken
	   off. The real cause is an account the reader was not counting on being typed checking too. This
	   makes that visible instead of requiring it to be inferred from a bare type column. */
	Core.getAccountsWithBalances = () => Promise.resolve(ACCOUNTS.concat([
		{hash: "ins::5555::depository", name: "Second Checking", mask: "5555",
			type: "depository", current: -2500}
	]))
	Core.accountTypeOf = a => a.hash === SAV ? AccountTypes.savings
		: (a.hash === CARD ? AccountTypes.credit : AccountTypes.checking)
	ApiCaller.getBalanceHistory = () => Promise.resolve([])
	ApiCaller.bankGetRawAccountsForUser = () => Promise.resolve([])
	const ref = React.createRef()
	await act(async () => {render(<BalanceReadout ref={ref} transactions={[]}/>)})
	expect(ref.current.anchor()).toBeCloseTo(692.13 - 2500, 6)
	expect(text()).toContain("Second Checking")
	expect(text()).toContain("2 accounts")
	expect(text()).toContain("+ spending")
})

test("stored snapshots are shown per account, current beside available - a sum hides which account", async () => {
	/* THE LIVE FINDING THIS WAS ADDED FOR. A ~$2,000 gap sat on the summed total every single day and
	   never closed; a summed total cannot say whether that is one account stuck, two accounts each
	   off by half, or a pending hold. This is the breakdown that can. */
	const ref = await mount([])
	await act(async () => {ref.current.updateState({snaps: [
		{accountHash: CHK, date: at(0).toISOString(), current: 5959.22, available: 3959.22},
		{accountHash: CHK, date: at(1).toISOString(), current: 5959.22, available: 3959.22}
	]})})
	const rows = ref.current.rawSnapshots()
	expect(rows.length).toBe(2)
	expect(rows[0].current).toBe(5959.22)
	expect(rows[0].available).toBe(3959.22)
	//current minus available is the pending-hold question, spelled out rather than left to be noticed
	expect(text()).toContain("$2,000.00")
	expect(text()).toContain("Spending")
})

test("this panel's own 'today' is also read in the account's timezone, not UTC", async () => {
	/* SAME BUG, SAME FIX, IN THE OTHER PLACE IT WAS COPIED TO. The panel exists to catch a
	   disagreement between what the tile shows and the truth; it cannot do that while it carries the
	   very timezone bug that produced the disagreement in the first place. */
	const RealDate = Date
	const realNow = new RealDate(RealDate.UTC(2026, 8, 17, 2, 36))
	global.Date = class extends RealDate{
		constructor(...args){super(...(args.length ? args : [realNow.getTime()]))}
		static now(){return realNow.getTime()}
	}
	try{
		Core.globalState.userData.timeZoneOffset = -7
		const ref = await mount([])
		//the READ instant legitimately carries the 17th (it is an ISO timestamp, not a day judgement);
		//"today" itself must not
		expect(text()).toContain("today 2026-09-16")
		expect(text()).toContain("last closed 2026-09-15")
		expect(text()).not.toContain("today 2026-09-17")
	}finally{
		global.Date = RealDate
	}
})
