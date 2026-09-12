import { Period } from '../../Time';
import { resolveCycle, confidenceOf } from './cycleDecision';

/* ==================================================================================================
   HOW OFTEN THE STREAM'S PATTERN RESETS - which is not how often money moves.

   Utilities billed to two services twice a month is a MONTHLY cycle carrying two events, not a
   semi-monthly one. How many events land inside one cycle is the SHAPE, and it is determined
   somewhere else; conflating the two is what makes a stream with two bills read as a stream with a
   two-week rhythm, and then predicts a bill on a fortnight the calendar has no month boundary in.

   THE DECLARATION STILL DECIDES FOR A DECLARED RHYTHM. The period is a statement of fact by the
   person who receives the money, and transactions are noisy in ways a declaration is not: a cheque
   that lands on the 1st because the 29th was a Sunday, a month with a correction in it. No amount of
   inference beats being told.

   BUT THE LEDGER IS NOW READ ANYWAY, ON EVERY STREAM, AND REPORTED ALONGSIDE. The detector used to
   run only where the declaration was useless. Running it everywhere costs one pass and buys the one
   thing a prediction experiment needs: the declared answer and the inferred answer, on the same
   object, for every stream - so a future predictor can be tried against either without re-deriving
   which streams had an inference available.

   WHICH OF THE TWO IS THE ANSWER DEPENDS ON THE DECLARATION, and that is the whole of the rule:

     declared rhythm (weekly .. quarterly)  ->  the declaration decides, always. `inferred` is
                                                reported and never consulted. A disagreement is a
                                                finding for a person to look at, not an override.

     yearly or biyearly                     ->  the declaration is an envelope and says nothing about
                                                timing, so the ledger decides where it has earned it.
                                                cycleDecision applies the gates: no longer than
                                                monthly, still running, both readings agreeing.

   THE LEDGER IS OPTIONAL. Called with no evidence - `determineCycle(stream)` - this behaves exactly
   as it always did: declaration only, `inferred: null`. The cycle audit page calls it that way and
   is untouched.
   ================================================================================================== */

export const CycleSource = {declaration: 'declaration', ledger: 'ledger'};

/* The nine period names a stream may declare, as an explicit allowlist. `Period` carries static
   members that are not periods (`periodName`, `longestPeriod`), so a raw `Period[name]` lookup would
   hand back a lookup table or a function for a malformed declaration instead of failing. */
const DECLARABLE = {daily: true, weekly: true, biweekly: true, semimonthly: true, monthly: true,
	bimonthly: true, quarterly: true, yearly: true, biyearly: true};

const YEARLY = {yearly: true, biyearly: true};

const named = periodName => (periodName && DECLARABLE[periodName]) ? Period[periodName] : null;

/* WHAT THE LEDGER SAID, IN THE SAME SHAPE WHATEVER IT SAID. `period` is null when the detector
   declined - too few legs, one-sided reading, a gate - and `route` always says which of those it
   was, so a caller never has to guess why an inference is missing. */
const inferenceOf = decision => ({
	period: decision.measured ? decision.period : null,
	cycle: decision.measured ? named(decision.period) : null,
	fit: (decision.measured && decision.misfit !== null && decision.misfit !== undefined)
		? 1 - decision.misfit : null,
	route: decision.route,
	//provisional, and derived only from the route - see Still open #3 in the spec
	confidence: confidenceOf(decision).level,
	//both readings, so an audit can see what the rule was looking at rather than only its verdict
	merged: decision.merged ? {period: decision.merged.period, fit: 1 - decision.merged.misfit} : null,
	split: decision.split ? {period: decision.split.period, fit: 1 - decision.split.misfit} : null,
	windowLegs: decision.evidence.windowLegs,
	totalLegs: decision.evidence.legs,
	merchantGroups: decision.evidence.groups,
	//the answer the gates would have blocked, kept so a blocked reading is still legible
	blocked: (decision.route === 'atypical' || decision.route === 'stale')
		? (decision.merged ? decision.merged.period : null) : null
});

/* An unknown or missing period is reported as an unknown period - `cycle: null` with the raw string
   kept for display - and never thrown. A stream with a malformed declaration is a stream we cannot
   predict, not a reason to fail the whole portfolio's prediction pass.

   `evidence` is {legs, anchor, now, config}; omit it and no inference is attempted. */
export function determineCycle(streamNode, evidence){
	const stream = streamNode || {};
	const periodName = stream.period;
	const known = !!periodName && !!DECLARABLE[periodName];
	const isYearly = known && !!YEARLY[periodName];
	const declaredCycle = known ? Period[periodName] : null;

	const declared = {
		period: known ? periodName : null,
		cycle: declaredCycle,
		isYearly: isYearly,
		raw: periodName === undefined ? null : periodName
	};

	let inferred = null, decision = null;
	if(evidence && evidence.legs){
		decision = resolveCycle(stream, evidence.legs, evidence.anchor, evidence.now, evidence.config);
		inferred = inferenceOf(decision);
	}

	/* THE ANSWER. A yearly stream takes the ledger's word where the gates let it through; everything
	   else takes the declaration, whatever the ledger thinks. */
	const fromLedger = isYearly && !!(inferred && inferred.period);
	const chosenName = fromLedger ? inferred.period : declared.period;

	return {
		declared: declared,
		inferred: inferred,
		//the answer, and where it came from
		cycle: fromLedger ? inferred.cycle : declaredCycle,
		periodName: chosenName,
		source: fromLedger ? CycleSource.ledger : CycleSource.declaration,
		/* agree / differ / none - the flag a prediction experiment filters on. `differ` on a declared
		   rhythm is exactly the population worth auditing: the ledger disagreed and was overruled. */
		agreement: !inferred || !inferred.period ? 'none'
			: inferred.period === declared.period ? 'agree' : 'differ',

		/* ---- THE SHAPE THIS FUNCTION HAD BEFORE, so nothing downstream had to move ---------------
		   `inferredCycle` has always meant "the cycle this stage concluded", which is what `cycle`
		   now says more plainly. It is NOT the ledger's inference - `inferred.cycle` is. */
		inferredCycle: fromLedger ? inferred.cycle : declaredCycle,
		cycleDetermination: fromLedger ? CycleSource.ledger : CycleSource.declaration,
		isYearly: isYearly
	};
}

export default determineCycle;
