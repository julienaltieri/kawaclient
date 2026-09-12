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
	/* EVERY SLOT IS LABELLED, including the empty ones, because the gaps are half of what the picture
	   says: two towers at d3 and d17 only read as two lumps if the reader can see fourteen numbered
	   slots of nothing between them. The number is the day of the CYCLE, matching the days column -
	   day 0 is the seam. */
	return '<span class="hist">'
		+ bins.map((n, i) => '<span class="hs' + (marked[i] ? ' pick' : '') + (n ? '' : ' zero') + '"'
			+ ' title="day ' + i + ': ' + n + ' movement' + (n === 1 ? '' : 's') + '">'
			+ '<i style="height:' + (n ? Math.max(8, Math.round(n / peak * 100)) : 2) + '%"></i>'
			+ '<b>' + i + '</b></span>').join('')
		+ '</span>';
};

const pct = v => (v === null || v === undefined) ? DASH : Math.round(v * 100) + '%';

/* THE COLUMN IS FOCUS, NOT CONFIDENCE, and the difference is the point. Focus is how tightly the
   movements land on one day - high for a lump, near zero for a spread. Labelling it "confidence"
   made the clearest row on the page, groceries at 0.11, read as the least trustworthy one: a spread
   is DEFINED by having no focus, so a low number there is the evidence for the answer rather than
   doubt about it. */
const focusCls = v => v === null || v === undefined ? 'cf none'
	: (v >= 0.9 ? 'cf full' : v >= SHAPE_CONFIG.minConcentration ? 'cf part' : 'cf low');

/* A GRID, NOT A TABLE. Seven table columns do not fit a phone, and the three that fell off the
   right edge - the histogram, the confidence and the tick - are the three the review is done with.
   As a grid the same row can keep its columns on a wide screen and stack into name / facts / picture
   on a narrow one, without a second set of markup.

   THE FOUR FACTS SIT IN ONE CELL that is itself a grid, so they line up column-wise across rows on a
   wide screen and become a wrapping line on a phone. */
const row = r => '<div class="srow ' + esc(r.rowCls) + '" data-search="' + esc(r.search) + '">'
	+ '<div class="c-nm"><b>' + esc(r.name) + '</b>'
		+ (r.acct ? '<span class="acct">' + esc(r.acct) + '</span>' : '') + '</div>'
	+ '<div class="c-meta">'
		+ '<span class="m-cy">' + esc(r.cycle) + '</span>'
		+ '<span class="m-sh ' + esc(r.shapeCls) + '">' + esc(r.shape) + '</span>'
		+ '<span class="m-dy">' + esc(r.days) + '</span>'
		+ '<span class="m-cf ' + esc(r.confCls) + '">' + esc(r.conf) + '</span>'
	+ '</div>'
	+ '<div class="c-hi">' + r.hist + '</div>'
	+ '<div class="c-ck"><input type="checkbox" class="okbox" data-sid="' + esc(r.id) + '"'
		+ ' aria-label="accept ' + esc(r.name) + '"></div>'
	+ '</div>';

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
				conf: pct(a.concentration),
				confCls: focusCls(a.concentration),
				confidence: a.confidence,
				concentration: a.concentration,
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
		const ca = a.concentration === null || a.concentration === undefined ? -1 : a.concentration;
		const cb = b.concentration === null || b.concentration === undefined ? -1 : b.concentration;
		if(ca !== cb)return cb - ca;
		return String(a.name) < String(b.name) ? -1 : 1;
	});

	const anchor = m.anchor ? new Date(m.anchor) : null;
	const anchorText = anchor
		? anchor.getFullYear() + '-' + String(anchor.getMonth() + 1).padStart(2, '0')
			+ '-' + String(anchor.getDate()).padStart(2, '0')
		: DASH;

	//the header is a row of the same grid, and it is hidden on a phone where the labels are in the way
	const head = '<div class="srow shead">'
		+ '<div class="c-nm">stream</div>'
		+ '<div class="c-meta"><span>cycle</span><span>shape</span><span>days</span><span>focus</span></div>'
		+ '<div class="c-hi">every cycle, laid on top of each other</div>'
		+ '<div class="c-ck">ok</div></div>';
	const table = '<section class="shp">' + head
		+ '<div id="shrows">' + ordered.map(row).join('') + '</div></section>';

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
			{label: 'focus bar', value: SHAPE_CONFIG.minConcentration.toFixed(2)}
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
	+ '<span class="lg">the number under each bar is the day of the cycle; every slot is shown</span>'
	+ '<span class="lg">bar height is scaled to the busiest day IN THAT ROW; hover for the count</span>'
	+ '<span class="lg">FOCUS = how tightly the movements land on one day, 1.00 = all on the same day</span>'
	+ '<span class="lg">a lump is high focus; a spread is near zero focus, which IS the answer not a doubt</span>'
	+ '<span class="lg">two lumps are found by wrapping the cycle twice, three by wrapping it three times</span>'
	+ '<span class="lg">no shape = the count does not repeat, or there was nothing to read</span>';

const CSS = `
.shp{max-width:1100px;margin:0 auto;padding:8px 14px 24px}

/* WIDE: one grid, so every row's columns line up without a table. */
.srow{display:grid;grid-template-columns:210px 300px 1fr 30px;align-items:center;gap:10px;
	padding:7px 0;border-bottom:1px solid var(--rule);
	font:400 12px/1.4 var(--mono);font-variant-numeric:tabular-nums}
.srow.faint{opacity:.55}
.shead{border-bottom:1px solid var(--rule);padding-bottom:5px;
	font:500 9px/1.2 var(--mono);text-transform:uppercase;letter-spacing:.05em;
	color:var(--ink-faint)}
.shead b,.shead .c-nm{font-weight:500}

.c-nm{min-width:0}
.c-nm b{font-weight:600;color:var(--ink);word-break:break-word}
.acct{display:block;font-size:10px;color:var(--ink-faint);word-break:break-word}

.c-meta{display:grid;grid-template-columns:74px 74px 96px 46px;gap:6px;align-items:center;
	min-width:0}
.m-cy{color:var(--ink-faint)}
.m-sh{font-weight:600;white-space:nowrap}
.s-lump{color:var(--realtime)}
.s-multiLump{color:var(--accent)}
.s-spread{color:var(--ink-soft)}
.s-none{color:var(--ink-faint);font-weight:400}
.m-dy{color:var(--ink-soft);font-size:11px;white-space:nowrap;overflow:hidden;
	text-overflow:ellipsis}
.m-cf{font-size:11px;text-align:right}
.cf.full{color:var(--realtime);font-weight:600}
.cf.part{color:var(--ink-soft)}
.cf.low{color:var(--ink-faint)}
.cf.none{color:var(--ink-faint)}

.c-hi{min-width:0}
.hist{display:flex;align-items:flex-end;gap:1px;width:100%}
.hs{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:stretch;
	justify-content:flex-end;height:38px}
.hs i{display:block;width:100%;background:var(--accent-soft);border-radius:1px}
.hs.zero i{background:var(--sunk)}
.hs.pick i{background:var(--accent)}
/* THE AXIS. Small enough that thirty-one of them fit a phone, and the claimed days are the only
   ones that are not faint - so the label a reader checks stands out from the ruler around it. */
.hs b{display:block;font:400 7px/1.5 var(--mono);color:var(--ink-faint);text-align:center;
	font-weight:400;letter-spacing:-.02em}
.hs.pick b{color:var(--accent);font-weight:700}
.hs.zero b{opacity:.45}

.c-ck{text-align:right}
.c-ck .okbox{width:20px;height:20px;accent-color:var(--accent);margin:0}

.sw{display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--sunk)}
.sw.pick{background:var(--accent)}
/* THE LEGEND WRAPS. Every line of it was running off the right edge of a phone. */
.lg{display:inline-flex;align-items:center;gap:4px;margin-right:11px}

/* NARROW: name and tick on one line, the four facts on the next, the picture full width under
   them. The picture is the point of the page and it gets the whole screen rather than a sliver. */
@media (max-width:760px){
	.shp{padding:6px 10px 24px}
	.shead{display:none}
	.srow{grid-template-columns:1fr 30px;
		grid-template-areas:"nm ck" "meta meta" "hi hi";
		gap:5px 8px;padding:10px 0}
	.c-nm{grid-area:nm}
	.c-ck{grid-area:ck}
	.c-meta{grid-area:meta;display:flex;flex-wrap:wrap;gap:4px 10px}
	.m-dy{overflow:visible}
	.m-cf{text-align:left}
	.c-hi{grid-area:hi}
	.hs{height:44px}
	.hs b{font-size:7.5px}
}
`;

/* THE SEARCH BOX FILTERS THE TABLE. The shell filters cards and this page has none, so the filter
   would otherwise be visibly present and do nothing. */
const SCRIPT = `
var q = document.getElementById("q");
var rows = [].slice.call(document.querySelectorAll("#shrows .srow"));
function filterRows(){
	var t = q ? q.value.trim().toLowerCase() : "";
	rows.forEach(function(tr){
		tr.hidden = !!t && tr.getAttribute("data-search").indexOf(t) === -1;
	});
}
if(q)q.addEventListener("input", filterRows);
`;

export default buildShapeAuditPage;
