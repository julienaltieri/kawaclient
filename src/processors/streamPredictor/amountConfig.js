/* ==================================================================================================
   §4 SETTINGS — WHAT A PREDICTION IS ALLOWED TO CLAIM.  PROTOTYPE.

   §3's settings decide what the money DID. These decide what to carry forward from it, which is a
   different question and answered by different numbers: a reading can be perfectly true about the
   past and still be the wrong thing to promise about next month.
   ================================================================================================== */

export const AMOUNT_CONFIG = {
	/* ---- WHEN A RATE HAS STOPPED RATHER THAN SLOWED ------------------------------------------------
	   THE TAPER MODELS DECAY OF RELEVANCE. IT CANNOT MODEL CESSATION. Old cycles are worth less every
	   half-life and never worth nothing, so a mode that has genuinely ended still claims a fraction of
	   what it used to move, forever. Julien's California disability deposits are the case: three
	   payments in the first two cycles of seventeen and nothing since, because the paternity leave
	   ended. The taper took the claim from $830.59 a cycle to $191.46 - a real reduction, and still a
	   prediction that money will arrive which will not.

	   SO SILENCE IS ITS OWN SIGNAL, and two cycles of it is enough. A rate quiet this long predicts
	   ZERO: it keeps its history, its money share and its place in the record, and claims nothing
	   forward. A mode that resumes is visibly the same mode rather than a new one.

	   MEASURED: at 2 the portfolio silences eight rates and removes $473.04 of claimed money a cycle.
	   Two of those eight have survived an internal gap of two cycles before - Hobby mdm's card tail and
	   Gembah's remainder - so the rule does cost something; at 3 it would cost nothing and let the
	   disability deposits go on claiming through four more cycles of silence. Two cycles is the signal
	   Julien reads, so two cycles is the rule.

	   A LUMP IS NOT SILENCED BY THIS. Its own confidence already carries how often it turns up - the
	   share of cycles it filled is half of that number - and a bill that skipped two months is a bill
	   with a low confidence, not a bill that has stopped. */
	maxQuietCycles: 2,

	/* ---- HOW FAR PAST A FINITE PLAN A FORECAST MAY PUSH A STREAM -----------------------------------
	   A YEARLY DECLARATION IS A PLAN AND A PLAN CAN BE SPENT. Gembah was roughly $10,000 paid in four
	   installments of $2,626; there was never a fifth, and the stream had already spent $11,299 by the
	   time one would have been due. Predicting it would have been wrong in a way the ledger could
	   already see.

	   THE TEST IS FORWARD-LOOKING AND AT STREAM LEVEL. Spend-to-date is not enough - Gembah sits at
	   113%, inside any sane band - but a fifth payment takes it to 139% and that is the question worth
	   asking. And a yearly declaration is a plan for the WHOLE stream: its modes are how the plan gets
	   paid, and none of them carries the plan alone.

	   A REFUSED MOVEMENT PREDICTS ZERO, NEVER THE REMAINING ENVELOPE. Capping Gembah's payment at the
	   $1,299 left would invent a payment of a size that never occurs - and worse, the remainder would
	   then be compressed into however many cycles remain in the year, inflating every later prediction
	   until the envelope was used up.

	   UNTUNED, DELIBERATELY. Gembah projects to 139%, which clears any value from 10% to 30%, so this
	   portfolio cannot tell those apart. The number wants a near case before it is settled. */
	budgetBand: 0.15,

	/* ---- WHEN A LUMP HAS WAITED LONGER THAN IT EVER HAS ---------------------------------------------
	   MULTIPLES OF A MODE'S OWN WORST OBSERVED GAP. Not of its wobble - wobble is deviation around the
	   claimed day INSIDE a cycle, and the question here is the gap BETWEEN cycles. That was the first
	   yardstick tried and it caught nothing, including the one stream that had plainly stopped.

	   MEASURED ACROSS THE PORTFOLIO: Gembah is 43 days past a payment that has never taken more than
	   31, a ratio of 1.43. The next highest mode in the portfolio sits at 0.91 of its own worst gap.
	   At 1.0 exactly one mode qualifies and there is nothing within 9% of the line, which is the kind
	   of margin that survives new data.

	   A SUSPICION, NOT A CONCLUSION. The mode keeps its history, its money share and its identity; it
	   stops promising. A stream that resumes is visibly the same stream. */
	lateMultiple: 1.0,

	/* ---- THE SIGNATURE OF A PLANNED STREAM BEGINNING ------------------------------------------------
	   A DECLARATION IS EVIDENCE, NOT ONLY A CONSTRAINT. It is written BEFORE the money moves, so when
	   the first movement arrives at exactly the declared amount that is two independent sources saying
	   the same thing - and the second one could not have been fitted to the first.

	   Day Care Eleonore is the case: declared -$2,400 a month on the 23rd of July with nothing behind
	   it, first cheque -$2,400 on the 12th of August, second -$2,400 on the 4th of September. The
	   evidence gate refuses it - two cycles is below minCyclesObserved and always will be for a stream
	   three weeks old - and refusing it means answering "we know nothing" about a stream whose owner
	   told us the number and whose ledger has agreed twice.

	   THE AMOUNT BAND IS TIGHT ON PURPOSE. At 2% the portfolio admits exactly the streams that were
	   declared and then paid as declared - Day Care Eleonore, Day care Emile, Car insurance at $98.76
	   of $99, Phone at $61.18 of $62, Rent. Loosening it pulls in modes that are a SHARE of a stream
	   rather than the whole of it, and a share cannot be corroborated by a total. */
	plannedAmountBand: 0.02,

	/* AND THE DECLARATION HAS TO BE ADJACENT TO THAT FIRST MOVEMENT, within this many declared
	   periods. Ten streams match on amount alone; only five have the declaration next to the money.
	   The other five are old declarations that a dormant stream happened to resume against - Earnin's
	   $50 written in 2021 and first paid in 2025, Sport's $100 written in 2023 and first paid in 2026
	   - and a coincidence four years wide is not the beginning of a plan. */
	plannedWithinPeriods: 1
};

export default AMOUNT_CONFIG;
