/* ==================================================================================================
   THE THREE NUMBERS §3 IS TUNED ON.

   THEY LIVE HERE FOR THE SAME REASON §2's LIVE IN fitConfig.js: each is a judgement that was made by
   looking at what it does to the real portfolio, and a number chosen that way has to keep its
   working next to it. Written into the middle of the classifier it becomes folklore, and the next
   person to ask whether it is still right has to redo the measurement to find out.
   ================================================================================================== */

export const SHAPE_CONFIG = {

	/* HOW SHARP THE FOCUS HAS TO BE before the movements count as landing on a day rather than
	   anywhere in the cycle. Concentration runs 0 to 1: 1 is every movement on the same day, 0 is
	   evenly smeared round the whole cycle.

	   MEASURED OVER THE CAPTURED PORTFOLIO. The streams a person would call lumps sit at the top and
	   the gap below them is wide:

	       Internet          6x4 7x3 8x2                      0.99
	       Car insurance     1x7 2x1 4x1                      0.98
	       Rent              8x1 10x1 11x5 12x2               0.97
	       Utilities         9x1 10x1 11x3 12x2 13x1 14x1     0.96
	       Day care Emile    12x1 14x1 15x2 16x1 17x2 18x1    0.90
	       Wages Julien      4x1 6x6 7x2 8x8 10x1 12x2        0.76
	       ------------------------------------------------------- the bar
	       Day Care Eleonore 13x1 21x1                        0.69
	       Earnin phone      15x1 16x1 17x1 18x1 19x1 23x1... 0.58
	       Plaid             13x1 14x1 16x1 ... 21x1 25x1     0.57
	       Business Expenses 6x3 8x1 15x1 16x1 17x2 29x3      0.15
	       Groceries         0x16 1x18 2x26 3x21 4x23 5x32    0.11

	   Earnin phone arrives exactly once a month and the old rule called it a perfect lump for that
	   reason; it lands anywhere in a two-week window, which is not a day and should not be predicted
	   as one. */
	minConcentration: 0.75,

	/* HOW MUCH TIGHTER A WEEKEND ADJUSTMENT HAS TO MAKE A STREAM before it is believed, and by how
	   much it has to beat the other direction. Both are needed. The first stops a rounding difference
	   being read as a bank rule; the second is the "clearly" test - if pulling back and pushing
	   forward tighten the stream about equally, neither is the arrangement, they are both just
	   moving a few dates around and one happened to win.

	   MEASURED: over the captured portfolio, adjusting a real-time account tightens it by 12.6% on
	   average and adjusting a card account - which has no bank rule at all and is the control group -
	   by 2.4%. A bar of 10% keeps the real effects and drops what best-of-three gives away free. */
	minSnapGain: 0.10,
	minSnapMargin: 0.05,

	/* HOW MANY LUMPS TO LOOK FOR before giving up and calling it a spread. Two clusters half a cycle
	   apart are invisible to a single-cluster measurement - they cancel - so the cycle is wrapped
	   twice, then three times, then four, and the first wrapping that brings the movements into focus
	   says how many lumps there are. Beyond four the shape is a flow whatever the arithmetic says. */
	maxLumps: 4,

	/* HOW OFTEN THE PER-CYCLE COUNT HAS TO REPEAT EXACTLY. No longer decides the shape - concentration
	   does - but it is still reported as evidence, and it is what tells a stream that moves twice
	   every cycle from one that moves twice on average.

	   MEASURED OVER THE CAPTURED PORTFOLIO, and the gap it sits in is wide and empty:

	       Rent          1 1 1 1 1 1 1 1 1                     100%
	       Day care      1 1 1 1 1 1 1 1 1                     100%
	       Utilities     2 2 2 2 2 2 2 2 2                     100%
	       Phone         1 1 1 1 1 1 1 1 1                     100%
	       Wages Julien  1 1 1 3 2 1 1 1 1 1 ...                88%
	       ------------------------------------------------ the cliff
	       Groceries     4 10 1 5 5 6 8 3 6 0 7 2 3 ...        24%
	       Savings       4 6 4 2 0 2 1                          29%
	       Hobby mdm     1 0 0 2 2 1 1                          43%

	   Nothing in this portfolio lands between 43% and 88%, so the value is set in the middle of the
	   empty band rather than tight against either side of it. */
	minSteadyShare: 0.65,

	/* HOW OFTEN A CYCLE HAS TO CARRY ANYTHING AT ALL for an unsteady stream to count as a flow rather
	   than as noise. Groceries has 4 to 10 transactions in nearly every week and no cycle rhythm at
	   all - that is a spread, and it is a real answer. A stream that is unsteady AND frequently empty
	   is not a shape, it is an irregularity, and it gets no shape rather than the nearest one. */
	minBusyShare: 0.8,

	/* AND A FLOW HAS TO BE BUSY WHILE IT RUNS. Savings is non-empty in 6 of 7 months but carries a
	   fading 4, 6, 4, 2, 0, 2, 1 - present, but not a flow. Requiring more than one movement in the
	   typical cycle separates a spread from a stream that simply moves once in a while and is bad at
	   it. */
	minSpreadEventsPerCycle: 2,

	/* THE FEWEST MOVEMENTS THAT CAN BE IN FOCUS. Two points on the same day are perfectly
	   concentrated by construction and so are three - there is nothing for them to disagree with.
	   Groceries on one old card had two movements, both on day 1, and read as a lump at 1.00; Tolls
	   had three and claimed two lumps. Four is the fewest that can be out of focus, which is the
	   same reason §2 wants four transactions before it will name a period. */
	minMovements: 4,

	/* THE FEWEST CYCLES THAT CAN SHOW A REPEAT. One cycle makes its own count the commonest and
	   scores 100% steady by construction: Date had three movements in a single month and claimed
	   three lumps at full confidence, which is one month of history wearing the clothes of a
	   pattern. Two cycles agreeing is a coincidence; three is the fewest that can disagree. */
	minCyclesObserved: 3
};

export default SHAPE_CONFIG;
