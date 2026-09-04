/* ==================================================================================================
   THE BANK BALANCE OVER TIME, and its forecast. Page three of the visualisation carousel.

   THIS FILE IMPORTS NOTHING, for the same reason MoneyFlowEngine does not: the arithmetic here is the
   part that has to be checkable, and a module that reaches for Core or the design system can only be
   run inside a browser with a logged-in user. Everything it needs arrives as plain data, so the whole
   forecast can be driven from a bench with a captured master stream and a synthetic ledger - which is
   how every number in it was checked before it was drawn.

   THE TWO QUESTIONS IT EXISTS TO ANSWER (documentation/bank-balance.md):
     1. when is my current account at its lowest, so I know whether a large purchase fits
     2. what do I actually have, once the credit card is netted off
   They are the same reconstruction summed two ways, not two features.
   ================================================================================================== */

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

   NOT ReportingCore.getFrequencyHistogramAtDate, deliberately. That one normalises by its MAXIMUM,
   which is right for drawing a shape and wrong as a set of weights - used as weights it forecasts a
   stream several times over. It is also cached per StreamAnalysis against an observation period, and
   this view's window is 7/15/30 days centred on today, which is not an analysis period; getting one
   histogram per terminal that way would mean constructing an analysis per stream to throw it away.
   The duplication is real and is the price of those two mismatches. */
export function histogramOf(txnsForStream){
	const bins = new Array(31).fill(0);
	txnsForStream.forEach(t => {bins[new Date(t.date).getUTCDate()-1] += Math.abs(t.amount)});
	/* the RAW total, taken BEFORE the divide-by-zero default. Asking "sum > 0" after a "|| 1" makes
	   "do I have any data" always true, so a stream with no history gets an all-zero shape and is
	   forecast as nothing at all - and the flat fallback below becomes unreachable. */
	const raw = bins.reduce((a,b) => a+b, 0);
	const sum = raw || 1;
	const weights = bins.map(b => b/sum);
	/* how much of the shape lands inside a month of "days". The bins run to 31 and most months are
	   shorter, so in a 30-day month day 31's weight is never applied and the month forecasts light -
	   February loses three days of it. Renormalising by the mass that actually falls inside the month
	   makes a whole month worth a whole month whatever its length. */
	const massIn = days => {let t = 0; for(let i = 0; i < days && i < 31; i++)t += weights[i];
		return t || 1};
	return {weights: weights, massIn: massIn, any: raw > 0};
}

/* ---- WHICH ACCOUNT a stream lands on, MEASURED -----------------------------------------------------
   The card is the whole of the "credit card nonsense": the spending happens on its own days and the
   money leaves the current account in one lump weeks later. To forecast the current account we have
   to know which streams reach it directly and which arrive via the card.

   That is DISCOVERED from where the stream's own transactions actually landed, not declared in a
   list. A hand-kept list of card streams is a second author for a fact the ledger already states, and
   it goes stale the first time a subscription moves to a different card. A stream with no history at
   all is treated as direct, which is the safer error: it lands on its own day instead of a fortnight
   later, so the trough it contributes to arrives early rather than not at all. */
export function accountRoutingOf(txnsByStream, creditAccountHashes){
	const onCard = {};
	Object.keys(txnsByStream).forEach(id => {
		const ts = txnsByStream[id];
		if(!ts.length)return;
		let card = 0, tot = 0;
		ts.forEach(t => {const a = Math.abs(t.amount); tot += a;
			if(creditAccountHashes.indexOf(t.accountHash) > -1)card += a});
		//a majority, not any: a single mis-routed transaction must not move a stream off the account
		//it lives on, and a stream genuinely split across both is drawn where most of it is.
		onCard[id] = tot > 0 && card/tot > 0.5;
	});
	return onCard;
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
	txns.forEach(t => {const d = new Date(t.date);
		if(d <= now){byDay[dayKey(d)] = (byDay[dayKey(d)]||0) + t.amount}});
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
	const now = opts.now, mode = opts.mode, periodName = opts.periodName;
	const out = [];
	let bal = opts.balanceNow;
	const end = new Date(now.getTime() + opts.days*DAY);
	for(let d = new Date(now.getTime() + DAY); d <= end; d = new Date(d.getTime() + DAY)){
		let day = 0, who = null, big = 0;
		const nDays = daysInMonth(d), i = d.getUTCDate()-1;
		terminals.forEach(s => {
			const amt = monthlyExpectationAt(s, d, periodName);
			if(!amt)return;
			/* in the TRUE reading every stream lands on the day it is spent and the settlement is not
			   spending at all. In the ACCOUNT reading a card stream never touches this account - the
			   settlement does, added below as one lump. */
			if(mode !== "true" && routing[s.id])return;
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
		if(mode !== "true" && opts.settlementDay && d.getUTCDate() === opts.settlementDay){
			let bill = 0;
			terminals.forEach(s => {if(routing[s.id]){bill += monthlyExpectationAt(s, d, periodName)}});
			day += bill;
			if(Math.abs(bill) > Math.abs(big)){big = bill; who = "Credit card payment"}
		}
		day -= (opts.leakPerMonth||0)/nDays;
		bal += day;
		out.push({date: new Date(d), value: bal, actual: false, top: who, topAmount: big});
	}
	return out;
}

/* ---- readings -------------------------------------------------------------------------------------
   ONE reconstruction, summed two ways. "account" is the current account alone - goal 1, can I cover
   what is coming. "true" nets the card off - goal 2, what do I actually have. */
export const READINGS = [["account", "in the bank"], ["true", "after cards"]];

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
