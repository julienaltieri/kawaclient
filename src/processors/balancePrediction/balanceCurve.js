/* ==================================================================================================
   §5 — TURNING A LEDGER INTO BALANCES.

   A LEDGER GIVES DISPLACEMENTS. One balance that is true on one date turns the whole series into
   amounts, in both directions: later balances are the anchor plus what follows it, earlier ones the
   anchor less what preceded it. So the arithmetic is one cumulative sum with an offset chosen to
   make the running total equal the anchor on the day the anchor is true.

   THE SIGN IS THE AGGREGATOR'S, AND A CARD'S IS THE OTHER WAY UP. A card's `current` counts what is
   OWED, so it reads positive while the account is in debt; every charge in this ledger is negative
   and every repayment positive. The two conventions are reconciled once, here, rather than in each
   caller: a deferred account's anchor is minus its reported balance.

   WHAT THIS CANNOT DO YET. The spec asks for the most recent CLOSING balance that agrees with the
   ledger, falling back a day where it does not - the guard against a balance read before a
   transaction of the same day had posted. That needs a balance with a date on it, and better a short
   history of them; the capture carries one number per account and no date at all. So the anchor is
   the reported balance taken as true at the capture date, and the ambiguity it cannot rule out is
   reported rather than hidden: `sameDay` counts the transactions posted on the anchor's own date,
   which is exactly when a reported balance may or may not include them.
   ================================================================================================== */

import {AccountKind} from '../streamPredictor/accountMapping';

const iso = d => new Date(d).toISOString().slice(0, 10);

/* ---- THE ANCHOR ---------------------------------------------------------------------------------- */
export function anchorFor(account, kind, asOf){
	if(!account || account.current === undefined || account.current === null)return null;
	const owed = kind === AccountKind.deferred;
	return {
		balance: owed ? -account.current : account.current,
		at: new Date(asOf),
		reported: account.current,
		available: account.available === undefined ? null : account.available,
		//the reported balance is a number with no date on it; this says what it was taken to mean
		source: 'reported',
		flipped: owed
	};
}

/* ---- THE CURVE -----------------------------------------------------------------------------------
   ONE POINT PER DATE THE BALANCE CHANGES, not per entry: three charges on one day move the balance
   once, and a reader asking "what was it on the 4th" wants one answer. */
export function balancePoints(ledger, anchor, asOf){
	const rows = (ledger || []).slice().sort((a, b) => a.date - b.date);
	if(!rows.length)return {points: [], closing: anchor ? anchor.balance : 0, opening: null};

	const at = new Date(asOf).getTime();
	let cum = 0;
	const running = rows.map(e => {
		cum += e.amount;
		return {date: e.date, cum: cum};
	});

	/* THE OFFSET THAT MAKES THE ANCHOR TRUE. Everything posted up to and including the anchor's date
	   has already happened, so the running total at that point IS the anchor's balance. */
	let k = -1;
	for(let i = 0; i < rows.length; i++)if(rows[i].date.getTime() <= at)k = i;
	const offset = (anchor ? anchor.balance : 0) - (k >= 0 ? running[k].cum : 0);

	const points = [];
	running.forEach(r => {
		const balance = r.cum + offset;
		const last = points[points.length - 1];
		if(last && iso(last.date) === iso(r.date))last.balance = balance;
		else points.push({date: r.date, balance: balance});
	});

	return {
		points: points,
		opening: points.length ? points[0].balance : null,
		closing: points.length ? points[points.length - 1].balance : (anchor ? anchor.balance : 0)
	};
}

/* ---- FOR EVERY ACCOUNT ---------------------------------------------------------------------------- */
export function pinBalances(built, accountsByHash){
	(built.accounts || []).forEach(acc => {
		const account = (accountsByHash || {})[acc.accountId];
		const anchor = anchorFor(account, acc.accountType, built.asOf);
		const curve = balancePoints(acc.ledger, anchor, built.asOf);
		acc.anchor = anchor;
		acc.points = curve.points;
		acc.opening = curve.opening;
		acc.closing = curve.closing;
		//the one ambiguity a single undated balance cannot resolve
		acc.sameDay = acc.ledger.filter(e => e.source === 'posted'
			&& iso(e.date) === iso(built.asOf)).length;
	});
	return built;
}

export default pinBalances;
