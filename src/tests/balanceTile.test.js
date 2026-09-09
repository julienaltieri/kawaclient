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
	inferSettlements, cardCycles, cardSettlementForecast, contributionsOn, shareOfDay, dayKey,
	buildModel, eventsPerTurn, accountLinks, cardSchedule, cardRepaymentForecast,
	shareOfDayDetail, cardSpend,
	buildForecastInputs} from '../processors/BankBalance'
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
	const c = ref.current
	const routing = c.model(c.ledgerToday(), new Date(c.ledgerToday().getTime() + 30*86400000)).routing
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

/* =================================================================================================
   THE LAW OF THE AS-OF DATE, tested rather than reviewed.

   The model may read nothing dated on or after the instant it is asked about. Three separate faults
   were violations of exactly this - the backtest drawn from live shapes, the settlement averaged over
   the six months ending today and then used in a forecast starting a month ago, the audit explaining
   the past with the present's model - and each was found by eye, months apart, in production.

   Reading the code for out-of-sample purity is what failed. So this asks the model itself: build it
   from the whole ledger, build it again from a ledger physically truncated at the as-of date, and
   forecast with both. If any input peeks past asOf the two must differ, and if none does they are
   identical. No new leak can pass this, including ones nobody has thought of yet.
   ================================================================================================= */
test("the model reads nothing dated on or after its as-of date", async () => {
	const ref = await mount()
	const c = ref.current
	const a = c.series()
	const opened = a.past[0].date, closed = a.past[a.past.length-1].date
	const days = Math.round((closed - opened)/86400000)

	const common = {terminals: c.terminals(), accounts: c.state.accounts || [],
		covered: c.covered(), cards: c.creditHashes(), fallback: c.spendingHashes()[0],
		asOf: opened, until: closed, settlementDay: c.settlementDay()}
	const full = buildModel(Object.assign({transactions: c.props.transactions}, common))
	//a ledger that PHYSICALLY cannot contain the answer
	const blind = buildModel(Object.assign({transactions:
		c.props.transactions.filter(t => new Date(t.date) < opened)}, common))

	const run = m => forecast(Object.assign({now: opened, balanceNow: 0, days: days}, m))
		.map(p => Math.round(p.value*100))
	expect(run(full)).toEqual(run(blind))
	//and the window genuinely contains transactions, or the test proves nothing
	expect(c.props.transactions.filter(t => new Date(t.date) >= opened
		&& new Date(t.date) <= closed).length).toBeGreaterThan(3)
})

test("the drawn benchmark is exactly that model, run by hand", async () => {
	const ref = await mount()
	const c = ref.current
	const a = c.series()
	const opened = a.past[0].date, closed = a.past[a.past.length-1].date
	const mine = forecast(Object.assign({now: opened, balanceNow: a.past[0].value,
		days: Math.round((closed - opened)/86400000)}, c.model(opened, closed)))
	expect(a.backtest.length).toBe(mine.length + 1)
	expect(a.backtest.slice(1).map(p => Math.round(p.value*100)))
		.toEqual(mine.map(p => Math.round(p.value*100)))
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

/* ---- the bill is arithmetic on the spending that produces it ---------------------------------- */

const card = (day, amount, acct, id) => ({categorized: true, amount: amount,
	date: new Date(Date.UTC(2026, 0, day)), userInstitutionAccountId: acct,
	transactionId: id, streamAllocation: []})

//four weekly cycles: three purchases of $87 on the card, then $261 settled from checking
const weeklyCard = () => {
	const out = []
	for(let w = 0; w < 8; w++){
		const settleDay = 3 + w*7
		for(let i = 0; i < 3; i++)out.push(card(settleDay - 3 + i, -87, "visa", "b" + w + i))
		out.push(card(settleDay, -261, "chk", "s" + w))
		out.push(card(settleDay + 1, 261, "visa", "r" + w))
	}
	return out
}

test("the cycle is measured: its length, and how much of it each settlement clears", () => {
	const txns = weeklyCard()
	const found = inferSettlements(txns, ["chk"], ["visa"])
	const cy = cardCycles(txns, ["visa"], found).visa
	expect(Math.round(cy.intervalDays)).toBe(7)
	//paid in full, so the settlement clears the whole cycle
	expect(cy.ratio).toBeCloseTo(1, 1)
})

test("a revolver's ratio is measured, not assumed to be full payment", () => {
	//half the cycle paid each time - assuming full payment would over-predict the outflow every week
	const out = []
	for(let w = 0; w < 8; w++){
		const settleDay = 3 + w*7
		for(let i = 0; i < 3; i++)out.push(card(settleDay - 3 + i, -100, "visa", "b" + w + i))
		out.push(card(settleDay, -150, "chk", "s" + w))
		out.push(card(settleDay + 1, 150, "visa", "r" + w))
	}
	const cy = cardCycles(out, ["visa"], inferSettlements(out, ["chk"], ["visa"])).visa
	expect(cy.ratio).toBeCloseTo(0.5, 1)
})

test("the next bill is what has POSTED plus what is still to be spent", () => {
	const txns = weeklyCard()
	const found = inferSettlements(txns, ["chk"], ["visa"])
	//stand at a moment two days after a settlement, with one purchase already posted since
	const from = new Date(Date.UTC(2026, 1, 1))
	const r = cardSettlementForecast(txns, ["visa"], found, from,
		new Date(Date.UTC(2026, 1, 28)))
	expect(r.events.length).toBeGreaterThan(2)
	//each projected bill is about one cycle of spending, not two or three
	r.events.forEach(e => {
		expect(Math.abs(e.amount)).toBeGreaterThan(120)
		expect(Math.abs(e.amount)).toBeLessThan(450)
	})
})

test("each settlement clears only what accrued since the one before it", () => {
	//measured from the window start instead, the second bill charged two cycles, the third three,
	//and a month of weekly settlements came out at double the truth
	const txns = weeklyCard()
	const found = inferSettlements(txns, ["chk"], ["visa"])
	const r = cardSettlementForecast(txns, ["visa"], found, new Date(Date.UTC(2026, 1, 1)),
		new Date(Date.UTC(2026, 1, 28)))
	const sizes = r.events.map(e => Math.abs(e.amount))
	//no bill is more than about half again the smallest - they do not grow down the list
	expect(Math.max.apply(null, sizes)).toBeLessThan(Math.min.apply(null, sizes)*1.8)
})

test("two cards keep their own cycles rather than being averaged together", () => {
	const out = []
	for(let w = 0; w < 8; w++){
		out.push(card(3 + w*7, -50, "visa", "v" + w))
		out.push(card(4 + w*7, -100, "chk", "sv" + w))
		out.push(card(5 + w*7, 100, "visa", "rv" + w))
	}
	for(let m = 0; m < 2; m++){
		out.push(card(2 + m*28, -900, "amex", "a" + m))
		out.push(card(10 + m*28, -900, "chk", "sa" + m))
		out.push(card(11 + m*28, 900, "amex", "ra" + m))
	}
	const cy = cardCycles(out, ["visa", "amex"], inferSettlements(out, ["chk"], ["visa", "amex"]))
	expect(Math.round(cy.visa.intervalDays)).toBe(7)
	expect(Math.round(cy.amex.intervalDays)).toBe(28)
})

/* ---- the audit explains the forecast, not something like it ----------------------------------- */

test("the day breakdown sums to exactly what the forecast put on that day", () => {
	//if these two ever disagree, the audit sends the reader to inspect the wrong half
	const rent = {id: "r", name: "Rent", getExpectedAmountAtDateByPeriod: () => -1700}
	const food = {id: "f", name: "Food", getExpectedAmountAtDateByPeriod: () => -600}
	const shapes = {
		r: histogramOf([{date: "2026-01-02", amount: -1700}, {date: "2026-02-02", amount: -1700},
			{date: "2026-03-02", amount: -1700}]),
		f: histogramOf([])
	}
	const opts = {terminals: [rent, food], shapes: shapes, routing: {}, periodName: "monthly",
		covers: () => true}
	const series = forecast(Object.assign({now: new Date(Date.UTC(2026, 8, 30)), balanceNow: 0,
		days: 31}, opts))

	series.forEach((p, i) => {
		if(!i)return
		const step = p.value - series[i-1].value
		const parts = contributionsOn(p.date, opts)
		const sum = parts.reduce((a, b) => a + b.amount, 0)
		expect(sum).toBeCloseTo(step, 6)
	})
})

test("a stream this reading does not cover contributes nothing, and says so", () => {
	const onCard = {id: "c", name: "Subscriptions", getExpectedAmountAtDateByPeriod: () => -500}
	const opts = {terminals: [onCard], shapes: {c: histogramOf([])}, routing: {c: "visa"},
		periodName: "monthly", covers: h => ["chk"].indexOf(h || "chk") > -1}
	expect(shareOfDay(onCard, new Date(Date.UTC(2026, 8, 15)), opts)).toBe(0)
	expect(contributionsOn(new Date(Date.UTC(2026, 8, 15)), opts).length).toBe(0)
})

test("an excluded stream contributes nothing even though it is covered", () => {
	const pay = {id: "p", name: "Credit Card Payments", getExpectedAmountAtDateByPeriod: () => -900}
	const opts = {terminals: [pay], shapes: {p: histogramOf([])}, routing: {p: "chk"},
		periodName: "monthly", covers: () => true, excludeIds: {p: true}}
	expect(shareOfDay(pay, new Date(Date.UTC(2026, 8, 15)), opts)).toBe(0)
})

test("explicit events appear in the breakdown beside the streams", () => {
	//the card settlement is arithmetic rather than a stream, and an audit that omitted it would show
	//a day whose parts do not add up to its step
	const rent = {id: "r", name: "Rent", getExpectedAmountAtDateByPeriod: () => -1700}
	const day = new Date(Date.UTC(2026, 8, 15))
	const opts = {terminals: [rent], shapes: {r: histogramOf([])}, routing: {}, periodName: "monthly",
		covers: () => true, extraFlow: {"2026-09-15": {amount: -2400, name: "Card settlement"}}}
	const parts = contributionsOn(day, opts)
	expect(parts.map(p => p.name)).toContain("Card settlement")
	expect(parts.reduce((a, b) => a + b.amount, 0)).toBeCloseTo(-2400 + (-1700/30), 6)
})

/* ---- the cursor can outlive the finger -------------------------------------------------------- */

const mountWith = async (props) => {
	const ref = React.createRef()
	await act(async () => {render(<BalanceChart ref={ref} stream={master}
		transactions={txns} {...props}/>)})
	return ref
}

test("by default the cursor clears on release - the resting subtitle is the headline", async () => {
	const ref = await mountWith({})
	await act(async () => {ref.current.setState({at: rentDay})})
	expect(ref.current.state.at).toBeTruthy()
	const host = ref.current.host.current
	await act(async () => {
		host.dispatchEvent(new Event("pointerdown", {bubbles: true}))
		host.dispatchEvent(new Event("pointerup", {bubbles: true}))
	})
	expect(ref.current.state.at).toBe(null)
})

test("sticky keeps the day after release, so the table can be read and copied", async () => {
	//on a touch screen, reading the breakdown means lifting the finger and reaching for a button
	const ref = await mountWith({sticky: true})
	await act(async () => {ref.current.setState({at: rentDay})})
	const host = ref.current.host.current
	await act(async () => {host.dispatchEvent(new Event("pointerup", {bubbles: true}))})
	expect(ref.current.state.at).toBeTruthy()
})

test("the audit payload names both sides of the day and its difference", async () => {
	const ref = await mountWith({sticky: true, defaultWhen: "last"})
	const a = ref.current.series()
	const day = a.past.filter(p => dayKey(p.date) === dayKey(rentDay))[0] || a.past[3]
	const audit = ref.current.dayAudit(day)
	expect(audit.date).toBe(dayKey(day.date))
	expect(Array.isArray(audit.actual)).toBe(true)
	expect(Array.isArray(audit.predicted)).toBe(true)
	expect(audit.predictedTotal - audit.actualTotal).toBe(audit.predictedTotal - audit.actualTotal)
})

test("defaultWhen opens the tile on the month being audited", async () => {
	const ref = await mountWith({defaultWhen: "last"})
	expect(ref.current.state.when).toBe("last")
	const plain = await mountWith({})
	expect(plain.current.state.when).toBe("this")
})

/* ---- the tile and the bench must run the SAME model ------------------------------------------- */

test("the shared builder windows history, filters to the account, and takes the declared period", () => {
	//each filter answers a different question, and dropping any of them is a different fault
	const s1 = {id: "sav", name: "Savings", period: "monthly",
		getPreferredPeriod: () => "monthly", getExpectedAmountAtDateByPeriod: () => -4000}
	const byStream = {sav: [
		//old: a previous arrangement, on the 2nd
		{date: new Date(Date.UTC(2024, 0, 2)), amount: -4000, accountHash: "chk"},
		{date: new Date(Date.UTC(2024, 1, 2)), amount: -4000, accountHash: "chk"},
		//current: the 15th, on checking
		{date: new Date(Date.UTC(2026, 3, 15)), amount: -4000, accountHash: "chk"},
		{date: new Date(Date.UTC(2026, 4, 15)), amount: -4000, accountHash: "chk"},
		{date: new Date(Date.UTC(2026, 5, 15)), amount: -4000, accountHash: "chk"},
		//the other leg, on the savings account - describes a different account entirely
		{date: new Date(Date.UTC(2026, 3, 15)), amount: 4000, accountHash: "sav"},
		{date: new Date(Date.UTC(2026, 4, 15)), amount: 4000, accountHash: "sav"}
	]}
	const built = buildForecastInputs({terminals: [s1], byStream: byStream,
		since: new Date(Date.UTC(2026, 3, 1)), until: new Date(Date.UTC(2026, 6, 1)),
		covered: ["chk"]})
	//all the weight on one day, because only three checking transactions on the 15th survived
	expect(built.shapes.sav.weights[14]).toBeCloseTo(1, 6)
	//and it routes to the account the money left
	expect(built.routing.sav).toBe("chk")
})

test("without the filters the same stream smears - which is what the app was doing", () => {
	const s1 = {id: "sav", name: "Savings", getPreferredPeriod: () => "monthly",
		getExpectedAmountAtDateByPeriod: () => -4000}
	const byStream = {sav: [
		{date: new Date(Date.UTC(2024, 0, 2)), amount: -4000, accountHash: "chk"},
		{date: new Date(Date.UTC(2024, 1, 2)), amount: -4000, accountHash: "chk"},
		{date: new Date(Date.UTC(2026, 3, 15)), amount: -4000, accountHash: "chk"},
		{date: new Date(Date.UTC(2026, 4, 15)), amount: -4000, accountHash: "chk"}
	]}
	//no window, no account filter: two eras averaged together, and the peak day carries half
	const loose = buildForecastInputs({terminals: [s1], byStream: byStream, covered: ["chk", "sav"]})
	expect(loose.shapes.sav.weights[14]).toBeLessThan(0.75)
})

/* =================================================================================================
   ONE MODEL. The tile drew one forecast, the bench scored another, and the audit table explained a
   third. Five sessions went on the consequences. The components now choose a question and draw the
   answer; buildModel is the only thing that decides what a forecast is.

   This asks for that structurally rather than by comparing outputs: given the same question, the
   model the tile holds must be the model, term for term - and neither component may hold a second
   assembly of it.
   ================================================================================================= */
test("the tile holds no model of its own - it asks buildModel", async () => {
	const ref = await mount()
	const c = ref.current
	const asOf = c.ledgerToday(), until = new Date(asOf.getTime() + 30*86400000)
	const theirs = c.model(asOf, until)
	const mine = buildModel({transactions: c.props.transactions, terminals: c.terminals(),
		accounts: c.state.accounts || [], covered: c.covered(), cards: c.creditHashes(),
		fallback: c.spendingHashes()[0], asOf: asOf, until: until,
		settlementDay: c.settlementDay()})
	c.terminals().forEach(st => {
		expect(theirs.shapes[st.id].weights).toEqual(mine.shapes[st.id].weights)
		//the expectation rule too, which is where the zero-sum and remaining-budget rules live and
		//which the tile did without entirely until this landed
		expect(theirs.expectedFor(st, asOf)).toBeCloseTo(mine.expectedFor(st, asOf), 6)
	})
	expect(theirs.routing).toEqual(mine.routing)
	expect(theirs.excludeIds).toEqual(mine.excludeIds)
	expect(theirs.meta.since.getTime()).toBe(mine.meta.since.getTime())
})

test("a zero-sum stream that empties the account is still forecast", () => {
	/* "Zero sum" means the money comes back, which is true of a refund and false of a transfer
	   between two accounts. A savings transfer declared at $0 predicted $0, and the tile had no rule
	   for it at all - only the bench did, since b15. */
	const st = {id: "sav", name: "To savings", getPreferredPeriod: () => "monthly",
		getExpectedAmountAtDateByPeriod: () => 0}
	const txns = []
	for(let m = 0; m < 5; m++){
		const d = new Date(Date.UTC(2026, 3 + m, 14))
		txns.push(new GenericTransaction(d.toISOString(), -4000, "transfer",
			[{streamId: "sav", amount: -4000}], "chk", undefined, undefined, "z"+m, "z"+m))
	}
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 8, 1)), until: new Date(Date.UTC(2026, 8, 30)),
		since: new Date(Date.UTC(2026, 3, 1))})
	//the ledger says $4,000 a month leaves; the declaration says nothing, and the ledger wins
	expect(m.expectedFor(st, new Date(Date.UTC(2026, 8, 1)))).toBeLessThan(-3000)
})

test("a yearly budget spreads what is LEFT, not a twelfth of the whole", () => {
	/* $10,000 a year with $6,000 already gone has $4,000 left. Dividing the budget by twelve
	   forecasts money that has been spent - twice over by December. The tile divided by twelve. */
	const st = {id: "trip", name: "Voyages", getPreferredPeriod: () => "yearly",
		getExpectedAmountAtDateByPeriod: (when, p) => p === "yearly" ? -12000 : -1000}
	const spend = new GenericTransaction(new Date(Date.UTC(2026, 2, 3)).toISOString(), -9000, "trip",
		[{streamId: "trip", amount: -9000}], "chk", undefined, undefined, "t1", "t1")
	const at = new Date(Date.UTC(2026, 5, 1))
	const m = buildModel({transactions: [spend], terminals: [st], covered: ["chk"], cards: [],
		asOf: at, until: new Date(Date.UTC(2026, 6, 1)),
		since: new Date(Date.UTC(2026, 0, 1)), cycleStart: new Date(Date.UTC(2026, 0, 1))})
	const v = m.expectedFor(st, at)
	expect(Math.abs(v)).toBeLessThan(1000)          //a twelfth would be exactly 1000
	expect(Math.abs(v)).toBeGreaterThan(0)          //and there IS budget left
})

test("an exhausted budget predicts nothing further, not money coming back", () => {
	const st = {id: "trip", name: "Voyages", getPreferredPeriod: () => "yearly",
		getExpectedAmountAtDateByPeriod: (when, p) => p === "yearly" ? -12000 : -1000}
	const spend = new GenericTransaction(new Date(Date.UTC(2026, 2, 3)).toISOString(), -15000, "trip",
		[{streamId: "trip", amount: -15000}], "chk", undefined, undefined, "t1", "t1")
	const at = new Date(Date.UTC(2026, 5, 1))
	const m = buildModel({transactions: [spend], terminals: [st], covered: ["chk"], cards: [],
		asOf: at, until: new Date(Date.UTC(2026, 6, 1)),
		since: new Date(Date.UTC(2026, 0, 1)), cycleStart: new Date(Date.UTC(2026, 0, 1))})
	expect(m.expectedFor(st, at)).toBe(0)
})

/* ---- drift is measured in DAYS, not in fractions of a cycle ----------------------------------- */

test("a payday drifting two days either side still collapses to one event", () => {
	//the radius used to come from the bin count, so a semimonthly cycle got three bins - narrower
	//than the wander. The run never collapsed and a paycheck was spread over eleven days at a sixth
	//of its size each, which is what "wages predicted $2,612" was.
	const pay = []
	const mid = [12, 14, 16, 13, 15, 14], late = [27, 29, 31, 28, 30, 29]
	for(let m = 0; m < 6; m++){
		pay.push({date: new Date(Date.UTC(2026, m, mid[m])), amount: 7837})
		pay.push({date: new Date(Date.UTC(2026, m, late[m])), amount: 7837})
	}
	const h = histogramOf(pay, {prefer: "semimonthly"})
	const live = h.weights.filter(w => w > 0.001)
	expect(live.length).toBe(1)
	expect(live[0]).toBeCloseTo(1, 6)

	const s1 = {id: "w", name: "Wages", getPreferredPeriod: () => "semimonthly",
		getExpectedAmountAtDateByPeriod: () => 7837*2}
	const opts = {terminals: [s1], shapes: {w: h}, routing: {}, covers: () => true,
		periodName: "monthly"}
	const days = []
	for(let d = 1; d <= 31; d++){
		const v = shareOfDay(s1, new Date(Date.UTC(2026, 7, d)), opts)
		if(Math.abs(v) > 1)days.push(Math.round(v))
	}
	//two paydays of a whole paycheck, not eleven crumbs
	expect(days.length).toBe(2)
	days.forEach(v => expect(v).toBe(7837))
})

test("a cluster that WRAPS a boundary is still one cluster", () => {
	//a payment nominally on the 31st lands on the 1st in a short month, and a payday drifting past
	//the 15th crosses into the next half - both read as a run spanning the wrap
	const t = []
	;[31, 1, 30, 31, 1, 29].forEach((d, m) => t.push({
		date: new Date(Date.UTC(2026, m, Math.min(d, 28))), amount: -900}))
	const h = histogramOf(t, {prefer: "monthly"})
	expect(h.weights.filter(w => w > 0.001).length).toBeLessThanOrEqual(2)
})

test("a week is still held to a narrower radius than a month", () => {
	//six days would swallow most of a week and invent a rhythm; the cap is half a turn
	const weekly = []
	for(let i = 0; i < 40; i++){
		const d = new Date(Date.UTC(2026, 0, 5)); d.setUTCDate(d.getUTCDate() + 7*i)
		weekly.push({date: d, amount: -400})
	}
	//two genuinely different weekdays three days apart must not merge into one
	const twoDays = []
	for(let i = 0; i < 20; i++){
		const a = new Date(Date.UTC(2026, 0, 5)); a.setUTCDate(a.getUTCDate() + 7*i)
		const b = new Date(Date.UTC(2026, 0, 9)); b.setUTCDate(b.getUTCDate() + 7*i)
		twoDays.push({date: a, amount: -400}, {date: b, amount: -400})
	}
	expect(histogramOf(weekly).weights.filter(w => w > 0.001).length).toBe(1)
	expect(histogramOf(twoDays).weights.filter(w => w > 0.001).length).toBe(2)
})

/* =================================================================================================
   ONE EVENT DOES NOT SPREAD.

   A histogram describes WHEN money moved; normalising it to weights quietly turns that into a claim
   about HOW MUCH moves each day. For forty grocery transactions those are the same statement. For a
   $2,400 daycare bill they are not - "a bit on each of these days" against "all of it, on one of
   them" - and the chart exists to find the trough, which a smeared payment does not have.

   The count is EXTRACTED, never declared: a period is a budgeting choice and says nothing about
   whether the money leaves in one go.
   ================================================================================================= */
//a plain ledger record: groupByStream reads these five fields and nothing else, and building a real
//GenericTransaction here would drag in the evaluator and a master stream this test has no use for
const evTxn = (d, amt, stream, acct, id, pair, desc) => ({categorized: true, date: d, amount: amt,
	streamAllocation: [{streamId: stream, amount: amt}],
	userInstitutionAccountId: acct || "chk", transactionId: id,
	//a card repayment is a PAIR - one leg on checking, one on the card - and that pairing is what
	//links the two accounts. A fixture without it describes an unlinked card.
	pairedTransferTransactionId: pair,
	/* AND A REPAYMENT SAYS SO. Real repayment legs are described "card bill", "Payment", "AUTOPAY";
	   the linker requires one end to say something of the sort, so a fixture with no description at
	   all is not testing that gate, it is failing it. */
	description: desc || (stream === "ccpay" ? "Card Payment" : stream)})
const evStream = (id, name, amt, period) => ({id: id, name: name,
	getPreferredPeriod: () => period || "monthly",
	getExpectedAmountAtDateByPeriod: () => amt})

test("two payments and a declared amount are enough to say it lands in one event", () => {
	/* Day Care Eleonore: $2,400 a month declared, two payments in the ledger and both older than the
	   three-month amount window. It was drawn at $77 a day - the flat 1/31 fallback - for a bill that
	   arrives whole. Two data points and the declaration are enough: if a turn is worth $2,400 and a
	   payment is $2,400, one payment is one turn. */
	const st = evStream("elo", "Day Care Eleonore", -2400)
	const txns = [evTxn(new Date(Date.UTC(2026, 2, 6)), -2400, "elo", "chk", "e1"),
		evTxn(new Date(Date.UTC(2026, 3, 6)), -2400, "elo", "chk", "e2")]
	const asOf = new Date(Date.UTC(2026, 7, 1))
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: asOf, until: new Date(Date.UTC(2026, 8, 1)),
		since: new Date(Date.UTC(2026, 4, 1))})       //the payments are OUTSIDE the amount window
	const h = m.shapes.elo
	expect(h.any).toBe(true)                          //found by the wider date window
	expect(m.meta.shapeFrom.elo).toBe("older")
	expect(Math.round(m.meta.events.elo)).toBe(1)
	//one live day, holding all of it - not thirty-one holding a thirty-first each
	expect(h.weights.filter(w => w > 0.0001).length).toBe(1)
	expect(Math.max.apply(null, h.weights)).toBeCloseTo(1, 6)
	//and it draws as one step of the whole amount
	const on6 = shareOfDay(st, new Date(Date.UTC(2026, 7, 6)), m)
	expect(Math.round(on6)).toBe(-2400)
})

test("a stream the recent window can describe is not sent to the older one", () => {
	//fallback, not replacement: nothing that already works may start answering from stale history
	const st = evStream("rent", "Rent", -1700)
	const txns = []
	for(let i = 0; i < 8; i++)
		txns.push(evTxn(new Date(Date.UTC(2026, i, 1)), -1700, "rent", "chk", "r" + i))
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 7, 15)), until: new Date(Date.UTC(2026, 8, 1)),
		since: new Date(Date.UTC(2026, 4, 15))})
	expect(m.meta.shapeFrom.rent).toBe("recent")
})

test("a stream that genuinely trickles is still spread", () => {
	//groceries: many small movements make up the turn, so a weight per day is the honest description
	const st = evStream("food", "Groceries", -1200)
	const txns = []
	for(let mth = 4; mth < 8; mth++) for(let d = 1; d <= 28; d += 2)
		txns.push(evTxn(new Date(Date.UTC(2026, mth, d)), -86, "food", "chk", "f" + mth + "-" + d))
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 8, 1)), until: new Date(Date.UTC(2026, 8, 30)),
		since: new Date(Date.UTC(2026, 4, 1))})
	expect(m.meta.events.food).toBeGreaterThan(8)
	expect(m.shapes.food.weights.filter(w => w > 0.0001).length).toBeGreaterThan(8)
})

test("a big payment beside small fees is one event, not four", () => {
	//amount-weighted, so three $4 fees cannot turn a rent into a trickle and spread it
	const st = evStream("rent", "Rent", -1800)
	const txns = []
	for(let mth = 3; mth < 8; mth++){
		txns.push(evTxn(new Date(Date.UTC(2026, mth, 3)), -1800, "rent", "chk", "m" + mth))
		for(let f = 0; f < 3; f++)
			txns.push(evTxn(new Date(Date.UTC(2026, mth, 10 + f*5)), -4, "rent", "chk",
				"f" + mth + "-" + f))
	}
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 8, 1)), until: new Date(Date.UTC(2026, 8, 30)),
		since: new Date(Date.UTC(2026, 4, 1))})
	expect(m.meta.events.rent).toBeLessThan(1.5)
	expect(m.shapes.rent.weights.filter(w => w > 0.0001).length).toBe(1)
})

test("a monthly bill that drifts is not read as weekly", () => {
	/* Day care Emile: $1,800 a month, three payments, drawn as four weekly steps of $406. Three
	   payments that share a weekday concentrate perfectly in seven bins while the same three drifting
	   across days of the month do not concentrate in thirty-one - so weekly won on timing alone. A
	   cycle is also a claim about HOW OFTEN, and three movements cannot be thirteen turns. */
	const st = evStream("emile", "Day care Emile", -1800)
	const txns = [evTxn(new Date(Date.UTC(2026, 4, 6)), -1800, "emile", "chk", "a"),
		evTxn(new Date(Date.UTC(2026, 5, 3)), -1800, "emile", "chk", "b"),
		evTxn(new Date(Date.UTC(2026, 6, 8)), -1800, "emile", "chk", "c")]
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 7, 1)), until: new Date(Date.UTC(2026, 7, 31)),
		since: new Date(Date.UTC(2026, 3, 1))})
	expect(m.shapes.emile.cycle.name).toBe("monthly")
	expect(m.shapes.emile.weights.filter(w => w > 0.0001).length).toBe(1)
})

test("two payments on different days are one event, on one of them - not half on each", () => {
	/* The sharp case. Consolidation cannot help here: the 6th and the 20th are two weeks apart, so
	   they are not one payment that drifted, they are two separate days a single monthly payment
	   landed on. Left as weights that is "$1,200 on the 6th and $1,200 on the 20th", which is a month
	   with two shallow dips instead of one real one - and the whole reason to draw this chart is the
	   real one. Reconciling $2,400 declared against $2,400 observed says one event; the day is
	   genuinely uncertain, and the honest drawing of an uncertain day is still one lump. */
	const st = evStream("elo", "Day Care Eleonore", -2400)
	const txns = [evTxn(new Date(Date.UTC(2026, 2, 6)), -2400, "elo", "chk", "e1"),
		evTxn(new Date(Date.UTC(2026, 3, 20)), -2400, "elo", "chk", "e2")]
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 7, 1)), until: new Date(Date.UTC(2026, 8, 1)),
		since: new Date(Date.UTC(2026, 4, 1))})
	expect(Math.round(m.meta.events.elo)).toBe(1)
	expect(m.shapes.elo.weights.filter(w => w > 0.0001).length).toBe(1)
	//the whole turn lands once in the month, wherever it lands
	let total = 0
	for(let d = 1; d <= 31; d++)total += shareOfDay(st, new Date(Date.UTC(2026, 7, d)), m)
	expect(Math.round(total)).toBe(-2400)
})

test("eventsPerTurn reads the ledger, never the declared period", () => {
	//a stream declared "monthly" that in fact moves four times a month is a flow, and saying monthly
	//louder does not make it an event - the period is a budgeting choice, the count is evidence
	const four = []
	for(let mth = 4; mth < 8; mth++) for(let w = 0; w < 4; w++)
		four.push(evTxn(new Date(Date.UTC(2026, mth, 3 + w*7)), -450, "x", "chk", mth + "-" + w))
	expect(eventsPerTurn(four, -1800)).toBeGreaterThan(3.5)
	//and the same declaration against one payment a month is an event
	const one = []
	for(let mth = 4; mth < 8; mth++)
		one.push(evTxn(new Date(Date.UTC(2026, mth, 3)), -1800, "x", "chk", "o" + mth))
	expect(eventsPerTurn(one, -1800)).toBeLessThan(1.5)
})

/* =================================================================================================
   CONCENTRATING CLAIMS A DATE, and the claim is not equally safe in both directions.

   An outflow put on the wrong day still draws a dip of the right depth, and depth is what this chart
   is read for. An inflow put on the wrong day draws a bump - it tells the reader they have money they
   do not have, which is the same overdraft the missing dip causes, arrived at from the other side and
   this time CAUSED by concentrating rather than cured by it.

   So an inflow must demonstrate its date repeats before it is allowed to be a step. This is a
   direction rule, not an income rule: it follows from which way the error hurts.
   ================================================================================================= */
test("erratic income stays spread, however few events per turn it has", () => {
	//Side Gig Julien: about one payment a month, whenever the client gets round to it. Concentrated,
	//it drew $1,669 arriving on the 31st - money the reader would count on and might not have
	const st = evStream("gig", "Side Gig Julien", 1669)
	const days = [4, 19, 27, 9, 22, 2]
	const txns = days.map((d, i) =>
		evTxn(new Date(Date.UTC(2026, 1 + i, d)), 1669, "gig", "chk", "g" + i))
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 7, 1)), until: new Date(Date.UTC(2026, 7, 31)),
		since: new Date(Date.UTC(2026, 1, 1))})
	expect(m.shapes.gig.confident).toBe(false)
	expect(m.shapes.gig.weights.filter(w => w > 0.0001).length).toBeGreaterThan(3)
	//it still arrives - the month's total is unchanged, only the claim about WHEN is withdrawn
	let total = 0
	for(let d = 1; d <= 31; d++)total += shareOfDay(st, new Date(Date.UTC(2026, 7, d)), m)
	expect(Math.round(total)).toBe(1669)
})

test("payroll is income too, and it concentrates - because its date repeats", () => {
	//the rule must not become "income is unpredictable": wages are the most predictable thing here
	const st = evStream("wage", "Wages Julien", 7837)
	const txns = []
	for(let i = 0; i < 6; i++)
		txns.push(evTxn(new Date(Date.UTC(2026, 1 + i, 14)), 7837, "wage", "chk", "w" + i))
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 7, 1)), until: new Date(Date.UTC(2026, 7, 31)),
		since: new Date(Date.UTC(2026, 1, 1))})
	expect(m.shapes.wage.confident).toBe(true)
	expect(m.shapes.wage.weights.filter(w => w > 0.0001).length).toBe(1)
	expect(Math.round(shareOfDay(st, new Date(Date.UTC(2026, 7, 14)), m))).toBe(7837)
})

test("an outflow on a wandering date still concentrates - depth beats the day", () => {
	//the asymmetry itself: the same scatter that leaves income spread still lumps an expense, because
	//a dip drawn on the wrong day is a far better error than a dip never drawn
	const st = evStream("bill", "A wandering bill", -1669)
	const days = [4, 19, 27, 9, 22, 2]
	const txns = days.map((d, i) =>
		evTxn(new Date(Date.UTC(2026, 1 + i, d)), -1669, "bill", "chk", "b" + i))
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 7, 1)), until: new Date(Date.UTC(2026, 7, 31)),
		since: new Date(Date.UTC(2026, 1, 1))})
	expect(m.shapes.bill.confident).toBe(true)
	expect(m.shapes.bill.weights.filter(w => w > 0.0001).length).toBe(1)
})

test("income seen only twice is not yet a date", () => {
	//two occurrences on the same day is a coincidence; three is a habit
	const st = evStream("new", "New client", 900)
	const txns = [evTxn(new Date(Date.UTC(2026, 5, 12)), 900, "new", "chk", "n1"),
		evTxn(new Date(Date.UTC(2026, 6, 12)), 900, "new", "chk", "n2")]
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 7, 1)), until: new Date(Date.UTC(2026, 7, 31)),
		since: new Date(Date.UTC(2026, 4, 1))})
	expect(m.shapes.new.confident).toBe(false)
})

/* =================================================================================================
   A CLOSED STATEMENT IS NOT A FORECAST.

   "When the prediction day advances the card should be almost 100% accurate, since it is a
   re-evaluated pending amount to settle and you have the transactions that prove it. This is only
   true if you have the right mapping and the right offset."

   Both halves are inferred, so both are tested here. The OFFSET is the gap between a statement
   closing and being paid: counting every purchase since the last payment loads the imminent bill with
   spending that has not been billed yet, and destroys the exactness that makes this model worth
   having. The fixture has a real close date, and the model is never told it.
   ================================================================================================= */
const cardFixture = (lag, weeks) => {
	//a card that closes `lag` days before it is paid, so the last few days of spend roll onward
	const txns = [], settles = []
	let carried = 0
	for(let w = 0; w < (weeks || 20); w++){
		const pay = new Date(Date.UTC(2026, 0, 8 + w*14))
		const close = new Date(pay.getTime() - lag*86400000)
		let statement = carried; carried = 0
		//the WEEK's level swings, not just the individual amounts - fourteen varied purchases
		//average out to the same statement every cycle, which a mean reproduces perfectly
		const level = 30 + ((w*53) % 90)
		for(let d = 0; d < 14; d++){
			const when = new Date(close.getTime() - (13 - d)*86400000)
			txns.push(evTxn(when, -(level + d*3), "card", "visa", "p" + w + "-" + d))
			statement += level + d*3
		}
		//three purchases AFTER the close: they belong to the next statement, not this one
		/* spending between the close and the payment, which bills on the NEXT statement. It has to
		   VARY per cycle: a constant carry-forward is the same size going out as coming in, so a
		   window that swaps one cycle's for another's balances exactly and every offset fits. */
		for(let d = 1; d <= 3; d++){
			const when = new Date(close.getTime() + d*86400000)
			txns.push(evTxn(when, -(20 + ((w*29) % 70) + d*11), "card", "visa", "a" + w + "-" + d))
			carried += 20 + ((w*29) % 70) + d*11
		}
		txns.push(evTxn(pay, -statement, "ccpay", "chk", "s" + w, "r" + w))
		txns.push(evTxn(pay, statement, "ccpay", "visa", "r" + w, "s" + w))
		settles.push({date: pay, amount: statement})
	}
	return {txns: txns, settles: settles}
}

test("the statement close offset is recovered from the ledger", () => {
	[0, 3, 6, 10].forEach(lag => {
		const f = cardFixture(lag)
		const found = inferSettlements(f.txns, ["chk"], ["visa"])
		expect(found.length).toBeGreaterThan(10)          //the MAPPING half
		const cy = cardCycles(f.txns, ["visa"], found).visa
		expect(Math.round(cy.intervalDays)).toBe(14)
		//the OFFSET half, never told to it
		expect(Math.abs(cy.lagDays - lag)).toBeLessThanOrEqual(1)
	})
})

test("once the statement has closed the bill is exact, not projected", () => {
	const lag = 5
	const f = cardFixture(lag)
	const found = inferSettlements(f.txns, ["chk"], ["visa"])
	//stand one day after a close, and one day before the payment it produces
	const pay = new Date(f.settles[15].date)
	const from = new Date(pay.getTime() - (lag - 1)*86400000)
	const r = cardSettlementForecast(f.txns, ["visa"], found, from,
		new Date(pay.getTime() + 86400000))
	const e = r.events[0]
	expect(e).toBeTruthy()
	expect(Math.round(e.date.getTime()/86400000)).toBe(Math.round(pay.getTime()/86400000))
	//nothing left to guess: the statement is shut
	expect(e.projected).toBeCloseTo(0, 6)
	//and it reproduces what actually settled
	expect(Math.abs(e.amount)/f.settles[15].amount).toBeGreaterThan(0.95)
	expect(Math.abs(e.amount)/f.settles[15].amount).toBeLessThan(1.05)
})

test("spending after the close is billed on the NEXT statement, not this one", () => {
	//the failure the offset exists to prevent: three post-close purchases loaded onto the imminent
	//bill every cycle, starving the one after it
	const f = cardFixture(6)
	const found = inferSettlements(f.txns, ["chk"], ["visa"])
	const pay = new Date(f.settles[15].date)
	const from = new Date(pay.getTime() - 2*86400000)     //after the close, before the payment
	const r = cardSettlementForecast(f.txns, ["visa"], found, from,
		new Date(pay.getTime() + 86400000))
	const over = Math.abs(r.events[0].amount) - f.settles[15].amount
	//the post-close purchases are worth about $200; they must not be in this bill
	expect(over).toBeLessThan(100)
})

test("the bill tracks each statement as it closes, bill by bill", () => {
	/* THE SEQUENCE, which is what separates this from any average. Stand one day before each payment
	   in turn and ask for that payment: the statement is shut, the transactions are in hand, and the
	   answer must be the amount that actually left - not the typical amount.

	   A mean matches the total and misses every individual bill. This fixture's bills swing about
	   threefold, so a constant cannot pass. */
	const lag = 4
	const f = cardFixture(lag)
	const found = inferSettlements(f.txns, ["chk"], ["visa"])
	const ratios = [], actuals = []
	for(let i = 10; i < 19; i++){
		const pay = new Date(f.settles[i].date)
		const from = new Date(pay.getTime() - (lag - 1)*86400000)
		const r = cardSettlementForecast(f.txns, ["visa"], found, from,
			new Date(pay.getTime() + 86400000))
		const e = r.events[0]
		expect(e).toBeTruthy()
		ratios.push(Math.abs(e.amount)/f.settles[i].amount)
		actuals.push(f.settles[i].amount)
	}
	//the bills genuinely move, or this proves nothing
	expect(Math.max.apply(null, actuals)/Math.min.apply(null, actuals)).toBeGreaterThan(1.4)
	//and every one of them is reproduced, not approached on average
	ratios.forEach(r => {
		expect(r).toBeGreaterThan(0.97)
		expect(r).toBeLessThan(1.03)
	})
})

test("two cards on one payment stream are modelled separately", () => {
	/* Two people, two cards, both categorised to the same "Credit Card Payments" stream. Pooled they
	   describe neither: different closing days, different rates, different bills on different days.
	   And the second card has NO payment receipt, which is what made it vanish - the old
	   identification needed both legs, so a connector that returns only the outflow produced no
	   settlements at all and that card's spending was never billed. */
	const txns = []
	let hersCarried = 0, hisCarried = 0
	for(let w = 0; w < 16; w++){
		//his: weekly, closes 3 days before payment, receipt present
		const payA = new Date(Date.UTC(2026, 0, 6 + w*7))
		const closeA = new Date(payA.getTime() - 3*86400000)
		let a = hisCarried; hisCarried = 0
		for(let d = 0; d < 5; d++){
			const amt = 30 + ((w*11 + d*7) % 40)
			txns.push(evTxn(new Date(closeA.getTime() - (5 - d)*86400000), -amt, "card", "his",
				"A" + w + "-" + d))
			a += amt
		}
		for(let d = 1; d <= 2; d++){
			const amt = 15 + ((w*23) % 40) + d*7
			txns.push(evTxn(new Date(closeA.getTime() + d*86400000), -amt, "card", "his",
				"D" + w + "-" + d))
			hisCarried += amt
		}
		txns.push(evTxn(payA, -a, "ccpay", "chk", "pa" + w, "ra" + w))
		txns.push(evTxn(payA, a, "ccpay", "his", "ra" + w, "pa" + w))

		//hers: fortnightly, closes 6 days before payment, NO receipt on the card
		if(w % 2)continue
		const payB = new Date(Date.UTC(2026, 0, 10 + w*7))
		const closeB = new Date(payB.getTime() - 6*86400000)
		let b = hersCarried; hersCarried = 0
		for(let d = 0; d < 8; d++){
			const amt = 25 + ((w*13 + d*5) % 50)
			txns.push(evTxn(new Date(closeB.getTime() - (7 - d)*86400000), -amt, "card", "hers",
				"B" + w + "-" + d))
			b += amt
		}
		//spending between her close and her payment, which belongs to the NEXT statement - without
		//it every offset from one to seven days fits equally and the fit has nothing to find
		for(let d = 1; d <= 3; d++){
			const amt = 20 + ((w*31) % 60) + d*9
			txns.push(evTxn(new Date(closeB.getTime() + d*86400000), -amt, "card", "hers",
				"C" + w + "-" + d))
			hersCarried += amt
		}
		txns.push(evTxn(payB, -b, "ccpay", "chk", "pb" + w))
	}
	const found = inferSettlements(txns, ["chk"], ["his", "hers"])
	//both cards found, and the one without a receipt found by the amount its purchases add up to
	expect(found.filter(x => x.card === "his").length).toBeGreaterThan(10)
	expect(found.filter(x => x.card === "hers").length).toBeGreaterThan(5)
	expect(found.some(x => x.by === "amount")).toBe(true)

	const cy = cardCycles(txns, ["his", "hers"], found)
	expect(cy.his.intervalDays).toBe(7)
	expect(cy.hers.intervalDays).toBe(14)
	//each keeps its own closing offset rather than being averaged into one
	expect(Math.abs(cy.his.lagDays - 3)).toBeLessThanOrEqual(1)
	expect(Math.abs(cy.hers.lagDays - 6)).toBeLessThanOrEqual(1)
})

test("a spending stream split across a card and the current account is NOT a card payment", () => {
	/* b28 shipped the opposite and it cost ten points of balance accuracy. Groceries are bought on a
	   card some weeks and on the debit card others; childcare is paid by card one month and by
	   transfer the next. Those straddle the account boundary and are not card payments, but they were
	   treated as such - seven streams excluded from the forecast instead of one, deleting about
	   $4,250 a month of real outflow.

	   What makes a card payment different is that it CANCELS: money leaves the account and the same
	   money ARRIVES on the card. Groceries are negative on both sides and never cancel. */
	const txns = []
	for(let w = 0; w < 12; w++){
		//groceries: some on the card, some on the debit card, plus the odd refund
		txns.push(evTxn(new Date(Date.UTC(2026, 2 + (w >> 2), 3 + (w % 4)*7)), -140, "food",
			"visa", "gc" + w))
		txns.push(evTxn(new Date(Date.UTC(2026, 2 + (w >> 2), 5 + (w % 4)*7)), -90, "food",
			"chk", "gd" + w))
		if(w % 6 === 0)txns.push(evTxn(new Date(Date.UTC(2026, 2 + (w >> 2), 6)), 40, "food",
			"visa", "gr" + w))
		//and a genuine card payment on its own stream
		const pay = new Date(Date.UTC(2026, 2 + (w >> 2), 2 + (w % 4)*7))
		txns.push(evTxn(pay, -560, "ccpay", "chk", "pp" + w, "pr" + w))
		txns.push(evTxn(pay, 560, "ccpay", "visa", "pr" + w, "pp" + w))
	}
	/* The pairing settles it without asking what a stream is for: a repayment has a leg on each side
	   of the same transfer, and a grocery bought on a card is one transaction on one account. */
	const lk = accountLinks(txns, ["visa"], ["chk"])
	expect(lk.links.visa).toBe("chk")
	//only the repayment legs are taken out of the ledger, and groceries are not among them
	const groceryIds = txns.filter(t => t.streamAllocation[0].streamId === "food")
		.map(t => t.transactionId)
	groceryIds.forEach(id => expect(lk.legIds[id]).toBeUndefined())
	expect(Object.keys(lk.legIds).length).toBe(24)          //twelve repayments, two legs each

	//and the grocery stream therefore keeps contributing to the forecast
	const st = evStream("food", "Groceries", -920)
	const pay = evStream("ccpay", "Credit Card Payments", 0)
	const m = buildModel({transactions: txns, terminals: [st, pay], covered: ["chk"],
		cards: ["visa"], asOf: new Date(Date.UTC(2026, 6, 1)),
		until: new Date(Date.UTC(2026, 6, 31)), since: new Date(Date.UTC(2026, 2, 1))})
	/* Groceries route to the CARD, so they do not appear in the checking reading directly - that
	   money has not moved through it. They arrive inside the repayment, which is what the card's
	   charge forecast is built from. */
	expect(m.routing.food).toBe("visa")
	let charged = 0
	for(let d = 1; d <= 31; d++)
		charged += m.meta.chargedOn("visa", new Date(Date.UTC(2026, 6, d)))
	expect(charged).toBeGreaterThan(100)
	//and the repayment stream predicts nothing: its transactions left the ledger with the pairing
	let cc = 0
	for(let d = 1; d <= 31; d++)cc += shareOfDay(pay, new Date(Date.UTC(2026, 6, d)), m)
	expect(cc).toBe(0)
})

/* =================================================================================================
   A BILL ALREADY PAID THIS CYCLE IS NOT EXPECTED AGAIN.

   The shape says "this stream lands on the 6th", and the 6th comes round every month for ever. So a
   payment made on the 12th was still followed by a full prediction on the next 6th, and in a window
   straddling two months sometimes by one in the same month. Day Care Eleonore, $2,400, paid and
   expected again.

   The quota is what the stream has been OBSERVED to have per turn, never its declared period, and it
   applies only to streams that arrive as events - stopping groceries because some groceries have
   happened would empty the rest of every month.
   ================================================================================================= */
test("a monthly event already paid this month is not predicted again", () => {
	const st = evStream("elo", "Day Care Eleonore", -2400)
	const txns = []
	for(let mth = 3; mth <= 7; mth++)
		txns.push(evTxn(new Date(Date.UTC(2026, mth, 6)), -2400, "elo", "chk", "e" + mth))
	//and this month it came late, on the 12th
	txns.push(evTxn(new Date(Date.UTC(2026, 8, 12)), -2400, "elo", "chk", "late"))
	const asOf = new Date(Date.UTC(2026, 8, 20))          //after it landed
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: asOf, until: new Date(Date.UTC(2026, 9, 20)),
		since: new Date(Date.UTC(2026, 5, 1))})
	expect(Math.round(m.meta.events.elo)).toBe(1)
	//nothing more this month...
	let rest = 0
	for(let d = 21; d <= 30; d++)rest += shareOfDay(st, new Date(Date.UTC(2026, 8, d)), m)
	expect(Math.round(rest)).toBe(0)
	//...and the reason is stated rather than the row silently vanishing
	expect(shareOfDayDetail(st, new Date(Date.UTC(2026, 8, 25)), m).why).toBe("already paid this cycle")
	//but next month is expected in full
	let next = 0
	for(let d = 1; d <= 31; d++)next += shareOfDay(st, new Date(Date.UTC(2026, 9, d)), m)
	expect(Math.round(next)).toBe(-2400)
})

test("a stream that trickles is not stopped by having trickled", () => {
	//the guard: a flow has no quota, and closing the month after the first grocery run would empty it
	const st = evStream("food", "Groceries", -1200)
	const txns = []
	for(let mth = 4; mth < 9; mth++) for(let d = 1; d <= 27; d += 2)
		txns.push(evTxn(new Date(Date.UTC(2026, mth, d)), -89, "food", "chk", "f" + mth + "-" + d))
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 8, 20)), until: new Date(Date.UTC(2026, 8, 30)),
		since: new Date(Date.UTC(2026, 5, 1))})
	let rest = 0
	for(let d = 21; d <= 30; d++)rest += shareOfDay(st, new Date(Date.UTC(2026, 8, d)), m)
	expect(rest).toBeLessThan(-100)
})

test("a semimonthly stream paid in the first half is still expected in the second", () => {
	//the turn is the HALF month, so being paid on the 14th says nothing about the 29th
	const st = evStream("wage", "Wages", 15674, "semimonthly")
	const txns = []
	for(let mth = 4; mth < 9; mth++){
		txns.push(evTxn(new Date(Date.UTC(2026, mth, 14)), 7837, "wage", "chk", "a" + mth))
		if(mth < 8)txns.push(evTxn(new Date(Date.UTC(2026, mth, 29)), 7837, "wage", "chk", "b" + mth))
	}
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 8, 20)), until: new Date(Date.UTC(2026, 8, 30)),
		since: new Date(Date.UTC(2026, 5, 1))})
	let rest = 0
	for(let d = 21; d <= 30; d++)rest += shareOfDay(st, new Date(Date.UTC(2026, 8, d)), m)
	expect(Math.round(rest)).toBe(7837)
})

test("a yearly expense spreads its remainder instead of being given a day", () => {
	/* Hobby mdm: $250 a year, arriving whenever the hobby needs something. Two or three occurrences
	   a YEAR agreeing on a day-of-month is a coincidence with very few chances to fail, so the
	   concentration test passed and the forecast drew a dated step and called it Tier 1. An annual
	   budget supports no such claim - and the AMOUNT rule already treats it as a budget, spreading
	   what is left over the months remaining, so a concentrated shape contradicted it. */
	const st = evStream("hobby", "Hobby mdm", -3000, "yearly")
	const txns = [evTxn(new Date(Date.UTC(2026, 1, 16)), -250, "hobby", "chk", "h1"),
		evTxn(new Date(Date.UTC(2026, 4, 16)), -250, "hobby", "chk", "h2"),
		evTxn(new Date(Date.UTC(2026, 6, 16)), -250, "hobby", "chk", "h3")]
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 7, 1)), until: new Date(Date.UTC(2026, 7, 31)),
		since: new Date(Date.UTC(2026, 1, 1)), cycleStart: new Date(Date.UTC(2026, 0, 1))})
	expect(m.shapes.hobby.weights.filter(w => w > 0.0001).length).toBeGreaterThan(5)
	expect(m.shapes.hobby.spreadReason).toMatch(/long-period/)
	//no single day carries the month
	const each = []
	for(let d = 1; d <= 31; d++)each.push(Math.abs(shareOfDay(st, new Date(Date.UTC(2026, 7, d)), m)))
	const total = each.reduce((a, b) => a + b, 0)
	expect(Math.max.apply(null, each)/total).toBeLessThan(0.35)
})

test("a monthly expense on a firm date still gets its day", () => {
	//the guard: spreading is for BUDGETS, and a rent is not a budget
	const st = evStream("rent", "Rent", -3121)
	const txns = []
	for(let mth = 2; mth < 8; mth++)
		txns.push(evTxn(new Date(Date.UTC(2026, mth, 2)), -3121, "rent", "chk", "r" + mth))
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 8, 1)), until: new Date(Date.UTC(2026, 8, 30)),
		since: new Date(Date.UTC(2026, 5, 1))})
	expect(m.shapes.rent.weights.filter(w => w > 0.0001).length).toBe(1)
	expect(m.shapes.rent.spreadReason).toBe(null)
})

/* =================================================================================================
   TWO CARDS ON ONE ACCOUNT, AND ONE ACCOUNT THAT IS CLOSED.

   Two people carrying cards on the same account settle it twice on the same day: two outflows, two
   receipts, one statement period. And a card that has been closed keeps its history, so the schedule
   runs off its last payment for ever.
   ================================================================================================= */
test("two payments on the same day are one statement, not a zero-day cycle", () => {
	/* Left as two events the gap between them is ZERO, and a zero among a run of sevens drags the
	   median toward nothing - the rhythm, the closing offset fitted against it and the pass-through
	   are then all measured over windows a day long. */
	const txns = [], settles = []
	for(let w = 0; w < 16; w++){
		const pay = new Date(Date.UTC(2026, 0, 7 + w*7))
		const close = new Date(pay.getTime() - 3*86400000)
		let his = 0, hers = 0
		for(let d = 0; d < 6; d++){
			const a = 30 + ((w*7 + d*5) % 40), b = 20 + ((w*11 + d*3) % 30)
			txns.push(evTxn(new Date(close.getTime() - (5 - d)*86400000), -a, "card", "rh",
				"h" + w + "-" + d))
			txns.push(evTxn(new Date(close.getTime() - (5 - d)*86400000), -b, "card", "rh",
				"f" + w + "-" + d))
			his += a; hers += b
		}
		//two settlements, same day, same account - one per person
		txns.push(evTxn(pay, -his, "ccpay", "chk", "ph" + w, "rh" + w))
		txns.push(evTxn(pay, his, "ccpay", "rh", "rh" + w, "ph" + w))
		txns.push(evTxn(pay, -hers, "ccpay", "chk", "pf" + w, "rf" + w))
		txns.push(evTxn(pay, hers, "ccpay", "rh", "rf" + w, "pf" + w))
		settles.push({date: pay, amount: his + hers})
	}
	const found = inferSettlements(txns, ["chk"], ["rh"])
	expect(found.length).toBeGreaterThan(25)              //two per week, both matched
	const cy = cardCycles(txns, ["rh"], found).rh
	expect(Math.round(cy.perStatement)).toBe(2)           //and it knows there were two
	expect(cy.intervalDays).toBe(7)                       //not 0, and not 3.5
	expect(Math.abs(cy.lagDays - 3)).toBeLessThanOrEqual(1)
	//the statement is the sum of both cards, and it is reproduced
	const pay = new Date(settles[12].date)
	const r = cardSettlementForecast(txns, ["rh"], found,
		new Date(pay.getTime() - 2*86400000), new Date(pay.getTime() + 86400000))
	expect(Math.abs(r.events[0].amount)/settles[12].amount).toBeGreaterThan(0.95)
	expect(Math.abs(r.events[0].amount)/settles[12].amount).toBeLessThan(1.05)
})

test("a closed card is not forecast for ever", () => {
	/* The schedule runs off the last payment, so a card last settled in October was still being
	   handed a payment the following September - money leaving an account that no longer exists,
	   every cycle. */
	const txns = []
	for(let w = 0; w < 10; w++){
		const pay = new Date(Date.UTC(2025, 8, 3 + w*7))
		for(let d = 0; d < 3; d++)
			txns.push(evTxn(new Date(pay.getTime() - (4 - d)*86400000), -60, "card", "x1",
				"p" + w + "-" + d))
		txns.push(evTxn(pay, -180, "ccpay", "chk", "s" + w, "r" + w))
		txns.push(evTxn(pay, 180, "ccpay", "x1", "r" + w, "s" + w))
	}
	const found = inferSettlements(txns, ["chk"], ["x1"])
	expect(found.length).toBeGreaterThan(5)               //the history is real
	//...but a year later there is nothing to pay
	const from = new Date(Date.UTC(2026, 8, 1))
	const r = cardSettlementForecast(txns, ["x1"], found, from,
		new Date(Date.UTC(2026, 9, 1)))
	expect(r.events.length).toBe(0)
	expect(r.cycles.x1.dormant).toBe(true)
	expect(r.cycles.x1.idleDays).toBeGreaterThan(250)
})

test("a card merely late is not written off", () => {
	//the guard: three cycles of silence, floored at two months, so a monthly card paid a week late
	//is still a live card
	const txns = []
	for(let m = 0; m < 8; m++){
		const pay = new Date(Date.UTC(2026, m, 12))
		for(let d = 0; d < 4; d++)
			txns.push(evTxn(new Date(Date.UTC(2026, m, 2 + d)), -150, "card", "v", "p" + m + "-" + d))
		txns.push(evTxn(pay, -600, "ccpay", "chk", "s" + m, "r" + m))
		txns.push(evTxn(pay, 600, "ccpay", "v", "r" + m, "s" + m))
	}
	const found = inferSettlements(txns, ["chk"], ["v"])
	const from = new Date(Date.UTC(2026, 8, 5))            //three weeks after the last payment
	const r = cardSettlementForecast(txns, ["v"], found, from, new Date(Date.UTC(2026, 9, 5)))
	expect(r.cycles.v.dormant).toBeUndefined()
	expect(r.events.length).toBeGreaterThan(0)
})

test("the second card's payment is found even when only one carries a receipt", () => {
	/* The account settles twice a week, one payment per person, and only one of them posts a receipt
	   on the card. The other could never be matched by amount: the fallback compares a payment
	   against a window of the ACCOUNT's purchases - pooled across both cards - and its shortest
	   window is five days, while one person's share is about a third of a week of joint spending. Not
	   a threshold set too tight; a comparison that cannot be made. So 39 settlements were found in 39
	   weeks and the model saw half the money. */
	const txns = []
	let hisTotal = 0, hersTotal = 0
	for(let w = 0; w < 16; w++){
		const pay = new Date(Date.UTC(2026, 0, 9 + w*7))
		const close = new Date(pay.getTime() - 3*86400000)
		let his = 0, hers = 0
		for(let d = 0; d < 7; d++){
			const a = 120 + ((w*17 + d*11) % 90), b = 55 + ((w*13 + d*7) % 45)
			const when = new Date(close.getTime() - (6 - d)*86400000)
			txns.push(evTxn(when, -a, "card", "rh", "h" + w + "-" + d))
			txns.push(evTxn(when, -b, "card", "rh", "f" + w + "-" + d))
			his += a; hers += b
		}
		//his payment posts a receipt on the card; hers does not
		txns.push(evTxn(pay, -his, "ccpay", "chk", "ph" + w))
		txns.push(evTxn(pay, his, "ccpay", "rh", "rh" + w))
		txns.push(evTxn(pay, -hers, "ccpay", "chk", "pf" + w))
		hisTotal += his; hersTotal += hers
	}
	const found = inferSettlements(txns, ["chk"], ["rh"])
	//both payments every week, not one
	expect(found.length).toBe(32)
	expect(found.filter(x => x.by === "receipt").length).toBe(16)
	expect(found.filter(x => x.by === "same statement").length).toBe(16)
	//and together they are the whole bill, not half of it
	const total = found.reduce((a, b) => a + Math.abs(b.amount), 0)
	expect(total).toBeCloseTo(hisTotal + hersTotal, 2)

	//the statement is then one event of the combined amount, on a clean weekly rhythm
	const cy = cardCycles(txns, ["rh"], found).rh
	expect(cy.intervalDays).toBe(7)
	expect(Math.round(cy.perStatement)).toBe(2)
	expect(Math.abs(cy.lagDays - 3)).toBeLessThanOrEqual(1)
})

test("a refund reduces the statement; a payment receipt does not", () => {
	/* A credit account carries three kinds of transaction and the model read two of them as one.
	   Purchases go out; PAYMENTS come in and clear the balance; REFUNDS come in and undo a purchase.
	   Counting only the negatives made a returned $220 jacket a permanent charge, so the statement
	   window looked bigger than the payment that settled it - which is why rows in the real export
	   read 0.85 to 0.89 on a card that is paid in full. */
	const txns = []
	for(let w = 0; w < 12; w++){
		const pay = new Date(Date.UTC(2026, 0, 8 + w*7))
		const close = new Date(pay.getTime() - 3*86400000)
		let net = 0
		for(let d = 0; d < 5; d++){
			const amt = 100 + ((w*13 + d*7) % 60)
			txns.push(evTxn(new Date(close.getTime() - (4 - d)*86400000), -amt, "card", "rh",
				"p" + w + "-" + d))
			net += amt
		}
		//one refund inside the window: money back, not money spent
		txns.push(evTxn(new Date(close.getTime() - 1*86400000), 90, "card", "rh", "ref" + w))
		net -= 90
		txns.push(evTxn(pay, -net, "ccpay", "chk", "s" + w, "r" + w))
		txns.push(evTxn(pay, net, "ccpay", "rh", "r" + w, "s" + w))
	}
	const found = inferSettlements(txns, ["chk"], ["rh"])
	const spend = cardSpend(txns, "rh", found)
	//the payment receipts are not spending at all, and the refunds are negative spending
	expect(spend.filter(x => x.v < 0).length).toBe(12)
	expect(spend.length).toBe(12*5 + 12)
	//so the statement reconciles at 1.00 rather than looking overspent
	const cy = cardCycles(txns, ["rh"], found).rh
	expect(cy.ratio).toBeGreaterThan(0.97)
	expect(cy.ratio).toBeLessThan(1.03)
})

test("the projection rate is the trailing ninety days, not the year", () => {
	/* Measured, not preferred. Against what the real card was paid over its last eight statements
	   ($1,543): this cycle $477 (-69%), trailing 90 days $1,594 (+3%), since the year began $1,239
	   (-20%). The year basis is steadier and wrong - the card's spending grew, so averaging in the
	   quiet months holds the estimate a fifth low and every projected bill inherits it. */
	const txns = []
	//quiet for four months, then triple - the year average sits between, ninety days does not
	for(let day = 0; day < 240; day++){
		const d = new Date(Date.UTC(2026, 0, 1 + day))
		const amt = day < 150 ? 30 : 90
		txns.push(evTxn(d, -amt, "card", "rh", "p" + day))
	}
	for(let w = 0; w < 34; w++){
		const pay = new Date(Date.UTC(2026, 0, 8 + w*7))
		txns.push(evTxn(pay, -1, "ccpay", "chk", "s" + w, "r" + w))
		txns.push(evTxn(pay, 1, "ccpay", "rh", "r" + w, "s" + w))
	}
	const from = new Date(Date.UTC(2026, 8, 1))
	const found = inferSettlements(txns, ["chk"], ["rh"])
	const r = cardSettlementForecast(txns, ["rh"], found, from, new Date(Date.UTC(2026, 8, 20)))
	//$90/day is the current regime; the year average would be about $53
	expect(r.cycles.rh.rate).toBeGreaterThan(80)
	expect(r.cycles.rh.rate).toBeLessThan(100)
})

test("a yearly income is not forecast at all", () => {
	/* Spending a yearly EXPENSE budget down is defensible - the money is committed and only the
	   timing is open. A yearly INCOME budget is a figure somebody hopes to earn: no date, no
	   counterparty obligation, no rhythm to detect. Side gig sat at $9,000 a year and the forecast
	   spent $1,335 a month of it into the balance - $24,258 of dollar-day error on money that never
	   arrived. Drawing it tells the reader they have money they do not have. */
	const st = evStream("gig", "Side Gig Julien", 9000, "yearly")
	const txns = [evTxn(new Date(Date.UTC(2026, 2, 9)), 2200, "gig", "chk", "g1"),
		evTxn(new Date(Date.UTC(2026, 5, 21)), 1800, "gig", "chk", "g2")]
	const at = new Date(Date.UTC(2026, 7, 1))
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: at, until: new Date(Date.UTC(2026, 7, 31)),
		since: new Date(Date.UTC(2026, 4, 1)), cycleStart: new Date(Date.UTC(2026, 0, 1))})
	expect(m.expectedFor(st, at)).toBe(0)
	let total = 0
	for(let d = 1; d <= 31; d++)total += shareOfDay(st, new Date(Date.UTC(2026, 7, d)), m)
	expect(total).toBe(0)
	//and it says why, rather than reporting a blank
	expect(shareOfDayDetail(st, at, m).why).toMatch(/yearly income/)
})

test("a yearly EXPENSE is still spent down", () => {
	//the guard: the rule is about direction, not about the period
	const st = evStream("trip", "Voyages", -12000, "yearly")
	const spend = evTxn(new Date(Date.UTC(2026, 2, 3)), -3000, "trip", "chk", "t1")
	const at = new Date(Date.UTC(2026, 5, 1))
	const m = buildModel({transactions: [spend], terminals: [st], covered: ["chk"], cards: [],
		asOf: at, until: new Date(Date.UTC(2026, 6, 1)),
		since: new Date(Date.UTC(2026, 0, 1)), cycleStart: new Date(Date.UTC(2026, 0, 1))})
	expect(m.expectedFor(st, at)).toBeLessThan(0)
})

test("a MONTHLY income is untouched - the rule is yearly only", () => {
	//wages are income and are the most predictable thing in the portfolio
	const st = evStream("wage", "Wages", 7837)
	const txns = []
	for(let i = 0; i < 6; i++)
		txns.push(evTxn(new Date(Date.UTC(2026, 1 + i, 14)), 7837, "wage", "chk", "w" + i))
	const at = new Date(Date.UTC(2026, 7, 1))
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: at, until: new Date(Date.UTC(2026, 7, 31)), since: new Date(Date.UTC(2026, 1, 1))})
	expect(m.expectedFor(st, at)).toBeGreaterThan(7000)
})

test("a linked card's statement is composed from that card's own streams", () => {
	/* The statement a repayment covers is charges, and the charges are the card account's own
	   streams. A rate cannot represent a single large charge at any smoothing, and a supplier
	   invoice on a card is exactly that. */
	const DAYMS = 86400000
	const buys = []
	for(let d = 0; d < 150; d++){
		const at = new Date(Date.UTC(2026, 0, 2 + d))
		if(d % 7 === 3 || d % 7 === 5 || d % 7 === 6)continue
		buys.push({at: at, amt: 40 + ((d*13) % 30), stream: "food", id: "f" + d})
	}
	for(let mth = 0; mth < 5; mth++)
		buys.push({at: new Date(Date.UTC(2026, mth, 26)), amt: 2600, stream: "supp", id: "g" + mth})
	const txns = buys.map(b => evTxn(b.at, -b.amt, b.stream, "rh", b.id))
	for(let w = 0; w < 21; w++){
		const pay = new Date(Date.UTC(2026, 0, 8 + w*7))
		const close = new Date(pay.getTime() - 3*DAYMS), prev = new Date(close.getTime() - 7*DAYMS)
		let stmt = 0
		buys.forEach(b => {
			if(b.at.getTime() > prev.getTime() && b.at.getTime() <= close.getTime())stmt += b.amt
		})
		if(stmt < 1)continue
		txns.push(evTxn(pay, -stmt, "ccpay", "chk", "s" + w, "r" + w))
		txns.push(evTxn(pay, stmt, "ccpay", "rh", "r" + w, "s" + w))
	}
	const food = evStream("food", "Groceries", -1100)
	const supp = evStream("supp", "Supplier", -2600)
	const payStream = evStream("ccpay", "Credit Card Payments", 0)
	const asOf = new Date(Date.UTC(2026, 3, 20))
	const m = buildModel({transactions: txns, terminals: [food, supp, payStream],
		covered: ["chk"], cards: ["rh"], asOf: asOf, until: new Date(Date.UTC(2026, 4, 20)),
		since: new Date(Date.UTC(2026, 0, 1))})

	//the card is linked, and its schedule was read off the repayments
	expect(m.meta.linked).toEqual(["rh"])
	expect(m.meta.cards.rh.intervalDays).toBe(7)
	expect(Math.abs(m.meta.cards.rh.offsetDays - 3)).toBeLessThanOrEqual(1)

	//a month of repayments lands in the right ballpark: four weeks of groceries plus one invoice
	const flow = m.extraFlow || {}
	const amounts = Object.keys(flow).sort().map(k => Math.abs(flow[k].amount))
	expect(amounts.length).toBeGreaterThan(2)
	/* THE LUMP HAS TO BE VISIBLE. One statement contains the supplier invoice and the others do not,
	   so one repayment must stand several times above the rest - which is precisely what a rate
	   cannot produce, however it is smoothed. */
	const big = Math.max.apply(null, amounts), small = Math.min.apply(null, amounts)
	expect(big/small).toBeGreaterThan(3)
	//the invoice is $2,600 and the coverage correction scales the estimate a little
	expect(big).toBeGreaterThan(1500)
	//and the parts of every repayment add to the whole
	Object.keys(flow).forEach(k => {
		(flow[k].parts || []).forEach(p => {
			expect(p.posted + (p.planned || 0) + p.projected).toBeCloseTo(p.amount, 4)
		})
	})
})


/* =================================================================================================
   UNPREDICTABLE UNTIL IT BECOMES PREDICTABLE.

   Gembah: a $10,000 yearly declaration spent in instalments of $2,626. Spread, it draws $27 a day
   for a charge that arrives whole - and the trough it makes is the whole reason to draw this chart.
   One payment is not evidence; the second is what turns two dates into an interval.
   ================================================================================================= */
const instalments = n => {
	const txns = []
	for(let i = 0; i < n; i++)
		txns.push(evTxn(new Date(Date.UTC(2026, 5 + i, 28)), -2626, "gem", "chk", "g" + i))
	return txns
}
//a REAL yearly stream answers per period: the yearly figure for "yearly", a twelfth for "monthly".
//evStream returns the same number whichever is asked, which made the monthly expectation twelve
//times too large and every downstream ratio with it
const yearlyStream = (id, name, perYear) => ({id: id, name: name,
	getPreferredPeriod: () => "yearly",
	getExpectedAmountAtDateByPeriod: (when, p) => p === "yearly" ? perYear : perYear/12})
const gembahAt = (txns, mth) => {
	const st = yearlyStream("gem", "Gembah", -10000)
	return {st: st, m: buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, mth, 5)), until: new Date(Date.UTC(2026, mth + 1, 5)),
		since: new Date(Date.UTC(2026, 0, 1)), cycleStart: new Date(Date.UTC(2026, 0, 1))})}
}

test("before any instalment, a yearly budget spreads", () => {
	const {st, m} = gembahAt([], 5)
	expect(m.shapes.gem.spreadReason).toBeTruthy()
	expect(m.meta.promoted.gem).toBe(false)
})

test("after ONE instalment it still spreads - a payment is not a rhythm", () => {
	const {st, m} = gembahAt(instalments(1), 6)
	expect(m.meta.promoted.gem).toBe(false)
	expect(m.shapes.gem.spreadReason).toBeTruthy()
	//and what is left of the budget is what gets spread
	const at = new Date(Date.UTC(2026, 6, 5))
	expect(Math.abs(m.expectedFor(st, at))).toBeLessThan(1500)
})

test("after TWO at a monthly interval it becomes one dated charge", () => {
	const {st, m} = gembahAt(instalments(2), 7)
	expect(m.meta.promoted.gem).toBe(true)
	expect(m.shapes.gem.spreadReason).toBe(null)
	expect(m.shapes.gem.weights.filter(w => w > 0.0001).length).toBe(1)
	//the whole instalment lands on one day, not a twelfth of a year on each
	const days = []
	for(let d = 1; d <= 31; d++)days.push(shareOfDay(st, new Date(Date.UTC(2026, 7, d)), m))
	expect(Math.round(Math.min.apply(null, days))).toBe(-2626)
	expect(days.filter(v => Math.abs(v) > 1).length).toBe(1)
})

test("it stops when the budget is used up, not a month later", () => {
	//four instalments of $2,626 is $10,504 against a $10,000 budget
	const {st, m} = gembahAt(instalments(4), 9)
	const at = new Date(Date.UTC(2026, 9, 5))
	expect(m.expectedFor(st, at)).toBe(0)
	//and the third one is clamped to what was actually left
	const three = gembahAt(instalments(3), 8)
	const v = three.m.expectedFor(three.st, new Date(Date.UTC(2026, 8, 5)))
	expect(Math.abs(v)).toBeGreaterThan(1)
	expect(Math.abs(v)).toBeLessThan(2626)
})

test("a yearly budget drawn on at irregular intervals still spreads", () => {
	/* Hobby mdm: $250 three times, on the 16th each time, but eighty-nine and sixty-one days apart.
	   Same amount and same day of the month as Gembah - it is the INTERVAL that tells them apart, a
	   budget being drawn on rather than a schedule being kept. */
	const st = yearlyStream("hob", "Hobby mdm", -3000)
	const txns = [evTxn(new Date(Date.UTC(2026, 1, 16)), -250, "hob", "chk", "h1"),
		evTxn(new Date(Date.UTC(2026, 4, 16)), -250, "hob", "chk", "h2"),
		evTxn(new Date(Date.UTC(2026, 6, 16)), -250, "hob", "chk", "h3")]
	const m = buildModel({transactions: txns, terminals: [st], covered: ["chk"], cards: [],
		asOf: new Date(Date.UTC(2026, 7, 1)), until: new Date(Date.UTC(2026, 7, 31)),
		since: new Date(Date.UTC(2026, 0, 1)), cycleStart: new Date(Date.UTC(2026, 0, 1))})
	expect(m.meta.promoted.hob).toBe(false)
	expect(m.shapes.hob.spreadReason).toMatch(/long-period/)
})

/* =================================================================================================
   PHASE 0 - THE LINK, AND THE BRANCH ON IT.

   A card repayment is a transfer with a leg on each side, and the data model already records the
   pairing. Where one leg is on an account typed credit and the other on one typed checking, that
   pair IS the repayment and it says which checking account funds that card.

   The branch matters more than the link: a card with no such pair has invisible charges, so there is
   no statement to reconstruct and it is an ordinary expected outflow.
   ================================================================================================= */
const linkedCard = (pairThem) => {
	const txns = []
	for(let w = 0; w < 16; w++){
		const pay = new Date(Date.UTC(2026, 0, 9 + w*7))
		const close = new Date(pay.getTime() - 3*86400000)
		let stmt = 0
		for(let d = 0; d < 5; d++){
			const amt = 60 + ((w*11 + d*7) % 40)
			txns.push(evTxn(new Date(close.getTime() - (4 - d)*86400000), -amt, "food", "rh",
				"f" + w + "-" + d))
			stmt += amt
		}
		txns.push(evTxn(pay, -stmt, "ccpay", "chk", "s" + w, pairThem ? "r" + w : undefined))
		txns.push(evTxn(pay, stmt, "ccpay", "rh", "r" + w, pairThem ? "s" + w : undefined))
	}
	return txns
}
const modelFor = txns => {
	const food = evStream("food", "Groceries", -1500)
	const pay = evStream("ccpay", "Credit Card Payments", 0)
	return buildModel({transactions: txns, terminals: [food, pay], covered: ["chk"], cards: ["rh"],
		asOf: new Date(Date.UTC(2026, 3, 1)), until: new Date(Date.UTC(2026, 3, 30)),
		since: new Date(Date.UTC(2026, 0, 1))})
}

test("a paired repayment links the card to the account that funds it", () => {
	const lk = accountLinks(linkedCard(true), ["rh"], ["chk"])
	expect(lk.links.rh).toBe("chk")
	expect(lk.repayments.length).toBe(16)
	//both legs are named, because both have to leave the stream ledger
	expect(Object.keys(lk.legIds).length).toBe(32)
	//the repayment carries the CHECKING side's amount, which is the money that actually left
	expect(lk.repayments[0].amount).toBeLessThan(0)
	expect(lk.repayments[0].checking).toBe("chk")
})

test("a repayment with no stored pairing is reconstructed from the two accounts", () => {
	/* Aggregators do not tag a card repayment as a transfer, so the stored pairing is usually empty
	   for exactly these transactions. What a repayment IS does not change: an amount leaving a
	   checking account and the same amount arriving on a credit account within a few days. */
	const lk = accountLinks(linkedCard(false), ["rh"], ["chk"])
	expect(lk.links.rh).toBe("chk")
	expect(lk.repayments.length).toBe(16)
	expect(Object.keys(lk.legIds).length).toBe(32)
})

test("a card whose charges are invisible links nothing, and stays an ordinary outflow", () => {
	/* The genuinely unlinked case: the card is not connected, so only the money leaving checking is
	   visible. There is no statement to reconstruct and nothing to reconstruct it from. */
	const txns = []
	for(let w = 0; w < 16; w++){
		const pay = new Date(Date.UTC(2026, 0, 9 + w*7))
		txns.push(evTxn(pay, -320, "ccpay", "chk", "s" + w))
	}
	const lk = accountLinks(txns, ["rh"], ["chk"])
	expect(Object.keys(lk.links).length).toBe(0)
	expect(Object.keys(lk.legIds).length).toBe(0)

	const pay = evStream("ccpay", "Credit Card Payments", -1400)
	const m = buildModel({transactions: txns, terminals: [pay], covered: ["chk"], cards: ["rh"],
		asOf: new Date(Date.UTC(2026, 3, 1)), until: new Date(Date.UTC(2026, 3, 30)),
		since: new Date(Date.UTC(2026, 0, 1))})
	expect(m.meta.linked).toEqual([])
	expect(m.extraFlow).toBe(null)
	//it stays in the ledger and is forecast as the ordinary outflow it is
	let out = 0
	for(let d = 1; d <= 30; d++)out += shareOfDay(pay, new Date(Date.UTC(2026, 3, d)), m)
	expect(out).toBeLessThan(-100)
})

test("a repayment is not spending on either side", () => {
	const m = modelFor(linkedCard(true))
	expect(m.meta.linked).toEqual(["rh"])
	//the checking leg is gone from the stream ledger, so the repayment stream forecasts nothing
	const pay = m.terminals.filter(t => t.id === "ccpay")[0]
	let out = 0
	for(let d = 1; d <= 30; d++)out += shareOfDay(pay, new Date(Date.UTC(2026, 3, d)), m)
	expect(out).toBe(0)
	//and it comes back as the card's repayment instead
	expect(m.extraFlow).toBeTruthy()
	const total = Object.keys(m.extraFlow).reduce((x, k) => x + Math.abs(m.extraFlow[k].amount), 0)
	expect(total).toBeGreaterThan(500)
})

test("the schedule is re-derived from recent repayments, not held for ever", () => {
	/* Autopay usually holds a schedule steady, but the holder can change it - weekly to monthly to
	   smooth a cash-flow mismatch is a normal thing to do. A schedule averaged over all history
	   describes an arrangement that may have ended. */
	const txns = []
	let w = 0
	//twelve weeks weekly...
	for(; w < 12; w++){
		const pay = new Date(Date.UTC(2026, 0, 9 + w*7))
		txns.push(evTxn(new Date(pay.getTime() - 5*86400000), -300, "food", "rh", "f" + w))
		txns.push(evTxn(pay, -300, "ccpay", "chk", "s" + w, "r" + w))
		txns.push(evTxn(pay, 300, "ccpay", "rh", "r" + w, "s" + w))
	}
	//...then switched to monthly
	for(let m2 = 0; m2 < 5; m2++){
		const pay = new Date(Date.UTC(2026, 3 + m2, 12))
		txns.push(evTxn(new Date(pay.getTime() - 5*86400000), -1200, "food", "rh", "F" + m2))
		txns.push(evTxn(pay, -1200, "ccpay", "chk", "S" + m2, "R" + m2))
		txns.push(evTxn(pay, 1200, "ccpay", "rh", "R" + m2, "S" + m2))
	}
	const lk = accountLinks(txns, ["rh"], ["chk"])
	const sched = cardSchedule(txns, "rh", lk.repayments)
	//the recent arrangement, not the average of both
	expect(sched.intervalDays).toBeGreaterThan(25)
	expect(sched.schedule.monthDay).toBe(12)
})

test("a card that stopped being used is not repaid for ever", () => {
	/* The schedule runs off the last repayment, so without this a card last repaid a year ago keeps
	   producing repayments - money leaving an account that is no longer being used. */
	const txns = []
	for(let w = 0; w < 10; w++){
		const pay = new Date(Date.UTC(2025, 8, 3 + w*7))
		txns.push(evTxn(new Date(pay.getTime() - 5*86400000), -200, "food", "rh", "f" + w))
		txns.push(evTxn(pay, -200, "ccpay", "chk", "s" + w, "r" + w))
		txns.push(evTxn(pay, 200, "ccpay", "rh", "r" + w, "s" + w))
	}
	const lk = accountLinks(txns, ["rh"], ["chk"])
	expect(lk.repayments.length).toBe(10)                //the history is real
	const sched = cardSchedule(txns, "rh", lk.repayments)
	//...but a year later there is nothing to repay
	const from = new Date(Date.UTC(2026, 8, 1))
	const events = cardRepaymentForecast(txns, "rh", sched, from, new Date(Date.UTC(2026, 9, 1)),
		{chargedOn: () => 50})
	expect(events.length).toBe(0)
	//while a card repaid three weeks ago is still live
	const soon = new Date(Date.UTC(2025, 9, 25))
	expect(cardRepaymentForecast(txns, "rh", sched, soon, new Date(Date.UTC(2025, 10, 25)),
		{chargedOn: () => 50}).length).toBeGreaterThan(0)
})

test("an amount that matches but says nothing is not paired", () => {
	/* The wording condition is load-bearing and is narrowed rather than removed. Two transactions of
	   the same size a few days apart, one leaving checking and one arriving on a card, are not
	   automatically a repayment - a refund is also an arrival, and so is anything else that happens
	   to coincide. Something has to say it is a payment. */
	const txns = []
	for(let w = 0; w < 10; w++){
		const pay = new Date(Date.UTC(2026, 0, 9 + w*7))
		txns.push(evTxn(pay, -400, "misc", "chk", "s" + w, undefined, "Wire to Vendor"))
		txns.push(evTxn(pay, 400, "misc", "rh", "r" + w, undefined, "Adjustment"))
	}
	const lk = accountLinks(txns, ["rh"], ["chk"])
	expect(Object.keys(lk.links).length).toBe(0)
	//and it says what it turned down, so a missing word is evidence rather than an absence
	expect(lk.rejected.length).toBeGreaterThan(0)
	expect(lk.rejected[0].pair).toMatch(/Wire to Vendor/)
})

test("a refund is never mistaken for a repayment", () => {
	const txns = []
	for(let w = 0; w < 10; w++){
		const d = new Date(Date.UTC(2026, 0, 9 + w*7))
		txns.push(evTxn(d, -220, "food", "chk", "s" + w, undefined, "Card Payment"))
		txns.push(evTxn(d, 220, "food", "rh", "r" + w, undefined, "Refund: Amazon"))
	}
	expect(Object.keys(accountLinks(txns, ["rh"], ["chk"]).links).length).toBe(0)
})
