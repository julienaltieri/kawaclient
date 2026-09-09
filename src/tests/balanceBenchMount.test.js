/**
 * balanceBenchMount.test.js — the bench actually runs.
 *
 * WHY THIS EXISTS. A "Cannot access 'R' before initialization" reached production and crashed the
 * Sandbox: analyse() used two consts declared eighty lines below their use, which is a temporal dead
 * zone the bundler is entitled to enforce and did. Every existing test passed, because they all
 * exercise the PROCESSOR - the pure arithmetic - and nothing had ever called the component method
 * that assembles it.
 *
 * A pure-function suite cannot catch an ordering fault inside a method it never invokes. So this
 * mounts the real component against real streams and transactions and calls the whole thing: if
 * analyse() or report() throws for any reason, this goes red before the deploy does.
 */
jest.mock('dateformat', () => ({__esModule: true, default: () => ''}))

import React from 'react'
import {render, act} from '@testing-library/react'
import Core from '../core'
import {CompoundStream, GenericTransaction} from '../model'
import BalanceBench from '../components/BalanceBench'
import {shareOfDay} from '../processors/BankBalance'

const HIST = (amount) => [{startDate: new Date("2000-01-01"), amount: amount}]
const leaf = (id, name, amount, extra = {}) => Object.assign(
	{id: id, name: name, period: "monthly", expAmountHistory: HIST(amount)}, extra)

const MASTER_JSON = {id: "master", name: "Master", period: "monthly", isRoot: true, children: [
	{id: "inc", name: "Income", period: "monthly", children: [leaf("base", "Base pay", 5100)]},
	{id: "rec", name: "Recurring", period: "monthly", children: [
		leaf("rent", "Rent", -1700),
		leaf("food", "Food", -600),
		leaf("ccpay", "Credit Card Payments", 0, {period: "yearly"})]}
]}

const CHECKING = "ins::1111::depository"
const CARD = "ins::2222::credit"
const d = n => new Date(Date.now() - n*24*3600*1000)

let master, txns

beforeEach(() => {
	master = new CompoundStream(MASTER_JSON)
	Core.globalState = Object.assign({}, Core.globalState, {
		userData: {
			masterStream: master, userId: "someone@example.com",
			getAllStreams: () => master.getAllStreams(),
			savingAccounts: [], preferredCurrency: "USD", userPreferences: {}
		}
	})
	Core.getAccountsWithBalances = () => Promise.resolve([
		{hash: CHECKING, name: "Checking", type: "depository", subtype: "checking", current: 8000},
		{hash: CARD, name: "Visa", type: "credit", subtype: "credit card", current: 900}
	])

	txns = []
	/* A COHERENT CARD: the settlements have to be produced by the purchases, or the causal model is
	   being asked to predict a bill from spending that never happened. Each week puts three purchases
	   on the card and then settles exactly that from checking - which is the relationship the model
	   claims to find, so the fixture has to contain it. */
	for(let w = 0; w < 26; w++){
		const settleDay = d(190 - w*7)
		for(let i = 0; i < 3; i++){
			const buy = new Date(settleDay.getTime() - (5 - i)*24*3600*1000)
			txns.push(new GenericTransaction(buy.toISOString(), -87, "purchase",
				[{streamId: "food", amount: -87}], CARD, undefined, undefined,
				"b" + w + "-" + i, "b" + w + "-" + i))
		}
		txns.push(new GenericTransaction(settleDay.toISOString(), -261, "card bill",
			[{streamId: "ccpay", amount: -261}], CHECKING, undefined, undefined,
			"s" + w, "s" + w, "r" + w))
		const back = new Date(settleDay.getTime() + 24*3600*1000)
		txns.push(new GenericTransaction(back.toISOString(), 261, "payment received",
			[{streamId: "ccpay", amount: 261}], CARD, undefined, undefined, "r" + w, "r" + w,
			"s" + w))
	}
	for(let m = 0; m < 6; m++){
		txns.push(new GenericTransaction(d(170 - m*30).toISOString(), 5100, "pay",
			[{streamId: "base", amount: 5100}], CHECKING, undefined, undefined, "p" + m, "p" + m))
		txns.push(new GenericTransaction(d(168 - m*30).toISOString(), -1700, "rent",
			[{streamId: "rent", amount: -1700}], CHECKING, undefined, undefined, "t" + m, "t" + m))
	}
})

const mount = async () => {
	const ref = React.createRef()
	await act(async () => {render(<BalanceBench ref={ref} transactions={txns}/>)})
	return ref
}

test("the bench mounts and produces a report without throwing", async () => {
	//the whole point: this calls analyse(), rows(), groups() and report() for real
	const ref = await mount()
	const text = ref.current.report()
	expect(typeof text).toBe("string")
	expect(text.length).toBeGreaterThan(100)
})

test("the report names the version that produced it", async () => {
	const ref = await mount()
	expect(ref.current.report()).toMatch(/^b\d+/)
})

test("every window in the scoreboard is scored without throwing", async () => {
	//each one re-runs analyse() from a different lookback, which is four more chances to trip
	const ref = await mount()
	const board = ref.current.scoreboard()
	expect(board.length).toBe(4)
	board.forEach(w => expect(typeof w.accuracy === "number" || w.accuracy === null).toBe(true))
})

test("the prior month is scored too, or reported as absent", async () => {
	const ref = await mount()
	const prior = ref.current.prior()
	expect(prior === null || typeof prior.accuracy === "number").toBe(true)
})

test("a linked card is found through the pairing and given a weekly schedule", async () => {
	const ref = await mount()
	const a = ref.current.analyse()
	expect(a.settlements.length).toBeGreaterThan(4)
	//four weekly bills of $261 is about $1,130 a month, predicted from the purchases that produce it
	expect(Math.abs(a.settleMonthly)).toBeGreaterThan(700)
	expect(Math.abs(a.settleMonthly)).toBeLessThan(1600)
	//AND IT DOES NOT MOVE WITH THE STREAM WINDOW. The settlement has its own six-month sample
	//because a card bill is a variable quantity, so selecting a different lookback for the streams
	//must not change what the card is predicted to cost. It used to: the widest window divided a
	//fixed set of settlements by fifty-six years of months and predicted almost nothing.
	const all = ref.current.analyse(new Date(0))
	expect(all.settleMonthly).toBeCloseTo(a.settleMonthly, 6)
})

/* The three things asked for on the bench, exercised for real: a rolling 7-day score that rebuilds
   the model from many mornings, a live next-payment readout that stands at today rather than in the
   scored window, and a per-stream chart. All three call into the model, so a mount test is the only
   place an ordering or wiring fault in them shows up. */
test("the rolling 7-day score re-forecasts from several mornings", async () => {
	const ref = await mount()
	const r = ref.current.rolling(7)
	expect(r).toBeTruthy()
	expect(r.origins).toBeGreaterThan(3)
	expect(r.days).toBe(7)
	expect(typeof r.accuracy).toBe("number")
	//it must differ from the truncated single shot, or it is measuring the same thing twice
	const oneShot = (ref.current.analyse().horizon || []).filter(h => h.days === 7)[0]
	expect(oneShot).toBeTruthy()
	expect(r.accuracy).not.toBe(oneShot.accuracy)
})

test("the next card payment is computed as of today, with its arithmetic", async () => {
	const ref = await mount()
	const next = ref.current.nextPayments()
	expect(next.length).toBeGreaterThan(0)
	const c = next.filter(x => x.when)[0]
	expect(c).toBeTruthy()
	//it is in the FUTURE, not inside the scored window
	expect(new Date(c.when + "T00:00:00Z").getTime()).toBeGreaterThan(ref.current.today().getTime())
	//and the parts add up to the whole
	/* Two parts now, and they must add to the whole: what the card has already been charged for this
	   statement, and what its own streams say is still to come before the statement closes. */
	expect(c.posted + (c.planned || 0)).toBeCloseTo(c.amount, 4)
	expect(c.known).toBeGreaterThanOrEqual(0)
	expect(ref.current.nextPaymentLines().join("\n")).toMatch(/already posted/)
})

test("a stream's cumulative series is the same numbers the score used", async () => {
	const ref = await mount()
	const a = ref.current.analyse()
	const id = Object.keys(a.detail).filter(k => k !== "__card__")[0]
	const s = ref.current.streamSeries(id)
	expect(s).toBeTruthy()
	expect(s.days.length).toBeGreaterThan(5)
	//the last cumulative point IS the total the table prints, so picture and number cannot disagree
	expect(s.pred[s.pred.length-1]).toBeCloseTo(a.detail[id].predTotal, 4)
	expect(s.act[s.act.length-1]).toBeCloseTo(a.detail[id].actTotal, 4)
	expect(ref.current.streamChart(id).pred).toMatch(/^M/)
})

test("the card is one row per card, and the payment stream is not a second copy of it", async () => {
	/* "Card settlement (from card spend)" and "Credit Card Payments" were both scored against the
	   same $9,800, because they ARE the same money seen from two ends. Excluding the stream from the
	   FORECAST was always right; leaving it in the SCORING made the largest flow in the portfolio
	   appear twice, and the dollar-days column stopped adding up. */
	const ref = await mount()
	const a = ref.current.analyse()
	const rows = ref.current.rows()
	//every excluded payment stream is absorbed, not listed
	Object.keys(a.excludeIds).forEach(id => {
		expect(rows.filter(r => r.id === id).length).toBe(0)
	})
	//and there is a row per card, carrying that card's own settlements
	const cardRows = rows.filter(r => /^__card__./.test(r.id || ""))
	expect(cardRows.length).toBeGreaterThan(0)
	expect(cardRows.length).toBe((a.cardRows || []).length)
	//the actuals attributed to cards account for the payments that really left
	expect(Math.abs(a.cardTotal)).toBeGreaterThan(0)
	expect(Math.abs(a.cardAttributed)).toBeGreaterThan(0)
})

test("the card export prints the evidence, not the conclusions", async () => {
	/* Everything about a card is inferred - which payments are its, where the statement closes, what
	   fraction it clears, how fast it is spent on - and the report printed only the conclusions. When
	   they disagreed with reality there was no way to say which of the four inferences was wrong. */
	const ref = await mount()
	const text = ref.current.cardExport()
	//statement by statement, with the purchases that made each one up beside the payment
	expect(text).toMatch(/close\s+paid on\s+payment\s+n\s+purchases/)
	//and the three rate bases side by side, so the choice is measured rather than preferred
	expect(text).toMatch(/this cycle \(since last payment\)/)
	expect(text).toMatch(/trailing 90 days/)
	expect(text).toMatch(/since the reporting year began/)
	expect(text).toMatch(/what the last 8 statements ACTUALLY paid/)
	//the raw purchases, so the numbers above can be checked rather than believed
	expect(text).toMatch(/RAW PURCHASES/)
	expect(text.split("\n").length).toBeGreaterThan(20)
})

test("the table describes the forecast, not a second opinion of it", async () => {
	/* Tier, predicted day and confidence came from pointPrediction - a classifier written before any
	   of the shape rules and never told about them. A yearly expense the forecast now spreads was
	   still listed "Tier 2, drifting, day 9". The reader was auditing a description of a forecast
	   that no longer exists. */
	const ref = await mount()
	const a = ref.current.analyse()
	const rows = ref.current.rows().filter(r => !/^__card__/.test(r.id || ""))
	expect(rows.length).toBeGreaterThan(2)
	const now = ref.current.today()
	rows.forEach(r => {
		const st = ref.current.terminals().filter(x => x.id === r.id)[0]
		if(!st)return
		//whatever the row claims the forecast puts on a day, the forecast must actually put there
		let total = 0, big = 0
		for(let d = 1; d <= 31; d++){
			const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d))
			if(at.getUTCMonth() !== now.getUTCMonth())break
			const v = shareOfDay(st, at, a.model)
			total += v
			if(Math.abs(v) > Math.abs(big))big = v
		}
		if(r.tier === 3)expect(r.amount).toBeCloseTo(total, 4)
		else expect(r.amount).toBeCloseTo(big, 4)
	})
})

test("a stream the forecast spreads is not listed as dated", async () => {
	const ref = await mount()
	const a = ref.current.analyse()
	ref.current.rows().filter(r => r.id && a.model.shapes[r.id]
		&& a.model.shapes[r.id].spreadReason).forEach(r => {
		expect(r.tier).toBe(3)
		expect(r.day).toBe("spread by budget")
	})
})

test("the predicted day is named by the cycle's phase, not the day of the month", async () => {
	/* dayLabel takes a PHASE and they coincide only for a monthly cycle. A weekly stream was being
	   named after a day number and a semimonthly one after a phase it does not have - it read
	   correctly on the 14th only because 14 falls in the first half of the month. */
	const ref = await mount()
	const rows = ref.current.rows().filter(r => r.tier && r.tier < 3 && r.day !== "-")
	rows.forEach(r => {
		//a weekday name, or "day N" / "day N & M" with N inside a month
		expect(r.day).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)( A| B)?$|^day \d+( & \d+)?$/)
		const nums = (r.day.match(/\d+/g) || []).map(Number)
		nums.forEach(n => expect(n).toBeLessThanOrEqual(31))
	})
})

test("a repayment is scored on the card row and nowhere else", async () => {
	/* The leg is taken out of the FORECAST as a transaction, so it has to leave the ACTUALS the same
	   way. Otherwise the stream it is categorised to shows the whole card bill as an unpredicted
	   miss while the card row shows the same money again, and the dollar-days column counts the
	   largest flow in the portfolio twice. */
	const ref = await mount()
	const a = ref.current.analyse()
	const legs = a.legIds || {}
	expect(Object.keys(legs).length).toBeGreaterThan(0)

	//no ordinary stream may carry a repayment leg in its actuals
	const cardTotal = Object.keys(a.detail).filter(k => /^__card__/.test(k))
		.reduce((x, k) => x + Math.abs(a.detail[k].actTotal), 0)
	expect(cardTotal).toBeGreaterThan(0)
	const payStreams = ref.current.terminals().filter(t => /credit card/i.test(t.name))
	payStreams.forEach(t => {
		const d = a.detail[t.id]
		if(!d)return
		expect(Math.abs(d.actTotal)).toBeLessThan(1)
	})
})
