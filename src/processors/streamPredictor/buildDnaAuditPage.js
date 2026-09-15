/* ==================================================================================================
   THE SYNTHETIC BENCH — ONE STREAM AT A TIME, TRUTH BESIDE READING.  TEST INSTRUMENT.

   ROLL A STREAM, SEE WHAT IT WAS MADE OF, SEE WHAT WAS MADE OF IT. The scorecard is an average and
   an average cannot be argued with. This page draws one synthetic stream: for every mode, the line
   it was grown from and the line it was read back as, and underneath, the ledger it produced with
   the cycle both sides are claiming.

   ONE MODE IS THREE LINES, NOT TWO COLUMNS. The first cut faced the truth and the reading across a
   split, which read well on a desk and pushed the ledger - the part that settles an argument - below
   the fold on anything smaller. Stacked, the two lines share a payee heading and the eye travels
   down one column instead of across two.

   THE FILTER IS THE POINT. Rolling at random shows mostly agreement, which is reassuring and
   useless. The filters roll only among the streams that disagree on rhythm, on shape, or on the day,
   so a session can be spent entirely on the cases that are wrong.

   NOTHING HERE IS REAL MONEY. Every payee, amount and account is generated, so unlike the other
   benches this page carries no ledger and can be shown to anyone.

   THE EMITTED SCRIPT CARRIES NO BACKSLASH AND NO BACKTICK - same rule as the other bench pages.
   ================================================================================================== */

const DOT = '·';

const esc = s => String(s === null || s === undefined ? '' : s)
	.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
	.split('"').join('&quot;');

const FILTERS = [
	{key: 'all', label: 'any'},
	{key: 'cycle', label: 'rhythm'},
	{key: 'shape', label: 'shape'},
	{key: 'day', label: 'day'},
	{key: 'clean', label: 'all agree'}
];

/* ---- THE PAGE ------------------------------------------------------------------------------------ */
export function buildDnaAuditPage(samples, meta){
	const m = meta || {};
	const rhythm = samples.filter(s => s.cycleOk).length;
	const shapeOk = samples.reduce((n, s) =>
		n + s.modes.filter(x => x.shapeOk === true).length, 0);
	const shapeAsked = samples.reduce((n, s) =>
		n + s.modes.filter(x => x.shapeOk !== null).length, 0);
	const pc = (n, d) => (d ? Math.round(n / d * 100) : 0) + '%';

	return '<title>Synthetic round trip</title>'
		+ '<style>' + CSS + '</style>'
		+ '<main>'
		+ '<header class="top">'
			+ '<b>Synthetic round trip</b>'
			+ '<span class="sc">rhythm <b>' + pc(rhythm, samples.length) + '</b></span>'
			+ '<span class="sc">shape <b>' + pc(shapeOk, shapeAsked) + '</b></span>'
			+ '<span class="seed">' + samples.length + ' streams ' + DOT + ' seed '
				+ esc(m.seed) + ' ' + DOT + ' ' + esc(m.months) + ' months</span>'
		+ '</header>'
		+ '<div class="bar">'
			+ '<button id="roll" class="roll">Roll</button>'
			+ '<button id="snap" class="snap">Copy snapshot</button>'
			+ '<div class="filters" id="filters"><span class="fl">disagrees on</span>'
				+ FILTERS.map((f, i) => '<button class="f' + (i === 0 ? ' on' : '')
					+ '" data-f="' + f.key + '">' + esc(f.label) + '</button>').join('')
			+ '</div>'
			+ '<span class="pos" id="pos"></span>'
		+ '</div>'
		+ '<div id="card"></div>'
		+ '<p class="legend"><i class="sw in"></i>in <i class="sw out"></i>out '
			+ '<i class="sw shut"></i>bank shut <i class="sw truth"></i>written day, shaded to its '
			+ 'wobble '
			+ DOT + ' dashed mark: a flow placed as whole payments</p>'
		+ '</main>'
		+ '<script>window.DNA=' + JSON.stringify(samples)
			+ ';window.DNAMETA=' + JSON.stringify({seed: m.seed, months: m.months}) + ';</script>'
		+ '<script>' + SCRIPT + '</script>';
}

/* ================================================================================================== */
const CSS = `
:root{
	--paper:#F4F5F7; --surface:#FFFFFF; --sunk:#E9EBF0;
	--ink:#14171C; --ink-soft:#4A5160; --ink-faint:#79808F;
	--rule:#D4D8E0; --accent:#2E4A7D; --accent-soft:#5C7AB0;
	--flag:#8A6520; --flag-bg:#F6EDDA;
	--agree:#3A6153; --agree-bg:#E3ECE7;
	--differ:#9B3B42; --differ-bg:#F6E4E5;
	--realtime:#3A6153; --deferred:#7A4A5E;
	--sans:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
	--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
	--paper:#131619; --surface:#1A1E24; --sunk:#22272F;
	--ink:#DFE3EA; --ink-soft:#A7AEBC; --ink-faint:#79808F;
	--rule:#2E343E; --accent:#9DB8E4; --accent-soft:#5C7AB0;
	--flag:#D2AC63; --flag-bg:#2B2418;
	--agree:#8CB6A4; --agree-bg:#1B2724;
	--differ:#E39AA0; --differ-bg:#2C1B1D;
	--realtime:#8CB6A4; --deferred:#C99BAC;
}}
:root[data-theme="dark"]{
	--paper:#131619; --surface:#1A1E24; --sunk:#22272F;
	--ink:#DFE3EA; --ink-soft:#A7AEBC; --ink-faint:#79808F;
	--rule:#2E343E; --accent:#9DB8E4; --accent-soft:#5C7AB0;
	--flag:#D2AC63; --flag-bg:#2B2418;
	--agree:#8CB6A4; --agree-bg:#1B2724;
	--differ:#E39AA0; --differ-bg:#2C1B1D;
	--realtime:#8CB6A4; --deferred:#C99BAC;
}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font:400 13px/1.45 var(--sans);margin:0}
main{max-width:920px;margin:0 auto;padding:11px 13px 26px}
:focus-visible{outline:2px solid var(--accent-soft);outline-offset:2px}

header.top{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;
	padding-bottom:8px;border-bottom:1px solid var(--rule)}
header.top > b{font:600 15px/1.2 var(--sans)}
.sc{font:400 11px/1 var(--mono);color:var(--ink-faint);background:var(--sunk);
	padding:4px 7px;border-radius:5px}
.sc b{font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}
.seed{font:400 10.5px/1.4 var(--mono);color:var(--ink-faint);margin-left:auto}

.bar{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:9px 0 8px}
button.roll{font:600 13px/1 var(--sans);padding:9px 17px;border-radius:7px;cursor:pointer;
	border:0;background:var(--accent);color:var(--paper)}
button.roll:hover{filter:brightness(1.12)}
.filters{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.fl{font:400 10.5px/1 var(--mono);color:var(--ink-faint);margin-right:1px}
button.f{font:500 11px/1 var(--mono);padding:7px 9px;border-radius:6px;cursor:pointer;
	border:1px solid var(--rule);background:var(--surface);color:var(--ink-soft)}
button.f.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.pos{font:400 10.5px/1 var(--mono);color:var(--ink-faint);margin-left:auto}

.card{background:var(--surface);border:1px solid var(--rule);border-radius:9px;padding:10px 12px}
/* THE HEADER IS THREE LINES THAT LINE UP, not a row of coloured chips. What a reader wants at the
   top is the same three facts said three times - as declared, as written, as detected - in the same
   columns, so a disagreement is a word that changed rather than a badge to decode. */
.chead{padding-bottom:8px;border-bottom:1px solid var(--rule)}
.chead h2{margin:0 0 5px;font:600 15px/1.2 var(--sans)}
.rows{display:grid;grid-template-columns:max-content max-content max-content 1fr;
	gap:2px 14px;font:400 12.5px/1.4 var(--mono);align-items:baseline}
.rows .lb2{color:var(--ink-faint);font-size:10.5px;text-transform:uppercase;letter-spacing:.05em}
.rows .cy{font-weight:600}
.rows .am{font-variant-numeric:tabular-nums}
.rows .ac{color:var(--ink-soft)}
.rows .r.off .cy{color:var(--differ)}
.rows .r{display:contents}

/* ONE MODE: a heading and two facing lines, on a 58px gutter so "written" and "read" line up and
   the numbers under them do too. */
.m{padding:6px 0;border-bottom:1px solid var(--rule)}
.m:last-of-type{border-bottom:0}
.mh{display:flex;gap:6px;align-items:baseline;font:600 12.5px/1.35 var(--mono)}
.mh .tag{font:600 9.5px/1 var(--mono);padding:3px 5px;border-radius:4px;background:var(--sunk);
	color:var(--ink-soft);text-transform:uppercase;letter-spacing:.04em}
.mh .tag.lump{background:var(--agree-bg);color:var(--agree)}
.mh .tag.spread{background:var(--flag-bg);color:var(--flag)}
.mh .vm{margin-left:auto;font:600 10px/1 var(--mono);padding:3px 6px;border-radius:4px}
.mh .vm.ok{background:var(--agree-bg);color:var(--agree)}
.mh .vm.no{background:var(--differ-bg);color:var(--differ)}
.mh .vm.na{background:var(--sunk);color:var(--ink-faint)}
.ln{display:grid;grid-template-columns:58px 1fr;gap:7px;
	font:400 11.5px/1.5 var(--mono);color:var(--ink-soft)}
.ln i{font-style:normal;font-size:9.5px;color:var(--ink-faint);text-transform:uppercase;
	letter-spacing:.05em;padding-top:2px}
.ln.bad{color:var(--differ)}
.ln .dead{color:var(--differ);font-weight:600}

/* ONE LANE IS ONE ROW: the dates sit in the gutter rather than on a line of their own, which is
   four lines of page saved on a stream with four cycles drawn. */
.acc{margin-top:8px;padding-top:7px;border-top:1px solid var(--rule)}
.ah{font:500 9.5px/1.3 var(--mono);text-transform:uppercase;letter-spacing:.05em;
	color:var(--ink-faint);margin-bottom:4px}
.ah em{font-style:normal;color:var(--realtime)}
.ah em.d{color:var(--deferred)}
.lane{display:grid;grid-template-columns:92px 1fr;gap:8px;align-items:center;margin-bottom:3px}
.lb{font:400 9.5px/1.3 var(--mono);color:var(--ink-faint);text-align:right}
.lb b{display:block;color:var(--accent);font-weight:600;letter-spacing:.04em;
	text-transform:uppercase}
.track{position:relative;height:26px;background:var(--sunk);border-radius:3px}
.lane.next .track{height:34px;background:transparent;border:1px dashed var(--accent-soft)}
.sd{position:absolute;top:0;bottom:0;background:var(--rule);opacity:.6}
.sd.hol{background:var(--flag);opacity:.32}
.mk{position:absolute;bottom:0;width:5px;margin-left:-2px;border-radius:2px 2px 0 0;
	background:var(--realtime)}
.mk.out{background:var(--deferred)}
.mk.spaced{background:transparent;border:1px dashed var(--realtime);border-bottom:0}
.mk i{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);
	font:500 9px/1 var(--mono);font-style:normal;color:var(--ink-soft);white-space:nowrap;
	padding-bottom:1px}
.gh{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--differ);
	opacity:.85}
.gh i{position:absolute;top:0;left:4px;font:600 9px/1 var(--mono);font-style:normal;
	color:var(--differ);white-space:nowrap}
/* THE WOBBLE IS A RANGE, SO IT IS DRAWN AS ONE. A mode written as d18 give or take 9 covers
   nineteen days of the cycle; one hairline at d18 claims a precision the DNA never had. */
.ghb{position:absolute;top:0;bottom:0;background:var(--differ);opacity:.14;
	border-left:1px solid var(--differ);border-right:1px solid var(--differ)}
.dn{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);
	font:400 8px/1 var(--mono);color:var(--ink-faint);white-space:nowrap;padding-bottom:1px}
.band{position:absolute;left:0;right:0;bottom:0;height:10px;border-radius:0 0 3px 3px;
	background:repeating-linear-gradient(135deg,var(--rule),var(--rule) 4px,
		transparent 4px,transparent 9px)}
.band i{position:absolute;left:4px;bottom:10px;font:400 9px/1.2 var(--mono);
	color:var(--ink-faint);font-style:normal;white-space:nowrap}

/* THE CONCLUSION IS PROSE, DELIBERATELY. Everything above it is a chart or a table, and neither
   says out loud what the module is actually claiming will happen. A sentence does. */
.said{margin-top:10px;padding-top:9px;border-top:2px solid var(--rule)}
.said h3{margin:0 0 5px;font:600 9.5px/1.3 var(--mono);text-transform:uppercase;
	letter-spacing:.07em;color:var(--ink-faint)}
.said p{margin:0 0 5px;font:400 13px/1.55 var(--sans);color:var(--ink);max-width:80ch}
.said p:last-child{margin-bottom:0}
.said b{font-weight:600}
.said .t{color:var(--ink-soft)}
.said .yes{color:var(--agree);font-weight:600}
.said .nope{color:var(--differ);font-weight:600}

/* THE SNAPSHOT IS ALWAYS ON THE PAGE, not only on the clipboard. An artifact runs in a sandboxed
   frame where the clipboard API can be refused without warning, and a copy button that silently
   does nothing is worse than no button; the text sits in a fold underneath either way. */
.snapwrap{margin-top:8px}
.snapwrap summary{font:500 10.5px/1.4 var(--mono);color:var(--accent);cursor:pointer;
	list-style:none}
.snapwrap summary::-webkit-details-marker{display:none}
.snapwrap pre{margin:6px 0 0;padding:9px 11px;background:var(--sunk);border-radius:6px;
	font:400 10.5px/1.5 var(--mono);color:var(--ink-soft);white-space:pre;overflow-x:auto;
	max-height:340px;overflow-y:auto;-webkit-user-select:all;user-select:all}
button.snap{font:500 12px/1 var(--sans);padding:9px 12px;border-radius:7px;cursor:pointer;
	border:1px solid var(--rule);background:var(--surface);color:var(--ink-soft)}
button.snap:hover{background:var(--sunk)}
button.snap.done{background:var(--agree-bg);color:var(--agree);border-color:var(--agree-bg)}

/* THE SILENCE HAS TO BE DRAWN OR THE GATE LOOKS ARBITRARY. The cycle walk stops at the newest
   payment - correctly, since dormancy is not its call - so the cycles that ARE the evidence for
   silencing a mode were the only ones never on the chart. */
.gap{margin-top:3px;padding:5px 0 1px;border-top:1px dashed var(--differ);
	font:500 10px/1.3 var(--mono);color:var(--differ);text-align:center}

.legend{margin:9px 0 0;font:400 10.5px/1.6 var(--mono);color:var(--ink-faint)}
.sw{display:inline-block;width:9px;height:9px;border-radius:2px;vertical-align:-1px;
	margin:0 3px 0 9px}
.sw.in{background:var(--realtime);margin-left:0}
.sw.out{background:var(--deferred)}
.sw.shut{background:var(--rule)}
.sw.truth{background:var(--differ)}
.empty{padding:18px 0;text-align:center;font:400 12px/1.5 var(--mono);color:var(--ink-faint)}

@media (max-width:620px){
	main{padding:9px 9px 22px}
	.seed{margin-left:0;width:100%}
	.pos{margin-left:0;width:100%}
	.lane{grid-template-columns:72px 1fr;gap:6px}
	.lb{font-size:9px}
	.ln{grid-template-columns:48px 1fr;font-size:11px}
}
`;

/* ================================================================================================== */
const SCRIPT = `
(function(){
var S = window.DNA || [];
var META = window.DNAMETA || {};
var state = {f: "all"};

function esc(s){return String(s === null || s === undefined ? "" : s)
	.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");}
function money(n){
	if(n === null || n === undefined)return "--";
	var a = Math.abs(n);
	var t = a >= 100 ? String(Math.round(a)) : a.toFixed(2);
	//thousand separators: the synthetic sizes run to five figures and read as noise without them
	var dot = t.indexOf("."), whole = dot < 0 ? t : t.slice(0, dot), rest = dot < 0 ? "" : t.slice(dot);
	var grouped = "", i, k = 0;
	for(i = whole.length - 1; i >= 0; i--){
		grouped = whole.charAt(i) + grouped;
		if(++k % 3 === 0 && i > 0)grouped = "," + grouped;
	}
	return (n < 0 ? "-" : "+") + "$" + grouped + rest;
}

/* WHICH STREAMS THIS FILTER ADMITS. "all agree" is stricter than "no miss recorded": a stream with
   nothing to check is not a stream that passed, so the rhythm has to be right AND no shape or day
   question may have come back wrong. */
function pool(){
	return S.filter(function(s){
		var shapeMiss = s.modes.some(function(m){return m.shapeOk === false;});
		var dayMiss = s.modes.some(function(m){return m.dayOk === false;});
		if(state.f === "cycle")return !s.cycleOk;
		if(state.f === "shape")return shapeMiss;
		if(state.f === "day")return dayMiss;
		if(state.f === "clean")return s.cycleOk && !shapeMiss && !dayMiss;
		return true;
	});
}

function roll(){
	var p = pool();
	if(!p.length){ draw(null, 0); return; }
	draw(p[Math.floor(Math.random() * p.length)], p.length);
}

/* ---- ONE MODE, TWO LINES ----------------------------------------------------------------------- */
function writtenLine(m){
	var t = money(m.amount);
	if(m.amountJitter)t = t + " &plusmn;" + m.amountJitter + "%";
	if(m.kind === "spread")
		t = money(m.truthTotal) + " a cycle &middot; " + t + " &times; " + m.perMonth
			+ " a month, any day";
	else{
		t = t + " &middot; day " + m.days.join(" and ");
		if(m.jitter)t = t + " &plusmn;" + m.jitter;
		t = t + " &middot; in " + m.arrivalP + "% of cycles";
	}
	if(m.rail !== "ignored")t = t + " &middot; bank pays " + esc(m.rail) + " on a shut day";
	if(m.diedAt !== null)
		t = t + " &middot; <span class='dead'>stopped after cycle " + m.diedAt + "</span>";
	return t;
}

function readLine(m){
	if(!m.gotShape)return "no mode answered for this payee";
	var t = esc(m.gotShape);
	if(m.gotDays.length){
		t = t + " &middot; day " + m.gotDays.join(" and ");
		if(m.dayOff !== null && m.dayOff > 0)
			t = t + " (" + m.dayOff + " out)";
	}else if(m.gotShape !== "spread")t = t + " &middot; no day claimed";
	if(m.gotArrival !== null)
		t = t + " &middot; comes " + m.gotArrival + "% &middot; day " + m.gotDay + "%";
	if(m.gotRail)t = t + " &middot; bank " + esc(m.gotRail) + " from " + m.gotRailTests + " shut";
	if(m.gotQuiet)t = t + " &middot; silent " + m.gotQuiet + " cycles";
	return t;
}

/* THE ONE-WORD VERDICT FOR A MODE, which is the thing a reader scans for. */
function modeVerdict(m){
	if(m.want === "dead")return {c: "na", t: "should be silent"};
	//"agrees" was true and unhelpful here: what agreed was the refusal to answer
	if(m.want === "unknown")
		return m.gotShape === "unknown" || !m.gotShape
			? {c: "ok", t: "declined, as written"}
			: {c: "no", t: "answered " + esc(m.gotShape) + ", too thin to read"};
	if(m.shapeOk === false)
		return {c: "no", t: "read as " + esc(m.gotShape || "nothing")};
	if(m.dayOk === false)return {c: "no", t: m.dayOff + " days out"};
	if(m.dayOff === 0)return {c: "ok", t: "exact"};
	if(m.dayOk === true)return {c: "ok", t: m.dayOff + " within wobble"};
	return {c: "ok", t: "agrees"};
}

/* ---- A LANE ------------------------------------------------------------------------------------ */
function laneHtml(lane, scale, ghosts){
	var w = 100 / lane.days, h = "", i, e, left, tall;
	var cap = lane.predicted ? 28 : 22;
	for(i = 0; i < lane.closed.length; i++)
		h = h + "<span class='sd" + (lane.closed[i].holiday ? " hol" : "") + "' style='left:"
			+ (lane.closed[i].day * w) + "%;width:" + w + "%'></span>";
	if(lane.rate)
		h = h + "<span class='band'><i>flow " + money(lane.rate) + "</i></span>";
	for(i = 0; i < lane.events.length; i++){
		e = lane.events[i];
		left = Math.max(0, Math.min(100, (e.day / lane.days) * 100));
		tall = Math.max(7, Math.min(cap, Math.abs(e.amount) / scale * cap));
		h = h + "<span class='mk" + (e.amount < 0 ? " out" : "")
			+ (e.spaced ? " spaced" : "") + "' style='left:" + left + "%;height:" + tall + "px'>"
			+ (lane.predicted ? "<i>" + money(e.amount) + "</i>"
				//THE DAY IS THE THING BEING ARGUED ABOUT, so a past mark says which day it is.
				//Only where there is room: a busy flow lane would be a wall of overlapping text.
				: (lane.events.length <= 6 ? "<span class='dn'>d" + e.day + "</span>" : ""))
			+ "</span>";
	}
	if(ghosts)for(i = 0; i < ghosts.length; i++){
		var g = ghosts[i];
		left = Math.max(0, Math.min(100, (g.day / lane.days) * 100));
		if(g.jitter){
			var lo = Math.max(0, (g.day - g.jitter) / lane.days * 100);
			var hi = Math.min(100, (g.day + g.jitter) / lane.days * 100);
			h = h + "<span class='ghb' style='left:" + lo + "%;width:" + (hi - lo) + "%'></span>";
		}
		h = h + "<span class='gh' style='left:" + left + "%'><i>d" + g.day
			+ (g.jitter ? "&plusmn;" + g.jitter : "") + "</i></span>";
	}
	return "<div class='lane" + (lane.predicted ? " next" : "") + "'>"
		+ "<div class='lb'>" + esc(lane.from) + " &ndash; " + esc(lane.to)
		+ (lane.predicted ? "<b>predicted</b>" : "") + "</div>"
		+ "<div class='track'>" + h + "</div></div>";
}

/* ---- WHAT THE MODULE IS ACTUALLY CLAIMING ------------------------------------------------------
   ONE SENTENCE PER MODE, in the order a person would ask: what will move, when, how much, and does
   that match what was written down. A mode that predicts nothing gets a sentence too - "nothing" is
   a claim, and a wrong "nothing" is the most expensive kind of miss there is. */
function saidOf(s){
	var out = [];
	s.modes.forEach(function(m){
		var c = m.claim;
		var who = "<b>" + esc(m.payee) + "</b>";
		var dead = m.diedAt !== null;

		if(predictsNothing(c)){
			/* NOTHING IS PREDICTED, AND THERE ARE THREE WAYS FOR THAT TO BE RIGHT OR WRONG.
			   The mode stopped, so there is nothing left to promise: right. The mode was written as
			   too thin to read at all, and declining is the whole point of the unknown answer:
			   right. Or it is a live, readable mode and silence loses real money: wrong. Calling
			   the middle case wrong was this page confusing "the money still exists" with "we can
			   say anything useful about it". */
			var why = refusalReason(c);
			var verdict;
			if(dead)
				verdict = "<span class='yes'>Right</span> &mdash; it stopped after cycle "
					+ m.diedAt + " and has no more to give.";
			else if(m.want === "unknown")
				verdict = "<span class='yes'>Right</span> &mdash; it was written as too thin to "
					+ "read: it turns up in only " + m.arrivalP + "% of cycles, so there is "
					+ "nothing worth promising.";
			else
				verdict = "<span class='nope'>Wrong</span> &mdash; it is still running and should "
					+ "move about " + money(m.truthTotal) + ".";
			out.push(who + ": <b>nothing</b> next cycle" + why + ". " + verdict);
			return;
		}

		if(m.kind === "spread" || c.shape === "spread"){
			//the written total is on the line above; only the gap between them is news here
			out.push(who + ": <b>" + money(c.total || c.amount) + "</b> across the cycle as "
				+ c.when.length + " payment" + (c.when.length === 1 ? "" : "s")
				+ (c.when.length ? " on " + c.when.join(", ") : "") + ". "
				+ verdictAmount(c.total || c.amount, m.truthTotal));
			return;
		}

		//A DATED CLAIM: the day is the headline and the amount is the second question.
		var when = c.when.length ? c.when.join(" and ") : "no date";
		var line = who + ": <b>" + money(c.total || c.amount) + "</b> on <b>" + when + "</b>. ";
		if(dead){
			line += "<span class='nope'>Wrong</span> &mdash; it stopped after cycle " + m.diedAt
				+ " and should predict nothing.";
		}else if(m.truthWhen){
			var same = c.when.indexOf(m.truthWhen) >= 0;
			line += "<span class='t'>Truth: " + m.truthWhen + ".</span> "
				+ (same ? "<span class='yes'>Same day</span>"
					: (m.dayOk ? "<span class='yes'>Within its wobble</span>"
						: "<span class='nope'>" + (m.dayOff === null ? "Different day"
							: m.dayOff + " days out") + "</span>"))
				+ ", " + gap(c.total || c.amount, m.truthTotal) + ".";
		}else{
			line += "<span class='t'>The rhythm was read wrong, so there is no truth date to "
				+ "compare this to.</span>";
		}
		out.push(line);
	});
	return out;
}

function gap(got, want){
	var d = Math.abs((got || 0) - (want || 0));
	if(d < 0.005)return "exactly the written amount";
	if(Math.abs(want) > 0 && d / Math.abs(want) < 0.05)return "within 5% on amount";
	return money(got) + " against " + money(want);
}

function verdictAmount(got, want){
	var d = Math.abs((got || 0) - (want || 0));
	if(Math.abs(want) > 0 && d / Math.abs(want) <= 0.15)
		return "<span class='yes'>Within 15%</span>.";
	return "<span class='nope'>" + money(got) + " against " + money(want) + "</span>.";
}

/* ---- A SNAPSHOT TO PASTE BACK ------------------------------------------------------------------
   EVERYTHING ABOUT ONE STREAM AS PLAIN TEXT, so a question about it can be asked without a
   screenshot. It carries what was written, what was read, what is claimed, and the raw days of every
   cycle - the last of those is what makes an answer possible rather than a guess, because the days
   are the evidence both sides are arguing about.

   NO BACKSLASH ANYWHERE, so the line break is built from its character code. Same rule the rest of
   this script follows, and the one place it would otherwise be broken. */
var NL = String.fromCharCode(10);

function pad(s, n){
	s = String(s);
	while(s.length < n)s = s + " ";
	return s;
}
function strip(html){
	var src = String(html), out = "", depth = 0, i, ch;
	for(i = 0; i < src.length; i++){
		ch = src.charAt(i);
		if(ch === "<"){ depth++; continue; }
		if(ch === ">"){ if(depth > 0)depth--; continue; }
		if(depth === 0)out = out + ch;
	}
	//entities last, and the ampersand last of those, so a decoded entity is never re-read
	return out.split("&mdash;").join("--").split("&middot;").join(".")
		.split("&plusmn;").join("+/-").split("&ndash;").join("-")
		.split("&lt;").join("<").split("&gt;").join(">").split("&amp;").join("&");
}

function snapshotOf(s){
	var L = [];
	/* THE DECLARATION BELONGS IN THE HEADER. Stripping it out made "weekly READ AS yearly" look
	   impossible - the decision can never answer a period LONGER than the one declared, so a yearly
	   answer is always a yearly declaration that the ledger failed to overrule. Without the word
	   DECLARED, the line describes a rule the module does not have. */
	var flows = s.modes.length && s.modes.every(function(m){ return m.kind === "spread"; });
	var acc = accountsOf(s);
	L.push(s.name + "  (" + s.id + ", seed " + META.seed + ")");
	L.push("  declared  " + pad(title(s.declared), 13)
		+ pad(s.declaredAmount ? money(s.declaredAmount) : "--", 15) + acc);
	L.push("  written   " + pad(title(s.truthCycle), 13)
		+ pad(money(writtenTotal(s)) + "/cycle", 15) + acc);
	L.push("  detected  " + pad(title(s.gotCycle || "nothing"), 13)
		+ pad(money(detectedTotal(s)) + "/cycle", 15) + acc
		+ (s.cycleOk ? "" : "   RHYTHM WRONG"));
	/* AND A STREAM THAT IS ALL FLOW HAS NO RHYTHM TO FIND. Payments scattered at random across
	   every cycle carry no trace of the lattice they were laid on, so the rhythm question is one
	   the ledger cannot answer either way. */
	if(flows && !s.cycleOk)
		L.push("  (every mode is a flow: random days carry no trace of a cycle, so there is no"
			+ " rhythm here to find)");

	s.modes.forEach(function(m){
		L.push("");
		L.push(m.payee + "  " + m.accountId + " " + m.accountType + " " + m.direction);
		L.push("  truth  " + strip(truthShort(m)));
		L.push("  read   " + strip(readShort(m)));
		L.push("  next   " + strip(nextShort(m)));
		var rail = railShort(m);
		if(rail)L.push("  rail   " + rail);
		L.push("  seen   " + seenShort(m));
		var landed = landedShort(m);
		if(landed)L.push("  landed " + landed);
	});
	return L.join(NL);
}

/* WHAT WAS WRITTEN, WITH EVERY FIELD THAT IS AT ITS DEFAULT LEFT OUT. A wobble of zero, an arrival
   of every cycle and a bank that ignores closures are all the absence of a fact, and printing them
   buries the two or three fields that actually describe this mode. */
function truthShort(m){
	var t = m.kind + "  " + money(m.amount);
	if(m.amountJitter)t = t + " +/-" + m.amountJitter + "%";
	/* A FLOW IS NAMED BY ITS CYCLE TOTAL FIRST. Leading with the size of one payment read as the
	   whole claim - "-$99" against a forecast of "-$571" looks like a five-fold error and is
	   actually 5.3 payments a month, which is the other half of the same sentence. */
	if(m.kind === "spread")
		return money(m.truthTotal) + " a cycle  = " + t + " x " + m.perMonth + "/month, any day";
	t = t + "  d" + m.days.join(",");
	if(m.jitter)t = t + " +/-" + m.jitter;
	if(m.arrivalP < 100)t = t + "  " + m.arrivalP + "% of cycles";
	if(m.diedAt !== null)t = t + "  stopped after cycle " + m.diedAt;
	return t;
}

function readShort(m){
	if(!m.gotShape)return "nothing answered for this payee";
	var t = m.gotShape;
	if(m.gotDays.length)t = t + " d" + m.gotDays.join(",");
	//the confidences only earn their space when they are the reason nothing is predicted
	var silent = predictsNothing(m.claim);
	if(silent && m.gotArrival !== null)
		t = t + "  comes " + m.gotArrival + "%, day " + m.gotDay + "%";
	if(silent && m.gotQuiet)t = t + "  silent " + m.gotQuiet + " cycles";
	return t;
}

/* A MODE PREDICTS NOTHING WHEN ITS AMOUNT IS ZERO, whatever the reason and whether or not a date
   survived beside it. Testing the reason instead of the amount is how a gated mode came out as a
   claim of zero dollars on a day. */
function predictsNothing(c){
	if(!c || c.amount === null)return true;
	if(c.silenced || c.late || c.capped)return true;
	return Math.abs(c.total || c.amount || 0) < 0.005;
}

function refusalReason(c){
	if(!c)return "";
	if(c.capped)return " because the plan is spent";
	if(c.silenced || c.late)
		return " because it has been quiet " + (c.quiet || 0) + " cycles";
	return "";
}

function nextShort(m){
	var c = m.claim;
	if(predictsNothing(c)){
		var tail = strip(refusalReason(c));
		if(m.diedAt !== null)return "nothing" + tail + "  OK, it stopped";
		if(m.want === "unknown")return "nothing" + tail + "  OK, too thin to read";
		if(c && c.capped)return "nothing" + tail + "  budget gate, check the plan";
		return "nothing" + tail + "  WRONG, still running";
	}
	if(m.kind === "spread" || c.shape === "spread")
		return money(c.total || c.amount) + " over the cycle as " + c.when.length + " payments"
			+ "  vs " + money(m.truthTotal)
			+ "  " + (amountAgrees(c.total || c.amount, m.truthTotal) ? "OK" : "WRONG");
	var t = money(c.total || c.amount) + " on " + (c.when.join(" and ") || "no date");
	if(m.diedAt !== null)return t + "  WRONG, it stopped after cycle " + m.diedAt;
	if(!m.truthWhen)return t + "  rhythm wrong, nothing to compare";
	return t + "  vs written centre " + m.truthWhen
		+ (m.jitter ? " +/-" + m.jitter + "d" : "")
		+ "  " + (m.dayOk === false ? "WRONG, " + m.dayOff + " days out"
			: (m.dayOff === 0 ? "OK, exact" : "OK, " + m.dayOff + " within wobble"));
}

/* ONLY WHEN THERE IS A BANK RULE TO GET RIGHT. A mode whose due days never met a closed day has
   nothing to learn from and nothing to be wrong about. */
function railShort(m){
	if(m.rail === "ignored" && !m.gotRail)return "";
	return "truth " + m.rail + ", read " + (m.gotRail || "none")
		+ (m.railOk === false ? "  WRONG" : "");
}

/* THE EVIDENCE, ON ONE LINE: every cycle the mode lived through, oldest first, as the day it moved
   on. A cycle with nothing in it is a dash, because an empty cycle is a fact about arrival. */
function seenShort(m){
	if(!m.landed || !m.landed.length)return "no cycles";
	var seen = m.landed.map(function(days){
		if(!days.length)return "-";
		if(days.length > 3)return "x" + days.length;
		return days.map(function(d){ return "d" + d; }).join(",");
	}).join(" ");
	//the cycle walk stops at the last payment, so the silence after it has to be said out loud
	var q = m.claim ? (m.claim.quiet || 0) : 0;
	return seen + (q ? "  then " + q + " silent to today" : "");
}

/* WHERE THEY ACTUALLY LANDED, which is a different question from where they were drawn from. A
   mode written as d18 give or take 9 whose twelve payments centre on d13 is not a mode the detector
   got wrong by five days - it is a mode whose evidence says d13. */
function landedShort(m){
	var all = [];
	(m.landed || []).forEach(function(days){
		days.forEach(function(d){ all.push(d); });
	});
	if(!all.length)return "";
	all.sort(function(a, b){ return a - b; });
	var mid = all[Math.floor(all.length / 2)];
	return "middle d" + mid + ", spread d" + all[0] + "-d" + all[all.length - 1]
		+ " over " + m.landed.length + " cycles";
}

/* THE CYCLES OF SILENCE AFTER THE LAST DRAWN ONE, taken from the gate that counted them so the
   picture and the verdict can never disagree. */
function quietOf(s, a){
	var q = 0;
	s.modes.forEach(function(m){
		if(m.accountId !== a.accountId || !m.claim)return;
		if((m.claim.quiet || 0) > q)q = m.claim.quiet || 0;
	});
	return q;
}

function amountAgrees(got, want){
	var d = Math.abs((got || 0) - (want || 0));
	return Math.abs(want) > 0 && d / Math.abs(want) <= 0.15;
}

function title(w){
	w = String(w || "");
	return w ? w.charAt(0).toUpperCase() + w.slice(1) : "--";
}

/* THE ACCOUNTS THE STREAM TOUCHES, by the name on them rather than the hash. "Synthetic Card" says
   nothing "Card" does not, so the common prefix goes. */
function accountsOf(s){
	var seen = [], i, n;
	for(i = 0; i < s.accounts.length; i++){
		n = String(s.accounts[i].name || s.accounts[i].accountId).split("Synthetic ").join("");
		if(seen.indexOf(n) < 0)seen.push(n);
	}
	return seen.join(" + ") || "--";
}

function writtenTotal(s){
	var n = 0;
	s.modes.forEach(function(m){ n = n + (m.truthTotal || 0); });
	return n;
}
function detectedTotal(s){
	var n = 0;
	s.modes.forEach(function(m){
		if(!predictsNothing(m.claim))n = n + (m.claim.total || m.claim.amount || 0);
	});
	return n;
}

function headRow(label, cycle, amount, accounts, off, unit){
	return "<div class='r" + (off ? " off" : "") + "'>"
		+ "<span class='lb2'>" + label + "</span>"
		+ "<span class='cy'>" + esc(title(cycle)) + "</span>"
		+ "<span class='am'>" + (amount ? money(amount) : "--")
			+ (amount && unit ? " " + unit : "") + "</span>"
		+ "<span class='ac'>" + esc(accounts) + "</span></div>";
}

/* ---- THE CARD ---------------------------------------------------------------------------------- */
function draw(s, n){
	var pos = document.getElementById("pos");
	var card = document.getElementById("card");
	if(!s){
		pos.textContent = "no stream matches";
		card.innerHTML = "<div class='card'><div class='empty'>Nothing in this run matches that "
			+ "filter.</div></div>";
		return;
	}
	pos.textContent = n + " match";

	var h = "<div class='card'>";
	h = h + "<div class='chead'><h2>" + esc(s.name) + "</h2><div class='rows'>"
		+ headRow("Declared", s.declared, s.declaredAmount, accountsOf(s), false, "")
		+ headRow("Written", s.truthCycle, writtenTotal(s), accountsOf(s), false, "a cycle")
		+ headRow("Detected", s.gotCycle || "nothing", detectedTotal(s), accountsOf(s),
			!s.cycleOk, "a cycle")
		+ "</div></div>";

	s.modes.forEach(function(m){
		var v = modeVerdict(m);
		h = h + "<div class='m'><div class='mh'><span class='tag " + esc(m.kind) + "'>"
			+ esc(m.kind) + "</span>" + esc(m.payee)
			+ "<span class='vm " + v.c + "'>" + v.t + "</span></div>"
			+ "<div class='ln'><i>written</i><span>" + writtenLine(m) + "</span></div>"
			+ "<div class='ln" + (v.c === "no" ? " bad" : "") + "'><i>read</i><span>"
			+ readLine(m) + "</span></div></div>";
	});

	if(!s.accounts.length)
		h = h + "<div class='empty'>The reading produced no lanes to draw.</div>";
	s.accounts.forEach(function(a){
		var scale = 1, i, j;
		for(i = 0; i < a.lanes.length; i++)for(j = 0; j < a.lanes[i].events.length; j++)
			if(Math.abs(a.lanes[i].events[j].amount) > scale)
				scale = Math.abs(a.lanes[i].events[j].amount);
		var ghosts = s.truthNext.filter(function(g){
			return s.modes.some(function(m){
				return m.payee === g.label && m.accountId === a.accountId;});
		});
		h = h + "<div class='acc'><div class='ah'>" + esc(a.name || a.accountId)
			+ " <em" + (a.accountType === "deferred" ? " class='d'" : "") + ">"
			+ esc(a.accountType === "deferred" ? "settles later" : "same day")
			+ "</em></div>";
		a.lanes.forEach(function(l){ h = h + laneHtml(l, scale, l.predicted ? ghosts : null); });
		var quiet = quietOf(s, a);
		if(quiet)h = h + "<div class='gap'>then " + quiet + " more cycle"
			+ (quiet === 1 ? "" : "s") + " with nothing at all, up to today</div>";
		h = h + "</div>";
	});

	var said = saidOf(s);
	h = h + "<div class='said'><h3>What it predicts for the next cycle</h3>";
	if(!said.length)h = h + "<p class='t'>Nothing at all: no mode cleared the gates.</p>";
	said.forEach(function(line){ h = h + "<p>" + line + "</p>"; });
	h = h + "</div>";

	h = h + "<details class='snapwrap'><summary>Snapshot text (select or copy)</summary>"
		+ "<pre id='snaptext'>" + esc(snapshotOf(s)) + "</pre></details>";

	card.innerHTML = h + "</div>";
}

document.getElementById("snap").addEventListener("click", function(){
	var pre = document.getElementById("snaptext");
	if(!pre)return;
	var btn = this;
	function done(){
		btn.classList.add("done");
		btn.textContent = "Copied";
		setTimeout(function(){
			btn.classList.remove("done");
			btn.textContent = "Copy snapshot";
		}, 1600);
	}
	/* THE CLIPBOARD API FIRST, THE OLD SELECTION TRICK SECOND, AND THE FOLD AS THE LAST RESORT.
	   A sandboxed frame may refuse both without an error a user would understand, so a refusal
	   opens the text instead of failing quietly. */
	if(navigator.clipboard && navigator.clipboard.writeText)
		navigator.clipboard.writeText(pre.textContent).then(done, fallback);
	else fallback();

	function fallback(){
		var ok = false;
		try{
			var r = document.createRange();
			r.selectNodeContents(pre);
			var sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(r);
			ok = document.execCommand("copy");
		}catch(e){ ok = false; }
		if(ok)done();
		else{
			pre.parentNode.open = true;
			btn.textContent = "Select the text below";
			setTimeout(function(){ btn.textContent = "Copy snapshot"; }, 2600);
		}
	}
});

document.getElementById("roll").addEventListener("click", roll);
document.getElementById("filters").addEventListener("click", function(ev){
	var b = ev.target.closest("button.f");
	if(!b)return;
	state.f = b.getAttribute("data-f");
	var all = document.querySelectorAll("button.f");
	for(var i = 0; i < all.length; i++)all[i].classList.toggle("on", all[i] === b);
	roll();
});
roll();
})();
`;

export default buildDnaAuditPage;
