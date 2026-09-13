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
	maxQuietCycles: 2
};

export default AMOUNT_CONFIG;
