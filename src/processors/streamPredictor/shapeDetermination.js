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
export function cycleBuckets(legs, cycle, anchor){
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
	buckets.forEach(b => b.legs.forEach(l => {
		const d = dayInCycle(l, b);
		if(d >= 0 && d < bins.length)bins[d]++;
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
const middleOf = xs => {
	if(!xs.length)return null;
	const a = xs.slice().sort((x, y) => x - y);
	const m = Math.floor(a.length / 2);
	return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

//how far a group's days sit from its own middle day, typically - the wobble the reader sees
const wobbleOf = (xs, mid) => xs.length
	? Math.round(middleOf(xs.map(x => Math.abs(x - mid))))
	: 0;

export function lumpDays(buckets, n){
	const days = [];
	buckets.forEach(b => b.legs.forEach(l => days.push(dayInCycle(l, b))));
	if(!days.length)return [];
	days.sort((a, b) => a - b);

	//the n-1 biggest gaps between consecutive days are where the groups are cut
	const cuts = [];
	for(let i = 1; i < days.length; i++)cuts.push({at: i, gap: days[i] - days[i - 1]});
	cuts.sort((a, b) => b.gap - a.gap || a.at - b.at);
	const edges = cuts.slice(0, Math.max(0, n - 1)).map(c => c.at).sort((a, b) => a - b);

	const groups = [];
	let from = 0;
	edges.concat([days.length]).forEach(to => {
		if(to > from)groups.push(days.slice(from, to));
		from = to;
	});
	return groups.map(g => {
		const mid = middleOf(g);
		return {day: mid, wobble: wobbleOf(g, mid), events: g.length};
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
export function focusOf(bins, cfg){
	const c = Object.assign({}, SHAPE_CONFIG, cfg || {});
	const at = [];
	for(let k = 1; k <= c.maxLumps; k++)at.push(concentration(bins, k));
	for(let k = 1; k <= c.maxLumps; k++)
		if(at[k - 1] !== null && at[k - 1] >= c.minConcentration)
			return {lumps: k, concentration: at[k - 1], perLump: at};
	return {lumps: 0, concentration: at[0], perLump: at};
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

export function classifyShape(counts, bins, cfg){
	const c = Object.assign({}, SHAPE_CONFIG, cfg || {});
	if(!counts.length)return {shape: null, reason: 'no cycles'};

	const placed = counts.reduce((n, x) => n + x, 0);
	if(!placed)return {shape: null, reason: 'no movements on this account'};
	if(counts.length < c.minCyclesObserved)
		return {shape: null, reason: 'only ' + counts.length + ' cycle'
			+ (counts.length === 1 ? '' : 's') + ' observed'};
	if(placed < c.minMovements)
		return {shape: null, reason: 'only ' + placed + ' movement'
			+ (placed === 1 ? '' : 's') + ' to read'};

	const typical = commonest(counts);
	const steady = counts.filter(x => x === typical).length / counts.length;
	const busy = counts.filter(x => x > 0).length / counts.length;
	const focus = focusOf(bins || [], c);
	const base = {typical: typical, steady: steady, busy: busy,
		concentration: focus.concentration, lumps: focus.lumps, perLump: focus.perLump};

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
export function explainShape(legs, partition, cycle, anchor){
	const yearly = !!cycle && !!YEARLY[cycle.name];
	return (partition || []).map(alloc => {
		const mine = (legs || []).filter(l => l && l.accountId === alloc.accountId);
		const buckets = cycle ? cycleBuckets(mine, cycle, anchor) : [];
		const counts = buckets.map(b => b.legs.length);
		const bins = dayHistogram(buckets);
		const verdict = yearly
			? {shape: null, reason: 'the cycle is still yearly after determination'}
			: classifyShape(counts, bins);
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
			cyclesObserved: buckets.length,
			eventsPerCycle: counts,
			typicalEventsPerCycle: verdict.typical === undefined ? null : verdict.typical,
			steadyShare: verdict.steady === undefined ? null : verdict.steady,
			busyShare: verdict.busy === undefined ? null : verdict.busy,
			histogram: bins
		};
	});
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
