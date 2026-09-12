/* ==================================================================================================
   THE CYCLE-FIT AUDIT PAGE — a side quest off §2, and the missing piece of the yearly case.

   determineCycle reads the declaration and never looks at a transaction, which is right for a
   non-yearly stream and useless for a yearly one: the spec says a yearly stream's rhythm must be
   INFERRED. This page shows what inference would say, measured against 25 streams whose declared
   period is known-good, so the detector can be judged BEFORE it is pointed at the 44 yearly streams
   that have no ground truth at all.

   IT IS NOW A TUNING SURFACE, NOT A PRINTOUT. The decision rule is eight knobs and no one of them is
   obviously right, so the page carries all four scoring variants precomputed and re-resolves all 25
   streams in the browser on every move. The agreement summary is broken down BY ROUTE, because
   "24/25" hides whether the answer came from the ledger or from falling back to the declaration -
   and a rule that agrees 24 times by declining 24 times has measured nothing.

   THE BARS ARE NOT NORMALISED, PER STREAM OR AT ALL. The bar height is the absolute fit on a fixed
   0..1 scale, so the best bar on a row is the best score actually available for that stream rather
   than the best of a bad set rescaled to look good. A stream nothing fits shows seven short bars and
   must keep showing seven short bars - that is the finding.

   MERGED AND SPLIT ARE BOTH RENDERED, never one chosen for the reader. Splitting a stream's legs by
   merchant turns Utilities into the two twelve-leg series it really is; whether that helps in
   general is the question this page exists to answer.

   THE EMITTED SCRIPT CARRIES NO BACKSLASH AND NO BACKTICK. It is written inside a template literal
   and handed to the shell, which interpolates it verbatim: an escape written for the emitted string
   arrives in the browser as a real line break inside a quoted literal, the page's JavaScript fails
   to parse, and NOTHING works while every markup assertion still passes. That shipped twice.
   ================================================================================================== */

import {renderAuditPage, esc} from './auditShell';
import {CANDIDATE_PERIODS, fitTable, fitTableSplit, merchantGroups, resolveCycle,
	legsInWindow, MIN_LEGS_FOR_FIT, FIT_VARIANTS} from './cycleFit';

/* NOTHING FITS ABOVE THIS AND THE PAGE SAYS SO RATHER THAN NAMING A WINNER. Kept for the grouping of
   the stream list, which is still cut on the un-tuned detector so the sections do not reshuffle
   under the reader every time a knob moves. */
export const WEAK_FIT_CUTOFF = 0.2;

const SHORT = {weekly: 'w', biweekly: 'b', semimonthly: 's', monthly: 'M',
	bimonthly: 'B', quarterly: 'q', yearly: 'y'};

/* ---- THE ENGINE, WRITTEN ONCE AND RUN ON BOTH SIDES -----------------------------------------------
   THE BROWSER AND THE TEST MUST NOT DRIFT, so they do not each own a copy of the rule: this string
   is the only copy. node evaluates it through `new Function` to get the same functions the page
   gets, so an assertion in jest is an assertion about the code the reader is actually moving knobs
   on, not about a second implementation that agrees with it today.

   PLAIN ES5, NO BACKSLASH, NO BACKTICK, NO TEMPLATE INTERPOLATION. See the file header. */
const ENGINE = `
var PERIODS = ["weekly","biweekly","semimonthly","monthly","bimonthly","quarterly","yearly"];
var ROUTES = ["both","split","merged","higherFit","capped","declared","declined"];
var ROUTE_LABEL = {both: "both", split: "via split", merged: "via merged",
	higherFit: "via higher fit", capped: "capped to declared",
	declared: "declared", declined: "declined"};
var TICK = String.fromCharCode(10003), CROSS = String.fromCharCode(10007);
var DASH = String.fromCharCode(8212), DOT = String.fromCharCode(183);

function pct(m){ return (m === null || m === undefined) ? DASH : ((1 - m) * 100).toFixed(1) + "%"; }

/* THE PICK RULE. Both readings of it answer the SHORTEST period that qualifies, never the best
   scoring one, because an integer multiple of the true period scores the same by construction. */
function pickFrom(tab, k){
	var i, m, floor = null;
	if(k.pick === "tol"){
		for(i = 0; i < tab.length; i++){
			m = tab[i];
			if(m === null || m === undefined)continue;
			if(floor === null || m < floor)floor = m;
		}
		if(floor === null)return null;
	}
	for(i = 0; i < tab.length; i++){
		m = tab[i];
		if(m === null || m === undefined)continue;
		if(!(1 - m > k.thr))continue;
		if(k.pick === "tol" && !(m <= floor + k.tol))continue;
		return {period: PERIODS[i], misfit: m};
	}
	return null;
}

/* ONE STREAM, ONE ANSWER, AND THE ROUTE IT CAME BY. Anything that is not "both readings found the
   same thing" is a weaker claim than it looks, so the route travels with the answer everywhere. */
function resolveOne(d, k){
	var v = d.v[k.variant] || d.v.standard;
	var m = null, s = null, i, gate;
	if(d.windowLegs >= k.minLegs){ m = pickFrom(v.m, k); s = pickFrom(v.s, k); }
	var res = null, route = "declined";
	if(m && s && m.period === s.period){ res = m; route = "both"; }
	else if(m && s){
		if(k.dis === "merged"){ res = m; route = "merged"; }
		else if(k.dis === "split"){ res = s; route = "split"; }
		else if(k.dis === "higher"){ res = (s.misfit < m.misfit) ? s : m; route = "higherFit"; }
		else {
			gate = d.groups.length > 0;
			for(i = 0; i < d.groups.length; i++)if(d.groups[i] < k.minGroup)gate = false;
			if(gate){ res = s; route = "split"; } else { res = m; route = "merged"; }
		}
	}
	else if(k.fb === "declared"){ res = {period: d.declared, misfit: null}; route = "declared"; }
	/* THE CAP. PERIODS runs shortest to longest, so a higher index is a longer cycle. A fit that
	   claims a LONGER cycle than the declaration is the one direction we never believe: the
	   declaration is the floor, and the fit is only allowed to shorten it. */
	if(k.cap === "declared" && res && route !== "declared" && route !== "capped"){
		var iR = PERIODS.indexOf(res.period), iD = PERIODS.indexOf(d.declared);
		if(iR >= 0 && iD >= 0 && iR > iD){ res = {period: d.declared, misfit: null}; route = "capped"; }
	}
	return {merged: m, split: s, route: route,
		period: res ? res.period : null, misfit: res ? res.misfit : null,
		agree: !!res && res.period === d.declared};
}

function summarizeAll(data, k){
	var counts = {}, agrees = {}, rows = [], bad = [], agree = 0, i, d, r;
	for(i = 0; i < ROUTES.length; i++){ counts[ROUTES[i]] = 0; agrees[ROUTES[i]] = 0; }
	for(i = 0; i < data.length; i++){
		d = data[i];
		r = resolveOne(d, k);
		rows.push(r);
		counts[r.route]++;
		if(r.agree){ agrees[r.route]++; agree++; }
		else bad.push({id: d.id, name: d.name, period: r.period, declared: d.declared,
			route: r.route, groups: d.groups});
	}
	var head = "agree " + agree + "/" + data.length;
	for(i = 0; i < ROUTES.length; i++)
		if(counts[ROUTES[i]])head += " " + DOT + " " + ROUTE_LABEL[ROUTES[i]] + " " + counts[ROUTES[i]];
	return {total: data.length, agree: agree, counts: counts, agrees: agrees,
		rows: rows, bad: bad, headline: head};
}

function verdictOf(p, declared){
	if(!p)return {cls: "none", text: "no pick"};
	var ok = p.period === declared;
	return {cls: ok ? "ok" : "bad", text: p.period + " " + pct(p.misfit) + " "
		+ (ok ? TICK : CROSS + " declared " + declared)};
}

function decisionOf(r, declared){
	if(!r.period)return {cls: "none", src: ROUTE_LABEL[r.route],
		text: "no cycle " + DOT + " neither reading claimed one"};
	var ok = r.period === declared;
	return {cls: ok ? "" : "bad", src: ROUTE_LABEL[r.route],
		text: r.period + " " + pct(r.misfit) + " " + (ok ? TICK : CROSS + " declared " + declared)};
}
`;

// eslint-disable-next-line no-new-func
const engine = new Function(ENGINE + [
	'return {resolveOne: resolveOne, summarizeAll: summarizeAll, verdictOf: verdictOf,',
	'decisionOf: decisionOf, pct: pct, ROUTES: ROUTES, ROUTE_LABEL: ROUTE_LABEL};'].join(' '))();

export const resolveOne = engine.resolveOne;
export const summarizeAll = engine.summarizeAll;

/* THE SETTINGS THE PAGE OPENS ON, and the ones every number quoted in the test is taken at. */
export const DEFAULT_KNOBS = {
	thr: 0.85, variant: 'standard', pick: 'over', tol: 0.05,
	dis: 'split', minGroup: 4, minLegs: 4, fb: 'declared', cap: 'keep'
};

/* ---- THE PRECOMPUTED BLOB --------------------------------------------------------------------------
   25 streams x 4 variants x 2 readings x 7 candidates. Every number the browser will ever need,
   scored by the REAL scorer in node, so nothing is recomputed by a second implementation and the
   page needs neither a server nor a rebuild to answer a knob.

   STRINGS ARE STRIPPED TO PRINTABLE ASCII MINUS THE FOUR CHARACTERS THAT COULD BREAK OUT. A quote or
   a non-ASCII letter would make JSON.stringify emit a backslash, which is the one thing this file
   must never put on the page; a "<" could close the script element early. */
const r4 = m => (m === null || m === undefined) ? null : Math.round(m * 10000) / 10000;

//the character class is built from char codes so the one character it is about never appears here
const UNSAFE = new RegExp('[' + String.fromCharCode(92, 92, 34, 60, 62, 96) + ']', 'g');
const jsonSafe = s => String(s === null || s === undefined ? '' : s)
	.replace(/[^ -~]/g, ' ').replace(UNSAFE, ' ');

const variantTables = (legs, anchor) => {
	const v = {};
	FIT_VARIANTS.forEach(name => {
		v[name] = {
			m: fitTable(legs, anchor, name).map(c => r4(c.misfit)),
			s: fitTableSplit(legs, anchor, name).table.map(c => r4(c.misfit))
		};
	});
	return v;
};

/* EVERY NUMBER ON THE PAGE COMES FROM RUNNING THE REAL SCORER over the real legs. Nothing here
   recomputes, rounds early, or decides anything the detector did not decide. */
export function enrichFits(rows, anchor){
	return (rows || []).map(r => {
		const allLegs = r.legs || [];
		//the bars show the window the claim is made from, so the reader sees the evidence, not history
		const legs = legsInWindow(allLegs, anchor);
		const merged = fitTable(legs, anchor);
		const sp = fitTableSplit(legs, anchor);
		const decided = resolveCycle(allLegs, anchor);
		const dm = decided.merged, dsp = decided.split;
		const bestMerged = dm.period ? dm : null;
		const bestSplit = dsp.period ? dsp : null;
		const reason = dm.reason;
		//the decision only stands if it also clears the fit bar; below it the stream has no cycle
		const claimed = decided.period && decided.misfit < WEAK_FIT_CUTOFF ? decided : null;
		const declared = r.stream.period;
		const groups = merchantGroups(legs);
		return {
			id: r.stream.id, name: r.stream.name, declared: declared,
			legCount: allLegs.length, windowLegs: legs.length,
			merged: merged, split: sp.table, groups: groups,
			bestMerged: bestMerged, bestSplit: bestSplit, reason: reason,
			decision: claimed, decisionSource: claimed ? decided.source : null,
			agreeDecision: !!claimed && claimed.period === declared,
			sourcesDiffer: !!(bestMerged && bestSplit && bestMerged.period !== bestSplit.period),
			agreeMerged: !!bestMerged && bestMerged.period === declared,
			agreeSplit: !!bestSplit && bestSplit.period === declared,
			group: !claimed ? 'weak' : (claimed.period === declared ? 'agree' : 'disagree'),
			data: {
				id: jsonSafe(r.stream.id),
				name: jsonSafe(r.stream.name),
				declared: jsonSafe(declared),
				legs: allLegs.length,
				windowLegs: legs.length,
				groups: groups.map(g => g.legs.length),
				v: variantTables(legs, anchor)
			}
		};
	});
}

export function summarizeFits(list){
	const e = list || [];
	return {
		total: e.length,
		agree: e.filter(r => r.group === 'agree').length,
		disagree: e.filter(r => r.group === 'disagree').length,
		weak: e.filter(r => r.group === 'weak').length,
		decided: e.filter(r => r.decision).length,
		agreeDecision: e.filter(r => r.agreeDecision).length,
		fromSplit: e.filter(r => r.decisionSource === 'split').length,
		sourcesDiffer: e.filter(r => r.sourcesDiffer).length,
		agreeMerged: e.filter(r => r.agreeMerged).length,
		agreeSplit: e.filter(r => r.agreeSplit).length,
		splitDiffers: e.filter(r => (r.bestMerged && r.bestMerged.period)
			!== (r.bestSplit && r.bestSplit.period)).length
	};
}

/* THE COHORT AS THE BROWSER SEES IT - the same rounded numbers, in the same order - so a test can
   resolve exactly what the page resolves rather than something adjacent to it. */
export function fitData(rows, anchor){
	return enrichFits(rows, anchor).map(r => r.data);
}

/* ---- THE MARKUP ------------------------------------------------------------------------------------
   ONE BAR PER CANDIDATE, height = fit on a FIXED 0..1 scale. An unscorable candidate - too few legs
   or too few buckets to say anything - renders as an empty slot, which must not be mistakable for a
   fit of zero: the two would otherwise look identical.

   THE INITIAL STATE IS RENDERED IN NODE AT THE DEFAULT KNOBS, from the same engine the browser runs,
   so the page is already correct before a single event fires. */
const bars = (tab, win, declared, role) => '<span class="bars" data-row="' + role + '">'
	+ CANDIDATE_PERIODS.map((p, i) => {
		const m = tab[i];
		const un = m === null || m === undefined;
		const cls = ['bar'];
		if(un)cls.push('un');
		if(win && p === win)cls.push('win');
		if(p === declared)cls.push('decl');
		return '<span class="' + cls.join(' ') + '" title="' + esc(p) + ' fit ' + esc(engine.pct(m)) + '">'
			+ (un ? '<i class="none"></i>'
				: '<i style="height:' + Math.max(2, Math.round((1 - m) * 100)) + '%"></i>')
			+ '</span>';
	}).join('') + '</span>';

const vd = (pick, declared, role) => {
	const v = engine.verdictOf(pick, declared);
	return '<span class="vd ' + v.cls + '" data-vd="' + role + '">' + esc(v.text) + '</span>';
};

/* THE INITIALS SIT ABOVE THE PAIR, ONCE. Repeating them under both rows cost a line of vertical
   space each and said the same thing twice; the columns are the same seven in the same order on
   every row of the page, so naming them once at the top of the stream is enough. */
const scaleHead = declared => '<div class="frow head"><span class="flab"></span><span class="bars">'
	+ CANDIDATE_PERIODS.map(pd => '<span class="tick' + (pd === declared ? ' decl' : '') + '"'
		+ ' title="' + esc(pd) + '">' + esc(SHORT[pd]) + '</span>').join('')
	+ '</span></div>';

/* THE DECISION ROW IS THE KNOBS' OUTPUT, and it names the ROUTE rather than only the answer: the
   reader is being asked to judge the RULE, and a decision that never says how it was reached cannot
   be argued with. A stream the current settings get wrong is marked on the card itself. */
const decisionRow = r => {
	const d = engine.decisionOf(r.res, r.data.declared);
	return '<div class="frow dec' + (d.cls ? ' ' + d.cls : '') + '" data-dec="1">'
		+ '<span class="flab">decision</span>'
		+ '<span class="dv" data-dv="1">' + esc(d.text) + '</span>'
		+ '<span class="src" data-src="1">route ' + esc(d.src) + '</span></div>';
};

const body = r => {
	const t = r.data.v[DEFAULT_KNOBS.variant];
	return '<div class="fit" data-sid="' + esc(r.data.id) + '">' + scaleHead(r.declared)
		+ '<div class="frow"><span class="flab">merged</span>'
			+ bars(t.m, r.res.merged && r.res.merged.period, r.declared, 'm')
			+ vd(r.res.merged, r.data.declared, 'm') + '</div>'
		+ '<div class="frow"><span class="flab">split</span>'
			+ bars(t.s, r.res.split && r.res.split.period, r.declared, 's')
			+ vd(r.res.split, r.data.declared, 's')
			+ (r.groups.length > 1
				? '<span class="grp">' + r.groups.map(g => esc(g.key) + '×' + g.legs.length).join(' · ')
					+ '</span>'
				: '<span class="grp one">one merchant</span>')
		+ '</div>'
		+ decisionRow(r)
		+ '</div>';
};

const byEvidence = (a, b) => b.legCount - a.legCount
	|| (String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0);

const card = r => ({
	id: r.id, name: r.name,
	search: [r.name, r.id, r.declared,
		r.bestMerged ? r.bestMerged.period : '', r.bestSplit ? r.bestSplit.period : '',
		r.group].join(' ').toLowerCase(),
	meta: [
		{cls: 'period', value: r.declared === null || r.declared === undefined ? 'no period' : r.declared},
		{cls: 'legs', value: r.windowLegs + ' of ' + r.legCount, label: 'legs this year'},
		{cls: 'sid', value: r.id}
	],
	flagged: r.group === 'disagree',
	body: body(r)
});

const group = (key, title, list) =>
	({key: key, title: title, cards: list.slice().sort(byEvidence).map(card)});

/* ---- THE CONTROL PANEL -----------------------------------------------------------------------------
   EIGHT KNOBS, AND THE SUMMARY ABOVE THEM RATHER THAN BELOW. The summary is the thing being watched;
   the hand sits on a control at the bottom of the block and the eye on the number at the top of it,
   which is the right way round on a phone held in one hand.

   BROKEN DOWN BY ROUTE, ALWAYS. A rule that reaches 25/25 by declining to claim anything has
   measured nothing, and a single agreement number cannot tell those two apart.

   TIGHT ON PURPOSE. Every knob is one line and the whole panel is well under a fifth of a phone
   screen, because it sits between the header and the first stream and costs its height on every
   scroll. */
const radioRow = (label, name, opts) => '<div class="knob"><span class="kl">' + esc(label)
	+ '</span><span class="seg">'
	+ opts.map(o => '<label><input type="radio" name="' + name + '" value="' + esc(o.v) + '"'
		+ (o.on ? ' checked' : '') + '><span>' + esc(o.t) + '</span></label>').join('')
	+ '</span></div>';

const sumRow = (rt, s) => '<tr' + (s.counts[rt] ? '' : ' class="zero"') + '><td>'
	+ esc(engine.ROUTE_LABEL[rt]) + '</td><td class="n">' + s.counts[rt] + '</td><td class="n">'
	+ (rt === 'declined' ? '—' : s.agrees[rt]) + '</td></tr>';

const badLine = s => s.bad.length
	? 'disagree: ' + s.bad.map(b => '<a href="#" data-goto="' + esc(b.id) + '">' + esc(b.name) + '</a> '
		+ esc(b.period || 'no claim') + ' (declared ' + esc(b.declared) + ')').join(' · ')
	: 'every stream agrees with its declaration';

const panel = s => '<section class="panel"><div class="pbox">'
	+ '<p class="sumhead" id="sumhead">' + esc(s.headline) + '</p>'
	+ '<table class="sumt"><thead><tr><th>route</th><th class="n">n</th><th class="n">agree</th></tr>'
	+ '</thead><tbody id="sumrows">' + engine.ROUTES.map(rt => sumRow(rt, s)).join('') + '</tbody></table>'
	+ '<p class="sumbad" id="sumbad">' + badLine(s) + '</p>'
	+ '<div class="knobs">'
	+ '<div class="knob"><span class="kl">fit threshold</span>'
		+ '<input type="range" id="thr" min="60" max="99" step="1" value="85">'
		+ '<b class="kv" id="thrv">85%</b></div>'
	+ radioRow('variant', 'variant',
		FIT_VARIANTS.map(v => ({v: v, t: v, on: v === DEFAULT_KNOBS.variant})))
	+ radioRow('pick rule', 'pick', [
		{v: 'over', t: 'shortest over threshold', on: true},
		{v: 'tol', t: 'shortest within tolerance of best'}])
	+ '<div class="knob off" id="tolrow"><span class="kl">alias tolerance</span>'
		+ '<input type="range" id="tol" min="0" max="20" step="1" value="5" disabled>'
		+ '<b class="kv" id="tolv">0.05</b></div>'
	+ radioRow('on disagreement', 'dis', [
		{v: 'merged', t: 'merged wins'},
		{v: 'split', t: 'split wins', on: true},
		{v: 'higher', t: 'higher fit wins'},
		{v: 'group', t: 'split only if every group is big enough'}])
	+ '<div class="knob off" id="grouprow"><span class="kl">min group legs</span>'
		+ '<input type="number" id="mingroup" min="2" max="10" step="1" value="4" disabled></div>'
	+ '<div class="knob"><span class="kl">min legs to claim</span>'
		+ '<input type="number" id="minlegs" min="1" max="10" step="1" value="4"></div>'
	+ radioRow('fit longer than declared', 'cap', [
		{v: 'keep', t: 'keep the fit', on: true},
		{v: 'declared', t: 'cap at the declared cycle'}])
	+ radioRow('fallback', 'fb', [
		{v: 'declared', t: 'use the declared cycle', on: true},
		{v: 'decline', t: 'decline'}])
	+ '</div></div></section>';

/* ---- THE PAGE'S OWN SCRIPT -------------------------------------------------------------------------
   NO BACKSLASH, NO BACKTICK, NO EXCEPTIONS - see the file header. Attribute quoting inside these
   strings is done with apostrophes, so no character in here ever needs an escape. */
const wiring = data => ENGINE + `
var DATA = ` + JSON.stringify(data) + `;
var fits = {};
var sumhead = document.getElementById("sumhead");
var sumrows = document.getElementById("sumrows");
var sumbad = document.getElementById("sumbad");
var tolIn = document.getElementById("tol");
var groupIn = document.getElementById("mingroup");

function radio(n){
	var e = document.querySelector("input[name='" + n + "']:checked");
	return e ? e.value : null;
}

function knobs(){
	return {
		thr: Number(document.getElementById("thr").value) / 100,
		variant: radio("variant"),
		pick: radio("pick"),
		tol: Number(tolIn.value) / 100,
		dis: radio("dis"),
		minGroup: Number(groupIn.value),
		minLegs: Number(document.getElementById("minlegs").value),
		fb: radio("fb"),
		cap: radio("cap")
	};
}

function drawBars(wrap, tab, win, declared){
	if(!wrap)return;
	var cells = wrap.children, i, cell, m, un, cls, ic;
	for(i = 0; i < cells.length && i < PERIODS.length; i++){
		cell = cells[i];
		m = tab[i];
		un = (m === null || m === undefined);
		cls = "bar";
		if(un)cls += " un";
		if(win && PERIODS[i] === win)cls += " win";
		if(PERIODS[i] === declared)cls += " decl";
		cell.className = cls;
		cell.setAttribute("title", PERIODS[i] + " fit " + pct(m));
		ic = cell.firstChild;
		if(!ic)continue;
		if(un){ ic.className = "none"; ic.setAttribute("style", ""); }
		else { ic.className = ""; ic.style.height = Math.max(2, Math.round((1 - m) * 100)) + "%"; }
	}
}

function setVd(el, v){ if(el){ el.className = "vd " + v.cls; el.textContent = v.text; } }

function render(){
	var k = knobs(), i, rt, n, d, r, t, dec, f, html;
	document.getElementById("thrv").textContent = Math.round(k.thr * 100) + "%";
	document.getElementById("tolv").textContent = k.tol.toFixed(2);
	tolIn.disabled = k.pick !== "tol";
	groupIn.disabled = k.dis !== "group";
	document.getElementById("tolrow").className = tolIn.disabled ? "knob off" : "knob";
	document.getElementById("grouprow").className = groupIn.disabled ? "knob off" : "knob";

	var s = summarizeAll(DATA, k);
	sumhead.textContent = s.headline;

	html = "";
	for(i = 0; i < ROUTES.length; i++){
		rt = ROUTES[i];
		n = s.counts[rt];
		html += "<tr" + (n ? "" : " class='zero'") + "><td>" + ROUTE_LABEL[rt]
			+ "</td><td class='n'>" + n + "</td><td class='n'>"
			+ (rt === "declined" ? DASH : s.agrees[rt]) + "</td></tr>";
	}
	sumrows.innerHTML = html;

	if(!s.bad.length)sumbad.textContent = "every stream agrees with its declaration";
	else {
		html = "";
		for(i = 0; i < s.bad.length; i++){
			d = s.bad[i];
			html += (i ? " " + DOT + " " : "") + "<a href='#' data-goto='" + d.id + "'>" + d.name
				+ "</a> " + (d.period ? d.period : "no claim") + " (declared " + d.declared + ")";
		}
		sumbad.innerHTML = "disagree: " + html;
	}

	for(i = 0; i < DATA.length; i++){
		d = DATA[i];
		r = s.rows[i];
		f = fits[d.id];
		if(!f)continue;
		t = d.v[k.variant] || d.v.standard;
		drawBars(f.mbars, t.m, r.merged ? r.merged.period : null, d.declared);
		drawBars(f.sbars, t.s, r.split ? r.split.period : null, d.declared);
		setVd(f.mvd, verdictOf(r.merged, d.declared));
		setVd(f.svd, verdictOf(r.split, d.declared));
		dec = decisionOf(r, d.declared);
		if(f.dv)f.dv.textContent = dec.text;
		if(f.src)f.src.textContent = "route " + dec.src;
		if(f.dec)f.dec.className = dec.cls ? "frow dec " + dec.cls : "frow dec";
		if(f.card)f.card.classList.toggle("knobwrong", !r.agree);
	}
}

[].slice.call(document.querySelectorAll(".fit")).forEach(function(el){
	fits[el.getAttribute("data-sid")] = {
		mbars: el.querySelector("[data-row='m']"),
		sbars: el.querySelector("[data-row='s']"),
		mvd: el.querySelector("[data-vd='m']"),
		svd: el.querySelector("[data-vd='s']"),
		dec: el.querySelector("[data-dec]"),
		dv: el.querySelector("[data-dv]"),
		src: el.querySelector("[data-src]"),
		card: el.closest(".stream")
	};
});

[].slice.call(document.querySelectorAll(".panel input")).forEach(function(el){
	el.addEventListener("input", render);
	el.addEventListener("change", render);
});

/* THE DISAGREEING STREAMS ARE THE POINT OF THE SUMMARY, so their names are links into the list
   rather than text to go hunting with. */
sumbad.addEventListener("click", function(e){
	var id = (e.target && e.target.getAttribute) ? e.target.getAttribute("data-goto") : null;
	if(!id)return;
	e.preventDefault();
	var box = document.querySelector(".okbox[data-sid='" + id + "']");
	var card = box ? box.closest(".stream") : null;
	if(!card)return;
	card.hidden = false;
	if(card.scrollIntoView)card.scrollIntoView({block: "center"});
});

render();
`;

export function buildFitAuditPage(rows, meta){
	const m = meta || {};
	const list = enrichFits(rows, m.anchor);
	const data = list.map(r => r.data);
	const s = engine.summarizeAll(data, DEFAULT_KNOBS);
	list.forEach((r, i) => { r.res = s.rows[i]; });
	const sf = summarizeFits(list);
	const of = k => list.filter(r => r.group === k);
	const anchor = m.anchor ? new Date(m.anchor) : null;
	const anchorText = anchor
		? anchor.getFullYear() + '-' + String(anchor.getMonth() + 1).padStart(2, '0')
			+ '-' + String(anchor.getDate()).padStart(2, '0')
		: '—';

	return renderAuditPage({
		title: 'Cycle fit',
		phase: '§2·detector',
		storageKey: 'kawa.audit.cyclefit.v1',
		capturedAt: m.capturedAt,
		versionTitle: m.version,
		extraCss: CSS,
		legendHtml: LEGEND,
		panelHtml: panel(s),
		extraScript: wiring(data),
		metaLine: [
			{label: 'cohort', value: sf.total},
			{label: 'anchor', value: anchorText},
			{label: 'merged agrees', value: sf.agreeMerged + '/' + sf.total},
			{label: 'split agrees', value: sf.agreeSplit + '/' + sf.total},
			{label: 'merged≠split', value: sf.splitDiffers}
		],
		groups: [
			group('disagree', 'Detected period differs from the declaration', of('disagree')),
			group('agree', 'Detected period matches the declaration', of('agree')),
			group('weak', 'No claim — best candidate under '
				+ ((1 - WEAK_FIT_CUTOFF) * 100).toFixed(0) + '%, or fewer than '
				+ MIN_LEGS_FOR_FIT + ' transactions', of('weak'))
		]
	});
}

const LEGEND = '<span class="lg">the knobs below rescore all 25 streams live</span>'
	+ '<span class="lg"><i class="sw win"></i>the pick</span>'
	+ '<span class="lg"><i class="sw decl"></i>declared period</span>'
	+ '<span class="lg"><i class="sw un"></i>not scorable</span>'
	+ '<span class="lg">taller bar = better fit · 100% repeats exactly · 0% no structure</span>'
	+ '<span class="lg">scale is absolute, never rescaled per stream</span>'
	+ '<span class="lg">the pick is the SHORTEST period that qualifies, not the tallest bar</span>'
	+ '<span class="lg">scored on this reporting year only, from the anchor</span>'
	+ '<span class="lg">route both = merged and split agreed · declared = the fallback, not a measurement</span>'
	+ '<span class="lg">' + CANDIDATE_PERIODS.map(p => SHORT[p] + ' ' + p).join(' · ') + '</span>';

const CSS = `
.panel{max-width:1000px;margin:0 auto;padding:10px 14px 0}
.pbox{border:1px solid var(--rule);border-radius:7px;background:var(--surface);padding:9px 11px}
.sumhead{margin:0 0 6px;font:600 13px/1.3 var(--mono);color:var(--ink)}
.sumt{border-collapse:collapse;font:400 11px/1.4 var(--mono);color:var(--ink-soft)}
.sumt th{font:500 9px/1 var(--mono);text-transform:uppercase;letter-spacing:.05em;
	color:var(--ink-faint);text-align:left;padding:0 10px 2px 0}
.sumt td{padding:0 10px 0 0;white-space:nowrap}
.sumt .n{text-align:right;width:40px}
.sumt tr.zero{color:var(--ink-faint);opacity:.5}
.sumbad{margin:6px 0 0;font:400 10.5px/1.45 var(--mono);color:var(--flag)}
.sumbad a{color:var(--flag);cursor:pointer}
.knobs{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding-top:7px;
	border-top:1px dashed var(--rule)}
.knob{display:flex;align-items:center;gap:8px;min-width:0}
.knob.off{opacity:.42}
.kl{flex:0 0 88px;font:500 9px/1.2 var(--mono);color:var(--ink-faint);text-transform:uppercase;
	letter-spacing:.05em}
.kv{font:600 11px/1 var(--mono);color:var(--ink);flex:0 0 40px}
.knob input[type=range]{flex:1 1 auto;min-width:70px;max-width:240px;height:18px;
	accent-color:var(--accent)}
.knob input[type=number]{width:56px;font:500 11.5px var(--mono);color:var(--ink);
	background:var(--paper);border:1px solid var(--rule);border-radius:5px;padding:2px 5px}
.seg{display:flex;flex-wrap:wrap;gap:3px;min-width:0}
.seg label{display:inline-flex;align-items:center;gap:3px;font:400 10.5px/1 var(--sans);
	color:var(--ink-soft);background:var(--paper);border:1px solid var(--rule);border-radius:5px;
	padding:3px 6px;cursor:pointer;white-space:nowrap}
.seg input{margin:0;width:11px;height:11px;accent-color:var(--accent)}
.stream.knobwrong{box-shadow:inset 3px 0 0 var(--flag)}
.tick{width:15px;text-align:center;font:500 8.5px/1 var(--mono);color:var(--ink-faint);
	flex:0 0 15px}
.tick.decl{color:var(--flag);font-weight:600}
.frow.head{align-items:center;margin-bottom:1px}
.frow.head .bars{height:auto}
.lg{display:inline-flex;align-items:center;gap:4px;margin-right:11px;white-space:nowrap}
.sw{display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--sunk)}
.sw.win{background:var(--accent)}
.sw.decl{background:transparent;outline:1px solid var(--flag);outline-offset:1px}
.sw.un{background:repeating-linear-gradient(45deg,transparent,transparent 2px,
	var(--rule) 2px,var(--rule) 3px)}
.frow.dec{margin-top:3px;padding-top:4px;border-top:1px dashed var(--rule)}
.dv{font:600 11.5px/1 var(--mono);color:var(--realtime);padding-bottom:2px}
.frow.dec.bad .dv{color:var(--flag)}
.frow.dec.none .dv{color:var(--ink-faint);font-weight:500}
.src{font:400 10px/1 var(--mono);color:var(--ink-faint);padding-bottom:2px}
.fit{display:flex;flex-direction:column;gap:3px;margin-top:2px}
.frow{display:flex;align-items:flex-end;gap:7px;min-width:0;flex-wrap:wrap}
.flab{font:500 9.5px/1 var(--mono);color:var(--ink-faint);text-transform:uppercase;
	letter-spacing:.06em;width:38px;flex:0 0 38px;padding-bottom:2px}
.bars{display:inline-flex;align-items:flex-end;gap:2px;height:26px;flex:0 0 auto}
.bar{position:relative;width:15px;height:26px;display:flex;flex-direction:column;
	justify-content:flex-end;align-items:center;background:var(--sunk);border-radius:2px}
.bar i{display:block;width:100%;background:var(--accent-soft);border-radius:2px 2px 0 0}
.bar i.none{height:100%;background:repeating-linear-gradient(45deg,transparent,transparent 2px,
	var(--rule) 2px,var(--rule) 3px)}
.bar.win i{background:var(--accent)}
.bar.decl{outline:1px solid var(--flag);outline-offset:1px}
.vd{font:500 11px/1 var(--mono);padding-bottom:2px}
.vd.ok{color:var(--realtime)}
.vd.bad{color:var(--flag)}
.vd.weak,.vd.none{color:var(--ink-faint)}
.grp{font:400 10px/1.3 var(--mono);color:var(--ink-faint);padding-bottom:2px;
	word-break:break-all;min-width:0}
.grp.one{opacity:.6}
@media (max-width:520px){
	.panel{padding:8px 10px 0}
	.kl{flex:0 0 74px}
}
`;

export default buildFitAuditPage;
