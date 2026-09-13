/* ==================================================================================================
   THE §3 AUDIT PAGE — A STREAM AS A LIST OF MODES.  PROTOTYPE.

   ONE SHAPE PER STREAM WAS THE WRONG SHAPE OF ANSWER and the portfolio kept saying so. "Utilities"
   is not a monthly lump: it is a Conservice bill and a City of Palo Alto bill, both on the 11th of
   the cycle, both predictable, two thirds and one third of the money. "Wages Julien" is a payroll
   plus disability deposits. "Gas" is twelve fill-ups at eight stations and there is no pattern in it
   at all - which is itself the answer, and a useful one.

   SO A STREAM IS A LIST OF MODES, ONE PER PAYEE, and each mode carries its own shape, its own days,
   its own confidence, and its own share of the money. A stream may be entirely predictable, entirely
   not, or - most often - some of each.

   THE MONEY COLUMN IS THE POINT OF THE PAGE. A payee that is 1% of the stream and unpredictable
   costs nothing to get wrong; one that is 67% and lands on the 11th is most of what a forecast is.
   Ordering by shape and then by money puts the rows that matter at the top of every stream, and the
   percentage at the top of the block says how much of the stream is forecastable at all.

   THE HISTOGRAM IS GONE. It was the right instrument for judging ONE shape against ONE set of bars,
   and it cannot show a stream that is four different things at once. The days and the confidence
   carry what it was being read for.

   THE EMITTED SCRIPT CARRIES NO BACKSLASH AND NO BACKTICK - see buildFitAuditPage.js.
   ================================================================================================== */

import {renderAuditPage, esc} from './auditShell';
import {Shape} from './shapeDetermination';

const YEARLY = {yearly: true, biyearly: true};
const DASH = '—';
const DOT = '·';

const pct = v => (v === null || v === undefined) ? DASH : Math.round(v * 100) + '%';

const shapeCls = sh => sh === Shape.lump ? 'sh lump'
	: sh === Shape.multiLump ? 'sh multi'
	: sh === Shape.spread ? 'sh spread' : 'sh none';

/* WHAT THE MODE PREDICTS, in the vocabulary the shape uses. A lump predicts a day; a spread predicts
   a rate and deliberately names no day, because naming one would be the error the shape exists to
   avoid. */
const patternOf = m => {
	if(m.shape === Shape.lump || m.shape === Shape.multiLump)
		return m.days.map((d, i) => 'd' + d + (m.wobble[i] ? '±' + m.wobble[i] : '')).join(' ' + DOT + ' ');
	if(m.shape === Shape.spread)return 'no day ' + DOT + ' a rate';
	return m.reason || DASH;
};

const modeRow = m => '<div class="mode' + (m.shape ? '' : ' flat') + '">'
	+ '<div class="m-name">' + esc(m.label)
		+ (m.adjusted && m.adjusted !== 'none'
			? '<span class="adj">closures ' + esc(m.adjusted) + '</span>' : '')
		+ '</div>'
	+ '<div class="' + shapeCls(m.shape) + '">' + esc(m.shape || 'no pattern') + '</div>'
	+ '<div class="m-pat">' + esc(patternOf(m)) + '</div>'
	+ '<div class="m-cf">' + esc(pct(m.confidence)) + '</div>'
	+ '<div class="m-money"><span class="bar" style="width:'
		+ Math.max(2, Math.round(m.moneyShare * 100)) + '%"></span>'
		+ '<b>' + esc(pct(m.moneyShare)) + '</b></div>'
	+ '<div class="m-legs">' + m.legs + '</div>'
	+ '</div>';

const streamBlock = r => '<section class="stream" data-search="' + esc(r.search) + '">'
	+ '<header class="sh-head">'
		+ '<div class="s-name"><b>' + esc(r.name) + '</b>'
			+ '<span class="s-meta">' + esc(r.cycle) + ' ' + DOT + ' ' + r.modes.length
				+ ' mode' + (r.modes.length === 1 ? '' : 's') + ' ' + DOT + ' '
				+ r.legs + ' movements</span></div>'
		+ '<div class="s-pred ' + esc(r.predCls) + '">' + esc(pct(r.predictableShare))
			+ '<span>of the money is predictable</span></div>'
		+ '<div class="s-ck"><input type="checkbox" class="okbox" data-sid="' + esc(r.id) + '"'
			+ ' aria-label="accept ' + esc(r.name) + '"></div>'
	+ '</header>'
	+ '<div class="modes"><div class="mode head">'
		+ '<div class="m-name">payee</div><div class="sh">shape</div>'
		+ '<div class="m-pat">pattern</div><div class="m-cf">conf</div>'
		+ '<div class="m-money">share of money</div><div class="m-legs">n</div></div>'
	+ r.modes.map(modeRow).join('') + '</div>'
	+ (r.baseline.modes
		? '<p class="base">baseline ' + DOT + ' ' + r.baseline.modes + ' payee'
			+ (r.baseline.modes === 1 ? '' : 's') + ' with no pattern ' + DOT + ' '
			+ r.baseline.legs + ' movements ' + DOT + ' '
			+ pct(r.baseline.moneyShare) + ' of the money, forecastable only as a rate</p>'
		: '')
	+ '</section>';

export function modeRows(predictor){
	const rows = [];
	predictor.reviewable().forEach(stream => {
		const m = predictor.modesOf(stream.id, stream);
		if(!m.cycle || YEARLY[m.cycle.name] || !m.modes.length)return;
		const legs = m.modes.reduce((n, x) => n + x.legs, 0);
		rows.push({
			id: stream.id,
			name: stream.name,
			cycle: m.cycle.name,
			modes: m.modes,
			legs: legs,
			baseline: m.baseline,
			predictableShare: m.predictableShare,
			predCls: m.predictableShare >= 0.8 ? 'good'
				: m.predictableShare >= 0.4 ? 'part' : 'low',
			search: [stream.name, m.cycle.name,
				m.modes.map(x => x.label + ' ' + (x.shape || 'no pattern')).join(' ')]
				.join(' ').toLowerCase()
		});
	});
	//the streams a forecast is least able to explain come first: those are the ones worth reading
	return rows.sort((a, b) => a.predictableShare - b.predictableShare
		|| (String(a.name) < String(b.name) ? -1 : 1));
}

export function buildModesAuditPage(predictor, meta){
	const m = meta || {};
	const rows = modeRows(predictor);
	const allModes = rows.reduce((n, r) => n + r.modes.length, 0);
	const predictableModes = rows.reduce((n, r) =>
		n + r.modes.filter(x => !!x.shape).length, 0);
	const fully = rows.filter(r => r.predictableShare >= 0.999).length;
	const none = rows.filter(r => r.predictableShare <= 0.001).length;

	const anchor = m.anchor ? new Date(m.anchor) : null;
	const anchorText = anchor
		? anchor.getFullYear() + '-' + String(anchor.getMonth() + 1).padStart(2, '0')
			+ '-' + String(anchor.getDate()).padStart(2, '0')
		: DASH;

	return renderAuditPage({
		title: 'Stream modes',
		phase: '§3·prototype',
		storageKey: 'kawa.audit.modes.v1',
		capturedAt: m.capturedAt,
		versionTitle: m.version,
		extraCss: CSS,
		legendHtml: LEGEND,
		panelHtml: '<section class="wrap">' + rows.map(streamBlock).join('') + '</section>',
		extraScript: SCRIPT,
		metaLine: [
			{label: 'streams', value: rows.length},
			{label: 'modes', value: allModes},
			{label: 'with a pattern', value: predictableModes},
			{label: 'fully predictable', value: fully},
			{label: 'no pattern at all', value: none},
			{label: 'anchor', value: anchorText}
		],
		groups: []
	});
}

const LEGEND = '<span class="lg">a stream is a LIST OF MODES, one per payee - it can be several '
		+ 'things at once</span>'
	+ '<span class="lg">share of money is why it matters: an unpredictable 1% costs nothing, an '
		+ 'unpredictable 60% is the forecast</span>'
	+ '<details class="more"><summary>more</summary>'
		+ '<span class="lg">dN = the day of the cycle, day 0 being the seam</span>'
		+ '<span class="lg">conf = how tightly the movements land on that day</span>'
		+ '<span class="lg">a spread names no day on purpose - it is forecastable as a rate</span>'
		+ '<span class="lg">"closures next/back" = the bank’s weekend was undone to read it</span>'
		+ '<span class="lg">least predictable streams first, because those are the ones to read</span>'
	+ '</details>';

const CSS = `
.wrap{max-width:1000px;margin:0 auto;padding:8px 14px 28px}
.stream{border:1px solid var(--rule);border-radius:8px;background:var(--surface);
	padding:9px 11px;margin:0 0 9px}
.stream.done{opacity:.5}
.sh-head{display:grid;grid-template-columns:1fr auto 26px;gap:10px;align-items:center;
	padding-bottom:6px;border-bottom:1px dashed var(--rule)}
.s-name b{font:600 13px/1.3 var(--sans);color:var(--ink)}
.s-meta{display:block;font:400 10px/1.4 var(--mono);color:var(--ink-faint)}
.s-pred{font:600 13px/1 var(--mono);text-align:right;white-space:nowrap}
.s-pred span{display:block;font:400 9px/1.3 var(--sans);color:var(--ink-faint);font-weight:400}
.s-pred.good{color:var(--realtime)}
.s-pred.part{color:var(--ink-soft)}
.s-pred.low{color:var(--flag)}
.s-ck{text-align:right}
.s-ck .okbox{width:20px;height:20px;accent-color:var(--accent);margin:0}

.modes{margin-top:5px}
.mode{display:grid;grid-template-columns:1.5fr 82px 1.2fr 46px 130px 34px;gap:8px;
	align-items:center;padding:4px 0;font:400 12px/1.4 var(--mono);
	font-variant-numeric:tabular-nums;border-bottom:1px solid var(--rule)}
.mode:last-child{border-bottom:0}
.mode.head{font:500 9px/1.2 var(--mono);text-transform:uppercase;letter-spacing:.05em;
	color:var(--ink-faint);padding-bottom:3px}
.mode.flat{opacity:.62}
.m-name{color:var(--ink);word-break:break-word;min-width:0}
.adj{display:block;font-size:9px;color:var(--accent)}
.sh{font-weight:600;white-space:nowrap}
.sh.lump{color:var(--realtime)}
.sh.multi{color:var(--accent)}
.sh.spread{color:var(--ink-soft)}
.sh.none{color:var(--ink-faint);font-weight:400}
.mode.head .sh{font-weight:500;color:var(--ink-faint)}
.m-pat{color:var(--ink-soft);font-size:11px;word-break:break-word;min-width:0}
.m-cf{font-size:11px;text-align:right;color:var(--ink-soft)}
.m-money{position:relative;display:flex;align-items:center;gap:6px;min-width:0}
.m-money .bar{display:block;height:9px;background:var(--accent-soft);border-radius:2px;
	flex:0 0 auto;max-width:76px}
.m-money b{font:500 11px/1 var(--mono);color:var(--ink)}
.mode.head .m-money{display:block}
.m-legs{text-align:right;font-size:10.5px;color:var(--ink-faint)}

.base{margin:6px 0 0;padding-top:5px;border-top:1px dashed var(--rule);
	font:400 10.5px/1.45 var(--mono);color:var(--ink-faint)}
.lg{display:inline-flex;align-items:center;gap:4px;margin-right:11px}
.more{display:inline}
.more summary{display:inline;cursor:pointer;color:var(--accent);list-style:none}
.more summary::-webkit-details-marker{display:none}
.more[open] summary{display:block;margin-bottom:3px}

@media (max-width:760px){
	header.top{position:static}
	.wrap{padding:6px 10px 28px}
	.mode{grid-template-columns:1fr 74px 44px;
		grid-template-areas:"name name name" "shape pat pat" "money money conf";
		gap:3px 8px;padding:7px 0}
	.mode.head{display:none}
	.m-name{grid-area:name}
	.sh{grid-area:shape}
	.m-pat{grid-area:pat}
	.m-cf{grid-area:conf;text-align:right}
	.m-money{grid-area:money}
	.m-legs{display:none}
	.sh-head{grid-template-columns:1fr auto 26px}
	.s-pred{font-size:12px}
}
`;

/* THE FILTER FROM THE SHELL APPLIES TO STREAM BLOCKS, since this page has no card groups. */
const SCRIPT = `
var q = document.getElementById("q");
var blocks = [].slice.call(document.querySelectorAll(".stream"));
function filterBlocks(){
	var t = q ? q.value.trim().toLowerCase() : "";
	blocks.forEach(function(b){
		b.hidden = !!t && b.getAttribute("data-search").indexOf(t) === -1;
	});
}
if(q)q.addEventListener("input", filterBlocks);
`;

export default buildModesAuditPage;
