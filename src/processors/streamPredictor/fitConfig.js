/* ==================================================================================================
   THE FOUR NUMBERS THE CYCLE DETECTOR IS TUNED ON, and the only four.

   THEY LIVE HERE BECAUSE THEY WERE CHOSEN BY MEASUREMENT AND CAN BE RE-CHOSEN THE SAME WAY. Every
   one of them was moved across its range on the audit page against 25 streams whose declared period
   is known-good, and the value below is where the cohort read best. A number chosen that way has to
   stay legible as a number: written into the middle of the scorer it becomes folklore, and the next
   person to ask "why 0.75?" has to re-derive the whole sweep to find out.

   THE ALGORITHM ITSELF IS NO LONGER A SETTING. The variants, the tolerance rule, and the four ways
   of breaking a merged/split disagreement all existed to be compared, the comparison was run, and
   the answer is the code in cycleFit.js and cycleDecision.js. What survives here is the arithmetic,
   not the choice of arithmetic.

   THE AUDIT PAGE STILL MOVES THESE THREE LIVE - threshold, minLegsToClaim, minGroupLegs - because
   they are the ones a new portfolio could argue with. trimBuckets is fixed because it is part of the
   score's definition rather than a gate on it.
   ================================================================================================== */

export const FIT_CONFIG = {

	/* HOW WELL A CANDIDATE MUST FIT TO BE CLAIMED AT ALL, as a fit in [0,1] where 1 repeats exactly.
	   The pick is the SHORTEST candidate over this bar, never the best-scoring one - see bestFit.

	   MEASURED OVER THE 25 KNOWN-GOOD STREAMS. At 0.85 the rule claims 7 and gets 7 right, which is
	   safe and nearly silent. At 0.75 it claims 12 and gets 12 right. Below 0.60 the wrong claims
	   arrive in a block and they are all TOO SHORT - Rent, Phone, Utilities, Internet and Plaid all
	   go semimonthly - so the bar sits at the last value where every claim the rule makes is true. */
	fitThreshold: 0.75,

	/* HOW MANY BUCKETS THE SCORE MAY DISCARD BEFORE JUDGING THE REST. A stream that kept its rhythm
	   except for one doubled month should read as the rhythm it kept; two is what covers the
	   real irregularities in this portfolio without letting the trim manufacture a fit.

	   IT CANNOT INVENT ONE. The trim only ever drops a bucket that actually deviates from the
	   median, so a candidate whose counts are already flat scores identically at every trim -
	   Earnin bimonthly is 79.6% at 0, 1 and 2. */
	trimBuckets: 2,

	/* THE FEWEST TRANSACTIONS IN THE WINDOW THAT MAY SUPPORT A CLAIM. Three points give two
	   intervals; the gate is low because the window is already only one reporting year, and raising
	   it silences streams that genuinely moved a handful of times. */
	minLegsToClaim: 3,

	/* ---- THE TWO THAT APPLY ONLY TO A YEARLY DECLARATION -------------------------------------------
	   A YEARLY STREAM MAY ONLY MOVE TO A RHYTHM SOMEONE WOULD ACTUALLY RUN. The declaration states an
	   amount per year and nothing about timing, so anything the ledger says is an inference - and an
	   inference that a budget envelope is "quarterly" or "semimonthly" is describing an accident of
	   when the money happened to be spent. Monthly is the typical arrangement; biweekly and weekly
	   are the two faster ones that are really lived. Anything else leaves the stream yearly.

	   BIMONTHLY AND QUARTERLY ARE LEFT OUT ON PURPOSE, and the reason is evidence rather than taste.
	   Julien: they are extremely rare in this portfolio - quarterly would be tax, bimonthly would be
	   certain bills - and over a single reporting year they carry too few cycles to be confident
	   about. Six bimonthly cycles or four quarterly ones is not enough to overrule a declaration, so
	   a reading at those periods is noise being promoted to a prediction.

	   THIS GATE IS NOT APPLIED TO A DECLARED RHYTHM. A stream declared monthly that reads quarterly
	   is a disagreement worth seeing; a yearly envelope that reads quarterly is noise. */
	yearlyAllowedPeriods: ['weekly', 'biweekly', 'monthly'],

	/* AND THE PATTERN HAS TO STILL BE RUNNING. A rhythm that showed itself in January and has been
	   silent since is not this stream's frequency, it is a burst that has ended - Medical read
	   biweekly off four legs, all of them early in the year, with nothing since. Counted in whole
	   cycles OF THE DETECTED PERIOD between the last transaction and the capture date, on the same
	   lattice everything else is scored on: more than this many complete empty cycles and the stream
	   stays yearly.

	   TWO, because one empty cycle is an ordinary late payment and three is a habit that stopped. */
	maxEmptyCyclesToStayActive: 2,

	/* HOW MUCH OF THE STREAM THE SPLIT READING HAS TO ACTUALLY SCORE. fitTableSplit combines the
	   merchant groups that are SCORABLE at a given candidate and skips the rest, which is right -
	   a one-leg merchant says nothing about the period and must not be counted as fitting badly -
	   but it degenerates when almost every group is skipped. Exceptional Expense splits into 11
	   groups, nine of them one leg; on weekly exactly one group is scorable, so the combined "split"
	   score was that group's own score, from 2 legs of 20, reported as a confident 96.7%.

	   BELOW THIS SHARE THE SPLIT READING IS UNSCORABLE, not a number. The bar is just under a
	   quarter because a stream that is genuinely four subscriptions is plausible: if only one of the
	   four is scorable, 25% of the legs are behind the answer and that is still worth reporting.
	   Two legs of twenty is not. */
	minSplitLegShare: 0.24,

	/* THE FEWEST LEGS A MERCHANT GROUP MAY CARRY FOR THE SPLIT READING TO BE ALLOWED TO WIN. Renter's
	   insurance splits 6/2 because the bank wrote the same payee two ways; a 2-leg fragment fits any
	   period trivially, so a split containing one is not evidence and the merged reading stands. */
	minGroupLegs: 3
};

export default FIT_CONFIG;
