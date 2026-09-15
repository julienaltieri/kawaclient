/* ==================================================================================================
   THE LEDGER, AGAINST THE CAPTURED PORTFOLIO.

   WHAT MATTERS HERE IS CONSERVATION: every transaction lands on exactly one account, every predicted
   event lands on exactly one account, a card repayment is set aside in PAIRS, and nothing appears
   twice. A balance is a cumulative sum over this, so an entry counted twice is a balance wrong for
   the rest of time.
   ================================================================================================== */

import fs from 'fs';
import path from 'path';
import {accountLedgers, inScope} from './accountLedger';
import {buildLedgerAuditPage, ledgerData} from './buildLedgerAuditPage';
import {backtests} from './backtest';
import {calibrate} from './calibration';
import {StreamPredictor} from '../streamPredictor';

const P = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');
const DAY = 24 * 60 * 60 * 1000;

describe('account ledgers', () => {
	let portfolio, predictor, built, until;

	beforeAll(() => {
		portfolio = JSON.parse(fs.readFileSync(P, 'utf8'));
		predictor = new StreamPredictor(portfolio);
		until = new Date(new Date(predictor.analysisNow()).getTime() + 90 * DAY);
		built = accountLedgers(portfolio, until, {predictor: predictor});
	});

	test('scope is a stream that is open and has moved this year', () => {
		const streams = inScope(predictor, predictor.analysisNow());
		expect(streams.length).toBeLessThan(predictor.reviewable().length);
		const edge = new Date(predictor.analysisNow());
		edge.setFullYear(edge.getFullYear() - 1);
		streams.forEach(s => {
			const legs = predictor.legsOf(s.id) || [];
			expect(legs.some(l => new Date(l.date).getTime() >= edge.getTime())).toBe(true);
		});
	});

	/* CONSERVATION, OVER THE ACCOUNTS THAT ARE KEPT. Dormant accounts are dropped deliberately -
	   two cards last used eleven months ago and two investment accounts that never moved - so the
	   claim is that nothing on a live account is lost or doubled, not that every row of the capture
	   appears somewhere. */
	test('every posted transaction on a live account lands there exactly once', () => {
		const seen = {};
		built.accounts.forEach(a => a.ledger
			.filter(e => e.source === 'posted')
			.forEach(e => {
				expect(seen[e.transactionId]).toBe(undefined);
				seen[e.transactionId] = a.accountId;
			}));
		const live = {};
		built.accounts.forEach(a => { live[a.accountId] = true; });
		const expected = (portfolio.transactions || []).filter(t =>
			live[t.userInstitutionAccountId]
			&& new Date(t.date).getTime() <= new Date(built.asOf).getTime()).length;
		expect(Object.keys(seen).length).toBe(expected);
		expect(expected).toBeGreaterThan(1000);
	});

	test('a dormant account is dropped and a live one is kept', () => {
		const names = built.accounts.map(a => a.name);
		expect(names).toContain('Spending Account');
		expect(names).toContain('Savings Account');
		expect(names.filter(n => /X1/.test(n)).length).toBe(0);
		expect(names.filter(n => /Robinhood (traditional|individual)/.test(n)).length).toBe(0);
	});

	test('every predicted event is either on a ledger or set aside, never both', () => {
		let onLedger = 0, aside = 0;
		built.accounts.forEach(a => {
			onLedger += a.ledger.filter(e => e.source === 'predicted').length;
			aside += a.setAside.length;
		});
		expect(onLedger + aside).toBe(built.events);
		expect(aside).toBe(built.setAside);
	});

	/* A REPAYMENT IS TWO LEGS OF ONE MOVEMENT, so they are set aside together or the ledgers
	   disagree about it. */
	test('card repayments are set aside in pairs that net to zero', () => {
		let net = 0, n = 0;
		built.accounts.forEach(a => a.setAside.forEach(e => { net += e.amount; n++; }));
		expect(n).toBeGreaterThan(0);
		expect(n % 2).toBe(0);
		expect(Math.round(net)).toBe(0);
	});

	/* AND THE CHARGES STAY. Setting aside everything that touches a card would leave it repaid and
	   never spent on. */
	test('card charges are kept while its repayments are removed', () => {
		const cards = built.accounts.filter(a => a.accountType === 'deferred');
		const withEvents = cards.filter(a =>
			a.ledger.some(e => e.source === 'predicted'));
		expect(withEvents.length).toBeGreaterThan(0);
		withEvents.forEach(a => {
			const pred = a.ledger.filter(e => e.source === 'predicted');
			//what remains on a card is spending: negative, and no repayment survived
			expect(pred.reduce((n, e) => n + e.amount, 0)).toBeLessThan(0);
			expect(a.setAside.length).toBeGreaterThan(0);
		});
	});

	test('every card resolves to the account that funds it', () => {
		const cards = built.accounts.filter(a => a.accountType === 'deferred'
			&& a.ledger.some(e => e.source === 'posted'));
		cards.forEach(a => expect(built.links[a.accountId]).toBeTruthy());
		Object.keys(built.links).forEach(card => {
			const funder = built.accounts.find(a => a.accountId === built.links[card]);
			expect(funder.accountType).toBe('realTime');
		});
	});

	test('the posted half stops at asOf and the predicted half starts there', () => {
		const at = new Date(built.asOf).getTime();
		built.accounts.forEach(a => a.ledger.forEach(e => {
			if(e.source === 'posted')expect(e.date.getTime()).toBeLessThanOrEqual(at);
			else expect(e.date.getTime()).toBeGreaterThanOrEqual(at);
		}));
	});

	test('writes the ledger bench page', () => {
		const seamDay = new Date(predictor.analysisAnchor()).getDate();
		/* EACH PAST CYCLE FORECAST FROM ITS OWN START, with the ledger rewound to that day. Without
		   the rewind the forecast has already seen the month it is predicting. */
		const past = backtests(portfolio, new Date(built.asOf), seamDay, 8);
		/* THE AMPLITUDE CORRECTION, MEASURED FROM THE BUILD IT CORRECTS: this account's own posted
		   history against one cycle of what the module claims for it. No rewind, one pass. */
		const cal = calibrate(built, {seamDay: seamDay});
		const corrected = accountLedgers(portfolio, until,
			{predictor: predictor, calibration: cal});
		Object.keys(cal).forEach(id => {
			expect(cal[id].multiplier).toBeGreaterThanOrEqual(1);
			expect(cal[id].multiplier).toBeLessThanOrEqual(2.5);
		});
		console.log('CALIBRATE ' + Object.keys(cal).map(id => {
			const acc = built.accounts.find(a => a.accountId === id);
			return (acc ? acc.name : id).slice(0, 18) + ' x' + cal[id].multiplier.toFixed(2)
				+ (cal[id].reason ? ' (' + cal[id].reason + ')' : '');
		}).join('  |  '));
		expect(past.length).toBeGreaterThan(3);
		past.forEach(c => c.accounts.forEach(a => a.rows.forEach(r => {
			expect(r.t).toBeGreaterThanOrEqual(c.from);
			expect(r.t).toBeLessThan(c.to);
		})));
		const data = ledgerData(corrected, {daysBack: 400, seamDay: seamDay, backtests: past,
			calibration: cal});
		const html = buildLedgerAuditPage(data, {asOf: new Date(built.asOf).toISOString()});
		fs.writeFileSync(path.join(__dirname, 'audit-ledger.html'), html, 'utf8');

		expect(/<!doctype|<html|<body/i.test(html)).toBe(false);
		const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
		expect(scripts.length).toBe(2);
		scripts.forEach(block => {
			const src = block.replace(/^<script>/, '').replace(/<\/script>$/, '');
			expect(src.indexOf(String.fromCharCode(92))).toBe(-1);
			expect(src.indexOf(String.fromCharCode(96))).toBe(-1);
			expect(() => new Function(src)).not.toThrow();
		});

		const gaps = built.accounts.reduce((n, a) => n + a.ledger
			.filter(e => e.source === 'posted' && !e.covered).length, 0);
		console.log('LEDGER ' + built.accounts.length + ' accounts, ' + built.events
			+ ' events, ' + built.setAside + ' set aside, ' + gaps
			+ ' posted entries with no predicting stream, '
			+ Math.round(html.length / 1024) + ' KB');
	}, 300000);
});
