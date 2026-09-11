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

export const Shape = {lump: 'lump', spread: 'spread', multiLump: 'multiLump'};

/* The most events a cycle can carry and still be a set of discrete lumps rather than a flow. Named
   rather than inlined because it is the one number in this stage that is a judgement call. */
export const SHAPE_MULTI_LUMP_MAX = 4;

const YEARLY = {yearly: true, biyearly: true};

/* A stream with a weekly cycle and a decade of history is ~520 buckets; the cap is far above any
   real history and exists so a malformed date cannot spin the walk forever. */
const MAX_CYCLES = 5000;

const median = xs => {
	if(!xs || !xs.length)return null;
	const a = xs.slice().sort((x, y) => x - y), m = Math.floor(a.length/2);
	return a.length % 2 ? a[m] : (a[m-1] + a[m])/2;
};

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

/* THE OPEN QUESTION, stated in the shape of an answer so a caller cannot mistake it for one.
   A spread is the exception the spec names: for a spread the shape IS the pattern, so there is no
   day left to determine and it resolves with no days rather than with an unanswered question. */
const OPEN_PATTERN = {resolved: false, reason: 'day-of-cycle determination is an open question'};
const SPREAD_PATTERN = {resolved: true, days: null};

/* CLASSIFIED ON THE MEDIAN, not the mean: one December with four extra charges must not turn a
   monthly lump into a multi-lump for the whole history.

   The spec names three points - 1, 2..SHAPE_MULTI_LUMP_MAX, and above it - and an even number of
   observed cycles can put the median between two of them. A fractional median is placed by the
   INTERVAL it falls in rather than rounded, because rounding makes 1.5 flip between lump and
   multiLump on the parity of the cycle count, which is not a fact about the stream. */
function classify(med){
	if(med === null || med <= 0)return null;
	if(med < 2)return Shape.lump;
	if(med <= SHAPE_MULTI_LUMP_MAX)return Shape.multiLump;
	return Shape.spread;
}

/* THE ANCHOR IS PASSED IN, NEVER COMPUTED HERE. §3 and §4 must bucket the same legs on the same
   lattice, so there is one anchor - StreamPredictor.analysisAnchor() - and every stage is handed it.
   A second computation of "the analysis root date" is a second source of truth for a seam. */
export function determineShape(legs, partition, cycle, anchor){
	const yearly = !!cycle && !!YEARLY[cycle.name];
	return (partition || []).map(alloc => {
		const mine = (legs || []).filter(l => l && l.accountId === alloc.accountId);
		const buckets = cycleBuckets(mine, cycle, anchor);
		const eventsPerCycle = buckets.map(b => b.legs.length);
		const med = median(eventsPerCycle);
		//a yearly cycle is not this stage's to shape - the evidence is still gathered, so whatever
		//eventually handles yearly inherits the counts rather than recomputing them
		const shape = yearly ? null : classify(med);
		return {
			accountId: alloc.accountId,
			shape: shape,
			pattern: shape === Shape.spread ? SPREAD_PATTERN : OPEN_PATTERN,
			confidence: null,
			evidence: {
				cyclesObserved: buckets.length,
				eventsPerCycle: eventsPerCycle,
				medianEventsPerCycle: med
			}
		};
	});
}
