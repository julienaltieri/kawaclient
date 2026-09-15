/* ==================================================================================================
   THE LIVE PORTFOLIO, IN THE SHAPE THE PREDICTOR READS.

   THE PREDICTION MODULES TAKE PLAIN JSON AND NOTHING ELSE. That is a hard constraint, not a
   convenience: model.js and core.js need a browser and a logged-in user, and an algorithm that
   cannot be run under node cannot be checked. So the boundary between the app and the module is one
   object, and this file is the only place that knows both sides of it.

   IT IS THE SAME OBJECT THE TEST FIXTURE HOLDS. `src/tests/fixtures/portfolio.json` is one of these,
   written out on a day in September; a difference between what this builds and what that file
   contains is a difference between what the module is tested on and what it runs on, which is the
   one bug this file exists to make impossible.

   THE MODEL INSTANCES ARE THEIR OWN JSON. A Stream carries exactly the fields it was built from and
   the server is handed the instance to save, so a structural clone is the serialisation - not a
   hand-written mapping that would need updating every time a field is added.
   ================================================================================================== */

import Core from '../core.js';

const clone = x => JSON.parse(JSON.stringify(x));

/* ---- ONE CAPTURE PER PAGE LOAD --------------------------------------------------------------------
   THE SAME INPUTS MUST GIVE BACK THE SAME OBJECT, not an equal one. Two components on a page each
   ask for the portfolio, and the structural clone of twelve hundred transactions is the cheap half
   of what follows: every cache downstream is keyed on the portfolio OBJECT, so two equal captures
   mean every forecast measured against one of them gets measured all over again against the other.

   THE KEY IS THE IDENTITY OF THE TRANSACTIONS PLUS WHAT THE ACCOUNTS SAY. The transactions arrive as
   one array from Core and are passed down by reference, so identity is exact and free. The accounts
   arrive from a separate fetch per component, so they are compared by the fields a forecast actually
   reads. Hashing the ledger to save a lookup would cost more than the clone it saves. */
let held = null;

const fingerprint = (accounts, at, day) => [at ? at.getTime() : 0, day].concat(
	(accounts || []).map(a => [a.hash, a.current, a.available].join(':'))).join('|');

/* WHICH DAY OF THE MONTH THE CARDS ARE PAID ON, by weight of money rather than count of payments:
   the same reading the bench has always used, kept here so both algorithms are told the same thing. */
function settlementDayOf(transactions, cards){
	if(!cards || !cards.length)return undefined;
	const byDay = new Array(32).fill(0);
	(transactions || []).forEach(t => {
		if(cards.indexOf(t.userInstitutionAccountId) < 0 || t.amount <= 0)return;
		byDay[new Date(t.date).getUTCDate()] += t.amount;
	});
	let best = 0, day;
	byDay.forEach((v, i) => {if(v > best){best = v; day = i}});
	return day;
}

/* ---- THE CAPTURE ---------------------------------------------------------------------------------
   `today` IS A PARAMETER, not the wall clock. Every stage below reads it as "now", so a caller
   rewinding the portfolio to score a past window sets it here and gets a module that has never seen
   past that day. Defaulting it to the clock would make the answer a function of when it was run. */
export function capturePortfolio(transactions, accounts, opts){
	const o = opts || {};
	const ud = Core.getUserData() || {};
	const at = o.today ? new Date(o.today) : new Date();
	const txns = transactions || [];
	const mark = fingerprint(accounts, at, o.settlementDay);
	if(held && held.txns === txns && held.mark === mark)return held.portfolio;
	const cards = (accounts || []).filter(a => o.cards && o.cards.indexOf(a.hash) > -1)
		.map(a => a.hash);
	const out = {
		version: 1,
		capturedAt: new Date().toISOString(),
		today: at.toISOString(),
		settlementDay: o.settlementDay !== undefined ? o.settlementDay
			: settlementDayOf(txns, cards),
		masterStream: clone(Core.getMasterStream()),
		//the predictor reads the offset from either place; the app stores it at the top level
		userPreferences: Object.assign({timeZoneOffset: ud.timeZoneOffset},
			ud.userPreferences || {}),
		timeZoneOffset: ud.timeZoneOffset,
		accountTypes: ud.accountTypes || {},
		accounts: (accounts || []).map(a => ({
			hash: a.hash, name: a.name, mask: a.mask, type: a.type, subtype: a.subtype,
			currency: a.currency, current: a.current, available: a.available
		})),
		transactions: clone(txns),
		remembered: o.remembered || []
	};
	held = {txns: txns, mark: mark, portfolio: out};
	return out;
}

export default capturePortfolio;
