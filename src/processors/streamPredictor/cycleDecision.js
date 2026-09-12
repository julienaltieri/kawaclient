/* ==================================================================================================
   THE RULE. Two readings of the ledger, a bar they have to clear, and what to do when they disagree.

   ONE COPY, RUN IN THREE PLACES. The rule is written once as a source string and evaluated here, so
   production, the jest assertions and the audit page in the browser all execute the SAME characters.
   The page has to re-resolve 69 streams on every knob move without a server, which means the rule
   has to exist in the browser; the alternative - a second implementation that agrees with this one
   today - is the drift this file exists to make impossible.

   THE STRING IS PLAIN ES5 AND CARRIES NO BACKSLASH AND NO BACKTICK. It is interpolated verbatim into
   a template literal and then into a script element: an escape written here arrives in the browser
   as a real control character inside a quoted literal, the page fails to parse, and nothing runs
   while every markup assertion still passes. That shipped twice.

   ---- THE RULE ITSELF -------------------------------------------------------------------------------

   1. WINDOW. Only this reporting year's transactions are evidence (legsInWindow). Fewer than
      minLegsToClaim of them and the ledger is not asked at all.

   2. TWO READINGS. `merged` scores the stream's legs as one series; `split` scores each merchant
      group on its own lattice and combines them leg-count-weighted. Utilities is a gas bill and an
      electricity bill; merged it looks semimonthly, split it is two monthly series.

   3. EACH READING ANSWERS THE SHORTEST CANDIDATE OVER fitThreshold - never the best-scoring one,
      because an integer multiple of the true period scores the same by construction.

   4. AGREEMENT IS THE STRONG CASE. Both readings naming the same period is route `both`, and it is
      the only route that is two independent measurements of one answer.

   5. DISAGREEMENT GOES TO SPLIT ONLY IF THE SPLIT IS REAL. Splitting either separates two interleaved
      series or fragments one; a group carrying fewer than minGroupLegs legs fits any period
      trivially and is not evidence. Every group over the bar, split wins; otherwise merged does.

   6. ONE-SIDED CLAIMS ARE NOT CLAIMS. If only one reading cleared the bar the rule declines to
      measure and falls back to the declaration. This is why `declared` is the most common route and
      that is the intended shape: the declaration is a statement of fact by the person receiving the
      money, and inference only overrides it when the ledger says so twice.

   7. THE DECLARATION IS A CEILING. A fit may SHORTEN the declared cycle, never lengthen it. Finding
      a shorter pattern than the one declared is a discovery; finding a longer one is the detector
      failing to see the declared rhythm, and the declaration wins. Route `capped`.
   ================================================================================================== */

import {CANDIDATE_PERIODS, fitTable, fitTableSplit, merchantGroups, legsInWindow,
	emptyCycleTable} from './cycleFit';
import {FIT_CONFIG} from './fitConfig';

/* THE ROUTE TRAVELS WITH THE ANSWER EVERYWHERE, because anything that is not `both` is a weaker
   claim than it looks and a bare period name cannot be argued with. */
export const DECISION_ENGINE = `
var PERIODS = ["weekly","biweekly","semimonthly","monthly","bimonthly","quarterly","yearly"];
var ROUTES = ["both","split","merged","capped","atypical","stale","declared","declined"];
var ROUTE_LABEL = {both: "both", split: "via split", merged: "via merged",
	capped: "capped to declared", atypical: "not a rhythm a budget runs on",
	stale: "pattern went quiet", declared: "declared", declined: "declined"};
var TICK = String.fromCharCode(10003), CROSS = String.fromCharCode(10007);
var DASH = String.fromCharCode(8212), DOT = String.fromCharCode(183);

function pct(m){ return (m === null || m === undefined) ? DASH : ((1 - m) * 100).toFixed(1) + "%"; }

/* THE SHORTEST CANDIDATE OVER THE BAR. The table is in ascending period order, so the first hit is
   the shortest one and the best score is never consulted. */
function pickFrom(tab, k){
	for(var i = 0; i < tab.length; i++){
		var m = tab[i];
		if(m === null || m === undefined)continue;
		if(1 - m > k.thr)return {period: PERIODS[i], misfit: m};
	}
	return null;
}

/* EVERY MERCHANT GROUP HAS TO CARRY REAL EVIDENCE before a split reading is allowed to overrule the
   merged one. One group under the bar and the whole split is discarded, not just that group. */
function splitIsReal(groups, k){
	if(!groups || !groups.length)return false;
	for(var i = 0; i < groups.length; i++)if(groups[i] < k.minGroup)return false;
	return true;
}

function resolveOne(d, k){
	var m = null, s = null;
	if(d.windowLegs >= k.minLegs){ m = pickFrom(d.m, k); s = pickFrom(d.s, k); }
	var res = null, route = "declined";
	if(m && s && m.period === s.period){ res = m; route = "both"; }
	else if(m && s){
		if(splitIsReal(d.groups, k)){ res = s; route = "split"; }
		else { res = m; route = "merged"; }
	}
	else if(d.declared){ res = {period: d.declared, misfit: null}; route = "declared"; }

	/* ---- THE TWO GATES A YEARLY DECLARATION ADDS ------------------------------------------------
	   A YEARLY STREAM IS AN ENVELOPE, and every cycle read off it is an inference about how the
	   envelope happens to be spent. Two things have to hold before that inference replaces the
	   declaration: it has to be a rhythm someone would actually run, and it has to still be running.

	   ATYPICAL FIRST, THEN STALE, so a stream that fails both is reported by the more basic reason.
	   Both land on the declaration, and neither counts as a measurement. */
	if(res && isEnvelope(d.declared) && route !== "declared"){
		if(k.yearlyAllowed.indexOf(res.period) < 0){
			res = {period: d.declared, misfit: null}; route = "atypical";
		}else{
			var quiet = d.quiet ? d.quiet[PERIODS.indexOf(res.period)] : null;
			if(quiet !== null && quiet !== undefined && quiet > k.maxQuiet){
				res = {period: d.declared, misfit: null}; route = "stale";
			}
		}
	}

	/* THE CEILING. PERIODS runs shortest to longest, so a higher index is a longer cycle. */
	if(res && route !== "declared"){
		var iR = PERIODS.indexOf(res.period), iD = PERIODS.indexOf(d.declared);
		if(iR >= 0 && iD >= 0 && iR > iD){ res = {period: d.declared, misfit: null}; route = "capped"; }
	}
	return {merged: m, split: s, route: route,
		period: res ? res.period : null, misfit: res ? res.misfit : null,
		measured: route === "both" || route === "split" || route === "merged",
		agree: !!res && res.period === d.declared};
}

/* MEASURED IS COUNTED SEPARATELY FROM AGREED, and that is the whole point of the summary. A rule
   that reaches 25/25 by declining to measure 25 times has established nothing, and a single
   agreement number cannot tell that apart from a rule that read the ledger and was right. */
function summarizeAll(data, k){
	var counts = {}, agrees = {}, rows = [], bad = [], found = [];
	var agree = 0, measured = 0, envelope = data.length > 0, i, d, r;
	for(i = 0; i < ROUTES.length; i++){ counts[ROUTES[i]] = 0; agrees[ROUTES[i]] = 0; }
	for(i = 0; i < data.length; i++){
		d = data[i];
		if(!isEnvelope(d.declared))envelope = false;
		r = resolveOne(d, k);
		rows.push(r);
		counts[r.route]++;
		if(r.measured){
			measured++;
			found.push({id: d.id, name: d.name, period: r.period, route: r.route});
		}
		if(r.agree){ agrees[r.route]++; agree++; }
		else bad.push({id: d.id, name: d.name, period: r.period, declared: d.declared,
			route: r.route, groups: d.groups});
	}
	/* A COHORT OF ENVELOPES HAS NOTHING TO AGREE WITH, so its headline counts what was read off the
	   ledger instead. Printing "agree 22/35" there would be counting the streams the rule declined
	   to measure and calling it a score. */
	var head = envelope
		? "read off the ledger " + measured + "/" + data.length
		: "agree " + agree + "/" + data.length + " " + DOT + " measured " + measured;
	for(i = 0; i < ROUTES.length; i++)
		if(counts[ROUTES[i]])head += " " + DOT + " " + ROUTE_LABEL[ROUTES[i]] + " " + counts[ROUTES[i]];
	return {total: data.length, agree: agree, measured: measured, envelope: envelope,
		counts: counts, agrees: agrees, rows: rows, bad: bad, found: found, headline: head};
}

/* A YEARLY DECLARATION IS NOT A RHYTHM TO BE RIGHT OR WRONG ABOUT. It states an amount per year and
   says nothing about when the money moves, so a tick or a cross against it is a verdict on a
   question that was never asked: a real finding renders as a failure, and a stream nothing was found
   for renders as correct. Everywhere else the declaration IS the answer to compare against, and the
   tick is the score. */
function isEnvelope(declared){ return declared === "yearly" || declared === "biyearly"; }

function verdictOf(p, declared){
	if(!p)return {cls: "none", text: "no pick"};
	if(isEnvelope(declared))return {cls: "", text: p.period + " " + pct(p.misfit)};
	var ok = p.period === declared;
	return {cls: ok ? "ok" : "bad", text: p.period + " " + pct(p.misfit) + " "
		+ (ok ? TICK : CROSS + " declared " + declared)};
}

/* WHAT THE PREDICTOR CHOSE, SAID FIRST AND SAID PLAINLY. The row used to open with a period and a
   percentage and close with "declared yearly", which on a phone reads as though yearly was the
   answer. The output comes first now, and where it came from comes second. */
function decisionOf(r, declared){
	var src = ROUTE_LABEL[r.route];
	if(!r.period)return {cls: "none", src: src,
		text: "chose nothing " + DOT + " neither reading claimed a cycle"};
	var chose = "chose " + r.period;
	var fit = (r.misfit === null || r.misfit === undefined) ? null : pct(r.misfit) + " fit";
	if(isEnvelope(declared)){
		if(r.route === "declared" || r.route === "capped")
			return {cls: "none", src: src,
				text: chose + " " + DOT + " no rhythm in the ledger, the declaration stands"};
		return {cls: "", src: src, text: chose + " " + DOT + " " + fit + " " + DOT
			+ " read off the ledger, against a yearly declaration"};
	}
	var ok = r.period === declared;
	if(!fit)return {cls: ok ? "none" : "bad", src: src,
		text: chose + " " + DOT + " nothing measured, the declaration stands"};
	return {cls: ok ? "" : "bad", src: src, text: chose + " " + DOT + " " + fit + " "
		+ (ok ? TICK + " matches the declaration" : CROSS + " declared " + declared)};
}
`;

// eslint-disable-next-line no-new-func
const engine = new Function(DECISION_ENGINE + [
	'return {resolveOne: resolveOne, summarizeAll: summarizeAll, verdictOf: verdictOf,',
	'decisionOf: decisionOf, pct: pct, ROUTES: ROUTES, ROUTE_LABEL: ROUTE_LABEL};'].join(' '))();

export const resolveOne = engine.resolveOne;
export const summarizeAll = engine.summarizeAll;
export const verdictOf = engine.verdictOf;
export const decisionOf = engine.decisionOf;
export const pct = engine.pct;
export const ROUTES = engine.ROUTES;
export const ROUTE_LABEL = engine.ROUTE_LABEL;

/* THE KNOBS THE ENGINE READS, filled from the configured numbers. The audit page hands the same
   three in from its controls, which is why they are an object rather than three arguments. */
export const knobsFrom = cfg => {
	const c = Object.assign({}, FIT_CONFIG, cfg || {});
	return {
		thr: c.fitThreshold,
		minLegs: c.minLegsToClaim,
		minGroup: c.minGroupLegs,
		yearlyAllowed: c.yearlyAllowedPeriods,
		maxQuiet: c.maxEmptyCyclesToStayActive
	};
};

/* THE SETTINGS PRODUCTION RUNS ON AND THE PAGE OPENS ON - the configured ones, never a second set
   that drifts from them. */
export const DEFAULT_KNOBS = knobsFrom();

/* THE SHAPE THE ENGINE SCORES, built by the real scorer over the real legs. Production and the page
   both go through here, so the browser is never handed a number this function did not produce. */
/* `now` IS THE CAPTURE DATE, NOT THE WALL CLOCK. How long a pattern has been quiet is measured from
   the instant the portfolio was taken, so the same fixture answers the same thing tomorrow. */
export function fitEvidence(stream, legs, anchor, now, cfg){
	const c = Object.assign({}, FIT_CONFIG, cfg || {});
	const all = legs || [];
	const win = legsInWindow(all, anchor);
	const groups = merchantGroups(win);
	return {
		id: stream && stream.id,
		name: stream && stream.name,
		declared: stream && stream.period,
		legs: all.length,
		windowLegs: win.length,
		groups: groups.map(g => g.legs.length),
		groupKeys: groups.map(g => g.key),
		m: fitTable(win, anchor, c.trimBuckets).map(f => f.misfit),
		s: fitTableSplit(win, anchor, c.trimBuckets).table.map(f => f.misfit),
		//complete cycles of each candidate between the last movement and the capture date
		quiet: emptyCycleTable(win, anchor, now)
	};
}

/* ---- THE ONE ENTRY POINT A CALLER SHOULD USE -------------------------------------------------------
   Hand it a stream, its legs and the analysis anchor; it answers the period, the route it came by,
   and both readings so an audit can see what the rule was looking at. */
export function resolveCycle(stream, legs, anchor, now, cfg){
	const evidence = fitEvidence(stream, legs, anchor, now, cfg);
	const r = resolveOne(evidence, knobsFrom(cfg));
	return Object.assign({evidence: evidence}, r);
}

export const PERIOD_ORDER = CANDIDATE_PERIODS;

export default resolveCycle;
