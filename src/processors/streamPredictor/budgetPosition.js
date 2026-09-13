/* ==================================================================================================
   §4 GATE 3 — WHERE A STREAM SITS AGAINST THE ENVELOPE THE USER DREW.  PROTOTYPE.

   ONE RULE: THE DECLARED PERIOD DECIDES WHETHER A BUDGET CAN CONSTRAIN A FORECAST AT ALL. The two
   cases that look like competing rules are the same rule seen through two kinds of envelope.

     A YEARLY DECLARATION IS A FINITE PLAN. Many movements share one envelope, so the envelope can be
     spent. Gembah was planned as roughly $10,000 and paid in four installments of $2,626; there was
     never a fifth, and by the time a fifth would have been due the stream had already spent $11,299.
     A prediction that would break the plan is refused.

     A CYCLE DECLARATION IS AN ENVELOPE THAT REFILLS. A weekly or monthly budget is restored every
     cycle, so it cannot constrain anything - it can only be compared. Consistent overshoot means the
     budget is miscalibrated, not that the spending will stop: groceries run $256 a week against a
     $230 budget, every week, and the honest forecast is $256.

   THE COMPARISON IS RATE AGAINST BUDGET, NEVER SPEND-TO-DATE AGAINST BUDGET, for a refilling
   envelope. "Spent so far this week" is meaningless at any instant - groceries read $0 of $230 on a
   Monday morning - and the per-cycle rate is a number §4 already computes.
   ================================================================================================== */

import {declaredCycleOf} from './cycleDetermination';

const YEARLY = {yearly: true, biyearly: true};
const MAX_STEPS = 600;

/* A PLAN CAN BE SPENT. AN ENVELOPE THAT REFILLS CANNOT. */
export const ENVELOPE = {plan: 'plan', refilling: 'refilling', none: 'none'};

/* WHERE THE STREAM STANDS INSIDE THE ENVELOPE IT IS CURRENTLY IN.

   THE ENVELOPE IS PHASED ON THE MODULE'S ANCHOR like every other lattice, so a yearly envelope runs
   from the anchor and a monthly one from the nearest seam behind today. `spent` is only the legs
   inside it, because an envelope the user has already closed is not the one being forecast. */
export function budgetPosition(stream, legs, anchor, now){
	const hist = (stream && stream.expAmountHistory) || [];
	const budget = hist.length ? hist[hist.length - 1].amount : 0;
	const period = declaredCycleOf(stream && stream.period);

	if(!budget || !period)
		return {kind: ENVELOPE.none, budget: 0, spent: 0, used: null, elapsed: null};

	let start = new Date(anchor), guard = 0;
	while(period.nextDate(start).getTime() <= new Date(now).getTime() && ++guard < MAX_STEPS)
		start = period.nextDate(start);
	const end = period.nextDate(start);

	const inside = (legs || []).filter(l => {
		const t = new Date(l.date).getTime();
		return t >= start.getTime() && t < end.getTime();
	});
	const spent = inside.reduce((n, l) => n + l.amount, 0);
	const span = end.getTime() - start.getTime();

	return {
		kind: YEARLY[stream.period] ? ENVELOPE.plan : ENVELOPE.refilling,
		period: stream.period,
		budget: budget,
		start: start,
		end: end,
		spent: spent,
		legs: inside.length,
		used: spent / budget,
		//how far through the envelope today is, so "110% used at 40% elapsed" reads as it should
		elapsed: span ? (new Date(now).getTime() - start.getTime()) / span : null
	};
}

/* ---- WOULD THIS CLAIM BREAK THE PLAN? ------------------------------------------------------------
   ONLY A PLAN CAN BE BROKEN. A refilling envelope answers `false` whatever the numbers say, because
   next month's budget is not this month's and no forecast can overspend it.

   THE TEST IS FORWARD-LOOKING, ON THE POSITION AFTER THE MOVEMENT. Spend-to-date is not enough:
   Gembah sits at 113% of its plan, which passes a 115% bar, and a fifth installment would take it to
   139%. Asked the forward question the fifth payment is refused on the day it was due, weeks before
   the silence gate could notice anything was wrong.

   AT STREAM LEVEL, NOT PER MODE. A yearly declaration is a plan for the whole stream; its modes are
   how the plan happens to get paid, and no mode carries the plan on its own. */
export function breaksPlan(position, claim, band){
	if(!position || position.kind !== ENVELOPE.plan || !position.budget)return false;
	const after = (position.spent + claim) / position.budget;
	return after > 1 + band;
}

/* ---- HOW FAR THE OBSERVED RATE SITS FROM A REFILLING BUDGET --------------------------------------
   THE REBASELINE NUMBER. It changes no forecast - the observed rate is already what §4 predicts -
   and it is what tells the user their budget is wrong rather than their spending. */
export function rebaseline(position, perCycle){
	if(!position || position.kind !== ENVELOPE.refilling || !position.budget)return null;
	return {budget: position.budget, observed: perCycle, ratio: perCycle / position.budget};
}

export default budgetPosition;
