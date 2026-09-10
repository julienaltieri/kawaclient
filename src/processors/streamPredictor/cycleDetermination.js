import { Period } from '../../Time';

/* ==================================================================================================
   HOW OFTEN THE STREAM'S PATTERN RESETS - which is not how often money moves.

   Utilities billed to two services twice a month is a MONTHLY cycle carrying two events, not a
   semi-monthly one. How many events land inside one cycle is the SHAPE, and it is determined
   somewhere else; conflating the two is what makes a stream with two bills read as a stream with a
   two-week rhythm, and then predicts a bill on a fortnight the calendar has no month boundary in.

   THE DECLARATION ALWAYS WINS, and the ledger is not consulted AT ALL - this function does not take
   transactions as an argument, and that missing parameter is the rule rather than an omission. The
   period is a statement of fact by the person who receives the money. Transactions are noisy in ways
   a declaration is not: a cheque that lands on the 1st because the 29th was a Sunday, a month with a
   correction in it. No amount of inference beats being told.

   YEARLY IS THE EXCEPTION, because a yearly declaration is not a rhythm at all - it is a budget
   envelope, and it is silent about when the money moves. This stage's whole job for a yearly stream
   is to hand it on correctly LABELLED; the handling itself lives downstream and does not exist yet.
   ================================================================================================== */

export const CycleSource = {declaration: 'declaration', ledger: 'ledger'};

/* The nine period names a stream may declare, as an explicit allowlist. `Period` carries static
   members that are not periods (`periodName`, `longestPeriod`), so a raw `Period[name]` lookup would
   hand back a lookup table or a function for a malformed declaration instead of failing. */
const DECLARABLE = {daily: true, weekly: true, biweekly: true, semimonthly: true, monthly: true,
	bimonthly: true, quarterly: true, yearly: true, biyearly: true};

const YEARLY = {yearly: true, biyearly: true};

/* An unknown or missing period is reported as an unknown period - `inferredCycle: null` with the raw
   string kept for display - and never thrown. A stream with a malformed declaration is a stream we
   cannot predict, not a reason to fail the whole portfolio's prediction pass. */
export function determineCycle(streamNode){
	const periodName = (streamNode || {}).period;
	const known = !!periodName && !!DECLARABLE[periodName];
	return {
		inferredCycle: known ? Period[periodName] : null,
		cycleDetermination: CycleSource.declaration,
		isYearly: known && !!YEARLY[periodName],
		periodName: periodName === undefined ? null : periodName
	};
}
