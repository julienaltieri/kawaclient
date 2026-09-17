/* ==================================================================================================
   ONE LEDGER PER ACCOUNT — what has happened, then what is expected.

   THE LEDGER IS THE PRODUCT AND THE BALANCE IS A CUMULATIVE SUM OVER IT. A correct ledger makes the
   balance trivial; no amount of balance arithmetic rescues a wrong one. So this file builds the
   series and nothing else: posted transactions up to `asOf`, predicted events after it, one list per
   account, ordered by date.

   A CARD REPAYMENT IS SET ASIDE RATHER THAN CARRIED. The stream that pays a card predicts an amount
   read from its past repayments; the amount that will actually move is whatever the card owes at its
   statement close. Those events are separated here, counted, and left for the settlement stage - a
   predicted repayment that survived alongside a computed one would pay the card twice.

   NOTHING HERE PINS A BALANCE. An anchor turns displacements into amounts and is its own stage; a
   caller wanting a picture before then can sum from zero, which is what the bench does.
   ================================================================================================== */

import {StreamPredictor} from '../streamPredictor';
import {cardRepayments} from '../streamPredictor/cardRepayments';
import {cardSettlements} from './settlement';
import {pinBalances} from './balanceCurve';
import {scheduleParallel} from './schedulePool';

const SOURCE = {posted: 'posted', predicted: 'predicted', settlement: 'settlement'};
const ONE_DAY = 24 * 60 * 60 * 1000;

/* ---- §1 — WHICH STREAMS ARE PREDICTED ------------------------------------------------------------
   OPEN, AND MOVED THIS YEAR. A closed stream contributes nothing. One that has not moved in the
   current year contributes nothing either and costs a full shape reading to discover it - and its
   modes would be silenced by the liveness gate anyway, so the filter is an economy rather than a
   second opinion.

   THE YEAR IS COUNTED BACK FROM `asOf`, not from January. A stream last paid in November is live in
   February, and a calendar year would call it dormant for being on the wrong side of a date nothing
   about the money observes. */
export function inScope(predictor, asOf){
	const edge = new Date(asOf);
	edge.setFullYear(edge.getFullYear() - 1);
	return predictor.reviewable().filter(s => {
		const legs = predictor.legsOf(s.id) || [];
		return legs.some(l => new Date(l.date).getTime() >= edge.getTime());
	});
}

/* ---- §2 — ONE LEDGER PER ACCOUNT ----------------------------------------------------------------
   EVERYTHING BELOW `scheduleFor` IS THE SAME WHETHER THE SCHEDULE CAME FROM ONE THREAD OR FOUR. The
   only thing the sync and async entry points below disagree about is HOW each stream's `scheduleOf`
   answer gets produced - one thread, in order, or a worker pool, merged - so that is the only thing
   factored out. `assembleLedgers` never knows which. */
function assembleLedgers(portfolio, predictor, until, opts, scheduleFor){
	const o = opts || {};
	const asOf = o.asOf ? new Date(o.asOf) : new Date(predictor.analysisNow());
	const stop = new Date(until);

	const streams = inScope(predictor, asOf);
	const byId = {};
	streams.forEach(s => { byId[s.id] = s; });

	/* ONE PASS OVER THE LEDGER ANSWERS ALL OF IT: which card is paid from which account, which posted
	   movements are the repayments, and which stream does the repaying. */
	const found = cardRepayments(portfolio, predictor.accountTypeOverrides);
	const links = found.links;
	const kindOf = (unused, id) => found.kind[id] || null;
	const accounts = new Map();
	const take = id => {
		if(!accounts.has(id)){
			const a = (predictor.accountsByHash || {})[id];
			accounts.set(id, {
				accountId: id,
				accountType: kindOf(predictor, id),
				name: a ? a.name : null,
				mask: a ? a.mask : null,
				reported: a ? {current: a.current, available: a.available} : null,
				asOf: asOf,
				ledger: [],
				setAside: []
			});
		}
		return accounts.get(id);
	};
	//every account the capture knows, so one with no movement still answers rather than goes missing
	(portfolio.accounts || []).forEach(a => { if(a && a.hash)take(a.hash); });

	/* ---- THE PREDICTED HALF ---------------------------------------------------------------------- */
	let events = 0, aside = 0;
	/* WHICH STREAMS PREDICT ONTO WHICH ACCOUNT, not which streams predict at all. A stream with modes
	   on two accounts can forecast the current-account half and say nothing about the card half, and
	   counting it as covered on both hides exactly the gap this bench exists to show. */
	const predicting = {};
	//why each stream says nothing, so a correct silence is not counted as a blind spot
	const silence = {};
	streams.forEach(stream => {
		const r = scheduleFor(stream, stop, asOf);
		silence[stream.id] = r.silence || 'unreadable';

		/* ---- WHICH OF THIS STREAM'S EVENTS ARE REPAYMENTS -------------------------------------
		   §3 ANSWERS THIS NOW. A repayment is two modes and one movement, and only the ledger knows
		   they are the same; the predictor reads that once and labels both legs. Re-deriving it here
		   from the amounts was what produced a forecast that repaid the card every week - the two
		   legs are separately estimated and need not agree to the cent. */
		r.events.forEach(e => {
			(predicting[e.accountId] = predicting[e.accountId] || {})[stream.id] = true;
			const row = {
				date: new Date(e.date),
				amount: e.amount,
				source: SOURCE.predicted,
				label: e.label,
				streamId: stream.id,
				streamName: stream.name,
				kind: e.kind,
				cycle: e.cycle,
				refused: e.refused || null,
				dueDate: e.dueDate || null,
				rail: e.rail || null,
				confidence: e.confidence || null
			};
			const isRepayment = !!e.repayment;
			events++;
			if(isRepayment){ aside++; take(e.accountId).setAside.push(row); }
			else take(e.accountId).ledger.push(row);
		});
	});

	/* ---- THE POSTED HALF -------------------------------------------------------------------------
	   EVERY TRANSACTION THE CAPTURE HOLDS, whether or not a stream claimed it. A balance is moved by
	   money, and money the user never categorised moved the balance exactly as much as money they
	   did. `covered` says whether the stream it belongs to actually produced events - being in scope
	   is not the same as predicting anything, and a yearly stream is in scope and silent. That flag
	   is what makes the two halves of the ledger comparable. */
	(portfolio.transactions || []).forEach(t => {
		const when = new Date(t.date);
		if(when.getTime() > asOf.getTime())return;
		const alloc = (t.streamAllocation || [])[0];
		const streamId = alloc ? alloc.streamId : null;
		take(t.userInstitutionAccountId).ledger.push({
			date: when,
			amount: t.amount,
			source: SOURCE.posted,
			label: t.description,
			transactionId: t.transactionId,
			streamId: streamId,
			streamName: streamId && byId[streamId] ? byId[streamId].name : null,
			covered: !!(streamId && predicting[t.userInstitutionAccountId]
				&& predicting[t.userInstitutionAccountId][streamId]),
			/* WHY NOTHING IS FORECAST FOR THIS ENTRY'S STREAM. `stopped` means the module read the
			   evidence and answered "no more", which is an answer rather than a blind spot. */
			silence: streamId ? (silence[streamId] || 'notInScope') : 'noStream',
			repayment: !!found.legs[t.transactionId],
			paired: !!t.pairedTransferTransactionId
		});
	});

	/* ---- ONLY ACCOUNTS THAT ARE STILL IN USE ----------------------------------------------------
	   A LEDGER IS ABOUT MONEY THAT MOVES. Two of the captured cards were last used eleven months ago
	   and two investment accounts have never carried a transaction at all; drawing them costs a tab
	   each and answers nothing. An account earns its place by having moved inside the window or by
	   having something predicted on it. */
	const live = a => a.ledger.some(e => e.source === 'predicted')
		|| a.ledger.some(e => e.source === 'posted'
			&& e.date.getTime() >= asOf.getTime() - (o.activeDays || 90) * ONE_DAY);

	/* ---- THE AMPLITUDE CORRECTION -----------------------------------------------------------------
	   THE FORECAST REPRODUCES THE RHYTHM AND UNDERSHOOTS THE SIZE, because the predictable part of an
	   account is not all of it. One number per account, measured against that account's own past,
	   scales the predicted CHARGES before the repayments are computed from them - so a settlement
	   clears the corrected spending rather than the raw forecast.

	   IT IS PASSED IN, NEVER MEASURED HERE. Measuring it needs the module rewound and run over past
	   cycles, and those runs come through this same function; computing it inside would call itself
	   for ever. A caller that has not measured one gets no correction, which is the right default.

	   IT ONLY TOUCHES CHARGES BELOW THE CUT IT WAS MEASURED WITH. The correction exists for the
	   routine spending that scatters across payees and never earns a shape; a charge above the cut
	   was excluded from the measurement precisely because it is an event rather than a rate, and
	   scaling it applies a factor that was never measured against it. Left in, a correctly predicted
	   $2,626 instalment came out at $6,565 and the card was repaid for it three days later. */
	/* AND A SECOND, SHORTER-LIVED CORRECTION MAY RIDE ON TOP. `boost` is the in-cycle loop: a window
	   inside which this account is running hotter or colder than its rhythm says, measured from what
	   has actually landed so far this cycle. It expires at the seam, because next cycle is not this
	   one. See inCycle.js. */
	const calibration = o.calibration || {};
	accounts.forEach(a => {
		const k = calibration[a.accountId];
		const m = k && k.multiplier ? k.multiplier : 1;
		const cut = k && k.cut !== undefined ? k.cut : Infinity;
		const boost = (k && k.boost) || null;
		if(m === 1 && !boost)return;
		a.ledger.forEach(e => {
			if(e.source !== SOURCE.predicted || e.repayment)return;
			if(Math.abs(e.amount) > cut)return;
			const t = e.date.getTime();
			const hot = boost && t >= boost.from && t < boost.to ? boost.factor : 1;
			if(m === 1 && hot === 1)return;
			e.uncalibrated = e.amount;
			e.amount = e.amount * m * hot;
		});
	});

	/* ---- §3 — THE REPAYMENTS, COMPUTED RATHER THAN PREDICTED -------------------------------------
	   THE SCHEDULE SAID WHEN and this says how much: every charge in the window each repayment
	   closes. Both accounts move on the day and the money is one movement, so the two entries are
	   written together or the ledgers disagree about it. */
	const settled = cardSettlements(portfolio, Array.from(accounts.values()),
		{found: found, asOf: asOf});
	Object.keys(settled).forEach(card => {
		const plan = settled[card];
		plan.settlements.forEach(x => {
			if(!x.amount)return;
			take(card).ledger.push({
				date: x.date, amount: x.amount, source: SOURCE.settlement,
				label: 'repayment', closes: x.close, streamId: null, streamName: null,
				kind: 'settlement', covered: true
			});
			take(plan.fundedFrom).ledger.push({
				date: x.date, amount: -x.amount, source: SOURCE.settlement,
				label: 'repayment', closes: x.close, streamId: null, streamName: null,
				kind: 'settlement', covered: true
			});
		});
	});

	const out = [];
	accounts.forEach(a => {
		if(!live(a))return;
		a.ledger.sort((x, y) => x.date - y.date
			|| (x.source === y.source ? 0 : x.source === SOURCE.posted ? -1 : 1));
		a.setAside.sort((x, y) => x.date - y.date);
		out.push(a);
	});
	//the account carrying the most entries leads: a ledger is checked where there is something to check
	out.sort((a, b) => b.ledger.length - a.ledger.length);

	/* ---- §5 — EVERY LEDGER PINNED TO A REAL BALANCE ----------------------------------------------
	   THE LEDGER IS DISPLACEMENTS AND A BALANCE IS AN AMOUNT. One number that is true on one date
	   turns the whole series into amounts in both directions, so this runs last, over the finished
	   ledger - settlements included, or the card's curve would never come back up. */
	return pinBalances({
		asOf: asOf,
		until: stop,
		silence: silence,
		calibration: calibration,
		settlements: settled,
		accounts: out,
		streams: streams.length,
		reviewable: predictor.reviewable().length,
		events: events,
		setAside: aside,
		links: links,
		/* THE PREDICTOR ITSELF, so a caller building a second ledger from the SAME asOf can hand it
		   straight back in as `opts.predictor` rather than let a fresh one repeat every stream's
		   schedule from a cold cache - see cachedBuild() in benchForecast.js, where this cut the
		   second build from ~570ms to ~45ms on a 1200-transaction portfolio. Never read by anything
		   that only wants the ledger; the shape below (`accounts`, `streams`, ...) is unchanged. */
		predictor: predictor
	}, predictor.accountsByHash || {});
}

/* THE ORDINARY, SINGLE-THREADED ENTRY POINT - unchanged in every observable way. Every existing
   caller (the audit pages, the tests, the bench) keeps calling this exactly as before. */
export function accountLedgers(portfolio, until, opts){
	const o = opts || {};
	const predictor = o.predictor || new StreamPredictor(portfolio);
	return assembleLedgers(portfolio, predictor, until, opts,
		(stream, stop, asOf) => predictor.scheduleOf(stream.id, stop, stream, {asOf: asOf}));
}

/* THE PARALLEL ENTRY POINT. Every stream's `scheduleOf` is independent of every other's - see the
   header on scheduleWorker.js - so `scheduleParallel()` answers the whole in-scope list at once,
   spread across a small worker pool, and this assembles the SAME ledger `accountLedgers()` would
   from the SAME answers. `key` identifies the portfolio capture and the `asOf` the answers are good
   for, so the pool only resends the (large) portfolio JSON when that identity changes - see
   schedulePool.js.

   FALLS BACK TO THE ORDINARY LOOP, never throws for the mere absence of workers. `scheduleParallel`
   resolves `null` when no pool could be built (no `Worker`, jsdom under a test, a browser that
   refused one) - this reads that as "compute it here instead", so the promise this returns still
   resolves with the right answer, only without the speedup. A worker that itself threw on real data
   is a different case and is allowed to reject, same as a synchronous bug would throw. */
export async function accountLedgersAsync(portfolio, until, opts){
	const o = opts || {};
	const predictor = o.predictor || new StreamPredictor(portfolio);
	const asOf = o.asOf ? new Date(o.asOf) : new Date(predictor.analysisNow());
	const streams = inScope(predictor, asOf);
	const key = (portfolio.capturedAt || '') + '|' + asOf.getTime();

	const parallel = streams.length
		? await scheduleParallel(portfolio, streams.map(s => s.id), until, asOf, o.scheduleOpts, key)
		: null;

	return assembleLedgers(portfolio, predictor, until, opts, (stream, stop, streamAsOf) =>
		(parallel && parallel[stream.id])
			|| predictor.scheduleOf(stream.id, stop, stream, {asOf: streamAsOf}));
}

export default accountLedgers;
