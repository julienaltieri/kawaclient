/* ==================================================================================================
   THE BANK BALANCE OVER TIME, and its forecast. Page three of the visualisation carousel.

   THIS FILE REACHES ONLY FOR OTHER IMPORT-FREE MATH, for the reason MoneyFlowEngine imports nothing:
   the arithmetic here is the part that has to be checkable, and a module that reaches for Core or the
   design system can only be run inside a browser with a logged-in user. Everything else arrives as
   plain data, so the whole forecast can be driven from a bench with a captured master stream and a
   synthetic ledger - which is how every number in it was checked before it was drawn. AmountHistogram
   imports nothing either, so that property survives.

   THE TWO QUESTIONS IT EXISTS TO ANSWER (documentation/bank-balance.md):
     1. when is my current account at its lowest, so I know whether a large purchase fits
     2. what do I actually have, once the credit card is netted off
   They are the same reconstruction summed two ways, not two features.
   ================================================================================================== */

import * as histogram from './AmountHistogram';

const DAY = 86400000;
export const dayKey = d => new Date(d).toISOString().slice(0,10);
const daysInMonth = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).getUTCDate();

/* ---- what the master expects, per day -------------------------------------------------------------
   EVERY PREDICTION COMES FROM A TERMINAL STREAM. A compound's expected amount is DEFINED as the sum
   of its active children (model.js, CompoundStream), so asking a parent and asking its leaves is the
   same question and reading both double-counts. It is also the only level where a SHAPE exists: rent
   is a cliff on the 1st and groceries is a flat drip, and pooled into their parent the pair reads as
   rent alone wearing the parent's name. So the caller hands us terminals and we never walk upward. */
export function monthlyExpectationAt(stream, when, periodName){
	//the model's own step function and period conversion, not a copy of it
	const v = stream.getExpectedAmountAtDateByPeriod(when, periodName);
	return v || 0;
}

/* ---- WHEN in the month it lands -------------------------------------------------------------------
   Binned by day of month, weighted by AMOUNT rather than by count, aggregated over the whole history
   supplied. A programmed stream collapses to one spike and lands as a cliff; a diffuse one spreads,
   which is a measured fact about it rather than a smoothing applied to it.

   The binning and the normalisation are AmountHistogram's, shared with the macro graph's own
   histogram. What is NOT shared is the bin index: that chart derives it from the period machinery and
   rotates the result, and this one bins by day-of-month across a fixed 31 because the window here is
   days centred on today rather than an analysis period. Sharing the calendar as well would mean
   building a StreamAnalysis per terminal to throw it away.

   asWeights, NOT asShape - see AmountHistogram for why that distinction is the whole point.

   CONSOLIDATED FIRST. A paycheck that moves off a weekend, or off a 30th that February does not have,
   is one event recorded on several days; left spread, the forecast draws several small steps where one
   large one belongs, and the balance chart is read for its steps. consolidate() collapses only runs
   narrow enough to be one event that moved, so a genuinely diffuse stream is untouched. */
export function histogramOf(txnsForStream){
	return histogram.asWeights(histogram.consolidate(histogram.accumulate(txnsForStream,
		t => new Date(t.date).getUTCDate() - 1, t => t.amount, 31)));
}

/* ---- WHICH ACCOUNT a stream lands on, MEASURED -----------------------------------------------------
   The card is the loudest case - the spending happens on its own days and the money leaves the current
   account in one lump weeks later - but it is not the only one: with more than one current account,
   forecasting every stream onto whichever one is on screen would put the rent against the savings
   balance. So this names the ACCOUNT a stream lands on, not merely whether it is a card.

   It is DISCOVERED from where the stream's own transactions actually landed, never declared in a
   list. A hand-kept list is a second author for a fact the ledger already states, and it goes stale
   the first time a subscription moves to a different card.

   BY WEIGHT OF MONEY, not by count: a single mis-routed transaction must not move a stream off the
   account it lives on, and a stream genuinely split is drawn where most of it is. A stream with no
   history at all returns undefined and the caller decides - treating it as landing on the default
   account is the safer error, since it then arrives on its own day rather than a fortnight later, and
   the trough it contributes to appears early rather than not at all. */
export function accountRoutingOf(txnsByStream){
	const home = {};
	Object.keys(txnsByStream).forEach(id => {
		const byAccount = {};
		txnsByStream[id].forEach(t => {
			if(!t.accountHash)return;
			byAccount[t.accountHash] = (byAccount[t.accountHash] || 0) + Math.abs(t.amount);
		});
		let best = 0, who;
		Object.keys(byAccount).forEach(h => {if(byAccount[h] > best){best = byAccount[h]; who = h}});
		home[id] = who;
	});
	return home;
}

/* ---- THE PAST, BACKWARDS FROM A KNOWN BALANCE ------------------------------------------------------
   balance(t) = balance(now) minus everything that happened after t. Anchored to a number that is
   actually known, so the error is bounded by the completeness of the transaction record rather than
   by a guess at an opening figure.

   THE DRIFT IS THE POINT, not a defect to hide. Every stream is supposed to pass through these
   accounts; where the reconstruction disagrees with a balance the bank actually reported, something
   is uncategorised or unlinked, and that is worth seeing. */
export function reconstruct(txns, now, balanceNow, from){
	const byDay = {};
	/* COMPARED AS DAYS, NOT AS INSTANTS. `now` is a day boundary and a transaction carries a time, so
	   an instant comparison drops everything that happened later today - and, worse, only when the
	   tile is opened early in the day. ISO day keys sort lexically, which is why this is a string
	   compare rather than arithmetic. */
	const today = dayKey(now);
	txns.forEach(t => {const k = dayKey(t.date);
		if(k <= today){byDay[k] = (byDay[k]||0) + t.amount}});
	const out = [];
	let bal = balanceNow;
	for(let d = new Date(now); d >= from; d = new Date(d.getTime() - DAY)){
		out.push({date: new Date(d), value: bal, actual: true});
		bal -= (byDay[dayKey(d)]||0);            //stepping back over a day undoes it
	}
	return out.reverse();
}

/* ---- THE FUTURE -----------------------------------------------------------------------------------
   Each terminal's monthly expectation spread over the days of the month in the proportions its own
   histogram gives, summed, and accumulated forward from today's balance. */
export function forecast(opts){
	const terminals = opts.terminals, shapes = opts.shapes, routing = opts.routing;
	const now = opts.now, periodName = opts.periodName;
	/* `covers(accountHash)` decides whether a stream landing on that account belongs in THIS reading.
	   One predicate for all three cases - a single account, several combined, or the netted position -
	   so the forecast has one rule and the caller owns the policy. */
	const covers = opts.covers || (() => true);
	const out = [];
	let bal = opts.balanceNow;
	const end = new Date(now.getTime() + opts.days*DAY);
	for(let d = new Date(now.getTime() + DAY); d <= end; d = new Date(d.getTime() + DAY)){
		let day = 0, who = null, big = 0;
		const nDays = daysInMonth(d), i = d.getUTCDate()-1;
		terminals.forEach(s => {
			const amt = monthlyExpectationAt(s, d, periodName);
			if(!amt)return;
			/* in the NETTED reading every stream lands on the day it is spent and the settlement is
			   not spending at all. In an account reading, a stream that lives on some other account
			   never touches this one - the card's settlement does, and it is added below as a lump. */
			if(!covers(routing[s.id]))return;
			const h = shapes[s.id];
			/* NO factor here. The bins are day-OF-MONTH and aggregate every month into the same 31
			   slots, so weights[i] is already the fraction of ONE month's money landing on that day
			   and they sum to 1 over a month. Scaling by the number of months aggregated forecasts
			   every stream that many times over. */
			const w = (h && h.any) ? h.weights[i]/h.massIn(nDays) : (1/nDays);
			const part = amt * w;
			/* WHO MOVED IT. A forecast day is a sum, and without carrying the biggest contributor out
			   with it a mark in the future has a size and no name - every label downstream could then
			   only say "payments". One comparison per stream per day. */
			if(Math.abs(part) > Math.abs(big)){big = part; who = s.name}
			day += part;
		});
		if(opts.settlementDay && opts.settles && d.getUTCDate() === opts.settlementDay){
			//the card's bill, forecast the way the spending was: last month's card streams at their
			//expected amounts. Not a stream of its own - a RE-TIMING of streams already counted,
			//which is why it exists only where the card is outside the reading.
			let bill = 0;
			terminals.forEach(s => {if(opts.settles(routing[s.id])){
				bill += monthlyExpectationAt(s, d, periodName)}});
			day += bill;
			if(Math.abs(bill) > Math.abs(big)){big = bill; who = "Credit card payment"}
		}
		day -= (opts.leakPerMonth||0)/nDays;
		bal += day;
		out.push({date: new Date(d), value: bal, actual: false, top: who, topAmount: big});
	}
	return out;
}

export function trough(series){let lo = null;
	series.forEach(p => {if(!lo || p.value < lo.value){lo = p}}); return lo}
export function peak(series){let hi = null;
	series.forEach(p => {if(!hi || p.value > hi.value){hi = p}}); return hi}

/* the biggest daily movements, so the marks on the line can be named. The past names itself from the
   ledger; the future carries the attribution the forecast produced, because there are no transactions
   there to look up. */
export function eventsIn(series, txns, floor){
	const byDay = {};
	txns.forEach(t => {const k = dayKey(t.date); (byDay[k] = byDay[k] || []).push(t)});
	const out = [];
	for(let i = 1; i < series.length; i++){
		const p = series[i], step = p.value - series[i-1].value;
		let who = null, big = 0;
		(byDay[dayKey(p.date)] || []).forEach(t => {
			if(Math.abs(t.amount) > Math.abs(big)){big = t.amount; who = t.streamName}});
		if(!who && p.top){who = p.top; big = p.topAmount}
		if(Math.abs(step) > floor){out.push({date: p.date, value: p.value, step: step, stream: who})}
	}
	return out;
}
