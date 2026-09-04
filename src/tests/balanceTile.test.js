/**
 * balanceTile.test.js — the binding for page three.
 *
 * BankBalance.js has its own arithmetic; this covers the WIRING, which is where a typo costs a blank
 * tile in production and nothing at build time. It mounts the real component against a real
 * CompoundStream and real GenericTransactions, and stubs the one thing that would otherwise reach the
 * network: the live account balances that anchor the whole reconstruction.
 *
 * jsdom has no layout, so the host measures at zero width and keeps its default. That is under test
 * too: a page that is not on screen yet must not throw.
 */
jest.mock('dateformat', () => ({__esModule: true, default: () => ''}))

import React from 'react'
import {render, screen, fireEvent, act} from '@testing-library/react'
import Core from '../core'
import {CompoundStream, GenericTransaction} from '../model'
import BalanceChart from '../components/BalanceChart'
import {histogramOf, reconstruct, forecast, accountRoutingOf} from '../processors/BankBalance'
import {accumulate, asShape, asWeights} from '../processors/AmountHistogram'

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
const SAVINGS = "ins::3333::depository"
const CARD = "ins::2222::credit"

let master, txns, accounts, rentDay

const d = n => new Date(Date.now() - n * 24 * 3600 * 1000)

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
	//two spendable accounts on purpose: the savings balance is the one that must NOT be silently
	//folded into the checking one
	accounts = [
		{hash: CHECKING, name: "Checking", type: "depository", subtype: "checking", current: 3200},
		{hash: SAVINGS, name: "Savings", type: "depository", subtype: "savings", current: 12000},
		{hash: CARD, name: "Visa", type: "credit", subtype: "credit card", current: 800}
	]
	Core.getAccountsWithBalances = () => Promise.resolve(accounts)

	rentDay = d(8)
	txns = [
		new GenericTransaction(d(9).toISOString(), 5000, "pay",
			[{streamId: "base", amount: 5000}], CHECKING, undefined, undefined, "i1", "t1"),
		new GenericTransaction(rentDay.toISOString(), -1700, "rent",
			[{streamId: "rent", amount: -1700}], CHECKING, undefined, undefined, "i2", "t2"),
		new GenericTransaction(d(5).toISOString(), -400, "save",
			[{streamId: "buffer", amount: -400}], CHECKING, undefined, undefined, "i3", "t3"),
		//food lives on the card, which the routing must DISCOVER rather than be told
		new GenericTransaction(d(4).toISOString(), -250, "food",
			[{streamId: "food", amount: -250}], CARD, undefined, undefined, "i4", "t4"),
		new GenericTransaction(d(2).toISOString(), -300, "food2",
			[{streamId: "food", amount: -300}], CARD, undefined, undefined, "i5", "t5")
	]
})

const mount = async () => {
	const ref = React.createRef()
	await act(async () => {render(<BalanceChart ref={ref} stream={master} transactions={txns}/>)})
	return ref
}

/* ---- the title -------------------------------------------------------------------------------- */

test("mounts, and the title names the account and the window", async () => {
	await mount()
	expect(screen.getByText("in Checking")).toBeInTheDocument()
	expect(screen.getByText("this month")).toBeInTheDocument()
})

test("the windows are a month and a quarter, and nothing shorter", async () => {
	const ref = await mount()
	const seen = []
	for(let i = 0; i < 3; i++){
		seen.push(ref.current.state.days)
		await act(async () => {fireEvent.click(screen.getByText(
			["this month", "this quarter"][i % 2]))})
	}
	expect(seen).toEqual([30, 91, 30])
	expect(Math.min.apply(null, seen)).toBe(30)
})

/* ---- (a) which money am I looking at ------------------------------------------------------------ */

test("the default is the CHECKING account alone, not everything combined", async () => {
	const ref = await mount()
	expect(ref.current.source()).toBe(CHECKING)
	expect(ref.current.anchor()).toBe(3200)   //NOT 3200+12000: savings must not pad the runway
})

test("the source list offers each account, then combined, then netted", async () => {
	const ref = await mount()
	expect(ref.current.sources().map(o => o[1]))
		.toEqual(["in Checking", "in Savings", "in all accounts", "after cards"])
})

test("each source anchors on its own money", async () => {
	const ref = await mount()
	const anchorFor = async src => {
		await act(async () => {ref.current.setState({source: src})})
		return ref.current.anchor()
	}
	expect(await anchorFor(SAVINGS)).toBe(12000)
	expect(await anchorFor("__all__")).toBe(3200 + 12000)
	expect(await anchorFor("__netted__")).toBe(3200 + 12000 - 800)
})

test("a lone account offers no choice the user does not have", async () => {
	Core.getAccountsWithBalances = () => Promise.resolve(
		[{hash: CHECKING, name: "Checking", type: "depository", subtype: "checking", current: 3200}])
	const ref = await mount()
	expect(ref.current.sources().length).toBe(1)
})

test("a bank that reports no balance gives an empty state rather than a plausible wrong line",
	async () => {
		Core.getAccountsWithBalances = () => Promise.resolve(
			[{hash: CHECKING, name: "Checking", type: "depository", current: undefined}])
		await mount()
		expect(screen.getByText("Connect an account to see your balance")).toBeInTheDocument()
	})

/* ---- (b) the cursor names what moved ------------------------------------------------------------ */

test("the cursor names the stream behind the step, on an ordinary day", async () => {
	const ref = await mount()
	await act(async () => {ref.current.setState({at: rentDay})})
	const sub = ref.current.subtitle()
	expect(sub).toContain("Rent")
	expect(sub).toContain("1,700")
})

test("the step at a day equals that day's movement and nothing else", async () => {
	const ref = await mount()
	const a = ref.current.series()
	const all = a.past.concat(a.future)
	let i = -1
	all.forEach((p, k) => {if(p.date.toISOString().slice(0,10) === rentDay.toISOString().slice(0,10))i = k})
	const m = ref.current.movementAt(all, i, ref.current.ledger())
	expect(Math.round(m.step)).toBe(-1700)
	expect(m.stream).toBe("Rent")
})

test("a day where nothing happened reports no movement rather than a wrong stream", async () => {
	const ref = await mount()
	const a = ref.current.series()
	const all = a.past.concat(a.future)
	//day 7 back has no transaction in the fixture
	const quiet = d(7).toISOString().slice(0,10)
	let i = -1
	all.forEach((p, k) => {if(p.date.toISOString().slice(0,10) === quiet)i = k})
	const m = ref.current.movementAt(all, i, ref.current.ledger())
	expect(m.step).toBe(0)
	expect(m.stream).toBe(null)
})

/* ---- (c) the subtitle says one thing ------------------------------------------------------------ */

test("at rest the subtitle reports the low point and nothing else", async () => {
	const ref = await mount()
	const sub = ref.current.subtitle()
	expect(sub).toContain("low")
	expect(sub).not.toContain("–")     //no date range as well
})

/* ---- routing ------------------------------------------------------------------------------------ */

test("a stream is routed to the account its money actually landed on", async () => {
	const ref = await mount()
	const routing = ref.current.routing()
	expect(routing.food).toBe(CARD)
	expect(routing.rent).toBe(CHECKING)
	expect(routing.base).toBe(CHECKING)
})

test("a single stray transaction does not move a stream off the account it lives on", () => {
	const routing = accountRoutingOf({
		netflix: [{accountHash: "visa", amount: -15}, {accountHash: "visa", amount: -15},
			{accountHash: "chk", amount: -15}],
		rent: [{accountHash: "chk", amount: -2000}, {accountHash: "visa", amount: -20}],
		unseen: []
	})
	expect(routing.netflix).toBe("visa")
	expect(routing.rent).toBe("chk")
	expect(routing.unseen).toBe(undefined)
})

/* ---- the arithmetic that was expensive to get right --------------------------------------------- */

test("a month of a monthly expectation is forecast ONCE, not once per month of history", () => {
	const s = {id: "r", name: "Rent", getExpectedAmountAtDateByPeriod: () => -3000}
	const shape = histogramOf([
		{date: "2026-04-01", amount: -3000}, {date: "2026-05-01", amount: -3000},
		{date: "2026-06-01", amount: -3000}])
	const out = forecast({terminals: [s], shapes: {r: shape}, routing: {},
		now: new Date(Date.UTC(2026, 8, 30)), balanceNow: 0, days: 31, periodName: "monthly"})
	expect(Math.round(out[out.length - 1].value)).toBe(-3000)
})

test("a stream with no history falls back to a flat month rather than to nothing", () => {
	const empty = histogramOf([])
	expect(empty.any).toBe(false)
	const s = {id: "x", name: "New", getExpectedAmountAtDateByPeriod: () => -310}
	const out = forecast({terminals: [s], shapes: {x: empty}, routing: {},
		now: new Date(Date.UTC(2026, 8, 30)), balanceNow: 0, days: 31, periodName: "monthly"})
	expect(Math.round(out[out.length - 1].value)).toBe(-310)
})

test("stepping back over a day undoes exactly that day", () => {
	const now = new Date("2026-09-04T00:00:00Z")
	const r = reconstruct([{date: "2026-09-03", amount: -100}], now, 1000,
		new Date("2026-09-01T00:00:00Z"))
	expect(r[0].value).toBe(1100)
	expect(r[r.length - 1].value).toBe(1000)
})

/* ---- the shared histogram ------------------------------------------------------------------------ */

test("the two normalisations are different, and that difference is the whole point", () => {
	//same bins: one big day, one small. asShape fills the height; asWeights sums to one.
	const bins = accumulate([{d: 0, a: -300}, {d: 1, a: -100}], o => o.d, o => o.a, 4)
	expect(bins).toEqual([300, 100, 0, 0])
	expect(asShape(bins)).toEqual([1, 1/3, 0, 0])
	const w = asWeights(bins)
	expect(w.weights.reduce((x, y) => x + y, 0)).toBeCloseTo(1)
	expect(w.any).toBe(true)
	//a shape used as weights would multiply the period's money by 4/3 - which is the fault
	expect(asShape(bins).reduce((x, y) => x + y, 0)).toBeCloseTo(4/3)
})

test("a bin index outside the array is dropped, not folded into an edge", () => {
	expect(accumulate([{d: -1, a: 5}, {d: 9, a: 5}, {d: 1, a: 7}], o => o.d, o => o.a, 3))
		.toEqual([0, 7, 0])
})
