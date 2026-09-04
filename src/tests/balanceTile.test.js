/**
 * balanceTile.test.js — the binding for page three.
 *
 * BankBalance.js has its own arithmetic; this covers the WIRING, which is where a typo costs a blank
 * tile in production and nothing at build time. It mounts the real component against a real
 * CompoundStream and real GenericTransactions, and stubs the one thing that would otherwise reach the
 * network: the live account balances that anchor the whole reconstruction.
 *
 * jsdom has no layout, so the host measures at zero width. That is under test too: a page that is not
 * on screen yet must not throw.
 */
jest.mock('dateformat', () => ({__esModule: true, default: () => ''}))

import React from 'react'
import {render, screen, fireEvent, act} from '@testing-library/react'
import Core from '../core'
import {CompoundStream, GenericTransaction} from '../model'
import BalanceChart from '../components/BalanceChart'
import {histogramOf, reconstruct, forecast, accountRoutingOf, trough} from '../processors/BankBalance'

const HIST = (amount) => [{startDate: new Date("2000-01-01"), amount: amount}]
const leaf = (id, name, amount, extra = {}) => Object.assign(
	{id: id, name: name, period: "monthly", expAmountHistory: HIST(amount)}, extra)
const group = (id, name, children, extra = {}) => Object.assign(
	{id: id, name: name, period: "monthly", children: children}, extra)

const MASTER_JSON = group("master", "Master", [
	group("inc", "Income", [leaf("base", "Base pay", 5100)]),
	group("sav", "Savings", [leaf("buffer", "Buffer", -400, {isSavings: true})], {isSavings: true}),
	group("rec", "Recurring", [leaf("rent", "Rent", -1700), leaf("food", "Food", -600)])
], {isRoot: true})

const CHECKING = "ins::1111::depository"
const CARD = "ins::2222::credit"

let master, txns, accounts

beforeEach(() => {
	master = new CompoundStream(MASTER_JSON)
	Core.globalState = Object.assign({}, Core.globalState, {
		userData: {
			masterStream: master,
			getAllStreams: () => master.getAllStreams(),
			savingAccounts: [],
			preferredCurrency: "USD",
			userPreferences: {}
		}
	})
	accounts = [
		{hash: CHECKING, name: "Checking", type: "depository", current: 3200, available: 3150},
		{hash: CARD, name: "Visa", type: "credit", current: 800, available: 4200}
	]
	//the one reach for the network, stubbed: the anchor the reconstruction hangs from
	Core.getAccountsWithBalances = () => Promise.resolve(accounts)

	const d = n => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString()
	txns = [
		new GenericTransaction(d(9), 5000, "pay", [{streamId: "base", amount: 5000}], CHECKING,
			undefined, undefined, "i1", "t1"),
		new GenericTransaction(d(8), -1700, "rent", [{streamId: "rent", amount: -1700}], CHECKING,
			undefined, undefined, "i2", "t2"),
		new GenericTransaction(d(5), -400, "save", [{streamId: "buffer", amount: -400}], CHECKING,
			undefined, undefined, "i3", "t3"),
		//food lives on the card, which is what the routing must DISCOVER rather than be told
		new GenericTransaction(d(4), -250, "food", [{streamId: "food", amount: -250}], CARD,
			undefined, undefined, "i4", "t4"),
		new GenericTransaction(d(2), -300, "food2", [{streamId: "food", amount: -300}], CARD,
			undefined, undefined, "i5", "t5")
	]
})

const mount = async () => {
	const ref = React.createRef()
	await act(async () => {
		render(<BalanceChart ref={ref} stream={master} transactions={txns}/>)
	})
	return ref
}

test("mounts, and the title says which reading and which window", async () => {
	await mount()
	expect(screen.getByText("in the bank")).toBeInTheDocument()
	expect(screen.getByText("this month")).toBeInTheDocument()
})

test("the two words in the title are the controls", async () => {
	await mount()
	await act(async () => {fireEvent.click(screen.getByText("this month"))})
	expect(screen.getByText("these two weeks")).toBeInTheDocument()
	await act(async () => {fireEvent.click(screen.getByText("in the bank"))})
	expect(screen.getByText("after cards")).toBeInTheDocument()
})

test("the window list holds no period longer than a month", async () => {
	const ref = await mount()
	//cycling must return to the start after exactly three, and never widen past 30 days
	const seen = []
	for(let i = 0; i < 4; i++){
		seen.push(ref.current.state.days)
		await act(async () => {fireEvent.click(screen.getByText(
			["this month", "these two weeks", "this week"][i % 3]))})
	}
	expect(seen).toEqual([30, 15, 7, 30])
	expect(Math.max.apply(null, seen)).toBe(30)
})

test("the anchor is the depository balance, and the netted reading subtracts what the card owes",
	async () => {
		const ref = await mount()
		expect(ref.current.anchor()).toBe(3200)
		await act(async () => {ref.current.setState({mode: "true"})})
		expect(ref.current.anchor()).toBe(3200 - 800)
	})

test("a bank that reports no balance gives an empty state rather than a plausible wrong line",
	async () => {
		Core.getAccountsWithBalances = () => Promise.resolve(
			[{hash: CHECKING, name: "Checking", type: "depository", current: undefined}])
		await mount()
		expect(screen.getByText("Connect an account to see your balance")).toBeInTheDocument()
	})

test("which streams sit on the card is discovered from the ledger, not declared", async () => {
	const ref = await mount()
	const routing = ref.current.routing()
	expect(routing.food).toBe(true)     //both its transactions landed on the card
	expect(routing.rent).toBe(false)    //its did not
	expect(routing.base).toBe(false)
})

test("the reconstruction ends at exactly the reported balance", async () => {
	const ref = await mount()
	const s = ref.current.series()
	const last = s.past[s.past.length - 1]
	expect(Math.round(last.value)).toBe(3200)
})

test("a month of a monthly expectation is forecast ONCE, not once per month of history", () => {
	//the ×12 fault: bins are day-of-month and already sum to 1 over a month, so scaling by the number
	//of aggregated months forecasts every stream that many times over
	const s = {id: "r", name: "Rent", getExpectedAmountAtDateByPeriod: () => -3000}
	const shape = histogramOf([
		{date: "2026-04-01", amount: -3000}, {date: "2026-05-01", amount: -3000},
		{date: "2026-06-01", amount: -3000}])
	const out = forecast({terminals: [s], shapes: {r: shape}, routing: {},
		now: new Date(Date.UTC(2026, 8, 30)), balanceNow: 0, days: 31, mode: "account",
		periodName: "monthly"})
	expect(Math.round(out[out.length - 1].value)).toBe(-3000)
})

test("a stream with no history falls back to a flat month rather than to nothing", () => {
	const empty = histogramOf([])
	expect(empty.any).toBe(false)
	const s = {id: "x", name: "New", getExpectedAmountAtDateByPeriod: () => -310}
	const out = forecast({terminals: [s], shapes: {x: empty}, routing: {},
		now: new Date(Date.UTC(2026, 8, 30)), balanceNow: 0, days: 31, mode: "account",
		periodName: "monthly"})
	expect(Math.round(out[out.length - 1].value)).toBe(-310)
})

test("stepping back over a day undoes exactly that day", () => {
	const now = new Date("2026-09-04T00:00:00Z")
	const r = reconstruct([{date: "2026-09-03", amount: -100}], now, 1000,
		new Date("2026-09-01T00:00:00Z"))
	expect(r[0].value).toBe(1100)
	expect(r[r.length - 1].value).toBe(1000)
})

test("a single stray transaction does not move a stream off the account it lives on", () => {
	const routing = accountRoutingOf({
		netflix: [{accountHash: "visa", amount: -15}, {accountHash: "visa", amount: -15},
			{accountHash: "chk", amount: -15}],
		rent: [{accountHash: "chk", amount: -2000}, {accountHash: "visa", amount: -20}]
	}, ["visa"])
	expect(routing.netflix).toBe(true)
	expect(routing.rent).toBe(false)
})
