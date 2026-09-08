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
const DAY = 24*3600*1000
const d = n => new Date(Date.now() - n*DAY)

let txns

beforeEach(() => {
	const master = new CompoundStream(MASTER_JSON)
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
	//a card that is genuinely settled from checking, so the settlement model has something to find -
	//it is the term most likely to be present in one half of the pair and missing from the other
	for(let w = 0; w < 26; w++){
		const settleDay = d(190 - w*7)
		for(let i = 0; i < 3; i++){
			const buy = new Date(settleDay.getTime() - (5 - i)*DAY)
			txns.push(new GenericTransaction(buy.toISOString(), -87, "purchase",
				[{streamId: "food", amount: -87}], CARD, undefined, undefined,
				"b" + w + "-" + i, "b" + w + "-" + i))
		}
		txns.push(new GenericTransaction(settleDay.toISOString(), -261, "card bill",
			[{streamId: "ccpay", amount: -261}], CHECKING, undefined, undefined, "s" + w, "s" + w))
		//the card-side leg of the same payment: the settlement is INFERRED from the pair, so a
		//fixture with only the checking half contains no settlement to find
		const back = new Date(settleDay.getTime() + DAY)
		txns.push(new GenericTransaction(back.toISOString(), 261, "payment received",
			[{streamId: "ccpay", amount: 261}], CARD, undefined, undefined, "r" + w, "r" + w))
	}
	for(let m = 0; m < 7; m++){
		txns.push(new GenericTransaction(d(200 - m*30).toISOString(), 5100, "pay",
			[{streamId: "base", amount: 5100}], CHECKING, undefined, undefined, "p" + m, "p" + m))
		txns.push(new GenericTransaction(d(198 - m*30).toISOString(), -1700, "rent",
			[{streamId: "rent", amount: -1700}], CHECKING, undefined, undefined, "t" + m, "t" + m))
	}
})

const mount = async when => {
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

test("the settlement the backtest draws is the settlement the table names", async () => {
	//the shape was being written onto the live inputs and never onto the out-of-sample ones, so the
	//biggest outflow in the portfolio was drawn flat while the table called it a weekly lump
	const chart = await mount("last")
	const a = chart.series()
	const ids = a.bench.terminals.map(s => s.id)
	expect(ids).toContain("__settlement__")
	expect(a.bench.shapes["__settlement__"]).toBeTruthy()
	expect(a.bench.shapes["__settlement__"].any).toBe(true)
})
