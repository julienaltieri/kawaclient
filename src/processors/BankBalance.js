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
export function histogramOf(txnsForStream, opts){
	const dateOf = t => new Date(t.date), amountOf = t => t.amount;
	const cycle = histogram.detectCycle(txnsForStream, dateOf, amountOf,
		{prefer: (opts || {}).prefer});
	const bins = histogram.accumulate(txnsForStream, t => cycle.phaseOf(dateOf(t)), amountOf,
		cycle.bins);
	/* DRIFT IS MEASURED IN DAYS, NOT IN FRACTIONS OF A CYCLE - and deriving the collapse radius from
	   the bin count was the mistake. Every cycle here bins by DAY, so a payday that wanders two days
	   either side of its mark spans five bins whether the cycle is a week, a fortnight or a month. A
	   radius of bins/6 gave a semimonthly cycle three, which is narrower than the wander: the run
	   never collapsed, and a paycheck that arrives twice a month was spread across eleven days at a
	   sixth of its size each. Reported from the app as "wages predicted $2,612 when it is highly
	   predictable".

	   So the radius is SIX DAYS for every cycle, capped at half a turn so it can never swallow more
	   than half the cycle and invent a rhythm that is not there - which is what leaves a week at
	   three. The gap is two days on the same reasoning, capped the same way.

	   Six rather than five because a real cluster reaches that width in two ways at once. A payment
	   dodging a weekend moves up to three days; and a mark near a boundary WRAPS, so a payday drifting
	   from the 12th to the 16th crosses the half-month line, lands on phase 0, and its run reads as
	   eleven through fifteen plus zero - six bins describing five consecutive days. Month-end does the
	   same thing: a payment nominally on the 31st arrives on the 1st in a short month, which is one
	   cluster spanning the wrap. Five was measured as too narrow for both. */
	const maxSpan = Math.min(6, Math.max(2, Math.floor(cycle.bins/2)));
	const gap = Math.min(2, Math.max(1, Math.floor(cycle.bins/4)));
	const out = histogram.asWeights(histogram.consolidate(bins, maxSpan, gap));
	out.cycle = cycle;
	return out;
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
   the trough it contributes to appears early rather than not at all.

   AND IN THE DIRECTION THE STREAM ACTUALLY MOVES MONEY, which a transfer makes essential. A monthly
   transfer to savings is recorded as a PAIR - money out of the current account and the same money into
   the savings one - and both legs carry the same stream allocation, because they are one act. Weighed
   by magnitude alone the two legs tie exactly, so the winner was whichever the ledger happened to list
   first; when that was the savings side, the stream was routed to an account the spending reading does
   not cover and vanished from the forecast entirely. The transfer still appeared in the reconstructed
   past, because that is read off the account, which is what made it look like a rendering problem
   rather than a routing one.

   The stream's own expected amount says which leg is the one that matters: a savings transfer is money
   OUT, so it belongs to the account the money left. `directionOf` supplies that sign; where no leg
   matches it, every leg counts, so a stream with a surprising sign is still placed somewhere. */
export function accountRoutingOf(txnsByStream, directionOf){
	const home = {};
	Object.keys(txnsByStream).forEach(id => {
		const dir = directionOf ? directionOf(id) : 0;
		const all = txnsByStream[id];
		let matching = dir ? all.filter(t => (t.amount < 0 ? -1 : 1) === dir) : [];
		/* A ZERO-SUM STREAM DECLARES NOTHING, AND STILL MOVES MONEY ONE WAY FIRST.
		   With no declared direction there was nothing to break the tie with, and a transfer's two
		   legs are equal by construction - a card payment is exactly -$9,800 on checking and +$9,800
		   on the card. The winner was whichever the ledger happened to list first, and when the card
		   won, the stream was routed off the account being predicted and the single largest outflow in
		   the portfolio was forecast as $0.

		   The same tie, in a third place. Savings had it, paired transfers had it, and it reappeared
		   wherever the direction was unknown rather than merely unhelpful. So the rule is the one
		   groupByStream already uses: with nothing declared, FOLLOW THE MONEY OUT. A balance is moved
		   by what leaves the account, the outgoing leg is the one that moves it, and the two functions
		   now agree instead of each guessing. */
		if(!matching.length && !dir)matching = all.filter(t => t.amount < 0);
		const use = matching.length ? matching : all;
		const byAccount = {};
		use.forEach(t => {
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
/* WHAT ONE STREAM CONTRIBUTES ON ONE DAY.

   Pulled out of the forecast loop rather than written a second time beside it, because the audit
   view's whole purpose is to show what the forecast did - and a breakdown computed by a near-copy
   would eventually disagree with the thing it claims to explain, silently and in the direction of
   whichever copy was edited last. One definition, two callers.

   Returns 0 for a stream this reading does not cover, so a caller listing contributions gets the same
   answer the forecast used, including the zeroes. */
export function shareOfDay(s, d, opts){
	const routing = opts.routing || {}, shapes = opts.shapes || {};
	const covers = opts.covers || (() => true);
	const periodName = opts.periodName;
	const expectedFor = opts.expectedFor
		|| ((st, when) => monthlyExpectationAt(st, when, periodName));
	const amt = expectedFor(s, d);
	if(!amt)return 0;
	if(opts.excludeIds && opts.excludeIds[s.id])return 0;
	if(!covers(routing[s.id]))return 0;
	const nDays = daysInMonth(d);
	const h = shapes[s.id];
	let w;
	if(h && h.any && h.cycle){
		if(h.cycle.dayShare)w = h.cycle.dayShare(h.weights, d.getUTCDate(), nDays);
		else w = (h.cycle.daysPerCycle(d)/nDays) * h.weights[h.cycle.phaseOf(d)];
	}else w = 1/nDays;
	return amt * w;
}

/* Every stream's share of one day, biggest first, with the explicit events alongside. This is what an
   audit reads: not "the forecast said -$400" but which streams that -$400 is made of. */
export function contributionsOn(d, opts){
	const out = [];
	(opts.terminals || []).forEach(s => {
		const part = shareOfDay(s, d, opts);
		if(Math.abs(part) > 0.005)out.push({name: s.name, id: s.id, amount: part});
	});
	/* EVERY OTHER TERM THE FORECAST ADDS TO A DAY. A breakdown that lists only the streams is not a
	   breakdown, it is a subset - and a subset reads as an accounting, so the reader trusts it and
	   concludes the picture is wrong. These three are the rest of `day` in forecast(): the synthesised
	   card bill, the caller's explicit events, and the leak. */
	if(opts.settlementDay && opts.settles && d.getUTCDate() === opts.settlementDay){
		const periodName = opts.periodName;
		const expectedFor = opts.expectedFor
			|| ((st, when) => monthlyExpectationAt(st, when, periodName));
		let bill = 0;
		(opts.terminals || []).forEach(s => {
			if(opts.settles((opts.routing || {})[s.id]))bill += expectedFor(s, d);
		});
		if(Math.abs(bill) > 0.005)
			out.push({name: "Credit card payment", id: "__bill__", amount: bill});
	}
	const ex = opts.extraFlow ? opts.extraFlow[dayKey(d)] : null;
	if(ex && Math.abs(ex.amount) > 0.005){
		/* ONE ROW PER CARD where the caller distinguished them. "Card settlement -$950" against a real
		   -$3,498 does not say whether the model has the wrong amount, the wrong day, or the right
		   answer for the wrong card - and with two cards on different weekly cycles all three are
		   live. Naming the card, and splitting posted from projected, makes the next audit decide it. */
		if(ex.parts && ex.parts.length)ex.parts.forEach(p => {
			if(Math.abs(p.amount) > 0.005)out.push({name: p.name || "Card settlement",
				id: "__card__" + (p.card || ""), amount: p.amount,
				posted: p.posted, projected: p.projected});
		});
		else out.push({name: ex.name || "Card settlement", id: "__card__", amount: ex.amount});
	}
	if(opts.leakPerMonth){
		out.push({name: "Unmodelled drift", id: "__leak__",
			amount: -opts.leakPerMonth/daysInMonth(d)});
	}
	return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

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
		const nDays = daysInMonth(d);
		/* the caller may supply its own expectation - a yearly budget spread over the months it has
		   LEFT rather than over twelve, for instance. Defaulting to the master's own figure keeps this
		   module ignorant of the reporting calendar.

		   `excludeIds` drops named streams entirely. It exists for the card SETTLEMENT stream, whose
		   money is already modelled by re-timing the card's own streams onto the due day - forecasting
		   both pays the card twice, and forecasting neither pays it not at all. */
		const expectedFor = opts.expectedFor || ((st, when) => monthlyExpectationAt(st, when, periodName));
		terminals.forEach(s => {
			const part = shareOfDay(s, d, {routing: routing, shapes: shapes, covers: covers,
				periodName: periodName, expectedFor: expectedFor, excludeIds: opts.excludeIds});
			if(!part)return;
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
			terminals.forEach(s => {if(opts.settles(routing[s.id])){bill += expectedFor(s, d)}});
			day += bill;
			if(Math.abs(bill) > Math.abs(big)){big = bill; who = "Credit card payment"}
		}
		/* EXPLICIT EVENTS the caller has computed itself, keyed by day. The card settlement is one:
		   its amount is arithmetic on posted transactions rather than a rate times a shape, so it
		   cannot be expressed as a stream and a histogram. */
		if(opts.extraFlow){
			const ex = opts.extraFlow[dayKey(d)];
			if(ex){
				day += ex.amount;
				if(Math.abs(ex.amount) > Math.abs(big)){big = ex.amount; who = ex.name || "Card settlement"}
			}
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

/* ==================================================================================================
   IS THIS STREAM PREDICTABLE?

   The usefulness of the whole picture hinges on its accuracy; its accuracy cannot be perfect; so what
   is PREDICTABLE has to be very accurate, and what is not has to be visibly separated rather than
   quietly averaged in with it. Those are different natures and they want different fixes: a mis-timed
   regular payment is a modelling bug, and a genuinely erratic one is not a bug at all.

   A balance chart is read for its STEPS, so a stream is predictable exactly when you can say two
   things about it: WHEN the money moves, and HOW MUCH moves. Both are measured, neither is declared.

     timing     how concentrated the money is within one turn of the stream's own cycle. This is the
                same statistic the cycle detector uses, corrected for the free concentration that more
                bins and fewer observations hand out.
     steadiness how alike the turns are in SIZE. Per-occurrence totals, then one minus their
                coefficient of variation.

   THE EMPTY TURNS COUNT. A stream that fires in three months out of twelve looks perfectly steady if
   you only measure the three - so every turn between the first and the last observation is included,
   and the silent ones are zeros. Without that, "sporadic" reads as "regular".

   NOT ENOUGH DATA IS ITS OWN ANSWER, and it is the one that must never be dressed up as either of the
   others. Fewer than three observed turns cannot distinguish a rhythm from a coincidence.
   ================================================================================================== */

export const CLASSES = {predictable: "predictable", erratic: "erratic", thin: "not enough data"};

export function classifyStream(txns, monthlyAmount, opts){
	const o = opts || {};
	const minTiming = o.minTiming === undefined ? 0.45 : o.minTiming;
	const minSteady = o.minSteady === undefined ? 0.55 : o.minSteady;
	const dateOf = t => new Date(t.date), amountOf = t => t.amount;
	const k = (txns || []).length;
	const out = {k: k, monthly: monthlyAmount || 0, cycle: "monthly",
		timing: 0, steadiness: 0, turns: 0, klass: CLASSES.thin};
	if(k < 2)return out;

	const cycle = histogram.detectCycle(txns, dateOf, amountOf, {prefer: o.prefer});
	out.cycle = cycle.name;
	/* CONSOLIDATED FIRST - the same shape histogramOf hands the forecaster.
	   Scoring the raw bins here meant the classifier and the forecaster disagreed about the same
	   stream: a payday that moves off a weekend was smeared across four days for the classifier, which
	   called it erratic, while the forecaster saw the collapsed spike and drew it correctly. A
	   classification that describes a shape nobody uses cannot be acted on. */
	const maxSpan = Math.max(2, Math.round(cycle.bins/6));
	const bins = histogram.consolidate(
		histogram.accumulate(txns, t => cycle.phaseOf(dateOf(t)), amountOf, cycle.bins),
		maxSpan, cycle.bins > 20 ? 2 : 1);
	out.timing = histogram.concentration(bins, k);
	out.bins = bins;

	//per-occurrence totals, with the silent turns included as zeros
	const cyc0 = cycle;
	const byTurn = {};
	let lo = Infinity, hi = -Infinity;
	txns.forEach(t => {
		const n = histogram.occurrenceOf(cycle, dateOf(t));
		byTurn[n] = (byTurn[n] || 0) + Math.abs(amountOf(t));
		if(n < lo)lo = n;
		if(n > hi)hi = n;
	});
	/* A TURN BEFORE THE STREAM EXISTED IS NOT A MISSED PAYMENT.
	   The silent turns are counted as zeros so a sporadic stream cannot masquerade as a steady one -
	   but a stream budgeted at nothing until May and $1,000 after it was being scored against five
	   months of zeros it was never supposed to fill, and came out erratic for doing exactly what it
	   said it would. `expectedAt` is the stream's own step function, so the turns it was dormant in
	   are excluded rather than held against it. */
	const totals = [];
	for(let n = lo; n <= hi; n++){
		if(o.expectedAt && !o.expectedAt(histogram.dateOfOccurrence(cyc0, n)))continue;
		totals.push(byTurn[n] || 0);
	}
	out.turns = totals.length;
	if(out.turns < 3)return out;                 //a rhythm needs at least three beats to be one

	/* OUTLIERS ARE EXCLUDED FROM THE SCORE, NOT FROM REALITY.
	   A savings transfer that goes out every month and occasionally comes BACK is two different
	   events: the outgoing one is regular and predictable, the return is neither. Scored together the
	   stream looks erratic and is forecast as a spread, which loses the regular half as well - so the
	   monthly $4,000 disappears from the picture because the occasional $3,000 unsave exists.

	   Rejection is by median absolute deviation, which is the general tool rather than a rule about
	   savings: it makes no assumption about sign, direction or stream type, needs no threshold in
	   dollars, and applies unchanged to a refund on an expense stream or a one-off top-up on any
	   other. A turn more than three MADs from the median is not evidence about the typical turn.
	   The count is reported, because a stream with many "outliers" does not have outliers - it has a
	   distribution, and that is exactly the tier 3 case. */
	const kept = rejectOutliers(totals);
	out.outlierTurns = totals.length - kept.length;
	const base = kept.length >= 3 ? kept : totals;
	const mean = base.reduce((a, b) => a + b, 0)/base.length;
	const variance = base.reduce((a, b) => a + (b - mean)*(b - mean), 0)/base.length;
	const cv = mean ? Math.sqrt(variance)/mean : 1;
	out.steadiness = Math.max(0, 1 - cv);
	out.klass = (out.timing >= minTiming && out.steadiness >= minSteady)
		? CLASSES.predictable : CLASSES.erratic;
	return out;
}

/* The whole portfolio, sorted by how much of the money each stream carries - because a stream that is
   erratic and tiny is not a problem, and a stream that is erratic and large is the only thing worth
   looking at. */
export function classifyAll(terminals, txnsByStream, monthlyOf, opts){
	const rows = terminals.map(s => Object.assign(
		{id: s.id, name: s.name},
		classifyStream(txnsByStream[s.id] || [], monthlyOf(s), opts)));
	const total = rows.reduce((a, r) => a + Math.abs(r.monthly), 0) || 1;
	rows.forEach(r => {r.share = Math.abs(r.monthly)/total});
	return rows.sort((a, b) => Math.abs(b.monthly) - Math.abs(a.monthly));
}

/* ==================================================================================================
   EACH TERMINAL'S OWN TRANSACTIONS - which is not "every transaction that mentions it".

   Two things were being counted wrong, and both corrupt the classification rather than merely the
   totals - which is why they survived: every sum in the app was right.

   THE ALLOCATED AMOUNT, NOT THE TRANSACTION'S. A $200 order split $150/$50 across two streams is not
   evidence that either stream moves $200. Feeding the whole transaction to both inflates their
   histogram weights and destroys `steadiness`, which is a measure of how alike the amounts are.
   TransactionEvaluator has always used `Math.abs(allocation.amount)`; this now agrees with it.
   The SIGN comes from the transaction, because that is the direction the money moved on the account,
   and every part of a split moves the same way.

   A PAIRED TRANSFER IS ONE EVENT. A monthly move to savings is stored as two legs carrying the same
   allocation, so counting both made a $4,000 transfer look like $8,000 of activity every month - and
   `steadiness` then measured a quantity that never existed. TransactionEvaluator skips the second leg
   for exactly this reason.

   Direction decides WHICH leg is kept, never WHETHER to collapse: a pair is one event whatever its
   signs. That serves routing as well - a savings transfer expects money OUT, so the outgoing leg is
   kept and `accountRoutingOf` then sees the account the money actually left. Where the expected
   direction says nothing, the OUTGOING leg wins, because a spending account is moved by what leaves
   it; picking by ledger order there would reintroduce the order-dependence that routing already had
   to have fixed once.

   Allocations name their stream directly, so this also stops asking every stream about every
   transaction.
   ================================================================================================== */
export function groupByStream(transactions, terminalIds, directionOf){
	const out = {};
	(terminalIds || []).forEach(id => {out[id] = []});
	const candidates = [];
	(transactions || []).forEach(t => {
		if(!t.categorized || !t.streamAllocation)return;
		t.streamAllocation.forEach(al => {
			if(!out[al.streamId])return;
			const sign = t.amount < 0 ? -1 : 1;
			candidates.push({streamId: al.streamId, date: t.date,
				amount: sign*Math.abs(al.amount || 0),
				accountHash: t.userInstitutionAccountId,
				txnId: t.transactionId, pairId: t.pairedTransferTransactionId});
		});
	});

	//one leg per pair per stream, chosen by the stream's direction
	const pairs = {};
	candidates.forEach(c => {
		if(!c.pairId)return;
		const key = c.streamId + "::" + [String(c.txnId), String(c.pairId)].sort().join("|");
		(pairs[key] = pairs[key] || []).push(c);
	});
	const dropped = {};
	Object.keys(pairs).forEach(key => {
		const legs = pairs[key];
		if(legs.length < 2)return;                       //the other leg is out of range: keep this one
		const dir = directionOf ? directionOf(legs[0].streamId) : 0;
		const wanted = dir ? legs.filter(l => (l.amount < 0 ? -1 : 1) === dir) : [];
		const outgoing = legs.filter(l => l.amount < 0);
		const keep = wanted.length ? wanted[0] : (outgoing.length ? outgoing[0] : legs[0]);
		legs.forEach(l => {if(l !== keep)dropped[key + "::" + l.txnId] = true});
	});

	candidates.forEach(c => {
		if(c.pairId){
			const key = c.streamId + "::" + [String(c.txnId), String(c.pairId)].sort().join("|");
			if(dropped[key + "::" + c.txnId])return;
		}
		out[c.streamId].push({date: c.date, amount: c.amount, accountHash: c.accountHash});
	});
	return out;
}

/* ==================================================================================================
   THE THREE TIERS, and what each one predicts.

   Predictable/erratic was one axis and the forecast needs two, because "can I say WHEN" and "can I say
   HOW MUCH" fail independently and want different treatments:

     TIER 1  a discrete event, on a repeatable day, of a repeatable size.
             Predict the day and the amount. Nothing here is guesswork.

     TIER 2  a discrete event of a repeatable size, on a day that MOVES - rent, bills, a day-care
             cheque. Spreading it would be the wrong answer: a balance chart is read for its steps and
             a spread removes the event entirely. Predict the CENTRE of its cluster as the day, and a
             robust recent figure as the amount, and accept that the day carries error.

     TIER 3  no clear cluster - groceries, and anything whose size is not repeatable either.
             Spread it across the period, which is the only honest thing left.

   WHAT SEPARATES TIER 2 FROM TIER 3 IS NOT TIMING, it is whether there is an EVENT at all. One rent
   payment a month is discrete however much the day wanders; twenty grocery transactions are not, and
   no amount of concentration would make them one. So the discriminator is transactions per turn, and
   timing only decides between tier 1 and tier 2.

   THE PREDICTED DAY IS THE PEAK OF THE CONSOLIDATED HISTOGRAM, not the mean of the raw one. The month
   is a cycle: a payment landing on the 30th and the 2nd has a mean day of 16, the one day of the month
   it never happens. `consolidate` already merges wrapped clusters onto their heaviest day, so its peak
   is a circular answer by construction.

   THE PREDICTED AMOUNT IS A MEDIAN OF RECENT TURNS, not a mean and not the last one. A median cannot
   be moved by a single strange month; six turns is enough to be robust and short enough that a genuine
   step change is picked up within a cycle or two. Where there is no history it falls back to what the
   master stream expects, which is the only figure available.
   ================================================================================================== */

export const TIERS = {dated: 1, drifting: 2, spread: 3};

const median = xs => {
	const a = xs.slice().sort((x, y) => x - y), m = Math.floor(a.length/2);
	return a.length % 2 ? a[m] : (a[m-1] + a[m])/2;
};
/* A turn more than `k` median-absolute-deviations from the median is not evidence about a typical
   turn. MAD rather than standard deviation because the outlier is exactly what would inflate an SD
   and hide itself. Too few turns to have a middle, or a distribution where more than a third are
   "outliers", means there is no outlier to reject - only a spread. */
/* THE MEDIAN LAGS A TREND, and a utility bill that has been climbing all year is not going to stop
   because the middle of the last six months was lower. Prices rise; the prediction should say so.

   The slope is THEIL-SEN - the median of the pairwise slopes between turns - rather than a least
   squares fit, for the same reason the level is a median: one strange month must not set the
   direction. It is the standard robust estimator, so this is a general treatment of drift rather than
   a rule about utilities.

   IT ONLY APPLIES WHEN THE DRIFT IS BIGGER THAN THE NOISE. A slope smaller than the typical
   turn-to-turn deviation is not a trend, it is scatter with a sign, and extrapolating it would turn
   random variation into a confident forecast of more of the same. Below that bar the median stands.

   Extrapolated ONE turn past the last observation, never further: the next turn is what the forecast
   needs, and a slope estimated from a handful of points is not evidence about next year. */
function theilSen(ys){
	const slopes = [];
	for(let i = 0; i < ys.length; i++){
		for(let j = i+1; j < ys.length; j++)slopes.push((ys[j] - ys[i])/(j - i));
	}
	return slopes.length ? median(slopes) : 0;
}
function trendedMedian(all, usable){
	const level = median(usable);
	if(!all || all.length < 4)return level;
	const slope = theilSen(all);
	//the typical turn-to-turn move, as the bar a real trend has to clear
	const noise = median(all.map(v => Math.abs(v - level))) || 0;
	if(!slope || Math.abs(slope) < noise*0.5)return level;

	/* A STEP IS NOT A TREND, and Theil-Sen cannot tell them apart on its own. A rate that went from
	   $1,500 to $1,700 and stayed there produces a slope purely from the pairs that straddle the
	   change - every pair on either side of it is flat - and extrapolating that predicts $1,775 next
	   month, which is a decline nobody is having. A rising utility bill and a one-off rate change look
	   identical to a single slope and want opposite treatments.

	   They separate on the HALVES: a genuine ramp is still sloping inside its own first and second
	   half, and a step is flat in both. So the trend is only extrapolated when each half agrees with
	   the whole - same direction, and not a token amount of it. A step then falls through to the
	   median, which is the honest answer when the level has moved but is not moving. (Where the change
	   is recorded in the stream's own history, `regimeFrom` handles it better still, by not mixing the
	   two levels at all.) */
	const mid = Math.floor(all.length/2);
	const first = theilSen(all.slice(0, mid)), second = theilSen(all.slice(mid));
	const agrees = x => x !== 0 && (x > 0) === (slope > 0) && Math.abs(x) >= Math.abs(slope)*0.3;
	if(!agrees(first) || !agrees(second))return level;

	//from the middle of the observed run to one turn past its end
	const step = (all.length - 1)/2 + 1;
	return level + slope*step;
}

function rejectOutliers(totals, k){
	if(!totals || totals.length < 4)return (totals || []).slice();
	const med = median(totals);
	const mad = median(totals.map(v => Math.abs(v - med)));
	/* MAD IS ZERO WHENEVER THE MAJORITY ARE IDENTICAL, which is not the absence of an outlier - it is
	   the strongest possible evidence of one. Eleven transfers of exactly $4,000 and one reversal give
	   a median absolute deviation of 0, and bailing out on that left the reversal in the score, which
	   is precisely the case this exists for. With no spread to measure against, the tolerance falls
	   back to a small fraction of the median: identical turns still pass, anything genuinely different
	   does not. */
	const tol = mad ? (k === undefined ? 3 : k)*mad : Math.abs(med)*0.01;
	if(!tol)return totals.slice();
	const kept = totals.filter(v => Math.abs(v - med) <= tol);
	return (kept.length >= Math.ceil(totals.length*2/3)) ? kept : totals.slice();
}
const MAX_PER_TURN = 3;          //more transactions than this in a turn is not one event
const RECENT_TURNS = 6;

export function pointPrediction(txns, monthlyAmount, opts){
	const o = opts || {};
	const minTiming = o.minTiming === undefined ? 0.45 : o.minTiming;
	const minSteady = o.minSteady === undefined ? 0.55 : o.minSteady;
	const c = classifyStream(txns, monthlyAmount, o);
	const out = {tier: TIERS.spread, cycle: c.cycle, timing: c.timing, steadiness: c.steadiness,
		outlierTurns: c.outlierTurns || 0,
		turns: c.turns, k: c.k, perTurn: 0, day: null, second: null, confidence: 0,
		amount: monthlyAmount || 0, perTurnAmount: null, outliers: 0, regimeTurns: 0,
		thin: c.klass === CLASSES.thin};

	if(!txns || !txns.length)return out;

	const cyc = histogram.CYCLES[c.cycle] || histogram.CYCLES.monthly;
	//how many transactions land in a turn that has any - a turn with nothing in it says nothing about
	//whether this stream arrives as one event or as twenty
	const perTurn = {};
	txns.forEach(t => {const n = histogram.occurrenceOf(cyc, new Date(t.date));
		perTurn[n] = (perTurn[n] || 0) + 1});
	const counts = Object.keys(perTurn).map(n => perTurn[n]).sort((a, b) => a - b);
	out.perTurn = counts.length ? counts[Math.floor(counts.length/2)] : 0;

	const discrete = out.perTurn <= MAX_PER_TURN;
	if(discrete && c.steadiness >= minSteady){
		out.tier = c.timing >= minTiming ? TIERS.dated : TIERS.drifting;
	}

	/* the day: the heaviest bin of the consolidated shape, which is already a circular answer.
	   `confidence` is the share of the stream's money that lands on that one day - how much of a
	   point prediction the point actually is. A tier-2 stream with 0.9 there is a date that wobbles;
	   the same stream at 0.3 is barely a date at all, and the tier boundary is not saying so. */
	if(c.bins && c.bins.length){
		let peak = 0, total = 0;
		c.bins.forEach((v, i) => {total += v; if(v > c.bins[peak])peak = i});
		out.confidence = total ? c.bins[peak]/total : 0;
		//the SECOND peak too, for a stream that fires twice a turn - a semimonthly wage has two
		//paydays and one of them is not the answer
		let second = -1;
		c.bins.forEach((v, i) => {if(i !== peak && (second < 0 || v > c.bins[second]))second = i});
		out.second = (second >= 0 && total && c.bins[second]/total > 0.15) ? second : null;
		if(out.tier !== TIERS.spread)out.day = peak;
	}

	/* the amount: a median of the most recent turns, INCLUDING the silent ones inside the span, since
	   a stream that skipped a month really did move nothing that month.

	   ONLY THE CURRENT REGIME. When a stream's expected amount changes - a rent increase, a day-care
	   rate going from $1,500 to $1,700 in July - the turns before that change describe a different
	   agreement. Averaging across the change predicts a number that was never true and will never be
	   true again. `regimeFrom` is the date of the most recent change in the stream's own history, and
	   turns before it are not evidence about what happens next. Below three turns since the change
	   there is nothing to measure, so the declared figure stands - which is the right answer for a
	   rate that has only just been set. */
	if(out.tier !== TIERS.spread){
		const byTurn = {};
		let lo = Infinity, hi = -Infinity;
		txns.forEach(t => {
			const n = histogram.occurrenceOf(cyc, new Date(t.date));
			byTurn[n] = (byTurn[n] || 0) + t.amount;
			if(n < lo)lo = n;
			if(n > hi)hi = n;
		});
		const first = o.regimeFrom ? histogram.occurrenceOf(cyc, o.regimeFrom) : lo;
		const totals = [];
		for(let n = Math.max(lo, first, hi - RECENT_TURNS + 1); n <= hi; n++)totals.push(byTurn[n] || 0);
		out.regimeTurns = totals.length;
		const usable = rejectOutliers(totals);
		out.outliers = totals.length - usable.length;
		if(usable.length >= (o.regimeFrom ? 3 : 1)){
			out.perTurnAmount = trendedMedian(totals, usable);
			//stated per MONTH as well, since the caller wants it in the stream's own declared period
			//and the detected cycle is rarely the same thing
			out.amount = out.perTurnAmount * (30.44/(cyc.span || 30.44));
		}
	}
	return out;
}

/* How a predicted day reads, in the vocabulary of its own cycle. */
const WEEKDAYS = ["Thu","Fri","Sat","Sun","Mon","Tue","Wed"];   //day 0 of the unix epoch was a Thursday
export function dayLabel(cycleName, day){
	if(day === null || day === undefined)return "spread";
	if(cycleName === "weekly")return WEEKDAYS[day % 7];
	if(cycleName === "biweekly")return WEEKDAYS[day % 7] + (day < 7 ? " A" : " B");
	//a semimonthly phase is TWO days a month, and naming one of them would be half an answer
	if(cycleName === "semimonthly")return "day " + (day + 1) + " & " + (day + 16);
	return "day " + (day + 1);
}

/* the turns of this cycle that fit in a month - so an amount measured per turn can be stated per
   month, and from there in whatever period the stream itself declares */
export function turnsPerMonth(cycleName){
	const c = histogram.CYCLES[cycleName] || histogram.CYCLES.monthly;
	return 30.44/c.span;
}

/* ==================================================================================================
   IS THE CARD PAYMENT ALREADY IN THE LEDGER?

   The settlement synthesis exists to re-time card spending: purchases happen on their own days, the
   money leaves the current account weeks later in one lump. Where the card sits outside the reading,
   its streams are excluded from the daily flows and that lump is added back on the settlement day.

   That is correct exactly once. It stops being correct the moment the ledger ALSO contains a stream
   for the payments themselves - a "Credit Card Payments" transfer, whose outgoing legs land on the
   current account and which therefore routes to it and gets forecast like anything else. The
   synthesis then adds a second model of the same money and the card is paid twice: a large phantom
   outflow every month, in the spending reading only, which is why the netted reading - where nothing
   is synthesised - looked BETTER than the one that was supposed to be more careful.

   Detected structurally rather than by name: a transaction on the account being predicted whose
   PAIRED partner sits on a credit account is a card payment, whatever the stream is called. When the
   ledger shows those, it is already modelling the settlement, and measured beats synthesised - the
   real stream carries actual timing and actual amounts, and the synthesis only ever had expectations.

   Where a ledger does not pair its transfers, this finds nothing and the synthesis still runs, which
   is the right fallback: better a modelled settlement than none.
   ================================================================================================== */
/* Does the reading already contain a stream that pays the card?
   `observedSettlement` looks for PAIRED transfers, which is exact and finds nothing in a ledger that
   does not pair them - and a ledger that does not pair them is precisely the one where the payment is
   an ordinary stream on the account. So the second test is behavioural: a stream sitting on the
   account being predicted, budgeted at nothing, and moving real money out of it, IS a settlement in
   everything but name. Synthesising a second one on top of it pays the card twice. */
export function settlementInReading(terminals, routing, observedMonthly, covers, declaredMonthly){
	let found = false;
	terminals.forEach(s => {
		if(found)return;
		if(!covers(routing[s.id]))return;
		if(Math.abs(declaredMonthly(s)) > 0.005)return;
		if(Math.abs(observedMonthly[s.id] || 0) > 50)found = true;
	});
	return found;
}

export function observedSettlement(transactions, coveredHashes, creditHashes){
	const acctOf = {};
	(transactions || []).forEach(t => {acctOf[t.transactionId] = t.userInstitutionAccountId});
	let total = 0, count = 0;
	(transactions || []).forEach(t => {
		if(coveredHashes.indexOf(t.userInstitutionAccountId) < 0)return;
		if(!t.pairedTransferTransactionId)return;
		if(creditHashes.indexOf(acctOf[t.pairedTransferTransactionId]) < 0)return;
		total += t.amount; count++;
	});
	return {total: total, count: count};
}

/* ==================================================================================================
   FINDING THE CARD SETTLEMENTS WHEN NOTHING LINKS THEM.

   The shape of the thing: purchases of $10, $20 and $30 land on the CARD accounts over a week, and
   then $60 leaves CHECKING when the cards settle - as two transactions, one per connected card, not
   as one lump and not carrying any reference to what they pay.

   `observedSettlement` looks for a stored pairedTransferTransactionId and finds nothing here, because
   nothing in the data says these belong together. So the association has to be INFERRED, and the only
   evidence available is the one every ledger has: an amount leaving one account and the same amount
   arriving on another, at about the same time.

   MATCHED ON AMOUNT AND DATE, ACROSS THE ACCOUNT BOUNDARY. A negative on an account being predicted
   is a settlement when a credit account received the same amount within a few days. Each side is
   consumed once, so two payments of the same size in one week match two receipts rather than one
   twice. The window is days rather than exact, because a transfer posts on its own schedule at each
   end.

   WHY THIS MATTERS RATHER THAN BEING TIDY: card purchases must not count against the spending account
   - they never touched it - while the settlement must, because it is the only moment card money
   actually leaves. Getting that pair of facts wrong in either direction is a whole month of error, and
   it is the difference between a forecast that under-spends by the entire card bill and one that
   spends it twice.

   Deliberately NOT matched by name, category or stream: those are conventions a user can change, and
   the amount arriving where the amount left is a fact about the money.
   ================================================================================================== */
export function inferSettlements(transactions, coveredHashes, creditHashes, opts){
	const o = opts || {};
	const windowDays = o.windowDays === undefined ? 4 : o.windowDays;
	const txns = transactions || [];
	//receipts on a credit account: money arriving to pay the card down
	const receipts = txns.filter(t => creditHashes.indexOf(t.userInstitutionAccountId) > -1
		&& t.amount > 0).map(t => ({t: t, used: false}));
	const out = [];
	txns.filter(t => coveredHashes.indexOf(t.userInstitutionAccountId) > -1 && t.amount < 0)
		.forEach(t => {
			const want = Math.abs(t.amount);
			let best = null, bestGap = Infinity;
			receipts.forEach(r => {
				if(r.used)return;
				if(Math.abs(Math.abs(r.t.amount) - want) > 0.005)return;
				const gap = Math.abs(new Date(r.t.date) - new Date(t.date))/86400000;
				if(gap > windowDays)return;
				if(gap < bestGap){bestGap = gap; best = r}
			});
			if(!best)return;
			best.used = true;
			out.push({date: t.date, amount: t.amount, accountHash: t.userInstitutionAccountId,
				card: best.t.userInstitutionAccountId, id: t.transactionId,
				streamIds: (t.streamAllocation || []).map(al => al.streamId)});
		});
	return out;
}

/* ==================================================================================================
   PREDICTING THE CARD BILL FROM THE SPENDING THAT WILL PRODUCE IT.

   A six-month mean predicts the AVERAGE card month, and no sample size makes it predict THIS one. But
   the bill is not a random draw at all - it is arithmetic on transactions we already hold. The chain,
   end to end:

     purchases post to a CARD account
       -> they accumulate over a statement cycle
         -> a settlement event arrives on that card (the receipt)
           -> the matching outflow leaves the CHECKING account (found by inferSettlements)

   So the next bill is: what has ALREADY POSTED on that card since its last settlement, plus whatever
   is still to be spent before the next one. The first half is known exactly - it is not a forecast at
   all - and only the remainder is estimated, at the card's own recent daily rate. Every day that
   passes converts more of the estimate into fact, which is why this gets better as the settlement
   approaches while a mean stays equally vague throughout.

   PER CARD, because two cards settle on their own cycles and averaging them describes neither. Each
   carries its own interval, its own rate and its own outstanding balance.

   THE PASS-THROUGH RATIO IS MEASURED, NOT ASSUMED. A card paid in full settles the whole cycle and the
   ratio is 1; a card carrying a balance settles less, and a minimum payment much less. Taking that
   from history rather than assuming full payment is what stops the model over-predicting an outflow
   for someone who revolves.
   ================================================================================================== */

const MED = xs => {const a = xs.slice().sort((x, y) => x - y), m = Math.floor(a.length/2);
	return a.length ? (a.length % 2 ? a[m] : (a[m-1] + a[m])/2) : 0};

export function cardCycles(transactions, creditHashes, settlements){
	const out = {};
	(creditHashes || []).forEach(c => {out[c] = {events: [], intervalDays: 0, ratio: 1, rate: 0}});
	(settlements || []).forEach(s => {if(out[s.card])out[s.card].events.push(s)});

	Object.keys(out).forEach(c => {
		const o = out[c];
		o.events.sort((a, b) => new Date(a.date) - new Date(b.date));
		const spent = (transactions || []).filter(t =>
			t.userInstitutionAccountId === c && t.amount < 0);

		//how long a cycle runs, and how much of the cycle's spending each settlement actually clears
		const gaps = [], ratios = [];
		for(let i = 1; i < o.events.length; i++){
			const a = new Date(o.events[i-1].date), b = new Date(o.events[i].date);
			gaps.push((b - a)/86400000);
			let cycleSpend = 0;
			spent.forEach(t => {const d = new Date(t.date); if(d > a && d <= b)cycleSpend += -t.amount});
			if(cycleSpend > 1)ratios.push(Math.abs(o.events[i].amount)/cycleSpend);
		}
		o.intervalDays = gaps.length ? MED(gaps) : 30.44;
		//clamped: a ratio far from 1 is usually a mis-matched settlement rather than a revolver, and
		//an unclamped one compounds every cycle
		o.ratio = ratios.length ? Math.min(1.5, Math.max(0.2, MED(ratios))) : 1;
	});
	return out;
}

/* The settlement events expected between `from` and `to`, per card, as {date, amount}. */
export function cardSettlementForecast(transactions, creditHashes, settlements, from, to, opts){
	const o = opts || {};
	const rateDays = o.rateDays === undefined ? 90 : o.rateDays;
	const cycles = cardCycles(transactions, creditHashes, settlements);
	const events = [];

	Object.keys(cycles).forEach(c => {
		const cy = cycles[c];
		const spent = (transactions || []).filter(t =>
			t.userInstitutionAccountId === c && t.amount < 0 && new Date(t.date) < from);
		//the card's own recent daily spend, which is what the unposted remainder is estimated at
		/* DIVIDED BY THE DAYS ACTUALLY OBSERVED, not by the size of the window asked for. A card with
		   two months of history divided by ninety days reports two thirds of its real spending rate,
		   and the bill comes out short for a reason that has nothing to do with the card. */
		const rateFrom = new Date(from.getTime() - rateDays*86400000);
		let recent = 0, earliest = null;
		spent.forEach(t => {
			const d = new Date(t.date);
			if(d < rateFrom)return;
			recent += -t.amount;
			if(!earliest || d < earliest)earliest = d;
		});
		const observedDays = earliest ? Math.max(1, (from - earliest)/86400000) : rateDays;
		const rate = recent/Math.min(rateDays, observedDays);

		const past = cy.events.filter(e => new Date(e.date) < from);
		const last = past.length ? new Date(past[past.length-1].date) : null;
		if(!last && !rate)return;

		//what is ALREADY on the card and not yet paid: known, not estimated
		let posted = 0;
		spent.forEach(t => {const d = new Date(t.date); if(!last || d > last)posted += -t.amount});

		let when = last ? new Date(last.getTime() + cy.intervalDays*86400000)
			: new Date(from.getTime() + cy.intervalDays*86400000);
		/* EACH SETTLEMENT CLEARS ONLY WHAT ACCRUED SINCE THE ONE BEFORE IT.
		   Measured from the window start instead, the second bill charged two weeks of spending, the
		   third charged three, and a month of weekly settlements came out at double the truth. Every
		   settlement resets the meter: `covered` is the moment the previous one cleared, and only the
		   days after it are projected onto the next. */
		let covered = from;
		let guard = 0;
		while(when <= to && guard++ < 64){
			if(when >= from){
				//what is already posted and unpaid, plus only the days since the previous settlement
				const ahead = Math.max(0, (when - covered)/86400000);
				const spend = posted + rate*ahead;
				if(spend > 1)events.push({date: new Date(when), card: c,
					amount: -spend*cy.ratio, posted: posted, projected: rate*ahead});
				posted = 0;                       //this settlement clears it
				covered = new Date(when);
			}
			when = new Date(when.getTime() + cy.intervalDays*86400000);
		}
	});
	events.sort((a, b) => a.date - b.date);
	return {events: events, cycles: cycles};
}

/* ==================================================================================================
   THE INPUTS A FORECAST RUNS ON - built once, for whoever is forecasting.

   The bench and the tile had each grown their own version of this, and they had drifted badly: the
   bench windowed its history, filtered to the account being predicted, and told the detector what
   period the stream declares, while the tile used every transaction ever recorded across every
   account with no declared period at all. The bench measured one model and the app shipped another,
   so every improvement scored here for six rounds was invisible where it mattered.

   It surfaced from an audit of a single day: a savings transfer the bench placed as one $4,000 step
   appeared in the app as $1,929 smeared across several days, because the app's histogram was built
   from years of both legs rather than months of one.

   THE THREE FILTERS EACH ANSWER A DIFFERENT QUESTION, and dropping any of them is a different fault:
     since/until  - WHEN was this stream itself. Older history is a different agreement, and anything
                    dated at or after `until` is the answer we are pretending not to know.
     covered      - WHICH account we are predicting. A transfer's two legs describe two accounts, and
                    learning from both describes neither.
     declared     - WHAT the user says the stream is, as the hypothesis the ledger must beat.

   Routing sees the UNFILTERED set on purpose: deciding which account a stream lives on is the one
   question a single account's ledger cannot answer.
   ================================================================================================== */
export function buildForecastInputs(opts){
	const terminals = opts.terminals || [], byStream = opts.byStream || {};
	const covered = opts.covered || [], since = opts.since, until = opts.until;
	const expectationAt = opts.expectationAt || ((s, d) => monthlyExpectationAt(s, d, "monthly"));
	const shapes = {}, sliced = {}, seen = {}, dir = {};
	terminals.forEach(s => {
		const all = byStream[s.id] || [];
		seen[s.id] = all.filter(x => (!until || x.date < until) && (!since || x.date >= since));
		sliced[s.id] = seen[s.id].filter(x => covered.indexOf(x.accountHash) > -1);
		shapes[s.id] = histogramOf(sliced[s.id],
			{prefer: s.getPreferredPeriod ? s.getPreferredPeriod() : "monthly"});
		const a = expectationAt(s, until || new Date());
		dir[s.id] = a < 0 ? -1 : (a > 0 ? 1 : 0);
	});
	return {shapes: shapes, sliced: sliced, seen: seen,
		routing: accountRoutingOf(seen, id => dir[id])};
}
