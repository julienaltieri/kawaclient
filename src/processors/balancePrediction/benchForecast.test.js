/* ==================================================================================================
   THE BENCH FORECAST'S OWN COST, NOT JUST ITS ANSWER.

   `cachedBuild()` builds a ledger TWICE for one window - once to measure the calibration, once to
   apply it - and a naive read of that had each build construct its own `StreamPredictor` and walk
   every stream's schedule from a cold cache. `accountLedgers()` memoizes per-stream work
   (`shapeOf`/`cycleOf`/`legsOf`, ...) ON THE PREDICTOR INSTANCE, so a fresh one earns nothing back
   the second call could not have kept for free - see the comment on `predictor:` in cachedBuild().

   THIS FILE PINS THE COST, not just the shape. A correctness test would still pass if the fix were
   reverted; only a timing comparison catches "works, but twice as slow again". ================== */

import fs from 'fs';
import path from 'path';
import {accountLedgers, accountLedgersAsync} from './accountLedger';
import {benchForecast, benchForecastAsync} from './benchForecast';
import {StreamPredictor} from '../streamPredictor';

const P = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');
const DAY = 24 * 60 * 60 * 1000;

describe('bench forecast cost', () => {
	let portfolio, now, covered;

	beforeAll(() => {
		portfolio = JSON.parse(fs.readFileSync(P, 'utf8'));
		now = new Date(portfolio.today);
		covered = portfolio.accounts.map(a => a.hash);
	});

	test('accountLedgers hands back the predictor it built, so a second build can reuse it', () => {
		const predictor = new StreamPredictor(portfolio);
		const built = accountLedgers(portfolio, new Date(now.getTime() + 30 * DAY),
			{asOf: now, predictor: predictor});
		expect(built.predictor).toBe(predictor);
		//and a caller that hands its OWN predictor in gets that one back, not a freshly-built one
		const untouched = accountLedgers(portfolio, new Date(now.getTime() + 30 * DAY), {asOf: now});
		expect(untouched.predictor).toBeInstanceOf(StreamPredictor);
		expect(untouched.predictor).not.toBe(predictor);
	});

	/* ONE COLD accountLedgers BUILD IS THE YARDSTICK. benchForecast() does two builds for one window
	   (plain, then calibrated) - reusing the first build's predictor for the second means the whole
	   call should cost close to ONE cold build, not two. Before the fix this ran at roughly 2x a
	   single cold build; the margin below (1.6x) is generous enough to hold on a slower CI box while
	   still catching a full regression back to two independent builds. */
	test('one benchForecast call costs close to one cold ledger build, not two', () => {
		const close = new Date(now.getTime() + 30 * DAY);

		const t0 = Date.now();
		accountLedgers(portfolio, close, {asOf: now});
		const oneColdBuild = Date.now() - t0;

		const t1 = Date.now();
		benchForecast(portfolio, now, close, covered, {});
		const wholeForecast = Date.now() - t1;

		expect(wholeForecast).toBeLessThan(oneColdBuild * 1.6);
	});
});

/* ==================================================================================================
   THE ASYNC TWINS, ON CORRECTNESS.

   JEST HAS NO REAL `Worker` (jsdom does not implement one), so every `*Async` call here runs the
   FALLBACK path in schedulePool.js - `ensurePool()` sees `typeof Worker === 'undefined'` and hands
   `accountLedgersAsync` a `null` pool, which it reads as "compute this stream on this thread
   instead". That is exactly the degradation path a browser with no Worker support (or one that
   refuses to construct a module worker) takes too, so this suite is a real test of it - it is NOT a
   test of the actual multi-thread speedup, which only a real browser's Worker pool can produce. See
   documentation/bank-balance.md for how that was checked by hand.

   THE CLAIM WORTH PINNING HERE: the async path must answer the identical question the sync path
   does, so that swapping one for the other in BalanceChart.js changes nothing about what is drawn,
   only when the work happens. ================================================================== */
describe('async forecast, on the fallback path (no Worker under Jest)', () => {
	let portfolio, now, covered;

	beforeAll(() => {
		portfolio = JSON.parse(fs.readFileSync(P, 'utf8'));
		now = new Date(portfolio.today);
		covered = portfolio.accounts.map(a => a.hash);
	});

	test('accountLedgersAsync answers exactly what accountLedgers does', async () => {
		const until = new Date(now.getTime() + 30 * DAY);
		const sync = accountLedgers(portfolio, until, {asOf: now});
		const async_ = await accountLedgersAsync(portfolio, until, {asOf: now});

		expect(async_.streams).toBe(sync.streams);
		expect(async_.events).toBe(sync.events);
		expect(async_.setAside).toBe(sync.setAside);
		expect(Object.keys(async_.silence).sort()).toEqual(Object.keys(sync.silence).sort());
		expect(async_.silence).toEqual(sync.silence);
		expect(async_.accounts.map(a => a.accountId).sort())
			.toEqual(sync.accounts.map(a => a.accountId).sort());
		//every account's own ledger, event for event - date, amount, source, in the same order
		const shape = accs => accs.map(a => ({
			accountId: a.accountId,
			ledger: a.ledger.map(e => [e.date.getTime(), e.amount, e.source, e.streamId])
		})).sort((x, y) => x.accountId < y.accountId ? -1 : x.accountId > y.accountId ? 1 : 0);
		expect(shape(async_.accounts)).toEqual(shape(sync.accounts));
	});

	test('benchForecastAsync answers exactly what benchForecast does', async () => {
		const close = new Date(now.getTime() + 30 * DAY);
		const sync = benchForecast(portfolio, now, close, covered, {});
		const async_ = await benchForecastAsync(portfolio, now, close, covered, {});

		expect(async_.flow).toEqual(sync.flow);
		expect(async_.events).toBe(sync.events);
		expect(async_.settlements).toBe(sync.settlements);
		expect(async_.history).toBe(sync.history);
		expect(async_.streams).toBe(sync.streams);
		expect(Object.keys(async_.calibration).sort()).toEqual(Object.keys(sync.calibration).sort());
	});

	test('two concurrent benchForecastAsync calls for the same window share one build', async () => {
		//a fresh portfolio object, so this doesn't read a result cachedBuildAsync already memoised in
		//an earlier test in this file
		const fresh = JSON.parse(JSON.stringify(portfolio));
		const close = new Date(now.getTime() + 30 * DAY);
		const [a, b] = await Promise.all([
			benchForecastAsync(fresh, now, close, covered, {}),
			benchForecastAsync(fresh, now, close, covered, {})
		]);
		expect(a.built).toBe(b.built);
	});
});
