/* ==================================================================================================
   THE THREE NUMBERS §3 IS TUNED ON.

   THEY LIVE HERE FOR THE SAME REASON §2's LIVE IN fitConfig.js: each is a judgement that was made by
   looking at what it does to the real portfolio, and a number chosen that way has to keep its
   working next to it. Written into the middle of the classifier it becomes folklore, and the next
   person to ask whether it is still right has to redo the measurement to find out.
   ================================================================================================== */

export const SHAPE_CONFIG = {

	/* HOW OFTEN THE PER-CYCLE COUNT HAS TO REPEAT EXACTLY before that count is treated as a fact
	   about the stream rather than the middle of a mess.

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

	/* THE FEWEST CYCLES THAT CAN SHOW A REPEAT. One cycle makes its own count the commonest and
	   scores 100% steady by construction: Date had three movements in a single month and claimed
	   three lumps at full confidence, which is one month of history wearing the clothes of a
	   pattern. Two cycles agreeing is a coincidence; three is the fewest that can disagree. */
	minCyclesObserved: 3
};

export default SHAPE_CONFIG;
