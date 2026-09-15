/* ==================================================================================================
   §3 — WHAT A CARD REPAYMENT WILL BE.

   ONE FORMULA FOR EVERY CADENCE:

       repayment(D) = every charge in (previous close, close],  where close = D - offset

   A WEEKLY AUTOPAY SWEEP AND A MONTHLY STATEMENT ARE THE SAME RULE with a different offset. A sweep
   clears whatever is outstanding on the day it runs, which is this formula at offset zero; a
   statement clears what was outstanding when it closed, days before the money moves, so charges made
   after the close roll into the next one. Forking on cadence would be two implementations of one
   idea, and the one that never runs on the captured portfolio would be the broken one.

   THE DATES ARE NOT GUESSED EITHER. The stream that repays the card is read by the same machinery as
   any other stream - on this portfolio a weekly lump on day 5 - so the schedule already says WHEN.
   What it cannot say is HOW MUCH, because a repayment is worth what the card owes rather than the
   middle of its own history, and that is the only number this stage computes.

   THE OFFSET IS FITTED, NOT DECLARED. Which purchases a repayment cleared is not stated by any
   aggregator and has to be reconstructed from dates and amounts. So every offset from zero to a
   fortnight is tried against the repayments that actually happened, and the one that reproduces them
   best is kept. On a weekly sweep that lands at or near zero by itself; on a monthly statement it
   finds the issuer's own gap without being told there is one.
   ================================================================================================== */

import {cardRepayments} from '../streamPredictor/cardRepayments';

const ONE_DAY = 24 * 60 * 60 * 1000;

/* HOW FAR BACK A CLOSE MAY SIT FROM THE DAY THE MONEY MOVES. Beyond a fortnight the window would
   start swallowing the previous cycle's charges whole. */
export const MAX_OFFSET = 14;

/* ---- THE ONE FORMULA ----------------------------------------------------------------------------
   EVERY CHARGE IN THE WINDOW A REPAYMENT COVERS. `charges` is ascending; `from` is exclusive so a
   charge is cleared exactly once, by the first repayment that closes after it. */
export function owed(charges, from, to){
	let sum = 0;
	for(let i = 0; i < charges.length; i++){
		const t = charges[i].t;
		if(t > from && t <= to)sum += charges[i].a;
	}
	return sum;
}

/* ---- WHICH OFFSET REPRODUCES THE PAST BEST ------------------------------------------------------ */
export function fitOffset(charges, repayments, maxOffset){
	if(repayments.length < 2)return {offset: 0, error: null, tested: 0};
	let best = null;
	for(let off = 0; off <= (maxOffset || MAX_OFFSET); off++){
		let error = 0, n = 0;
		for(let i = 1; i < repayments.length; i++){
			const close = repayments[i].t - off * ONE_DAY;
			const prev = repayments[i - 1].t - off * ONE_DAY;
			//a repayment is a credit on the card and the charges are debits: compare their sizes
			error += Math.abs(-owed(charges, prev, close) - repayments[i].a);
			n++;
		}
		const mean = n ? error / n : Infinity;
		if(!best || mean < best.error)best = {offset: off, error: mean, tested: n};
	}
	return best;
}

/* ---- THE SETTLEMENTS ----------------------------------------------------------------------------
   IN: a card's charges - posted and predicted - and the dates it is expected to be repaid on.
   OUT: one settlement per date, each the money owed in the window that date closes. */
export function settlementsFor(charges, dates, offset, lastClose){
	const out = [];
	let prev = lastClose;
	dates.forEach(d => {
		const close = d - offset * ONE_DAY;
		if(close <= prev)return;
		const amount = -owed(charges, prev, close);
		prev = close;
		out.push({date: new Date(d), close: new Date(close), amount: amount});
	});
	return out;
}

/* ---- FOR ONE PORTFOLIO --------------------------------------------------------------------------
   `pending` is the money a card owes that no future repayment will be asked to clear twice: charges
   already posted since the last repayment actually seen. A forecast that started its first window at
   the first predicted charge would silently forgive everything outstanding today. */
export function cardSettlements(portfolio, ledgers, opts){
	const o = opts || {};
	const found = o.found || cardRepayments(portfolio, o.overrides);
	const asOf = new Date(o.asOf || portfolio.today).getTime();
	const out = {};

	Object.keys(found.links).forEach(card => {
		const acc = (ledgers || []).filter(a => a.accountId === card)[0];
		if(!acc)return;

		/* THE CHARGES: everything on the card that is not a repayment, posted and predicted alike,
		   because a window that straddles today covers both.

		   A SETTLEMENT THIS STAGE WROTE IS NOT A CHARGE. Run twice over the same ledger - which a
		   caller may reasonably do - its own output would be read back as spending and repaid again,
		   each pass feeding the next. */
		const charges = acc.ledger
			.filter(e => !e.repayment && e.source !== 'settlement')
			.map(e => ({t: e.date.getTime(), a: e.amount}))
			.sort((x, y) => x.t - y.t);

		//the repayments that actually happened, which is what the offset is fitted against
		const history = acc.ledger
			.filter(e => e.source === 'posted' && e.repayment)
			.map(e => ({t: e.date.getTime(), a: e.amount}))
			.sort((x, y) => x.t - y.t);

		const fit = fitOffset(charges, history, o.maxOffset);
		const last = history.length ? history[history.length - 1].t - fit.offset * ONE_DAY : asOf;

		//the dates come from the schedule; the amounts are this stage's whole contribution
		const dates = (acc.setAside || [])
			.map(e => e.date.getTime())
			.filter(t => t > asOf)
			.sort((x, y) => x - y);

		out[card] = {
			card: card,
			fundedFrom: found.links[card],
			offset: fit.offset,
			fitError: fit.error,
			fitTested: fit.tested,
			pending: -owed(charges, last, asOf),
			settlements: settlementsFor(charges, dates, fit.offset, last)
		};
	});
	return out;
}

export default cardSettlements;
