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
import {accumulate, asShape, asWeights, consolidate} from '../processors/AmountHistogram'

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

test("mounts, and the title names the reading and the window", async () => {
	await mount()
	expect(screen.getByText("spending")).toBeInTheDocument()
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

test("the default is the SPENDING account, and savings is not folded into it", async () => {
	const ref = await mount()
	expect(ref.current.source()).toBe("__spending__")
	//NOT 3200+12000: a savings balance behind the checking one would hide the trough entirely
	expect(ref.current.anchor()).toBe(3200)
})

test("there are two readings, and the second actualises the cards", async () => {
	const ref = await mount()
	expect(ref.current.sources().map(o => o[1])).toEqual(["spending", "spending net of cards"])
	await act(async () => {ref.current.setState({source: "__netted__"})})
	expect(ref.current.anchor()).toBe(3200 - 800)
})

test("with no credit account there is no second reading to offer", async () => {
	Core.getAccountsWithBalances = () => Promise.resolve(
		[{hash: CHECKING, name: "Checking", type: "depository", subtype: "checking", current: 3200}])
	const ref = await mount()
	expect(ref.current.sources().length).toBe(1)
})

test("a savings account never anchors the picture, whichever reading is on", async () => {
	const ref = await mount()
	expect(ref.current.spendingHashes()).toEqual([CHECKING])
	await act(async () => {ref.current.setState({source: "__netted__"})})
	expect(ref.current.covered().indexOf(SAVINGS)).toBe(-1)
})

test("a bank that reports no balance gives an empty state rather than a plausible wrong line",
	async () => {
		Core.getAccountsWithBalances = () => Promise.resolve(
			[{hash: CHECKING, name: "Checking", type: "depository", current: undefined}])
		await mount()
		expect(screen.getByText("Connect an account to see your balance")).toBeInTheDocument()
	})

/* ---- (b) the cursor names what moved ------------------------------------------------------------ */

test("the cursor reports the balance that day, and nothing else", async () => {
	const ref = await mount()
	await act(async () => {ref.current.setState({at: rentDay})})
	const out = ref.current.subtitle()
	//the balance after the rent went out: 3200 today, +400 and -0 since, +1700 undone
	expect(out).toMatch(/^<b>\$[\d,]+<\/b>$/)
	expect(out).not.toContain("Rent")
})

test("the stream name appears beside a badge only while the cursor is on it", async () => {
	const ref = await mount()
	const svg = () => (ref.current.host.current || {}).innerHTML || ""
	//at rest: no name anywhere
	expect(svg()).not.toContain("Rent")
	//on the badge: the name is drawn next to it
	await act(async () => {ref.current.setState({at: rentDay})})
	expect(svg()).toContain("Rent")
	//on a day with no badge: gone again
	await act(async () => {ref.current.setState({at: quietDay(ref)})})
	expect(svg()).not.toContain("Rent")
})

test("a badge is drawn for a movement over the floor and not for one under it", async () => {
	const ref = await mount()
	const days = ref.current.badgeDays()
	//rent at -1700 and pay at +5000 clear $1,000; the -400 transfer does not
	expect(days.indexOf(dayOf(rentDay))).toBeGreaterThan(-1)
	expect(days.indexOf(dayOf(d(5)))).toBe(-1)
})

const dayOf = x => new Date(x).toISOString().slice(0, 10)
const quietDay = ref => {
	const a = ref.current.series()
	const all = a.past.concat(a.future)
	const busy = ref.current.badgeDays()
	return (all.filter(p => busy.indexOf(dayOf(p.date)) < 0)[2] || all[0]).date
}

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
	const quiet = d(7).toISOString().slice(0,10)  //no transaction in the fixture
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

/* ---- a drifting event is still one event -------------------------------------------------------- */

test("a payday that drifts is forecast as ONE step, not several small ones", () => {
	//twelve months of a semimonthly paycheck, moved off weekends and off a 30th February does not have
	const PAY = 3650
	const txns = []
	for(let m = 0; m < 12; m++){
		[15, 30].forEach(nominal => {
			const dt = new Date(Date.UTC(2025, m, nominal))
			const dow = dt.getUTCDay()
			const day = dow === 0 ? nominal - 2 : (dow === 6 ? nominal - 1 : nominal)
			txns.push({date: new Date(Date.UTC(2025, m, day)), amount: PAY})
		})
	}
	const stream = {id: "w", name: "Wages", getExpectedAmountAtDateByPeriod: () => PAY * 2}
	const out = forecast({terminals: [stream], shapes: {w: histogramOf(txns)}, routing: {},
		now: new Date(Date.UTC(2026, 8, 30)), balanceNow: 0, days: 31, periodName: "monthly"})
	let biggest = 0
	for(let i = 1; i < out.length; i++){biggest = Math.max(biggest, out[i].value - out[i-1].value)}
	//the whole paycheck arrives on one day, not two thirds of it spread over four
	expect(Math.round(biggest)).toBe(PAY)
	//and no money was invented or lost doing it
	expect(Math.round(out[out.length-1].value)).toBe(PAY * 2)
})

test("consolidation moves weight but never creates or destroys it", () => {
	const bins = [0, 0, 300, 900, 200, 0, 0, 0, 0, 0]
	const out = consolidate(bins)
	expect(out.reduce((a, b) => a + b, 0)).toBe(1400)
	expect(out[3]).toBe(1400)          //onto the heaviest day of the run
})

test("the month is a CYCLE, so a payday sliding off the end joins the start", () => {
	//day 31 and day 1 are neighbours: "the 30th" in February lands in March
	const bins = new Array(31).fill(0)
	bins[30] = 800; bins[0] = 400
	const out = consolidate(bins)
	expect(out[30]).toBe(1200)
	expect(out[0]).toBe(0)
})

test("a genuinely diffuse stream is left exactly alone", () => {
	//groceries: every day of the month. Its run spans 31, so nothing collapses.
	const bins = new Array(31).fill(10)
	expect(consolidate(bins)).toEqual(bins)
})

test("two separate paydays stay two separate paydays", () => {
	const bins = new Array(31).fill(0)
	bins[13] = 100; bins[14] = 900      //one drifting event mid-month
	bins[28] = 200; bins[29] = 800      //another at month end
	const out = consolidate(bins)
	expect(out[14]).toBe(1000)
	expect(out[29]).toBe(1000)
	expect(out.filter(b => b > 0).length).toBe(2)
})
