/* ==================================================================================================
   DOES THE LEDGER ACTUALLY KEEP THIS RHYTHM? - a cycle detector, read off the movements alone.

   §2 READS THE DECLARATION AND NEVER LOOKS AT A TRANSACTION, and for a declared weekly or monthly
   stream that is the right answer: the period is a statement of fact by the person receiving the
   money, and no inference beats being told. But 44 of the 87 terminal streams are YEARLY, and a
   yearly declaration is not a rhythm at all - it is a budget envelope, silent about when the money
   moves. For those the spec says the rhythm has to be INFERRED, and this file is that inference.

   IT IS VALIDATED ON THE STREAMS WHOSE PERIOD IS ALREADY KNOWN-GOOD before it is pointed at the
   yearly ones. A detector that cannot recover `monthly` on a stream the user declared monthly has
   no business guessing at a stream nobody declared anything useful about.

   THE SCORE IS ABSOLUTE AND IS NEVER NORMALISED - not per stream, not per row, not per anything.
   The bar the reader sees is the score itself, so a stream that fits nothing shows seven tall bars
   and reads, at a glance, as "nothing here fits" next to a stream whose monthly bar is on the floor.
   Rescaling each row to its own best would make those two streams look identical.

   EVERY TERM IS ALREADY BOUNDED TO [0,1], so the three are summed and divided by three. There is no
   weighting constant, no tuning knob and no threshold inside the score, because every number on the
   audit page has to be traceable by hand to the legs that produced it.

   THE BUCKETS COME FROM cycleBuckets(), THE PRODUCTION WALK. A detector that cut its own cycles with
   its own calendar arithmetic would be scoring its own lattice rather than the one §3 and §4 use.
   ================================================================================================== */

import {Period} from '../../Time';
import {cycleBuckets} from './shapeDetermination';
import {getMerchantKey, merchantKeysMatch} from '../../transactionMatching';

/* THE PERIODS A STREAM COULD PLAUSIBLY BE ON, in ascending length, which is also the order every bar
   chart on the audit page is drawn in. `daily` is not here: nothing in this portfolio is declared
   daily and a daily lattice over a decade is thousands of buckets of which nearly all are empty, so
   it would win nothing and cost the walk. `biyearly` is not here for the opposite reason - the
   capture holds at most a few years, which is not enough buckets to score it at all. */
export const CANDIDATE_PERIODS = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'bimonthly',
	'quarterly', 'yearly'];

const median = xs => {
	if(!xs || !xs.length)return null;
	const a = xs.slice().sort((x, y) => x - y), m = Math.floor(a.length / 2);
	return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

const clip01 = n => (n < 0 ? 0 : n > 1 ? 1 : n);

/* AN UNSCORABLE CANDIDATE IS REPORTED AS UNSCORABLE, NEVER AS A SCORE. One bucket cannot show a
   rhythm and one leg cannot show a phase, so a number computed from them would be a fabrication
   wearing the same clothes as a measurement. `misfit: null` is the mark, and the page draws it as an
   empty slot rather than as a bar. */
const unscorable = (period, buckets) => ({
	period: period,
	buckets: buckets,
	empties: 0,
	emptyRate: null,
	occupancySpread: null,
	phaseSpread: null,
	misfit: null
});

/* ---- HOW FAR OFF ONE CANDIDATE PERIOD IS ----------------------------------------------------------
   Three terms, each measuring a different way a period can be wrong, each in [0,1]:

   emptyRate       - the period is TOO SHORT. Fold a monthly stream onto a weekly lattice and three
                     weeks in four are empty. empties / buckets.

   occupancySpread - the period is UNEVEN. Mean absolute deviation of the per-bucket counts from
                     their median, divided by that median, clipped at 1. A median of 0 means more
                     than half the buckets are empty and the term is 1 outright.

   phaseSpread     - the period is TOO LONG, or is not a rhythm at all. Every leg's position INSIDE
                     its bucket is an angle on a circle; if the period is right, the legs pile up at
                     one angle and the mean resultant vector is long. 1 - R, so 0 is a perfect phase
                     lock and 1 is uniform scatter. This is the term that separates monthly from
                     quarterly: fold a monthly stream onto quarters and no bucket is empty and the
                     counts are even, but the three payments sit at three different phases.

   K CLUSTERS, VIA THE K-TH HARMONIC. A stream that pays on the 1st and the 15th of every month is
   MONTHLY with two lumps, and the first harmonic reads those two opposed angles as perfect scatter -
   R near 0 - which would punish the very shape §3 exists to describe. k is the median legs per
   non-empty bucket, and the resultant is taken on angles k*theta, which is the standard test for k
   evenly spaced clusters and introduces no parameter of its own: at k = 2 the two opposed phases map
   onto the same angle and lock.  */
export function fitScore(legs, period, anchor){
	const cycle = Period[period];
	const buckets = cycleBuckets(legs || [], cycle, anchor);

	/* THE LEGS THAT COUNT ARE THE BUCKETED ONES. cycleBuckets caps its walk, so a leg older than the
	   cap has no bucket, no phase and no place in the counts - scoring it would mean scoring a leg
	   the production walk never sees. */
	const counts = buckets.map(b => b.legs.length);
	const placed = counts.reduce((n, c) => n + c, 0);
	if(buckets.length < 2 || placed < 2)return unscorable(period, buckets.length);

	const empties = counts.filter(n => n === 0).length;
	const emptyRate = empties / buckets.length;

	const med = median(counts);
	const occupancySpread = !med ? 1
		: clip01(counts.reduce((s, c) => s + Math.abs(c - med), 0) / counts.length / med);

	//k: the number of lumps a cycle carries, so the harmonic that folds them onto one angle
	const occupied = counts.filter(n => n > 0);
	const k = Math.max(1, Math.round(median(occupied) || 1));

	let sx = 0, sy = 0;
	buckets.forEach(b => {
		const start = b.start.getTime(), span = b.end.getTime() - start;
		if(span <= 0)return;
		b.legs.forEach(l => {
			const phase = (new Date(l.date).getTime() - start) / span;
			const theta = 2 * Math.PI * k * phase;
			sx += Math.cos(theta);
			sy += Math.sin(theta);
		});
	});
	const R = clip01(Math.sqrt(sx * sx + sy * sy) / placed);
	const phaseSpread = 1 - R;

	return {
		period: period,
		buckets: buckets.length,
		empties: empties,
		emptyRate: emptyRate,
		occupancySpread: occupancySpread,
		phaseSpread: phaseSpread,
		misfit: (emptyRate + occupancySpread + phaseSpread) / 3
	};
}

/* ONE ROW PER CANDIDATE, ALWAYS ALL SEVEN AND ALWAYS IN THE SAME ORDER, because the audit page draws
   the table as a bar chart and a row that dropped its unscorable candidates would silently shift
   every bar after it under the wrong axis label. */
export function fitTable(legs, anchor){
	return CANDIDATE_PERIODS.map(p => fitScore(legs, p, anchor));
}

/* HOW MUCH WORSE A SHORTER PERIOD MAY SCORE AND STILL WIN. Measured, not chosen: over the 25 streams
   whose declaration is known-good, agreement with the declaration runs 8/25 at zero tolerance, 12/25
   here, and 14/25 at 0.10 - but past this point the extra agreements come from streams that have no
   cycle at all, so the number is set where the honest wins stop. */
export const ALIAS_TOLERANCE = 0.05;

/* THE SHORTEST PERIOD THAT FITS, NOT THE BEST-SCORING ONE - and the difference is the whole
   correctness of this function.

   AN INTEGER MULTIPLE OF THE TRUE PERIOD SCORES THE SAME BY CONSTRUCTION. The phase term reads the
   k-th harmonic, where k is the median legs per bucket, so a quarter holding three evenly spaced
   monthly rents is exactly the shape the 3rd harmonic rewards. Real numbers: Rent scores 0.020
   monthly and 0.018 quarterly. Taking the minimum answered "quarterly" for a rent paid on the 2nd of
   every month, and did the same to Phone, Laundry, Books, Date and Sorties - every failure was the
   true period times n.

   So the minimum only sets the bar. The answer is the SHORTEST candidate that clears it, which is the
   rule that was asked for in the first place: the smallest period where the pattern matches itself.
   A table with nothing scorable in it has no best fit and says so. */
export function bestFit(table, tolerance){
	const tol = tolerance === undefined ? ALIAS_TOLERANCE : tolerance;
	const scorable = (table || []).filter(f => f && f.misfit !== null && f.misfit !== undefined);
	if(!scorable.length)return null;
	const floor = scorable.reduce((m, f) => Math.min(m, f.misfit), Infinity);
	//CANDIDATE_PERIODS is ascending, and `table` is built in that order, so the first match is shortest
	const pick = scorable.find(f => f.misfit <= floor + tol);
	return pick ? {period: pick.period, misfit: pick.misfit} : null;
}

/* THE FEWEST TRANSACTIONS THAT CAN SHOW A REPEAT. Three points give two intervals, which is a
   coincidence rather than a rhythm: Investments has exactly three - 2025-09-15, 2025-10-02 and
   2025-10-15, the middle one a +3000 credit among two -7000 debits - and the gaps of 17 and 13 days
   average out to a perfectly convincing biweekly that is not there. Four points give three intervals,
   the fewest that can disagree with each other.

   MEASURED, AND THE DATA IS INDIFFERENT BETWEEN 4 AND 10. Over the 25 known-good declarations the
   gate claims 11 and gets 10 right at every value in that range, against 14 claims and 12 right with
   no gate at all - so it trades two lucky answers for one wrong one, and the number is set at the low
   end because nothing in the evidence argues for more. */
export const MIN_LEGS_FOR_FIT = 4;

/* THE ONE ENTRY POINT A CALLER SHOULD USE, and the only place the evidence gate lives. fitTable and
   bestFit stay pure - they score and rank whatever they are handed - so the page can still draw the
   bars for a stream too small to claim, which is the difference between showing the reader nothing
   and showing them why there is no answer. */
/* THE EVIDENCE IS THIS REPORTING YEAR, NOT ALL OF HISTORY. The anchor is the start of the current
   observation period, and a stream's arrangement is a thing its owner changes between years: what it
   did under last year's plan is not evidence about this year's rhythm, it is evidence about a rhythm
   that has been retired.

   A STREAM WITH NOTHING SINCE THE ANCHOR HAS NO DATA, and that is a different answer from "no cycle
   found". Investments last moved 2025-10-15 against an anchor of 2025-12-21 - the owner kept the
   stream because he may use it again and chose a different strategy this year. Scored across all of
   history its three old legs average out to a convincing biweekly that describes nothing anyone
   intends to repeat. Dormant is the honest word and the page prints it. */
export function legsInWindow(legs, anchor){
	if(!anchor)return legs || [];
	const t = new Date(anchor).getTime();
	return (legs || []).filter(l => l && l.date && new Date(l.date).getTime() >= t);
}

export function detectCycle(legs, anchor, tolerance){
	const all = legs || [];
	const list = legsInWindow(all, anchor);
	if(!list.length)
		return {period: null, misfit: null, windowLegs: 0,
			reason: all.length ? 'dormant — nothing since the reporting year began' : 'no transactions'};
	if(list.length < MIN_LEGS_FOR_FIT)
		return {period: null, misfit: null, windowLegs: list.length,
			reason: 'only ' + list.length + ' transaction' + (list.length === 1 ? '' : 's')
				+ ' this reporting year'};
	const best = bestFit(fitTable(list, anchor), tolerance);
	return best ? {period: best.period, misfit: best.misfit, windowLegs: list.length, reason: null}
		: {period: null, misfit: null, windowLegs: list.length, reason: 'nothing scorable'};
}

/* ---- WHO THE MONEY WENT TO ------------------------------------------------------------------------
   ONE STREAM IS OFTEN SEVERAL RHYTHMS BRAIDED TOGETHER. "Utilities" is a gas bill and an electricity
   bill, each arriving once a month a few days apart; merged, the month carries two events and a
   semimonthly lattice can look tempting. Split by merchant, each side is one clean event per month.

   THE GROUPING IS transactionMatching's, NOT A NEW ONE. getMerchantKey and merchantKeysMatch already
   decide whether two descriptions name the same merchant for refund matching, and a second rule here
   would drift from that one the first time either was touched.

   GREEDY, SINGLE PASS, FIRST MATCH WINS. A leg whose key is shorter than the matcher's minimum can
   match nothing - not even an identical key - so it becomes its own group, which is the correct
   answer rather than a degenerate one: a description too short to identify a merchant is evidence of
   nothing and must not swallow the others. */
/* A CHEQUE NUMBER IS THE ONE NUMBER THAT IS NOT AN IDENTITY. getMerchantKey drops tokens that MIX
   letters and digits, on the reasoning that those are reference codes, but a token of pure digits
   survives - and a cheque description is exactly that: "Check paid 1035", "Check paid 1039". Day care
   Emile grouped into nine merchants where there is one payee and a chequebook, and its split could
   say nothing.

   NARROW ON PURPOSE: the digits go only when the description says cheque. Everywhere else a trailing
   number can be the identity - a store number, an order - and stripping them all would merge accounts
   and merchants that are genuinely different. getMerchantKey itself is untouched, because refund
   matching uses it to decide whether two real transactions are the same purchase. */
const CHEQUE = /che(?:ck|que)s?/i;

const groupingKey = description => {
	const d = String(description || '');
	return getMerchantKey(CHEQUE.test(d) ? d.replace(/[0-9]+/g, ' ') : d);
};

export function merchantGroups(legs){
	const groups = [];
	(legs || []).forEach(leg => {
		const key = groupingKey(leg && leg.description);
		const hit = groups.find(g => merchantKeysMatch(g.key, key));
		if(hit)hit.legs.push(leg);
		else groups.push({key: key, legs: [leg]});
	});
	//biggest group first; the key breaks ties so two runs of the same ledger print the same order
	return groups.sort((a, b) => b.legs.length - a.legs.length
		|| (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/* THE SPLIT TABLE: each merchant scored on its own lattice, then combined as a LEG-COUNT-WEIGHTED
   MEAN over the groups that were scorable at all.

   RATIONALE. A stream whose two merchants are each cleanly monthly should read as monthly, even
   though the merged series carries two events per cycle and would score well on semimonthly too.
   Scoring the merchants separately asks the question that is actually being asked - "is each thing
   that happens here monthly?" - and the leg-count weight keeps a two-leg stray from outvoting a
   forty-leg rhythm. Unscorable groups are skipped rather than counted as bad: a merchant with one
   transaction says nothing about the period, and saying nothing is not the same as fitting badly.

   Every term is combined the same way, so the combined misfit stays exactly the mean of the combined
   terms and the arithmetic on the page still adds up by hand. */
export function fitTableSplit(legs, anchor){
	const groups = merchantGroups(legs).map(g => ({
		key: g.key,
		legCount: g.legs.length,
		table: fitTable(g.legs, anchor)
	}));

	const table = CANDIDATE_PERIODS.map((period, i) => {
		let weight = 0, empty = 0, occ = 0, phase = 0, buckets = 0, empties = 0;
		groups.forEach(g => {
			const f = g.table[i];
			if(!f || f.misfit === null)return;
			weight += g.legCount;
			empty += f.emptyRate * g.legCount;
			occ += f.occupancySpread * g.legCount;
			phase += f.phaseSpread * g.legCount;
			buckets += f.buckets;
			empties += f.empties;
		});
		if(!weight)return unscorable(period, buckets);
		const emptyRate = empty / weight, occupancySpread = occ / weight, phaseSpread = phase / weight;
		return {
			period: period,
			buckets: buckets,
			empties: empties,
			emptyRate: emptyRate,
			occupancySpread: occupancySpread,
			phaseSpread: phaseSpread,
			misfit: (emptyRate + occupancySpread + phaseSpread) / 3
		};
	});

	return {groups: groups, table: table};
}

export default fitTable;
