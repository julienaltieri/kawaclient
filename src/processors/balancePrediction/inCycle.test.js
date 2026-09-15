/* ==================================================================================================
   b — THE PREMIUM THE OPEN CYCLE IS RUNNING AT.

   Two things have to hold. It must act on an account whose spending is a rate, and it must refuse an
   account whose spending is a diary of bills: the first version did neither and cut the current
   account's rent by two thirds.
   ================================================================================================== */

import fs from 'fs';
import path from 'path';
import {benchForecast} from './benchForecast';
import {currentCycle} from './inCycle';

const P = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');
const DAY = 86400000;
const CHK = 'ins_25::4759::depository', CARD = 'ins_54::9869::credit';

describe('the in-cycle loop', () => {
	let portfolio, off, on;
	beforeAll(() => {
		portfolio = JSON.parse(fs.readFileSync(P, 'utf8'));
		const open = new Date('2026-08-06T00:00:00Z'), close = new Date('2026-08-27T00:00:00Z');
		off = benchForecast(portfolio, open, close, [CHK], {seamDay: 21, loop: false});
		on = benchForecast(portfolio, open, close, [CHK], {seamDay: 21});
	});

	//`loop: false` is how a caller asks for the baseline alone - the ablation the bench runs
	test('a alone when the caller asks for it, a x b otherwise', () => {
		Object.keys(off.calibration).forEach(id => {
			expect(off.calibration[id].boost).toBeUndefined();
		});
		expect(on.calibration[CARD].boost).toBeTruthy();
	});

	test('it acts on the card, which is scatter', () => {
		const k = on.calibration[CARD];
		expect(k.loop.rateShare).toBeGreaterThan(0.6);
		expect(k.loop.factor).toBeGreaterThan(1);
		expect(k.boost).toBeTruthy();
		//and only until the seam: next cycle is not this one
		expect(k.boost.to).toBe(currentCycle(on.asOf, 21).to);
	});

	test('it refuses the current account, which is bills', () => {
		const k = on.calibration[CHK];
		expect(k.loop.reason).toBe('this account is bills, not a rate');
		expect(k.loop.factor).toBe(1);
		expect(k.boost).toBe(null);
	});

	/* A BIGGER CLAIM ON THE CARD HAS TO REACH THE CURRENT ACCOUNT, or the loop has changed a number
	   nobody spends. The settlement formula clears the charges in its window, so a hotter cycle
	   produces larger repayments and the checking balance falls further. */
	test('a hotter cycle claims more on the card, and the repayments carry it to checking', () => {
		const chargedOn = r => r.built.accounts.filter(a => a.accountId === CARD)[0].ledger
			.filter(e => e.source === 'predicted' && e.amount < 0)
			.reduce((n, e) => n + e.amount, 0);
		const repaidFrom = r => r.built.accounts.filter(a => a.accountId === CHK)[0].ledger
			.filter(e => e.source === 'settlement')
			.reduce((n, e) => n + e.amount, 0);
		expect(chargedOn(on)).toBeLessThan(chargedOn(off));
		expect(repaidFrom(on)).toBeLessThan(repaidFrom(off));
	});
});
