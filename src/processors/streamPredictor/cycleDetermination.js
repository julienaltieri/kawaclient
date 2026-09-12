import { Period } from '../../Time';
import { explainCycle } from './cycleDecision';

/* ==================================================================================================
   THE DECISIONER. What cycle does this stream run on?

   Utilities billed to two services twice a month is a MONTHLY cycle carrying two events, not a
   semi-monthly one. How many events land inside one cycle is the SHAPE, and it is determined
   somewhere else; conflating the two is what makes a stream with two bills read as a stream with a
   two-week rhythm, and then predicts a bill on a fortnight the calendar has no month boundary in.

   ---- THREE LAYERS, AND EACH ONE KNOWS LESS THAN THE NEXT ------------------------------------------

     cycleFit.js          AN OBSERVER. Scores every candidate period against the legs, groups them by
                          merchant, counts how long the stream has been quiet. Chooses nothing, knows
                          no threshold, has never heard of a yearly stream.

     cycleDecision.js     READS THOSE OBSERVATIONS. Picks the shortest candidate over the bar, breaks
                          a merged/split disagreement, and applies the gates a yearly declaration
                          adds. Blocking lives here in full: a refused reading is simply not an
                          inference by the time it leaves.

     cycleDetermination   THIS FILE. Puts the declaration next to the inference and answers.

   ---- WHAT COMES BACK ------------------------------------------------------------------------------

     {declared, inferred?, confidence?}

   THREE KEYS, TWO OF THEM OPTIONAL, AND NOTHING ELSE. `declared` is a Period (null only for a
   malformed declaration). `inferred` is present ONLY when the ledger actually determined the answer,
   so the cycle to use is `inferred || declared` and there is no third field to get wrong.
   `confidence` travels with `inferred` and appears only beside it - a declaration standing is not a
   prediction that could be wrong, so scoring it would invite comparing it with one that could.

   A REFUSED READING IS ABSENT, NOT REPORTED AS SOMETHING. Cadeaux famille Mdm scores bimonthly at
   82.2%, and bimonthly is longer than a budget rhythm, so the decision is `{declared: yearly}` -
   not "bimonthly, blocked". The caller asked what cycle to use, and the answer is yearly.

   THE WORKING IS STILL THERE FOR ANYONE WHO WANTS IT. `explainCycle` returns everything: both
   readings, every candidate's score, the route, the merchant groups, what a gate refused. That is
   what the audit page draws and what a future experiment should read. It is deliberately a separate
   call, because a debug surface that rides along inside the answer becomes part of the contract the
   first time someone reads it.

   ---- WHEN THE LEDGER DECIDES ----------------------------------------------------------------------

     declared rhythm (weekly .. quarterly)   the declaration decides, always. It is a statement of
                                             fact by the person receiving the money, and transactions
                                             are noisy in ways a declaration is not: a cheque that
                                             lands on the 1st because the 29th was a Sunday, a month
                                             with a correction in it. `inferred` is absent even when
                                             the ledger agreed - it did not decide anything.

     yearly or biyearly                      the declaration is an envelope: an amount per year,
                                             silent about timing. The ledger decides where it has
                                             earned it, and `inferred` is present exactly there.

   THE LEDGER IS OPTIONAL. Called with no evidence - `determineCycle(stream)` - the answer is the
   declaration alone and `inferred` is absent, which is the same shape by construction.
   ================================================================================================== */

/* The nine period names a stream may declare, as an explicit allowlist. `Period` carries static
   members that are not periods (`periodName`, `longestPeriod`), so a raw `Period[name]` lookup would
   hand back a lookup table or a function for a malformed declaration instead of failing. */
const DECLARABLE = {daily: true, weekly: true, biweekly: true, semimonthly: true, monthly: true,
	bimonthly: true, quarterly: true, yearly: true, biyearly: true};

const YEARLY = {yearly: true, biyearly: true};

export const isYearlyDeclaration = periodName => !!YEARLY[periodName];

export const declaredCycleOf = periodName =>
	(periodName && DECLARABLE[periodName]) ? Period[periodName] : null;

/* An unknown or missing period is reported as `declared: null` and never thrown. A stream with a
   malformed declaration is a stream we cannot predict, not a reason to fail the whole portfolio's
   prediction pass.

   `evidence` is {legs, anchor, now, config}; omit it and no inference is attempted. */
export function determineCycle(streamNode, evidence){
	const stream = streamNode || {};
	const decision = {declared: declaredCycleOf(stream.period)};

	if(!evidence || !evidence.legs)return decision;
	if(!isYearlyDeclaration(stream.period))return decision;

	const full = explainCycle(stream, evidence.legs, evidence.anchor, evidence.now, evidence.config);
	if(!full.measured)return decision;

	decision.inferred = declaredCycleOf(full.period);
	decision.confidence = full.confidence.score;
	return decision;
}

/* THE CYCLE TO USE, so no caller has to remember which way round the two fields go. */
export const cycleOf = decision => (decision && (decision.inferred || decision.declared)) || null;

export default determineCycle;
