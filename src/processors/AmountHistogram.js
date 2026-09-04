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
