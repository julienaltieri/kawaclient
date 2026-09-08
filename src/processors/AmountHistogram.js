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

/* ==================================================================================================
   WHICH CYCLE IS THIS STREAM ON?

   Everything above assumed a MONTH. That assumption is invisible when it holds and destroys the
   picture when it does not: a weekly payment lands on roughly thirty different days-of-month over a
   year, so binned by day-of-month it looks perfectly diffuse, and the forecast dutifully spreads a
   large recurring expense into a flat drizzle. It then has no step, earns no badge, and disappears
   from a chart that is read for its steps - which is how a day-care bill the size of rent can be
   invisible while every total that mentions it is correct.

   NOT A FOURIER TRANSFORM, and the reason is the domain rather than the maths. Money is calendar
   driven, not sinusoidal: "the first of the month" and "every other Friday" are not frequencies, and
   months are not equal in length, so a fixed-frequency basis smears exactly the events that are most
   regular. The candidate set here is small, known, and made of real calendars, so the honest method is
   to try each one and measure which fits - a periodogram over the periods money actually uses.

   THE STATISTIC HAS TO BE COMPARABLE ACROSS BIN COUNTS, which is the part that is easy to get wrong.
   Raw concentration rises with the number of bins for free: two transactions scattered over 31 bins
   look more "concentrated" than two over 7, purely because there is more room to be apart in. So each
   candidate is scored against what randomness would have produced for the SAME number of
   observations, and a candidate only wins by beating its own null.
   ================================================================================================== */

const DAYMS = 86400000;
const utcDay = d => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())/DAYMS);
const lastOfMonth = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).getUTCDate();

export const CYCLES = {
	/* biweekly needs a fixed origin or its phase means nothing between one call and the next; the
	   epoch is as good as any, because only the RELATIVE phase of the transactions matters. */
	weekly:   {name:"weekly",   bins:7,  span:7,
		phaseOf: d => ((utcDay(d) % 7) + 7) % 7,    daysPerCycle: () => 7, reach: () => 7},
	biweekly: {name:"biweekly", bins:14, span:14,
		phaseOf: d => ((utcDay(d) % 14) + 14) % 14, daysPerCycle: () => 14, reach: () => 14},

	/* SEMIMONTHLY IS A CANDIDATE OF ITS OWN, and leaving it out was a mistake worth recording. The
	   note that used to sit here said monthly already covered it - "a twice-a-month stream is two
	   spikes in a month of bins, which is a true description". That is true for FORECASTING, where two
	   spikes place the money correctly, and false for everything else: the fit score sees a
	   distribution split across two peaks and reads it as half-concentrated, so a payroll that never
	   misses scored 0.46 and was called erratic; and a point prediction can only name ONE day, so the
	   most reliable stream in the portfolio reported 46% confidence in a date. The reader who says
	   "I can see two clear peaks and semimonthly fits better" is doing something the detector was
	   never allowed to do.

	   The phase is the position within the HALF month: days 1-15 map to 0-14, days 16-end map to
	   0-15. A stream paid on the 15th and the 30th lands on phase 14 both times and scores a perfect
	   fit, which is exactly what it deserves. Sixteen bins, because a 31-day month has a 16-day second
	   half. */
	semimonthly: {name:"semimonthly", bins:16, span:15.22,
		phaseOf: d => {const day = d.getUTCDate(); return day <= 15 ? day-1 : day-16},
		daysPerCycle: d => lastOfMonth(d)/2,
		reach: d => lastOfMonth(d) >= 31 ? 16 : 15,
		/* MONEY AIMED AT A DAY THE MONTH DOES NOT HAVE ARRIVES ON THE LAST DAY IT DOES.
		   Payroll on the 15th and the 30th has no 30th in February, and it is not skipped that month -
		   it is paid on the 28th. Without this the second paycheck simply evaporated and February
		   forecast $8,098 of a $15,674 month, which is a money-losing bug rather than a rounding one.
		   Each phase carries half the month (two turns), except phase 15, which the first half of a
		   month is too short to contain and which therefore fires once. */
		dayShare: (w, day, nDays) => {
			let share = 0;
			if(day <= 15)share += (w[day-1] || 0)/2;
			else share += (w[day-16] || 0)/2;
			if(day === nDays){
				for(let p = 0; p <= 14; p++){if(p + 16 > nDays)share += (w[p] || 0)/2}
				if(16 > nDays || nDays < 31)share += (w[15] || 0);
			}
			return share;
		}},

	monthly:  {name:"monthly",  bins:31, span:30.44,
		phaseOf: d => d.getUTCDate()-1,             daysPerCycle: d => lastOfMonth(d),
		reach: d => lastOfMonth(d),
		//same rule: a payment budgeted for the 31st happens on the 30th in a thirty-day month
		dayShare: (w, day, nDays) => {
			let share = w[day-1] || 0;
			if(day === nDays){for(let p = nDays; p < w.length; p++)share += (w[p] || 0)}
			return share;
		}}
};

/* How concentrated a set of bins is, corrected for the free concentration that more bins and fewer
   observations both hand out. 0 means "no better than scatter", 1 means "all on one bin". */
export function concentration(bins, observations){
	const n = bins.length, k = observations;
	const total = bins.reduce((a, b) => a + b, 0);
	if(!total || !k)return 0;
	const H = bins.reduce((a, b) => a + (b/total)*(b/total), 0);   //Herfindahl: sum of squared shares
	const expected = 1/k + (1 - 1/k)/n;                            //what scatter alone would give
	if(expected >= 1)return 0;
	return Math.max(0, (H - expected)/(1 - expected));
}

/* Pick the cycle that best explains WHEN this stream's money moves.

   MONTHLY IS THE DEFAULT AND HAS TO BE BEATEN, not merely tied. It is the app's own reporting cadence
   and the safest thing to be wrong about, so an alternative must clear it by a real margin before the
   forecast changes shape underneath the reader.

   TWO OBSERVATIONS ARE ENOUGH IF THEY AGREE, and a minimum sample size was the wrong instrument. The
   evidence here is not "how much data is there" but "do the phases MATCH a cycle we already know
   about": two payments a month apart landing on the same day-of-month is a one-in-thirty-one
   coincidence, which is stronger evidence than six scattered ones. Demanding six transactions rejected
   a clean monthly signal from a stream that had only just started - a day-care bill enrolled in
   September has two payments by November and is not therefore mysterious.

   CONFIDENCE THEN SCALES WITH THE COUNT, which is what the sample size was clumsily standing in for.
   Perfect agreement of k observations across n bins happens by chance with probability n^(1-k):
   two payments agreeing on a weekday is 1-in-7 and means little, three is 1-in-49 and means something,
   and the same three agreeing on a day-of-month is 1-in-961. So the bar is that chance figure, applied
   per candidate - which automatically asks for more evidence exactly where a cycle is easier to match
   by accident.

   A candidate must also have been OBSERVED for at least one full turn. Two payments three days apart
   say nothing about a fortnight - not because the sample is small, but because the question was never
   put to them. */
/* ONE EVENT DOES NOT SPREAD.

   A histogram is a description of WHEN money moved, and normalising it to weights silently turns it
   into a claim about HOW MUCH moves each day. For a stream that genuinely trickles - groceries, forty
   card transactions a month - those are the same statement. For one that arrives as a single payment
   whose date wanders, they are not: the weights say "a bit on each of these days" when the truth is
   "all of it, on one of them".

   Spreading an event is not a neutral hedge either. This chart exists to find the trough, and a
   smeared payment has no trough - a $4,000 transfer drawn as $130 a day for a month erases exactly
   the dip the reader is looking for, and the error is in the dangerous direction.

   So a stream known to arrive in `events` lumps per turn keeps only its `events` strongest clusters,
   renormalised. The count comes from evidence, never from the stream's declared period - a period is
   a budgeting choice and says nothing about whether the money leaves in one go. */
export function concentrateTo(weights, events){
	const n = Math.max(1, Math.round(events || 1));
	if(!weights || n >= weights.length)return weights;
	const live = weights.map((w, i) => ({i: i, w: w})).filter(o => o.w > 0.0001);
	if(live.length <= n)return weights;
	live.sort((a, b) => b.w - a.w);
	const keep = live.slice(0, n);
	const total = keep.reduce((a, b) => a + b.w, 0);
	if(!total)return weights;
	const out = weights.map(() => 0);
	keep.forEach(o => {out[o.i] = o.w/total});
	return out;
}

export function detectCycle(items, dateOf, amountOf, opts){
	const o = (typeof opts === "number") ? {minObservations: opts} : (opts || {});
	const min = o.minObservations === undefined ? 2 : o.minObservations;
	if(!items || items.length < min)return CYCLES.monthly;
	const days = items.map(it => utcDay(dateOf(it)));
	const span = Math.max.apply(null, days) - Math.min.apply(null, days);
	const k = items.length;
	/* LONGEST FIRST, AND A SHORTER CYCLE MUST EARN THE SWAP.

	   A shorter cycle is trivially satisfied by a longer one: money that moves every OTHER Friday
	   lands on a Friday every time, so "weekly" fits it perfectly and scores exactly as well as
	   "biweekly" does. Scored on a tie the shorter one wins by accident, and the forecast then draws
	   four half-sized payments where two full ones belong - the same disappearing-step fault this
	   whole detector exists to remove, arrived at from the other direction.

	   The reverse is not symmetric, which is what makes the ordering sound: a genuinely weekly stream
	   binned into a fortnight spreads across BOTH Fridays and scores about half. So a shorter cycle
	   only wins when it beats the longer one by a real margin, and the answer stays the most
	   conservative description the data actually supports. */
	//one full turn has to have been watched, or a candidate is untested rather than rejected
	const fits = c => span >= c.span*0.9;
	const scoreOf = c => concentration(
		accumulate(items, it => c.phaseOf(dateOf(it)), amountOf, c.bins), k);

	/* MONTHLY IS THE DEFAULT AND NEEDS NO EVIDENCE; everything else must earn the swap from it.
	   Treating them all as equal candidates and taking the first that had been observed for a turn
	   put a stream with a single week of history straight onto "weekly" - the only candidate a week
	   can possibly have watched a full turn of - without it ever facing the confidence test. A short
	   history must fall back, not commit. */
	/* THE STREAM'S OWN DECLARED PERIOD IS THE BASELINE, and anything else must beat it.
	   Monthly used to be the default for every stream, which threw away the one piece of information
	   the user has already given us. A stream declared semimonthly is a statement of intent; the
	   detector's job is to check it against the ledger, not to start from scratch. Where the
	   declaration names a period with no candidate of its own - yearly, bimonthly - monthly stands in,
	   since it is the longest thing that can be measured over a short window. */
	const base = CYCLES[o.prefer] || CYCLES.monthly;
	let best = {cycle: base, score: fits(base) ? scoreOf(base) : 0};
	//longest first, so a shorter cycle must beat the longer one it is contained in
	[CYCLES.monthly, CYCLES.semimonthly, CYCLES.biweekly, CYCLES.weekly]
		.filter(c => c !== base).forEach(c => {
		if(!fits(c))return;
		//how often scatter alone would agree this well, on THIS many bins with THIS many observations
		const byChance = Math.pow(c.bins, 1 - k);
		if(byChance > 0.05)return;
		/* A CYCLE IS A CLAIM ABOUT HOW OFTEN, and only the timing was ever tested.

		   "Weekly" over three months asserts about thirteen movements. A daycare bill that moved three
		   times cannot be weekly whatever weekday it favours - but scored on concentration alone it
		   can win, because three payments that happen to share a weekday concentrate perfectly in
		   seven bins while the same three drifting across days 10, 10 and 12 do not concentrate in
		   thirty-one. The forecast then drew a $1,800 monthly bill as four weekly steps of $406.

		   So a candidate must also predict roughly the number of movements observed. Half the turns is
		   the floor rather than one per turn, because a stream can skip one - a holiday month, a
		   payment that landed a day outside the window - and a skipped turn is not evidence of a
		   different rhythm. Swept over every genuinely-monthly pattern drifting up to four days either
		   side: 28 misdetections before, none after, and no cost to genuinely weekly, biweekly or
		   semimonthly streams. */
		if(k < 0.5*(span/c.span))return;
		const score = scoreOf(c);
		if(score > best.score + 0.15 && score > 0.3)best = {cycle: c, score: score};
	});
	return best.cycle;
}

/* WHICH TURN of its cycle a date falls in - so per-occurrence amounts can be compared with each
   other. Months are counted absolutely rather than by index, or December and January collide. */
export function occurrenceOf(cycle, d){
	if(cycle.name === "monthly")return d.getUTCFullYear()*12 + d.getUTCMonth();
	//a half-month is a turn of its own: the two paydays in a month are two occurrences, not one
	if(cycle.name === "semimonthly"){
		return (d.getUTCFullYear()*12 + d.getUTCMonth())*2 + (d.getUTCDate() <= 15 ? 0 : 1);
	}
	return Math.floor(utcDay(d)/cycle.span);
}

/* The DATE a turn falls on, so a caller can ask what the stream expected at the time. Inverse of
   occurrenceOf; the day within the turn is arbitrary and only the turn matters. */
export function dateOfOccurrence(cycle, n){
	if(cycle.name === "monthly")return new Date(Date.UTC(Math.floor(n/12), n % 12, 15));
	if(cycle.name === "semimonthly"){
		const half = ((n % 2) + 2) % 2, m = (n - half)/2;
		return new Date(Date.UTC(Math.floor(m/12), m % 12, half ? 23 : 8));
	}
	return new Date(n * cycle.span * 86400000);
}
