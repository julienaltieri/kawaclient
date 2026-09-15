/* ==================================================================================================
   ONE FORMULA FOR EVERY CADENCE, CHECKED.

   A repayment clears every charge in the window it closes. A weekly sweep is that rule at offset
   zero and a monthly statement is the same rule with the issuer's own gap, so the tests below run
   the formula against both shapes and against the captured portfolio.
   ================================================================================================== */

import fs from 'fs';
import path from 'path';
import {owed, fitOffset, settlementsFor, cardSettlements, MAX_OFFSET} from './settlement';
import {accountLedgers} from './accountLedger';
import {StreamPredictor} from '../streamPredictor';

const P = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');
const DAY = 24 * 60 * 60 * 1000;
const at = (y, m, d) => Date.UTC(y, m, d);

describe('the settlement formula', () => {
	test('a window is half-open, so a charge is cleared exactly once', () => {
		const charges = [
			{t: at(2026, 0, 5), a: -10},
			{t: at(2026, 0, 10), a: -20},
			{t: at(2026, 0, 15), a: -30}
		];
		//(5, 15] takes the 10th and the 15th, never the 5th
		expect(owed(charges, at(2026, 0, 5), at(2026, 0, 15))).toBe(-50);
		expect(owed(charges, at(2026, 0, 10), at(2026, 0, 15))).toBe(-30);
		//consecutive windows partition the charges with nothing counted twice
		const a = owed(charges, 0, at(2026, 0, 10));
		const b = owed(charges, at(2026, 0, 10), at(2026, 0, 31));
		expect(a + b).toBe(-60);
	});

	/* THE SAME FORMULA, TWO CADENCES. A sweep pays what is there; a statement pays what was there
	   when it closed, so a charge after the close waits for the next one. */
	test('a weekly sweep fits offset zero', () => {
		const charges = [], repayments = [];
		for(let w = 0; w < 10; w++){
			charges.push({t: at(2026, 0, 1) + (w * 7 + 2) * DAY, a: -100});
			charges.push({t: at(2026, 0, 1) + (w * 7 + 4) * DAY, a: -50});
			//paid on day 7 of each week, clearing that week
			repayments.push({t: at(2026, 0, 1) + (w * 7 + 7) * DAY, a: 150});
		}
		const fit = fitOffset(charges, repayments, MAX_OFFSET);
		expect(fit.offset).toBe(0);
		expect(fit.error).toBeLessThan(1);
	});

	/* THE OFFSET IS ONLY IDENTIFIABLE IF A CHARGE FALLS BETWEEN THE CLOSE AND THE PAYMENT, and the
	   amounts differ month to month. With a charge pattern that repeats exactly, every offset that
	   crosses no charge produces the same partition and the fit cannot tell them apart - which is
	   true of the world too, and is why the fit is a best explanation rather than a measurement. */
	test('a monthly statement fits its own gap without being told there is one', () => {
		const charges = [], repayments = [];
		const OFFSET = 6;
		const early = m => -(100 + 10 * m);
		const late = m => -(50 + 5 * m);
		for(let m = 0; m < 8; m++){
			charges.push({t: at(2026, m, 3), a: early(m)});
			//after the close on the 20th, so this one waits for next month's payment
			charges.push({t: at(2026, m, 23), a: late(m)});
		}
		for(let m = 1; m < 8; m++)
			//paid on the 26th: last month's late charge plus this month's early one
			repayments.push({t: at(2026, m, 26), a: -(late(m - 1) + early(m))});
		//the first entry only anchors the window
		repayments.unshift({t: at(2026, 0, 26), a: 0});

		/* AN OFFSET IS ONLY IDENTIFIABLE TO THE NEAREST CHARGE. The close may sit anywhere between
		   the last charge it takes and the first it leaves - here the 20th to the 22nd - and every
		   day in that band partitions the charges identically. The fit answers the smallest, which
		   is the earliest close consistent with the evidence, and the settlements it produces are
		   the same whichever day in the band is picked. */
		const fit = fitOffset(charges, repayments, MAX_OFFSET);
		expect(fit.error).toBeLessThan(1);
		expect(fit.offset).toBeGreaterThan(OFFSET - 3);
		expect(fit.offset).toBeLessThanOrEqual(OFFSET);

		//and the settlements are identical across the band, which is what makes the ambiguity safe
		const dates = repayments.map(r => r.t);
		const a1 = settlementsFor(charges, dates, fit.offset, at(2026, 0, 1));
		const a2 = settlementsFor(charges, dates, OFFSET, at(2026, 0, 1));
		expect(a1.map(x => Math.round(x.amount))).toEqual(a2.map(x => Math.round(x.amount)));
	});

	test('settlements partition the charges and never clear one twice', () => {
		const charges = [];
		for(let i = 0; i < 12; i++)charges.push({t: at(2026, 0, 1) + i * 3 * DAY, a: -25});
		const dates = [at(2026, 0, 11), at(2026, 0, 21), at(2026, 0, 31)];
		const s = settlementsFor(charges, dates, 0, at(2026, 0, 1));
		expect(s.length).toBe(3);
		const total = s.reduce((n, x) => n + x.amount, 0);
		//everything after the opening close and up to the last one, once
		expect(total).toBe(-owed(charges, at(2026, 0, 1), at(2026, 0, 31)));
		s.forEach(x => expect(x.close.getTime()).toBe(x.date.getTime()));
	});

	test('a later close never reaches back past an earlier one', () => {
		const charges = [{t: at(2026, 0, 10), a: -100}];
		//two repayment dates whose closes both land after the charge
		const s = settlementsFor(charges, [at(2026, 0, 15), at(2026, 0, 20)], 0, at(2026, 0, 1));
		expect(s[0].amount).toBe(100);
		expect(Math.abs(s[1].amount)).toBe(0);
	});
});

describe('settlements on the captured portfolio', () => {
	let portfolio, predictor, built, plans;

	beforeAll(() => {
		portfolio = JSON.parse(fs.readFileSync(P, 'utf8'));
		predictor = new StreamPredictor(portfolio);
		const until = new Date(new Date(predictor.analysisNow()).getTime() + 120 * DAY);
		built = accountLedgers(portfolio, until, {predictor: predictor});
		plans = built.settlements;
	});

	test('the offset is fitted from real repayments and reproduces them closely', () => {
		const cards = Object.keys(plans);
		expect(cards.length).toBeGreaterThan(0);
		cards.forEach(c => {
			const plan = plans[c];
			expect(plan.offset).toBeGreaterThanOrEqual(0);
			expect(plan.offset).toBeLessThanOrEqual(MAX_OFFSET);
			if(plan.fitTested > 10){
				//the mean miss is small against the repayments it is reproducing
				expect(plan.fitError).toBeLessThan(400);
				console.log('SETTLE offset=' + plan.offset + 'd  mean miss $'
					+ Math.round(plan.fitError) + ' over ' + plan.fitTested
					+ ' repayments, ' + plan.settlements.length + ' forecast');
			}
		});
	});

	/* BOTH ACCOUNTS MOVE AND THE MONEY IS ONE MOVEMENT. A settlement written onto a card without its
	   other half would pay the card from nowhere. */
	test('every settlement appears on both accounts, netting to zero', () => {
		Object.keys(plans).forEach(c => {
			const plan = plans[c];
			const card = built.accounts.find(a => a.accountId === plan.card);
			const funder = built.accounts.find(a => a.accountId === plan.fundedFrom);
			if(!card || !funder)return;
			const onCard = card.ledger.filter(e => e.source === 'settlement');
			const onFunder = funder.ledger.filter(e => e.source === 'settlement');
			expect(onCard.length).toBeGreaterThan(0);
			expect(onCard.length).toBe(onFunder.length);
			const net = onCard.concat(onFunder).reduce((n, e) => n + e.amount, 0);
			expect(Math.abs(net)).toBeLessThan(0.005);
			//a repayment lands on the card as a credit and leaves the funder as a debit
			onCard.forEach(e => expect(e.amount).toBeGreaterThan(0));
			onFunder.forEach(e => expect(e.amount).toBeLessThan(0));
		});
	});

	test('running the stage again does not repay its own output', () => {
		const again = cardSettlements(portfolio, built.accounts,
			{found: predictor.repaymentLinks(), asOf: new Date(built.asOf)});
		Object.keys(again).forEach(c => {
			const first = plans[c].settlements.reduce((n, x) => n + x.amount, 0);
			const second = again[c].settlements.reduce((n, x) => n + x.amount, 0);
			expect(Math.round(second)).toBe(Math.round(first));
		});
	});

	test('what the card owes today is not forgiven', () => {
		Object.keys(plans).forEach(c => {
			expect(typeof plans[c].pending).toBe('number');
			//the first forecast settlement covers the window that starts before today
			const first = plans[c].settlements[0];
			if(first)expect(first.close.getTime())
				.toBeGreaterThan(new Date(built.asOf).getTime() - 40 * DAY);
		});
	});
});
