/* ==================================================================================================
   WHEN IN A PERIOD THE MONEY MOVES - the one definition, used by both charts.

   Two callers needed this and each had written it out:
     - ReportingCore.getFrequencyHistogramAtDate, to DRAW a stream's rhythm
     - BankBalance, to FORECAST a stream's month day by day
   They agree completely on what a histogram is - amount-weighted bins over a period - and they
   disagree on exactly one thing, which is what to divide by. That disagreement is the whole reason
   they looked like different functions, so it is what this module makes explicit rather than what it
   papers over.

   THE TWO NORMALISATIONS ARE NOT INTERCHANGEABLE, and using the wrong one is a real fault:

     asShape   divides by the MAXIMUM. The tallest bin is 1 and the rest are relative to it. Right for
               drawing, because it fills the available height whatever the amounts are.
     asWeights divides by the SUM. The bins add to 1, so they are the fractions of one period's money.
               Right for forecasting, and the ONLY thing that is: a shape used as weights multiplies
               the period's total by however many bins are non-trivial, which forecast every stream
               several times over and put a nine-month ending balance at $324k.

   WHAT IS NOT HERE, deliberately: where a bin index comes from. ReportingCore derives it from the
   period machinery and rotates the result so the calendar start lands back at zero; the balance view
   bins by day-of-month across a fixed 31. Those are genuinely different questions about the calendar
   and forcing one to answer the other's would be a worse duplication than the one being removed.
   The caller supplies `binOf`, and this module owns only what a histogram IS.

   THIS FILE IMPORTS NOTHING, so that BankBalance can use it and stay drivable from a bench with no
   browser and no logged-in user.
   ================================================================================================== */

/* Accumulate |amount| into bins. `binOf` returns an index for an item, `amountOf` its magnitude
   contribution - a caller that splits an amount across streams passes its own accessor. An index
   outside the array is dropped rather than silently folded into an edge bin, because a transaction
   landing outside its own period is a fact about the calendar, not weight to be redistributed. */
export function accumulate(items, binOf, amountOf, nBins){
	const bins = new Array(nBins).fill(0);
	items.forEach(it => {
		const i = binOf(it);
		if(!(i >= 0 && i < nBins))return;
		bins[i] += Math.abs(amountOf(it));
	});
	return bins;
}

/* ÷ max - for DRAWING. The tallest bin is 1. */
export function asShape(bins){
	const max = Math.max.apply(null, bins) || 1;
	return bins.map(b => b/max);
}

/* ÷ sum - for FORECASTING. The bins add to 1 over a whole period.

   `any` is computed from the RAW total, before the divide-by-zero default. Asking "sum > 0" after a
   "|| 1" makes "do I have any data" always true, so a stream with no history gets an all-zero shape
   and is forecast as nothing at all - and the caller's flat fallback becomes unreachable. Same shape
   of fault as an option that fails open: the default is indistinguishable from a real value.

   `massIn(n)` is how much of the shape falls inside the first n bins. Bins run to the longest period
   and most are shorter - in a 30-day month, day 31's weight is never applied and the month forecasts
   light; February loses three days of it. Renormalising by the mass that actually lands inside makes
   a whole period worth a whole period whatever its length. */
export function asWeights(bins){
	const raw = bins.reduce((a,b) => a+b, 0);
	const weights = bins.map(b => b/(raw || 1));
	const massIn = n => {let t = 0; for(let i = 0; i < n && i < bins.length; i++){t += weights[i]}
		return t || 1};
	return {weights: weights, massIn: massIn, any: raw > 0};
}

/* ---- A DRIFTING EVENT IS STILL ONE EVENT ----------------------------------------------------------
   A paycheck lands on the 15th, except when the 15th is a Sunday, and except in February when "the
   30th" is the 2nd of March. Binned by day, one event becomes four small ones - and the forecast then
   draws four small steps where the reader is looking for one big one. Measured on a fixture with only
   weekend drift, the biggest forecast bump came to 67% of the real paycheck; with month-end drift as
   well it goes lower. No money is lost - the month's total stays exactly right - but the STEP is what
   a balance chart is read for, and the step is what got smeared away.

   So near-adjacent bins are collapsed onto the heaviest day of their run. Two things make this safe:

   THE GUARD. A run is only collapsed if it SPANS a few days. Groceries fill the whole month, so their
   run spans 31 and is left exactly as it is - the spreading there is a true measurement, not drift.
   The rule is therefore not "is this stream programmed" (a judgement) but "is this run narrow enough
   to be one event that moved" (a measurement).

   THE MONTH IS A CYCLE. Day 31 is adjacent to day 1: a payday sliding off the end of a short month
   lands at the start of the next one, and treating the bins as a line would leave those two halves as
   distant strangers. The runs therefore wrap.

   Mass is preserved exactly - weights still sum to 1 afterwards, which is what the forecast depends
   on. Only WHERE it sits changes. */
export function consolidate(bins, maxSpan, gap){
	const n = bins.length;
	maxSpan = maxSpan === undefined ? 5 : maxSpan;
	gap = gap === undefined ? 2 : gap;
	const total = bins.reduce((a, b) => a + b, 0);
	if(!total)return bins.slice();
	//a day carrying almost nothing must not bridge two real runs into one wide one
	const floor = total * 0.01;
	const live = bins.map(b => b > floor);
	if(live.every(Boolean) || live.every(x => !x))return bins.slice();

	//start from a bin that begins a run, so the wrap is walked once and only once
	let start = -1;
	for(let i = 0; i < n; i++){
		if(live[i] && !live[(i - 1 + n) % n]){start = i; break}
	}
	if(start < 0)return bins.slice();

	const out = new Array(n).fill(0);
	let i = 0;
	while(i < n){
		const at = (start + i) % n;
		if(!live[at]){out[at] += bins[at]; i++; continue}
		//walk the run, allowing gaps of `gap` quiet days inside it
		const members = [];
		let j = i, quiet = 0;
		while(j < n){
			const k = (start + j) % n;
			if(live[k]){members.push(k); quiet = 0}
			else{
				quiet++;
				if(quiet > gap)break;
			}
			j++;
		}
		const span = members.length ? (members[members.length - 1] - members[0] + n) % n + 1 : 0;
		if(members.length > 1 && span <= maxSpan){
			let peak = members[0];
			members.forEach(k => {if(bins[k] > bins[peak])peak = k});
			let mass = 0;
			for(let q = i; q < j; q++){mass += bins[(start + q) % n]}
			out[peak] += mass;
		}else{
			for(let q = i; q < j; q++){const k = (start + q) % n; out[k] += bins[k]}
		}
		i = j;
	}
	return out;
}
