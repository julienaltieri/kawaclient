/* ==================================================================================================
   b — THE PREMIUM THIS CYCLE IS RUNNING AT, MEASURED FROM THE CYCLE CURRENTLY OPEN.

   THE CORRECTION IS TWO NUMBERS BECAUSE IT ANSWERS TWO QUESTIONS. `a` is the baseline: the share of
   an account that never earns a shape, steady month to month, read off a quiet cycle in
   calibration.js. `b` is what is happening now: a holiday, a move, a month of medical bills. The
   final multiplier is a x b.

   b CANNOT BE READ FROM COMPLETED CYCLES, and this is the whole reason it lives here. A trip is
   inside the cycle you are standing in. Measured over six mornings through Tahiti, a `b` built from
   the last COMPLETED cycle was blind to it and bought 1.1 points; read from the open cycle it bought
   10.4. The ground-truth premium for that month was 1.81, and this reads 1.58 to 2.31 as the trip
   becomes visible.

   THE ERROR IS OBSERVABLE EVERY DAY, and nothing is currently reading it. Part-way through a cycle
   the ledger already knows what this account has been charged so far, and the module already knows
   what it claimed a whole cycle would look like. The ratio between what was expected by now and what
   has actually landed is a MEASUREMENT, not an inference, and it is available at every refresh.

   SO THE REMAINDER OF THE CYCLE IS SCALED BY IT. A cycle running at twice its usual rate ten days in
   is a cycle that will probably keep running hot, and the card bill at the end of it will be bigger
   than the rhythm says. This is the integral term of a controller with a real error signal - and
   unlike the multiplier it expires at the seam, because next cycle is not this one.

   IT ONLY ACTS ON THE REST OF THE CURRENT CYCLE. Charges already posted need no help - they are
   facts, and the settlement formula already clears them. Cycles beyond this one get the multiplier
   alone, because there is no observation about them to close a loop on.

   WHAT IT CANNOT DO: a forecast made on day one of a cycle has nothing to measure, and says so by
   returning 1. This is worth most to a reading remade every morning and least to a single thirty-day
   forecast held for a month - which is what the bench scores, so the bench understates it.
   ================================================================================================== */

const ONE_DAY = 24 * 60 * 60 * 1000;

export const LOOP = {
	//below this share of the cycle elapsed there is too little landed to read a rate from
	minElapsed: 0.2,
	/* HOW FAR b MAY GO, AND IT IS THE ONE NUMBER HERE THAT IS TUNED RATHER THAN MEASURED. The card
	   and the account that pays it want different things, and the cap is where they meet - measured
	   over six mornings through Tahiti, 21 days ahead each:

	       b cap        card    checking
	       none (a only) 67.0%    30.7%
	       3.0           65.5%    41.1%
	       2.5           65.5%    41.1%
	       2.0           67.3%    39.8%   <- the only setting better than `a` alone on BOTH
	       1.6           69.5%    36.7%

	   Loose, and the card's own sawtooth overshoots while the repayments it funds get closer; tight,
	   and the reverse. Two is also just above the premium this trip actually ran at, 1.81 measured
	   with the trip removed by hand - so the cap binds on noise rather than on real bursts. */
	maxFactor: 2,
	minFactor: 0.5,
	//a cycle needs some movements in it before a rate means anything
	minCharges: 3,
	/* AND THE ACCOUNT HAS TO BE A RATE, NOT A DIARY. Measured: the card runs at 1.14 of its expected
	   rate ten days in, which reads correctly; the current account reads 0.33 and is clamped there,
	   because two thirds of what it claims is rent and day care on dated days that had not arrived
	   yet. Pro-rating a claim linearly through the cycle assumes the money accrues evenly, which is
	   true of scatter and false of bills - and a loop that does not know the difference cuts rent by
	   two thirds for want of evidence it was never going to have.

	   So the loop acts only where most of the claim is rate-shaped. That is also exactly the spending
	   the amplitude correction exists for, which is the sign that both belong to the same question. */
	minRateShare: 0.6
};

/* THE CYCLE THE CAPTURE LANDED IN, on the seam lattice everything else is phased on. */
export function currentCycle(asOf, seamDay){
	const d = new Date(asOf);
	const start = new Date(d.getFullYear(), d.getMonth(), seamDay);
	if(start.getTime() > d.getTime())start.setMonth(start.getMonth() - 1);
	const end = new Date(start.getTime());
	end.setMonth(end.getMonth() + 1);
	return {from: start.getTime(), to: end.getTime()};
}

/* ---- ONE ACCOUNT ---------------------------------------------------------------------------------
   `claimPerCycle` is what the module says a whole cycle on this account costs, already corrected by
   the multiplier - the same quantity the amplitude correction uses as its denominator. */
export function loopFor(acc, asOf, claimPerCycle, cut, cfg, rateShare){
	const c = Object.assign({}, LOOP, cfg || {});
	const cycle = currentCycle(asOf, c.seamDay || 21);
	const at = new Date(asOf).getTime();
	const elapsed = (at - cycle.from) / (cycle.to - cycle.from);
	const base = {cycle: cycle, elapsed: elapsed, factor: 1, rateShare: rateShare};

	if(elapsed < c.minElapsed)return Object.assign(base, {reason: 'too early in the cycle'});
	if(!claimPerCycle)return Object.assign(base, {reason: 'nothing claimed for this cycle'});
	if(!(rateShare >= c.minRateShare))
		return Object.assign(base, {reason: 'this account is bills, not a rate'});

	const landed = acc.ledger.filter(e => e.source === 'posted' && !e.repayment && e.amount < 0
		&& Math.abs(e.amount) <= cut
		&& e.date.getTime() >= cycle.from && e.date.getTime() <= at);
	if(landed.length < c.minCharges)
		return Object.assign(base, {reason: 'too few charges to read a rate'});

	const posted = landed.reduce((n, e) => n + e.amount, 0);
	const expected = claimPerCycle * elapsed;
	const raw = posted / expected;
	return Object.assign(base, {
		factor: Math.max(c.minFactor, Math.min(c.maxFactor, raw)),
		raw: raw,
		posted: posted,
		expected: expected,
		charges: landed.length
	});
}

/* ---- EVERY ACCOUNT -------------------------------------------------------------------------------
   Handed a plain build and the calibration measured from it, this returns the same calibration with
   a `boost` attached: the window it applies to and the factor to apply inside it. `accountLedgers`
   reads that when it scales the predicted charges. */
export function withLoop(built, calibration, cfg){
	const c = Object.assign({}, LOOP, cfg || {});
	const asOf = new Date(built.asOf);
	const cycle = currentCycle(asOf, c.seamDay || 21);
	const out = {};

	(built.accounts || []).forEach(acc => {
		const k = calibration[acc.accountId];
		if(!k)return;
		const m = k.multiplier || 1;
		const cut = k.cut === undefined ? Infinity : k.cut;

		/* WHAT A WHOLE CYCLE CLAIMS, corrected. The first whole cycle after the capture is the only
		   one the ledger carries claims for end to end; the cycle the capture landed in is part
		   spent, which is the whole point of what follows. */
		const whole = {from: cycle.to};
		const edge = new Date(cycle.to);
		edge.setMonth(edge.getMonth() + 1);
		whole.to = edge.getTime();
		const rows = acc.ledger
			.filter(e => e.source === 'predicted' && !e.repayment && e.amount < 0
				&& Math.abs(e.uncalibrated === undefined ? e.amount : e.uncalibrated) <= cut
				&& e.date.getTime() >= whole.from && e.date.getTime() < whole.to);
		const raw = e => (e.uncalibrated === undefined ? e.amount : e.uncalibrated);
		const claim = rows.reduce((n, e) => n + raw(e) * m, 0);
		//how much of what this account claims accrues evenly rather than landing on a named day
		const all = rows.reduce((n, e) => n + Math.abs(raw(e)), 0);
		const rate = rows.filter(e => e.kind === 'rate')
			.reduce((n, e) => n + Math.abs(raw(e)), 0);

		const loop = loopFor(acc, asOf, claim, cut, c, all ? rate / all : 0);
		out[acc.accountId] = Object.assign({}, k, {
			loop: Object.assign({claimPerCycle: claim}, loop),
			boost: loop.factor === 1 ? null
				: {from: new Date(asOf).getTime(), to: cycle.to, factor: loop.factor}
		});
	});
	return out;
}

export default withLoop;
