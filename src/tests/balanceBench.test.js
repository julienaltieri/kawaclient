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

/* ---- the accuracy score ---------------------------------------------------------------------- */

/* surface = integral |predicted - actual| dt ;  area = integral |actual| dt ;  accuracy = 1 - s/a
   Dollar-DAYS, not dollars: a balance chart is a curve, and being wrong for one day is a smaller
   error than being wrong for three weeks. */
const score = (pred, act) => {
	let surface = 0, area = 0
	act.forEach((v, i) => {area += Math.abs(v); surface += Math.abs(pred[i] - v)})
	return {surface: surface, area: area, accuracy: area ? 1 - surface/area : 0}
}

test("a perfect forecast scores 100%", () => {
	const a = [1000, 900, 800, 1200]
	expect(score(a.slice(), a).accuracy).toBe(1)
})

test("being wrong for three weeks costs more than being wrong for one day", () => {
	//the whole reason the metric integrates rather than comparing endpoints
	const actual = new Array(30).fill(1000)
	const oneDay = actual.slice(); oneDay[15] = 1500
	const allMonth = actual.map(v => v + 500)
	expect(score(oneDay, actual).accuracy).toBeGreaterThan(score(allMonth, actual).accuracy)
})

test("a forecast that is wrong all month and right at the end still scores badly", () => {
	//an end-of-month difference would call this perfect
	const actual = new Array(30).fill(1000)
	const wrong = actual.map((v, i) => i === 29 ? v : v + 800)
	const r = score(wrong, actual)
	expect(wrong[29]).toBe(actual[29])
	expect(r.accuracy).toBeLessThan(0.3)
})

test("normalising by the actual integral makes months comparable", () => {
	//the same relative error scores the same whether the account held $1k or $10k
	const poor = new Array(30).fill(1000), rich = new Array(30).fill(10000)
	const poorPred = poor.map(v => v*1.1), richPred = rich.map(v => v*1.1)
	expect(score(poorPred, poor).accuracy).toBeCloseTo(score(richPred, rich).accuracy, 9)
})

test("the score can go negative, and should be allowed to", () => {
	//a forecast wrong by more than the balance itself is worse than predicting nothing, and a metric
	//that floored at zero would hide how much worse
	const actual = new Array(10).fill(1000)
	expect(score(new Array(10).fill(-2000), actual).accuracy).toBeLessThan(0)
})

/* ---- per-stream accuracy, the four cases it has to get right ---------------------------------- */

/* Same shape as the headline, asked of one stream: its predicted cumulative curve against its own
   actual cumulative curve, and its own integral as the denominator. */
const streamScore = (pred, act) => {
	let p = 0, a = 0, err = 0, own = 0
	for(let i = 0; i < act.length; i++){
		p += pred[i]; a += act[i]
		err += Math.abs(p - a); own += Math.abs(a)
	}
	const denom = own > 0.005 ? own : err
	return denom > 0.005 ? 1 - err/denom : 1
}

test("moved nothing and predicted nothing is perfect, not undefined", () => {
	expect(streamScore(new Array(30).fill(0), new Array(30).fill(0))).toBe(1)
})

test("moved nothing but predicted something scores zero, not infinity", () => {
	const pred = new Array(30).fill(0); pred[5] = -1000
	expect(streamScore(pred, new Array(30).fill(0))).toBe(0)
})

test("moved something and predicted nothing scores zero", () => {
	const act = new Array(30).fill(0); act[5] = -1000
	expect(streamScore(new Array(30).fill(0), act)).toBe(0)
})

test("predicted on the right day for the right amount is perfect", () => {
	const both = new Array(30).fill(0); both[11] = -10
	expect(streamScore(both.slice(), both)).toBe(1)
})

test("a day or two late still scores well - it is not a binary", () => {
	//the case that looked broken in the report: a small, perfectly regular stream
	const pred = new Array(30).fill(0); pred[11] = -10
	const act = new Array(30).fill(0); act[13] = -10
	const r = streamScore(pred, act)
	expect(r).toBeGreaterThan(0.6)
	expect(r).toBeLessThan(1)
})

test("predicting the opposite direction goes NEGATIVE rather than flooring at zero", () => {
	//a floor would make "three times wrong" and "predicted nothing" look identical
	const act = new Array(30).fill(0); act[5] = -1000
	const backwards = new Array(30).fill(0); backwards[5] = 1000
	expect(streamScore(backwards, act)).toBeLessThan(0)
})

/* ---- balance accuracy vs transaction accuracy -------------------------------------------------- */

/* BALANCE compares the two curves; an error on day 3 is still wrong on day 30.
   TRANSACTION compares the flows; an error costs once, on the day it happens.
   The GAP between them is the diagnosis. */
const both = (predFlow, actFlow, opening) => {
	let pb = opening || 0, ab = opening || 0, surface = 0, area = 0
	let flowErr = 0, flowMag = 0, biasSum = 0
	for(let i = 0; i < actFlow.length; i++){
		pb += predFlow[i]; ab += actFlow[i]
		surface += Math.abs(pb - ab); area += Math.abs(ab)
		flowErr += Math.abs(predFlow[i] - actFlow[i])
		flowMag += Math.abs(actFlow[i]); biasSum += predFlow[i] - actFlow[i]
	}
	return {balance: area ? 1 - surface/area : 1, transaction: flowMag ? 1 - flowErr/flowMag : 1,
		bias: flowMag ? biasSum/flowMag : 0}
}

test("one early miss ruins the BALANCE score while barely touching the transaction score", () => {
	//this is why both exist: an error on day 3 is carried by every later balance
	const act = new Array(30).fill(0); act[2] = -500
	const pred = new Array(30).fill(0)
	const r = both(pred, act, 10000)
	expect(r.transaction).toBe(0)          //one flow missed out of one flow
	expect(r.balance).toBeGreaterThan(0.9) //against a $10k balance, a $500 step is a small surface
})

test("the two scores are NOT comparable - a healthy balance flatters the balance metric", () => {
	//the denominators differ by construction: one divides by the integral of the balance, the other
	//by the integral of the flows. An account holding $5,000 and moving $100 a day makes the first
	//denominator far larger, so a bias that compounds all month still scores well on balance.
	const act = new Array(30).fill(-100)
	const overspending = new Array(30).fill(-120)
	const r = both(overspending, act, 5000)
	expect(r.transaction).toBeCloseTo(0.8, 2)
	expect(r.balance).toBeGreaterThan(r.transaction)   //flattered, despite compounding every day
})

test("BIAS is what detects compounding, not the gap between the scores", () => {
	const act = new Array(30).fill(-100)
	const compounding = both(new Array(30).fill(-120), act, 5000)
	const cancelling = both(act.map((v, i) => i % 2 ? v - 40 : v + 40), act, 5000)
	//the same transaction-level error, one systematic and one not
	expect(cancelling.transaction).toBeLessThan(compounding.transaction)
	//and only the bias tells them apart
	expect(compounding.bias).toBeLessThan(-0.15)
	expect(Math.abs(cancelling.bias)).toBeLessThan(0.02)
	//the one that cancels leaves the balance nearly untouched, despite scoring worse per transaction
	expect(cancelling.balance).toBeGreaterThan(0.99)
})

test("bias is SIGNED, because only a one-directional error can be corrected", () => {
	const act = new Array(10).fill(-100)
	const over = new Array(10).fill(-150), under = new Array(10).fill(-50)
	expect(both(over, act, 1000).bias).toBeLessThan(0)
	expect(both(under, act, 1000).bias).toBeGreaterThan(0)
	//an unsigned error cannot tell these apart, and they need opposite corrections
	expect(both(over, act, 1000).transaction).toBeCloseTo(both(under, act, 1000).transaction, 6)
})
