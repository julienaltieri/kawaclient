import { cycleBuckets } from './shapeDetermination';

/* ==================================================================================================
   HOW MUCH MOVES PER CYCLE, per account allocation - the declaration, reconciled against the ledger.

   THREE STEPS, AND THE ORDER IS THE ARGUMENT.

     WINDOW      Only the latest segment of `expAmountHistory` is read. A CHANGE TO THE DECLARATION
                 STARTS A NEW SEGMENT, and everything before its startDate is ignored - legs and
                 cycles alike. A rent that went from $2,400 to $3,121 in March has two levels, and a
                 median taken across the change describes neither of them; it is not a trend to be
                 extrapolated either, it is a step the user already told us about.

     BASE        The declaration, replaced by the median of the observed cycles ONLY where three or
                 more CONSECUTIVE cycles each carry a leg. Three because two cycles cannot show a
                 rhythm, and consecutive because a stream that fired in three months out of twelve is
                 not evidence about a typical month - the empty cycle in the middle is the fact that
                 disqualifies the run.

     CALIBRATION Where more than 70% of the segment's legs sit on ONE side of the base, the
                 declaration is out of calibration and the ledger is the better witness - BUT ONLY IF
                 THE MEDIAN AGREES WITH THAT DIRECTION. A median that disagrees means the legs and
                 the cycle totals are telling different stories, and the declaration stands rather
                 than being moved by half an argument:
                     declared $100/month, 80% of legs above, median $120  ->  $120  (median agrees)
                     declared $100/month, 80% of legs above, median  $90  ->  $100  (median disagrees)

   THE KNOWN WRINKLE, LEFT IN AND MADE VISIBLE: the direction test counts LEGS and the median is
   taken over CYCLES. For a stream with one leg per cycle those are the same population, so the
   agreement check is a formality that cannot block anything - if more than 70% of the values are
   above the base then their median is too. The check only does work on spread and multi-lump
   streams, where a leg is a fraction of a cycle. `evidence` carries both counts so this is readable
   off the output rather than rediscovered in the source.

   `confidence` is null: whether it is a number, a band or a label is still open, and a scale
   invented here would be believed.
   ================================================================================================== */

export const AmountSource = {declaration: 'declaration', median: 'median', calibrated: 'calibrated'};

/* Strictly greater than this share on one side of the base is what "out of calibration" means. */
export const CALIBRATION_THRESHOLD = 0.70;

/* Two cycles are a coincidence; three is the shortest run that can be a rhythm. */
export const MIN_CYCLES_FOR_MEDIAN = 3;

const median = xs => {
	if(!xs || !xs.length)return null;
	const a = xs.slice().sort((x, y) => x - y), m = Math.floor(a.length/2);
	return a.length % 2 ? a[m] : (a[m-1] + a[m])/2;
};

const nullResult = accountId => ({accountId: accountId, inferredAmount: null,
	amountDetermination: null, confidence: null,
	evidence: {segmentStart: null, declaredAmount: null, cycleTotals: [], consecutiveRun: 0,
		median: null, legsAbove: 0, legsBelow: 0, legCount: 0, directionShare: 0}});

/* THE ANCHOR IS PASSED IN, NEVER COMPUTED HERE, and it is the same one §3 was handed. §3 counts the
   events in a cycle and §4 totals the money in it; if the two phased their lattices differently they
   would be describing two different cycles while reporting on one stream. */
export function predictAmount(streamNode, legs, partition, cycle, anchor){
	const history = ((streamNode || {}).expAmountHistory) || [];

	/* NO DECLARED AMOUNT IS NOT A ZERO. A stream with no history has nothing to reconcile against and
	   nothing to reconcile from, so it reports that it could not decide rather than predicting $0 -
	   which downstream would read as "this stream is dormant", a different and unearned claim. */
	if(!history.length)return (partition || []).map(a => nullResult(a.accountId));

	const last = history[history.length - 1];
	const segmentStart = new Date(last.startDate);
	const declaredAmount = last.amount;
	const inSegment = (legs || []).filter(l =>
		l && l.date && new Date(l.date).getTime() >= segmentStart.getTime());

	return (partition || []).map(alloc => {
		const mine = inSegment.filter(l => l.accountId === alloc.accountId);
		const buckets = cycleBuckets(mine, cycle, anchor);
		//signed totals, on the same convention as the declared amount: an expense is negative on both
		const cycleTotals = buckets.map(b => b.legs.reduce((s, l) => s + (l.amount || 0), 0));

		/* THE LONGEST RUN OF NON-EMPTY CYCLES ENDING AT THE MOST RECENT ONE - how far back you get
		   before the first silent cycle, so a gap anywhere in the history cannot be stepped over to
		   reach older data that no longer describes the stream.

		   THE LAST BUCKET IS NO LONGER GUARANTEED TO CARRY A LEG. On the old newest-leg anchor it
		   always did, by construction; on the analysis lattice the newest cycle can be genuinely
		   silent, and a run of 0 then means the stream has stopped moving - which is the true reading
		   and the one that should fall through to the declared amount. */
		let consecutiveRun = 0;
		for(let i = buckets.length - 1; i >= 0; i--){
			if(!buckets[i].legs.length)break;
			consecutiveRun++;
		}
		const runTotals = cycleTotals.slice(cycleTotals.length - consecutiveRun);
		const med = median(runTotals);

		let inferredAmount = declaredAmount;
		let amountDetermination = AmountSource.declaration;
		if(consecutiveRun >= MIN_CYCLES_FOR_MEDIAN && med !== null){
			inferredAmount = med;
			amountDetermination = AmountSource.median;
		}

		/* EQUAL TO THE BASE IS NEITHER SIDE. A stream paid exactly what it declares is the case the
		   calibration test exists to leave alone, and counting those ties into either column would
		   push a perfectly calibrated stream over the threshold on rounding alone. */
		let legsAbove = 0, legsBelow = 0;
		mine.forEach(l => {
			if(l.amount > inferredAmount)legsAbove++;
			else if(l.amount < inferredAmount)legsBelow++;
		});
		const legCount = mine.length;
		const directionShare = legCount ? Math.max(legsAbove, legsBelow)/legCount : 0;

		if(legCount && directionShare > CALIBRATION_THRESHOLD && med !== null){
			const direction = legsAbove >= legsBelow ? 1 : -1;
			const medianAgrees = direction > 0 ? med > inferredAmount : med < inferredAmount;
			/* Relabelled only when the number actually moved. Where the base is already the median,
			   "the base moves to the median" is a no-op, and calling that a calibration would report
			   a correction that never happened. */
			if(medianAgrees){
				inferredAmount = med;
				amountDetermination = AmountSource.calibrated;
			}
		}

		return {
			accountId: alloc.accountId,
			inferredAmount: inferredAmount,
			amountDetermination: amountDetermination,
			confidence: null,
			evidence: {
				segmentStart: segmentStart,
				declaredAmount: declaredAmount,
				cycleTotals: cycleTotals,
				consecutiveRun: consecutiveRun,
				median: med,
				legsAbove: legsAbove,
				legsBelow: legsBelow,
				legCount: legCount,
				directionShare: directionShare
			}
		};
	});
}
