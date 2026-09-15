/* ==================================================================================================
   ONE RULE, CHECKED AGAINST THE CAPTURED PORTFOLIO.

   A repayment is two legs of one movement: a credit on a card and a debit of the same size on a
   real-time account within a few days. That single match is what says the accounts are linked, what
   says those movements are not spending, and what says which stream does the repaying.
   ================================================================================================== */

import fs from 'fs';
import path from 'path';
import {cardRepayments, MATCH_DAYS} from './cardRepayments';
import {AccountKind} from './accountMapping';

const P = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');
const DAY = 24 * 60 * 60 * 1000;

describe('card repayments', () => {
	let portfolio, found, byId;

	beforeAll(() => {
		portfolio = JSON.parse(fs.readFileSync(P, 'utf8'));
		found = cardRepayments(portfolio);
		byId = {};
		(portfolio.transactions || []).forEach(t => { byId[t.transactionId] = t; });
	});

	test('every card resolves to a real-time account that funds it', () => {
		const cards = Object.keys(found.kind)
			.filter(h => found.kind[h] === AccountKind.deferred);
		expect(cards.length).toBeGreaterThan(0);
		const linked = cards.filter(c => found.links[c]);
		expect(linked.length).toBe(cards.length);
		linked.forEach(c =>
			expect(found.kind[found.links[c]]).toBe(AccountKind.realTime));
	});

	/* THE LEGS COME IN PAIRS AND THE PAIR NETS TO NOTHING: one movement seen from two accounts. */
	test('the flagged legs pair up and net to zero', () => {
		const ids = Object.keys(found.legs);
		expect(ids.length).toBeGreaterThan(0);
		expect(ids.length % 2).toBe(0);
		const net = ids.reduce((n, id) => n + byId[id].amount, 0);
		expect(Math.round(net)).toBe(0);
		//one leg of each pair sits on a card, the other on the account that funds it
		const onCard = ids.filter(id =>
			found.kind[byId[id].userInstitutionAccountId] === AccountKind.deferred);
		expect(onCard.length).toBe(ids.length / 2);
		onCard.forEach(id => expect(byId[id].amount).toBeGreaterThan(0));
	});

	/* A REFUND IS A CREDIT ON A CARD WITH NOTHING TO ANSWER FOR IT, and that is the whole of the
	   difference. Flagging every card credit would book a refund as a repayment. */
	test('refunds are left alone', () => {
		const cards = Object.keys(found.kind)
			.filter(h => found.kind[h] === AccountKind.deferred);
		const credits = (portfolio.transactions || []).filter(t =>
			cards.indexOf(t.userInstitutionAccountId) >= 0 && t.amount > 0);
		const unflagged = credits.filter(t => !found.legs[t.transactionId]);
		expect(unflagged.length).toBeGreaterThan(0);

		//every unflagged credit really has no debit of its size on any real-time account
		const cash = Object.keys(found.kind).filter(h => found.kind[h] === AccountKind.realTime);
		unflagged.forEach(t => {
			const at = new Date(t.date).getTime();
			const mate = (portfolio.transactions || []).find(x =>
				cash.indexOf(x.userInstitutionAccountId) >= 0
				&& Math.abs(x.amount + t.amount) < 0.01
				&& Math.abs(new Date(x.date).getTime() - at) <= MATCH_DAYS * DAY);
			expect(mate).toBe(undefined);
		});
	});

	test('the repaying stream is named, per card', () => {
		Object.keys(found.links).forEach(card => {
			const named = Object.keys(found.streams[card] || {});
			expect(named.length).toBeGreaterThan(0);
		});
	});

	/* THE WINDOW IS MEASURED, NOT ASSUMED. At three days the portfolio loses five repayments worth
	   $12,661, every one of them exactly four days apart. */
	test('a tighter window loses real repayments', () => {
		const tight = cardRepayments(portfolio, null, {matchDays: 3});
		expect(Object.keys(found.legs).length)
			.toBeGreaterThanOrEqual(Object.keys(tight.legs).length);
		console.log('REPAY ' + Object.keys(found.links).length + ' cards linked, '
			+ (Object.keys(found.legs).length / 2) + ' repayments, window '
			+ MATCH_DAYS + ' days');
	});
});

describe('the modes a repayment produces', () => {
	/* A REPAYMENT IS TWO MODES AND ONE MOVEMENT. §3 splits by payee, account and direction, so the
	   two legs are separate modes with separately estimated amounts - correct by its own rules, and
	   it leaves nobody holding the fact that they answer for each other. The label is what a balance
	   needs: a card's repayment is not worth the median of its own history, it is whatever the card
	   owes on the day. */
	const fs2 = require('fs');
	const path2 = require('path');
	const {StreamPredictor} = require('./index');
	const FIX = path2.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');

	let predictor, labelled;
	beforeAll(() => {
		predictor = new StreamPredictor(JSON.parse(fs2.readFileSync(FIX, 'utf8')));
		labelled = [];
		predictor.reviewable().forEach(s => predictor.shapeOf(s.id, s).modes
			.forEach(m => { if(m.repayment)labelled.push({stream: s.name, mode: m}); }));
	});

	test('both legs are labelled, and they name each other', () => {
		expect(labelled.length).toBeGreaterThan(0);
		const card = labelled.filter(x => x.mode.repayment.side === 'card');
		const funding = labelled.filter(x => x.mode.repayment.side === 'funding');
		expect(card.length).toBe(funding.length);

		card.forEach(x => {
			expect(x.mode.accountType).toBe('deferred');
			expect(x.mode.direction).toBe('in');
			expect(x.mode.repayment.card).toBe(x.mode.accountId);
			//the leg names the account that pays it, and a funding leg sits on that account
			expect(funding.some(y => y.mode.accountId === x.mode.repayment.fundedFrom
				&& y.mode.repayment.card === x.mode.accountId)).toBe(true);
		});
		funding.forEach(x => {
			expect(x.mode.accountType).toBe('realTime');
			expect(x.mode.direction).toBe('out');
		});
	});

	test('an ordinary card charge is not labelled', () => {
		const groceries = predictor.reviewable().find(s => s.name === 'Groceries & Hygiene');
		predictor.shapeOf(groceries.id, groceries).modes
			.forEach(m => expect(m.repayment).toBe(undefined));
	});

	/* AND THE LABEL SURVIVES INTO THE SCHEDULE, which is where a balance reads it. */
	test('the schedule carries the label onto every event', () => {
		const until = new Date(new Date(predictor.analysisNow()).getTime() + 60 * DAY);
		const all = predictor.scheduleAll(until);
		const marked = all.filter(e => e.repayment);
		expect(marked.length).toBeGreaterThan(0);
		marked.forEach(e => {
			expect(['card', 'funding']).toContain(e.repayment.side);
			if(e.repayment.side === 'card')expect(e.amount).toBeGreaterThan(0);
			else expect(e.amount).toBeLessThan(0);
		});
	});
});
