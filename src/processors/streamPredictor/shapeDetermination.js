/* ==================================================================================================
   WHAT SHAPE THE MONEY TAKES INSIDE ONE CYCLE - one lump, a handful of lumps, or a spread.

   THIS IS DETERMINED PER ACCOUNT ALLOCATION, NOT PER STREAM, because a stream split across two
   accounts can have a different shape on each side: a subscription paid on a card and its annual
   settlement drawn from checking are one stream and two shapes, and a single answer for the pair
   describes neither. So an allocation is the unit, and only that account's legs count toward it.

   THE CYCLE IS WALKED WITH THE PERIOD'S OWN ARITHMETIC, never a fixed millisecond span. Monthly,
   semimonthly and yearly are CALENDAR periods - `Period.timeInterval` is undefined for them and
   `previousDate` does the calendar step - so a 30.44-day approximation drifts a whole bucket over a
   couple of years and starts splitting one month's single payment across two "cycles".

   WHICH DAY OF THE CYCLE THE MONEY LANDS ON IS AN OPEN QUESTION and is deliberately NOT answered
   here. A mode, a mean day or a cluster centre computed now would be read downstream as a decision
   that had been made, and the wrong answer wearing the right shape is worse than an explicit gap.
   `pattern` therefore carries an unresolved marker, and `confidence` is null for the same reason -
   whether it is a number, a band or a label is still undecided. `evidence` carries the raw counts a
   confidence would one day be computed from, which is what makes the gap auditable rather than
   merely empty.
   ================================================================================================== */

import {SHAPE_CONFIG} from './shapeConfig';
import {SNAP, snapDate, isBusinessDay} from './businessCalendar';
import {AccountKind} from './accountMapping';
import {merchantGroups} from './cycleFit';

export const Shape = {lump: 'lump', spread: 'spread', multiLump: 'multiLump'};

const YEARLY = {yearly: true, biyearly: true};

/* A stream with a weekly cycle and a decade of history is ~520 buckets; the cap is far above any
   real history and exists so a malformed date cannot spin the walk forever. */
const MAX_CYCLES = 5000;

/* ---- THE CYCLE BUCKETS, phased on the ANCHOR and walked BACKWARDS over the legs -------------------
   THE LATTICE'S PHASE COMES FROM THE ANCHOR, ITS EXTENT FROM THE LEGS. The anchor is the analysis
   root date - the one seam the whole app already agrees on, chosen because almost nothing lands on
   it - so the seams are a property of the calendar rather than of the data. Anchoring on the stream's
   own newest leg, as this did, made every boundary data-derived: one new transaction on a different
   day of the month moved every seam, and with them the median events per cycle that picks the shape
   and the median cycle total that sets the amount. Observed on a semimonthly wage whose newest leg
   fell on the 28th: the seams landed on the 12th and the 28th, paydays straddled them, and four
   buckets came out empty.

   THE WALK IS DETERMINISTIC AND NEVER READS THE CLOCK. `nextDateFromNow` would make the same legs
   bucket differently tomorrow, which is a test that goes flaky and a prediction that drifts for no
   reason in the data. The lattice is stepped forward from the anchor to the first edge strictly past
   the newest leg, then back along the same lattice past the oldest one.

   Backwards for the second walk rather than forwards from the first leg, because the recent cycles
   are the ones every downstream reading is about; a forward walk puts the accumulated remainder at
   the end, exactly where it does the most damage. Buckets are [start, end) and contiguous, so every
   leg falls in exactly one.

   NO ANCHOR FALLS BACK TO THE OLD NEWEST-LEG BEHAVIOUR - the newest leg's instant plus a millisecond,
   so that leg sits inside the newest bucket rather than on its exclusive upper edge - so an outside
   caller cannot be broken by the new argument. Every call inside this module passes a real anchor.

   EXPORTED because amountPrediction buckets the same legs with the same period and the two stages
   must not be able to disagree about where a cycle begins. A near-copy would drift the moment either
   side was edited.  */
/* ---- HOW MUCH EACH CYCLE COUNTS ------------------------------------------------------------------
   A HABIT THAT CHANGED IS NOT A HABIT THAT IS UNRELIABLE, and weighing every cycle the same cannot
   tell the two apart. The weekly card payment ran on day 0 until the 2nd of March and has run on day
   4 every week since; evenly weighed that is two clusters and a claim on the wrong day.

   THE NEWEST CYCLES ARE FLAT, THEN A HALF-LIFE. The flat shoulder is the part that makes this safe: a
   rhythm needs a few cycles at full weight to be a rhythm at all, and a taper that starts at the
   newest cycle lets one movement outvote a year. After the shoulder the weight halves every half-life
   cycles - cycles, not days, so a weekly stream and a monthly one fade at the same rate against their
   own rhythm.

   WEIGHTS RIDE ON THE BUCKETS, which is why almost nothing else in this file had to change: the
   histogram adds a bucket's weight instead of 1, and everything downstream - the circular mean, the
   scatter, the cluster sizes, the share of cycles filled - already sums over those counts. With no
   taper configured every weight is exactly 1 and every number is what it was.

       cycle 0 back   1.00        shoulder 3, half-life 12
       cycle 3 back   1.00
       cycle 9 back   0.71
       cycle 15 back  0.50
       cycle 27 back  0.25 */
export function cycleWeights(n, taper){
	const t = taper || {};
	const half = t.halfLife === undefined ? SHAPE_CONFIG.taperHalfLifeCycles : t.halfLife;
	const shoulder = t.shoulder === undefined ? SHAPE_CONFIG.taperShoulderCycles : t.shoulder;
	const w = [];
	for(let i = 0; i < n; i++){
		const back = n - 1 - i;
		if(!half || back <= shoulder){ w.push(1); continue; }
		w.push(Math.pow(0.5, (back - shoulder) / half));
	}
	return w;
}

const weightOf = b => (b && b.weight !== undefined) ? b.weight : 1;
export const weightsOf = buckets => (buckets || []).map(weightOf);

export function cycleBuckets(legs, cycle, anchor, taper){
	if(!cycle)return [];
	const list = (legs || [])
		.filter(l => l && l.date)
		.map(l => ({leg: l, t: new Date(l.date).getTime()}))
		.filter(x => !isNaN(x.t))
		.sort((a, b) => a.t - b.t);
	if(!list.length)return [];

	const oldest = list[0].t, newest = list[list.length - 1].t;
	const root = anchor === null || anchor === undefined ? null : new Date(anchor);
	let guard = 0, top;
	if(root && !isNaN(root.getTime())){
		/* THE TOP EDGE IS THE FIRST LATTICE POINT STRICTLY AFTER THE NEWEST LEG, reached from the
		   anchor - forward when the anchor is older than the history, BACK when it is newer. The
		   backward half matters for a stream that stopped moving before the analysis root: without
		   it the walk keeps the cycles between the last payment and the anchor, which reads as "this
		   stream has been silent for two cycles" while saying nothing about the nine months of
		   silence since. Dormancy is a real finding and it is not this function's to make; stopping
		   at the legs leaves it to whatever asks the question properly. */
		top = root;
		while(top.getTime() <= newest && ++guard < MAX_CYCLES)top = cycle.nextDate(top);
		let back = cycle.previousDate(top);
		while(back.getTime() > newest && ++guard < MAX_CYCLES){top = back; back = cycle.previousDate(top)}
	}else top = new Date(newest + 1);

	const edges = [top];
	let cur = top;
	guard = 0;
	do {
		cur = cycle.previousDate(cur);
		edges.push(cur);
	} while(cur.getTime() > oldest && ++guard < MAX_CYCLES);

	const buckets = [];
	for(let i = edges.length - 1; i > 0; i--)
		buckets.push({start: new Date(edges[i]), end: new Date(edges[i-1]), legs: []});

	let b = 0;
	list.forEach(x => {
		while(b < buckets.length - 1 && x.t >= buckets[b].end.getTime())b++;
		//a leg older than the guard-capped walk has no bucket and is not counted
		if(x.t >= buckets[b].start.getTime() && x.t < buckets[b].end.getTime())buckets[b].legs.push(x.leg);
	});
	const w = cycleWeights(buckets.length, taper);
	buckets.forEach((bk, i) => { bk.weight = w[i]; });
	return buckets;
}

/* ---- WHERE IN ITS CYCLE EACH MOVEMENT LANDS ---------------------------------------------------
   ONE WHOLE DAY, COUNTED FROM THE START OF THE CYCLE IT FELL IN. Day 0 is the seam itself. The
   module's seam is the 21st, so a rent paid on the 2nd reads as day 12 and reads that way in every
   month regardless of how many days the month has.

   NOT A FRACTION OF THE CYCLE. A fraction would make the same calendar day land on a different
   number in February than in March, and the histogram the reader checks this against is drawn in
   days. The cost is that a 31-day month has one column a 30-day month never fills, which is true
   and visible rather than smoothed away. */
const ONE_DAY = 24 * 60 * 60 * 1000;

export function dayInCycle(leg, bucket){
	const t = new Date(leg.date).getTime() - bucket.start.getTime();
	return Math.floor(t / ONE_DAY);
}

/* EVERY CYCLE LAID ON TOP OF EVERY OTHER: how many movements ever landed on day 0, on day 1, and so
   on. This is the observation the shape is read off and the picture the audit page draws, and they
   are the same array so the reader is checking the decision rather than an illustration of it. */
export function dayHistogram(buckets){
	let span = 0;
	buckets.forEach(b => {
		const days = Math.round((b.end.getTime() - b.start.getTime()) / ONE_DAY);
		if(days > span)span = days;
	});
	const bins = new Array(Math.max(span, 1)).fill(0);
	//A BUCKET'S WEIGHT, NOT A COUNT OF ONE. With no taper every weight is 1 and this is the old sum.
	buckets.forEach(b => b.legs.forEach(l => {
		const d = dayInCycle(l, b);
		if(d >= 0 && d < bins.length)bins[d] += weightOf(b);
	}));
	return bins;
}

/* ---- WHICH DAYS THE LUMPS SIT ON --------------------------------------------------------------
   CUT THE OBSERVED DAYS INTO `n` GROUPS AT THE `n-1` BIGGEST GAPS, then answer each group's middle
   day. For one lump that is just the middle day of everything, which is the right answer and needs
   no special case.

   THE BIGGEST GAPS, because that is what "distinct lumps" means: utilities arriving on the 4th and
   the 18th are two tight clusters with a fortnight of nothing between them, and the fortnight is the
   only thing that identifies them as two events rather than one smeared one.

   THE MIDDLE DAY OF A GROUP, NOT ITS AVERAGE. Phone lands on day 28, 32, 28, 32, 28 and once on day
   92 after a billing mistake; the average is dragged four days by that one, the middle day is not. */
/* THE MIDDLE DAY, WITH HALF THE WEIGHT ON EITHER SIDE OF IT.

   THE TAPER REACHED EVERY DECISION BUT THIS ONE. It chose which cluster wins, whether the mode may
   claim a day at all, and how sure it is - and then the day itself was a plain median in which a
   movement from January counted exactly as much as one from last week. Plaid drifts later all year -
   d16 d13 d14 d17 d21 d18 d20 - and the plain median of all seven is d17 while the last four say d19.

   WITH ALL WEIGHTS EQUAL THIS IS THE PLAIN MEDIAN, including the even-count interpolation: at n = 4
   the running total reaches exactly half at the second value, which is the tie the last branch
   handles. So nothing moves when the taper is off. */
const middleOf = (xs, ws) => {
	if(!xs.length)return null;
	const a = xs.map((x, i) => ({x: x, w: (ws && ws[i] !== undefined) ? ws[i] : 1}))
		.sort((p, q) => p.x - q.x);
	const total = a.reduce((n, p) => n + p.w, 0);
	if(!total)return a[Math.floor(a.length / 2)].x;
	const half = total / 2;
	let run = 0;
	for(let i = 0; i < a.length; i++){
		run += a[i].w;
		if(run > half)return a[i].x;
		//EXACTLY HALF: the middle falls between this value and the next, so it is between them
		if(run === half)
			return Math.round((a[i].x + a[Math.min(i + 1, a.length - 1)].x) / 2);
	}
	return a[a.length - 1].x;
};

//how far a group's days sit from its own middle day, typically - the wobble the reader sees, and
//the distances carry their own movement's weight so a stale outlier widens it less
const wobbleOf = (xs, mid, ws) => xs.length
	? Math.round(middleOf(xs.map(x => Math.abs(x - mid)), ws))
	: 0;

/* ---- WHICH OF THE DAYS THE FORECAST ACTUALLY NAMES ----------------------------------------------
   SEVERAL CLUSTERS DOES NOT MEAN SEVERAL PAYMENTS. The credit card payment to Robinhood is 38
   movements over 37 weekly cycles - almost exactly one a week - and they sit in two clusters, d0 and
   d4. That is ONE payment that lands on one of two days, not two payments; a forecast that named both
   would invent a second payment every week.

   SO THE CYCLE'S OWN EVENT COUNT DECIDES HOW MANY DAYS ARE NAMED, and the biggest clusters get them.
   A cycle that typically carries one movement names one day - the day most of the movements chose -
   and the others are where it sometimes goes instead. A cycle that typically carries three names
   three, which is what a multi-lump is for.

   AT LEAST ONE DAY IS ALWAYS NAMED. A sparse mode - seven shops across thirteen weeks - has a
   commonest count of zero, and answering "no day" there would be the shape's job, not this
   function's: it reports which day the pattern points at, and whether the pattern should have been
   claimed at all is decided before it is called. */
export function predictedDays(days, typical){
	const all = (days || []).slice();
	if(!all.length)return [];
	const n = Math.min(all.length, Math.max(1, typical || 0));
	return all.slice()
		.sort((a, b) => (b.events || 0) - (a.events || 0) || a.day - b.day)
		.slice(0, n)
		.map(d => d.day)
		.sort((a, b) => a - b);
}

export function lumpDays(buckets, n){
	/* THE DAY, THE WOBBLE AND THE SIZE OF A CLUSTER ALL COUNT RECENCY. Which cluster wins decides
	   which day is named; where its middle sits decides which day that is. */
	const items = [];
	buckets.forEach(b => b.legs.forEach(l => items.push({d: dayInCycle(l, b), w: weightOf(b)})));
	if(!items.length)return [];
	items.sort((a, b) => a.d - b.d);
	const days = items.map(x => x.d);

	//the n-1 biggest gaps between consecutive days are where the groups are cut
	const cuts = [];
	for(let i = 1; i < days.length; i++)cuts.push({at: i, gap: days[i] - days[i - 1]});
	cuts.sort((a, b) => b.gap - a.gap || a.at - b.at);
	const edges = cuts.slice(0, Math.max(0, n - 1)).map(c => c.at).sort((a, b) => a - b);

	const groups = [];
	let from = 0;
	edges.concat([days.length]).forEach(to => {
		if(to > from)groups.push(items.slice(from, to));
		from = to;
	});
	return groups.map(g => {
		const ds = g.map(x => x.d), ws = g.map(x => x.w);
		const mid = middleOf(ds, ws);
		return {day: mid, wobble: wobbleOf(ds, mid, ws),
			events: g.reduce((n, x) => n + x.w, 0)};
	});
}

/* ---- HOW SHARP THE FOCUS IS -------------------------------------------------------------------
   CONCENTRATION, ON THE CYCLE READ AS A CIRCLE. Every movement is a point on the rim at its own day,
   and they are added as directions rather than as numbers. All on the same day and they pull
   together: length 1. Evenly smeared and they cancel: length 0. It is the same idea as focus in a
   photograph - one sharp point, or the same light spread over everything.

   THE CIRCLE MATTERS AND IS NOT A FLOURISH. Day 30 and day 0 are one day apart, not thirty. Shopping
   lands on days 24, 29, 30 and 3, which on a straight line looks like two groups at opposite ends
   and on the circle is one cluster straddling the seam - 0.76, a lump, which is what it is.

   WRAPPING THE CIRCLE k TIMES FINDS k LUMPS. Two clusters half a cycle apart cancel exactly when
   counted once round; wrap the circle twice and they land on top of each other and pull together.
   So the first k that brings the movements into focus is how many lumps the cycle carries. */
export function concentration(bins, k){
	const days = bins.length;
	if(!days)return null;
	let sx = 0, sy = 0, total = 0;
	bins.forEach((count, day) => {
		const angle = 2 * Math.PI * (k || 1) * (day / days);
		sx += Math.cos(angle) * count;
		sy += Math.sin(angle) * count;
		total += count;
	});
	if(!total)return null;
	return Math.sqrt(sx * sx + sy * sy) / total;
}

/* THE FEWEST LUMPS THAT BRING IT INTO FOCUS. One is tried first and wins ties, because a stream that
   is already in focus as a single lump is a single lump - two lumps on the same day is not a second
   reading of it, it is the same reading counted twice. */
export function focusOf(bins, cfg, pin){
	const c = Object.assign({}, SHAPE_CONFIG, cfg || {});
	const at = [];
	for(let k = 1; k <= c.maxLumps; k++)at.push(concentration(bins, k));

	/* PINNED: the cycle already said how many movements it carries, so that is how many days the
	   model is allowed to claim. It clears the bar at that k or it claims no day at all - there is no
	   third answer where the shape names more days than the forecast will use. */
	if(pin){
		const k = Math.min(Math.max(1, pin), c.maxLumps);
		const v = at[k - 1];
		return {lumps: (v !== null && v >= c.minConcentration) ? k : 0,
			concentration: v, perLump: at};
	}

	//FREE: the first k that brings the movements into focus, which is what the audit page explores
	for(let k = 1; k <= c.maxLumps; k++)
		if(at[k - 1] !== null && at[k - 1] >= c.minConcentration)
			return {lumps: k, concentration: at[k - 1], perLump: at};
	return {lumps: 0, concentration: at[0], perLump: at};
}

/* ---- HOW FAR OFF THE MOVEMENTS LAND ------------------------------------------------------------
   ON AVERAGE, HOW MANY DAYS FROM ITS NEAREST CLAIMED DAY does a movement fall. Rent lands 0.7 days
   off on average; Utilities 1.2; Shopping 3.3. That is the number a person is reading off the
   histogram when they say one looks tighter than another, and it is in days, so it can be checked
   by counting.

   MEASURED ROUND THE CIRCLE, so the last day of a cycle is one day from the first.

   IT REPLACED TWO EARLIER ATTEMPTS AND THE REASON IS WORTH KEEPING. An angle measure saturates:
   on a monthly cycle anything inside a week scores over 0.9, and Rent and Utilities came out 0.01
   apart while landing three days and five days wide. Counting the busiest days instead ignored where
   they were - Savings scored well on days 2, 5, 8, 23 and 24, which is not a target anyone could aim
   at. Growing a window day by day fixed that and introduced ties: Shopping's four movements sit on
   days 3, 24, 29 and 30 with nothing between them, so the window had no reason to grow one way
   rather than the other and wandered to 27 days. A distance has no ties to break. */
const dayGap = (a, b, days) => {
	const d = Math.abs(a - b) % days;
	return d > days / 2 ? days - d : d;
};

/* THE CLAIMED DAYS, READ OFF THE HISTOGRAM: the k busiest days, no two of them neighbours. The
   adjacency rule is what stops one cluster being counted as two - a second claimed day has to be
   somewhere else in the cycle to be a second lump at all. */
export function peakDays(bins, lumps){
	const days = bins.length;
	const k = Math.max(1, lumps || 1);
	const taken = [];
	for(let c = 0; c < k; c++){
		let best = -1, most = 0;
		for(let d = 0; d < days; d++){
			if(taken.indexOf(d) >= 0)continue;
			if(taken.some(t => dayGap(t, d, days) <= 1))continue;
			if(bins[d] > most){ most = bins[d]; best = d; }
		}
		if(best < 0)break;
		taken.push(best);
	}
	return taken.sort((a, b) => a - b);
}

export function dayScatter(bins, lumps){
	const days = bins.length;
	const peaks = peakDays(bins, lumps);
	if(!days || !peaks.length)return null;
	let total = 0, sum = 0;
	bins.forEach((count, day) => {
		if(!count)return;
		let nearest = days;
		peaks.forEach(pk => {
			const g = dayGap(pk, day, days);
			if(g < nearest)nearest = g;
		});
		sum += nearest * count;
		total += count;
	});
	return total ? sum / total : null;
}

/* THE SAME SCATTER AS A SCORE, NORMALISED SO CYCLE LENGTH AND CLUSTER COUNT DROP OUT.

       tightness = 1 - scatter / (cycleDays / (4 x lumps))

   Movements landing anywhere in the cycle sit a quarter of it away from any given day on average, so
   that is the zero point; landing on the claimed day every time is 1. With k clusters the cycle is
   effectively k times shorter, which is why k divides the yardstick - a weekly stream paid on the
   same weekday scores the same as a monthly one paid on the same date. */
export function tightness(bins, lumps){
	const days = bins.length;
	const k = Math.max(1, lumps || 1);
	const scatter = dayScatter(bins, k);
	if(scatter === null || !days)return null;
	const worst = days / (4 * k);
	if(worst <= 0)return null;
	const t = 1 - scatter / worst;
	return t < 0 ? 0 : t > 1 ? 1 : t;
}

/* ---- HOW WELL A PATTERN FITS: IT HAS TO TURN UP, AND IT HAS TO LAND ------------------------------

       fit = share of cycles that carry anything  x  how tightly those land on a day

   BOTH HALVES ARE THE PATTERN. A bill that is always on the 6th but skipped August is not a monthly
   bill that happens to be tight - it is a monthly bill that missed a month, and a forecast built on
   it will invent a payment that never came. Tightness alone cannot see that: it only looks at where
   movements landed, never at the cycles where none did.

   THIS IS WHY DAY CARE EMILE'S ZELLE TRANSFER BELONGS. The cheques land tightly and skip August; the
   Zelle IS August's payment, paid another way once. Merging it loosens the day a little and completes
   the year, and only a score carrying both halves can see that as the improvement it is:

       cheques alone    counts 1 1 1 1 1 1 1 0 1    fills 0.889 x tight 0.806 = 0.717
       with the Zelle   counts 1 1 1 1 1 1 1 1 1    fills 1.000 x tight 0.756 = 0.756

   IT ALSO DEFLATES A SPARSE MODE WITHOUT FORBIDDING ONE. Whole Foods is nine trips across 37 weeks:
   nine points cannot help piling onto a handful of weekday slots, so they look tight, and 0.31 x 0.57
   says what they are worth. Nothing is gated - a stray can still complete a sparse mode and raise it -
   the score simply stops mistaking arithmetic for a habit. */
export function patternFit(bins, counts, lumps, weights){
	const t = tightness(bins, lumps);
	if(t === null)return null;
	if(!counts || !counts.length)return null;
	//A CYCLE THE STREAM MISSED LAST MONTH COSTS MORE THAN ONE IT MISSED IN JANUARY.
	const w = i => (weights && weights[i] !== undefined) ? weights[i] : 1;
	let filled = 0, total = 0;
	counts.forEach((c, i) => { total += w(i); if(c > 0)filled += w(i); });
	if(!total)return null;
	return (filled / total) * t;
}

/* ---- TWO MORE READINGS OF THE SAME BARS, FOR COMPARISON ----------------------------------------
   None of these decides anything yet. They are on the audit page behind a selector so the one that
   matches what a person sees can be chosen on evidence rather than argued about.

   SPREAD: the standard deviation of the movements' days, as a fraction of the cycle. The usual
   circular form - sqrt(-2 ln R) in radians, converted to days. It is the plainest statement of the
   question: 0.036 means the movements sit within about three and a half percent of the cycle, which
   on a month is a day. It separates the top end where the angle cannot: Internet 0.025 against
   Utilities 0.046, where the angle reads 0.99 against 0.96.

   TEST: the Rayleigh test, which asks whether the movements are distinguishable from landing
   ANYWHERE in the cycle. Z = n x R squared, and p is the chance of seeing a clustering this tight
   from a stream with no day at all. It is the only one of the four that accounts for how many
   movements there are, so it needs no minimum-movement gate: Shopping's four movements score a
   respectable angle of 0.76 and a p of 0.094, which is a fair way of saying four is not enough. */
export function circularSd(bins, lumps){
	const days = bins.length;
	const k = Math.max(1, lumps || 1);
	const R = concentration(bins, k);
	if(R === null || !days)return null;
	const radians = Math.sqrt(-2 * Math.log(Math.max(R, 1e-9)));
	const inDays = (days / (k * 2 * Math.PI)) * radians;
	//as a share of one cluster's worth of cycle, so cycle length and cluster count drop out
	return {days: inDays, share: inDays / (days / k)};
}

export function rayleigh(bins, lumps){
	const k = Math.max(1, lumps || 1);
	const R = concentration(bins, k);
	const n = bins.reduce((t, x) => t + x, 0);
	if(R === null || !n)return null;
	const z = n * R * R;
	//the standard small-sample correction; clamped because it can overshoot at tiny n
	const p = Math.exp(-z) * (1 + (2 * z - z * z) / (4 * n));
	return {z: z, p: p < 0 ? 0 : p > 1 ? 1 : p};
}

/* ---- THE THEORIES ------------------------------------------------------------------------------
   A STREAM'S MOVEMENTS CAN BE READ SEVERAL WAYS AND EACH READING IS A THEORY. Rather than gate the
   readings behind thresholds - is this merchant dominant enough, did that adjustment help enough -
   every reading is tried and scored the same way, and the stream says which one is true of it.

   THE READINGS:

     everything             the ledger as recorded. Invents nothing, so it is the default.
     closures undone        real-time accounts only, one theory per direction. A bank posts only on
                            an open day, so a payment due on a Sunday lands Friday or Monday and the
                            stream reads as scattered by up to three days. Which way the payer's
                            arrangement goes is not recorded anywhere, so both are tried.
     one payer only         a stream can carry two payers and only one of them has a cadence. Wages
                            Julien is a semimonthly payroll plus three disability deposits; together
                            they describe neither. The rest are counted as exceptions, never dropped
                            quietly.
     one payer, closures undone     the two together.

   HOW ONE WINS. A theory has to be ABOUT the stream - it must use at least minTheoryShare of the
   movements, which is what keeps a reading of four of Groceries' 167 out of the running. Among those
   that are, the TIGHTEST fit wins. And a theory that invents something - sets movements aside, moves
   dates around - may only displace the plain reading of the ledger if it fits very well indeed.

   THE TWO ARE NOT TRADED AGAINST EACH OTHER. Multiplying them buries the case this exists for:
   Wages Julien's payroll fits 0.89 on 80% of the movements and the unsplit stream fits 0.72 on all
   of them, and a product prefers the unsplit one by a hundredth of a point - leaving three
   disability deposits mixed into a payroll to protect a coverage figure.

   A CARD IS NEVER ADJUSTED FOR CLOSURES. It posts when the merchant presents it, so those theories
   are not even generated - offering them would fit weekend SHOPPING, and groceries tighten 24% under
   an adjustment no bank rule is anywhere near. */
const theoryLegs = (legs, how, country) => (legs || [])
	.map(l => ({date: snapDate(new Date(l.date), how, country), accountId: l.accountId,
		description: l.description, amount: l.amount}));

function scoreTheory(legs, total, cycle, anchor, taper){
	const buckets = cycleBuckets(legs, cycle, anchor, taper);
	const bins = dayHistogram(buckets);
	const counts = buckets.map(b => b.legs.length);
	const verdict = classifyShape(counts, bins, null, weightsOf(buckets));
	//THE FIT, NOT THE TIGHTNESS. A theory that lands tightly but skips cycles has not explained them.
	const tight = verdict.fit === undefined || verdict.fit === null ? 0 : verdict.fit;
	const share = total ? legs.length / total : 0;
	return {legs: legs, buckets: buckets, bins: bins, counts: counts, verdict: verdict,
		share: share, tightness: tight, eligible: share >= SHAPE_CONFIG.minTheoryShare};
}

export function shapeTheories(legs, cycle, anchor, opts){
	const o = opts || {};
	const all = legs || [];
	const made = [];
	if(!cycle || !all.length)return made;

	const add = (label, kind, ls, how) => {
		if(ls.length < 1)return;
		const t = scoreTheory(theoryLegs(ls, how, o.country), all.length, cycle, anchor, o.taper);
		t.label = label;
		t.kind = kind;
		t.snap = how;
		made.push(t);
	};

	add('everything, as recorded', 'all', all, SNAP.none);
	if(o.realTime){
		add('everything, closures pulled back', 'all', all, SNAP.next);
		add('everything, closures pushed on', 'all', all, SNAP.back);
	}

	const groups = merchantGroups(all);
	if(groups.length > 1)groups.forEach(g => {
		if(g.legs.length < SHAPE_CONFIG.minMovements)return;
		add(g.key + ' only', 'payer', g.legs, SNAP.none);
		if(o.realTime){
			add(g.key + ' only, closures pulled back', 'payer', g.legs, SNAP.next);
			add(g.key + ' only, closures pushed on', 'payer', g.legs, SNAP.back);
		}
	});

	//tightest first, and a theory that uses more of the stream breaks a tie
	return made.sort((a, b) => b.tightness - a.tightness || b.share - a.share);
}

/* THE ONE THE STREAM CHOSE. The default is "everything, as recorded" and it holds unless another
   theory is strong enough to displace it - a reading that invents nothing does not have to earn its
   place, and every other one does. */
export function chooseTheory(theories){
	if(!theories.length)return null;
	const base = theories.filter(t => t.kind === 'all' && t.snap === SNAP.none)[0] || theories[0];
	const best = theories.filter(t => t.eligible)[0];
	if(!best || best === base)return {chosen: base, base: base, displaced: false};
	/* THE BEST FIT WINS, AND THERE IS NO BAR TO CLEAR. The plain reading of the ledger is one theory
	   among the others and it competes on the same terms; a bar on top of that would only be a
	   second opinion about a comparison already made. Eligibility - using enough of the stream to be
	   about it - is the only thing a theory has to satisfy before its fit is believed. */
	if(best.tightness <= base.tightness)
		return {chosen: base, base: base, displaced: false, runnerUp: best};
	return {chosen: best, base: base, displaced: true};
}

/* WHETHER A STREAM'S MOVEMENTS EVEN LAND ON OPEN DAYS, reported because a leg on a closed day is
   itself evidence that this account does not follow the rule. */
export function landsOnClosedDays(legs, country){
	return (legs || []).filter(l => !isBusinessDay(new Date(l.date), country)).length;
}

/* ---- THE CLASSIFIER ---------------------------------------------------------------------------
   THE COUNT ALONE DOES NOT NAME THE SHAPE, and that was the defect this replaces. Reading the shape
   off the typical count and a cutoff put groceries - four or five shops a week, every week, the
   textbook spread - into the same bucket as a utility bill arriving twice a month, because both
   typically carry four or fewer movements. What separates them is not how many, it is whether the
   how-many REPEATS.

       steady, one per cycle        a lump
       steady, several per cycle    that many lumps
       not steady, but busy         a spread: real movement, no rhythm to it
       not steady, not busy         no shape. An irregular stream is not a shape with low
                                    confidence, it is the absence of one, and saying so is the
                                    answer rather than a failure to produce one.

   STEADY MEANS THE TYPICAL COUNT ACTUALLY RECURS - the share of cycles carrying exactly it. Rent is
   1 1 1 1 1 1 1 1 1 and scores 100%; groceries is 4 10 1 5 5 6 8 3 6 0 7 ... and scores 24%.

   THE TYPICAL COUNT IS THE COMMONEST ONE, NOT THE MIDDLE ONE. A middle value lands between two
   integers whenever an even number of cycles was observed, and then "how many cycles carry exactly
   it" is zero for a stream that is perfectly steady at two different levels. The commonest count is
   always a count some cycle actually had, which is the only kind of number "exactly it" can be
   measured against. Ties go to the smaller count, so a stream that is half ones and half twos is
   described as the quieter of the two rather than by whichever happened to be seen first.

   A SINGLE CYCLE IS NOT A REPEAT. One observed cycle makes every count its own commonest and scores
   100% by construction - Date showed three movements in one month and claimed three lumps at full
   confidence. Below minCyclesObserved there is nothing to be steady ABOUT. */
const commonest = xs => {
	if(!xs.length)return null;
	const seen = {};
	xs.forEach(x => { seen[x] = (seen[x] || 0) + 1; });
	return Object.keys(seen).map(Number).sort((a, b) => seen[b] - seen[a] || a - b)[0];
};

export function classifyShape(counts, bins, cfg, weights){
	const c = Object.assign({}, SHAPE_CONFIG, cfg || {});
	if(!counts.length)return {shape: null, reason: 'no cycles'};

	const placed = counts.reduce((n, x) => n + x, 0);
	if(!placed)return {shape: null, reason: 'no movements on this account'};
	if(counts.length < c.minCyclesObserved)
		return {shape: null, reason: 'only ' + counts.length + ' cycle'
			+ (counts.length === 1 ? '' : 's') + ' observed'};

	/* THE FLOOR COUNTS WEIGHTED MOVEMENTS, and under a taper that is the guard that keeps the whole
	   idea honest. Four Amazon deliveries scattered across a year weigh less than four movements once
	   the old ones fade, and without this they would read as a confident monthly lump on the strength
	   of the newest one. With no taper every weight is 1 and this is the raw count. */
	const carried = counts.reduce((n, x, i) =>
		n + x * ((weights && weights[i] !== undefined) ? weights[i] : 1), 0);
	if(carried < c.minMovements)
		return {shape: null, reason: 'only ' + (Math.round(carried * 10) / 10) + ' movement'
			+ (carried === 1 ? '' : 's') + ' to read once the old ones fade'};

	const typical = commonest(counts);
	const steady = counts.filter(x => x === typical).length / counts.length;
	const busy = counts.filter(x => x > 0).length / counts.length;
	/* AS MANY CLUSTERS AS THE CYCLE HAS MOVEMENTS. A cycle that typically carries nothing is still
	   asked about one day - whether it should have been asked at all is the movement floor's job,
	   already answered above. */
	const focus = focusOf(bins || [], c,
		c.pinLumpsToEventsPerCycle ? Math.max(1, typical) : 0);
	const fit = patternFit(bins || [], counts, focus.lumps, weights);
	/* REPORTED, NOT YET DECIDING. The width is the number a person can check against the bars; the
	   angular focus is what still picks the shape and finds how many clusters there are. Both travel
	   so the two can be compared on the audit page before either is given the gate. */
	const lumps = Math.max(1, focus.lumps || 1);
	const base = {typical: typical, steady: steady, busy: busy,
		concentration: focus.concentration, lumps: focus.lumps, perLump: focus.perLump,
		fit: fit === null ? 0 : fit,
		scatter: dayScatter(bins || [], lumps),
		cycleDays: (bins || []).length,
		tightness: tightness(bins || [], lumps),
		sd: circularSd(bins || [], lumps),
		test: rayleigh(bins || [], lumps)};

	//IN FOCUS: the movements land on a day, or on k days. That is a lump, or k of them.
	if(focus.lumps === 1)return Object.assign({shape: Shape.lump, confidence: focus.concentration}, base);
	if(focus.lumps > 1)
		return Object.assign({shape: Shape.multiLump, confidence: focus.concentration}, base);

	/* OUT OF FOCUS AND BUSY: a flow. The confidence is how far OUT of focus it is, because that is
	   what is being claimed - a perfectly flat cycle is a perfectly certain spread, and reporting
	   0.11 there would read as doubt about the one row the picture is clearest on. */
	if(busy >= c.minBusyShare && typical >= c.minSpreadEventsPerCycle)
		return Object.assign({shape: Shape.spread,
			confidence: 1 - (focus.concentration === null ? 0 : focus.concentration)}, base);

	//OUT OF FOCUS AND NOT BUSY: nothing to say. Not a shape with low confidence - no shape.
	return Object.assign({shape: null,
		reason: 'the movements do not land on a day and the stream is not a flow'}, base);
}

/* ---- THE WORKING, FOR AN AUDIT ----------------------------------------------------------------
   Everything the decision looked at, per allocation. This is a DEBUG surface, not the answer -
   determineShape below is the answer, and it is deliberately narrow. */
export function explainShape(legs, partition, cycle, anchor, opts){
	const o = opts || {};
	const yearly = !!cycle && !!YEARLY[cycle.name];
	return (partition || []).map(alloc => {
		const onAccount = (legs || []).filter(l => l && l.accountId === alloc.accountId);
		const realTime = alloc.accountType === AccountKind.realTime;

		/* EVERY READING OF THIS ACCOUNT'S MOVEMENTS IS TRIED and the stream picks one. Nothing here
		   is gated on a merchant being dominant enough or an adjustment helping enough - a theory
		   either explains most of the stream tightly or it does not win. */
		const theories = (cycle && !yearly)
			? shapeTheories(onAccount, cycle, anchor,
				{country: o.country, realTime: realTime, taper: o.taper})
			: [];
		const pick = chooseTheory(theories);
		const chosen = pick ? pick.chosen : null;

		const buckets = chosen ? chosen.buckets
			: (cycle ? cycleBuckets(onAccount, cycle, anchor, o.taper) : []);
		const counts = chosen ? chosen.counts : buckets.map(b => b.legs.length);
		const bins = chosen ? chosen.bins : dayHistogram(buckets);
		const verdict = yearly
			? {shape: null, reason: 'the cycle is still yearly after determination'}
			: (chosen ? chosen.verdict : classifyShape(counts, bins, null, weightsOf(buckets)));
		const lumpy = verdict.shape === Shape.lump || verdict.shape === Shape.multiLump;

		return {
			accountId: alloc.accountId,
			shape: verdict.shape,
			reason: verdict.reason || null,
			//HOW MANY LUMPS COMES FROM THE FOCUS, not from the count: the cycle that brought the
			//movements into focus is the one that says how many clusters there are.
			days: lumpy ? lumpDays(buckets, verdict.lumps) : [],
			confidence: verdict.shape ? verdict.confidence : null,
			concentration: verdict.concentration === undefined ? null : verdict.concentration,
			lumps: verdict.lumps === undefined ? null : verdict.lumps,
			tightness: verdict.tightness === undefined ? null : verdict.tightness,
			scatter: verdict.scatter === undefined ? null : verdict.scatter,
			sd: verdict.sd === undefined ? null : verdict.sd,
			test: verdict.test === undefined ? null : verdict.test,
			cyclesObserved: buckets.length,
			eventsPerCycle: counts,
			typicalEventsPerCycle: verdict.typical === undefined ? null : verdict.typical,
			steadyShare: verdict.steady === undefined ? null : verdict.steady,
			busyShare: verdict.busy === undefined ? null : verdict.busy,
			histogram: bins,
			accountType: alloc.accountType || null,
			legsOnAccount: onAccount.length,
			//the whole picture as recorded, so the page can draw what the theory changed
			baseHistogram: pick ? pick.base.bins : bins,
			theory: chosen ? {label: chosen.label, kind: chosen.kind, snap: chosen.snap,
				share: chosen.share, tightness: chosen.tightness,
				exceptions: onAccount.length - chosen.legs.length} : null,
			displaced: pick ? pick.displaced : false,
			runnerUp: (pick && pick.runnerUp)
				? {label: pick.runnerUp.label, tightness: pick.runnerUp.tightness} : null,
			theories: theories.map(t => ({label: t.label, kind: t.kind, snap: t.snap,
				share: t.share, tightness: t.tightness, tightness: t.tightness, eligible: t.eligible,
				shape: t.verdict.shape})),
			closedDayLegs: realTime ? landsOnClosedDays(onAccount, o.country) : null
		};
	});
}

/* ---- A PATTERN AND ITS OWN EXCEPTIONS -----------------------------------------------------------
   DROP THE MOVEMENT FURTHEST FROM THE CLAIMED DAY WHILE THAT IMPROVES THE FIT. A habit with a late
   month is still that habit, and a mode that has to account for every movement it ever made cannot
   say so - it is forced to describe the exceptions as though they were part of the rhythm.

   Savings is the case. A calendar reminder on the 15th, sometimes paid late, sometimes joined by a
   one-off transfer out to fund something large. Six movements: four on the 14th/15th and two strays
   in March. Made to explain all six, the model reads TWO lumps half a cycle apart - because the
   March stray happens to sit opposite the real cluster, and wrapping the circle twice lands them on
   top of each other. Allowed two exceptions, it reads one lump on d24, which is the 15th.

   WHAT IS DROPPED IS NOT DISCARDED. It is the mode's own noise: counted, reported, and carried into
   the stream's baseline, which is where unpredictable money belongs.

   THE RESULT STILL HAS TO BE A LUMP, and that guard is load-bearing. Trimming always improves a score
   that rewards landing on a day, so a spread will happily give up a third of its movements chasing
   one - Grocery Outlet sheds 18 of 60 shops before the arithmetic stops encouraging it, and is a
   flow at every step. A trim that does not produce a pattern is discarded and the mode is left as it
   was. */
function fitOf(legs, cycle, anchor, taper){
	const buckets = cycleBuckets(legs, cycle, anchor, taper);
	const bins = dayHistogram(buckets);
	const counts = buckets.map(b => b.legs.length);
	const verdict = classifyShape(counts, bins, null, weightsOf(buckets));
	return {fit: verdict.fit || 0, verdict: verdict, buckets: buckets, bins: bins, counts: counts};
}

export function patternWithExceptions(legs, cycle, anchor, cfg, taper){
	const c = Object.assign({}, SHAPE_CONFIG, cfg || {});
	const all = legs || [];
	const start = fitOf(all, cycle, anchor, taper);
	if(all.length < c.minMovements)return {kept: all, exceptions: [], result: start, trimmed: false};

	//a spread has no day to be near, so there is nothing here for it to be trimmed towards
	if(start.verdict.shape === Shape.spread)
		return {kept: all, exceptions: [], result: start, trimmed: false};

	const floor = Math.max(c.minMovements, Math.ceil(all.length * (1 - c.maxExceptionShare)));
	let kept = all.slice(), best = start;
	const exceptions = [];

	while(kept.length > floor){
		const buckets = cycleBuckets(kept, cycle, anchor, taper);
		const claimed = lumpDays(buckets, 1)[0];
		if(!claimed)break;
		const span = dayHistogram(buckets).length || 1;
		let worst = null, worstGap = -1;
		buckets.forEach(b => b.legs.forEach(l => {
			const raw = Math.abs(dayInCycle(l, b) - claimed.day) % span;
			const gap = raw > span / 2 ? span - raw : raw;
			if(gap > worstGap){ worstGap = gap; worst = l; }
		}));
		if(!worst || worstGap <= 0)break;
		const trial = kept.filter(l => l !== worst);
		const t = fitOf(trial, cycle, anchor, taper);
		if(t.fit <= best.fit)break;
		kept = trial;
		best = t;
		exceptions.push(worst);
	}

	const lumpy = best.verdict.shape === Shape.lump || best.verdict.shape === Shape.multiLump;
	if(!exceptions.length || !lumpy)
		return {kept: all, exceptions: [], result: start, trimmed: false};
	return {kept: kept, exceptions: exceptions, result: best, trimmed: true};
}

/* ---- PUTTING MODES BACK TOGETHER ----------------------------------------------------------------
   SPLITTING BY PAYEE CUTS TOO FINELY SOMETIMES, and the same evidence that justified the split can
   say so. A payee with no pattern of its own may simply be a rhythm the bank spelled differently for
   a month, and the way to find out is to put it back and look: if the movements belong to the rhythm
   they land on its day and the merged mode is tighter or no worse; if they do not, they widen it.

   THE MERGE HAS TO IMPROVE THE HOST, and that is a comparison rather than a bar. A stray that
   belongs to the rhythm either lands on its day or fills a cycle the rhythm had missed, and cannot
   make it worse; one that does not, widens it and is refused by the same arithmetic. Nothing is
   merged on the strength of its NAME looking similar.

   BOTH HALVES OF THE FIT MATTER HERE. Day care Emile's Zelle transfer lands on a different day from
   its cheques and would be refused on tightness alone - but August has no cheque, because the
   transfer IS August's payment, and completing the year is worth more than the day it cost.

   WHAT IS STILL LOOSE AFTERWARDS IS GATHERED INTO ONE MODE. Twenty-one grocery payees are not
   twenty-one facts about a forecast - they are one habit with a long tail, and a single "everything
   else" mode that can carry its own shape says more than twenty rows of "no pattern" each holding
   half a percent of the money. Where that gathered mode has a shape it keeps it; where it does not,
   it is the baseline, which is a rate rather than a date. */
const mergeLegs = (a, b) => (a || []).concat(b || []);

/* WHICH WAY THE MONEY WENT. The sign is the whole of it: a stream's legs are already signed against
   the account they moved through, so a deposit and a withdrawal on the same account, under nearly the
   same payee name, are told apart without knowing anything about either. */
export const directionOf = leg => (leg && leg.amount < 0) ? 'out' : 'in';

/* A PAYEE IS SPLIT BEFORE IT IS MEASURED, biggest side first. Two directions under one name are two
   facts - the savings deposit and the pull-back that funds a large expense - and measuring them
   together lets the second fill a cycle the first missed. */
export function byDirection(legs){
	const parts = [];
	(legs || []).forEach(l => {
		const d = directionOf(l);
		const hit = parts.find(p => p.direction === d);
		if(hit)hit.legs.push(l);
		else parts.push({direction: d, legs: [l]});
	});
	return parts.sort((a, b) => b.legs.length - a.legs.length
		|| (a.direction < b.direction ? -1 : 1));
}

/* WHERE A SET OF MOVEMENTS MOSTLY HAPPENED, counted in transactions rather than money - one large
   payment from the wrong account does not relocate a habit, and a majority of small ones does. */
export function dominantAccount(legs){
	const n = {};
	(legs || []).forEach(l => { if(l)n[l.accountId] = (n[l.accountId] || 0) + 1; });
	const ids = Object.keys(n).sort((a, b) => n[b] - n[a] || (a < b ? -1 : 1));
	if(!ids.length)return {accountId: null, share: 0};
	return {accountId: ids[0], share: n[ids[0]] / (legs || []).length};
}

function remeasure(legs, cycle, anchor, opts){
	const o = opts || {};
	const theories = shapeTheories(legs, cycle, anchor,
		{country: o.country, realTime: o.realTime, taper: o.taper}).filter(t => t.kind === 'all');
	const pick = chooseTheory(theories);
	const chosen = pick ? pick.chosen : null;
	const buckets = chosen ? chosen.buckets : cycleBuckets(legs, cycle, anchor, o.taper);
	const bins = chosen ? chosen.bins : dayHistogram(buckets);
	const counts = chosen ? chosen.counts : buckets.map(b => b.legs.length);
	const verdict = chosen ? chosen.verdict
		: classifyShape(counts, bins, null, weightsOf(buckets));
	return {verdict: verdict, buckets: buckets, bins: bins,
		snap: chosen ? chosen.snap : SNAP.none,
		fit: (verdict.fit === undefined || verdict.fit === null) ? 0 : verdict.fit};
}

export function collapseModes(modes, cycle, anchor, opts, cfg){
	const c = Object.assign({}, SHAPE_CONFIG, cfg || {});
	const o = opts || {};
	if(!cycle)return {modes: modes, gathered: null};

	const patterned = modes.filter(m => !!m.shape);
	let loose = modes.filter(m => !m.shape);

	/* BIGGEST STRAY FIRST, and each is offered to every patterned mode on the same account. The one
	   that keeps the strongest pattern takes it; ties go to the mode with more money riding on it,
	   because that is the rhythm a wrong answer costs most. */
	loose.sort((a, b) => b.moneyShare - a.moneyShare);
	const leftover = [];

	loose.forEach(stray => {
		let best = null;
		patterned.forEach(host => {
			/* A REVERSAL IS NOT A LATE PAYMENT. Money out cannot complete a rhythm of money in, so
			   direction is checked before anything is measured - the arithmetic would otherwise be
			   happy to let a withdrawal fill the cycle a deposit missed. */
			if(host.direction !== stray.direction)return;

			/* AND A PATTERN CONCLUDES ON ONE ACCOUNT. Crossing is allowed only where the result is
			   plainly one account's habit with a few movements made elsewhere; the merged mode is
			   then reported on that account, and measured with THAT account's posting behaviour. */
			const legs = mergeLegs(host.rawLegs, stray.rawLegs);
			const dom = dominantAccount(legs);
			if(dom.share < c.minDominantAccountShare)return;
			const domType = dom.accountId === host.accountId ? host.accountType
				: dom.accountId === stray.accountId ? stray.accountType : host.accountType;
			const merged = remeasure(legs, cycle, anchor,
				{country: o.country, realTime: domType === AccountKind.realTime});
			const lumpy = merged.verdict.shape === Shape.lump
				|| merged.verdict.shape === Shape.multiLump;
			/* NO BAR - A COMPARISON. The question is whether adding this made the host better or
			   worse, not whether the result is good in the abstract. A stray that belongs to the
			   rhythm lands on its day, or fills a cycle the rhythm had missed, and cannot make it
			   worse; one that does not, widens it and is refused by the same arithmetic. */
			if(!lumpy || merged.fit < host.confidence)return;
			if(!best || merged.fit > best.fit
				|| (merged.fit === best.fit && host.moneyShare > best.host.moneyShare))
				best = {host: host, merged: merged, fit: merged.fit,
					accountId: dom.accountId, accountType: domType};
		});
		if(!best){ leftover.push(stray); return; }

		const host = best.host, mg = best.merged;
		host.rawLegs = mergeLegs(host.rawLegs, stray.rawLegs);
		host.legs = host.rawLegs.length;
		//the pattern concludes on the account it mostly happened on, which may not be the host's
		host.accountId = best.accountId;
		host.accountType = best.accountType;
		host.money += stray.money;
		host.moneyShare += stray.moneyShare;
		host.absorbed = (host.absorbed || []).concat([stray.label + ' x' + stray.legs]);
		host.shape = mg.verdict.shape;
		host.confidence = mg.fit;
		host.adjusted = mg.snap;
		host.histogram = mg.bins;
		host.cyclesObserved = mg.buckets.length;
		const d = lumpDays(mg.buckets, mg.verdict.lumps);
		host.days = d.map(x => x.day);
		host.wobble = d.map(x => x.wobble);
		host.dayEvents = d.map(x => x.events);
		host.typical = mg.verdict.typical === undefined ? null : mg.verdict.typical;
		host.predicted = predictedDays(d, mg.verdict.typical);
	});

	/* EVERYTHING STILL LOOSE BECOMES ONE MODE. Per account, because a shape is per account and a
	   rhythm on a card is not a rhythm on a current account - and per direction, because gathering
	   deposits and withdrawals into one row would hide the two behind their net. */
	const gathered = [];
	const byAccount = {};
	leftover.forEach(m => {
		const k = m.accountId + '|' + m.direction;
		(byAccount[k] = byAccount[k] || []).push(m);
	});
	Object.keys(byAccount).forEach(k => {
		const group = byAccount[k];
		const id = group[0].accountId;
		if(group.length < 2){ gathered.push(group[0]); return; }
		const legs = group.reduce((acc, m) => mergeLegs(acc, m.rawLegs), []);
		const realTime = group[0].accountType === AccountKind.realTime;
		const mg = remeasure(legs, cycle, anchor, {country: o.country, realTime: realTime});
		const d = (mg.verdict.shape === Shape.lump || mg.verdict.shape === Shape.multiLump)
			? lumpDays(mg.buckets, mg.verdict.lumps) : [];
		gathered.push({
			label: 'everything else (' + group.length + ' payees)',
			key: '(gathered)',
			accountId: id,
			accountType: group[0].accountType,
			direction: group[0].direction,
			gathered: group.map(m => m.label),
			legs: legs.length,
			rawLegs: legs,
			shape: mg.verdict.shape,
			reason: mg.verdict.reason || null,
			days: d.map(x => x.day),
			wobble: d.map(x => x.wobble),
			dayEvents: d.map(x => x.events),
			typical: mg.verdict.typical === undefined ? null : mg.verdict.typical,
			predicted: predictedDays(d, mg.verdict.typical),
			confidence: mg.verdict.shape ? mg.fit : null,
			money: group.reduce((n, m) => n + m.money, 0),
			moneyShare: group.reduce((n, m) => n + m.moneyShare, 0),
			cyclesObserved: mg.buckets.length,
			adjusted: mg.snap,
			histogram: mg.bins
		});
	});

	return {modes: patterned.concat(gathered)};
}

/* ---- A STREAM IS A LIST OF MODES ----------------------------------------------------------------
   PROTOTYPE. The stage above answers one shape per account, and the portfolio kept saying that is
   the wrong shape of answer. "Utilities" is not a monthly lump - it is a water bill on the 4th, an
   electricity bill on the 18th, and two card top-ups nobody can predict. "Wages Julien" is a
   semimonthly payroll plus disability deposits. Forcing those into one verdict describes none of
   them, and the theory machinery was already doing the work of pulling them apart - it just had to
   throw the losers away to return a single answer.

   SO THE ANSWER BECOMES A LIST. One mode per payee, each with its own shape, its own days, its own
   confidence and its own share of the money. Some modes are predictable and some are not, and a
   stream is allowed to be both at once: three reliable bills and a tail of one-off spending is a
   completely ordinary stream and there is no single shape that is true of it.

   THE MONEY SHARE IS WHY THIS MATTERS FOR A FORECAST. A payee that is 4% of the money and completely
   unpredictable costs almost nothing to get wrong; one that is 60% and lands on the 2nd every month
   is most of what the forecast is. A single shape per stream hides which is which, and a list cannot.

   EACH MODE IS STILL TESTED THE SAME WAY, with the same theories - as recorded, or with the bank's
   closures undone - so nothing about how a shape is decided changes here. What changes is that every
   payee gets its own verdict instead of one payee's verdict standing in for the stream. */
const modeLabel = legs => {
	//the description the payee is most often written as: a name a person recognises
	const seen = {};
	(legs || []).forEach(l => {
		const d = String(l.description || '').trim();
		if(d)seen[d] = (seen[d] || 0) + 1;
	});
	const keys = Object.keys(seen);
	if(!keys.length)return '(no description)';
	return keys.sort((a, b) => seen[b] - seen[a] || (a < b ? -1 : 1))[0];
};

const absSum = legs => (legs || []).reduce((n, l) => n + Math.abs(l.amount || 0), 0);

export function streamModes(legs, partition, cycle, anchor, opts){
	const o = opts || {};
	const all = legs || [];
	const money = absSum(all);
	const yearly = !!cycle && !!YEARLY[cycle.name];
	const modes = [];

	(partition || []).forEach(alloc => {
		const onAccount = all.filter(l => l && l.accountId === alloc.accountId);
		if(!onAccount.length)return;
		const realTime = alloc.accountType === AccountKind.realTime;

		/* A PAYEE IS NOT A MODE UNTIL ITS DIRECTION IS SETTLED. Money in and money out under the same
		   name are two facts, and one cannot complete the other's cycle. */
		const groups = [];
		merchantGroups(onAccount).forEach(g => byDirection(g.legs).forEach(part => groups.push(
			{key: g.key + ' ' + part.direction, direction: part.direction, legs: part.legs})));

		groups.forEach(group => {
			const mine = group.legs;
			/* EVERY PAYEE IS A MODE, INCLUDING THE ONES TOO SMALL TO SHAPE. A payee with two
			   movements is not a pattern, and it is also not nothing - it is a share of the money
			   that arrives unpredictably, which is exactly what a forecast needs told. */
			let chosen = null, theories = [];
			if(cycle && !yearly){
				theories = shapeTheories(mine, cycle, anchor,
					{country: o.country, realTime: realTime, taper: o.taper})
					.filter(t => t.kind === 'all');
				const pick = chooseTheory(theories);
				chosen = pick ? pick.chosen : null;
			}

			let buckets = chosen ? chosen.buckets
				: (cycle ? cycleBuckets(mine, cycle, anchor, o.taper) : []);
			let bins = chosen ? chosen.bins : dayHistogram(buckets);
			let counts = chosen ? chosen.counts : buckets.map(b => b.legs.length);
			let verdict = yearly
				? {shape: null, reason: 'the cycle is still yearly after determination'}
				: (chosen ? chosen.verdict
					: classifyShape(counts, bins, null, weightsOf(buckets)));

			/* A HABIT WITH A LATE MONTH IS STILL THAT HABIT. The furthest movements are set aside
			   while that improves the fit, and they become the mode's own exceptions. */
			let exceptions = [];
			if(!yearly && cycle){
				const trimmed = patternWithExceptions(
					chosen ? chosen.legs : mine, cycle, anchor, null, o.taper);
				if(trimmed.trimmed){
					buckets = trimmed.result.buckets;
					bins = trimmed.result.bins;
					counts = trimmed.result.counts;
					verdict = trimmed.result.verdict;
					exceptions = trimmed.exceptions;
				}
			}
			const lumpy = verdict.shape === Shape.lump || verdict.shape === Shape.multiLump;
			const dd = lumpy ? lumpDays(buckets, verdict.lumps) : [];

			modes.push({
				label: modeLabel(mine),
				key: group.key,
				//kept so a mode can be put back together with another; not part of the answer
				rawLegs: mine,
				accountId: alloc.accountId,
				accountType: alloc.accountType || null,
				direction: group.direction,
				legs: mine.length,
				shape: verdict.shape,
				reason: verdict.reason || null,
				days: dd.map(d => d.day),
				wobble: dd.map(d => d.wobble),
				//how many movements chose each day, and which of them the forecast will name
				dayEvents: dd.map(d => d.events),
				typical: verdict.typical === undefined ? null : verdict.typical,
				predicted: predictedDays(dd, verdict.typical),
				confidence: verdict.shape
					? (verdict.fit === undefined || verdict.fit === null ? null : verdict.fit)
					: null,
				moneyShare: money ? absSum(mine) / money : 0,
				money: absSum(mine),
				cyclesObserved: buckets.length,
				adjusted: chosen ? chosen.snap : SNAP.none,
				exceptions: exceptions.length,
				histogram: bins
			});
		});
	});

	/* SPLITTING BY PAYEE CUTS TOO FINELY SOMETIMES, and the collapse puts back what belongs together
	   before anything is reported. */
	const collapsed = cycle && !yearly
		? collapseModes(modes, cycle, anchor, o).modes
		: modes;

	/* PREDICTABLE FIRST, THEN BY HOW MUCH MONEY RIDES ON THEM. A forecast is read from the top, and
	   what it most needs to be right about is the biggest thing it can actually predict. */
	const rank = m => (m.shape === Shape.lump ? 0 : m.shape === Shape.multiLump ? 1
		: m.shape === Shape.spread ? 2 : 3);
	collapsed.sort((a, b) => rank(a) - rank(b) || b.moneyShare - a.moneyShare);

	const predictable = collapsed.filter(m => !!m.shape);
	return {
		modes: collapsed,
		money: money,
		predictable: predictable.length,
		/* THE BASELINE IS WHAT IS LEFT: every payee with no pattern, taken together. It is not a
		   failure to be explained away - it is the part of the stream that genuinely arrives when it
		   arrives, and a forecast should carry it as a rate rather than as dates. */
		baseline: {
			modes: collapsed.length - predictable.length,
			legs: collapsed.filter(m => !m.shape).reduce((n, m) => n + m.legs, 0),
			moneyShare: collapsed.filter(m => !m.shape).reduce((n, m) => n + m.moneyShare, 0)
		},
		predictableShare: predictable.reduce((n, m) => n + m.moneyShare, 0)
	};
}

/* ---- THE ANSWER -------------------------------------------------------------------------------
   PER ALLOCATION: {accountId, shape, days?, confidence?}. `days` appears only for a lump or a set of
   lumps - a spread has no day to name, which is what makes it a spread - and `confidence` only
   where a shape was determined at all. An undetermined field is ABSENT, never a placeholder: a
   stream with no shape is not a shape with an empty day list.

   THE ANCHOR IS NOT CHOSEN HERE AND SHOULD NOT BE CHOSEN BY A CALLER EITHER. It is the module's one
   seam, settled once from the portfolio and the as-of date; StreamPredictor.shapeOf() is the entry
   point that supplies it, and this signature exists so the classifier can be tested in isolation. */
export function determineShape(legs, partition, cycle, anchor){
	return explainShape(legs, partition, cycle, anchor).map(e => {
		const out = {accountId: e.accountId, shape: e.shape};
		if(e.shape === Shape.lump || e.shape === Shape.multiLump)
			out.days = e.days.map(d => d.day);
		if(e.shape)out.confidence = e.confidence;
		return out;
	});
}
