/* ==================================================================================================
   THE §3 AUDIT PAGE — WHAT SHAPE THE MONEY MAKES INSIDE A CYCLE, AND THE PICTURE THAT SHOWS IT.

   ONE ROW PER ACCOUNT, NOT PER STREAM, because that is the unit the stage decides on: a stream whose
   money moves through two accounts has two shapes and two confidences, and a single row for the pair
   would describe neither.

   THE HISTOGRAM IS THE POINT OF THE PAGE. Every cycle is laid on top of every other and the bars
   count how many movements ever landed on each day of the cycle. A lump is one tall bar with nothing
   beside it. Two lumps are two towers with a gap. A spread is a low wall across the whole width. The
   reader does not have to trust the classifier - the shape is visible, and a row whose bars disagree
   with its label is a finding they can see without reading a number.

   THE BARS ARE THE SAME ARRAY THE DECISION WAS READ OFF, from dayHistogram(), not a redrawing of it.
   A picture computed separately from the decision illustrates the decision rather than checking it.

   THE EMITTED SCRIPT CARRIES NO BACKSLASH AND NO BACKTICK - see buildFitAuditPage.js. It is written
   inside a template literal that eats one level of escaping, and the failure is silent: the page's
   JavaScript stops parsing while every assertion about the markup still passes.
   ================================================================================================== */

import {renderAuditPage, esc} from './auditShell';
import {Shape} from './shapeDetermination';
import {SHAPE_CONFIG} from './shapeConfig';

const YEARLY = {yearly: true, biyearly: true};

const DASH = '—';
const DOT = '·';

/* THE DAY LABEL IS THE CYCLE'S OWN DAY, and the calendar date it usually falls on is printed beside
   it because that is the one a person recognises. Day 11 of a cycle seamed on the 21st means the
   1st or the 2nd depending on the month, so the calendar date is the commonest one observed rather
   than a conversion. */
const dayLabel = d => 'd' + d.day + (d.wobble ? '±' + d.wobble : '');

const shapeText = a => {
	if(a.shape === Shape.lump || a.shape === Shape.multiLump)
		return a.days.map(dayLabel).join(' ' + DOT + ' ');
	if(a.shape === Shape.spread)return 'no single day ' + DOT + ' that is the shape';
	return DASH;
};

/* ---- THE HISTOGRAM ---------------------------------------------------------------------------
   ONE BAR PER DAY OF THE CYCLE, height scaled to the busiest day in THIS row. The scale is per row
   on purpose and it is the opposite of the §2 bars: there the question was "how good is this fit"
   and an absolute scale was the whole point, here the question is "what SHAPE is this" and a rent of
   9 movements and a grocery week of 300 have to be comparable as pictures. The counts are in the
   tooltip for anyone who wants the absolute number. */
const histogram = (bins, days) => {
	const peak = bins.reduce((m, n) => (n > m ? n : m), 0) || 1;
	const marked = {};
	(days || []).forEach(d => { marked[d.day] = true; });
	return '<span class="hist">'
		+ bins.map((n, i) => '<i class="hb' + (marked[i] ? ' pick' : '') + (n ? '' : ' zero') + '"'
			+ ' style="height:' + (n ? Math.max(8, Math.round(n / peak * 100)) : 2) + '%"'
			+ ' title="day ' + i + ': ' + n + ' movement' + (n === 1 ? '' : 's') + '"></i>').join('')
		+ '</span>';
};

const pct = v => (v === null || v === undefined) ? DASH : Math.round(v * 100) + '%';

const confCls = v => v === null || v === undefined ? 'cf none'
	: (v >= 0.9 ? 'cf full' : 'cf part');

const row = r => '<tr data-search="' + esc(r.search) + '" class="' + esc(r.rowCls) + '">'
	+ '<td class="nm">' + esc(r.name)
		+ (r.acct ? '<span class="acct">' + esc(r.acct) + '</span>' : '') + '</td>'
	+ '<td class="cy">' + esc(r.cycle) + '</td>'
	+ '<td class="sh ' + esc(r.shapeCls) + '">' + esc(r.shape) + '</td>'
	+ '<td class="dy">' + esc(r.days) + '</td>'
	+ '<td class="' + esc(r.confCls) + '">' + esc(r.conf) + '</td>'
	+ '<td class="hc">' + r.hist + '</td>'
	+ '<td class="ck"><input type="checkbox" class="okbox" data-sid="' + esc(r.id) + '"'
		+ ' aria-label="accept ' + esc(r.name) + '"></td>'
	+ '</tr>';

/* THE ROWS ARE THE STAGE'S OWN OUTPUT. `explainShapeOf` is what the module returns for a stream;
   nothing here recomputes a count, a day or a confidence. */
export function shapeRows(predictor){
	const rows = [];
	predictor.reviewable().forEach(stream => {
		const e = predictor.explainShapeOf(stream.id, stream);
		/* A STREAM STILL YEARLY AFTER §2 IS NOT THIS STAGE'S TO SHAPE, so it is not a row. 51 of them
		   as empty rows would bury the 20 this page exists to check - and each would draw a 365-day
		   histogram, which is neither readable nor cheap. */
		if(!e.cycle || YEARLY[e.cycle.name])return;
		const multi = e.allocations.length > 1;
		e.allocations.forEach((a, i) => {
			const account = predictor.accountsByHash[a.accountId];
			rows.push({
				id: stream.id + ':' + (a.accountId || i),
				name: stream.name,
				acct: multi ? (account && account.name ? account.name : 'account ' + (i + 1)) : '',
				cycle: e.cycle ? e.cycle.name : DASH,
				shape: a.shape || (a.reason ? 'none' : DASH),
				shapeCls: a.shape ? ('s-' + a.shape) : 's-none',
				reason: a.reason || '',
				days: shapeText(a),
				conf: pct(a.confidence),
				confCls: confCls(a.confidence),
				confidence: a.confidence,
				hist: histogram(a.histogram, a.days),
				cycles: a.cyclesObserved,
				counts: a.eventsPerCycle,
				steady: a.steadyShare,
				busy: a.busyShare,
				search: [stream.name, e.cycle ? e.cycle.name : '', a.shape || 'none',
					a.reason || ''].join(' ').toLowerCase(),
				rowCls: a.shape ? '' : 'faint'
			});
		});
	});
	return rows;
}

const SHAPE_ORDER = {lump: 0, multiLump: 1, spread: 2};

export function summarizeShapes(rows){
	const by = {};
	rows.forEach(r => {
		const k = r.shape === 'none' ? (r.reason || 'none') : r.shape;
		by[k] = (by[k] || 0) + 1;
	});
	return by;
}

export function buildShapeAuditPage(predictor, meta){
	const m = meta || {};
	const rows = shapeRows(predictor);
	const shaped = rows.filter(r => r.confidence !== null && r.confidence !== undefined);
	const by = summarizeShapes(rows);

	/* SHAPED FIRST AND MOST CONFIDENT FIRST, then everything the stage declined. A review reads down
	   from the claims worth checking to the rows where there is nothing to check. */
	const ordered = rows.slice().sort((a, b) => {
		const sa = a.shape in SHAPE_ORDER ? SHAPE_ORDER[a.shape] : 9;
		const sb = b.shape in SHAPE_ORDER ? SHAPE_ORDER[b.shape] : 9;
		if(sa !== sb)return sa - sb;
		const ca = a.confidence === null || a.confidence === undefined ? -1 : a.confidence;
		const cb = b.confidence === null || b.confidence === undefined ? -1 : b.confidence;
		if(ca !== cb)return cb - ca;
		return String(a.name) < String(b.name) ? -1 : 1;
	});

	const anchor = m.anchor ? new Date(m.anchor) : null;
	const anchorText = anchor
		? anchor.getFullYear() + '-' + String(anchor.getMonth() + 1).padStart(2, '0')
			+ '-' + String(anchor.getDate()).padStart(2, '0')
		: DASH;

	const table = '<section class="shp"><table class="sht"><thead><tr>'
		+ '<th>stream</th><th>cycle</th><th>shape</th><th>days</th><th>conf</th>'
		+ '<th>every cycle, laid on top of each other</th><th class="ck">ok</th>'
		+ '</tr></thead><tbody id="shrows">' + ordered.map(row).join('') + '</tbody></table></section>';

	return renderAuditPage({
		title: 'Cycle shape',
		phase: '§3',
		storageKey: 'kawa.audit.shape.v1',
		capturedAt: m.capturedAt,
		versionTitle: m.version,
		extraCss: CSS,
		legendHtml: LEGEND,
		panelHtml: table,
		extraScript: SCRIPT,
		metaLine: [
			{label: 'rows', value: rows.length},
			{label: 'shaped', value: shaped.length},
			{label: 'lump', value: by.lump || 0},
			{label: 'multiLump', value: by.multiLump || 0},
			{label: 'spread', value: by.spread || 0},
			{label: 'anchor', value: anchorText},
			{label: 'steady bar', value: Math.round(SHAPE_CONFIG.minSteadyShare * 100) + '%'}
		],
		groups: []
	});
}

const LEGEND = '<span class="lg">one row per ACCOUNT - a stream on two accounts has two shapes</span>'
	+ '<span class="lg">the bars are every cycle laid on top of each other; x is the day of the cycle</span>'
	+ '<span class="lg">day 0 is the cycle seam, so d11 on a monthly cycle seamed the 21st is the 1st</span>'
	+ '<span class="lg"><i class="sw pick"></i>a day the stage claims</span>'
	+ '<span class="lg">lump = one tower ' + DOT + ' multiLump = towers with gaps ' + DOT
		+ ' spread = a low wall</span>'
	+ '<span class="lg">bar height is scaled to the busiest day IN THAT ROW; hover for the count</span>'
	+ '<span class="lg">confidence = how often the cycle carried exactly its usual number of movements</span>'
	+ '<span class="lg">no shape = the count does not repeat, or there was nothing to read</span>';

const CSS = `
.shp{max-width:1100px;margin:0 auto;padding:8px 14px 0}
.sht{width:100%;border-collapse:collapse;font:400 12px/1.45 var(--mono);
	font-variant-numeric:tabular-nums}
.sht th{font:500 9px/1.2 var(--mono);text-transform:uppercase;letter-spacing:.05em;
	color:var(--ink-faint);text-align:left;padding:0 8px 4px 0;border-bottom:1px solid var(--rule)}
.sht td{padding:5px 8px 5px 0;border-bottom:1px solid var(--rule);vertical-align:middle}
.sht tr.faint td{opacity:.55}
.sht .nm{color:var(--ink);min-width:150px}
.sht .acct{display:block;font-size:10px;color:var(--ink-faint)}
.sht .cy{color:var(--ink-faint);white-space:nowrap}
.sht .sh{white-space:nowrap;font-weight:600}
.sht .s-lump{color:var(--realtime)}
.sht .s-multiLump{color:var(--accent)}
.sht .s-spread{color:var(--ink-soft)}
.sht .s-none{color:var(--ink-faint);font-weight:400}
.sht .dy{white-space:nowrap;color:var(--ink-soft);font-size:11px}
.sht .cf{white-space:nowrap;font-size:11px}
.sht .cf.full{color:var(--realtime);font-weight:600}
.sht .cf.part{color:var(--ink-soft)}
.sht .cf.none{color:var(--ink-faint)}
.sht .hc{width:40%}
.hist{display:flex;align-items:flex-end;gap:1px;height:26px;width:100%;min-width:120px}
.hb{flex:1 1 0;background:var(--accent-soft);border-radius:1px;min-width:2px}
.hb.zero{background:var(--sunk)}
.hb.pick{background:var(--accent)}
.sht th.ck,.sht td.ck{text-align:right;padding-right:0;width:30px}
.sht .okbox{width:19px;height:19px;accent-color:var(--accent);margin:0}
.sw{display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--sunk)}
.sw.pick{background:var(--accent)}
.lg{display:inline-flex;align-items:center;gap:4px;margin-right:11px;white-space:nowrap}
@media (max-width:640px){
	.sht .hc{width:32%}
	.sht .nm{min-width:110px}
}
`;

/* THE SEARCH BOX FILTERS THE TABLE. The shell filters cards and this page has none, so the filter
   would otherwise be visibly present and do nothing. */
const SCRIPT = `
var q = document.getElementById("q");
var rows = [].slice.call(document.querySelectorAll("#shrows tr"));
function filterRows(){
	var t = q ? q.value.trim().toLowerCase() : "";
	rows.forEach(function(tr){
		tr.hidden = !!t && tr.getAttribute("data-search").indexOf(t) === -1;
	});
}
if(q)q.addEventListener("input", filterRows);
`;

export default buildShapeAuditPage;
