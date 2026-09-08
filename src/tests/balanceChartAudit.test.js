/**
 * balanceChartAudit.test.js — the day breakdown is the arithmetic of the line above it.
 *
 * WHY THIS EXISTS. The tile drew a large downward step on the 15th and the table under it, asked to
 * explain that same day, listed thirteen streams totalling $16. Both halves came from real code and
 * neither was obviously wrong on its own; they simply were not the same model.
 *
 * Two faults produced it, and a pure-function suite could catch neither, because both live in the
 * WIRING - which opts object reaches contributionsOn:
 *
 *   1. The past of the chart is drawn by the BACKTEST, which deliberately runs on out-of-sample
 *      shapes. The audit was handed the live shapes. Same streams, different distribution over days.
 *   2. The opts were kept on an instance field written once per computeSeries() call, and
 *      allSeries() computes every window - so the field held whichever month ran LAST.
 *
 * The invariant here is the one a reader assumes for free: the numbers in the table add up to the
 * step the curve takes that day. Assert it across every drawn day rather than a chosen one, since the
 * failure was day-shaped and picking a day is how you miss it.
 */
jest.mock('dateformat', () => ({__esModule: true, default: () => ''}))

import React from 'react'
import {render, act} from '@testing-library/react'
import Core from '../core'
import {CompoundStream, GenericTransaction} from '../model'
import BalanceChart from '../components/BalanceChart'
import {buildModel, forecast} from '../processors/BankBalance'

const HIST = a => [{startDate: new Date("2000-01-01"), amount: a}]
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
const CARD2 = "ins::3333::credit"
const DAY = 24*3600*1000
const d = n => new Date(Date.now() - n*DAY)

let txns, accounts

//a second card, settling on its OWN weekday - the case a pooled weekly histogram cannot represent
const addSecondCard = () => {
	accounts.push({hash: CARD2, name: "Amex", type: "credit", subtype: "credit card", current: 400})
	for(let w = 0; w < 26; w++){
		const settleDay = d(187 - w*7)
		for(let i = 0; i < 2; i++){
			const buy = new Date(settleDay.getTime() - (4 - i)*DAY)
			txns.push(new GenericTransaction(buy.toISOString(), -50, "purchase",
				[{streamId: "food", amount: -50}], CARD2, undefined, undefined,
				"B" + w + "-" + i, "B" + w + "-" + i))
		}
		txns.push(new GenericTransaction(settleDay.toISOString(), -100, "amex bill",
			[{streamId: "ccpay", amount: -100}], CHECKING, undefined, undefined, "S" + w, "S" + w))
		const back = new Date(settleDay.getTime() + DAY)
		txns.push(new GenericTransaction(back.toISOString(), 100, "payment received",
			[{streamId: "ccpay", amount: 100}], CARD2, undefined, undefined, "R" + w, "R" + w))
	}
}

beforeEach(() => {
	const master = new CompoundStream(MASTER_JSON)
	Core.globalState = Object.assign({}, Core.globalState, {
		userData: {
			masterStream: master, userId: "someone@example.com",
			getAllStreams: () => master.getAllStreams(),
			savingAccounts: [], preferredCurrency: "USD", userPreferences: {}
		}
	})
	accounts = [
		{hash: CHECKING, name: "Checking", type: "depository", subtype: "checking", current: 8000},
		{hash: CARD, name: "Visa", type: "credit", subtype: "credit card", current: 900}
	]
	Core.getAccountsWithBalances = () => Promise.resolve(accounts)

	txns = []
	/* a card genuinely settled from checking, so the settlement model has something to find. The
	   weekly spend STEPS UP: a fixture with a flat card cannot tell a causal model apart from the
	   mean that was shipped in its place. The step is placed early enough that the 90-day rate window
	   sits entirely inside the new regime, so the test measures the model and not the smoother. */
	for(let w = 0; w < 26; w++){
		const settleDay = d(190 - w*7)
		const each = w < 9 ? 60 : 160
		for(let i = 0; i < 3; i++){
			const buy = new Date(settleDay.getTime() - (5 - i)*DAY)
			txns.push(new GenericTransaction(buy.toISOString(), -each, "purchase",
				[{streamId: "food", amount: -each}], CARD, undefined, undefined,
				"b" + w + "-" + i, "b" + w + "-" + i))
		}
		const bill = each*3
		txns.push(new GenericTransaction(settleDay.toISOString(), -bill, "card bill",
			[{streamId: "ccpay", amount: -bill}], CHECKING, undefined, undefined, "s" + w, "s" + w))
		//the card-side leg of the same payment: the settlement is INFERRED from the pair, so a
		//fixture with only the checking half contains no settlement to find
		const back = new Date(settleDay.getTime() + DAY)
		txns.push(new GenericTransaction(back.toISOString(), bill, "payment received",
			[{streamId: "ccpay", amount: bill}], CARD, undefined, undefined, "r" + w, "r" + w))
	}
	for(let m = 0; m < 7; m++){
		txns.push(new GenericTransaction(d(200 - m*30).toISOString(), 5100, "pay",
			[{streamId: "base", amount: 5100}], CHECKING, undefined, undefined, "p" + m, "p" + m))
		txns.push(new GenericTransaction(d(198 - m*30).toISOString(), -1700, "rent",
			[{streamId: "rent", amount: -1700}], CHECKING, undefined, undefined, "t" + m, "t" + m))
	}
})

const mount = async (when, twoCards) => {
	if(twoCards)addSecondCard()
	const ref = React.createRef()
	await act(async () => {render(<BalanceChart ref={ref} defaultWhen={when} transactions={txns}/>)})
	return ref.current
}

//the step the DRAWN dotted line takes on a day, read straight off the series
const stepsOf = line => {
	const out = {}
	for(let i = 1; i < line.length; i++)
		out[line[i].date.toISOString().slice(0, 10)] = line[i].value - line[i-1].value
	return out
}

const checkAgrees = (chart, line, pick) => {
	const steps = stepsOf(line)
	const days = Object.keys(steps)
	expect(days.length).toBeGreaterThan(5)
	let checked = 0
	days.forEach(k => {
		const point = line.filter(p => p.date.toISOString().slice(0, 10) === k)[0]
		const audit = chart.dayAudit(pick(point))
		expect(audit.date).toBe(k)
		//to the cent: these are the same additions in the same order, not two estimates of one number
		expect(audit.predictedTotal).toBeCloseTo(steps[k], 2)
		checked++
	})
	expect(checked).toBe(days.length)
}

test("every past day's table adds up to the step the backtest line takes", async () => {
	const chart = await mount("last")
	const a = chart.series()
	//point.actual is true on the reconstruction, which is what the cursor hands to dayAudit
	checkAgrees(chart, a.backtest, p => ({date: p.date, value: p.value, actual: true}))
})

test("every future day's table adds up to the step the forecast line takes", async () => {
	const chart = await mount("this")
	const a = chart.series()
	expect(a.future.length).toBeGreaterThan(5)
	//the forecast's own first point has no predecessor on this line, so stepsOf starts at the second
	checkAgrees(chart, a.future, p => ({date: p.date, value: p.value, actual: false}))
})

test("the audit follows the displayed month, not whichever was computed last", async () => {
	//allSeries() computes every window; an audit keyed to the component rather than to the series
	//answers with the wrong month's model, and the two months must therefore disagree
	const chart = await mount("last")
	const last = chart.series("last"), thisM = chart.series("this")
	expect(last.bench).toBeTruthy()
	expect(last.bench).not.toBe(thisM.bench)
	expect(last.live).not.toBe(thisM.live)
})

test("the backtest carries a settlement, as an extraFlow rather than a mean stream", async () => {
	const chart = await mount("last")
	const a = chart.series()
	expect(a.bench.extraFlow).toBeTruthy()
	expect(Object.keys(a.bench.extraFlow).length).toBeGreaterThan(1)
	//the six-month mean spread over a weekly histogram is gone; nothing may reintroduce it
	expect(a.bench.terminals.map(s => s.id)).not.toContain("__settlement__")
	expect(a.live.terminals.map(s => s.id)).not.toContain("__settlement__")
	//and the synthesised due-day bill must stay off, or the card is paid twice
	expect(a.bench.settles).toBe(null)
})

/* =================================================================================================
   THE BILL TRACKS THE SPENDING. Two real consecutive settlements of $3,498 and $2,075 were both
   predicted at $950, because the tile modelled the card as a six-month mean spread over a weekly
   histogram - a constant by construction. The causal model had existed since b16 and the bench had
   been scoring with it the whole time; the tile's extraFlow was hardcoded to null.

   A constant satisfies any test that only asks whether a settlement EXISTS. These ask whether it
   MOVES with the spending that produces it, which is the property a mean cannot have.
   ================================================================================================= */
test("the modelled bill reproduces the settlements that actually posted", async () => {
	/* The fixture spends $180 a week on the card for two months and then $480 a week. A six-month
	   mean says ~$377 a settlement forever, which is the shape of the failure that was shipped: two
	   real consecutive bills of $3,498 and $2,075 both predicted at $950.

	   The causal model reads what has already posted on that card since its last settlement, so over
	   a window it must reproduce what the window actually paid - not approach it on average. */
	const chart = await mount("last")
	const a = chart.series()
	const flow = a.bench.extraFlow
	const days = Object.keys(flow)
	expect(days.length).toBeGreaterThan(2)

	const from = a.backtest[0].date, to = a.backtest[a.backtest.length - 1].date
	const actual = txns.filter(t => t.userInstitutionAccountId === CHECKING
			&& /card bill/.test(t.description)
			&& new Date(t.date) >= from && new Date(t.date) <= to)
		.reduce((x, t) => x + Math.abs(t.amount), 0)
	const modelled = days.reduce((x, k) => x + Math.abs(flow[k].amount), 0)

	expect(actual).toBeGreaterThan(0)
	expect(modelled/actual).toBeGreaterThan(0.9)
	expect(modelled/actual).toBeLessThan(1.1)
})

test("each card names itself in the breakdown", async () => {
	//"Card settlement -$950" cannot say whether the amount, the day or the CARD is wrong, and with
	//two cards on their own weekly cycles all three are live at once
	const chart = await mount("last", true)
	const a = chart.series()
	const days = Object.keys(a.bench.extraFlow)
	let named = []
	days.forEach(k => {
		const point = a.backtest.filter(p => p.date.toISOString().slice(0, 10) === k)[0]
		if(!point)return
		const rows = chart.dayAudit({date: point.date, value: point.value, actual: true}).predicted
		named = named.concat(rows.filter(r => /Card settlement/.test(r.name)))
	})
	expect(named.length).toBeGreaterThan(0)
	expect(named.some(r => /Visa/.test(r.name))).toBe(true)
	expect(named.some(r => /Amex/.test(r.name))).toBe(true)
})

/* =================================================================================================
   THE LAW OF THE AS-OF DATE, on a fixture that can actually break it.

   The model may read nothing dated on or after the instant it is asked about. Three separate faults
   were violations of exactly this - the backtest drawn from live shapes, the settlement averaged over
   the six months ending today then used in a forecast starting a month ago, the audit explaining the
   past with the present's model - and each was caught by eye, months apart, in production.

   Reading the code for out-of-sample purity is what failed. So this asks the model: build it from the
   whole ledger, build it again from a ledger physically truncated at the as-of date, and forecast
   with both. Any input that peeks past asOf makes the two differ. The fixture is the card one on
   purpose - it settles every week, so the window is dense with exactly the transactions a leak would
   reach, and a leak anywhere in the settlement chain moves the answer.
   ================================================================================================= */
test("the model reads nothing dated on or after its as-of date", async () => {
	const chart = await mount("last", true)
	const a = chart.series()
	const opened = a.past[0].date, closed = a.past[a.past.length - 1].date
	const days = Math.round((closed - opened)/DAY)

	const common = {terminals: chart.terminals(), accounts: chart.state.accounts || [],
		covered: chart.covered(), cards: chart.creditHashes(),
		fallback: chart.spendingHashes()[0], asOf: opened, until: closed,
		settlementDay: chart.settlementDay()}
	const full = buildModel(Object.assign({transactions: txns}, common))
	//a ledger that PHYSICALLY cannot contain the answer
	const blind = buildModel(Object.assign({transactions:
		txns.filter(t => new Date(t.date) < opened)}, common))

	const run = m => forecast(Object.assign({now: opened, balanceNow: 0, days: days}, m))
		.map(p => Math.round(p.value*100))
	expect(run(full)).toEqual(run(blind))

	//the window must be dense, or this proves nothing
	const inside = txns.filter(t => new Date(t.date) >= opened && new Date(t.date) <= closed)
	expect(inside.length).toBeGreaterThan(10)
	expect(inside.filter(t => /bill/.test(t.description)).length).toBeGreaterThan(2)
})
