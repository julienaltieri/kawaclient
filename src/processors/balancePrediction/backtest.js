/* ==================================================================================================
   WHAT WOULD IT HAVE SAID THEN?

   A FORECAST COMPARED AGAINST A DIFFERENT MONTH ANSWERS NOTHING. Last month held a holiday and next
   month does not, so every difference has two causes mixed together and neither can be measured. The
   only honest check is the same month twice: what was predicted for it, and what happened in it.

   THE LEDGER HAS TO BE REWOUND, NOT JUST THE DATE. Moving the evaluation date alone leaves the
   predictions built from transactions that have not happened yet, and a forecast that has already
   seen the answer is worth nothing. So the capture is truncated at the seam - transactions cut, its
   own `today` set back - and the predictor is rebuilt from it.

   PROVED ON GEMBAH. Rewound to the end of June, four instalments into a ten-thousand plan, the
   module forecasts the fifth at -2,626 on 28 July - the right day and the right amount - and then
   refuses every one after it because the plan is spent. Read from today it says nothing about
   Gembah at all, correctly, because by today it is over.
   ================================================================================================== */

import {accountLedgers} from './accountLedger';

/* THE SEAM THE CYCLES ARE CUT ON, which is the analysis anchor's day of the month - the same lattice
   every prediction is built against. */
export function cycleSeam(at, seamDay, step){
	const d = new Date(at);
	const s = new Date(d.getFullYear(), d.getMonth(), seamDay);
	if(s.getTime() > d.getTime())s.setMonth(s.getMonth() - 1);
	s.setMonth(s.getMonth() + (step || 0));
	return s;
}

/* ONE REWIND: the capture as it stood at `at`, and what it forecast for the cycle that followed. */
export function forecastAt(portfolio, at, until){
	const cut = new Date(at);
	const trimmed = Object.assign({}, portfolio, {
		today: cut.toISOString(),
		capturedAt: cut.toISOString(),
		transactions: (portfolio.transactions || []).filter(t =>
			new Date(t.date).getTime() <= cut.getTime())
	});
	return accountLedgers(trimmed, until, {asOf: cut});
}

/* EVERY WHOLE CYCLE BEHIND THE CAPTURE, each forecast from its own start. */
export function backtests(portfolio, asOf, seamDay, cycles){
	const out = [];
	for(let k = 1; k <= (cycles || 6); k++){
		const from = cycleSeam(asOf, seamDay, -k);
		const to = cycleSeam(asOf, seamDay, -k + 1);
		if(!(portfolio.transactions || []).some(t =>
			new Date(t.date).getTime() <= from.getTime()))break;
		const built = forecastAt(portfolio, from, to);
		out.push({
			from: from.getTime(),
			to: to.getTime(),
			accounts: built.accounts.map(a => ({
				id: a.accountId,
				/* PREDICTED CHARGES AND THE SETTLEMENTS THAT CLEAR THEM. A forecast half is only
				   comparable to an actual half if both carry the repayments; leaving them out of
				   one side draws a card that is spent on and never paid off. */
				rows: a.ledger.filter(e => e.source !== 'posted'
					&& e.date.getTime() >= from.getTime() && e.date.getTime() < to.getTime())
					.map(e => ({t: e.date.getTime(),
						a: Math.round(e.amount * 100) / 100,
						k: e.kind,
						w: e.label,
						n: e.streamName || null}))
			}))
		});
	}
	return out;
}

export default backtests;
