/* ==================================================================================================
   §4 — THE ANSWER THE REST OF THE APP ASKS FOR: A LIST OF DATED MONEY EVENTS.

   EVERYTHING BEFORE THIS DESCRIBES ONE CYCLE. §3 says a mode is a lump on day 11; §4's `predictionRows`
   says that lump is -$62.33 and puts it on the next cycle. Neither answers the question a balance
   projection actually asks, which is "what moves, on what date, between now and the 30th of June" -
   and stitching one cycle into many is not a loop around the existing call, because three of the four
   gates change as the horizon extends.

   ---- WHAT MAKES THIS MORE THAN A LOOP ------------------------------------------------------------

   THE PLAN DRAINS AS IT IS SPENT. Gate 3 asks whether a claim would break a finite envelope, and a
   projection spends that envelope as it goes: Hobby mdm is 55% through -$250 with four months left,
   so the first two cycles pass and the third is refused. Asking the gate once with today's position
   and then repeating the answer would let a stream overspend its plan four times over.

   AND THE PLAN REFILLS ON ITS OWN BOUNDARY. A yearly envelope ends; the next one starts empty. A
   horizon crossing that boundary must roll over, or every stream reads as spent for the rest of time.

   A REFUSED MOVEMENT IS REPORTED AS ZERO, NOT OMITTED. The money was expected and a gate stopped it,
   which is a different fact from nothing being due - and the caller summing amounts gets the same
   total either way, so saying so costs nothing. A mode that is merely DEAD emits nothing at all:
   there is no claim there to refuse.

   ---- WHAT IT DELIBERATELY WILL NOT DO ------------------------------------------------------------

   A YEARLY STREAM PRODUCES NO EVENTS. Half the portfolio sits there and §3 shapes nothing in any of
   it, because a yearly lattice cuts a one-year window into a single cycle and three is the fewest
   that can show a repeat. The envelope is still real and Gate 3 still spends it; what is not built is
   the other direction - turning a remaining budget into invented dates. Those streams are let happen
   rather than predicted, and finding their pattern needs several years of ledger.

   THE HORIZON IS THE CALLER'S. This module holds no opinion about how far ahead is useful; it is
   handed a date and stops there, with a cycle ceiling only so a careless caller cannot ask for ten
   thousand weeks.

   ---- AND THE DATE IT IS ALL MEASURED FROM ---------------------------------------------------------

   `asOf` IS THE CAPTURE'S DATE, NEVER THE WALL CLOCK. A ledger is a photograph: it stops on the day
   it was taken, and every day the clock runs past that is a day of transactions the capture cannot
   contain. Read against today, a fixture taken last week shows a week of claims that look missing and
   are only unphotographed - the module would be answering a question about the world using evidence
   about a Tuesday. It defaults to the portfolio's own `today` and the caller may override it, which
   is what makes a backtest possible: anchor `asOf` in the past and the answer is what would have been
   forecast then.
   ================================================================================================== */

import {predictionRows} from './modeAmounts';
import {cycleBuckets, lumpDays} from './shapeDetermination';
import {settleDate} from './businessCalendar';
import {AMOUNT_CONFIG} from './amountConfig';
import {budgetPosition, breaksPlan, ENVELOPE} from './budgetPosition';
import {declaredCycleOf} from './cycleDetermination';
import {residueRate} from './residueRate';

const ONE_DAY = 24 * 60 * 60 * 1000;
const YEARLY = {yearly: true, biyearly: true};

/* A CEILING ON THE WALK, not on the horizon. Five years of weekly cycles, twenty of monthly - far
   past anything a forecast is good for, and short enough that a bad `until` fails fast. */
const MAX_CYCLES = 260;

/* WHY A STREAM PRODUCED NOTHING, in the words the caller can act on. A schedule with no events is a
   normal answer and the reason is the useful half of it. */
/* WHY A STREAM IS SILENT, WHICH IS NOT THE SAME QUESTION AS WHETHER IT IS.

   A MODEL THAT PREDICTS NOTHING AND IS RIGHT IS NOT A GAP. Gembah ran four instalments against a
   plan it has now spent, and the answer "no more" is correct - counting its past payments as money
   the module failed to see would book a success as a failure, and inflate any estimate of what is
   missing by exactly the amount the module got right. */
export const SILENCE = {
	predicts: 'predicts',
	//the evidence was read and says this is over: a plan spent, a rate gone quiet, a bill past its worst wait
	stopped: 'stopped',
	//no cycle, but the envelope is spent steadily enough to carry a rate
	rescued: 'rescued',
	//a yearly envelope: no cycle to read, and predicting one is out of scope
	yearly: 'yearly',
	//in scope, with a cycle, and nothing in it cleared the evidence gate
	unreadable: 'unreadable',
	noRhythm: 'noRhythm'
};

export const NO_EVENTS = {
	noRhythm: 'no rhythm: §2 could not read a cycle from the ledger',
	yearly: 'yearly: an envelope, not a rhythm - these are let happen, not predicted',
	nothingReadable: 'nothing readable: no mode cleared the evidence gate',
	horizonPassed: 'the horizon is before the next cycle'
};

/* ---- ONE MODE, FLATTENED ------------------------------------------------------------------------
   THE PER-CYCLE WORK DONE ONCE. A lump's days and a flow's cluster centres are properties of the
   mode, not of the cycle it is placed in, so they are computed here and reused for every cycle in
   the horizon rather than recomputed inside the walk. */
function flatten(rows, anchor, opts){
	const o = opts || {};
	const out = [];
	rows.accounts.forEach(acc => acc.modes.forEach(m => {
		/* THE AMOUNT BEFORE GATE 3 TOUCHED IT. `predictionRows` already applied the budget gate to
		   its own single cycle and zeroed what it refused; this walk re-asks that question for every
		   cycle against a draining envelope, so it needs the claim as it stood. */
		const base = m.capped ? m.cappedAmount : m.amount;
		if(!base)return;

		const flow = m.kind === 'rate';
		let days = m.days || [], wobble = m.wobble || [];
		if(flow){
			/* A FLOW IS PLACED, NOT SMEARED: the weighted average count, rounded to whole movements,
			   put on the centres of its own clusters. Even spacing is the fallback for a mode whose
			   days will not cut into that many groups - then the days are only where the money was
			   put, and nothing is claimed about them. */
			const n = Math.max(1, m.events || 1);
			const cut = lumpDays(cycleBuckets(m.rawLegs, rows.cycle, anchor, o.taper), n);
			const clustered = cut.length === n;
			days = [];
			wobble = [];
			for(let k = 0; k < n; k++){
				days.push(clustered ? cut[k].day : null);
				wobble.push(clustered ? cut[k].wobble : 0);
			}
		}

		out.push({
			//§3 says which modes are the two legs of a card repayment; the schedule carries it on
			repayment: m.repayment || null,
			accountId: acc.accountId,
			accountType: acc.accountType,
			accountName: acc.name || null,
			label: m.label,
			direction: m.direction,
			kind: m.kind,
			rail: m.rail ? m.rail.closures : null,
			confidence: m.confidence || null,
			moneyShare: m.moneyShare,
			days: days,
			wobble: wobble,
			flow: flow,
			//the dates this mode actually moved on, so a cycle it has already paid is not claimed twice
			legs: (m.rawLegs || []).map(l => new Date(l.date).getTime()),
			//a flow's cycle total is split evenly across the movements it was rounded to
			each: flow ? base / days.length : base
		});
	}));
	return out;
}

/* BOTH SIDES OF A DATE COMPARISON HAVE TO BE THE SAME KIND OF MIDNIGHT, which is the oldest bug in
   this module wearing new clothes. A cycle seam is pinned to UTC midnight by `cycleBuckets`; an
   envelope edge comes off the `Period` walk and is LOCAL midnight, eight hours later west of
   Greenwich. Compared raw, the cycle that starts ON the day a yearly plan rolls over reads as still
   inside the old envelope, and the refusals ran one cycle past the refill. */
const seam = d => {
	const x = new Date(d);
	return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
};

/* HAS THIS MODE ALREADY MOVED INSIDE THIS CYCLE? Asked of the raw ledger dates, which is the only
   record of what actually happened. */
function movedIn(mode, cycle){
	const from = cycle.start.getTime(), to = cycle.end.getTime();
	for(let i = 0; i < mode.legs.length; i++)
		if(mode.legs[i] >= from && mode.legs[i] < to)return true;
	return false;
}

/* ---- THE ENVELOPE, AS IT DRAINS AND REFILLS ----------------------------------------------------- */
function envelopeAt(stream, position, when){
	if(!position || position.kind !== ENVELOPE.plan)return position;
	const period = declaredCycleOf(stream && stream.period);
	if(!period || !position.end)return position;

	let start = new Date(position.start), end = new Date(position.end);
	let spent = position.spent, guard = 0;
	while(when.getTime() >= seam(end) && ++guard < MAX_CYCLES){
		start = end;
		end = period.nextDate(end);
		//A NEW ENVELOPE STARTS EMPTY. Last year's overspend is not this year's problem.
		spent = 0;
	}
	return Object.assign({}, position, {start: start, end: end, spent: spent});
}

/* ---- THE SCHEDULE -------------------------------------------------------------------------------
   `until` IS INCLUSIVE OF THE DAY AND EXCLUSIVE OF NOTHING ELSE: every event that lands on or before
   it is returned, and the walk stops at the first cycle that begins past it. */
export function streamSchedule(predictor, streamId, stream, until, opts, cfg){
	const c = Object.assign({}, AMOUNT_CONFIG, cfg || {});
	const o = opts || {};
	const node = stream || predictor.terminalStreams().find(s => s.id === streamId);
	const stop = new Date(until);
	/* THE DATE THE ANSWER IS MEASURED FROM. The capture's own, unless the caller names another. */
	const asOf = o.asOf ? new Date(o.asOf) : new Date(predictor.analysisNow());
	const base = {
		streamId: streamId,
		name: node ? node.name : null,
		declared: node ? node.period : null,
		asOf: asOf,
		from: asOf,
		until: stop,
		cycle: null,
		events: [],
		total: 0,
		cycles: 0
	};
	if(isNaN(stop.getTime()))throw new Error('streamSchedule needs a valid `until` date');

	const rows = predictionRows(predictor, streamId, node, opts, cfg);
	if(!rows)return Object.assign(base, {reason: NO_EVENTS.noRhythm,
		silence: SILENCE.noRhythm});
	base.cycle = rows.cycle;
	if(YEARLY[rows.cycle.name]){
		/* ---- THE LAST RESCUE ---------------------------------------------------------------
		   A YEARLY ENVELOPE SPENT IN NEARLY EVERY MONTH IS A FLOW, and it is offered a rate here
		   rather than a rhythm - measured on the stream, never split by payee, because splitting
		   manufactures dated bills out of scattered spending. Anything that reached this line
		   already produced no events, so nothing that predicts is disturbed. */
		const rescue = residueRate(predictor, streamId, node, asOf, stop, c);
		if(rescue)return Object.assign(base, {
			events: rescue.events,
			cycles: 0,
			total: rescue.events.reduce((sum, e) => sum + e.amount, 0),
			silence: SILENCE.rescued,
			rescued: {months: rescue.months, windowMonths: rescue.windowMonths,
				legs: rescue.legs, peak: rescue.peak,
				perMonth: rescue.perMonth}
		});
		return Object.assign(base, {reason: NO_EVENTS.yearly, silence: SILENCE.yearly});
	}

	const anchor = predictor.analysisAnchor();
	const modes = flatten(rows, anchor, o);
	if(!modes.length){
		/* READ AND OVER, OR NEVER READ AT ALL. A mode the gates silenced was understood; one that
		   never cleared the evidence gate was not, and only the second is money the module cannot
		   see. */
		let gated = false;
		if(rows.capped)gated = true;
		rows.accounts.forEach(a => a.modes.forEach(m => {
			if(m.silenced || m.late || m.capped)gated = true;
		}));
		return Object.assign(base, {reason: NO_EVENTS.nothingReadable,
			silence: gated ? SILENCE.stopped : SILENCE.unreadable});
	}
	base.silence = SILENCE.predicts;

	const country = o.country || predictor.userCountry();

	/* ---- THE FLOOR IS asOf, NOT THE LATTICE ----------------------------------------------------
	   A CLAIM WHOSE DAY HAS PASSED IS NOT A FORECAST, it is a question about the ledger - did it
	   arrive? - which §3 answers as `quiet` and `overdue`. A balance projection starts from a balance
	   that ALREADY CONTAINS everything that has happened, and re-applying a payment sitting in it
	   counts the money twice. `includePast` is there for a caller that wants to ask it anyway. */
	const floor = o.includePast ? -Infinity : asOf.getTime();
	const position = budgetPosition(stream || node, predictor.legsOf(streamId) || [],
		anchor, predictor.analysisNow());

	/* ---- THE WALK STARTS IN THE CYCLE THAT CONTAINS asOf, NOT AFTER IT --------------------------
	   THE LATTICE'S LAST BUCKET IS THE CURRENT CYCLE, NOT A FINISHED ONE. It runs to the first
	   lattice point after the stream's newest movement, so for a live stream it ends in the FUTURE -
	   and starting the walk after it skipped every claim still to come inside it. On the captured
	   portfolio that hid a $6,000 transfer due five days out, and it hid it from the one caller that
	   cares most: between the capture date and the next seam, every monthly stream was silent by
	   construction. How much it hides depends only on where the capture date falls in the cycle.

	   THE GUARD IS THE LEDGER ITSELF. A mode that has already moved inside a cycle does not claim
	   again in it - Rent paid early on the 2nd against a claimed day of the 11th would otherwise be
	   predicted twice. Legs only exist in the past, so the test costs nothing in later cycles and
	   needs no special case for the first. */
	const events = [];
	const last = rows.spine[rows.spine.length - 1];
	let cursor = {start: new Date(last.start), end: new Date(last.end),
		days: Math.max(1, Math.round((last.end.getTime() - last.start.getTime()) / ONE_DAY))};
	let n = 0, env = position;

	while(cursor && cursor.start.getTime() <= stop.getTime() && ++n < MAX_CYCLES){
		env = envelopeAt(stream || node, env, cursor.start);

		/* ---- GATE 3, ASKED AGAIN FOR THIS CYCLE ------------------------------------------------
		   THE WHOLE CYCLE'S CLAIM AGAINST WHAT THE ENVELOPE HAS LEFT, because a plan belongs to the
		   stream and not to any one of its modes. Refused means every claim in the cycle goes to
		   zero - not scaled down, zero - and the envelope is not charged for what did not happen.

		   ONLY WHAT IS STILL TO COME IS CLAIMED. A mode that already moved in this cycle is not
		   asking for anything, and the envelope was charged for it when it happened. */
		const live = modes.filter(m => !movedIn(m, cursor));
		const claim = live.reduce((sum, m) => sum + m.each * m.days.length, 0);
		const refused = claim !== 0 && breaksPlan(env, claim, c.budgetBand);
		if(!refused)env = Object.assign({}, env, {spent: env.spent + claim});

		live.forEach(m => m.days.forEach((d, k) => {
			//an unclustered flow movement has no day of its own; space it evenly instead
			const day = d === null
				? Math.round(cursor.days * (k + 0.5) / m.days.length) : d;
			const due = new Date(cursor.start.getTime() + day * ONE_DAY);
			/* WHERE IT WILL ACTUALLY LAND. §3 learned what the banks do to this rail; here that
			   becomes a date. A mode with no learned rail is never moved - guessing would put money
			   on a day nothing has ever landed on. */
			const at = m.flow ? due : settleDate(due, m.rail, country);
			if(at.getTime() > stop.getTime() || at.getTime() < floor)return;

			events.push({
				date: at,
				repayment: m.repayment,
				dueDate: at.getTime() === due.getTime() ? null : due,
				amount: refused ? 0 : m.each,
				refused: refused ? 'plan' : null,
				claimed: refused ? m.each : null,
				accountId: m.accountId,
				accountType: m.accountType,
				accountName: m.accountName,
				label: m.label,
				direction: m.direction,
				kind: m.kind,
				cycle: n,
				cycleStart: cursor.start,
				day: day,
				wobble: m.wobble[k] || 0,
				confidence: m.confidence,
				rail: m.rail,
				moneyShare: m.moneyShare
			});
		}));

		const start = cursor.end;
		cursor = {start: start, end: rows.cycle.nextDate(start),
			days: Math.max(1, Math.round(
				(rows.cycle.nextDate(start).getTime() - start.getTime()) / ONE_DAY))};
	}

	//BY DATE, because a caller running a balance forward reads them in the order the money moves
	events.sort((a, b) => a.date - b.date
		|| (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));

	return Object.assign(base, {
		events: events,
		cycles: n,
		total: events.reduce((sum, e) => sum + e.amount, 0),
		reason: events.length ? null : NO_EVENTS.horizonPassed
	});
}

export default streamSchedule;
