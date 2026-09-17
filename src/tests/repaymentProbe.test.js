/* ==================================================================================================
   THE INSTRUMENT MUST REPORT WHAT THE FORECAST ACTUALLY DID.

   An instrument that lists one set of charges while the forecast added up another is worse than no
   instrument: it would make a correct forecast look wrong and, far worse, explain a wrong one with
   the wrong evidence. Someone would then go and check a statement line that was never in the sum.

   So this file asserts the two things that make `repaymentProbe` believable, against the captured
   portfolio:

     1. EVERY WINDOW'S MEMBERS ADD UP TO THAT WINDOW'S OWN AMOUNT. The probe computes `amount` with
        settlement.js's `owed()` and `check` by summing the rows it listed, deliberately by two
        routes - they must agree to the cent.
     2. THE PROBE'S SETTLEMENTS ARE cardSettlements()'s SETTLEMENTS. Same dates, same closes, same
        amounts - not similar ones.

   And one that makes the cutoff scan meaningful: at the fitted offset, the scan must reproduce the
   forecast's own first settlement exactly, or the other rows of the scan are answering a different
   question than the one on screen.
   ================================================================================================== */

import fs from 'fs';
import path from 'path';
import {StreamPredictor} from '../processors/streamPredictor';
import {accountLedgers} from '../processors/balancePrediction/accountLedger';
import {cardSettlements} from '../processors/balancePrediction/settlement';
import {repaymentProbe, reconcile} from '../processors/balancePrediction/repaymentProbe';

const P = path.join(__dirname, 'fixtures', 'portfolio.json');
const DAY = 24 * 60 * 60 * 1000;
const cents = v => Math.round(v * 100) / 100;

describe('the repayment probe, against the captured portfolio', () => {
	let portfolio, built, probe, settled;

	beforeAll(() => {
		portfolio = JSON.parse(fs.readFileSync(P, 'utf8'));
		const predictor = new StreamPredictor(portfolio);
		const asOf = new Date(portfolio.today);
		built = accountLedgers(portfolio, new Date(asOf.getTime() + 60 * DAY),
			{asOf: asOf, predictor: predictor});
		probe = repaymentProbe(portfolio, built, {asOf: asOf});
		settled = cardSettlements(portfolio, built.accounts, {asOf: asOf});
	});

	test('there is a card to probe at all, or the rest of this file proves nothing', () => {
		expect(probe.length).toBeGreaterThan(0);
		probe.forEach(c => {
			expect(c.historyCount).toBeGreaterThan(1);
			expect(c.chargeCount).toBeGreaterThan(0);
		});
	});

	/* THE CLAIM THE WHOLE INSTRUMENT RESTS ON. `amount` comes from owed(); `check` comes from adding
	   up the rows it put on screen. A reader is being asked to look for a wrong charge in that list,
	   so the list has to BE the sum. */
	test('every window it lists adds up to the amount it reports for that window', () => {
		let windows = 0;
		probe.forEach(c => {
			c.past.forEach(w => {expect(cents(w.check)).toBe(cents(w.amount)); windows++});
			c.future.forEach(w => {expect(cents(w.check)).toBe(cents(w.amount)); windows++});
		});
		expect(windows).toBeGreaterThan(10);
	});

	//and the past windows are the ones the fit was actually scored on: one per repayment after the first
	test('it reproduces one past window per posted repayment, after the first', () => {
		probe.forEach(c => expect(c.past.length).toBe(c.historyCount - 1));
	});

	/* NOT A SECOND OPINION - THE SAME ONE. If these ever diverge, the screen is explaining a forecast
	   nobody is drawing. */
	test('its settlements are cardSettlements\' settlements, date for date and cent for cent', () => {
		probe.forEach(c => {
			const theirs = settled[c.card];
			expect(theirs).toBeTruthy();
			expect(c.offset).toBe(theirs.offset);
			expect(cents(c.pending)).toBe(cents(theirs.pending));
			expect(c.future.length).toBe(theirs.settlements.length);
			c.future.forEach((w, i) => {
				expect(w.date.getTime()).toBe(theirs.settlements[i].date.getTime());
				expect(w.close.getTime()).toBe(theirs.settlements[i].close.getTime());
				expect(cents(w.amount)).toBe(cents(theirs.settlements[i].amount));
				//`settled` is what the forecast will draw; `amount` is what the members add up to
				expect(cents(w.settled)).toBe(cents(w.amount));
			});
		});
	});

	/* THE CUTOFF SCAN IS ABOUT THE REPAYMENT ON SCREEN. At the fitted offset it must land on the
	   number the forecast reached, or the neighbouring rows are not alternatives to it. */
	test('at the fitted offset, the cutoff scan reproduces the forecast\'s own next repayment', () => {
		probe.forEach(c => {
			if(!c.scan || !c.future.length)return;
			const atFit = c.scan.filter(r => r.offset === c.offset)[0];
			expect(atFit).toBeTruthy();
			expect(cents(atFit.amount)).toBe(cents(c.future[0].amount));
			expect(atFit.to.getTime()).toBe(c.future[0].to.getTime());
			expect(atFit.from.getTime()).toBe(c.future[0].from.getTime());
		});
	});

	/* RECONCILE NAMES ONLY WHAT WOULD ACTUALLY CLOSE THE GAP. A charge is negative and a repayment
	   positive, and getting that sign backwards would point at the wrong half of the list - so it is
	   asserted on a real window rather than assumed. */
	test('reconcile names a charge whose removal would close the gap, and nothing else', () => {
		const card = probe.filter(c => c.future.length && c.future[0].members.length)[0];
		expect(card).toBeTruthy();
		const w = card.future[0];
		const victim = w.members[0];
		//a truth that is short of the model by exactly one charge: that charge must be the candidate
		const truth = w.amount + victim.amount;
		const rec = reconcile(w.members, w.amount, truth);
		expect(cents(rec.gap)).toBe(cents(-victim.amount));
		expect(rec.singles.length).toBeGreaterThan(0);
		expect(rec.singles.map(m => cents(m.amount))).toContain(cents(victim.amount));
		//an exact answer leaves nothing to reconcile
		expect(reconcile(w.members, w.amount, w.amount).singles.length).toBe(0);
	});
});
