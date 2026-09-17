/* ==================================================================================================
   THE NEW MODULE, SHAPED FOR THE BENCH'S SCORER.

   THE BENCH SCORES ONE THING: a map of day -> net money moved on the covered accounts, over a window
   it chose, forecast without having seen inside it. That is the whole seam between the two
   algorithms, so it is the whole of this file - everything else about the bench's report is left
   alone and both answers are judged by the same arithmetic.

   THE REWIND IS THE OUT-OF-SAMPLE GUARANTEE, and it is structural rather than a rule to remember.
   The capture is truncated at the window's opening day and its own `today` set back, so there is no
   path by which a later transaction can reach any stage: the cycle reading, the shape, the schedule
   and the amplitude correction are all built from a portfolio in which the window has not happened.
   A flag on each stage saying "do not look past here" would be the same idea and would have to be
   honoured in eight places.

   THE CORRECTION IS MEASURED INSIDE THE REWIND, not on the full ledger. Calibrating from cycles the
   window's own spending helped measure is the same leak by a slower route: the multiplier would
   carry the answer even though no event did.

   WHAT IS SCORED IS WHAT MOVES THE COVERED BALANCE. A charge on a card does not move the checking
   account - the repayment does - so card charges are excluded and settlements are in. That is the
   same accounting the legacy model does with `extraFlow`, which is why the two are comparable.
   ================================================================================================== */

import {accountLedgers} from './accountLedger';
import {calibrate} from './calibration';
import {withLoop} from './inCycle';

const dayKey = d => new Date(d).toISOString().slice(0, 10);

/* ---- ONE BUILD, READ TWICE ------------------------------------------------------------------------
   THE CORRECTION IS MEASURED FROM THE BUILD IT CORRECTS, not from a second set of rewound runs. The
   first pass gives the ledger and the forward claim; the correction is one walk over that account's
   own posted history; the second pass applies it. Two builds instead of ten, and the second is the
   only part that has to happen twice.

   A BUILD IS STILL CACHED AGAINST ITS AS-OF DATE, because a chart drawing a live line and a
   benchmark line asks the same question of the same day more than once. */
const measured = new WeakMap();

function cachedBuild(portfolio, cut, close, o){
	const key = cut.getTime() + '|' + new Date(close).getTime() + '|' + (o.seamDay || 21)
		+ '|' + (o.loop === false ? 'flat' : 'ab');
	let mine = measured.get(portfolio);
	if(!mine){mine = {}; measured.set(portfolio, mine)}
	if(mine[key] === undefined){
		const rewound = rewind(portfolio, cut);
		/* THE MEASURING BUILD RUNS PAST THE CALLER'S HORIZON, because the correction's denominator is
		   one WHOLE cycle of the forecast and the caller may only have asked for three weeks. A
		   denominator cut off by the question being asked would read as an under-read and land in
		   the multiplier. Seventy-five days always contains a whole cycle after the next seam. */
		const measureTo = new Date(Math.max(new Date(close).getTime(),
			cut.getTime() + 75 * 24 * 3600 * 1000));
		const plain = accountLedgers(rewound, measureTo, {asOf: cut});
		let calibration = o.calibrate === false ? {}
			: calibrate(plain, {seamDay: o.seamDay || 21, cycles: o.cycles});
		//and b, the premium the open cycle is running at. `loop: false` measures a alone.
		if(o.loop !== false && Object.keys(calibration).length)
			calibration = withLoop(plain, calibration, {seamDay: o.seamDay || 21});
		/* THE SAME PREDICTOR, NOT A SECOND ONE. `plain`'s own build already ran every stream's
		   schedule from `cut` - the calibrated build asks the same streams the same question from
		   the same asOf, only trimmed to a different `until` and with the correction applied
		   afterward, so there is nothing left for a fresh StreamPredictor to earn back. Passing it
		   on turns scheduleOf's per-stream cache from a miss into a hit for every one of them. */
		mine[key] = {
			calibration: calibration,
			built: Object.keys(calibration).length
				? accountLedgers(rewound, close,
					{asOf: cut, calibration: calibration, predictor: plain.predictor})
				: plain,
			history: (rewound.transactions || []).length
		};
	}
	return mine[key];
}

/* THE CAPTURE AS IT STOOD ON THE DAY THE WINDOW OPENED. */
export function rewind(portfolio, at){
	const cut = new Date(at);
	return Object.assign({}, portfolio, {
		today: cut.toISOString(),
		capturedAt: cut.toISOString(),
		transactions: (portfolio.transactions || []).filter(t =>
			new Date(t.date).getTime() <= cut.getTime())
	});
}

/* ---- THE FORECAST, AS DAILY FLOWS ---------------------------------------------------------------
   `covered` is the set of account hashes the bench's balance is about. `seamDay` is the analysis
   anchor's day of the month, which is the lattice every cycle in the module is phased on. */
export function benchForecast(portfolio, open, close, covered, opts){
	const o = opts || {};
	const cut = new Date(open);
	const keep = {};
	(covered || []).forEach(h => {keep[h] = true});

	const run = cachedBuild(portfolio, cut, close, o);
	const calibration = run.calibration;
	const built = run.built;

	/* EVERY PREDICTED MOVEMENT ON AN ACCOUNT THE BENCH IS SCORING, summed by day. Posted rows are
	   what already happened and the bench reads those from its own ledger; including them here would
	   count the same money twice. */
	const flow = {};
	//and the movements themselves, so a reader asking "what made this day" gets the module's answer
	const rows = {};
	let events = 0, settlements = 0;
	built.accounts.forEach(a => {
		if(!keep[a.accountId])return;
		a.ledger.forEach(e => {
			if(e.source === 'posted')return;
			const t = e.date.getTime();
			if(t < cut.getTime() || t > new Date(close).getTime())return;
			const k = dayKey(e.date);
			flow[k] = (flow[k] || 0) + e.amount;
			(rows[k] = rows[k] || []).push({
				name: e.streamName || e.label || 'repayment',
				amount: e.amount,
				kind: e.kind || null,
				source: e.source,
				refused: e.refused || null
			});
			events++;
			if(e.source === 'settlement')settlements++;
		});
	});
	//biggest first, the order a reader checks a day in
	Object.keys(rows).forEach(k =>
		rows[k].sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount)));

	/* THE CUMULATIVE CURVE THIS FORECAST DRAWS, from a balance the caller knows on `open`. One point
	   per day the balance moves, which is what a step chart is made of. */
	const seriesFrom = balance => {
		let v = balance;
		return Object.keys(flow).sort().map(k => {
			v += flow[k];
			return {date: new Date(k + 'T00:00:00.000Z'), value: v};
		});
	};

	return {
		flow: flow,
		rows: rows,
		seriesFrom: seriesFrom,
		built: built,
		calibration: calibration,
		events: events,
		settlements: settlements,
		//how much of the ledger the rewind had left to learn from, so a thin answer says it is thin
		history: run.history,
		streams: built.streams,
		asOf: cut,
		until: new Date(close)
	};
}

export default benchForecast;
