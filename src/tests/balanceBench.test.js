/**
 * balanceBench.test.js — the arithmetic the staging bench rests on.
 *
 * The bench itself is read against real data and cannot be asserted here. What CAN be pinned is the
 * error decomposition it reports, because a split that does not add up would send the reading in the
 * wrong direction: "budget stale" and "model bug" have different cures, and they are told apart by
 * exactly this arithmetic.
 */
jest.mock('dateformat', () => ({__esModule: true, default: () => ''}))

/* level  = |sum(predicted) - sum(actual)|      the totals differ: the budgeted amount is stale
   timing = sum|predicted[d] - actual[d]| - level   the same money on the wrong days
   The two must sum to the L1 error, and neither may be negative. */
const decompose = (pred, act) => {
	const keys = {}
	Object.keys(pred).forEach(k => {keys[k] = true})
	Object.keys(act).forEach(k => {keys[k] = true})
	let sp = 0, sa = 0, l1 = 0
	Object.keys(keys).forEach(k => {
		const p = pred[k] || 0, a = act[k] || 0
		sp += p; sa += a; l1 += Math.abs(p - a)
	})
	const level = Math.abs(sp - sa)
	return {level: level, timing: Math.max(0, l1 - level), l1: l1}
}

test("perfect prediction has no error of either kind", () => {
	const r = decompose({"2026-08-01": -1700}, {"2026-08-01": -1700})
	expect(r.level).toBe(0)
	expect(r.timing).toBe(0)
})

test("right amount, wrong day is ALL timing", () => {
	//the budget is correct and the shape is not - the fixable case, if the stream is regular
	const r = decompose({"2026-08-01": -1700}, {"2026-08-03": -1700})
	expect(r.level).toBe(0)
	expect(r.timing).toBe(3400)      //1700 predicted where none went, 1700 gone where none predicted
	expect(r.l1).toBe(r.level + r.timing)
})

test("right day, wrong amount is ALL level", () => {
	//nothing about the model is wrong; the budgeted figure is out of date
	const r = decompose({"2026-08-01": -1700}, {"2026-08-01": -1900})
	expect(r.level).toBe(200)
	expect(r.timing).toBe(0)
	expect(r.l1).toBe(r.level + r.timing)
})

test("the two always sum to the total, in the mixed case too", () => {
	const r = decompose({"2026-08-01": -1000, "2026-08-15": -1000},
		{"2026-08-02": -1200, "2026-08-15": -900})
	expect(r.level).toBe(100)                  //2000 expected out, 2100 actually out
	expect(r.timing).toBeGreaterThan(0)
	expect(r.l1).toBeCloseTo(r.level + r.timing, 9)
})

test("a stream that was silent when something was predicted is all timing until the totals differ", () => {
	const r = decompose({"2026-08-01": -500}, {})
	//nothing happened at all: the whole error is that the money was expected and did not move
	expect(r.level).toBe(500)
	expect(r.timing).toBe(0)
})

test("timing can never be negative", () => {
	//L1 is bounded below by |sum difference|, so the subtraction cannot go under - but the clamp is
	//kept because a floating-point residue at exactly equal totals would print "-0"
	const cases = [
		[{a: -100}, {a: -100}], [{a: -100, b: -100}, {a: -200}],
		[{a: 50, b: -50}, {a: -50, b: 50}], [{}, {a: -10}]
	]
	cases.forEach(([p, x]) => {
		const r = decompose(p, x)
		expect(r.timing).toBeGreaterThanOrEqual(0)
		expect(r.level).toBeGreaterThanOrEqual(0)
	})
})
