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
		leaf("util", "Utilities", -225),
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
	/* groceries bought BOTH ways - mostly on the card, occasionally on the debit card. That is a real
	   pattern and it is what makes a stream ambiguous: routing has to pick one account and the split
	   says how lopsided the choice was. */
	for(let i = 0; i < 6; i++){
		txns.push(new GenericTransaction(d(160 - i*25).toISOString(), -35, "groceries on debit",
			[{streamId: "food", amount: -35}], CHECKING, undefined, undefined,
			"gd" + i, "gd" + i))
	}
	/* UTILITIES IS TWO BILLS UNDER ONE NAME - water paid by transfer from checking, electricity
	   charged to the card. Same category, different counterparties, different dates, different
	   accounts, and one declared budget of $225 covering both. */
	for(let m = 0; m < 6; m++){
		txns.push(new GenericTransaction(d(175 - m*30).toISOString(), -153, "city water",
			[{streamId: "util", amount: -153}], CHECKING, undefined, undefined,
			"uw" + m, "uw" + m))
		txns.push(new GenericTransaction(d(172 - m*30).toISOString(), -72, "electric co",
			[{streamId: "util", amount: -72}], CARD, undefined, undefined, "ue" + m, "ue" + m))
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
	/* AND IT SURVIVES EVERY LOOKBACK. The card's statement is composed from the card's own streams
	   now, so a different stream window legitimately moves it - what must NOT happen is the collapse
	   this originally guarded against, where the widest window predicted almost nothing. The
	   residual is measured as a gap rather than as a multiplier for exactly that reason: where the
	   streams say little it carries the whole difference. */
	ref.current.windows(ref.current.today()).forEach(w => {
		const alt = ref.current.analyse(w[1])
		expect(Math.abs(alt.settleMonthly)).toBeGreaterThan(700)
		expect(Math.abs(alt.settleMonthly)).toBeLessThan(1600)
	})
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
		/* A CARD-ROUTED STREAM IS READ ON ITS CARD. Its money does not move through the checking
		   account, so the checking reading is zero and the row reports the CHARGE instead. */
		const opts = r.onCard ? Object.assign({}, a.model, {covers: () => true}) : a.model
		//whatever the row claims the forecast puts on a day, the forecast must actually put there
		let total = 0, big = 0
		for(let d = 1; d <= 31; d++){
			const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d))
			if(at.getUTCMonth() !== now.getUTCMonth())break
			const v = shareOfDay(st, at, opts)
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
	//stream rows only: a card row's day is its repayment schedule, not a cycle phase
	const rows = ref.current.rows().filter(r => r.tier && r.tier < 3 && r.day !== "-"
		&& !/^__card__/.test(r.id || ""))
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

test("a card row is scored and dated like any other", async () => {
	/* It was printing 0% forever because the per-card rows were never in the loop that computes a
	   score, and "spread - no single event" because the tier was hardcoded - which is the opposite of
	   what the card model establishes. A repayment lands once per cycle on a fitted schedule. */
	const ref = await mount()
	const cards = ref.current.rows().filter(r => /^__card__./.test(r.id || ""))
	expect(cards.length).toBeGreaterThan(0)
	const live = cards.filter(r => Math.abs(r.expected) > 1)
	expect(live.length).toBeGreaterThan(0)
	live.forEach(r => {
		expect(r.gain).not.toBe(0)                       //scored, not a placeholder
		expect(r.tier).toBe(1)                           //dated: it has a schedule
		expect(r.day).toMatch(/^every \d+d$|^day \d+$/)
	})
})

test("a card-routed stream reports what it charges, not zero", async () => {
	/* Its money reaches the checking account inside a repayment, so the checking reading is right to
	   show nothing - and a row reading "predicts $0, 100% accurate" is then true and unreadable. It
	   is neither predicted nor accurate; it is on a card. */
	const ref = await mount()
	const rows = ref.current.rows().filter(r => r.onCard)
	expect(rows.length).toBeGreaterThan(0)
	rows.forEach(r => {
		//named to a real card, and carrying the charge it forecasts there
		expect(ref.current.credit()).toContain(r.onCard)
		expect(typeof r.promoted).toBe("boolean")
	})
	//at least one of them actually forecasts something, or the card has nothing to compose from
	expect(rows.some(r => Math.abs(r.amount) > 1)).toBe(true)
	//and the report says which card, rather than leaving a zero to be misread
	expect(ref.current.report()).toMatch(/charged to a card/)
})

test("the tile is one number and the two axes that move it", async () => {
	/* Everything else that used to sit there was a figure nobody had chosen to look at, and a tile
	   where every number is equally prominent is a tile nobody reads. */
	const ref = await mount()
	//the horizon changes the number, and "month" is the original single-shot measure
	const seven = ref.current.score()
	ref.current.updateState({roll: null})
	const month = ref.current.score()
	expect(typeof seven).toBe("number")
	expect(typeof month).toBe("number")
	expect(seven).not.toBe(month)

	//the lookback changes it too, and composes with the horizon rather than replacing it
	ref.current.updateState({roll: 7, look: 2})
	expect(ref.current.lookback()[0]).not.toBe(ref.current.windows(ref.current.today())[0][0])
	expect(typeof ref.current.score()).toBe("number")
	ref.current.updateState({roll: 7, look: 0})
})

test("rows are grouped by the account the money leaves", async () => {
	const ref = await mount()
	const g = ref.current.groups()
	expect(g.map(x => x[0])).toEqual(["checking", "card", "both"])
	const all = g.reduce((x, y) => x + y[2].length, 0)
	expect(all).toBe(ref.current.rows().length)          //every row lands in exactly one group
	//the card's own rows are on the card side
	const cardIds = g[1][2].map(r => r.id)
	ref.current.rows().filter(r => /^__card__/.test(r.id || ""))
		.forEach(r => expect(cardIds).toContain(r.id))
})

test("a row can be copied on its own", async () => {
	//the collapsed row is scannable and says little; the argument needs the rest of it
	const ref = await mount()
	const r = ref.current.rows().filter(x => x.detail)[0]
	const text = ref.current.rowDebug(r)
	expect(text.indexOf(r.name)).toBe(0)
	expect(text).toMatch(/class /)
	expect(text).toMatch(/cycle /)
	expect(text).toMatch(/predicted /)
	expect(text).toMatch(/actual /)
	expect(text).toMatch(/worst gap/)
})

test("the cycle column is what was DETECTED, and says so when it disagrees", async () => {
	/* It was showing the declared period back to the reader - the one thing in the row they already
	   know. A stream declared weekly whose shape resolved to a single monthly day is predicting a
	   month of spending as one charge, and the row read "weekly" throughout. */
	const ref = await mount()
	const rows = ref.current.rows().filter(r => r.detected)
	expect(rows.length).toBeGreaterThan(0)
	rows.forEach(r => {
		if(r.detected === r.declared)expect(r.cycle).toBe(r.declared)
		else{
			expect(r.cycle).toContain(r.detected)
			expect(r.cycle).toContain("declared " + r.declared)
		}
	})
})

test("a stream paid two ways reports the split, not just which side won", async () => {
	/* "Routing chose the card" says which side won and not by how much, and a stream split 95/5 is a
	   different problem from one split 55/45 wearing the same label. */
	const ref = await mount()
	const rows = ref.current.rows().filter(r => r.split && r.split.card && r.split.checking)
	expect(rows.length).toBeGreaterThan(0)
	rows.forEach(r => {
		expect(r.split.n).toBe(r.split.card + r.split.checking)
		expect(r.split.cardShare).toBeGreaterThan(0)
		expect(r.split.cardShare).toBeLessThan(1)
		/* ROUTING MUST HAVE PICKED THE SIDE THAT CARRIES MORE OF THE MONEY - but only where routing
		   was the thing that decided. On a row that is one side of a split there was no contest: the
		   partition IS a side, and its account is a fact rather than a winner. */
		if(r.partOf)expect(r.split.cardShareByAmount).toBeGreaterThan(0)
		else expect(!!r.onCard).toBe(r.split.cardShareByAmount >= 0.5)
	})
	expect(ref.current.report()).toMatch(/% by card \(/)
})

test("a stream paid two ways is audited as two rows, and its money is not counted twice", async () => {
	/* THE BENCH READS THE MODEL'S TERMINALS, not the declared ones. Utilities is water from checking
	   and electricity on the card; the model forecasts it as two streams, so showing one row would be
	   auditing a thing the model no longer has - scored against a forecast nothing produced. */
	const ref = await mount()
	const a = ref.current.analyse()
	const parts = a.model.terminals.filter(t => t.partitionOf === "util")
	expect(parts.length).toBe(2)
	expect(parts.map(t => t.partitionAccount).sort()).toEqual([CARD, CHECKING].sort())

	const rows = ref.current.rows()
	parts.forEach(t => expect(rows.filter(r => r.id === t.id).length).toBe(1))
	expect(rows.filter(r => r.id === "util").length).toBe(0)

	//one budget, divided - the failure this gate exists for is two rows each claiming $225
	let declared = 0
	parts.forEach(t => {declared += t.getExpectedAmountAtDateByPeriod(ref.current.today(), "monthly")})
	expect(declared).toBeCloseTo(-225, 4)

	/* AND THE ACTUALS ARE DIVIDED THE SAME WAY. Each transaction is scored against exactly one
	   partition: a leg counted twice inflates the surface of both rows, and a leg counted nowhere
	   makes a real payment look unpredicted. */
	const seen = {}
	let n = 0
	parts.forEach(t => {
		const act = a.detail[t.id]
		expect(act).toBeTruthy()
		Object.keys(act.act).forEach(k => {
			if(Math.abs(act.act[k]) < 0.005)return
			expect(seen[k]).toBeUndefined()
			seen[k] = t.id
			n++
		})
	})
	expect(n).toBeGreaterThan(0)
})

test("the rows the bench audits are exactly the streams the model forecasts", async () => {
	//the structural version: no row may exist that the forecast has never heard of
	const ref = await mount()
	const a = ref.current.analyse()
	const known = {}
	a.model.terminals.forEach(t => {known[t.id] = true})
	ref.current.rows().filter(r => !/^__card__/.test(r.id))
		.forEach(r => expect(known[r.id]).toBe(true))
})

test("the mechanism ladder scores three models against the same window", async () => {
	/* THE INSTRUMENT ITSELF. It is only worth having if the rungs are genuinely different models -
	   a ladder whose lines are all the same number would attribute a regression to nothing. */
	const ref = await mount()
	const v = ref.current.variants()
	expect(v.length).toBe(3)
	v.forEach(row => {
		expect(typeof row[0]).toBe("string")
		expect(row[1] === null || typeof row[1] === "number").toBe(true)
	})
	//the rungs are built from different models, and the fixture triggers both mechanisms
	const base = ref.current.analyse(ref.current.lookback()[1], 0, "base")
	const shape = ref.current.analyse(ref.current.lookback()[1], 0, "shape")
	const full = ref.current.analyse(ref.current.lookback()[1], 0, null)
	expect(base.model.terminals.length).toBe(shape.model.terminals.length)
	expect(full.model.terminals.length).toBeGreaterThan(shape.model.terminals.length)
	expect(ref.current.report()).toMatch(/MECHANISMS, added one at a time/)
})
