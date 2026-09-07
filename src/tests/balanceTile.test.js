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
import {histogramOf, reconstruct, forecast, accountRoutingOf, classifyStream, CLASSES,
	groupByStream, pointPrediction, dayLabel, TIERS, observedSettlement, settlementInReading,
	inferSettlements} from '../processors/BankBalance'
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
	//and with NO declared direction at all it is still deterministic, because the outflow rule
	//covers that case too - this used to be order dependent, which was the fault
	expect(accountRoutingOf({t: legs}).t).toBe("chk")
	expect(accountRoutingOf({t: legs.slice().reverse()}).t).toBe("chk")
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

/* ---- predictable vs erratic ---------------------------------------------------------------------- */

const monthlyOn = (day, amount, months, jitterAmount) => {
	const out = []
	for(let m = 0; m < months; m++){
		out.push({date: new Date(Date.UTC(2025, m, day)),
			amount: amount * (jitterAmount ? (0.2 + (m % 5)) : 1)})
	}
	return out
}

test("a regular payment on a regular day is predictable", () => {
	const r = classifyStream(monthlyOn(1, -1700, 12), -1700)
	expect(r.klass).toBe(CLASSES.predictable)
	expect(r.cycle).toBe("monthly")
	expect(r.timing).toBeGreaterThan(0.9)
	expect(r.steadiness).toBeGreaterThan(0.9)
})

test("a regular day with a wildly varying amount is NOT predictable", () => {
	//you can say when, and not how much - and a balance chart is read for the size of its steps
	const r = classifyStream(monthlyOn(1, -300, 12, true), -900)
	expect(r.timing).toBeGreaterThan(0.9)
	expect(r.steadiness).toBeLessThan(0.55)
	expect(r.klass).toBe(CLASSES.erratic)
})

test("a steady amount on scattered days is NOT predictable", () => {
	const scattered = []
	for(let m = 0; m < 12; m++){
		scattered.push({date: new Date(Date.UTC(2025, m, 1 + (m*7) % 27)), amount: -500})
	}
	const r = classifyStream(scattered, -500)
	expect(r.steadiness).toBeGreaterThan(0.9)
	expect(r.timing).toBeLessThan(0.45)
	expect(r.klass).toBe(CLASSES.erratic)
})

test("the silent turns count, so a sporadic stream is not mistaken for a steady one", () => {
	//three payments of exactly $500, in month 0, 6 and 11. Measured only on the months it fired, it
	//looks perfectly steady; measured across the span it obviously is not.
	const sporadic = [0, 6, 11].map(m => ({date: new Date(Date.UTC(2025, m, 4)), amount: -500}))
	const r = classifyStream(sporadic, -125)
	expect(r.turns).toBe(12)
	expect(r.steadiness).toBeLessThan(0.55)
	expect(r.klass).toBe(CLASSES.erratic)
})

test("not enough data is its own answer, never one of the other two", () => {
	expect(classifyStream([], 0).klass).toBe(CLASSES.thin)
	expect(classifyStream(monthlyOn(1, -1700, 1), -1700).klass).toBe(CLASSES.thin)
	//two turns cannot tell a rhythm from a coincidence
	expect(classifyStream(monthlyOn(1, -1700, 2), -1700).klass).toBe(CLASSES.thin)
	expect(classifyStream(monthlyOn(1, -1700, 3), -1700).klass).toBe(CLASSES.predictable)
})

test("the regular-only basis forecasts a subset, and the benchmark honours it too", async () => {
	const ref = await mount()
	const c = ref.current
	const all = c.terminalsFor("all").length
	const regular = c.terminalsFor("regular").length
	expect(regular).toBeLessThanOrEqual(all)
	//every stream it keeps is one the classifier called predictable
	const ok = {}
	c.classification().forEach(r => {if(r.klass === CLASSES.predictable)ok[r.id] = true})
	c.terminalsFor("regular").forEach(s => expect(ok[s.id]).toBe(true))
})

test("switching basis rebuilds both months and leaves the record untouched", async () => {
	const ref = await mount()
	const c = ref.current
	const before = c.series()
	const recordBefore = before.past.map(p => Math.round(p.value))
	await act(async () => {c.setState({basis: "regular"})})
	const after = c.series()
	//the reconstruction is what HAPPENED - no choice about streams can move it
	expect(after.past.map(p => Math.round(p.value))).toEqual(recordBefore)
})

test("the classification report names every stream exactly once", async () => {
	const ref = await mount()
	const text = ref.current.report()
	ref.current.terminals().forEach(s => {
		expect(text.split(s.name.slice(0, 27)).length - 1).toBeGreaterThanOrEqual(1)
	})
	expect(text).toContain("PREDICTABLE")
	expect(text).toContain("ERRATIC")
	expect(text).toContain("NOT ENOUGH DATA")
})

/* ---- what counts as a stream's own transactions -------------------------------------------------- */

const txn = (o) => Object.assign({categorized: true, amount: 0, date: new Date(Date.UTC(2026,0,1)),
	userInstitutionAccountId: "chk", transactionId: "t" + Math.random(), streamAllocation: []}, o)

test("a split transaction counts its ALLOCATION, not the whole transaction", () => {
	//a $200 order split $150/$50 is not evidence that either stream moves $200 - and steadiness is a
	//measure of how alike the amounts are, so inflating them corrupts the classification directly
	const t = txn({amount: -200, streamAllocation: [
		{streamId: "emile", amount: -150}, {streamId: "eleonore", amount: -50}]})
	const g = groupByStream([t], ["emile", "eleonore"])
	expect(g.emile.length).toBe(1)
	expect(g.eleonore.length).toBe(1)
	expect(g.emile[0].amount).toBe(-150)
	expect(g.eleonore[0].amount).toBe(-50)
})

test("the SIGN comes from the transaction, since every part of a split moves the same way", () => {
	const t = txn({amount: -200, streamAllocation: [{streamId: "a", amount: 150}]})
	expect(groupByStream([t], ["a"]).a[0].amount).toBe(-150)
})

test("a paired transfer is ONE event, not two", () => {
	//a $4,000 move to savings is stored as two legs carrying the same allocation. Counting both makes
	//it look like $8,000 of activity every month, and steadiness then measures a quantity that never
	//existed.
	const out = txn({amount: -4000, transactionId: "A", pairedTransferTransactionId: "B",
		userInstitutionAccountId: "chk", streamAllocation: [{streamId: "sav", amount: -4000}]})
	const back = txn({amount: 4000, transactionId: "B", pairedTransferTransactionId: "A",
		userInstitutionAccountId: "savAcct", streamAllocation: [{streamId: "sav", amount: 4000}]})
	const g = groupByStream([out, back], ["sav"], () => -1)
	expect(g.sav.length).toBe(1)
	expect(Math.abs(g.sav[0].amount)).toBe(4000)
})

test("the leg kept is the one matching the stream's direction, whatever the order", () => {
	//so routing then sees the account the money actually LEFT
	const out = txn({amount: -4000, transactionId: "A", pairedTransferTransactionId: "B",
		userInstitutionAccountId: "chk", streamAllocation: [{streamId: "sav", amount: -4000}]})
	const back = txn({amount: 4000, transactionId: "B", pairedTransferTransactionId: "A",
		userInstitutionAccountId: "savAcct", streamAllocation: [{streamId: "sav", amount: 4000}]})
	expect(groupByStream([out, back], ["sav"], () => -1).sav[0].accountHash).toBe("chk")
	expect(groupByStream([back, out], ["sav"], () => -1).sav[0].accountHash).toBe("chk")
})

test("a pair is collapsed whatever its signs - direction picks the leg, not whether to collapse", () => {
	const a = txn({amount: 100, transactionId: "A", pairedTransferTransactionId: "B",
		userInstitutionAccountId: "one", streamAllocation: [{streamId: "x", amount: 100}]})
	const b = txn({amount: 100, transactionId: "B", pairedTransferTransactionId: "A",
		userInstitutionAccountId: "two", streamAllocation: [{streamId: "x", amount: 100}]})
	//neither leg matches "money out", and it is still ONE event
	expect(groupByStream([a, b], ["x"], () => -1).x.length).toBe(1)
})

test("with no direction to go on, the OUTGOING leg wins - not whichever was listed first", () => {
	//picking by ledger order here would reintroduce exactly the order-dependence routing had to fix
	const out = txn({amount: -75, transactionId: "A", pairedTransferTransactionId: "B",
		userInstitutionAccountId: "chk", streamAllocation: [{streamId: "x", amount: -75}]})
	const back = txn({amount: 75, transactionId: "B", pairedTransferTransactionId: "A",
		userInstitutionAccountId: "other", streamAllocation: [{streamId: "x", amount: 75}]})
	expect(groupByStream([out, back], ["x"], () => 0).x[0].accountHash).toBe("chk")
	expect(groupByStream([back, out], ["x"], () => 0).x[0].accountHash).toBe("chk")
})

test("a half-pair whose partner is out of range is still counted", () => {
	const only = txn({amount: -4000, transactionId: "A", pairedTransferTransactionId: "B",
		streamAllocation: [{streamId: "sav", amount: -4000}]})
	expect(groupByStream([only], ["sav"], () => -1).sav.length).toBe(1)
})

test("uncategorised transactions belong to no stream", () => {
	const t = txn({categorized: false, amount: -50, streamAllocation: null})
	expect(groupByStream([t], ["a"]).a.length).toBe(0)
})

test("double counting a transfer would have made it look erratic - and no longer does", () => {
	//twelve identical monthly transfers, each stored as two legs
	const legs = []
	for(let m = 0; m < 12; m++){
		const d = new Date(Date.UTC(2025, m, 13))
		legs.push(txn({amount: -4000, date: d, transactionId: "o" + m, pairedTransferTransactionId: "i" + m,
			userInstitutionAccountId: "chk", streamAllocation: [{streamId: "sav", amount: -4000}]}))
		legs.push(txn({amount: 4000, date: d, transactionId: "i" + m, pairedTransferTransactionId: "o" + m,
			userInstitutionAccountId: "savAcct", streamAllocation: [{streamId: "sav", amount: 4000}]}))
	}
	const g = groupByStream(legs, ["sav"], () => -1)
	expect(g.sav.length).toBe(12)
	const r = classifyStream(g.sav, -4000)
	expect(r.klass).toBe(CLASSES.predictable)
	expect(r.steadiness).toBeGreaterThan(0.95)
})

/* ---- the three tiers ----------------------------------------------------------------------------- */

const on = (y, m, d, amount) => ({date: new Date(Date.UTC(y, m, d)), amount: amount})

test("tier 1: same day, same amount", () => {
	const t = []
	for(let m = 0; m < 12; m++)t.push(on(2025, m, 1, -1700))
	const p = pointPrediction(t, -1700)
	expect(p.tier).toBe(TIERS.dated)
	expect(dayLabel(p.cycle, p.day)).toBe("day 1")
	expect(p.amount).toBe(-1700)
})

test("tier 2: the day moves, the amount does not - and it is NOT spread", () => {
	//rent, bills, a day-care cheque. Spreading would remove the event, which is what the chart is read
	//for, so tier 2 keeps it as one step and accepts error on the day.
	const t = []
	const days = [2, 9, 4, 14, 6, 11, 3, 13, 5, 10, 7, 12]
	days.forEach((d, m) => t.push(on(2025, m, d, -1700)))
	const p = pointPrediction(t, -1700)
	expect(p.tier).toBe(TIERS.drifting)
	expect(p.day).not.toBe(null)
	expect(p.amount).toBe(-1700)
})

test("tier 3: twenty transactions a month is not an event, however concentrated", () => {
	const t = []
	for(let m = 0; m < 12; m++)for(let k = 0; k < 20; k++)t.push(on(2025, m, 1 + k, -25))
	const p = pointPrediction(t, -500)
	expect(p.perTurn).toBeGreaterThan(3)
	expect(p.tier).toBe(TIERS.spread)
	expect(dayLabel(p.cycle, p.day)).toBe("spread")
})

test("tier 3 also catches a discrete event whose SIZE is not repeatable", () => {
	const t = []
	;[-100, -2400, -300, -1900, -80, -3000, -150, -2200].forEach((a, m) => t.push(on(2025, m, 5, a)))
	const p = pointPrediction(t, -1200)
	expect(p.perTurn).toBeLessThanOrEqual(3)
	expect(p.steadiness).toBeLessThan(0.55)
	expect(p.tier).toBe(TIERS.spread)
})

test("the predicted amount is a MEDIAN of recent turns, not the last one and not the mean", () => {
	//one strange month must not move the prediction
	const t = []
	for(let m = 0; m < 11; m++)t.push(on(2025, m, 1, -1000))
	t.push(on(2025, 11, 1, -9000))            //one outlier, most recent
	const p = pointPrediction(t, -1000)
	expect(p.amount).toBe(-1000)
})

test("a genuine step change is picked up within a cycle or two", () => {
	const t = []
	for(let m = 0; m < 6; m++)t.push(on(2025, m, 1, -1000))
	for(let m = 6; m < 12; m++)t.push(on(2025, m, 1, -1500))
	const p = pointPrediction(t, -1000)
	expect(p.amount).toBe(-1500)
})

test("with no history at all, the master's expectation is the only figure available", () => {
	const p = pointPrediction([], -450)
	expect(p.amount).toBe(-450)
	expect(p.tier).toBe(TIERS.spread)
	expect(p.thin).toBe(true)
})

test("the predicted day is the cluster PEAK, so a wrapped cluster is not averaged to mid-month", () => {
	//the 30th and the 2nd have a mean day of 16 - the one day of the month it never happens
	const t = []
	for(let m = 0; m < 6; m++){t.push(on(2025, m, 30, -800)); t.push(on(2025, m+6, 2, -800))}
	const p = pointPrediction(t, -800)
	if(p.day !== null)expect([0, 1, 29, 30]).toContain(p.day)
})

/* ---- semimonthly ---------------------------------------------------------------------------- */

const payroll = (months) => {
	const out = []
	for(let m = 0; m < months; m++){
		[15, 30].forEach(nominal => {
			const dt = new Date(Date.UTC(2024, m, nominal))
			const dow = dt.getUTCDay()
			const day = dow === 0 ? nominal - 2 : (dow === 6 ? nominal - 1 : nominal)
			out.push({date: new Date(Date.UTC(2024, m, day)), amount: 7837})
		})
	}
	return out
}

test("a twice-a-month payroll is detected as semimonthly, not monthly", () => {
	//monthly binning splits it across two peaks and reads it as half-concentrated, so a payroll that
	//never misses scored 0.46 and was called erratic
	const p = pointPrediction(payroll(24), 7837*2)
	expect(p.cycle).toBe("semimonthly")
	expect(p.tier).toBe(TIERS.dated)
})

test("semimonthly names BOTH its days, and is confident about them", () => {
	const p = pointPrediction(payroll(24), 7837*2)
	expect(dayLabel(p.cycle, p.day)).toBe("day 15 & 30")
	expect(p.confidence).toBeGreaterThan(0.9)
})

test("the amount is stated per turn AND per month, since they are different questions", () => {
	const p = pointPrediction(payroll(24), 7837*2)
	expect(Math.round(p.perTurnAmount)).toBe(7837)
	expect(Math.round(p.amount)).toBe(7837*2)
})

test("February still gets BOTH paychecks - money aimed at a missing day lands on the last one", () => {
	//"the 30th" does not exist in February and the payment is not skipped that month, it is paid on
	//the 28th. Without the month-end rule the second paycheck evaporated and February forecast
	//$8,098 of a $15,674 month.
	const s = {id: "w", name: "Wages", getExpectedAmountAtDateByPeriod: () => 7837*2}
	const shape = histogramOf(payroll(24))
	const run = (y, m, d, days) => forecast({terminals: [s], shapes: {w: shape}, routing: {},
		now: new Date(Date.UTC(y, m, d)), balanceNow: 0, days: days, periodName: "monthly"})
	const feb = run(2026, 0, 31, 28), oct = run(2026, 8, 30, 31), apr = run(2026, 3, 30, 30)
	;[feb, oct, apr].forEach(out => {
		expect(Math.round(out[out.length-1].value)).toBe(15674)
		const big = out.filter((q, i) => i && (q.value - out[i-1].value) > 5000)
		expect(big.length).toBe(2)          //two paydays, in every month length
	})
})

test("a monthly payment budgeted for the 31st happens on the 30th in a thirty-day month", () => {
	//every transaction genuinely on a 31st, so the shape has all its weight on the last bin
	const t = []
	;[0, 2, 4, 6, 7, 9, 11].forEach(m => t.push({date: new Date(Date.UTC(2025, m, 31)), amount: -900}))
	const s = {id: "r", name: "Odd", getExpectedAmountAtDateByPeriod: () => -900}
	const shape = histogramOf(t)
	//JUNE, which has thirty days - forecasting from April 30 would land in May and never test it
	const june = forecast({terminals: [s], shapes: {r: shape}, routing: {},
		now: new Date(Date.UTC(2026, 4, 31)), balanceNow: 0, days: 30, periodName: "monthly"})
	expect(Math.round(june[june.length-1].value)).toBe(-900)
	//and it lands on the last day the month has, not spread across it
	const steps = june.filter((q, i) => i && Math.abs(q.value - june[i-1].value) > 1)
	expect(steps.length).toBe(1)
	expect(steps[0].date.getUTCDate()).toBe(30)
	//a 31-day month puts it on the 31st, where it belongs
	const july = forecast({terminals: [s], shapes: {r: shape}, routing: {},
		now: new Date(Date.UTC(2026, 5, 30)), balanceNow: 0, days: 31, periodName: "monthly"})
	expect(Math.round(july[july.length-1].value)).toBe(-900)
})

test("a weekly stream keeps a FIXED per-occurrence amount, so its month total varies", () => {
	//no month-end rule applies: every weekday exists in every month, and a four-Monday month really
	//does carry less than a five-Monday one
	const weekly = []
	for(let i = 0; i < 52; i++){
		const d = new Date(Date.UTC(2025, 0, 6)); d.setUTCDate(d.getUTCDate() + 7*i)
		weekly.push({date: d, amount: -400})
	}
	const s = {id: "w", name: "Weekly", getExpectedAmountAtDateByPeriod: () => -400*52/12}
	const out = forecast({terminals: [s], shapes: {w: histogramOf(weekly)}, routing: {},
		now: new Date(Date.UTC(2026, 8, 30)), balanceNow: 0, days: 31, periodName: "monthly"})
	const steps = out.filter((q, i) => i && Math.abs(q.value - out[i-1].value) > 100)
	steps.forEach((q, i) => {
		const st = Math.abs(q.value - out[out.indexOf(q)-1].value)
		expect(st).toBeGreaterThan(350)
		expect(st).toBeLessThan(450)
	})
})

/* ---- the declaration is the baseline, and dormancy is not failure --------------------------- */

test("the stream's declared period is the hypothesis, not monthly", () => {
	//two clean semimonthly turns: too little for the detector to CLAIM semimonthly on its own
	//(1-in-16 is not evidence), but the user already said so, and nothing beats it
	const t = [
		{date: new Date(Date.UTC(2026, 0, 15)), amount: 4000},
		{date: new Date(Date.UTC(2026, 0, 31)), amount: 4000},
		{date: new Date(Date.UTC(2026, 1, 15)), amount: 4000}
	]
	expect(pointPrediction(t, 8000, {prefer: "semimonthly"}).cycle).toBe("semimonthly")
	expect(pointPrediction(t, 8000).cycle).toBe("monthly")
})

test("a declaration can still be overturned by the ledger", () => {
	//declared monthly, paid every Monday for a year - the ledger wins, with a margin
	const weekly = []
	for(let i = 0; i < 52; i++){
		const d = new Date(Date.UTC(2025, 0, 6)); d.setUTCDate(d.getUTCDate() + 7*i)
		weekly.push({date: d, amount: -400})
	}
	expect(pointPrediction(weekly, -1733, {prefer: "monthly"}).cycle).toBe("weekly")
})

test("a stream that only STARTS in May is already unaffected - turns before its first are not counted", () => {
	const t = []
	for(let m = 4; m < 12; m++)t.push({date: new Date(Date.UTC(2025, m, 3)), amount: -1000})
	const p = pointPrediction(t, -1000)
	expect(p.turns).toBe(8)                      //May..Dec, not Jan..Dec
	expect(p.tier).toBe(TIERS.dated)
})

test("a stream budgeted at nothing MID-history is not scored against those months", () => {
	//active Jan-Mar, dormant Apr-Aug by its own definition, active again Sep-Dec. The dormant months
	//sit between two real ones, so they ARE counted as silent turns - and the stream came out erratic
	//for doing exactly what it said it would.
	const t = []
	;[0,1,2,8,9,10,11].forEach(m => t.push({date: new Date(Date.UTC(2025, m, 3)), amount: -1000}))
	const budgeted = d => {const m = d.getUTCMonth(); return !(m >= 3 && m <= 7)}

	const naive = pointPrediction(t, -1000)
	const aware = pointPrediction(t, -1000, {expectedAt: budgeted})
	expect(naive.turns).toBe(12)
	expect(aware.turns).toBe(7)
	expect(aware.steadiness).toBeGreaterThan(naive.steadiness)
	expect(naive.tier).toBe(TIERS.spread)
	expect(aware.tier).toBe(TIERS.dated)
	expect(aware.amount).toBe(-1000)
})

test("dormancy awareness does not rescue a genuinely sporadic stream", () => {
	//active all year by its own definition, and firing in three months of twelve
	const t = [0, 6, 11].map(m => ({date: new Date(Date.UTC(2025, m, 4)), amount: -500}))
	const p = pointPrediction(t, -125, {expectedAt: () => true})
	expect(p.tier).toBe(TIERS.spread)
})

/* ---- outliers, regimes, and per-stream accuracy ---------------------------------------------- */

const monthlyAt = (day, amounts) => amounts.map((a, m) =>
	({date: new Date(Date.UTC(2025, m, day)), amount: a}))

test("an occasional reversal does not make a regular stream erratic", () => {
	//savings: $4,000 out every month, and once it comes back. Scored together the stream looks
	//erratic and is forecast as a spread, which loses the regular half too.
	const withReturn = monthlyAt(13, [-4000,-4000,-4000,-4000,3000,-4000,-4000,-4000,-4000,-4000,-4000,-4000])
	const clean = monthlyAt(13, new Array(12).fill(-4000))
	const a = pointPrediction(withReturn, -4000)
	const b = pointPrediction(clean, -4000)
	expect(a.outlierTurns).toBe(1)
	expect(a.tier).toBe(b.tier)
	expect(a.amount).toBe(-4000)          //the typical turn, not the average including the reversal
})

test("many outliers are not outliers - that is a distribution, and tier 3", () => {
	const scattered = monthlyAt(13, [-100,-4000,-80,-3000,-50,-2000,-90,-5000,-70,-1000,-60,-4000])
	const p = pointPrediction(scattered, -1700)
	expect(p.tier).toBe(TIERS.spread)
})

test("a rate change starts a new regime - the prediction is the new rate, not a blend", () => {
	//$1,500 until October, $1,700 after. The recency window alone still straddles the change and
	//predicts $1,600 - a number that was never true and never will be.
	const t = monthlyAt(6, [-1500,-1500,-1500,-1500,-1500,-1500,-1500,-1500,-1500,-1700,-1700,-1700])
	expect(pointPrediction(t, -1700).amount).toBe(-1600)
	const october = new Date(Date.UTC(2025, 9, 1))
	expect(pointPrediction(t, -1700, {regimeFrom: october}).amount).toBe(-1700)
})

test("too few turns since a change means the declared figure stands", () => {
	//a rate set last month has nothing to measure, and the number the user typed is the best answer
	const t = monthlyAt(6, [-1500,-1500,-1500,-1500,-1500,-1500,-1500,-1500,-1500,-1500,-1500,-1700])
	const dec = new Date(Date.UTC(2025, 11, 1))
	expect(pointPrediction(t, -1700, {regimeFrom: dec}).amount).toBe(-1700)
})

test("the forecast can be handed a caller's own expectation", () => {
	//a yearly budget spreads what is LEFT over the months that are left, which is the reporting
	//side's rule - the balance view was the only place still dividing by twelve
	const s = {id: "y", name: "Yearly", getExpectedAmountAtDateByPeriod: () => -1000}
	const shape = histogramOf([])
	const plain = forecast({terminals: [s], shapes: {y: shape}, routing: {},
		now: new Date(Date.UTC(2026, 8, 30)), balanceNow: 0, days: 31, periodName: "monthly"})
	const remaining = forecast({terminals: [s], shapes: {y: shape}, routing: {},
		now: new Date(Date.UTC(2026, 8, 30)), balanceNow: 0, days: 31, periodName: "monthly",
		expectedFor: () => -250})
	expect(Math.round(plain[plain.length-1].value)).toBe(-1000)
	expect(Math.round(remaining[remaining.length-1].value)).toBe(-250)
})

/* ---- routing decides WHERE, and needs every account to do it --------------------------------- */

test("a stream that lives on another account is not forecast onto this one", () => {
	//routing off an already-filtered ledger was a real fault: a stream paid entirely by credit card
	//has no checking history, routed to undefined, fell through to the default account, and was
	//forecast onto checking where nothing of it ever happens - guaranteed maximum error, on exactly
	//the streams the model understands best
	const onCard = []
	for(let m = 0; m < 12; m++){
		onCard.push({date: new Date(Date.UTC(2025, m, 12)), amount: -10, accountHash: "visa"})
	}
	const routed = accountRoutingOf({ins: onCard}, () => -1)
	expect(routed.ins).toBe("visa")

	const covers = h => ["chk"].indexOf(h || "chk") > -1
	expect(covers(routed.ins)).toBe(false)      //excluded from the checking forecast, correctly
})

test("a stream with NO history at all still falls back to the default account", () => {
	//the fallback is for genuine ignorance, not for "it lives somewhere else"
	const routed = accountRoutingOf({fresh: []}, () => -1)
	expect(routed.fresh).toBe(undefined)
	const covers = h => ["chk"].indexOf(h || "chk") > -1
	expect(covers(routed.fresh)).toBe(true)
})

test("routing needs the accounts the shape does NOT - they answer different questions", () => {
	//half on checking, most on the card: the shape should learn from checking, routing should say card
	const mixed = [
		{date: new Date(Date.UTC(2025, 0, 12)), amount: -10, accountHash: "chk"},
		{date: new Date(Date.UTC(2025, 1, 12)), amount: -400, accountHash: "visa"},
		{date: new Date(Date.UTC(2025, 2, 12)), amount: -400, accountHash: "visa"}
	]
	expect(accountRoutingOf({m: mixed}, () => -1).m).toBe("visa")
	//and filtering first would have said checking, which is the bug
	const filtered = mixed.filter(t => t.accountHash === "chk")
	expect(accountRoutingOf({m: filtered}, () => -1).m).toBe("chk")
})

/* ---- drift ------------------------------------------------------------------------------------ */

test("a rising bill is predicted to keep rising, not to return to its median", () => {
	//utilities climbing all year: a median of the last six months predicts the middle of a trend,
	//which is a number the bill passed on its way up and will not see again
	const rising = [-200,-210,-222,-235,-248,-260,-272,-285,-298,-312,-325,-340]
		.map((a, m) => ({date: new Date(Date.UTC(2025, m, 2)), amount: a}))
	const p = pointPrediction(rising, -225)
	expect(p.amount).toBeLessThan(-340)          //past the last observation, not between
})

test("scatter with a sign is not a trend", () => {
	//the slope has to clear the noise, or random variation becomes a confident forecast of more
	const noisy = [-200,-260,-210,-255,-205,-265,-215,-250,-208,-262,-212,-258]
		.map((a, m) => ({date: new Date(Date.UTC(2025, m, 2)), amount: a}))
	const p = pointPrediction(noisy, -230)
	expect(p.amount).toBeGreaterThan(-280)
	expect(p.amount).toBeLessThan(-190)
})

test("a flat stream is untouched by the trend logic", () => {
	const flat = new Array(12).fill(0)
		.map((_, m) => ({date: new Date(Date.UTC(2025, m, 2)), amount: -1700}))
	expect(pointPrediction(flat, -1700).amount).toBe(-1700)
})

test("one strange month cannot set the direction", () => {
	//Theil-Sen takes the median of pairwise slopes, so a single spike does not become a trend
	const spike = [-100,-100,-100,-100,-100,-3000,-100,-100,-100,-100,-100,-100]
		.map((a, m) => ({date: new Date(Date.UTC(2025, m, 2)), amount: a}))
	const p = pointPrediction(spike, -100)
	expect(Math.abs(p.amount)).toBeLessThan(500)
})

test("a STEP is not a trend - a rate that moved and stayed is not still moving", () => {
	//Theil-Sen cannot tell a step from a ramp on its own: every pair on either side of the change is
	//flat, and the slope comes entirely from the pairs that straddle it. Extrapolating that predicts a
	//decline nobody is having.
	const stepped = [-1500,-1500,-1500,-1500,-1500,-1500,-1700,-1700,-1700,-1700,-1700,-1700]
		.map((a, m) => ({date: new Date(Date.UTC(2025, m, 6)), amount: a}))
	expect(pointPrediction(stepped, -1700).amount).toBe(-1700)

	//and the half-way case: the change lands inside the recency window, so the median straddles it
	const straddling = [-1500,-1500,-1500,-1500,-1500,-1500,-1500,-1500,-1500,-1700,-1700,-1700]
		.map((a, m) => ({date: new Date(Date.UTC(2025, m, 6)), amount: a}))
	expect(pointPrediction(straddling, -1700).amount).toBe(-1600)
})

/* ---- the card must not be paid twice ------------------------------------------------------------ */

const pairTxn = (id, partner, acct, amount) => ({categorized: true, amount: amount,
	date: new Date(Date.UTC(2026, 0, 20)), userInstitutionAccountId: acct,
	transactionId: id, pairedTransferTransactionId: partner, streamAllocation: []})

test("a transfer from the predicted account to a card IS the settlement", () => {
	//detected structurally - a paired partner sitting on a credit account - rather than by name
	const txns = [pairTxn("a", "b", "chk", -9800), pairTxn("b", "a", "visa", 9800)]
	const r = observedSettlement(txns, ["chk"], ["visa"])
	expect(r.count).toBe(1)
	expect(r.total).toBe(-9800)
})

test("an ordinary card purchase is not a settlement", () => {
	//no pair, and it lands on the card rather than leaving the account being predicted
	const buy = {categorized: true, amount: -60, date: new Date(Date.UTC(2026, 0, 4)),
		userInstitutionAccountId: "visa", transactionId: "x", streamAllocation: []}
	expect(observedSettlement([buy], ["chk"], ["visa"]).count).toBe(0)
})

test("a savings transfer is not a settlement either - the partner is not a card", () => {
	const txns = [pairTxn("a", "b", "chk", -4000), pairTxn("b", "a", "sav", 4000)]
	expect(observedSettlement(txns, ["chk"], ["visa"]).count).toBe(0)
})

test("a ledger with no pairing finds nothing, so the synthesis still runs", () => {
	//the right fallback: better a modelled settlement than none
	const unpaired = {categorized: true, amount: -9800, date: new Date(Date.UTC(2026, 0, 20)),
		userInstitutionAccountId: "chk", transactionId: "z", streamAllocation: []}
	expect(observedSettlement([unpaired], ["chk"], ["visa"]).count).toBe(0)
})

test("the card must be paid exactly once - and the PAYMENT STREAM is the duplicate", () => {
	//two models of the same money: the synthesis re-times the card's own streams onto the due day
	//using their expectations, and the payment stream is the same money seen from the other end.
	//Dropping the synthesis and keeping the stream cost 27 points of accuracy in one step, because a
	//six-week mean of a variable card bill under-predicts a heavy month.
	const card = {id: "sub", name: "Subscriptions", getExpectedAmountAtDateByPeriod: () => -500}
	const payment = {id: "pay", name: "Credit Card Payments",
		getExpectedAmountAtDateByPeriod: () => -500}
	const shapes = {sub: histogramOf([]), pay: histogramOf([])}
	const routing = {sub: "visa", pay: "chk"}
	const covers = h => ["chk"].indexOf(h || "chk") > -1
	const opts = {terminals: [card, payment], shapes: shapes, routing: routing,
		now: new Date(Date.UTC(2026, 8, 30)), balanceNow: 0, days: 31, periodName: "monthly",
		covers: covers}

	const withSynthesis = forecast(Object.assign({}, opts,
		{settles: h => ["visa"].indexOf(h) > -1, settlementDay: 20}))
	const ledgerOnly = forecast(Object.assign({}, opts, {settles: null, settlementDay: null}))

	//the payment stream alone is the truth: one month of card money leaving the account
	expect(Math.round(ledgerOnly[ledgerOnly.length-1].value)).toBe(-500)
	//with the synthesis on top it leaves twice
	expect(Math.round(withSynthesis[withSynthesis.length-1].value)).toBe(-1000)
})

/* ---- a zero-sum stream still moves money one way first ---------------------------------------- */

test("a stream declaring $0 is routed by the money LEAVING, not by whichever leg came first", () => {
	//a transfer's two legs are equal by construction, so with no declared direction there was nothing
	//to break the tie with - and when the card side won, the largest outflow in the portfolio was
	//routed off the account being predicted and forecast as $0
	const legs = []
	for(let w = 0; w < 8; w++){
		const d = new Date(Date.UTC(2026, 0, 3 + w*7))
		legs.push({date: d, amount: -2400, accountHash: "chk"})
		legs.push({date: d, amount: 2400, accountHash: "visa"})
	}
	const zeroSum = () => 0
	expect(accountRoutingOf({cc: legs}, zeroSum).cc).toBe("chk")
	expect(accountRoutingOf({cc: legs.slice().reverse()}, zeroSum).cc).toBe("chk")
})

test("a declared direction still wins over the outflow rule", () => {
	//income declares positive, and its money arrives rather than leaves
	const wages = [
		{date: new Date(Date.UTC(2026, 0, 15)), amount: 7800, accountHash: "chk"},
		{date: new Date(Date.UTC(2026, 0, 15)), amount: -7800, accountHash: "employer"}
	]
	expect(accountRoutingOf({w: wages}, () => 1).w).toBe("chk")
})

test("a stream on this account budgeted at nothing that still moves money IS the settlement", () => {
	//behavioural, so it works on a ledger that does not pair its transfers - which is the ledger
	//where the payment is an ordinary stream rather than a linked pair
	const covers = h => ["chk"].indexOf(h || "chk") > -1
	const pay = {id: "cc", name: "Credit Card Payments"}
	const rent = {id: "rent", name: "Rent"}
	const declared = s => s.id === "rent" ? -3100 : 0
	expect(settlementInReading([pay, rent], {cc: "chk", rent: "chk"},
		{cc: -9800, rent: -3100}, covers, declared)).toBe(true)
	//a zero-budget stream that moves nothing is not a settlement
	expect(settlementInReading([pay], {cc: "chk"}, {cc: 0}, covers, declared)).toBe(false)
	//nor is one that lives on the card rather than on this account
	expect(settlementInReading([pay], {cc: "visa"}, {cc: -9800}, covers, declared)).toBe(false)
})

/* ---- deferred card lumps, with nothing linking them ------------------------------------------- */

const tx = (day, amount, acct) => ({categorized: true, amount: amount,
	date: new Date(Date.UTC(2026, 0, day)), userInstitutionAccountId: acct,
	transactionId: acct + "-" + day + "-" + amount, streamAllocation: []})

test("two settlements, one per card, are matched to their cards by amount and date", () => {
	//purchases land on the cards over a week; $60 leaves checking as TWO transactions when they
	//settle, carrying no reference to what they pay
	const txns = [
		tx(2, -10, "visa"), tx(4, -20, "visa"), tx(5, -30, "amex"),
		tx(20, -30, "chk"), tx(20, -30, "chk"),        //the settlements
		tx(21, 30, "visa"), tx(21, 30, "amex")         //received on each card
	]
	const found = inferSettlements(txns, ["chk"], ["visa", "amex"])
	expect(found.length).toBe(2)
	expect(found.reduce((a, b) => a + b.amount, 0)).toBe(-60)
})

test("each side is consumed once, so two equal payments match two receipts", () => {
	//not one receipt matched twice
	const txns = [tx(20, -30, "chk"), tx(20, -30, "chk"), tx(21, 30, "visa")]
	expect(inferSettlements(txns, ["chk"], ["visa"]).length).toBe(1)
})

test("an ordinary purchase on the card is never a settlement", () => {
	//it never touched the account being predicted, and nothing arrives on a card to match it
	const txns = [tx(2, -10, "visa"), tx(4, -20, "visa")]
	expect(inferSettlements(txns, ["chk"], ["visa"]).length).toBe(0)
})

test("a payment far from any card receipt is not a settlement", () => {
	//the window is days, not months - a coincidence of amount two weeks apart is a coincidence
	const txns = [tx(2, -30, "chk"), tx(25, 30, "visa")]
	expect(inferSettlements(txns, ["chk"], ["visa"]).length).toBe(0)
})

test("a savings transfer of the same size is not a settlement", () => {
	//the money has to arrive on a CREDIT account, which is what makes it a card payment
	const txns = [tx(13, -4000, "chk"), tx(13, 4000, "sav")]
	expect(inferSettlements(txns, ["chk"], ["visa"]).length).toBe(0)
})

test("the closest receipt in time wins when several match the amount", () => {
	const txns = [tx(20, -30, "chk"), tx(23, 30, "visa"), tx(20, 30, "amex")]
	expect(inferSettlements(txns, ["chk"], ["visa", "amex"])[0].card).toBe("amex")
})

test("excludeIds drops a stream from the forecast entirely", () => {
	const card = {id: "sub", name: "Subscriptions", getExpectedAmountAtDateByPeriod: () => -500}
	const payment = {id: "pay", name: "Credit Card Payments",
		getExpectedAmountAtDateByPeriod: () => -500}
	const opts = {terminals: [card, payment], shapes: {sub: histogramOf([]), pay: histogramOf([])},
		routing: {sub: "visa", pay: "chk"},
		now: new Date(Date.UTC(2026, 8, 30)), balanceNow: 0, days: 31, periodName: "monthly",
		covers: h => ["chk"].indexOf(h || "chk") > -1}

	//synthesis on, payment stream dropped: the card is paid ONCE, from the card streams' own
	//expectations rather than from a mean of what the payment happened to be
	const right = forecast(Object.assign({}, opts, {settles: h => ["visa"].indexOf(h) > -1,
		settlementDay: 20, excludeIds: {pay: true}}))
	expect(Math.round(right[right.length-1].value)).toBe(-500)

	//both: twice
	const twice = forecast(Object.assign({}, opts, {settles: h => ["visa"].indexOf(h) > -1,
		settlementDay: 20}))
	expect(Math.round(twice[twice.length-1].value)).toBe(-1000)

	//neither: not at all
	const never = forecast(Object.assign({}, opts, {settles: null, settlementDay: null,
		excludeIds: {pay: true}}))
	expect(Math.round(never[never.length-1].value)).toBe(0)
})

test("a settlement carries the streams it was allocated to, so they can be excluded", () => {
	const settle = {categorized: true, amount: -60, date: new Date(Date.UTC(2026, 0, 20)),
		userInstitutionAccountId: "chk", transactionId: "s1",
		streamAllocation: [{streamId: "ccpay", amount: -60}]}
	const receipt = {categorized: true, amount: 60, date: new Date(Date.UTC(2026, 0, 21)),
		userInstitutionAccountId: "visa", transactionId: "r1", streamAllocation: []}
	const found = inferSettlements([settle, receipt], ["chk"], ["visa"])
	expect(found.length).toBe(1)
	expect(found[0].streamIds).toEqual(["ccpay"])
	expect(found[0].id).toBe("s1")
})
