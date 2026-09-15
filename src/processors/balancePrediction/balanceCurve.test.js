/* ==================================================================================================
   §5 — A LEDGER PINNED TO A BALANCE.

   Two halves. The arithmetic is checked on a made-up ledger where the right answer can be written
   down by hand; the wiring is checked on the captured portfolio, where the only claim worth making
   is that the curve agrees with the account the bank reports.
   ================================================================================================== */

import fs from 'fs';
import path from 'path';
import {anchorFor, balancePoints} from './balanceCurve';
import {accountLedgers} from './accountLedger';
import {AccountKind} from '../streamPredictor/accountMapping';

const d = s => new Date(s + 'T12:00:00');

describe('the arithmetic', () => {
	const ledger = [
		{date: d('2026-01-01'), amount: -100, source: 'posted'},
		{date: d('2026-01-05'), amount: -40, source: 'posted'},
		{date: d('2026-01-05'), amount: -10, source: 'posted'},
		{date: d('2026-01-20'), amount: -25, source: 'predicted'}
	];
	const anchor = {balance: 850};

	test('the anchor is true on its own date', () => {
		const {points} = balancePoints(ledger, anchor, d('2026-01-10'));
		const on5 = points.filter(p => p.date.getDate() === 5)[0];
		expect(on5.balance).toBe(850);
	});

	test('history runs backwards from it and the forecast forwards', () => {
		const {points, opening, closing} = balancePoints(ledger, anchor, d('2026-01-10'));
		expect(opening).toBe(900);          //850 + 40 + 10
		expect(closing).toBe(825);          //850 - 25
		expect(points.length).toBe(3);      //one point per date, not per entry
	});

	test('a day with three entries moves the balance once', () => {
		const {points} = balancePoints(ledger, anchor, d('2026-01-10'));
		expect(points.map(p => p.date.getDate())).toEqual([1, 5, 20]);
	});

	test('a card anchor is flipped: `current` counts what is owed', () => {
		const card = anchorFor({current: 609.86}, AccountKind.deferred, d('2026-01-10'));
		const cash = anchorFor({current: 692.13}, AccountKind.realTime, d('2026-01-10'));
		expect(card.balance).toBeCloseTo(-609.86, 2);
		expect(card.flipped).toBe(true);
		expect(cash.balance).toBeCloseTo(692.13, 2);
		expect(cash.flipped).toBe(false);
	});

	test('no balance reported, no anchor', () => {
		expect(anchorFor({}, AccountKind.realTime, d('2026-01-10'))).toBe(null);
	});
});

const fixture = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');
const has = fs.existsSync(fixture);
(has ? describe : describe.skip)('on the captured portfolio', () => {
	let built;
	beforeAll(() => {
		const portfolio = JSON.parse(fs.readFileSync(fixture, 'utf8'));
		const until = new Date(portfolio.today);
		until.setMonth(until.getMonth() + 3);
		built = accountLedgers(portfolio, until);
	});

	test('every account carries an anchor and a curve', () => {
		built.accounts.forEach(a => {
			expect(a.anchor).toBeTruthy();
			expect(a.points.length).toBeGreaterThan(0);
		});
	});

	test('the curve passes through the balance the bank reports', () => {
		built.accounts.forEach(a => {
			const at = built.asOf.getTime();
			const before = a.points.filter(p => p.date.getTime() <= at);
			expect(before[before.length - 1].balance).toBeCloseTo(a.anchor.balance, 6);
		});
	});

	test('the card sits in debt and the current account does not', () => {
		const card = built.accounts.filter(a => a.accountType === AccountKind.deferred)[0];
		expect(card.anchor.balance).toBeLessThan(0);
		built.accounts.filter(a => a.accountType === AccountKind.realTime)
			.forEach(a => expect(a.anchor.balance).toBeGreaterThan(0));
	});
});
