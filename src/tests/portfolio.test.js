/**
 * portfolio.test.js — the real portfolio, replayed.
 *
 * Hand-built fixtures say what one mechanism MUST do. This says what eighty-seven real streams
 * actually do, which is the thing that keeps surprising us: a rule can pass its own test and lose four
 * points here, and only one of the two catches that.
 *
 * Skips itself when nobody has captured a fixture — see fixtures/README.md.
 */
jest.mock('dateformat', () => ({__esModule: true, default: () => ''}))

import {CompoundStream} from '../model'
import {buildModel, observedSeries, dayKey} from '../processors/BankBalance'
import {portfolioInputs, describeWithPortfolio} from './portfolioFixture'

describeWithPortfolio("the real portfolio", () => {
	/* describe.skip still RUNS its body - it only skips the tests inside - so the setup has to guard
	   itself or a machine without a fixture fails at import time, which is the one thing this must
	   never do. */
	const f = portfolioInputs()
	if(!f){test.skip("no fixture captured", () => {}); return}
	const master = new CompoundStream(f.masterStreamJson)
	const terminals = master.getAllTerminalStreams(true)
	const typeOf = a => f.accountTypes[a.hash]
		|| (a.type === "credit" ? "credit"
			: ((a.subtype || "").toLowerCase().indexOf("sav") > -1 ? "savings" : "checking"))
	const checking = f.accounts.filter(a => typeOf(a) === "checking" && a.current !== undefined)
		.map(a => a.hash)
	const cards = f.accounts.filter(a => typeOf(a) === "credit").map(a => a.hash)
	const since = new Date(f.asOf.getTime() - 365*86400000)

	const model = () => buildModel({transactions: f.transactions, terminals: terminals,
		accounts: f.accounts, covered: checking, cards: cards, fallback: checking[0],
		asOf: f.asOf, until: new Date(f.asOf.getTime() + 30*86400000), since: since,
		settlementDay: f.settlementDay})

	test("the model builds against it without throwing", () => {
		const m = model()
		expect(m.terminals.length).toBeGreaterThan(0)
		expect(Object.keys(m.shapes).length).toBe(m.terminals.length)
	})

	test("every terminal is routed, shaped and priced - no stream falls through", () => {
		/* The silent failure this catches: a stream with no routing predicts nothing and reports no
		   reason, so it vanishes from the forecast and from the audit at the same time. */
		const m = model()
		m.terminals.forEach(t => {
			expect(m.shapes[t.id]).toBeTruthy()
			expect(typeof m.expectedFor(t, f.asOf)).toBe("number")
			expect(isNaN(m.expectedFor(t, f.asOf))).toBe(false)
		})
	})

	test("the as-of law holds on real data, not just on a fixture built to test it", () => {
		//built twice, once from a truncated ledger: reading nothing after asOf must be provable here
		const full = model()
		const cut = buildModel({transactions: f.transactions.filter(t => t.date < f.asOf),
			terminals: terminals, accounts: f.accounts, covered: checking, cards: cards,
			fallback: checking[0], asOf: f.asOf,
			until: new Date(f.asOf.getTime() + 30*86400000), since: since,
			settlementDay: f.settlementDay})
		full.terminals.forEach(t => {
			expect(cut.expectedFor(t, f.asOf)).toBeCloseTo(full.expectedFor(t, f.asOf), 6)
		})
	})

	test("the drawn past agrees with what the bank reported, where it reported", () => {
		/* The $1,699.50 cheque, as a standing test. Any day the bank stated a balance for is that
		   balance - not a walk from today, which is only as good as the transaction record. */
		const spend = checking
		const byDay = {}
		;(f.remembered || []).forEach(x => {
			if(spend.indexOf(x.accountHash) < 0 || isNaN(x.current))return
			const k = dayKey(new Date(x.date))
			;(byDay[k] = byDay[k] || {})[x.accountHash] = x.current
		})
		const observed = {}
		Object.keys(byDay).forEach(k => {
			if(Object.keys(byDay[k]).length !== spend.length)return
			observed[k] = spend.reduce((n, h) => n + byDay[k][h], 0)
		})
		if(!Object.keys(observed).length)return          //no stored history in this capture
		const anchor = f.accounts.filter(a => spend.indexOf(a.hash) > -1)
			.reduce((n, a) => n + a.current, 0)
		const ledger = f.transactions.filter(t => spend.indexOf(t.userInstitutionAccountId) > -1)
			.map(t => ({date: t.date, amount: t.amount}))
		const r = observedSeries(ledger, f.asOf, anchor,
			new Date(f.asOf.getTime() - 120*86400000), observed)
		r.points.filter(p => observed[dayKey(p.date)] !== undefined)
			.forEach(p => expect(p.value).toBeCloseTo(observed[dayKey(p.date)], 4))
	})
})
