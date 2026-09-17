/* ==================================================================================================
   THE REPAYMENT, SHOWING ITS WORKING.

   §3 (settlement.js) answers a card repayment with one number, and one number cannot be argued with.
   When the forecast says $4,645 and the issuer's own app says $4,378.03, the useful question is not
   "is the model wrong" - it plainly is, by $267 - but WHICH CHARGE the model put in a window the
   issuer did not. That is a question about a SET, not about a total, and nothing until now could
   name the set.

   THIS FILE ADDS NO ARITHMETIC OF ITS OWN. Every window it reports is one settlement.js computed,
   read back through the same `inWindow` predicate the sum used (see `membersIn`), and every charge
   it lists is one `owed()` added up. `check` on each window is the proof: the members' own sum,
   which must equal the amount the forecast reached independently. If those two ever disagree, the
   instrument is lying and says so rather than being believed.

   IT IS AN INSTRUMENT, NOT A FEATURE. Nothing in the shipped tile imports it; it exists for the
   sandbox, where a real portfolio and a real answer can be put side by side. ================== */

import {owed, membersIn, chargesOf, historyOf, fitOffset, settlementsFor, MAX_OFFSET}
	from './settlement';
import {cardRepayments} from '../streamPredictor/cardRepayments';

const ONE_DAY = 24 * 60 * 60 * 1000;

/* ONE CHARGE, NAMED. The ledger entry travels with each charge (see `chargesOf`), so this can say
   what a row IS - the bank's own description, whether it has actually posted or is still only
   predicted - rather than only when and how much. */
const rowOf = c => ({
	t: c.t,
	date: c.e.date,
	amount: c.a,
	source: c.e.source,
	label: c.e.label || c.e.streamName || "(no description)",
	streamName: c.e.streamName || null,
	transactionId: c.e.transactionId || null,
	predicted: c.e.source === 'predicted'
});

/* A WINDOW, ITS MEMBERS, AND THE PROOF THEY ARE THE SAME WINDOW. `amount` is what the forecast
   reached; `check` is the members' own sum. They are computed by different routes on purpose. */
const windowOf = (charges, from, to) => {
	const members = membersIn(charges, from, to).map(rowOf);
	return {
		from: new Date(from),
		to: new Date(to),
		members: members,
		amount: -owed(charges, from, to),
		check: -members.reduce((s, m) => s + m.amount, 0)
	};
};

/* ---- WHAT SITS NEAR AN EDGE ---------------------------------------------------------------------
   A CUTOFF FAULT IS A CHARGE ON THE WRONG SIDE OF A BOUNDARY, so the charges worth looking at are
   the ones NEAR one. Each is reported with which side it actually fell on and by how much, which is
   what makes "this one moved" a readable claim rather than a hunch. */
export function edgeRows(charges, at, days, from, to){
	const span = (days || 3) * ONE_DAY;
	return charges
		.filter(c => Math.abs(c.t - at) <= span)
		.map(c => Object.assign(rowOf(c), {
			offDays: (c.t - at)/ONE_DAY,
			inWindow: c.t > from && c.t <= to
		}));
}

/* ---- ONE CARD ----------------------------------------------------------------------------------
   The same three steps `cardSettlements()` takes - fit the offset, close the last window, settle the
   dates ahead - each stopping to say what it read. */
export function probeCard(acc, fundedFrom, asOfMs, maxOffset){
	const charges = chargesOf(acc);
	const history = historyOf(acc);
	const fit = fitOffset(charges, history, maxOffset || MAX_OFFSET);
	const offset = fit.offset;
	const last = history.length ? history[history.length - 1].t - offset * ONE_DAY : asOfMs;

	/* EVERY POSTED REPAYMENT, REPRODUCED. This is `fitOffset`'s own scoring loop with the working
	   left in: the same windows, against the amount that actually moved. A model that cannot
	   reproduce what already happened has no standing to predict what has not. */
	const past = [];
	for(let i = 1; i < history.length; i++){
		const w = windowOf(charges, history[i - 1].t - offset * ONE_DAY,
			history[i].t - offset * ONE_DAY);
		past.push(Object.assign(w, {
			date: history[i].e.date,
			actual: history[i].a,
			modelled: w.amount,
			error: w.amount - history[i].a,
			label: history[i].e.label || null,
			transactionId: history[i].e.transactionId || null
		}));
	}

	//the dates come from the schedule, exactly as the settlement stage takes them
	const dates = (acc.setAside || [])
		.map(e => e.date.getTime())
		.filter(t => t > asOfMs)
		.sort((x, y) => x - y);
	const settled = settlementsFor(charges, dates, offset, last);

	/* AND THE WINDOWS THOSE SETTLEMENTS SUMMED. `settlementsFor` walks `prev` forward itself, so the
	   same walk is repeated here to name each window's members - the first one opening at `last`,
	   which is the close of the last repayment that actually happened. */
	let prev = last;
	const future = settled.map(s => {
		const w = windowOf(charges, prev, s.close.getTime());
		prev = s.close.getTime();
		return Object.assign(w, {date: s.date, close: s.close, settled: s.amount});
	});

	return {
		card: acc.accountId,
		name: acc.name || null,
		mask: acc.mask || null,
		fundedFrom: fundedFrom || null,
		offset: offset,
		fitError: fit.error,
		fitTested: fit.tested,
		asOf: new Date(asOfMs),
		lastClose: new Date(last),
		lastRepaymentAt: history.length ? history[history.length - 1].e.date : null,
		pending: -owed(charges, last, asOfMs),
		chargeCount: charges.length,
		historyCount: history.length,
		past: past,
		future: future,
		//the evidence for a cutoff fault, around the first window still to come
		edges: future.length ? {
			opening: edgeRows(charges, last, 3, last, future[0].to.getTime()),
			closing: edgeRows(charges, future[0].to.getTime(), 3, last, future[0].to.getTime())
		} : null,
		//and what every other cutoff would have said for that same repayment
		scan: (future.length && history.length)
			? offsetScan(charges, history[history.length - 1].t, dates[0], maxOffset)
			: null
	};
}

/* ---- THE SAME WINDOW AT EVERY OFFSET -----------------------------------------------------------
   THE DECISIVE TEST FOR A CUTOFF FAULT. `offset` is fitted once, globally, against the whole history
   (fitOffset) - one number for an issuer whose own gap between closing a statement and moving the
   money need not be constant, and whose charges reach our ledger on the day the AGGREGATOR posted
   them rather than the day they were made.

   So: hold the repayment's date still, slide the close, and read what each choice would owe. If one
   of them lands exactly on the amount the bank actually says, the fitted offset is the fault and
   this names the offset that is not - which is a far stronger claim than "the total is off".
   Reported against the SAME `last`-to-close walk the forecast uses, moved together, because moving
   only the closing edge would silently re-cut the previous window too. */
export function offsetScan(charges, lastRepaymentT, dateT, maxOffset){
	const out = [];
	for(let k = 0; k <= (maxOffset || MAX_OFFSET); k++){
		const from = lastRepaymentT - k * ONE_DAY, to = dateT - k * ONE_DAY;
		out.push({
			offset: k,
			from: new Date(from),
			to: new Date(to),
			amount: -owed(charges, from, to),
			count: membersIn(charges, from, to).length
		});
	}
	return out;
}

/* ---- EVERY CARD THE PORTFOLIO REPAYS ----------------------------------------------------------- */
export function repaymentProbe(portfolio, built, opts){
	const o = opts || {};
	const found = o.found || cardRepayments(portfolio, portfolio.accountTypes || {});
	const asOfMs = new Date(o.asOf || portfolio.today).getTime();
	return Object.keys(found.links).map(card => {
		const acc = (built.accounts || []).filter(a => a.accountId === card)[0];
		return acc ? probeCard(acc, found.links[card], asOfMs, o.maxOffset) : null;
	}).filter(x => x);
}

/* ---- WHAT WOULD HAVE TO LEAVE THE WINDOW -------------------------------------------------------
   GIVEN A KNOWN ANSWER - the issuer's own app, say - the difference is not a mystery to be stared
   at but a number to be matched. Any single charge of exactly that size is the candidate; failing
   that, any PAIR of them. Nothing here decides the charge is wrong - only that removing it would
   reconcile the two, which is the question a person can then answer from the statement. */
export function reconcile(members, modelled, truth){
	const gap = Math.round((modelled - truth)*100)/100;
	if(!isFinite(gap) || Math.abs(gap) < 0.005)return {gap: gap, singles: [], pairs: []};
	const near = (a, b) => Math.abs(a - b) < 0.005;
	//a charge is negative and the repayment positive, so a charge of -gap is what over-counts by gap
	const singles = members.filter(m => near(-m.amount, gap));
	const pairs = [];
	for(let i = 0; i < members.length && pairs.length < 12; i++){
		for(let j = i + 1; j < members.length && pairs.length < 12; j++){
			if(near(-(members[i].amount + members[j].amount), gap))pairs.push([members[i], members[j]]);
		}
	}
	return {gap: gap, singles: singles, pairs: pairs};
}

export default repaymentProbe;
