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
import {accountLedgers} from './accountLedger';
import {benchForecast} from './benchForecast';
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
