/* ==================================================================================================
   THE CYCLE-FIT AUDIT PAGE — a side quest off §2, and the missing piece of the yearly case.

   determineCycle reads the declaration and never looks at a transaction, which is right for a
   non-yearly stream and useless for a yearly one: the spec says a yearly stream's rhythm must be
   INFERRED. This page shows what the inference says, on two cohorts that are read in completely
   different ways and therefore sit behind a tab rather than in one list:

   VALIDATED (25) - open, non-yearly, carrying transactions. The declaration on these has been
   checked by hand, so agreement with it is a SCORE: the rule was tuned until every claim it makes
   on this cohort is true.

   YEARLY (35) - open, declared yearly, carrying transactions. The declaration states an amount per
   year and is silent about rhythm, so agreement with it is not a score and there is nothing to tune
   against. This is the population the detector exists for, and the tab shows what it says.

   THE KNOBS ARE THE THREE NUMBERS THAT SURVIVED. The algorithm is settled - see cycleDecision.js -
   and the variants, the tolerance rule and the four disagreement policies are gone with it. What is
   still adjustable is the arithmetic a different portfolio could argue with, and the page moves it
   live so the argument can be had with numbers.

   THE BARS ARE NOT NORMALISED, PER STREAM OR AT ALL. The bar height is the absolute fit on a fixed
   0..1 scale, so the best bar on a row is the best score actually available for that stream rather
   than the best of a bad set rescaled to look good. A stream nothing fits shows seven short bars and
   must keep showing seven short bars - that is the finding.

   THE EMITTED SCRIPT CARRIES NO BACKSLASH AND NO BACKTICK. It is written inside a template literal
   and handed to the shell, which interpolates it verbatim: an escape written for the emitted string
   arrives in the browser as a real line break inside a quoted literal, the page's JavaScript fails
   to parse, and NOTHING works while every markup assertion still passes. That shipped twice.
   ================================================================================================== */

import {renderAuditPage, esc} from './auditShell';
import {CANDIDATE_PERIODS} from './cycleFit';
import {FIT_CONFIG} from './fitConfig';
import {DECISION_ENGINE, DEFAULT_KNOBS, fitEvidence, resolveOne, summarizeAll, verdictOf,
	decisionOf, pct, ROUTES, ROUTE_LABEL} from './cycleDecision';

const SHORT = {weekly: 'w', biweekly: 'b', semimonthly: 's', monthly: 'M',
	bimonthly: 'B', quarterly: 'q', yearly: 'y'};

/* THE TWO COHORTS, and the tab is the only thing that tells them apart on the page. */
export const COHORTS = [
	{key: 'validated', label: 'validated (non-yearly)',
		note: 'declaration checked by hand - agreement is a score'},
	{key: 'yearly', label: 'yearly',
		note: 'declaration states an amount, not a rhythm - agreement is not a score'}
];

/* ---- THE DATA THE BROWSER RE-RESOLVES --------------------------------------------------------------
   EVERY NUMBER COMES FROM RUNNING THE REAL SCORER over the real legs, in node, once. The page holds
   60 streams x 2 readings x 7 candidates and needs neither a server nor a rebuild to answer a knob.

   STRINGS ARE STRIPPED TO PRINTABLE ASCII MINUS THE FOUR CHARACTERS THAT COULD BREAK OUT. A quote or
   a non-ASCII letter would make JSON.stringify emit a backslash, which is the one thing this file
   must never put on the page; a "<" could close the script element early. */
const r4 = m => (m === null || m === undefined) ? null : Math.round(m * 10000) / 10000;

//the character class is built from char codes so the one character it is about never appears here
const UNSAFE = new RegExp('[' + String.fromCharCode(92, 92, 34, 60, 62, 96) + ']', 'g');
const jsonSafe = s => String(s === null || s === undefined ? '' : s)
	.replace(/[^ -~]/g, ' ').replace(UNSAFE, ' ');

export function fitData(rows, anchor, cohort){
	return (rows || []).map(r => {
		const e = fitEvidence(r.stream, r.legs, anchor);
		return {
			cohort: cohort,
			id: jsonSafe(e.id),
			name: jsonSafe(e.name),
			declared: jsonSafe(e.declared),
			legs: e.legs,
			windowLegs: e.windowLegs,
			groups: e.groups,
			groupKeys: e.groupKeys.map(jsonSafe),
			m: e.m.map(r4),
			s: e.s.map(r4)
		};
	});
}

/* ---- THE MARKUP ------------------------------------------------------------------------------------
   ONE BAR PER CANDIDATE, height = fit on a FIXED 0..1 scale. An unscorable candidate - too few legs
   or too few buckets to say anything - renders as an empty slot, which must not be mistakable for a
   fit of zero: the two would otherwise look identical.

   THE INITIAL STATE IS RENDERED IN NODE AT THE CONFIGURED KNOBS, from the same engine the browser
   runs, so the page is already correct before a single event fires. */
const bars = (tab, win, declared, role) => '<span class="bars" data-row="' + role + '">'
	+ CANDIDATE_PERIODS.map((p, i) => {
		const m = tab[i];
		const un = m === null || m === undefined;
		const cls = ['bar'];
		if(un)cls.push('un');
		if(win && p === win)cls.push('win');
		if(p === declared)cls.push('decl');
		return '<span class="' + cls.join(' ') + '" title="' + esc(p) + ' fit ' + esc(pct(m)) + '">'
			+ (un ? '<i class="none"></i>'
				: '<i style="height:' + Math.max(2, Math.round((1 - m) * 100)) + '%"></i>')
			+ '</span>';
	}).join('') + '</span>';

const vd = (pick, declared, role) => {
	const v = verdictOf(pick, declared);
	return '<span class="vd ' + v.cls + '" data-vd="' + role + '">' + esc(v.text) + '</span>';
};

/* THE INITIALS SIT ABOVE THE PAIR, ONCE. The columns are the same seven in the same order on every
   row of the page, so naming them once at the top of the stream is enough. */
const scaleHead = declared => '<div class="frow head"><span class="flab"></span><span class="bars">'
	+ CANDIDATE_PERIODS.map(pd => '<span class="tick' + (pd === declared ? ' decl' : '') + '"'
		+ ' title="' + esc(pd) + '">' + esc(SHORT[pd]) + '</span>').join('')
	+ '</span></div>';

/* THE DECISION ROW NAMES THE ROUTE, not only the answer: the reader is being asked to judge the
   RULE, and a decision that never says how it was reached cannot be argued with. */
const decisionRow = r => {
	const d = decisionOf(r.res, r.data.declared);
	return '<div class="frow dec' + (d.cls ? ' ' + d.cls : '') + '" data-dec="1">'
		+ '<span class="flab">decision</span>'
		+ '<span class="dv" data-dv="1">' + esc(d.text) + '</span>'
		+ '<span class="src" data-src="1">route ' + esc(d.src) + '</span></div>';
};

const groupLine = d => d.groups.length > 1
	? '<span class="grp">'
		+ d.groupKeys.map((k, i) => esc(k) + '×' + d.groups[i]).join(' · ') + '</span>'
	: '<span class="grp one">one merchant</span>';

const body = r => '<div class="fit" data-sid="' + esc(r.data.id) + '">'
	+ scaleHead(r.data.declared)
	+ '<div class="frow"><span class="flab">merged</span>'
		+ bars(r.data.m, r.res.merged && r.res.merged.period, r.data.declared, 'm')
		+ vd(r.res.merged, r.data.declared, 'm') + '</div>'
	+ '<div class="frow"><span class="flab">split</span>'
		+ bars(r.data.s, r.res.split && r.res.split.period, r.data.declared, 's')
		+ vd(r.res.split, r.data.declared, 's') + groupLine(r.data)
	+ '</div>'
	+ decisionRow(r)
	+ '</div>';

const byEvidence = (a, b) => b.data.legs - a.data.legs
	|| (String(a.data.name) < String(b.data.name) ? -1 : String(a.data.name) > String(b.data.name) ? 1 : 0);

const card = r => ({
	id: r.data.id, name: r.data.name,
	search: [r.data.name, r.data.id, r.data.declared,
		r.res.merged ? r.res.merged.period : '', r.res.split ? r.res.split.period : '',
		r.res.route].join(' ').toLowerCase(),
	meta: [
		{cls: 'period', value: r.data.declared || 'no period'},
		{cls: 'legs', value: r.data.windowLegs + ' of ' + r.data.legs, label: 'legs this year'},
		{cls: 'sid', value: r.data.id}
	],
	flagged: r.flagged,
	body: body(r)
});

const section = (key, title, list) =>
	({key: key, title: title, cards: list.slice().sort(byEvidence).map(card)});

/* ---- THE CONTROL PANEL -----------------------------------------------------------------------------
   THE COHORT TAB, THEN THE SUMMARY, THEN THE THREE NUMBERS. The summary is the thing being watched;
   the hand sits on a control at the bottom of the block and the eye on the number at the top of it,
   which is the right way round on a phone held in one hand.

   MEASURED IS PRINTED NEXT TO AGREED, ALWAYS. A rule that reaches 25/25 by declining to claim
   anything has measured nothing, and a single agreement number cannot tell those two apart. */
const radioRow = (label, name, opts) => '<div class="knob"><span class="kl">' + esc(label)
	+ '</span><span class="seg">'
	+ opts.map(o => '<label><input type="radio" name="' + name + '" value="' + esc(o.v) + '"'
		+ (o.on ? ' checked' : '') + '><span>' + esc(o.t) + '</span></label>').join('')
	+ '</span></div>';

const sumRow = (rt, s) => '<tr' + (s.counts[rt] ? '' : ' class="zero"') + '><td>'
	+ esc(ROUTE_LABEL[rt]) + '</td><td class="n">' + s.counts[rt] + '</td><td class="n">'
	+ (rt === 'declined' ? '—' : s.agrees[rt]) + '</td></tr>';

const badLine = s => s.bad.length
	? 'differs from the declaration: '
		+ s.bad.map(b => '<a href="#" data-goto="' + esc(b.id) + '">' + esc(b.name) + '</a> '
			+ esc(b.period || 'no claim') + ' (declared ' + esc(b.declared) + ')').join(' · ')
	: 'every stream matches its declaration';

const panel = s => '<section class="panel"><div class="pbox">'
	+ radioRow('cohort', 'cohort',
		COHORTS.map((c, i) => ({v: c.key, t: c.label, on: i === 0})))
	+ '<p class="cnote" id="cnote">' + esc(COHORTS[0].note) + '</p>'
	+ '<p class="sumhead" id="sumhead">' + esc(s.headline) + '</p>'
	+ '<table class="sumt"><thead><tr><th>route</th><th class="n">n</th><th class="n">matches</th></tr>'
	+ '</thead><tbody id="sumrows">' + ROUTES.map(rt => sumRow(rt, s)).join('') + '</tbody></table>'
	+ '<p class="sumbad" id="sumbad">' + badLine(s) + '</p>'
	+ '<div class="knobs">'
	+ '<div class="knob"><span class="kl">fit threshold</span>'
		+ '<input type="range" id="thr" min="50" max="99" step="1" value="'
		+ Math.round(FIT_CONFIG.fitThreshold * 100) + '">'
		+ '<b class="kv" id="thrv">' + Math.round(FIT_CONFIG.fitThreshold * 100) + '%</b></div>'
	+ '<div class="knob"><span class="kl">min legs to claim</span>'
		+ '<input type="number" id="minlegs" min="1" max="10" step="1" value="'
		+ FIT_CONFIG.minLegsToClaim + '"></div>'
	+ '<div class="knob"><span class="kl">min group legs</span>'
		+ '<input type="number" id="mingroup" min="1" max="10" step="1" value="'
		+ FIT_CONFIG.minGroupLegs + '"></div>'
	+ '</div></div></section>';

/* ---- THE PAGE'S OWN SCRIPT -------------------------------------------------------------------------
   NO BACKSLASH, NO BACKTICK, NO EXCEPTIONS - see the file header. Attribute quoting inside these
   strings is done with apostrophes, so no character in here ever needs an escape. */
const wiring = (data, notes) => DECISION_ENGINE + `
var DATA = ` + JSON.stringify(data) + `;
var NOTES = ` + JSON.stringify(notes) + `;
var fits = {};
var sumhead = document.getElementById("sumhead");
var sumrows = document.getElementById("sumrows");
var sumbad = document.getElementById("sumbad");
var cnote = document.getElementById("cnote");

function radio(n){
	var e = document.querySelector("input[name='" + n + "']:checked");
	return e ? e.value : null;
}

function knobs(){
	return {
		thr: Number(document.getElementById("thr").value) / 100,
		minLegs: Number(document.getElementById("minlegs").value),
		minGroup: Number(document.getElementById("mingroup").value)
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

/* THE SUMMARY IS ALWAYS ABOUT THE COHORT ON SCREEN. Summing the two would average a cohort with
   ground truth into one without any, and the combined number would mean nothing at all. */
function render(){
	var k = knobs(), cohort = radio("cohort"), i, rt, n, d, r, dec, f, html;
	document.getElementById("thrv").textContent = Math.round(k.thr * 100) + "%";
	document.body.setAttribute("data-cohort", cohort);
	cnote.textContent = NOTES[cohort] || "";

	var live = [];
	for(i = 0; i < DATA.length; i++)if(DATA[i].cohort === cohort)live.push(DATA[i]);
	var s = summarizeAll(live, k);
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

	if(!s.bad.length)sumbad.textContent = "every stream matches its declaration";
	else {
		html = "";
		for(i = 0; i < s.bad.length; i++){
			d = s.bad[i];
			html += (i ? " " + DOT + " " : "") + "<a href='#' data-goto='" + d.id + "'>" + d.name
				+ "</a> " + (d.period ? d.period : "no claim") + " (declared " + d.declared + ")";
		}
		sumbad.innerHTML = "differs from the declaration: " + html;
	}

	//every card is redrawn, on screen or not, so switching tabs never shows a stale row
	for(i = 0; i < DATA.length; i++){
		d = DATA[i];
		f = fits[d.id];
		if(!f)continue;
		r = resolveOne(d, k);
		drawBars(f.mbars, d.m, r.merged ? r.merged.period : null, d.declared);
		drawBars(f.sbars, d.s, r.split ? r.split.period : null, d.declared);
		setVd(f.mvd, verdictOf(r.merged, d.declared));
		setVd(f.svd, verdictOf(r.split, d.declared));
		dec = decisionOf(r, d.declared);
		if(f.dv)f.dv.textContent = dec.text;
		if(f.src)f.src.textContent = "route " + dec.src;
		if(f.dec)f.dec.className = dec.cls ? "frow dec " + dec.cls : "frow dec";
		if(f.card)f.card.classList.toggle("knobwrong", d.cohort === "validated" && !r.agree);
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

/* THE STREAMS THAT DIFFER ARE THE POINT OF THE SUMMARY, so their names are links into the list
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

/* ---- THE PAGE --------------------------------------------------------------------------------------
   `cohorts` is {validated: rows, yearly: rows}, each row {stream, legs}. Both are resolved in node at
   the configured knobs so the page opens correct, and both ship in one DATA blob so the tab is a
   filter rather than a second page. */
export function buildFitAuditPage(cohorts, meta){
	const m = meta || {};
	const c = cohorts || {};
	const anchor = m.anchor;

	const data = COHORTS.reduce((acc, co) =>
		acc.concat(fitData(c[co.key] || [], anchor, co.key)), []);

	//a reader who moves nothing is looking at exactly what production does
	const knobs = DEFAULT_KNOBS;
	const resolved = data.map(d => ({data: d, res: resolveOne(d, knobs)}));
	resolved.forEach(r => {
		r.flagged = r.data.cohort === 'validated' && !r.res.agree;
	});

	const of = (cohort, pred) => resolved.filter(r => r.data.cohort === cohort && pred(r));
	const summaries = {};
	COHORTS.forEach(co => {
		summaries[co.key] = summarizeAll(data.filter(d => d.cohort === co.key), knobs);
	});
	const sv = summaries.validated, sy = summaries.yearly;

	const anchorDate = anchor ? new Date(anchor) : null;
	const anchorText = anchorDate
		? anchorDate.getFullYear() + '-' + String(anchorDate.getMonth() + 1).padStart(2, '0')
			+ '-' + String(anchorDate.getDate()).padStart(2, '0')
		: '—';

	const notes = {};
	COHORTS.forEach(co => { notes[co.key] = co.note; });

	return renderAuditPage({
		title: 'Cycle fit',
		phase: '§2·detector',
		storageKey: 'kawa.audit.cyclefit.v2',
		capturedAt: m.capturedAt,
		versionTitle: m.version,
		extraCss: CSS,
		legendHtml: LEGEND,
		panelHtml: panel(sv),
		extraScript: wiring(data, notes),
		metaLine: [
			{label: 'validated', value: sv.agree + '/' + sv.total},
			{label: 'measured', value: sv.measured},
			{label: 'yearly', value: sy.total},
			{label: 'yearly measured', value: sy.measured},
			{label: 'anchor', value: anchorText}
		],
		groups: [
			section('v-differs', 'Validated — the rule disagrees with the declaration',
				of('validated', r => !r.res.agree)),
			section('v-measured', 'Validated — read off the ledger, and it matched',
				of('validated', r => r.res.measured && r.res.agree)),
			section('v-declared', 'Validated — no measurement, the declaration stands',
				of('validated', r => !r.res.measured && r.res.agree)),
			section('y-measured', 'Yearly — the ledger named a cycle',
				of('yearly', r => r.res.measured)),
			section('y-declared', 'Yearly — nothing to measure, it stays a yearly envelope',
				of('yearly', r => !r.res.measured))
		]
	});
}

const LEGEND = '<span class="lg">the cohort tab and the three numbers below rescore the page live</span>'
	+ '<span class="lg"><i class="sw win"></i>the pick</span>'
	+ '<span class="lg"><i class="sw decl"></i>declared period</span>'
	+ '<span class="lg"><i class="sw un"></i>not scorable</span>'
	+ '<span class="lg">taller bar = better fit · 100% repeats exactly · 0% no structure</span>'
	+ '<span class="lg">scale is absolute, never rescaled per stream</span>'
	+ '<span class="lg">the pick is the SHORTEST period over the threshold, not the tallest bar</span>'
	+ '<span class="lg">scored on this reporting year only, from the anchor</span>'
	+ '<span class="lg">route both = merged and split agreed · declared = the fallback, not a measurement</span>'
	+ '<span class="lg">capped = a fit was found, but longer than declared, so the declaration won</span>'
	+ '<span class="lg">' + CANDIDATE_PERIODS.map(p => SHORT[p] + ' ' + p).join(' · ') + '</span>';

const CSS = `
.panel{max-width:1000px;margin:0 auto;padding:10px 14px 0}
.pbox{border:1px solid var(--rule);border-radius:7px;background:var(--surface);padding:9px 11px}
.cnote{margin:5px 0 7px;font:400 10px/1.3 var(--sans);color:var(--ink-faint)}
.sumhead{margin:0 0 6px;font:600 13px/1.3 var(--mono);color:var(--ink)}
.sumt{border-collapse:collapse;font:400 11px/1.4 var(--mono);color:var(--ink-soft)}
.sumt th{font:500 9px/1 var(--mono);text-transform:uppercase;letter-spacing:.05em;
	color:var(--ink-faint);text-align:left;padding:0 10px 2px 0}
.sumt td{padding:0 10px 0 0;white-space:nowrap}
.sumt .n{text-align:right;width:46px}
.sumt tr.zero{color:var(--ink-faint);opacity:.5}
.sumbad{margin:6px 0 0;font:400 10.5px/1.45 var(--mono);color:var(--flag)}
.sumbad a{color:var(--flag);cursor:pointer}
.knobs{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding-top:7px;
	border-top:1px dashed var(--rule)}
.knob{display:flex;align-items:center;gap:8px;min-width:0}
.kl{flex:0 0 88px;font:500 9px/1.2 var(--mono);color:var(--ink-faint);text-transform:uppercase;
	letter-spacing:.05em}
.kv{font:600 11px/1 var(--mono);color:var(--ink);flex:0 0 40px}
.knob input[type=range]{flex:1 1 auto;min-width:70px;max-width:240px;height:18px;
	accent-color:var(--accent)}
.knob input[type=number]{width:56px;font:500 11.5px var(--mono);color:var(--ink);
	background:var(--paper);border:1px solid var(--rule);border-radius:5px;padding:2px 5px}
.seg{display:flex;flex-wrap:wrap;gap:3px;min-width:0}
.seg label{display:inline-flex;align-items:center;gap:4px;font:400 11px/1 var(--sans);
	color:var(--ink-soft);background:var(--paper);border:1px solid var(--rule);border-radius:5px;
	padding:4px 7px;cursor:pointer;white-space:nowrap}
.seg input{margin:0;width:12px;height:12px;accent-color:var(--accent)}
body[data-cohort="validated"] .group[data-group^="y-"]{display:none}
body[data-cohort="yearly"] .group[data-group^="v-"]{display:none}
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
