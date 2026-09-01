/**
 * moneyFlowTile.test.js — the binding.
 *
 * The adapter has its own test; this one covers the wiring, which is where a typo costs a blank tile
 * in production and nothing at build time. It mounts the real component against a REAL
 * StreamAnalysis, so the accessors it reads off that object (the window dates, the period names)
 * are the ones the analysis actually has.
 *
 * jsdom has no layout, so the engine measures its host at zero width and declines to paint — which
 * is the behaviour under test too: a page that is not on screen yet must not throw.
 */
jest.mock('dateformat', () => ({__esModule: true, default: () => ''}))

import React from 'react'
import {render, screen, fireEvent} from '@testing-library/react'
import Core from '../core'
import {CompoundStream, GenericTransaction} from '../model'
import {Period} from '../Time'
import {getStreamAnalysis} from '../processors/ReportingCore'
import MoneyFlowChart from '../components/MoneyFlowChart'

const HIST = (amount) => [{startDate: new Date("2000-01-01"), amount: amount}]
const leaf = (id, name, amount, extra = {}) => Object.assign(
	{id: id, name: name, period: "monthly", expAmountHistory: HIST(amount)}, extra)
const group = (id, name, children, extra = {}) => Object.assign(
	{id: id, name: name, period: "monthly", children: children}, extra)

const MASTER_JSON = group("master", "Master", [
	group("inc", "Income", [
		leaf("base", "Base pay", 5100),
		leaf("bonus", "Bonus", 800)]),
	group("sav", "Savings", [leaf("buffer", "Buffer", -400, {isSavings: true})], {isSavings: true}),
	group("rec", "Recurring", [leaf("rent", "Rent", -1700), leaf("food", "Food", -600)])
], {isRoot: true})

let master, analysis, txns
const total = a => a.reduce((x, y) => x + y.value, 0)

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
	// The sub-period's boundary is the reporting anchor, not midnight, so "recently" is derived from
	// the window itself rather than guessed from the clock. Two ages on purpose: the observation
	// period holds everything, the current sub-period holds only what fell inside it — which early in
	// a period is very little, and is what the empty state exists for.
	const end = new Date(Date.now() + 60 * 24 * 3600 * 1000)
	const shape = getStreamAnalysis(end, master, [], Period.yearly, Period.monthly)
	const sub = shape.getCurrentPeriodReport()
	const old = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString()
	const now = new Date(sub.reportingStartDate.getTime() + 3600 * 1000).toISOString()
	txns = [
		new GenericTransaction(old, 5000, "pay", [{streamId: "base", amount: 5000}], "checking",
			undefined, undefined, "i1", "t1"),
		new GenericTransaction(old, -1500, "rent", [{streamId: "rent", amount: -1500}], "checking",
			undefined, undefined, "i2", "t2"),
		new GenericTransaction(old, -400, "save", [{streamId: "buffer", amount: -400}], "checking",
			undefined, undefined, "i3", "t3"),
		new GenericTransaction(now, 900, "pay2", [{streamId: "bonus", amount: 900}], "checking",
			undefined, undefined, "i4", "t4"),
		new GenericTransaction(now, -250, "food", [{streamId: "food", amount: -250}], "checking",
			undefined, undefined, "i5", "t5")
	]
	// the analysis the stream view hands down: a year, reported monthly, ending in the near future
	analysis = getStreamAnalysis(end, master, txns, Period.yearly, Period.monthly)
})

const mount = () => {
	const ref = React.createRef()
	render(<MoneyFlowChart ref={ref} stream={master} transactions={txns} analysis={analysis}/>)
	return ref
}

test("mounts, and says what it is showing", () => {
	mount()
	expect(screen.getByText("Actuals")).toBeInTheDocument()
	expect(screen.getByText("year")).toBeInTheDocument()   // the observation period's unit name
})

test("the two words in the title are the controls", () => {
	mount()
	fireEvent.click(screen.getByText("year"))
	expect(screen.getByText("month")).toBeInTheDocument()  // its subdivision's unit name
	fireEvent.click(screen.getByText("Actuals"))
	expect(screen.getByText("Target")).toBeInTheDocument()
})

test("hands the engine a balanced tree, in all four states", () => {
	const ref = mount()
	const seen = []
	const capture = () => {
		const t = ref.current.engine.shown
		expect(total(t.in)).toBeCloseTo(total(t.out), 6)
		expect(t.in.length).toBeGreaterThan(0)
		expect(t.out.length).toBeGreaterThan(0)
		seen.push(t.hubName)
	}
	capture()
	fireEvent.click(screen.getByText("year")); capture()
	fireEvent.click(screen.getByText("Actuals")); capture()
	fireEvent.click(screen.getByText("month")); capture()
	// the single top-level income group lends the hub its name rather than standing in front of it
	expect(seen).toEqual(["Income", "Income", "Income", "Income"])
})

test("a period with no transactions still draws the budget's shape", () => {
	const ref = mount()
	fireEvent.click(screen.getByText("Actuals"))          // target basis
	const t = ref.current.engine.shown
	expect(t.in.map(n => n.id).sort()).toEqual(["base", "bonus"])
	expect(t.out.map(n => n.id)).toContain("rec")
})

test("a period with nothing in it says so, rather than showing an empty card", () => {
	// everything is a year old, so neither window holds it
	const stale = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString()
	const ref = React.createRef()
	render(<MoneyFlowChart ref={ref} stream={master} analysis={analysis}
		transactions={[new GenericTransaction(stale, 5000, "old",
			[{streamId: "base", amount: 5000}], "checking", undefined, undefined, "i9", "t9")]}/>)
	expect(ref.current.engine.shown.inTotal).toBe(0)
	expect(screen.getByText(/Nothing yet this year/)).toBeInTheDocument()
})

test("handing back the same tree is not a change", () => {
	// opening a stream calls back to the tile, which re-renders and hands the tree straight back. If
	// that counted as a change, its value tween would rebuild the geometry every frame and overwrite
	// the focus transition that is running.
	const ref = mount()
	const eng = ref.current.engine
	const before = eng.dataClock
	const spy = jest.spyOn(window, "requestAnimationFrame")
	eng.setTree(ref.current.tree())
	expect(spy).not.toHaveBeenCalled()
	expect(eng.dataClock).toBe(before)
	spy.mockRestore()
})

test("unmounts without throwing", () => {
	const ref = mount()
	const engine = ref.current.engine
	expect(() => engine.destroy()).not.toThrow()
})
