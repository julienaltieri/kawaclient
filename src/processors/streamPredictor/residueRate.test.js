/* ==================================================================================================
   THE LAST RESCUE, AGAINST THE CAPTURED PORTFOLIO.

   WHAT MATTERS IS THE LINE IT DRAWS. A yearly envelope spent in nearly every month is a flow and
   earns a rate; a holiday with more movements than the flow is a burst and earns nothing. If those
   two land on the same side of the test the rescue is worse than silence, because it promises money
   on a stream that spends in bursts.
   ================================================================================================== */

import fs from 'fs';
import path from 'path';
import {StreamPredictor} from './index';
import {yearShape, spendsSteadily} from './residueRate';
import {AMOUNT_CONFIG} from './amountConfig';

const P = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');
const DAY = 24 * 60 * 60 * 1000;

describe('the residue rescue', () => {
	let predictor, until, byName, answer;

	beforeAll(() => {
		predictor = new StreamPredictor(JSON.parse(fs.readFileSync(P, 'utf8')));
		until = new Date(new Date(predictor.analysisNow()).getTime() + 90 * DAY);
		byName = n => predictor.reviewable().find(s => s.name === n);
		answer = n => {
			const s = byName(n);
			return s ? predictor.scheduleOf(s.id, until, s) : null;
		};
	});

	test('a steadily spent envelope is rescued, a burst is not', () => {
		//twelve months of scattered spending, no month dominant
		const flow = answer('Eléonore');
		expect(flow.silence).toBe('rescued');
		expect(flow.events.length).toBeGreaterThan(0);

		//more movements than Eléonore, in a third of the months: a holiday
		const burst = answer('Voyages');
		expect(burst.silence).toBe('yearly');
		expect(burst.events).toEqual([]);
	});

	test('the rescue only ever runs where nothing else predicted', () => {
		predictor.reviewable().forEach(s => {
			const r = predictor.scheduleOf(s.id, until, s);
			if(r.silence !== 'rescued')return;
			//a rescued stream had no cycle to read in the first place
			expect(/yearly/.test(r.cycle.name)).toBe(true);
			expect(r.rescued.months / r.rescued.windowMonths)
				.toBeGreaterThanOrEqual(AMOUNT_CONFIG.rescueMinMonthShare);
			expect(r.rescued.legs).toBeGreaterThanOrEqual(AMOUNT_CONFIG.rescueMinMovements);
			expect(r.rescued.peak).toBeLessThanOrEqual(AMOUNT_CONFIG.rescueMaxMonthShare);
		});
	});

	/* A RATE HAS NO DAYS IN IT. The whole reason this does not go through the mode machinery is that
	   splitting by payee manufactures dated bills out of scattered spending. */
	test('a rescued stream claims a rate and never a date', () => {
		const r = answer('Eléonore');
		r.events.forEach(e => {
			expect(e.kind).toBe('rate');
			expect(e.rail).toBe(null);
			expect(e.confidence).toBe(null);
			expect(e.wobble).toBe(0);
			expect(e.date.getTime()).toBeGreaterThanOrEqual(
				new Date(predictor.analysisNow()).getTime());
			expect(e.date.getTime()).toBeLessThanOrEqual(until.getTime());
		});
		//the same money every month, placed as whole movements
		const byMonth = {};
		r.events.forEach(e => {
			//padded, or a string sort puts October before September
			const k = e.date.getUTCFullYear() + '-'
				+ String(e.date.getUTCMonth() + 1).padStart(2, '0');
			byMonth[k] = (byMonth[k] || 0) + e.amount;
		});
		const whole = Object.keys(byMonth).sort().slice(1, -1);
		expect(whole.length).toBeGreaterThan(0);
		whole.forEach(k => expect(byMonth[k]).toBeCloseTo(byMonth[whole[0]], 2));
	});

	/* A YEAR THAT SUMS TO NOTHING HAS NO RATE IN IT, and a reimbursement stream is exactly that. */
	test('a zero-sum stream is refused by the same test', () => {
		['Returns', 'Medical HSA'].forEach(n => {
			const r = answer(n);
			if(r)expect(r.silence).not.toBe('rescued');
		});
	});

	test('the measure separates the two groups on the captured portfolio', () => {
		const rescued = [], silent = [];
		predictor.reviewable().forEach(s => {
			const r = predictor.scheduleOf(s.id, until, s);
			if(r.silence === 'rescued')rescued.push(s.name);
			else if(r.silence === 'yearly')silent.push(s.name);
		});
		expect(rescued.length).toBeGreaterThan(2);
		expect(silent.length).toBeGreaterThan(rescued.length);
		['Voyages', 'Voyages Famille', 'Ahsoka', 'DMV fee'].forEach(n =>
			expect(rescued).not.toContain(n));
		console.log('RESCUE ' + rescued.length + ' rescued: ' + rescued.join(', '));
	});

	test('the shape measure is the thing being tested, not the plumbing', () => {
		const flat = [];
		for(let i = 0; i < 24; i++)
			flat.push({date: new Date(Date.UTC(2026, i % 12, 1 + (i % 26))), amount: -50,
				accountId: 'a'});
		const shape = yearShape(flat);
		expect(shape.months).toBe(12);
		expect(spendsSteadily(shape, 12)).toBe(true);

		//everything in one month, however many movements
		const burst = [];
		for(let i = 0; i < 40; i++)
			burst.push({date: new Date(Date.UTC(2026, 5, 1 + (i % 28))), amount: -50,
				accountId: 'a'});
		expect(spendsSteadily(yearShape(burst), 12)).toBe(false);
	});
});
