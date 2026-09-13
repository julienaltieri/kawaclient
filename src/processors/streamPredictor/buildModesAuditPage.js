/* ==================================================================================================
   THE §3 AUDIT PAGE — A STREAM AS A LIST OF MODES.  PROTOTYPE.

   ONE SHAPE PER STREAM WAS THE WRONG SHAPE OF ANSWER and the portfolio kept saying so. "Utilities"
   is not a monthly lump: it is a Conservice bill and a City of Palo Alto bill, both on the 11th of
   the cycle, both predictable, two thirds and one third of the money. "Wages Julien" is a payroll
   plus disability deposits. "Gas" is twelve fill-ups at eight stations and there is no pattern in it
   at all - which is itself the answer, and a useful one.

   THE PAGE READS AS A BAR CHART, ONE BAR PER MODE, because the question it answers is "how much of
   this stream lands on a known day". A table of twenty payees answered that question in the reader's
   head; a bar answers it in the eye. The bars are shares of the STREAM's money, so the whole chart
   sums to the stream and two sub-sections can be compared without arithmetic.

   SPLIT BY ACCOUNT TYPE, because a date on a card is not a date in a current account. A card settles
   once a month whatever day the purchase happened; a current account moves the day the money does.
   The two forecasts are made differently, so the page shows them apart.

   EVERYTHING WITHOUT A DAY IS ONE BAR. Twenty patternless payees are not twenty facts - they are the
   part of the stream that arrives when it arrives, forecastable as a rate, and one bar saying so
   beats twenty rows saying nothing each.

   THE LUMP BAR IS A KNOB. A day is a promise, and how sure the movements have to be before the page
   makes one is a number worth moving with the answers in front of you rather than settling in the
   code. Below the bar a mode keeps its money and loses its date: it joins the rest.

   THE EMITTED SCRIPT CARRIES NO BACKSLASH AND NO BACKTICK - see buildFitAuditPage.js. The data blob
   is concatenated rather than interpolated, so JSON's own escapes reach the browser intact.
   ================================================================================================== */

import {renderAuditPage, esc} from './auditShell';
import {Shape} from './shapeDetermination';
import {SHAPE_CONFIG} from './shapeConfig';
import {AccountKind} from './accountMapping';

const YEARLY = {yearly: true, biyearly: true};
const DASH = '—';
const DOT = '·';

const pct = v => (v === null || v === undefined) ? DASH : Math.round(v * 100) + '%';

/* WHAT THE MODE PREDICTS, in the vocabulary the shape uses. A lump predicts a day; a spread predicts
   a rate and deliberately names no day, because naming one would be the error the shape exists to
   avoid.

   ONLY THE DAYS THE FORECAST WILL ACTUALLY NAME ARE PRINTED HERE. The credit card payment sits in two
   clusters and happens once a week, so one of the two is the answer and the other is where it
   sometimes goes - printing both as though both were due would read as two payments a week. */
const patternOf = m => {
	if(m.shape !== Shape.lump)return 'no day ' + DOT + ' a rate';
	const pick = m.predicted && m.predicted.length ? m.predicted : m.days;
	return m.days.map((d, i) => ({d: d, w: m.wobble[i]}))
		.filter(x => pick.indexOf(x.d) >= 0)
		.map(x => 'd' + x.d + (x.w ? '±' + x.w : ''))
		.join(' ' + DOT + ' ');
};

/* AND WHERE ELSE IT LANDS, with the count that decided it. A reader looking at "d0" on 38 payments
   has to be able to see that 17 of them chose d4 - the page names one day, and it owes the reader the
   margin it named it by. */
const spreadOfDays = m => {
	if(m.shape !== Shape.lump)return '';
	if(!m.days || m.days.length < 2)return '';
	const pick = m.predicted && m.predicted.length ? m.predicted : m.days;
	const part = (d, i) => 'd' + d + ' x' + (m.dayEvents ? m.dayEvents[i] : '?')
		+ (pick.indexOf(d) >= 0 ? '' : ' (sometimes)');
	return m.days.map(part).join(' ' + DOT + ' ');
};

/* THE PAYEES BEHIND THE BAR. A merged mode is several names and the reader has to see all of them -
   that is the merge showing its work - but a gathered "everything else" is a long tail and the first
   few are enough to recognise it by. */
const whoOf = m => {
	const tail = m.gathered || [];
	if(tail.length)
		return tail.slice(0, 4).join(', ')
			+ (tail.length > 4 ? ' and ' + (tail.length - 4) + ' more' : '');
	return [m.label].concat(m.absorbed || []).join(' + ');
};

const KINDS = [
	{key: AccountKind.realTime, label: 'real time', note: 'moves the day the money does'},
	{key: AccountKind.deferred, label: 'deferred', note: 'settles with the card'}
];

/* ---- WHAT THE BROWSER IS GIVEN -----------------------------------------------------------------
   ONE ENTRY PER MODE, CARRYING ITS SHAPE AND ITS CONFIDENCE SEPARATELY, so the page can re-decide
   what counts as a lump when the knob moves without asking for the ledger again. Everything the
   arithmetic already settled - the day, the wobble, the exceptions - arrives as the string it will
   be printed as. */
/* BANK DESCRIPTIONS CARRY WHATEVER THE PAYMENT NETWORK PUT IN THEM, backslashes included, and
   JSON escapes those - which would put a backslash into the emitted script and break the rule at
   the top of this file. Display text is cleaned on the way out: a wire memo separated by a stray
   slash reads the same with a space there. */
const plain = s => String(s === null || s === undefined ? '' : s)
	.split(String.fromCharCode(92)).join(' ')
	.replace(/"/g, "'")
	.replace(/\s+/g, ' ').trim();

const modeData = m => ({
	who: plain(whoOf(m)),
	shape: m.shape || null,
	pat: plain(patternOf(m)),
	conf: (m.confidence === null || m.confidence === undefined) ? null : m.confidence,
	share: m.moneyShare,
	legs: m.legs,
	exc: m.exceptions || 0,
	alt: plain(spreadOfDays(m)),
	per: (m.typical === null || m.typical === undefined) ? null : m.typical,
	adj: (m.adjusted && m.adjusted !== 'none') ? m.adjusted : null
});

/* ---- HOW FAR BACK THE PAST STILL COUNTS ---------------------------------------------------------
   THE TAPER CANNOT BE RECOMPUTED IN THE BROWSER the way the lump bar can - it changes the arithmetic,
   not the labelling - so every setting is measured here and the selector switches between finished
   answers. Five runs of the whole portfolio is cheap; asking the reader to rebuild the page to try a
   number is not.

   THE SHOULDER IS FIXED AT THREE CYCLES in every option. It is not a dial to explore: it is the part
   that makes a taper safe at all, because a rhythm needs a few cycles at full weight before anything
   is allowed to fade. */
const TAPERS = [
	{h: 0, label: 'off', note: 'every cycle counts the same'},
	{h: 24, label: 'half-life 24', note: 'two years of monthly history to halve'},
	{h: 12, label: 'half-life 12', note: 'a year of monthly history to halve'},
	{h: 6, label: 'half-life 6', note: 'six cycles to halve - the card payment reads d4 alone here'},
	{h: 3, label: 'half-life 3', note: 'three cycles to halve - only the recent habit survives'}
];
const SHOULDER = 3;

export function modeRows(predictor, taper){
	const rows = [];
	predictor.reviewable().forEach(stream => {
		const m = predictor.explainShapeOf(stream.id, stream, taper);
		if(!m.cycle || YEARLY[m.cycle.name] || !m.modes.length)return;
		const legs = m.modes.reduce((n, x) => n + x.legs, 0);

		/* SPLIT BY ACCOUNT TYPE AND KEEP THE ORDER FIXED - real time, then deferred - so a reader
		   scanning thirty streams finds the same thing in the same place every time. */
		const groups = KINDS.map(k => {
			const mine = m.modes.filter(x => (x.accountType || AccountKind.realTime) === k.key);
			return {
				kind: k.label,
				note: k.note,
				cls: k.key === AccountKind.deferred ? 'def' : 'rt',
				share: mine.reduce((n, x) => n + x.moneyShare, 0),
				modes: mine.map(modeData)
			};
		}).filter(g => g.modes.length);

		rows.push({
			id: stream.id,
			name: stream.name,
			cycle: m.cycle.name,
			modes: m.modes,
			groups: groups,
			legs: legs,
			baseline: m.baseline,
			predictableShare: m.predictableShare,
			search: [stream.name, m.cycle.name,
				m.modes.map(x => x.label + ' ' + (x.shape || 'no pattern')).join(' ')]
				.join(' ').toLowerCase()
		});
	});
	//the streams a forecast is least able to explain come first: those are the ones worth reading
	return rows.sort((a, b) => a.predictableShare - b.predictableShare
		|| (String(a.name) < String(b.name) ? -1 : 1));
}

/* THE SHELL BINDS THE TICK BOXES ONCE, AT LOAD, so every stream's header and checkbox is rendered
   here and only the chart inside it is drawn by the script. */
const streamBlock = (r, i) => '<section class="stream" data-search="' + esc(r.search) + '">'
	+ '<header class="sh-head">'
		+ '<div class="s-name"><b>' + esc(r.name) + '</b>'
			+ '<span class="s-meta">' + esc(r.cycle) + ' ' + DOT + ' ' + r.legs
				+ ' movements</span></div>'
		+ '<div class="s-pred" id="p' + i + '"><b>' + DASH + '</b>'
			+ '<span>lands on a known day</span></div>'
		+ '<div class="s-ck"><input type="checkbox" class="okbox" data-sid="' + esc(r.id) + '"'
			+ ' aria-label="accept ' + esc(r.name) + '"></div>'
	+ '</header>'
	+ '<div class="chart" id="c' + i + '"></div>'
	+ '</section>';

export function buildModesAuditPage(predictor, meta){
	const m = meta || {};
	const rows = modeRows(predictor);
	const allModes = rows.reduce((n, r) => n + r.modes.length, 0);

	const anchor = m.anchor ? new Date(m.anchor) : null;
	const anchorText = anchor
		? anchor.getFullYear() + '-' + String(anchor.getMonth() + 1).padStart(2, '0')
			+ '-' + String(anchor.getDate()).padStart(2, '0')
		: DASH;

	/* EVERY STREAM ANSWERED AT EVERY TAPER, IN THE ORDER THE UNTAPERED RUN PUT THEM IN. The order
	   holding still is the point: a reader moving the selector is comparing one stream against itself,
	   and a list that reshuffles under the hand is a list that cannot be compared. */
	const variants = TAPERS.map(t => {
		const by = {};
		modeRows(predictor, {halfLife: t.h, shoulder: SHOULDER})
			.forEach(r => { by[r.id] = r.groups; });
		return by;
	});
	const data = rows.map(r => ({
		name: r.name,
		v: variants.map(by => by[r.id] || [])
	}));
	const bar = Math.round(SHAPE_CONFIG.minLumpConfidence * 100);
	const startTaper = Math.max(0, TAPERS.map(t => t.h)
		.indexOf(SHAPE_CONFIG.taperHalfLifeCycles));

	return renderAuditPage({
		title: 'Stream modes',
		phase: '§3·prototype',
		storageKey: 'kawa.audit.modes.v1',
		capturedAt: m.capturedAt,
		versionTitle: m.version,
		extraCss: CSS,
		legendHtml: LEGEND,
		panelHtml: '<section class="ctl">'
			+ '<div class="knob"><span class="kl">call it a lump above</span>'
				+ '<input type="range" id="lumpbar" min="0" max="95" step="1" value="' + bar + '">'
				+ '<b class="kv" id="lumpbarv">' + bar + '%</b></div>'
			+ '<p class="cnote" id="cnote">a mode below the bar keeps its money and loses its date'
			+ '</p>'
			+ '<div class="knob"><span class="kl">old cycles fade</span>'
				+ '<input type="range" id="taper" min="0" max="' + (TAPERS.length - 1)
					+ '" step="1" value="' + startTaper + '">'
				+ '<b class="kv" id="taperv">' + esc(TAPERS[startTaper].label) + '</b></div>'
			+ '<p class="cnote" id="tnote">' + esc(TAPERS[startTaper].note) + '</p>'
			+ '</section>'
			+ '<section class="wrap">' + rows.map(streamBlock).join('') + '</section>',
		extraScript: wiring(data, TAPERS),
		metaLine: [
			{label: 'streams', value: rows.length},
			{label: 'modes', value: allModes},
			{label: 'anchor', value: anchorText}
		],
		groups: []
	});
}

/* ---- THE PAGE'S OWN SCRIPT ---------------------------------------------------------------------
   NO BACKSLASH, NO BACKTICK. Attribute quoting inside these strings is done with apostrophes, so no
   character written here ever needs an escape; the data blob is CONCATENATED rather than dropped in
   a template literal, because JSON's own escapes would otherwise be eaten on the way through. */
const wiring = (data, tapers) => 'var DATA = ' + JSON.stringify(data) + ';'
	+ 'var TAPERS = ' + JSON.stringify(tapers) + ';' + `
var bar = document.getElementById("lumpbar");
var barv = document.getElementById("lumpbarv");
var cnote = document.getElementById("cnote");
var taper = document.getElementById("taper");
var taperv = document.getElementById("taperv");
var tnote = document.getElementById("tnote");
var DOTCH = "${DOT}";

function esc2(s){
	return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
function pc(v){ return Math.round(v * 100) + "%"; }

/* A LUMP IS A CLAIM ON A DAY, AND THE BAR IS THE PRICE OF MAKING IT. Below it the mode is not wrong,
   it is only not a date - so it keeps everything except the day, and joins the rest. */
function isLump(m, t){
	if(m.shape !== "lump")return false;
	return (m.conf === null ? 0 : m.conf) >= t;
}

function rowHtml(m, cls){
	var w = Math.max(1.5, m.share * 100);
	var note = m.exc ? " " + DOTCH + " " + m.exc + " off-pattern" : "";
	if(m.adj)note = note + " " + DOTCH + " closures " + m.adj;
	/* WHEN SEVERAL DAYS COMPETE, SAY WHICH ONE WON AND BY HOW MUCH. */
	if(m.alt)note = note + " " + DOTCH + " " + m.per + " per cycle " + DOTCH + " " + m.alt;
	return "<div class='mrow " + cls + "'>"
		+ "<div class='mbar'><span style='width:" + w + "%'></span></div>"
		+ "<b class='mpct'>" + pc(m.share) + "</b>"
		+ "<span class='mpat'>" + esc2(m.pat) + "</span>"
		+ "<div class='mwho'>" + esc2(m.who) + "<i>" + m.legs + " movements"
			+ (m.conf === null ? "" : " " + DOTCH + " " + pc(m.conf) + " sure")
			+ esc2(note) + "</i></div>"
		+ "</div>";
}

/* EVERYTHING WITHOUT A DAY BECOMES ONE BAR, and it is called a spread on purpose: the stream really
   does spend this money, it simply does not spend it on a date. */
function restHtml(rest){
	var share = 0, legs = 0, names = [], i;
	for(i = 0; i < rest.length; i++){
		share = share + rest[i].share;
		legs = legs + rest[i].legs;
		names.push(rest[i].who);
	}
	var who = names.length === 1 ? names[0] : "the rest " + DOTCH + " " + names.join(", ");
	return rowHtml({who: who, pat: "spread " + DOTCH + " no day", conf: null,
		share: share, legs: legs, exc: 0, adj: null, alt: null, per: null}, "rest");
}

function draw(){
	var t = Number(bar.value) / 100, ti = Number(taper.value), groups;
	var i, j, k, g, demoted = 0, html, lumps, rest, onday, p, dayful = 0, plain = 0;
	barv.textContent = Math.round(t * 100) + "%";
	taperv.textContent = TAPERS[ti].label;

	for(i = 0; i < DATA.length; i++){
		html = "";
		onday = 0;
		groups = DATA[i].v[ti];
		for(j = 0; j < groups.length; j++){
			g = groups[j];
			lumps = [];
			rest = [];
			for(k = 0; k < g.modes.length; k++){
				if(g.modes[k].shape === "lump")plain = plain + 1;
				if(isLump(g.modes[k], t)){
					lumps.push(g.modes[k]);
					onday = onday + g.modes[k].share;
					dayful = dayful + 1;
				}else{
					rest.push(g.modes[k]);
					if(g.modes[k].shape === "lump")demoted = demoted + 1;
				}
			}
			lumps.sort(function(a, b){ return b.share - a.share; });
			html = html + "<div class='grp " + g.cls + "'><div class='ghead'>"
				+ "<span class='gk'>" + esc2(g.kind) + "</span>"
				+ "<span class='gn'>" + esc2(g.note) + "</span>"
				+ "<b class='gs'>" + pc(g.share) + " of the stream</b></div>";
			for(k = 0; k < lumps.length; k++)html = html + rowHtml(lumps[k], "lump");
			if(rest.length)html = html + restHtml(rest);
			html = html + "</div>";
		}
		document.getElementById("c" + i).innerHTML = html;
		p = document.getElementById("p" + i);
		p.firstChild.textContent = pc(onday);
		p.className = "s-pred " + (onday >= 0.8 ? "good" : onday >= 0.4 ? "part" : "low");
	}
	cnote.textContent = demoted
		? demoted + " mode" + (demoted === 1 ? "" : "s") + " lose their day at this bar"
		: "a mode below the bar keeps its money and loses its date";
	tnote.textContent = TAPERS[ti].note + " " + DOTCH + " " + dayful + " modes name a day"
		+ (plain === dayful ? "" : " (" + plain + " before the bar)");
}

bar.addEventListener("input", draw);
taper.addEventListener("input", draw);
draw();

/* THE SEARCH BOX AND THE "UNVALIDATED ONLY" BUTTON BELONG TO THE SHELL, and the shell filters the
   CARDS INSIDE ITS GROUPS. This page has no groups - it is a list of stream blocks - so the filtering
   has to be done here or the two controls do nothing at all, which is what they did. */
var q = document.getElementById("q");
var only = document.getElementById("only");
var blocks = [].slice.call(document.querySelectorAll(".stream"));

function filterBlocks(){
	var t = q ? q.value.trim().toLowerCase() : "";
	var hideDone = !!only && only.getAttribute("aria-pressed") === "true";
	blocks.forEach(function(b){
		var hit = (!t || b.getAttribute("data-search").indexOf(t) !== -1)
			&& !(hideDone && b.classList.contains("done"));
		b.hidden = !hit;
	});
}

if(q)q.addEventListener("input", filterBlocks);
//the shell toggles aria-pressed on its own listener, bound first, so it is already set by now
if(only)only.addEventListener("click", filterBlocks);
//and it adds or removes "done" on its own change listener, also bound first
document.addEventListener("change", function(e){
	if(e.target && e.target.className && String(e.target.className).indexOf("okbox") >= 0)
		filterBlocks();
});
filterBlocks();
`;

const LEGEND = '<span class="lg">one bar per mode, and the bars are shares of the STREAM - a stream '
		+ 'can be several things at once</span>'
	+ '<span class="lg">real time and deferred are shown apart: a date on a card is not a date in a '
		+ 'current account</span>'
	+ '<span class="lg">everything with no day is one bar, called a spread - that money is real, it '
		+ 'just arrives at a rate</span>'
	+ '<span class="lg">"old cycles fade" weights each cycle by how recent it is - the newest three '
		+ 'always count in full, then the weight halves every so many cycles</span>'
	+ '<details class="more"><summary>more</summary>'
		+ '<span class="lg">dN = the day of the cycle, day 0 being the seam</span>'
		+ '<span class="lg">several clusters is not several payments - the page names as many days '
			+ 'as the cycle typically carries movements, biggest cluster first, and lists the rest '
			+ 'as "sometimes"</span>'
		+ '<span class="lg">"sure" = how tightly the movements land on that day AND how many cycles '
			+ 'they turned up in</span>'
		+ '<span class="lg">"N off-pattern" = movements the habit did not account for - a late '
			+ 'month, a one-off - counted, not hidden</span>'
		+ '<span class="lg">"+ name" = a payee absorbed because the merged mode still snapped to a '
			+ 'pattern</span>'
		+ '<span class="lg">"closures next/back" = the bank’s weekend was undone to read it</span>'
		+ '<span class="lg">least predictable streams first, because those are the ones to read</span>'
	+ '</details>';

const CSS = `
.ctl{max-width:1000px;margin:0 auto;padding:6px 14px 0}
.knob{display:flex;align-items:center;gap:9px;min-width:0}
.kl{font:500 10px/1.2 var(--mono);text-transform:uppercase;letter-spacing:.05em;
	color:var(--ink-faint);white-space:nowrap}
.knob input[type=range]{flex:1 1 auto;min-width:70px;max-width:260px;height:18px;
	accent-color:var(--accent)}
.kv{font:600 12px/1 var(--mono);color:var(--ink);min-width:34px}
.cnote{margin:3px 0 0;font:400 10px/1.4 var(--mono);color:var(--ink-faint)}

.wrap{max-width:1000px;margin:0 auto;padding:8px 14px 28px}
.stream{border:1px solid var(--rule);border-radius:8px;background:var(--surface);
	padding:9px 11px;margin:0 0 9px}
.stream.done{opacity:.5}
.sh-head{display:grid;grid-template-columns:1fr auto 26px;gap:10px;align-items:center;
	padding-bottom:6px;border-bottom:1px dashed var(--rule)}
.s-name b{font:600 13px/1.3 var(--sans);color:var(--ink)}
.s-meta{display:block;font:400 10px/1.4 var(--mono);color:var(--ink-faint)}
.s-pred{text-align:right;white-space:nowrap}
.s-pred b{font:600 13px/1 var(--mono);color:var(--ink-soft)}
.s-pred span{display:block;font:400 9px/1.3 var(--sans);color:var(--ink-faint)}
.s-pred.good b{color:var(--realtime)}
.s-pred.part b{color:var(--ink-soft)}
.s-pred.low b{color:var(--flag)}
.s-ck{text-align:right}
.s-ck .okbox{width:20px;height:20px;accent-color:var(--accent);margin:0}

.grp{margin-top:7px}
.ghead{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;
	font:500 9px/1.3 var(--mono);text-transform:uppercase;letter-spacing:.05em;
	padding-bottom:3px;border-bottom:1px solid var(--rule)}
.gk{color:var(--ink)}
.grp.rt .gk{color:var(--realtime)}
.grp.def .gk{color:var(--deferred)}
.gn{color:var(--ink-faint);text-transform:none;letter-spacing:0;font-weight:400}
.gs{margin-left:auto;color:var(--ink-soft);font-weight:600;white-space:nowrap}

.mrow{display:grid;grid-template-columns:1fr 44px 116px;
	grid-template-areas:"bar pct pat" "who who who";
	gap:2px 9px;align-items:center;padding:5px 0;border-bottom:1px solid var(--rule)}
.mrow:last-child{border-bottom:0}
.mbar{grid-area:bar;height:11px;background:var(--sunk);border-radius:2px;overflow:hidden;
	min-width:0}
.mbar span{display:block;height:100%;background:var(--realtime);border-radius:2px}
.grp.def .mbar span{background:var(--deferred)}
.mrow.rest .mbar span{background:var(--ink-faint);opacity:.5}
.mpct{grid-area:pct;font:600 12px/1 var(--mono);color:var(--ink);text-align:right;
	font-variant-numeric:tabular-nums}
.mpat{grid-area:pat;font:500 11px/1.2 var(--mono);color:var(--realtime);white-space:nowrap;
	overflow:hidden;text-overflow:ellipsis}
.grp.def .mpat{color:var(--deferred)}
.mrow.rest .mpat{color:var(--ink-faint);font-weight:400}
.mwho{grid-area:who;font:400 11px/1.35 var(--mono);color:var(--ink-soft);word-break:break-word;
	min-width:0}
.mwho i{display:block;font-style:normal;font-size:9.5px;color:var(--ink-faint)}
.mrow.rest .mwho{color:var(--ink-faint)}

.lg{display:inline-flex;align-items:center;gap:4px;margin-right:11px}
.more{display:inline}
.more summary{display:inline;cursor:pointer;color:var(--accent);list-style:none}
.more summary::-webkit-details-marker{display:none}
.more[open] summary{display:block;margin-bottom:3px}

@media (max-width:760px){
	header.top{position:static}
	.wrap{padding:6px 10px 28px}
	.ctl{padding:6px 10px 0}
	.mrow{grid-template-columns:1fr 42px;grid-template-areas:"bar pct" "pat pat" "who who";
		gap:2px 8px}
	.mpat{white-space:normal}
	.sh-head{grid-template-columns:1fr auto 26px}
	.s-pred b{font-size:12px}
}
`;

export default buildModesAuditPage;
