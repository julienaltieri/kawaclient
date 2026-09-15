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

	   DIVIDED BY THE DAY CONFIDENCE, so a mode whose date already wanders is allowed to wander
	   further before it is called dead. A metronome 40% late has stopped; a payment that never kept
	   a day is just being itself. Gembah keeps its day to 90% and must pass 1.11; Earnin's
	   reimbursement keeps its day to 65% and must pass 1.54.

	   MEASURED ACROSS THE PORTFOLIO: Gembah is 43 days past a payment that has never taken more than
	   31, a ratio of 1.39, and it is the only mode above its own tolerance. The reimbursement is the
	   only other one above 1.0 at all, at 1.06, and the scaling is what keeps it alive.

	   A SUSPICION, NOT A CONCLUSION. The mode keeps its history, its money share and its identity; it
	   stops promising. A stream that resumes is visibly the same stream.

	   ONLY A PLAN CAN RUN OUT, AND THAT IS THE WHOLE OF THE DIFFERENCE BETWEEN THE TWO CASES THIS
	   GATE HAS TO TELL APART. Gembah is a fixed sum being paid down: a payment that does not arrive
	   is evidence the sum is finished, because there was always going to be a last one. Julien's
	   savings transfer has nothing to finish - money moved into savings is not spent - so a month it
	   skipped is a month it skipped, and the stream is exactly as alive as it was. The envelope
	   already carries that distinction: a yearly declaration is a PLAN, a cycle declaration REFILLS.

	   SO THE STRICT BAR IS FOR PLANS ONLY, and an open-ended stream is judged against the same
	   standard a rate is: one missed cycle is an ordinary late payment, two is a habit that stopped.
	   At 1.6 a monthly lump that keeps its day to 0.9 survives to 1.78 of its worst wait - about two
	   missed dates - which is `maxQuietCycles` said in the units a lump is measured in. */
	lateMultiple: 1.0,
	lateMultipleOpenEnded: 1.6,

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
	plannedWithinPeriods: 1,

	/* ---- WHEN A YEARLY ENVELOPE IS SPENT STEADILY ENOUGH TO CARRY A RATE --------------------------
	   THE LAST RESCUE, AND THE ONLY THREE NUMBERS IT TAKES. A yearly stream predicts nothing unless
	   it moved money in nearly every month, often enough to be a habit, with no single month carrying
	   most of the year.

	   MEASURED ON THE CAPTURED PORTFOLIO, and the gap between the two groups is wide:

	       Eléonore              69 legs  12 months  biggest month 30%
	       Emile                 54       12                       21%
	       Cadeaux Mr & Mdm      25       11                       31%
	       Exceptional Expense   36       11                       28%
	       Repair/replacements   36       10                       26%
	       Equipment             35       10                       26%
	       Hobby mr              32        9                       25%
	       ---------------------------------------------- the line
	       Cadeaux famille Mdm   15        6                       27%
	       Voyages               78        5                       48%
	       Voyages Famille       29        4                       77%
	       Ahsoka                 5        4                       95%
	       DMV fee                8        3                       99%

	   VOYAGES HAS MORE MOVEMENTS THAN ELÉONORE and is a holiday rather than a habit; months touched
	   is what tells them apart, and the biggest-month share is what catches a burst that happens to
	   be spread over enough months. A stream that nets to zero - a reimbursement - produces a share
	   above 100% and is refused by the same test, which is right: there is no rate in a year that
	   sums to nothing. */
	rescueMinMonthShare: 0.75,
	rescueMinMovements: 12,
	rescueMaxMonthShare: 0.50
};

export default AMOUNT_CONFIG;
