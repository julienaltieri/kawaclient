/**
 * moneyFlow.test.js — the data seam, driven through the REAL model.
 *
 * documentation/visualisation-carousel.md records what it cost to converge the last visualisation
 * without an instrument: five rounds, four of them shipped to production and judged by eye. The
 * picture itself has a bench; this is the other half — the numbers behind it, built from real
 * CompoundStream / TerminalStream / GenericTransaction objects rather than from stand-ins, so that
 * what is asserted is what production will do.
 *
 * The properties under test are the ones the chart cannot survive without:
 *   §1.1  money in equals money out
 *   §1.3  a parent is exactly the sum of its children
 *   §1.4  a stream worth nothing is not in the picture at all
 *   sides: what the stream DEFINITION says, not what happened to it this period
 */
// `dateformat` ships ESM and CRA's jest does not transform node_modules. Mocking it here keeps the
// workaround inside the test rather than changing the build config for the whole project; nothing
// under test formats a date.
jest.mock('dateformat', () => ({__esModule: true, default: () => ''}))

import Core from '../core'
import {CompoundStream, GenericTransaction} from '../model'
import {buildFlowTree, flowAudit, masterSnapshot, measuredAmounts} from '../processors/MoneyFlow'

// ---------------------------------------------------------------------------------------------
// A portfolio shaped like a real one: an income group two deep, a savings group two deep, a
// recurring-expense group two deep and a flat annual one. Ragged on purpose (§1.6).
// ---------------------------------------------------------------------------------------------
const HIST = (amount, when = "2000-01-01") => [{startDate: new Date(when), amount: amount}]
const leaf = (id, name, amount, extra = {}) => Object.assign(
	{id: id, name: name, period: "monthly", expAmountHistory: HIST(amount)}, extra)
// a compound stream always carries its own `period` in real data: CompoundStream's fallback maps
// its children's period STRINGS through Period.longestPeriod, which expects Period objects, so a
// group without one cannot be constructed at all.
const group = (id, name, children, extra = {}) => Object.assign(
	{id: id, name: name, period: "monthly", children: children}, extra)

const MASTER_JSON = group("master", "Master", [
	group("inc", "Income", [
		group("salary", "Salary", [
			leaf("base", "Base pay", 5100),
			leaf("bonus", "Bonus", 800)]),
		leaf("consulting", "Consulting", 900)]),
	group("sav", "Savings", [
		group("retire", "Retirement", [
			leaf("k401", "401k", -600, {isSavings: true}),
			leaf("ira", "IRA", -300, {isSavings: true})]),
		leaf("buffer", "Buffer", -400, {isSavings: true}),
		// closed in the middle of the window's year: it earned before that date and nothing after
		leaf("ally", "Ally Interest", -50, {isSavings: true, endDate: "2024-01-20"})],
		{isSavings: true}),
	group("rec", "Recurring", [
		group("home", "Home", [
			leaf("rent", "Rent", -1700),
			leaf("utils", "Utilities", -320)]),
		leaf("living", "Living", -900)]),
	leaf("annual", "Annual", -1150)
], {isRoot: true})

let master, txnSeq = 0
const WINDOW = {from: new Date("2024-01-01"), to: new Date("2024-02-01")}

// A categorized transaction against one terminal stream. `amount` follows the app's sign
// convention: positive is money arriving, negative is money leaving.
function txn(streamId, amount, when = "2024-01-15", accountId = "checking") {
	txnSeq++
	return new GenericTransaction(when, amount, "txn " + txnSeq,
		[{streamId: streamId, amount: amount, streamName: streamId}],
		accountId, undefined, undefined, "id" + txnSeq, "t" + txnSeq)
}

beforeEach(() => {
	master = new CompoundStream(MASTER_JSON)
	// Core is consulted by the transaction evaluator (which stream is this, is that a savings
	// account) and by nothing else here. A minimal stand-in keeps the test off real user data.
	Core.globalState = Object.assign({}, Core.globalState, {
		userData: {
			masterStream: master,
			getAllStreams: () => master.getAllStreams(),
			savingAccounts: ["savings"],
			preferredCurrency: "USD"
		}
	})
})

const find = (nodes, id) => {
	for (const n of nodes || []) {
		if (n.id === id) return n
		const hit = find(n.children, id)
		if (hit) return hit
	}
	return null
}
const total = a => a.reduce((x, y) => x + y.value, 0)
const build = (txns, basis = "actual") => buildFlowTree(master, txns, {
	from: WINDOW.from, to: WINDOW.to, periodName: "monthly", basis: basis})

// ---------------------------------------------------------------------------------------------

describe("the target basis", () => {
	test("puts each side of the money where the stream definition says", () => {
		const t = build([], "target")
		// the single income group is unwrapped and lends the hub its name, so the picture does not
		// read Income -> Income -> Salary
		expect(t.hubName).toBe("Income")
		expect(t.in.map(n => n.id).sort()).toEqual(["consulting", "salary"])
		// the target says more comes in than goes out, and what is left lands INSIDE savings
		// rather than beside it, so the top level is the categories and nothing else
		expect(t.out.map(n => n.id).sort()).toEqual(["annual", "rec", "sav"])
	})

	test("§1.3 a parent is exactly the sum of its children", () => {
		const t = build([], "target")
		const check = n => {
			if (!n.children) return
			expect(n.value).toBeCloseTo(total(n.children), 6)
			n.children.forEach(check)
		}
		t.in.concat(t.out).forEach(check)
		expect(find(t.in, "salary").value).toBeCloseTo(5900, 6)
		expect(find(t.out, "home").value).toBeCloseTo(2020, 6)
	})

	test("§1.1 money in equals money out", () => {
		const t = build([], "target")
		expect(total(t.in)).toBeCloseTo(total(t.out), 6)
		expect(t.inTotal).toBeCloseTo(total(t.in), 6)
	})

	test("§1.2 the residual becomes Unallocated, INSIDE savings", () => {
		const t = build([], "target")
		// 6800 in, 1300 saved + 4070 spent = 5370 out, so 1430 has nowhere to go yet
		const u = find(t.out, "__unallocated")
		expect(u).not.toBeNull()
		expect(u.value).toBeCloseTo(6800 - 5370, 6)
		expect(u.tone).toBe("savings")
		// It is savings without a stream yet, so it is a CHILD of savings - which is also what
		// makes it an ordinary terminal stream rather than a leaf standing among categories.
		const sav = find(t.out, "sav")
		expect(sav.children.map(n => n.id)).toContain("__unallocated")
		expect(t.out.map(n => n.id)).not.toContain("__unallocated")
		// and the parent grew by exactly what it took in (§1.3 is asserted whole elsewhere)
		expect(sav.value).toBeCloseTo(sav.children.reduce((a,b) => a+b.value,0), 6)
	})
})

describe("a stream whose amount is not a number", () => {
	// 1.4 drops a stream worth nothing, and the guard is `v < MIN_VISIBLE`. NaN fails every
	// comparison, so a stream whose amount came out NaN is not "worth nothing" by that test - it
	// passes straight through into the picture, where its band has no height and its amount reads
	// "$NaN". One bad transaction amount is enough.
	test("is kept out of the picture, like one worth nothing", () => {
		const t = build([txn("base", 5000), txn("rent", NaN)])
		expect(find(t.out, "rent")).toBeNull()
	})
	test("and does not take its parent down with it", () => {
		// a NaN child would make the parent NaN too, by 1.3, and then the whole side of the picture
		const t = build([txn("base", 5000), txn("rent", NaN), txn("utils", -300)])
		const home = find(t.out, "home")
		expect(home).not.toBeNull()
		expect(Number.isFinite(home.value)).toBe(true)
		expect(home.value).toBeCloseTo(300, 6)
	})
})

describe("a stream that has been closed", () => {
	// It kept its history, so it is still in the portfolio and still has transactions against it.
	// What it must not do is go on being BUDGETED after the date it closed: a target is a statement
	// about the future, and a closed stream has none.
	const win = (from,to,basis) => buildFlowTree(master, [txn("ally", -40, "2024-01-10")],
		{from:new Date(from), to:new Date(to), periodName:"monthly", basis:basis})
	test("still counts what it did before it closed", () => {
		// the window contains the transaction, so the actuals hold it - being closed since does not
		// unspend the money
		const t = win("2024-01-01","2024-02-01","actual")
		expect(find(t.out, "ally")).not.toBeNull()
	})
	test("is not budgeted for a window after its closing date", () => {
		const t = win("2024-03-01","2024-04-01","target")
		expect(find(t.out, "ally")).toBeNull()
	})
	test("and does not appear in the actuals of a window it saw none of", () => {
		const t = win("2024-03-01","2024-04-01","actual")
		expect(find(t.out, "ally")).toBeNull()
	})
})

describe("the actual basis", () => {
	test("reads income and spending off the transactions", () => {
		const t = build([txn("base", 5000), txn("rent", -1600), txn("utils", -300)])
		expect(find(t.in, "base").value).toBeCloseTo(5000, 6)
		expect(find(t.out, "rent").value).toBeCloseTo(1600, 6)
		expect(find(t.out, "home").value).toBeCloseTo(1900, 6)
	})

	test("reads savings off what was MOVED, not off money in", () => {
		// A monthly transfer into savings LEAVES a checking account, so the account here is the
		// checking one. The evaluator types it movedToDisconnectedSavingAccount — [moneyIn 0, saved
		// +amount] — and a savings stream read through "money in" is therefore worth nothing at all.
		const t = build([txn("base", 5000), txn("k401", -500)])
		const k = find(t.out, "k401")
		expect(k).not.toBeNull()
		expect(k.value).toBeCloseTo(500, 6)
	})

	test("§1.4 a stream worth less than a unit is not in the picture either", () => {
		const t = build([txn("base", 5000), txn("rent", -0.4), txn("utils", -300)])
		expect(find(t.out, "rent")).toBeNull()          // 40 cents is noise
		expect(find(t.out, "utils")).not.toBeNull()
		// and dropping it does not unbalance anything: the difference is in the residual
		expect(total(t.in)).toBeCloseTo(total(t.out), 6)
	})

	test("a group worth less than a unit goes with its children", () => {
		const t = build([txn("base", 5000), txn("rent", -0.3), txn("utils", -0.2)])
		expect(find(t.out, "home")).toBeNull()
		expect(find(t.out, "rec")).toBeNull()
	})

	test("§1.2 both leftovers are named", () => {
		// The unallocated band went unlabelled at first, to keep it off a crowded rail. An unexplained
		// band is the worse trade: money that came in and went nowhere is worth saying out loud.
		const over = build([txn("base", 5000)])
		expect(find(over.out, "__unallocated").name).toBe("Unallocated")
		expect(find(over.out, "__unallocated").label).toBeUndefined()
		const under = build([txn("base", 1000), txn("rent", -1600)])
		expect(find(under.in, "__reserves").name).toBe("From reserves")
		expect(find(under.in, "__reserves").label).toBeUndefined()
	})

	test("§1.4 a stream worth nothing this period is not in the picture", () => {
		const t = build([txn("base", 5000)])
		expect(find(t.out, "rent")).toBeNull()
		expect(find(t.out, "home")).toBeNull()
		expect(find(t.out, "rec")).toBeNull()
		expect(find(t.in, "consulting")).toBeNull()
	})

	test("§1.1 money in equals money out, whatever happened", () => {
		const t = build([txn("base", 5000), txn("rent", -1600), txn("k401", -500)])
		expect(total(t.in)).toBeCloseTo(total(t.out), 6)
	})

	test("§1.2 spending past income shows as money From reserves, not as negative saving", () => {
		const t = build([txn("base", 1000), txn("rent", -1600)])
		const r = find(t.in, "__reserves")
		expect(r).not.toBeNull()
		expect(r.value).toBeCloseTo(600, 6)
		expect(r.tone).toBe("alert")
		expect(find(t.out, "__unallocated")).toBeNull()
		expect(total(t.in)).toBeCloseTo(total(t.out), 6)
	})

	test("only the window counts", () => {
		const t = build([txn("base", 5000, "2024-01-15"), txn("base", 9999, "2024-03-01")])
		expect(find(t.in, "base").value).toBeCloseTo(5000, 6)
	})

	// This used to assert the opposite - that it landed on zero and appeared nowhere - which is what
	// §1.12 changed. It was never a good outcome: the money had left the account, so leaving it out
	// understated the out side and inflated the leftover by the same amount.
	test("an income stream that net-refunded crosses to the out side, not to zero", () => {
		const t = build([txn("consulting", 900), txn("consulting", -1200), txn("base", 5000)])
		expect(find(t.in, "consulting")).toBeNull()          // not on the side it was defined on
		const costs = t.out.filter(n => n.id === "__incomeCosts")[0]
		expect(costs.children.filter(c => c.id === "consulting")[0].value).toBeCloseTo(300, 6)
		expect(total(t.in)).toBeCloseTo(total(t.out), 6)     // §1.1 survives it
	})

	test("§1.3 holds for the measured tree too", () => {
		const t = build([txn("base", 5000), txn("bonus", 700), txn("rent", -1600), txn("living", -800)])
		const check = n => {
			if (!n.children) return
			expect(n.value).toBeCloseTo(total(n.children), 6)
			n.children.forEach(check)
		}
		t.in.concat(t.out).forEach(check)
	})

	test("§1.5 the shape is stable between bases, which is what lets the values tween", () => {
		const txns = [txn("base", 5000), txn("bonus", 800), txn("consulting", 900),
			txn("rent", -1700), txn("utils", -320), txn("living", -900), txn("annual", -1150),
			txn("k401", -600), txn("ira", -300), txn("buffer", -400)]
		const shape = t => {
			const walk = ns => (ns || []).map(n => n.id + "[" + walk(n.children).join(",") + "]")
			return walk(t.in).join("|") + "//" + walk(t.out).join("|")
		}
		expect(shape(build(txns, "actual"))).toBe(shape(build([], "target")))
	})
})

describe("what never reached the picture", () => {
	// The export's three trees all come from the engine, and the first is "raw" only relative to it:
	// the adapter drops streams before the engine sees anything, so a stream missing from the export
	// was indistinguishable from a stream the layout was hiding. A negative income stream is the case
	// with no honest answer yet - the clamp turns it into zero and it leaves no trace at all.
	const audit = txns => flowAudit(master, txns, {
		from: WINDOW.from, to: WINDOW.to, periodName: "monthly", basis: "actual"})

	test("a negative income stream crosses to Income Expenses, keeping its name and amount", () => {
		// consulting billed 900 and refunded 1200: net money in is negative
		const txns = [txn("base", 5000), txn("consulting", 900), txn("consulting", -1200)]
		const t = buildFlowTree(master, txns,
			{from: WINDOW.from, to: WINDOW.to, periodName: "monthly", basis: "actual"})
		const costs = t.out.filter(n => n.id === "__incomeCosts")[0]
		expect(costs).toBeDefined()
		expect(costs.top).toBe(true)
		expect(costs.children.map(c => c.name)).toContain("Consulting")
		expect(costs.value).toBeCloseTo(300, 2)      // 1200 out less 900 in
		// and it is NOT also on the in side - that would be the same money in two places
		const inNames = []
		const walk = l => (l || []).forEach(n => {inNames.push(n.name); walk(n.children)})
		walk(t.in)
		expect(inNames).not.toContain("Consulting")
		// §1.1 still holds, which is the whole reason this is safe to do
		const sum = l => l.reduce((a, b) => a + b.value, 0)
		expect(sum(t.in)).toBeCloseTo(sum(t.out), 2)
		// the audit calls it moved, not dropped
		const a = audit(txns)
		expect(a.moved.filter(r => r.id === "consulting")[0].amount).toBeCloseTo(300, 2)
		expect(a.dropped.filter(r => r.id === "consulting").length).toBe(0)
	})

	test("the leftover shrinks by what used to be hidden", () => {
		// the bug that made this worth fixing: an understated out side inflates the leftover, so the
		// money was not merely missing from the picture, it was inside Unallocated with another name
		const opts = {from: WINDOW.from, to: WINDOW.to, periodName: "monthly", basis: "actual"}
		const clean = buildFlowTree(master, [txn("base", 5000), txn("rent", -1700)], opts)
		const withNeg = buildFlowTree(master,
			[txn("base", 5000), txn("rent", -1700), txn("consulting", -300)], opts)
		const leftover = t => {let v = 0
			const walk = l => (l || []).forEach(n => {if (n.id === "__unallocated") v = n.value
				walk(n.children)})
			walk(t.out); return v}
		expect(leftover(clean) - leftover(withNeg)).toBeCloseTo(300, 2)
	})

	test("a stream under one unit, and a group with nothing left under it, say so", () => {
		// nothing against Salary's leaves at all, so the whole group has to go with them
		const a = audit([txn("consulting", 0.4)])
		const cents = a.dropped.filter(r => r.id === "consulting")[0]
		expect(cents.why).toMatch(/under one unit/)
		// Salary saw nothing at all, so both its leaves go and the group goes with them
		const group = a.dropped.filter(r => r.id === "salary")[0]
		expect(group.why).toMatch(/nothing under it survived/)
		expect(group.terminal).toBe(false)
	})

	test("what survives is counted, and a stream that is drawn is not in the list", () => {
		const a = audit([txn("base", 5000), txn("rent", -1700)])
		expect(a.kept).toBeGreaterThan(0)
		expect(a.dropped.filter(r => r.id === "base").length).toBe(0)
		expect(a.dropped.filter(r => r.id === "rent").length).toBe(0)
	})
})

describe("the export carries the source, not a picture of it", () => {
	// The whole claim is that the master round-trips: if `new CompoundStream(snapshot)` is the same
	// portfolio, then anything the app can compute the bench can compute, and no snapshot of the
	// engine's output is needed. If it does not, the export is a lossy copy that reads as complete.
	const opts = {from: WINDOW.from, to: WINDOW.to, periodName: "monthly", basis: "actual"}

	test("the snapshot rebuilds a portfolio that produces the identical tree", () => {
		const txns = [txn("base", 5000), txn("bonus", 800), txn("consulting", 900),
			txn("rent", -1700), txn("utils", -320), txn("k401", -600, "2024-01-15", "savings")]
		const before = buildFlowTree(master, txns, opts)
		const rebuilt = new CompoundStream(masterSnapshot(master))
		const after = buildFlowTree(rebuilt, txns, opts)
		expect(JSON.stringify(after)).toEqual(JSON.stringify(before))
	})

	test("it keeps the flags the sides and the exclusions are decided from", () => {
		const snap = masterSnapshot(master)
		const sav = snap.children.filter(c => c.id === "sav")[0]
		expect(sav.isSavings).toBe(true)
		expect(snap.isRoot).toBe(true)
		// a terminal carries its own history, which is what the target basis is read from
		const base = snap.children.filter(c => c.id === "inc")[0]
			.children.filter(c => c.id === "salary")[0]
			.children.filter(c => c.id === "base")[0]
		expect(base.expAmountHistory.length).toBeGreaterThan(0)
		expect(base.expAmountHistory[0].amount).toBe(5100)
		// and the target basis, which reads nothing but the master, survives the round trip
		const t0 = buildFlowTree(master, [], {...opts, basis: "target"})
		const t1 = buildFlowTree(new CompoundStream(snap), [], {...opts, basis: "target"})
		expect(JSON.stringify(t1)).toEqual(JSON.stringify(t0))
	})

	test("the measurements go out unclamped, so a negative is visible", () => {
		// this is the half the master cannot tell you, and the only place the sign survives
		const m = measuredAmounts(master, [txn("consulting", 900), txn("consulting", -1200)],
			WINDOW.from, WINDOW.to)
		expect(m["consulting"][0]).toBeLessThan(0)
		// a stream that saw nothing is left out, which is what keeps the paste small
		expect(m["rent"]).toBeUndefined()
	})
})
