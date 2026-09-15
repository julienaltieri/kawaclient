/* ==================================================================================================
   ONE SYNTHETIC STREAM, AS WRITTEN AND AS READ.  TEST INSTRUMENT.

   THE SCORECARD SAYS 83% AND CANNOT SAY WHY. A percentage is the end of a measurement, not the start
   of an investigation: to know whether a miss is the detector being wrong or the truth being
   unreasonable, you have to look at one stream, see the payments it actually grew, and see what was
   made of them. This file turns a bench run into that - one row per stream, the DNA on the left, the
   reading on the right, and the ledger drawn between them.

   THE SAMPLES ARE BUILT IN NODE, NOT IN THE BROWSER. The generator walks the real Period lattice and
   the reading comes from the real predictor; neither belongs in a page script. What the page gets is
   the finished comparison, and its only job is to draw one of them at a time.
   ================================================================================================== */

import {predictionRows} from './modeAmounts';
import {Shape, cycleBuckets, dayInCycle} from './shapeDetermination';
import {expectedShape} from './dnaBench';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 24 * 60 * 60 * 1000;
const iso = d => {
	const x = new Date(d);
	return x.getUTCDate() + ' ' + MONTHS[x.getUTCMonth()];
};

/* THE CIRCULAR GAP, because a claim of day 0 against a truth of day 29 is one day out and not
   twenty-nine. The same measure the scorecard uses, so the page and the percentage never disagree. */
const dayGap = (a, b, span) => {
	const raw = Math.abs(a - b) % span;
	return raw > span / 2 ? span - raw : raw;
};

/* ---- ONE STREAM ---------------------------------------------------------------------------------- */
function sampleOf(predictor, truth, cycleDays){
	const node = predictor.terminalStreams().find(x => x.id === truth.id);
	if(!node)return null;
	const answer = predictor.shapeOf(truth.id, node);
	const working = predictor.explainShapeOf(truth.id, node);
	const rows = predictionRows(predictor, truth.id, node, {country: predictor.userCountry()});

	/* EVERY CYCLE THE MODE LIVED THROUGH, NOT THE LAST THREE. The lanes draw three cycles because
	   three is what a forecast is checked against; a question about WHY a day was chosen is a
	   question about all twelve. A mode written as d18 give or take 9 is spread over nineteen days,
	   and without the whole series "the truth says d18" reads as a claim the DNA never made. */
	const landedBy = {};
	(working && working.modes ? working.modes : []).forEach((w, i) => {
		const label = answer.modes[i] ? answer.modes[i].label : null;
		if(!label || !answer.cycle)return;
		landedBy[label] = cycleBuckets(w.rawLegs, answer.cycle, predictor.analysisAnchor())
			.map(b => b.legs.map(l => dayInCycle(l, b)).sort((x, y) => x - y));
	});
	const gotCycle = answer.cycle ? answer.cycle.name : null;

	/* THE TRUTH AND THE READING ARE PAIRED BY PAYEE, which is what splits a stream into modes in the
	   first place, so the two tables line up row for row and a missing row means the detector never
	   saw that pile of money at all. */
	/* WHAT §4 DECIDED, PER PAYEE. §3 says what shape a pile of money is; only §4 says whether it will
	   move next cycle and for how much, and a bench that shows the shape and not the claim leaves the
	   reader to do the last step in their head. */
	const claimed = {};
	//where the next cycle starts on each account, so a truth day can be named as a real date
	const nextStart = {};
	(rows && rows.accounts ? rows.accounts : []).forEach(a => {
		const next = (a.lanes || []).filter(l => l.predicted)[0];
		if(next)nextStart[a.accountId] = new Date(next.start).getTime();
		(a.modes || []).forEach(x => {
			const mine = next ? next.events.filter(e => e.label === x.label) : [];
			claimed[x.label] = {
				amount: x.silenced ? 0 : (x.amount === undefined ? null : x.amount),
				/* THREE WAYS A MODE ENDS UP PREDICTING NOTHING, and only one of them is `silenced`.
				   A mode past its own worst-ever wait is `late`; a movement that would break a
				   finite plan is `capped`; a rate gone quiet is `silenced`. Reading only the last
				   of the three, this bench drew two dead subscriptions as a claim of "+$0.00 on
				   24 April" - the right behaviour under a label that hid it. */
				silenced: !!x.silenced,
				late: !!x.late,
				quiet: x.quiet || 0,
				capped: !!x.capped,
				shape: x.shape,
				when: mine.map(e => iso(new Date(next.start).getTime() + e.day * DAY)),
				total: mine.reduce((n, e) => n + e.amount, 0)
			};
		});
	});

	const modes = truth.modes.map(m => {
		const mine = answer.modes.filter(a => a.label === m.payee);
		const got = mine.length === 1 ? mine[0]
			: (mine.find(a => a.shape === Shape.lump) || mine[0] || null);
		const want = expectedShape(m);
		const dead = want === 'dead';

		let dayOk = null, dayOff = null;
		if(!dead && want === Shape.lump && got && got.shape === Shape.lump
			&& got.days && got.days.length){
			dayOff = Math.min.apply(null, m.days.map(d =>
				Math.min.apply(null, got.days.map(a => dayGap(a, d, cycleDays)))));
			dayOk = dayOff <= Math.max(1, m.jitter || 0);
		}

		return {
			payee: m.payee,
			accountId: m.accountId,
			accountType: m.accountType,
			direction: m.direction,
			//---- as written
			kind: m.kind,
			days: (m.days || []).slice(),
			jitter: m.jitter || 0,
			arrivalP: Math.round((m.arrivalP || 0) * 100),
			perMonth: m.kind === 'spread' ? Math.round(m.perMonth * 10) / 10 : null,
			amount: m.amount,
			amountJitter: Math.round((m.amountJitter || 0) * 100),
			rail: m.rail,
			diedAt: (m.diedAt === null || m.diedAt === undefined) ? null : m.diedAt,
			//---- as read
			gotShape: got ? got.shape : null,
			gotDays: got && got.days ? got.days.slice() : [],
			gotWobble: got && got.wobble ? got.wobble.slice() : [],
			gotArrival: got && got.confidence ? Math.round(got.confidence.arrival * 100) : null,
			gotDay: got && got.confidence ? Math.round(got.confidence.day * 100) : null,
			gotRail: got && got.rail ? got.rail.closures : null,
			gotRailTests: got && got.rail ? got.rail.tests : 0,
			gotQuiet: got ? got.quiet : null,
			//---- the verdict
			want: want,
			shapeOk: dead ? null : (got ? got.shape === want : false),
			dayOk: dayOk,
			dayOff: dayOff,
			railOk: (got && got.rail) ? got.rail.closures === m.rail : null,

			/* ---- WHAT IT WILL DO NEXT, AND WHAT IT SHOULD DO NEXT ---------------------------
			   THE TRUTH'S OWN CYCLE TOTAL, computed from the parameters rather than from the
			   ledger: a lump moves its amount once per day it names, a flow moves its amount as
			   many times a cycle as its rate says, and a mode that has stopped moves nothing. */
			claim: claimed[m.payee] || null,
			landed: landedBy[m.payee] || [],
			/* THE DATE THE TRUTH MEANS. A day number is only comparable to a forecast once it is a
			   calendar date, and only when the rhythm agreed - on a missed rhythm the two are days
			   of different cycles and naming them together would read as a near miss. */
			truthWhen: (gotCycle === truth.cycle && nextStart[m.accountId] !== undefined
					&& m.kind !== 'spread' && (m.diedAt === null || m.diedAt === undefined))
				? iso(nextStart[m.accountId] + m.days[0] * DAY) : null,
			truthTotal: (m.diedAt !== null && m.diedAt !== undefined) ? 0
				: (m.kind === 'spread'
					? Math.round(m.amount * m.perMonth * (cycleDays / 30) * 100) / 100
					: Math.round(m.amount * m.days.length * 100) / 100)
		};
	});

	//a mode the detector invented: a payee in the answer that the DNA never wrote
	const written = {};
	truth.modes.forEach(m => { written[m.payee] = true; });
	const invented = answer.modes.filter(a => !written[a.label]).map(a => a.label);

	return {
		id: truth.id,
		name: truth.name,
		declared: truth.declaredPeriod,
		declaredAmount: truth.declaredAmount || 0,
		truthCycle: truth.cycle,
		gotCycle: gotCycle,
		cycleOk: gotCycle === truth.cycle,
		cycleDays: cycleDays,
		invented: invented,
		modes: modes,
		/* WHERE THE TRUTH SAYS THE NEXT PAYMENT GOES, drawn as a ghost on the predicted lane so the
		   claim and the answer sit on one axis. Only when the rhythm agreed: on a missed rhythm the
		   two lattices are different rulers and laying one over the other would invent a disagreement
		   that is really just the first one, restated. */
		truthNext: gotCycle !== truth.cycle ? [] : truth.modes
			/* A MODE THE DNA ITSELF CALLS UNREADABLE HAS NO NEXT PAYMENT TO DRAW. A mode that turns
			   up in 19% of cycles is not saying "the next one is on day 6", it is saying there
			   probably is no next one; a red line at day 6 reads as a claim nobody made. */
			.filter(m => expectedShape(m) !== Shape.unknown)
			.filter(m => m.kind !== 'spread' && (m.diedAt === null || m.diedAt === undefined))
			.map(m => ({day: m.days[0], amount: m.amount, label: m.payee, jitter: m.jitter || 0})),
		accounts: (rows && rows.accounts ? rows.accounts : []).map(a => ({
			accountId: a.accountId,
			accountType: a.accountType,
			name: a.name || null,
			rate: a.rate === undefined ? 0 : a.rate,
			lanes: (a.lanes || []).map(l => ({
				from: iso(l.start), to: iso(l.end),
				days: l.days,
				predicted: !!l.predicted,
				closed: (l.closed || []).map(c => ({day: c.day, holiday: !!c.holiday})),
				rate: l.rate === undefined ? null : l.rate,
				events: (l.events || []).map(e => ({
					day: e.day, amount: e.amount, label: e.label,
					when: iso(new Date(l.start).getTime() + e.day * DAY),
					spaced: !!e.spaced,
					movedFrom: e.movedFrom === undefined ? null : e.movedFrom
				}))
			}))
		}))
	};
}

/* ---- A WHOLE RUN --------------------------------------------------------------------------------- */
export function dnaSamples(bench, predictor, cycleDaysOf){
	const out = [];
	bench.truths.forEach(truth => {
		const s = sampleOf(predictor, truth, cycleDaysOf(truth.cycle));
		if(s)out.push(s);
	});
	return out;
}

export default dnaSamples;
