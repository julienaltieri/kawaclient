/* ==================================================================================================
   THE LAST RESCUE: A YEARLY ENVELOPE THAT IS SPENT STEADILY.

   A YEARLY DECLARATION USUALLY MEANS NO RHYTHM, and the module says nothing about those on purpose.
   But some of them are not lumpy at all - Eléonore is 69 movements across all twelve months with no
   month carrying more than 30% of the year. That is a FLOW whose lattice happens to be monthly, and
   it is denied one only because its declaration says yearly.

   WHY §2 CANNOT ANSWER THIS. The cycle detector asks "is there a rhythm?" and scores candidate
   periods for periodicity. A flow is defined by having none, so a yearly stream that is genuinely a
   flow can never be rescued there whatever the threshold. It is the wrong question, not a tight one.

   WHY THE MODE MACHINERY CANNOT ANSWER IT EITHER. Read on a monthly lattice, these streams come back
   as confident dated bills: Amazon on day 17 in one stream, day 8 in another, day 20 in a third,
   California DMV on day 16 from eight movements in three months. A payee with roughly one purchase a
   month passes focus trivially - one movement, one cluster, nothing to disagree with - so splitting
   by payee and fitting days manufactures precision out of scattered spending. Eléonore comes back
   100% lump, which is worse than silence.

   SO THIS MEASURES THE STREAM, NOT ITS PAYEES, and answers a rate with no days in it.

   AND IT RUNS LAST. Only a stream that reached the end of the normal path with no cycle and no
   events is offered here, so nothing that already predicts is touched and the blast radius is the
   set of streams that were silent anyway.

   WHAT SEPARATES A FLOW FROM A BURST is how many months carry money and whether one of them carries
   most of it. Voyages has MORE movements than Eléonore - 78 against 69 - in five months rather than
   twelve, with 48% of the year in its biggest month. It is a holiday, and it stays unpredicted.
   ================================================================================================== */

import {legsInWindow} from './cycleFit';
import {accountKindOf} from './accountMapping';
import {AMOUNT_CONFIG} from './amountConfig';
import {budgetPosition, breaksPlan} from './budgetPosition';

const ONE_DAY = 24 * 60 * 60 * 1000;
const monthKey = d => d.getUTCFullYear() + '-' + d.getUTCMonth();

/* ---- HOW THE YEAR WAS SPENT --------------------------------------------------------------------- */
export function yearShape(legs){
	const months = {}, byAccount = {};
	(legs || []).forEach(l => {
		const d = new Date(l.date);
		const k = monthKey(d);
		months[k] = (months[k] || 0) + l.amount;
		const a = byAccount[l.accountId] = byAccount[l.accountId]
			|| {total: 0, legs: 0, months: {}};
		a.total += l.amount;
		a.legs++;
		a.months[k] = true;
	});
	const keys = Object.keys(months);
	const total = keys.reduce((n, k) => n + months[k], 0);
	/* THE BIGGEST MONTH AS A SHARE OF THE YEAR, on the side the money actually went. A stream that
	   nets to nothing - a reimbursement - produces shares over 100% and is refused by the same test,
	   which is correct: there is no rate to predict when the year sums to zero. */
	let peak = 0;
	keys.forEach(k => {
		if(!total)return;
		const share = months[k] / total;
		if(share > peak)peak = share;
	});
	return {months: keys.length, total: total, legs: (legs || []).length,
		peak: total ? peak : 99, byAccount: byAccount};
}

/* ---- IS THIS A FLOW? ---------------------------------------------------------------------------- */
/* A SHARE OF THE WINDOW, NOT A COUNT OF MONTHS. The analysis window is the anchor to the capture,
   which is ten months here and will be a different number on the next capture; a rule that wants
   nine of them means "nearly always" on one portfolio and "impossible" on another. */
export function spendsSteadily(shape, windowMonths, cfg){
	const c = Object.assign({}, AMOUNT_CONFIG, cfg || {});
	const span = Math.max(1, windowMonths || shape.months);
	return shape.months / span >= c.rescueMinMonthShare
		&& shape.legs >= c.rescueMinMovements
		&& shape.peak <= c.rescueMaxMonthShare;
}

/* ---- THE RESCUE --------------------------------------------------------------------------------- */
export function residueRate(predictor, streamId, stream, asOf, until, cfg){
	const c = Object.assign({}, AMOUNT_CONFIG, cfg || {});
	const anchor = predictor.analysisAnchor();
	const legs = legsInWindow(predictor.legsOf(streamId), anchor);
	if(!legs.length)return null;

	const shape = yearShape(legs);
	const from = new Date(anchor), to = new Date(predictor.analysisNow());
	const windowMonths = Math.max(1,
		(to.getUTCFullYear() - from.getUTCFullYear()) * 12
		+ (to.getUTCMonth() - from.getUTCMonth()) + 1);
	if(!spendsSteadily(shape, windowMonths, c))return null;

	/* THE RATE IS PER ACCOUNT, because a balance is a property of an account and a stream that spends
	   on a card and reimburses into checking is two different rates. */
	const rates = [];
	Object.keys(shape.byAccount).forEach(id => {
		const a = shape.byAccount[id];
		const months = Object.keys(a.months).length;
		if(!months || !a.total)return;
		const account = (predictor.accountsByHash || {})[id];
		rates.push({
			accountId: id,
			accountType: account
				? accountKindOf(account, predictor.accountTypeOverrides) : null,
			perMonth: a.total / months,
			//WHOLE MOVEMENTS, EVENLY SPACED. No day is claimed: the spacing is where the money was
			//put, and the stream said nothing about when.
			each: Math.max(1, Math.round(a.legs / months)),
			direction: a.total < 0 ? 'out' : 'in'
		});
	});
	if(!rates.length)return null;

	const stop = new Date(until);
	const floor = new Date(asOf).getTime();
	const position = budgetPosition(stream, predictor.legsOf(streamId) || [],
		anchor, predictor.analysisNow());

	const events = [];
	let cursor = new Date(Date.UTC(new Date(asOf).getUTCFullYear(),
		new Date(asOf).getUTCMonth(), 1));
	let env = position, n = 0;

	while(cursor.getTime() <= stop.getTime() && ++n < 60){
		const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
		const days = Math.round((next.getTime() - cursor.getTime()) / ONE_DAY);

		/* GATE 3 STILL APPLIES, and it is the point of a yearly plan: a rate spent against a finite
		   envelope stops when the envelope does. */
		const claim = rates.reduce((sum, r) => sum + r.perMonth, 0);
		const refused = claim !== 0 && breaksPlan(env, claim, c.budgetBand);
		if(!refused)env = Object.assign({}, env, {spent: env.spent + claim});

		rates.forEach(r => {
			for(let k = 0; k < r.each; k++){
				const day = Math.round(days * (k + 0.5) / r.each);
				const at = new Date(cursor.getTime() + day * ONE_DAY);
				if(at.getTime() < floor || at.getTime() > stop.getTime())continue;
				events.push({
					date: at,
					dueDate: null,
					amount: refused ? 0 : r.perMonth / r.each,
					refused: refused ? 'plan' : null,
					claimed: refused ? r.perMonth / r.each : null,
					accountId: r.accountId,
					accountType: r.accountType,
					accountName: null,
					label: 'everything else',
					direction: r.direction,
					kind: 'rate',
					cycle: n,
					cycleStart: cursor,
					day: day,
					wobble: 0,
					confidence: null,
					rail: null,
					repayment: null,
					moneyShare: 1 / rates.length,
					rescued: true
				});
			}
		});
		cursor = next;
	}

	events.sort((a, b) => a.date - b.date);
	return {events: events, months: shape.months, windowMonths: windowMonths, legs: shape.legs,
		peak: Math.round(shape.peak * 100) / 100,
		perMonth: rates.reduce((n2, r) => n2 + r.perMonth, 0)};
}

export default residueRate;
