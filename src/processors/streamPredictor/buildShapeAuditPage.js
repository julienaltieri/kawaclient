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
			+ '<span class="hw"><i style="height:'
			+ (n ? Math.max(8, Math.round(n / peak * 100)) : 2) + '%"></i></span>'
			+ '<b>' + i + '</b></span>').join('')
		+ '</span>';
};

/* A SCORE IS COLOURED BY HOW GOOD IT IS, not by its raw value, because the four candidates do not
   share a scale: a p-value of 0.001 is excellent and a tightness of 0.001 is hopeless. Each reading
   carries a normalised 0..1 `v` for exactly this. */
const scoreCls = sc => !sc ? 'm-sc none'
	: (sc.v >= 0.8 ? 'm-sc full' : sc.v >= 0.5 ? 'm-sc part' : 'm-sc low');

/* A GRID, NOT A TABLE. Seven table columns do not fit a phone, and the three that fell off the
   right edge - the histogram, the confidence and the tick - are the three the review is done with.
   As a grid the same row can keep its columns on a wide screen and stack into name / facts / picture
   on a narrow one, without a second set of markup.

   THE FOUR FACTS SIT IN ONE CELL that is itself a grid, so they line up column-wise across rows on a
   wide screen and become a wrapping line on a phone. */
const row = r => '<div class="srow ' + esc(r.rowCls) + '" data-id="' + esc(r.id) + '"'
	+ ' data-search="' + esc(r.search) + '">'
	+ '<div class="c-nm"><b>' + esc(r.name) + '</b>'
		+ (r.acct ? '<span class="acct">' + esc(r.acct) + '</span>' : '')
		+ (r.series ? '<span class="ser">' + esc(r.series) + '</span>' : '') + '</div>'
	+ '<div class="c-meta">'
		+ '<span class="m-cy">' + esc(r.cycle) + '</span>'
		+ '<span class="m-sh ' + esc(r.shapeCls) + '">' + esc(r.shape) + '</span>'
		+ '<span class="m-dy">' + esc(r.days) + '</span>'
		+ '<span class="m-sc ' + esc(scoreCls(r.scores.tight)) + '" data-sc="1">'
			+ esc(r.scores.tight ? r.scores.tight.t : DASH) + '</span>'
	+ '</div>'
	+ '<div class="c-hi">' + r.hist
		+ (r.hist2 ? '<span class="snaplab">' + esc(r.snapLabel) + '</span>' + r.hist2 : '')
		+ '</div>'
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
				/* FOUR READINGS TRAVEL WITH EVERY ROW and the page shows one of them at a time. The
				   selector rewrites the cell rather than the page being rebuilt, so switching is
				   instant and the comparison is made on the same rows in the same order. */
				scores: {
					angle: a.concentration === null ? null
						: {v: a.concentration, t: Math.round(a.concentration * 100) + '%', good: 1},
					tight: (a.tightness === null || a.tightness === undefined) ? null
						: {v: a.tightness, good: 1,
							t: Math.round(a.tightness * 100) + '% ' + DOT + ' '
								+ a.scatter.toFixed(1) + 'd off'},
					/* FOUR STANDARD DEVIATIONS WIDE, not one. One is what the arithmetic produces and a
					   quarter of what the eye reads: Day care Emile's bars run day 12 to day 20 and
					   its standard deviation is 2.2 days, because a spread like that is about four
					   deviations end to end. Reporting the window the movements actually occupy -
					   two deviations either side - is the number that matches the picture. */
					spread: !a.sd ? null
						: {v: 1 - Math.min(1, a.sd.share * 4), good: 1,
							t: (a.sd.share * 400).toFixed(0) + '% of cycle ' + DOT + ' '
								+ (a.sd.days * 4).toFixed(1) + 'd wide'},
					test: !a.test ? null
						: {v: 1 - Math.min(1, a.test.p / 0.05), good: 1,
							t: 'p ' + (a.test.p < 0.001 ? '<.001' : a.test.p.toFixed(3))
								+ ' ' + DOT + ' Z ' + a.test.z.toFixed(1)}
				},
				confidence: a.confidence,
				concentration: a.concentration,
				tightness: a.tightness,
				hist: histogram(a.histogram, a.days),
				/* THE SECOND PICTURE IS THE CLAIM. Saying the weekend explains the scatter is only
				   checkable by seeing what undoing it did, so the adjusted histogram is drawn under
				   the original wherever a direction was adopted. */
				hist2: (a.snap && a.snap.adjustedBins) ? histogram(a.snap.adjustedBins, []) : '',
				snapLabel: (a.snap && a.snap.applied !== 'none')
					? (a.snap.applied === 'next' ? 'pulled back over the closure'
						: 'pushed on over the closure')
						+ ' ' + DOT + ' ' + a.snap.raw.toFixed(1) + 'd to '
						+ a.snap.adjusted.toFixed(1) + 'd wide'
					: '',
				snapApplied: a.snap ? a.snap.applied : null,
				/* WHERE ONE PAYER IS THE STREAM, THE ROW SAYS SO AND SAYS WHAT IT SET ASIDE. A shape
				   measured on 16 of 20 movements is a different claim from one measured on all 20,
				   and the reader has to be able to see which they are looking at. */
				series: (a.series && a.series.applied)
					? a.series.mainKey.slice(0, 22) + ' ' + DOT + ' '
						+ a.series.exceptions + ' set aside'
					: '',
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
		const ca = a.tightness === null || a.tightness === undefined ? -1 : a.tightness;
		const cb = b.tightness === null || b.tightness === undefined ? -1 : b.tightness;
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
		+ '<div class="c-meta"><span>cycle</span><span>shape</span><span>days</span>'
			+ '<span id="scname">tight</span></div>'
		+ '<div class="c-hi">every cycle, laid on top of each other</div>'
		+ '<div class="c-ck">ok</div></div>';
	const picker = '<div class="picker">'
		+ SCORES.map(o => '<label><input type="radio" name="score" value="' + esc(o.key) + '"'
			+ (o.key === 'tight' ? ' checked' : '') + '><span>' + esc(o.label) + '</span></label>')
			.join('')
		+ '</div>';
	const blob = {};
	ordered.forEach(r => { blob[r.id] = r.scores; });

	const table = '<section class="shp">' + picker + head
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
		extraScript: 'var SCORES = ' + JSON.stringify(blob) + ';' + SCRIPT,
		metaLine: [
			{label: 'rows', value: rows.length},
			{label: 'shaped', value: shaped.length},
			{label: 'lump', value: by.lump || 0},
			{label: 'multiLump', value: by.multiLump || 0},
			{label: 'spread', value: by.spread || 0},
			{label: 'anchor', value: anchorText},
			{label: 'angle bar', value: SHAPE_CONFIG.minConcentration.toFixed(2)}
		],
		groups: []
	});
}

/* THREE LINES, AND THE REST BEHIND A TAP. Ten lines of legend above a sticky header took most of a
   phone screen before a single row was visible, every time the page was opened. */
const LEGEND = '<span class="lg">bars = every cycle on top of each other ' + DOT
		+ ' x = day of the cycle ' + DOT + ' day 0 is the seam</span>'
	+ '<span class="lg">SPREAD = the window the movements occupy, as a share of the cycle ' + DOT
		+ ' four standard deviations wide</span>'
	+ '<span class="lg">a SECOND row of bars = the same cycles with the bank closures undone '
		+ DOT + ' real-time accounts only</span>'
	+ '<span class="lg">a name in accent under the stream = one payer carries it, and how many '
		+ 'movements were set aside as exceptions</span>'
	+ '<span class="lg">TIGHT = how far off its day a movement lands, on average ' + DOT
		+ ' 1.1d off is countable on the bars</span>'
	+ '<span class="lg">ANGLE is the older score, kept beside it while the two are compared</span>'
	+ '<details class="more"><summary>more</summary>'
		+ '<span class="lg">one row per ACCOUNT - a stream on two accounts has two shapes</span>'
		+ '<span class="lg"><i class="sw pick"></i>a day the stage claims</span>'
		+ '<span class="lg">bar height is scaled to the busiest day IN THAT ROW; hover for the count</span>'
		+ '<span class="lg">a spread has near-zero focus, and that IS the answer rather than a doubt</span>'
		+ '<span class="lg">two lumps are found by wrapping the cycle twice, three by wrapping it three times</span>'
		+ '<span class="lg">no shape = out of focus and not a flow, or too little to read</span>'
	+ '</details>';

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
.ser{display:block;font-size:9.5px;color:var(--accent);word-break:break-word}

.c-meta{display:grid;grid-template-columns:64px 66px 88px 1fr;gap:8px;align-items:center;
	min-width:0}
.m-sc{font-size:11px;white-space:nowrap}
.m-sc.full{color:var(--realtime);font-weight:600}
.m-sc.part{color:var(--ink-soft)}
.m-sc.low{color:var(--ink-faint)}
.m-sc.none{color:var(--ink-faint)}
.picker{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}
.picker label{display:inline-flex;align-items:center;gap:4px;font:400 11px/1 var(--sans);
	color:var(--ink-soft);background:var(--paper);border:1px solid var(--rule);border-radius:5px;
	padding:4px 8px;cursor:pointer;white-space:nowrap}
.picker input{margin:0;width:12px;height:12px;accent-color:var(--accent)}
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
.snaplab{display:block;font:400 9px/1.5 var(--mono);color:var(--accent);margin:3px 0 1px}
.hist{display:flex;align-items:flex-end;gap:1px;width:100%}
/* THE BAR HAS ITS OWN BOX AND THE NUMBER SITS OUTSIDE IT. They used to be two flex items in one
   fixed-height column, so a full-height bar plus its label overflowed - and flex shrinks the tall
   ones hardest, which flattened every tower into the wall beside it. Utilities reads 0.96
   concentrated and drew as a spread for exactly that reason: the arithmetic was right and the
   picture was not. */
.hs{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:stretch}
.hw{flex:none;height:30px;display:flex;align-items:flex-end}
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
.more{display:inline}
.more summary{display:inline;cursor:pointer;color:var(--accent);list-style:none}
.more summary::-webkit-details-marker{display:none}
.more[open] summary{display:block;margin-bottom:3px}

/* NARROW: name and tick on one line, the four facts on the next, the picture full width under
   them. The picture is the point of the page and it gets the whole screen rather than a sliver. */
@media (max-width:760px){
	/* THE HEADER SCROLLS AWAY ON A PHONE. Sticky, it is a permanent third of the screen on the one
	   device this page is actually reviewed on. */
	header.top{position:static}
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
	.hw{height:40px}
	.hs b{font-size:7.5px}
}
`;

/* THE SEARCH BOX FILTERS THE TABLE. The shell filters cards and this page has none, so the filter
   would otherwise be visibly present and do nothing. */
/* THE FOUR CANDIDATES, AND THE ONE WORD EACH IS DESCRIBED BY. Chosen on the page rather than in the
   code because none of them is obviously right and the argument is settled by looking. */
const SCORES = [
	{key: 'tight', label: 'tight (days off)'},
	{key: 'spread', label: 'spread (width / cycle)'},
	{key: 'angle', label: 'angle'},
	{key: 'test', label: 'test (p)'}
];

const SCRIPT = `
var q = document.getElementById("q");
var scname = document.getElementById("scname");
var LABEL = {tight: "tight", spread: "spread", angle: "angle", test: "p-value"};

function cls(sc){
	if(!sc)return "m-sc none";
	return sc.v >= 0.8 ? "m-sc full" : sc.v >= 0.5 ? "m-sc part" : "m-sc low";
}

function drawScores(){
	var picked = document.querySelector("input[name='score']:checked");
	var key = picked ? picked.value : "tight";
	if(scname)scname.textContent = LABEL[key] || key;
	[].slice.call(document.querySelectorAll("#shrows .srow")).forEach(function(tr){
		var cell = tr.querySelector("[data-sc]");
		if(!cell)return;
		var all = SCORES[tr.getAttribute("data-id")];
		var sc = all ? all[key] : null;
		cell.textContent = sc ? sc.t : String.fromCharCode(8212);
		cell.className = cls(sc);
	});
}
[].slice.call(document.querySelectorAll(".picker input")).forEach(function(el){
	el.addEventListener("change", drawScores);
});
drawScores();

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
