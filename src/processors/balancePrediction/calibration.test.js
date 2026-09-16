/* ==================================================================================================
   THE AMPLITUDE CORRECTION, AND THE THREE WAYS IT DECLINES TO FIRE.

   A multiplier that engages on noise is worse than none: it would scale an already-unbiased forecast
   by whatever the last few months happened to do. So the interesting tests are the refusals.
   ================================================================================================== */

import fs from 'fs';
import path from 'path';
import {calibrationFor, calibrate} from './calibration';
import {accountLedgers} from './accountLedger';
import {StreamPredictor} from '../streamPredictor';

const P = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');
const DAY = 24 * 60 * 60 * 1000;

const charge = (t, a) => ({date: new Date(t), amount: a});
const build = (perCycle, count, cycleDays) => {
	const rows = [], cycles = [];
	for(let k = 0; k < count; k++){
		const from = Date.UTC(2026, 0, 1) + k * cycleDays * DAY;
		for(let i = 0; i < 10; i++)rows.push(charge(from + i * DAY, perCycle / 10));
		cycles.push({from: from, to: from + cycleDays * DAY, forecast: null});
	}
	return {rows: rows, cycles: cycles};
};

describe('the amplitude correction', () => {
	test('a consistent under-read earns its multiplier', () => {
		const b = build(-1000, 8, 30);
		//the forecast saw two thirds of it, every cycle
		b.cycles.forEach(c => { c.forecast = -667; });
		const cal = calibrationFor(b.rows, b.cycles);
		expect(cal.multiplier).toBeCloseTo(1.5, 1);
		expect(cal.agreement).toBe(1);
	});

	/* THE REFUSALS ------------------------------------------------------------------------------- */
	test('a forecast that is sometimes high and sometimes low is left alone', () => {
		const b = build(-1000, 8, 30);
		const f = [-500, -1400, -900, -1200, -800, -1300, -1000, -1100];
		b.cycles.forEach((c, i) => { c.forecast = f[i]; });
		const cal = calibrationFor(b.rows, b.cycles);
		expect(cal.multiplier).toBe(1);
		expect(cal.reason).toBe('no one-sided bias');
	});

	test('too little history measures nothing', () => {
		const b = build(-1000, 3, 30);
		b.cycles.forEach(c => { c.forecast = -500; });
		const cal = calibrationFor(b.rows, b.cycles);
		expect(cal.multiplier).toBe(1);
		expect(cal.reason).toBe('too few cycles to measure');
	});

	/* THE DENOMINATOR IS ONE NUMBER NOW, so a cycle can no longer be discarded for having been
	   forecast badly - there is no per-cycle forecast to be bad. The rule that used to drop them
	   existed because rewinding the capture eight times produced a denominator that degraded the
	   further back it went, which was a defect of the measurement rather than a fact about the
	   account. What IS still dropped is a cycle the LEDGER only partly covers, and that is dropped in
	   `calibrate`, where the account's first transaction is known. */
	test('every cycle with spending in it counts, however it was forecast', () => {
		const b = build(-1000, 8, 30);
		b.cycles.forEach((c, i) => { c.forecast = i < 4 ? -500 : -667; });
		const cal = calibrationFor(b.rows, b.cycles);
		expect(cal.cycles).toBe(8);
		expect(cal.agreement).toBe(1);
	});

	/* A PERCENTILE NEEDS A TAIL TO CUT. With eighty charges the ninety-ninth percentile IS the
	   largest one, so a lone enormous charge survives its own cut - true of any percentile rule, and
	   the reason the real card qualifies: 757 charges put the cut at $1,000 against a median of $35. */
	test('a holiday does not teach it to expect a holiday', () => {
		const b = build(-1000, 8, 30);
		b.cycles.forEach(c => { c.forecast = -1000; });
		//enough ordinary charges for the top percentile to mean something
		for(let i = 0; i < 120; i++)
			b.rows.push(charge(Date.UTC(2026, 0, 1) + i * DAY, -10));
		//and one enormous charge: an event, not an under-read
		b.rows.push(charge(Date.UTC(2026, 0, 5), -40000));

		const cal = calibrationFor(b.rows, b.cycles);
		expect(cal.cut).toBeLessThan(40000);
		expect(cal.multiplier).toBe(1);
	});

	test('the multiplier is clamped', () => {
		const b = build(-100000, 8, 30);
		b.cycles.forEach(c => { c.forecast = -10; });
		const cal = calibrationFor(b.rows, b.cycles);
		expect(cal.multiplier).toBeLessThanOrEqual(2.5);
	});
});

describe('on the captured portfolio', () => {
	let portfolio, predictor, built, cal, corrected;

	beforeAll(() => {
		portfolio = JSON.parse(fs.readFileSync(P, 'utf8'));
		predictor = new StreamPredictor(portfolio);
		const asOf = new Date(predictor.analysisNow());
		const seamDay = new Date(predictor.analysisAnchor()).getDate();
		const until = new Date(asOf.getTime() + 120 * DAY);
		built = accountLedgers(portfolio, until, {predictor: predictor});
		cal = calibrate(built, {seamDay: seamDay});
		corrected = accountLedgers(portfolio, until,
			{predictor: predictor, calibration: cal});
	});

	test('the card is scaled and the current account is not', () => {
		const card = built.accounts.find(a => a.accountType === 'deferred');
		const cash = built.accounts.find(a => /Spending/.test(a.name || ''));
		expect(cal[card.accountId].multiplier).toBeGreaterThan(1);
		expect(cal[card.accountId].agreement).toBe(1);
		expect(cal[cash.accountId].multiplier).toBe(1);
		expect(cal[cash.accountId].reason).toBe('no one-sided bias');
	});

	/* THE CORRECTION SCALES CHARGES, AND THE REPAYMENTS FOLLOW because they are computed from the
	   charges afterwards. A settlement that cleared the raw forecast while the charges were scaled
	   would leave the card drifting. */
	test('scaled charges are cleared by the settlements that follow them', () => {
		const card = corrected.accounts.find(a => a.accountType === 'deferred');
		const m = cal[card.accountId].multiplier;
		const scaled = card.ledger.filter(e => e.uncalibrated !== undefined);
		expect(scaled.length).toBeGreaterThan(0);
		scaled.forEach(e => expect(e.amount).toBeCloseTo(e.uncalibrated * m, 6));

		const base = built.accounts.find(a => a.accountId === card.accountId);
		const spend = l => l.ledger.filter(e => e.source === 'predicted' && e.amount < 0)
			.reduce((n, e) => n + e.amount, 0);
		const repaid = l => l.ledger.filter(e => e.source === 'settlement')
			.reduce((n, e) => n + e.amount, 0);
		//more predicted spending, and more repayment to clear it
		expect(Math.abs(spend(card))).toBeGreaterThan(Math.abs(spend(base)));
		expect(repaid(card)).toBeGreaterThan(repaid(base));
		console.log('SCALED card x' + m.toFixed(2) + '  predicted spend '
			+ Math.round(spend(base)) + ' -> ' + Math.round(spend(card))
			+ '  repaid ' + Math.round(repaid(base)) + ' -> ' + Math.round(repaid(card)));
	});

	test('a repayment is never scaled, only what it clears', () => {
		corrected.accounts.forEach(a => a.ledger.forEach(e => {
			if(e.source === 'settlement')expect(e.uncalibrated).toBe(undefined);
		}));
	});
});
