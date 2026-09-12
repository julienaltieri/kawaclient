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
import {FIT_CONFIG} from './fitConfig';

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
/* ---- THE TRIM --------------------------------------------------------------------------------------
   DROP THE FEW BUCKETS THAT DEVIATE MOST FROM THE MEDIAN AND SCORE WHAT IS LEFT, phase included. A
   stream that kept its rhythm except for one doubled month then reads as the rhythm it kept: Earnin
   Internet scores monthly 60.2% untrimmed, 71.6% at one and 81.6% at two.

   IT CANNOT MANUFACTURE A FIT, because it only ever drops a bucket that actually deviates. A
   candidate whose counts are already flat has nothing to drop and scores identically at every trim -
   Earnin bimonthly is 79.6% at all three. Fewer than two survivors is UNSCORABLE, never a number
   computed from one bucket.

   HOW MANY IS FIT_CONFIG.trimBuckets, and it is part of the definition of the score rather than a
   gate on it, which is why it is the one number the audit page does not move. */
//one bucket at a time, the median re-read after each drop so the second drop answers the first
export const trimBuckets = (buckets, n) => {
	let live = buckets;
	for(let i = 0; i < n; i++){
		const med = median(live.map(b => b.legs.length));
		let idx = -1, worst = 0;
		live.forEach((b, j) => {
			//strictly greater: a deviation of 0 is never dropped, and the earliest of equals goes first
			const d = Math.abs(b.legs.length - med);
			if(d > worst){ worst = d; idx = j; }
		});
		if(idx < 0)return live;
		live = live.slice(0, idx).concat(live.slice(idx + 1));
	}
	return live;
};

const scoreBuckets = (period, buckets) => {
	/* THE LEGS THAT COUNT ARE THE BUCKETED ONES. cycleBuckets caps its walk, so a leg older than the
	   cap has no bucket, no phase and no place in the counts - scoring it would mean scoring a leg
	   the production walk never sees. */
	const counts = buckets.map(b => b.legs.length);
	const placed = counts.reduce((n, c) => n + c, 0);
	if(buckets.length < 2 || placed < 2)return unscorable(period, buckets.length);

	const empties = counts.filter(n => n === 0).length;
	const emptyRate = empties / buckets.length;

	const med = median(counts);
	const devs = counts.map(c => Math.abs(c - med));
	const spread = devs.reduce((s, d) => s + d, 0) / devs.length;
	const occupancySpread = !med ? 1 : clip01(spread / med);

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
};

/* THE TRIM COUNT IS THE FOURTH ARGUMENT SO A TEST CAN SWEEP IT, and it defaults to the configured
   one so no caller has to know what it is. */
function fitScore(legs, period, anchor, trim){
	const n = trim === undefined ? FIT_CONFIG.trimBuckets : trim;
	const all = cycleBuckets(legs || [], Period[period], anchor);
	const live = n ? trimBuckets(all, n) : all;
	if(live.length < 2)return unscorable(period, all.length);
	return scoreBuckets(period, live);
}

/* ONE ROW PER CANDIDATE, ALWAYS ALL SEVEN AND ALWAYS IN THE SAME ORDER, because the audit page draws
   the table as a bar chart and a row that dropped its unscorable candidates would silently shift
   every bar after it under the wrong axis label. */
export function fitTable(legs, anchor, trim){
	return CANDIDATE_PERIODS.map(p => fitScore(legs, p, anchor, trim));
}

/* THE SHORTEST PERIOD THAT FITS, NOT THE BEST-SCORING ONE - and the difference is the whole
   correctness of this function.

   AN INTEGER MULTIPLE OF THE TRUE PERIOD SCORES THE SAME BY CONSTRUCTION. The phase term reads the
   k-th harmonic, where k is the median legs per bucket, so a quarter holding three evenly spaced
   monthly rents is exactly the shape the 3rd harmonic rewards. Real numbers: Rent scores 0.020
   monthly and 0.018 quarterly. Taking the minimum answered "quarterly" for a rent paid on the 2nd of
   every month, and did the same to Phone, Laundry, Books, Date and Sorties - every failure was the
   true period times n.

   So the best score is not the answer and is not even consulted. The answer is the SHORTEST
   candidate that clears FIT_CONFIG.fitThreshold, which is the rule that was asked for in the first
   place: the smallest period where the pattern matches itself. Nothing over the bar is no answer,
   and says so. */
export function bestFit(table, threshold){
	const bar = threshold === undefined ? FIT_CONFIG.fitThreshold : threshold;
	//CANDIDATE_PERIODS is ascending and `table` is built in that order, so the first hit is shortest
	const pick = (table || []).find(f =>
		f && f.misfit !== null && f.misfit !== undefined && 1 - f.misfit > bar);
	return pick ? {period: pick.period, misfit: pick.misfit} : null;
}

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
/* THE DIGITS COME OUT ONLY WHERE THEY ARE A SERIAL, and which descriptions those are is
   FIT_CONFIG.digitsAreSerialWhen - a list, because every bank writes cheques differently and more
   will turn up. Everywhere else a trailing number can be the identity: a store number, an order. */
const groupingKey = description => {
	const d = String(description || '');
	const serial = FIT_CONFIG.digitsAreSerialWhen.some(re => re.test(d));
	return getMerchantKey(serial ? d.replace(/[0-9]+/g, ' ') : d);
};

/* ---- HOW LONG THE PATTERN HAS BEEN QUIET -----------------------------------------------------------
   COMPLETE CYCLES OF `period` BETWEEN THE LAST TRANSACTION AND `now`, on the same lattice the score
   is computed on. cycleBuckets deliberately stops its walk at the newest leg - its own comment says
   dormancy is a real finding and not that function's to make - so this is the function that asks.

   A CYCLE ONLY COUNTS WHEN IT HAS FULLY ELAPSED. The period the capture date falls inside is still
   running and is not evidence of anything, so it is never counted: a stream whose last movement was
   three weeks ago has one complete empty monthly cycle only once a second month boundary has passed.

   NULL, NOT ZERO, WHEN THERE IS NOTHING TO MEASURE. No legs and no lattice means no last movement to
   count from, which is a different fact from "it moved recently". */
const MAX_QUIET_CYCLES = 400;

export function emptyCyclesSince(legs, period, anchor, now){
	const cycle = Period[period];
	if(!cycle)return null;
	const buckets = cycleBuckets(legs || [], cycle, anchor);
	if(!buckets.length)return null;
	const t = new Date(now).getTime();
	if(isNaN(t))return null;
	//the first lattice edge strictly after the newest leg; the bucket it opens is the first empty one
	let edge = new Date(buckets[buckets.length - 1].end);
	let n = 0, guard = 0;
	let next = cycle.nextDate(edge);
	while(next.getTime() <= t && ++guard < MAX_QUIET_CYCLES){
		n++;
		edge = next;
		next = cycle.nextDate(edge);
	}
	return n;
}

export function emptyCycleTable(legs, anchor, now){
	return CANDIDATE_PERIODS.map(p => emptyCyclesSince(legs, p, anchor, now));
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
export function fitTableSplit(legs, anchor, trim, minShare){
	const groups = merchantGroups(legs).map(g => ({
		key: g.key,
		legCount: g.legs.length,
		table: fitTable(g.legs, anchor, trim)
	}));
	/* THE DENOMINATOR IS EVERY LEG IN THE WINDOW, scorable or not, because the question this gate
	   asks is "how much of the stream is behind this number" and a skipped group is a leg the answer
	   did not account for. */
	const placed = groups.reduce((n, g) => n + g.legCount, 0);
	const share = minShare === undefined ? FIT_CONFIG.minSplitLegShare : minShare;

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
		/* TOO LITTLE OF THE STREAM SCORED TO CALL THIS A READING OF THE STREAM. The arithmetic below
		   would still produce a number, and that number would be one small group's score wearing the
		   whole stream's name - so it is withheld rather than reported. */
		if(placed && weight / placed < share)return unscorable(period, buckets);
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
