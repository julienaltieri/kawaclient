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
import {accumulate, asShape, asWeights, consolidate, detectCycle, concentration, CYCLES}
	from '../processors/AmountHistogram'

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

test("the window is a month, and the choice is which one", async () => {
	const ref = await mount()
	expect(ref.current.state.when).toBe("this")
	await act(async () => {fireEvent.click(screen.getByText("this month"))})
	expect(screen.getByText("last month")).toBeInTheDocument()
	await act(async () => {fireEvent.click(screen.getByText("last month"))})
	expect(screen.getByText("this month")).toBeInTheDocument()
})

test("last month is THIS window moved back exactly one month", async () => {
	const ref = await mount()
	const all = ref.current.allSeries()
	const span = a => {const s = a.past.concat(a.future)
		return {from: s[0].date, to: s[s.length-1].date}}
	const here = span(all.this), back = span(all.last)

	//same width: the motion is a pure translation, not a resize
	expect(Math.round((here.to - here.from)/86400000))
		.toBe(Math.round((back.to - back.from)/86400000))
	//and both ends moved back by one calendar month
	const monthBefore = d => {
		const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).getUTCDate()
		return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()-1,
			Math.min(d.getUTCDate(), lastDay)))
	}
	expect(back.from.getTime()).toBe(monthBefore(here.from).getTime())
	expect(back.to.getTime()).toBe(monthBefore(here.to).getTime())
})

test("the shifted window is entirely settled, so nothing in it is projected", async () => {
	const ref = await mount()
	await act(async () => {ref.current.setState({when: "last"})})
	const a = ref.current.series()
	expect(a.future.length).toBe(0)
	expect(a.past.every(p => p.actual)).toBe(true)
})

test("a settled month draws no today line and no dashed projection", async () => {
	const ref = await mount()
	await act(async () => {ref.current.setState({when: "last"})})
	const svg = (ref.current.host.current || {}).innerHTML || ""
	expect(svg).not.toContain("stroke-dasharray=\"" + "3,2.5")
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

/* ---- which cycle is a stream on --------------------------------------------------------------- */

const everyN = (startY, startM, startD, n, count, amount) => {
	const out = []
	for(let i = 0; i < count; i++){
		const d = new Date(Date.UTC(startY, startM, startD))
		d.setUTCDate(d.getUTCDate() + n*i)
		out.push({date: d, amount: amount})
	}
	return out
}
const dOf = t => t.date, aOf = t => t.amount

test("a weekly bill is recognised as weekly, not smeared across the month", () => {
	const weekly = everyN(2025, 0, 6, 7, 52, -400)      //every Monday for a year
	expect(detectCycle(weekly, dOf, aOf).name).toBe("weekly")
	//binned by day-of-month it would look almost perfectly diffuse, which is the fault
	const asMonth = accumulate(weekly, t => t.date.getUTCDate()-1, aOf, 31)
	expect(asMonth.filter(b => b > 0).length).toBeGreaterThan(20)
})

test("a fortnightly stream is NOT collapsed into a weekly one", () => {
	//every other Friday lands on a Friday every time, so "weekly" fits it perfectly too - the
	//longer cycle has to win that tie or the forecast draws four half payments instead of two
	const biweekly = everyN(2025, 0, 3, 14, 26, -800)
	expect(detectCycle(biweekly, dOf, aOf).name).toBe("biweekly")
})

test("a monthly stream stays monthly, and a diffuse one falls back to monthly", () => {
	const monthly = []
	for(let m = 0; m < 12; m++)monthly.push({date: new Date(Date.UTC(2025, m, 3)), amount: -1733})
	expect(detectCycle(monthly, dOf, aOf).name).toBe("monthly")

	const daily = []
	for(let m = 0; m < 12; m++)for(let k = 1; k <= 28; k++){
		daily.push({date: new Date(Date.UTC(2025, m, k)), amount: -25})}
	expect(detectCycle(daily, dOf, aOf).name).toBe("monthly")
})

test("two observations are enough when they AGREE with a known cycle", () => {
	//a day-care bill enrolled in September has two payments by November and is not mysterious:
	//the same day-of-month twice is a one-in-thirty-one coincidence, which is real evidence
	const twice = [{date: new Date(Date.UTC(2026, 6, 5)), amount: -1700},
		{date: new Date(Date.UTC(2026, 7, 5)), amount: -1700}]
	expect(detectCycle(twice, dOf, aOf).name).toBe("monthly")
	const h = histogramOf(twice)
	//and the whole month lands on that day rather than being spread over the month
	expect(Math.max.apply(null, h.weights)).toBeCloseTo(1, 5)
})

test("confidence scales with the count: 2 same weekdays is not a week, 3 is", () => {
	//two payments agreeing on a weekday is 1-in-7 and means little; three is 1-in-49
	expect(detectCycle(everyN(2026, 6, 6, 7, 2, -400), dOf, aOf).name).toBe("monthly")
	expect(detectCycle(everyN(2026, 6, 6, 7, 3, -400), dOf, aOf).name).toBe("weekly")
})

test("a short history falls back rather than committing", () => {
	//a single week of data has only ever watched a full turn of ONE candidate, and taking that
	//candidate for that reason put brand-new streams straight onto "weekly"
	expect(detectCycle(everyN(2026, 6, 6, 1, 2, -50), dOf, aOf).name).toBe("monthly")
	expect(detectCycle([], dOf, aOf).name).toBe("monthly")
	expect(detectCycle([{date: new Date(Date.UTC(2026, 6, 5)), amount: -10}], dOf, aOf).name)
		.toBe("monthly")
})

test("a single payment still places the whole month on its day", () => {
	//nothing else is known, and spreading it flat would make a brand-new bill invisible
	const once = [{date: new Date(Date.UTC(2026, 7, 5)), amount: -1700}]
	const h = histogramOf(once)
	expect(h.any).toBe(true)
	expect(h.weights[4]).toBeCloseTo(1, 5)
})

test("concentration is comparable across bin counts", () => {
	//two observations scattered over many bins must not out-score two over few: the correction for
	//how much concentration randomness hands out for free is the whole point
	const wide = new Array(31).fill(0); wide[2] = 1; wide[20] = 1
	const narrow = new Array(7).fill(0); narrow[1] = 1; narrow[5] = 1
	expect(concentration(wide, 2)).toBeCloseTo(0, 1)
	expect(concentration(narrow, 2)).toBeCloseTo(0, 1)
	//all on one bin is a perfect fit whatever the bin count
	const one = new Array(7).fill(0); one[3] = 10
	expect(concentration(one, 20)).toBeCloseTo(1, 5)
})

test("a weekly stream is forecast as weekly steps carrying the right monthly total", () => {
	const weekly = everyN(2025, 0, 6, 7, 52, -400)
	const h = histogramOf(weekly)
	expect(h.cycle.name).toBe("weekly")
	const s = {id: "dc", name: "Day care", getExpectedAmountAtDateByPeriod: () => -400*52/12}
	const out = forecast({terminals: [s], shapes: {dc: h}, routing: {},
		now: new Date(Date.UTC(2026, 8, 30)), balanceNow: 0, days: 31, periodName: "monthly"})
	const steps = []
	for(let i = 1; i < out.length; i++){
		const st = out[i].value - out[i-1].value
		if(Math.abs(st) > 1)steps.push(Math.round(st))
	}
	//four or five Mondays in the window, each carrying a whole week of the bill - not 30 crumbs
	expect(steps.length).toBeGreaterThanOrEqual(4)
	expect(steps.length).toBeLessThanOrEqual(5)
	steps.forEach(st => expect(Math.abs(st)).toBeGreaterThan(350))
})

/* ---- a transfer is routed by the leg that LEAVES ------------------------------------------------ */

test("a paired transfer to savings is routed to the account the money left", () => {
	//both legs carry the same stream allocation because they are one act, and they are equal in
	//magnitude - so weighed by size alone the winner is whichever the ledger listed first, and when
	//that was the savings side the stream vanished from the spending forecast entirely
	const legs = []
	for(let m = 0; m < 12; m++){
		const d = new Date(Date.UTC(2025, m, 13))
		legs.push({date: d, amount: -4000, accountHash: "chk"})
		legs.push({date: d, amount:  4000, accountHash: "sav"})
	}
	const outward = () => -1     //a savings transfer expects money OUT
	expect(accountRoutingOf({t: legs}, outward).t).toBe("chk")
	expect(accountRoutingOf({t: legs.slice().reverse()}, outward).t).toBe("chk")
	//without a direction it is order dependent, which is the fault
	expect(accountRoutingOf({t: legs.slice().reverse()}).t).toBe("sav")
})

test("a stream whose legs all point the wrong way is still placed somewhere", () => {
	//no leg matches the expected direction, so every leg counts rather than none
	const legs = [{date: new Date(Date.UTC(2025, 0, 5)), amount: 500, accountHash: "chk"}]
	expect(accountRoutingOf({t: legs}, () => -1).t).toBe("chk")
})

/* ---- both months are built once, and the toggle only chooses ------------------------------------ */

test("both months are prerendered, and switching does not rebuild either", async () => {
	const ref = await mount()
	const c = ref.current
	//force the first build, then count every rebuild from here
	c.allSeries()
	let builds = 0
	const real = c.computeSeries.bind(c)
	c.computeSeries = w => {builds++; return real(w)}

	//the cache already holds both, so asking for either costs nothing
	expect(c.series("this")).toBeTruthy()
	expect(c.series("last")).toBeTruthy()
	expect(builds).toBe(0)

	//and neither does switching between them
	await act(async () => {fireEvent.click(screen.getByText("this month"))})
	expect(screen.getByText("last month")).toBeInTheDocument()
	expect(builds).toBe(0)
})

test("the cache is dropped when the reading changes, and not before", async () => {
	const ref = await mount()
	const c = ref.current
	c.allSeries()
	let builds = 0
	const real = c.computeSeries.bind(c)
	c.computeSeries = w => {builds++; return real(w)}

	//a re-render on its own must not invalidate anything
	await act(async () => {c.forceUpdate()})
	c.allSeries()
	expect(builds).toBe(0)

	//a different reading is different money, so both months are rebuilt
	await act(async () => {c.setState({source: "__netted__"})})
	c.allSeries()
	expect(builds).toBe(2)
})

test("the two prerendered months really are different windows", async () => {
	const ref = await mount()
	const all = ref.current.allSeries()
	const endOf = a => a.past.concat(a.future).slice(-1)[0].date.getTime()
	expect(endOf(all.last)).toBeLessThan(endOf(all.this))
	expect(all.last.future.length).toBe(0)
	expect(all.this.future.length).toBeGreaterThan(0)
})

/* ---- the travel between the two months ---------------------------------------------------------- */

test("the animation content spans BOTH windows, so nothing sweeps across empty space", async () => {
	const ref = await mount()
	const c = ref.current
	const all = c.allSeries()
	const merged = c.union(all.this, all.last)
	const day = x => new Date(x).toISOString().slice(0, 10)
	const firstOf = a => day(a.past.concat(a.future)[0].date)
	const lastOf = a => {const s = a.past.concat(a.future); return day(s[s.length-1].date)}

	//last month starts before this month's window, and this month ends after last month's
	expect(day(merged[0].date)).toBe(firstOf(all.last))
	expect(day(merged[merged.length-1].date)).toBe(lastOf(all.this))
	//and it is contiguous - one point per day, no hole where the two windows meet
	for(let i = 1; i < merged.length; i++){
		const gap = (merged[i].date - merged[i-1].date)/86400000
		expect(Math.round(gap)).toBe(1)
	}
})

test("where the two windows overlap, the record wins over the projection", async () => {
	const ref = await mount()
	const c = ref.current
	const all = c.allSeries()
	const merged = c.union(all.this, all.last)
	const now = c.ledgerToday()
	//every day at or before today is a record, whichever window contributed it
	merged.filter(p => p.date <= now).forEach(p => expect(p.actual).toBe(true))
})

test("the animation lands exactly on the destination frame", async () => {
	const ref = await mount()
	const c = ref.current
	const all = c.allSeries()
	const f0 = c.frameOf(all.this), f1 = c.frameOf(all.last)
	//at k=1 there must be nothing left to snap: a frame that is merely close still pops
	expect(c.lerpFrame(f0, f1, 1)).toEqual(f1)
	expect(c.lerpFrame(f0, f1, 0)).toEqual(f0)
})

test("a frame mid-travel carries the beads and guides, not just the line", async () => {
	const ref = await mount()
	const c = ref.current
	const all = c.allSeries()
	const merged = c.union(all.this, all.last)
	const f = c.lerpFrame(c.frameOf(all.this), c.frameOf(all.last), 0.5)
	c.paintFrame(merged, all.this.now, f)
	const svg = (c.host.current || {}).innerHTML || ""
	//the old animation painter drew the area and the lines only, so everything else APPEARED when the
	//motion stopped - which is what "the graph appears abruptly after the travel" was
	expect(svg).toContain('stroke-dasharray="2,3"')   //the high/low guides
	expect(svg).toContain("high $")
	expect(svg).toContain("low $")
})

/* ---- the permanent date axis -------------------------------------------------------------------- */

test("the 1st and the 15th are always marked, each carrying its month", async () => {
	const ref = await mount()
	const svg = () => (ref.current.host.current || {}).innerHTML || ""
	const a = ref.current.series()
	const all = a.past.concat(a.future)
	const from = all[0].date, to = all[all.length-1].date

	//every 1st and 15th inside the window is labelled, and none outside it is
	const expected = []
	for(let m = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
			m <= to; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth()+1, 1))){
		[1, 15].forEach(d => {
			const t = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), d))
			if(t >= from && t <= to)expected.push(
				t.toLocaleString("en-US", {month:"short", day:"numeric", timeZone:"UTC"}))
		})
	}
	expect(expected.length).toBeGreaterThan(0)
	expected.forEach(label => expect(svg()).toContain(">" + label + "<"))
})

test("a tick label under the cursor's own date gives way to it", async () => {
	const ref = await mount()
	const a = ref.current.series()
	const all = a.past.concat(a.future)
	//park the cursor exactly on a 1st or a 15th
	const anchor = all.filter(p => p.date.getUTCDate() === 1 || p.date.getUTCDate() === 15)[0]
	expect(anchor).toBeTruthy()
	const label = anchor.date.toLocaleString("en-US", {month:"short", day:"numeric", timeZone:"UTC"})
	await act(async () => {ref.current.setState({at: anchor.date})})
	const svg = (ref.current.host.current || {}).innerHTML || ""
	//printed once - by the cursor - rather than twice on top of itself
	expect(svg.split(">" + label + "<").length - 1).toBe(1)
})

/* ---- the benchmark overlay ---------------------------------------------------------------------- */

test("the benchmark starts where the window starts, on the actual balance", async () => {
	const ref = await mount()
	const a = ref.current.series()
	expect(a.backtest.length).toBeGreaterThan(1)
	//it is anchored on a known figure, not on a guess: the reconstruction's first point
	expect(a.backtest[0].date.getTime()).toBe(a.past[0].date.getTime())
	expect(a.backtest[0].value).toBe(a.past[0].value)
	//and it covers the settled part of the window, no further
	expect(a.backtest[a.backtest.length-1].date.getTime())
		.toBe(a.past[a.past.length-1].date.getTime())
})

test("the benchmark is OUT OF SAMPLE - it cannot see the period it predicts", async () => {
	const ref = await mount()
	const c = ref.current
	const opened = c.series().past[0].date
	const asOf = c.shapesAsOf(opened)
	const all = c.streamTxns()
	//every transaction the shapes were built from predates the window
	Object.keys(all).forEach(id => {
		const used = all[id].filter(t => t.date < opened)
		const total = all[id].reduce((x, t) => x + Math.abs(t.amount), 0)
		const usedTotal = used.reduce((x, t) => x + Math.abs(t.amount), 0)
		if(total > usedTotal){
			//this stream HAS transactions inside the window, and they must not be in the shape
			const shapeOfAll = histogramOf(all[id])
			const shapeAsOf = asOf.shapes[id]
			expect(shapeAsOf.weights).not.toEqual(shapeOfAll.weights)
		}
	})
})

test("the benchmark uses the same algorithm as the forward forecast", async () => {
	const ref = await mount()
	const c = ref.current
	const a = c.series()
	//run the forecast by hand with the same out-of-sample inputs and expect the same numbers
	const opened = a.past[0].date
	const asOf = c.shapesAsOf(opened)
	const days = Math.round((a.past[a.past.length-1].date - opened)/86400000)
	const mine = forecast({terminals: c.terminals(), shapes: asOf.shapes, routing: asOf.routing,
		now: opened, balanceNow: a.past[0].value, days: days,
		covers: h => c.covered().indexOf(h || c.spendingHashes()[0]) > -1,
		settles: h => c.creditHashes().indexOf(h) > -1,
		periodName: "monthly", settlementDay: c.settlementDay()})
	expect(a.backtest.length).toBe(mine.length + 1)
	expect(Math.round(a.backtest[a.backtest.length-1].value)).toBe(Math.round(mine[mine.length-1].value))
})

test("the benchmark is drawn dotted, and under the record", async () => {
	const ref = await mount()
	const svg = (ref.current.host.current || {}).innerHTML || ""
	expect(svg).toContain('stroke-dasharray="0.5,3"')
	//before the solid record line in document order, so the truth sits on top where they touch
	expect(svg.indexOf('stroke-dasharray="0.5,3"'))
		.toBeLessThan(svg.indexOf('stroke-linejoin="round" stroke-linecap="round"'))
})

test("a divergence is inside the frame rather than clipped away", async () => {
	const ref = await mount()
	const c = ref.current
	const a = c.series()
	const f = c.frameOf(a)
	//whatever the benchmark does, it is drawable: the vertical range contains it
	a.backtest.forEach(p => {
		expect(p.value).toBeGreaterThanOrEqual(f.y0)
		expect(p.value).toBeLessThanOrEqual(f.y1)
	})
})
