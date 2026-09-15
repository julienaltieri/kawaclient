/* ==================================================================================================
   HOW MUCH THE FORECAST UNDER-READS AN ACCOUNT, MEASURED AGAINST ITS OWN PAST.

   THE PREDICTABLE PART OF A CARD IS NOT ALL OF IT. Routine spending scatters across payees and
   streams that never earn a shape, so the forecast reproduces the rhythm and undershoots the
   amplitude: the card's sawtooth is the right shape and too small. A single number per account fixes
   the amplitude without pretending to know what the missing charges were.

   MEASURED AGAINST THE ACCOUNT'S OWN PAST, IN ONE PASS. The question is about an ACCOUNT, never
   about any one stream: how much of what lands here does the module's rhythm account for. So the
   numerator is what each past cycle actually spent, and the denominator is what the module says a
   cycle on this account looks like - one forward reading the caller already has, walked against the
   ledger. Both sides are linear in the ledger, so this can run every time a balance is drawn.

   IT USED TO REWIND THE WHOLE CAPTURE ONCE PER CYCLE and re-read all sixty-four streams each time:
   eight full rebuilds, 2.4 of the 4 seconds a forecast cost, and the cost grew with the history
   asked for. It also needed a rule to discard the cycles where the rewind had run out of ledger and
   forecast almost nothing - a defect of the measurement rather than a fact about the account. With
   one denominator that rule has nothing left to do and is gone.

   A IS WHAT A QUIET CYCLE LOOKS LIKE, NOT WHAT AN AVERAGE ONE DOES. The correction has two jobs and
   they belong to different windows. The BASELINE is the share of this account that never earns a
   shape - groceries, small scatter - and it is a property of the arrangement, steady month to month.
   A BURST is a holiday, and it is temporary by definition. A median over twelve cycles mixes them:
   measured against the card with the trip removed by hand the baseline is 1.84, and the median of
   all twelve reads 1.95 because one month in ten is Tahiti. One month in three and it would read far
   worse. A low quantile answers the baseline question directly - "what does this account look like
   when nothing is happening" - and lands on 1.85.

   THE BURST IS NOT MEASURED HERE. It is `b`, and it is read from the cycle currently open rather
   than from completed ones, because a trip is happening now and a completed-cycle window cannot see
   it. See inCycle.js.

   WHAT IS GIVEN UP, SAID PLAINLY: the denominator is the module as it reads TODAY applied to every
   past cycle, rather than the module as it would have read at the start of each one. That is the
   right question for an amplitude - "what share of this account does my rhythm cover" is a property
   of the account and the reading, not of any one month - but it is not out of sample, and it must
   never be used to SCORE a forecast. Scoring is the bench's job, and the bench rewinds.

   LARGE OUTLIERS COME OUT OF THE ACTUAL SIDE. A holiday is not an under-read, it is an event nobody
   could forecast, and leaving it in would teach the multiplier to expect a trip every month. The cut
   is a percentile of the account's own charge sizes, so a card whose ordinary charge is $40 and one
   whose ordinary charge is $4,000 are each judged against themselves.

   IT ENGAGES ONLY WHERE THE BIAS IS ONE-SIDED. On the captured portfolio the card runs above one in
   eight cycles out of eight and earns a multiplier; the current account straddles one - 0.47, 0.99,
   1.20, 1.79 - so its forecast is already unbiased and scaling it would add noise to an answer that
   does not need it. A calibration that fires on noise is worse than none.

   AND A CYCLE THE REWIND COULD NOT FORECAST IS NOT EVIDENCE. Rewound far enough the predictor has a
   few months of ledger and forecasts almost nothing, which produces ratios in the hundreds. Those
   cycles say the rewind ran out of history, not that the account is under-read.

   THE CUT APPLIES TO BOTH SIDES OF THE RATIO, AND TO WHAT THE MULTIPLIER IS LATER APPLIED TO. It
   used to come off the actual side only, so a month of ordinary spending was compared against a
   forecast that included a $2,626 instalment - and the ratio measured the size of the lump rather
   than the size of the under-read. Worse, the multiplier was then applied to that instalment: a
   charge the module already predicts correctly, scaled by a factor measured on groceries. Below the
   cut is the only place this correction was ever measured and the only place it may act.
   ================================================================================================== */

/* THE SEAM LATTICE, the same one every cycle in the module is phased on, walked backwards. */
function seamsBack(asOf, seamDay, count){
	const out = [];
	const end = new Date(asOf);
	let s = new Date(end.getFullYear(), end.getMonth(), seamDay);
	if(s.getTime() > end.getTime())s.setMonth(s.getMonth() - 1);
	for(let k = 0; k < count; k++){
		const from = new Date(s.getTime());
		from.setMonth(from.getMonth() - 1);
		out.push({from: from.getTime(), to: s.getTime()});
		s = from;
	}
	return out;
}

const DEFAULTS = {
	/* THE PERCENTILE OF AN ACCOUNT'S OWN CHARGE SIZES above which a charge is an event rather than a
	   rate. Measured on the card, where the cut decides how much of the spending the correction is
	   asked to reproduce:

	       90%    $141    46% of the money kept    x1.36    reproduces 47%
	       95%    $200    56%                      x1.54    54%
	       99%  $1,000    72%                      x1.92    67%
	      100%  $4,000   100%                      x2.50    87%  (clamped)

	   AT 95% THE CUT WAS $200, which on this card is an ordinary shop rather than an event - two
	   fifths of the money was being written off as unforecastable when most of it is routine. At 99%
	   the cut is $1,000 and what falls outside it is the holiday and the one-off invoice, which is
	   what this is meant to exclude. */
	outlierPercentile: 0.99,
	/* WHICH CYCLE OF THE MEASURED HISTORY STANDS FOR A QUIET ONE. At the median, one trip month in
	   ten pulls the baseline 6% high; at the quarter it takes three trip months in ten to move it at
	   all. Measured against the card with the trip removed by hand: truth 1.84, quarter 1.85, median
	   1.95. Anything from 0.2 to 0.33 lands within 1% on this portfolio, so the value is chosen for
	   how much travel it tolerates rather than by a difference it can see. */
	baselineQuantile: 0.25,
	//how much of the measured history must sit above one before a multiplier is believed
	minAgreement: 0.75,
	//how far a multiplier may go, so one strange portfolio cannot double an account's spending
	maxMultiplier: 2.5,
	//how many usable cycles are needed before any of this is worth doing
	minCycles: 4,
	//how far back the account's own history is walked
	cycles: 12,
	//the lattice every cycle in the module is phased on; the caller that knows it passes its own
	seamDay: 21
};

const quantile = (xs, q) => {
	if(!xs.length)return null;
	const s = xs.slice().sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};

/* ---- ONE ACCOUNT -------------------------------------------------------------------------------- */
export function calibrationFor(charges, cycles, cfg){
	const c = Object.assign({}, DEFAULTS, cfg || {});
	const sizes = charges.map(e => Math.abs(e.amount)).sort((a, b) => a - b);
	const cut = sizes.length
		? sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * c.outlierPercentile))]
		: Infinity;

	const rows = [];
	(cycles || []).forEach(cy => {
		const actual = charges
			.filter(e => e.date.getTime() >= cy.from && e.date.getTime() < cy.to
				&& Math.abs(e.amount) <= cut)
			.reduce((n, e) => n + e.amount, 0);
		/* SMALL AGAINST SMALL, ON BOTH SIDES. A charge above the cut was left out of the measurement
		   for being an event rather than a rate, and it is left out of the claim for the same
		   reason - otherwise the ratio measures the size of the lumps. A caller handing over a
		   pre-summed `forecast` is taken at its word, which is what the unit tests do when they are
		   exercising the ratio logic rather than the cut. */
		const forecast = cy.rows
			? cy.rows.filter(r => Math.abs(r.a) <= cut).reduce((n, r) => n + r.a, 0)
			: cy.forecast;
		if(!forecast || !actual)return;
		rows.push({from: cy.from, actual: actual, forecast: forecast,
			ratio: actual / forecast});
	});

	//a cycle in which nothing was spent is not evidence either way, and dropped itself above
	const usable = rows;

	if(usable.length < c.minCycles)
		return {multiplier: 1, reason: 'too few cycles to measure', cycles: usable.length,
			cut: cut, rows: rows};

	const ratios = usable.map(r => r.ratio);
	const above = ratios.filter(r => r > 1).length / ratios.length;
	//the quiet cycle, not the average one - see baselineQuantile
	const mid = quantile(ratios, c.baselineQuantile);

	if(above < c.minAgreement)
		return {multiplier: 1, reason: 'no one-sided bias', agreement: above,
			measured: mid, cycles: usable.length, cut: cut, rows: rows};

	return {
		multiplier: Math.max(1, Math.min(c.maxMultiplier, mid)),
		measured: mid,
		agreement: above,
		cycles: usable.length,
		cut: cut,
		rows: rows
	};
}

/* ---- EVERY ACCOUNT, FROM ONE BUILD ----------------------------------------------------------------
   THE DENOMINATOR IS ONE CYCLE OF THE FORECAST THE CALLER ALREADY HAS, pro-rated to each past
   cycle's own length so a 28-day February is not read as a quiet month.

   IT IS THE UNCALIBRATED AMOUNT wherever a correction has already been applied, because a multiplier
   measured against its own output compounds on every pass.

   `built` is an `accountLedgers` result. Nothing is rewound and nothing is re-forecast. */
export function calibrate(built, cfg){
	/* AN ABSENT OPTION IS NOT AN OPTION SET TO NOTHING. `Object.assign` copies an explicit
	   `undefined` straight over the default, so a caller forwarding `{cycles: opts.cycles}` for an
	   option nobody set walked zero cycles and every account declined for want of evidence. */
	const given = {};
	Object.keys(cfg || {}).forEach(k => {if(cfg[k] !== undefined)given[k] = cfg[k]});
	const c = Object.assign({}, DEFAULTS, given);
	const accounts = (built && built.accounts) || built || [];
	const asOf = new Date((built && built.asOf) || Date.now());
	const windows = seamsBack(asOf, c.seamDay, c.cycles);
	const out = {};

	accounts.forEach(acc => {
		const charges = acc.ledger.filter(e => e.source === 'posted' && !e.repayment
			&& e.amount < 0);
		if(!charges.length)return;

		/* WHAT THE MODULE SAYS A CYCLE HERE LOOKS LIKE. THE FIRST WHOLE CYCLE AFTER THE CAPTURE, and
		   the word whole is the whole of it. The cycle the capture landed in is part spent: its
		   forecast covers only the days left in it, and read as a full month it understates the
		   claim by however far through the month the capture was taken - which lands straight in the
		   multiplier as an under-read that is really a calendar. */
		const opened = new Date(windows.length ? windows[0].to : asOf.getTime());
		opened.setMonth(opened.getMonth() + 1);
		const from = opened.getTime();
		const edge = new Date(from);
		edge.setMonth(edge.getMonth() + 1);
		const span = edge.getTime() - from;
		const claim = acc.ledger
			.filter(e => e.source === 'predicted' && !e.repayment
				&& e.date.getTime() >= from && e.date.getTime() < edge.getTime())
			.map(e => ({a: e.uncalibrated === undefined ? e.amount : e.uncalibrated}))
			.filter(r => r.a < 0);

		/* A CYCLE THE LEDGER ONLY PARTLY COVERS IS NOT EVIDENCE. The oldest window reaches back past
		   the first transaction this account has, so its actual is a fraction of a month measured
		   against a whole one - which reads as an over-forecast and drags the median down. The card's
		   twelfth cycle back came in at 0.66 against a run of ratios near 1.9. */
		const begins = charges.reduce((n, e) => Math.min(n, e.date.getTime()), Infinity);
		const cycles = windows.filter(w => w.from >= begins).map(w => ({
			from: w.from, to: w.to,
			//the same claim, pro-rated to this cycle's own length
			rows: claim.map(r => ({a: r.a * ((w.to - w.from) / span)}))
		}));
		out[acc.accountId] = calibrationFor(charges, cycles, cfg);
	});
	return out;
}

export default calibrate;
