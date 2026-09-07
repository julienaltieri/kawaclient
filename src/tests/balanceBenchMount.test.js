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
	//two months of a portfolio with the shapes that have caused trouble: a paycheck, rent, card
	//purchases, and WEEKLY card settlements that are not paired to anything
	for(let w = 0; w < 9; w++){
		const day = d(70 - w*7)
		txns.push(new GenericTransaction(day.toISOString(), -260, "card bill",
			[{streamId: "ccpay", amount: -260}], CHECKING, undefined, undefined,
			"s" + w, "s" + w))
		const back = new Date(day.getTime() + 24*3600*1000)
		txns.push(new GenericTransaction(back.toISOString(), 260, "payment received",
			[{streamId: "ccpay", amount: 260}], CARD, undefined, undefined, "r" + w, "r" + w))
	}
	for(let m = 0; m < 3; m++){
		txns.push(new GenericTransaction(d(60 - m*30).toISOString(), 5100, "pay",
			[{streamId: "base", amount: 5100}], CHECKING, undefined, undefined, "p" + m, "p" + m))
		txns.push(new GenericTransaction(d(58 - m*30).toISOString(), -1700, "rent",
			[{streamId: "rent", amount: -1700}], CHECKING, undefined, undefined, "t" + m, "t" + m))
		txns.push(new GenericTransaction(d(50 - m*30).toISOString(), -90, "groceries",
			[{streamId: "food", amount: -90}], CARD, undefined, undefined, "f" + m, "f" + m))
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

test("weekly settlements are found and modelled, not left to a monthly due-day", async () => {
	const ref = await mount()
	const a = ref.current.analyse()
	expect(a.settlements.length).toBeGreaterThan(4)
	//and the modelled figure belongs to THIS analysis, not to whichever window ran last
	expect(Math.abs(a.settleMonthly)).toBeGreaterThan(500)
	//AND IT DOES NOT MOVE WITH THE STREAM WINDOW. The settlement has its own six-month sample
	//because a card bill is a variable quantity, so selecting a different lookback for the streams
	//must not change what the card is predicted to cost. It used to: the widest window divided a
	//fixed set of settlements by fifty-six years of months and predicted almost nothing.
	const all = ref.current.analyse(new Date(0))
	expect(all.settleMonthly).toBeCloseTo(a.settleMonthly, 6)
})
