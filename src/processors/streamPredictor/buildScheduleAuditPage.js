/* ==================================================================================================
   WHAT EVERY STREAM PUTS ON THE CALENDAR.  PROTOTYPE BENCH.

   ONE ROW PER STREAM, ONE MARK PER MONEY EVENT, drawn on a single shared time axis so the whole
   portfolio can be read down a column: the first of the month is a wall of rent and subscriptions,
   the fifteenth is payroll, and a stream that claims nothing has an empty lane rather than a missing
   one.

   UP IS MONEY IN, DOWN IS MONEY OUT, and the height is scaled inside each row. A row is about ONE
   stream's rhythm, and scaling the whole page to Rent would flatten every subscription to a hairline.
   The signed total on the right is what compares rows.

   THE HORIZON IS FILTERED IN THE PAGE, NOT REGENERATED. A shorter schedule is a strict prefix of a
   longer one - the gates walk cycle by cycle from the same start - so one year of events is generated
   once and the selector just moves the right-hand edge.

   THE EMITTED SCRIPT CARRIES NO BACKSLASH AND NO BACKTICK - same rule as the other bench pages.
   ================================================================================================== */

const DOT = '·';

const esc = s => String(s === null || s === undefined ? '' : s)
	.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
	.split('"').join('&quot;');

const HORIZONS = [30, 90, 180, 365];

/* ---- THE DATA ------------------------------------------------------------------------------------ */
export function scheduleData(predictor, until){
	const rows = [];
	predictor.reviewable().forEach(stream => {
		const r = predictor.scheduleOf(stream.id, until, stream);
		rows.push({
			id: stream.id,
			name: stream.name,
			cycle: r.cycle ? r.cycle.name : null,
			declared: stream.period || null,
			reason: r.reason || null,
			from: new Date(r.from).getTime(),
			events: r.events.map(e => ({
				t: new Date(e.date).getTime(),
				a: Math.round(e.amount * 100) / 100,
				c: e.claimed === null || e.claimed === undefined
					? null : Math.round(e.claimed * 100) / 100,
				k: e.kind,
				d: e.accountType === 'deferred' ? 1 : 0,
				r: e.refused ? 1 : 0,
				m: e.dueDate ? 1 : 0,
				w: e.label
			}))
		});
	});
	/* THE BUSIEST CALENDAR FIRST, then the biggest money. A page about what lands when is read from
	   the streams that actually land something. */
	return rows.sort((a, b) => b.events.length - a.events.length
		|| Math.abs(b.events.reduce((n, e) => n + e.a, 0))
			- Math.abs(a.events.reduce((n, e) => n + e.a, 0))
		|| (String(a.name) < String(b.name) ? -1 : 1));
}

export function buildScheduleAuditPage(rows, meta){
	const m = meta || {};
	return '<title>Stream schedules</title>'
		+ '<style>' + CSS + '</style>'
		+ '<main>'
		+ '<header class="top">'
			+ '<b>Stream schedules</b>'
			+ '<div class="hz" id="hz">'
				+ HORIZONS.map((d, i) => '<button class="h' + (i === 1 ? ' on' : '')
					+ '" data-d="' + d + '">' + d + 'd</button>').join('')
			+ '</div>'
			+ '<span class="sum" id="sum"></span>'
			/* THE DATE THE ANSWER IS MEASURED FROM, stated rather than assumed. A capture is a
			   photograph and the clock runs past it; read against today, a fixture taken last week
			   shows a week of claims that look missing and are only unphotographed. */
			+ '<span class="seed">as of ' + esc(m.asOf ? String(m.asOf).slice(0, 10) : '?')
				+ ' ' + DOT + ' ' + rows.length + ' streams</span>'
		+ '</header>'
		+ '<div class="axis" id="axis"></div>'
		+ '<div id="rows"></div>'
		+ '<p class="legend"><i class="sw in"></i>in <i class="sw out"></i>out '
			+ '<i class="sw def"></i>deferred account <i class="sw ref"></i>refused by a gate '
			+ DOT + ' hollow mark = a flow placed as whole payments '
			+ DOT + ' a caret marks a claim the bank moved off a shut day</p>'
		+ '</main>'
		+ '<script>window.SCHED=' + JSON.stringify(rows) + ';</script>'
		+ '<script>' + SCRIPT + '</script>';
}

/* ================================================================================================== */
const CSS = `
:root{
	--paper:#F4F5F7; --surface:#FFFFFF; --sunk:#E9EBF0;
	--ink:#14171C; --ink-soft:#4A5160; --ink-faint:#79808F;
	--rule:#D4D8E0; --accent:#2E4A7D; --accent-soft:#5C7AB0;
	--flag:#8A6520; --flag-bg:#F6EDDA;
	--in:#3A6153; --out:#7A4A5E; --def:#B07A3C; --ref:#9B3B42;
	--sans:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
	--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
	--paper:#131619; --surface:#1A1E24; --sunk:#22272F;
	--ink:#DFE3EA; --ink-soft:#A7AEBC; --ink-faint:#79808F;
	--rule:#2E343E; --accent:#9DB8E4; --accent-soft:#5C7AB0;
	--flag:#D2AC63; --flag-bg:#2B2418;
	--in:#8CB6A4; --out:#C99BAC; --def:#E0AC6B; --ref:#E39AA0;
}}
:root[data-theme="dark"]{
	--paper:#131619; --surface:#1A1E24; --sunk:#22272F;
	--ink:#DFE3EA; --ink-soft:#A7AEBC; --ink-faint:#79808F;
	--rule:#2E343E; --accent:#9DB8E4; --accent-soft:#5C7AB0;
	--flag:#D2AC63; --flag-bg:#2B2418;
	--in:#8CB6A4; --out:#C99BAC; --def:#E0AC6B; --ref:#E39AA0;
}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font:400 13px/1.4 var(--sans);margin:0}
main{max-width:1100px;margin:0 auto;padding:10px 12px 24px}
:focus-visible{outline:2px solid var(--accent-soft);outline-offset:2px}

header.top{display:flex;gap:10px;align-items:center;flex-wrap:wrap;
	padding-bottom:7px;border-bottom:1px solid var(--rule)}
header.top > b{font:600 15px/1.2 var(--sans)}
.hz{display:flex;gap:3px}
button.h{font:500 11px/1 var(--mono);padding:6px 9px;border-radius:6px;cursor:pointer;
	border:1px solid var(--rule);background:var(--surface);color:var(--ink-soft)}
button.h.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.sum{font:500 11.5px/1 var(--mono);color:var(--ink-soft);
	background:var(--sunk);padding:5px 8px;border-radius:5px}
.seed{font:400 10.5px/1.3 var(--mono);color:var(--ink-faint);margin-left:auto}

/* NAME, LANE, TOTAL - and the lane column is shared by the axis so the ticks line up with the
   marks under them. */
.axis,.row{display:grid;grid-template-columns:164px 1fr 82px;gap:8px;align-items:center}
.axis{height:17px;margin:5px 0 1px;font:400 9px/1 var(--mono);color:var(--ink-faint)}
.axis .track{position:relative;height:100%}
.axis .mo{position:absolute;top:2px;border-left:1px solid var(--rule);padding-left:3px;
	height:13px;white-space:nowrap}

.row{border-top:1px solid var(--rule);padding:1px 0}
.row:hover{background:var(--surface)}
.nm{font:500 11.5px/1.3 var(--sans);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nm i{display:block;font-style:normal;font:400 9px/1.3 var(--mono);color:var(--ink-faint)}
.nm i.no{color:var(--flag)}
.tot{font:600 11.5px/1 var(--mono);text-align:right;font-variant-numeric:tabular-nums;
	white-space:nowrap}
.tot.pos{color:var(--in)}
.tot.neg{color:var(--out)}
.tot.nil{color:var(--ink-faint);font-weight:400}

.lane{position:relative;height:26px;background:var(--sunk);border-radius:3px;overflow:hidden}
.lane.empty{background:transparent;border:1px dashed var(--rule)}
.mid{position:absolute;left:0;right:0;top:50%;border-top:1px solid var(--rule)}
.gl{position:absolute;top:0;bottom:0;border-left:1px solid var(--rule);opacity:.5}
.mk{position:absolute;width:3px;margin-left:-1.5px;border-radius:1px;background:var(--out)}
.mk.in{background:var(--in)}
.mk.def{background:var(--def)}
.mk.flow{background:transparent;border:1px solid var(--out)}
.mk.flow.in{border-color:var(--in)}
.mk.flow.def{border-color:var(--def)}
.mk.ref{background:transparent;border:1px dashed var(--ref)}
.mk.mv::after{content:"";position:absolute;left:50%;top:-4px;transform:translateX(-50%);
	border-left:2px solid transparent;border-right:2px solid transparent;
	border-bottom:3px solid var(--accent)}

.legend{margin:10px 0 0;font:400 10.5px/1.7 var(--mono);color:var(--ink-faint)}
.sw{display:inline-block;width:9px;height:9px;border-radius:2px;vertical-align:-1px;
	margin:0 3px 0 10px}
.sw.in{background:var(--in);margin-left:0}
.sw.out{background:var(--out)}
.sw.def{background:var(--def)}
.sw.ref{border:1px dashed var(--ref)}

@media (max-width:640px){
	.axis,.row{grid-template-columns:104px 1fr 68px;gap:5px}
	.nm{font-size:10.5px}
	.tot{font-size:10px}
	.seed{margin-left:0;width:100%}
}
`;

/* ================================================================================================== */
const SCRIPT = `
(function(){
var S = window.SCHED || [];
var DAY = 24 * 60 * 60 * 1000;
var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var days = 90;

function esc(s){return String(s === null || s === undefined ? "" : s)
	.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");}
function money(n){
	var a = Math.abs(n), t;
	if(a >= 1000)t = (a / 1000).toFixed(a >= 10000 ? 0 : 1) + "k";
	else t = a >= 100 ? String(Math.round(a)) : a.toFixed(0);
	return (n < 0 ? "-" : "+") + "$" + t;
}

var from = S.length ? S[0].from : Date.now();
S.forEach(function(r){ if(r.from < from)from = r.from; });

/* MONTH BOUNDARIES ARE THE ONLY GRID A CALENDAR NEEDS. Everything in this portfolio is anchored to
   a day of the month, so the walls of marks fall between them and the eye reads the rhythm. */
function months(a, b){
	var out = [], d = new Date(a);
	d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
	while(d.getTime() < b){
		out.push({t: d.getTime(), label: MONTHS[d.getMonth()]});
		d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
	}
	return out;
}

function draw(){
	var to = from + days * DAY;
	var span = to - from;
	var pos = function(t){ return Math.max(0, Math.min(100, (t - from) / span * 100)); };
	var grid = months(from, to);

	var ax = "<div></div><div class='track'>";
	grid.forEach(function(g){
		ax += "<span class='mo' style='left:" + pos(g.t) + "%'>" + g.label + "</span>";
	});
	document.getElementById("axis").innerHTML = ax + "</div><div></div>";

	var net = 0, shown = 0, count = 0, html = "";
	S.forEach(function(r){
		var mine = r.events.filter(function(e){ return e.t <= to; });
		var total = mine.reduce(function(n, e){ return n + e.a; }, 0);
		net += total;
		count += mine.length;
		if(mine.length)shown++;

		//EACH ROW IS SCALED TO ITSELF: a row is about one stream's rhythm, not about the portfolio
		var peak = 1;
		mine.forEach(function(e){
			var v = Math.abs(e.r ? e.c : e.a);
			if(v > peak)peak = v;
		});

		var lane = "<span class='mid'></span>";
		grid.forEach(function(g){
			lane += "<span class='gl' style='left:" + pos(g.t) + "%'></span>";
		});
		mine.forEach(function(e){
			var v = e.r ? (e.c || 0) : e.a;
			var h = Math.max(2, Math.round(Math.abs(v) / peak * 11));
			var up = v > 0;
			lane += "<span class='mk" + (up ? " in" : "") + (e.d ? " def" : "")
				+ (e.k === "rate" ? " flow" : "") + (e.r ? " ref" : "") + (e.m ? " mv" : "")
				+ "' style='left:" + pos(e.t) + "%;height:" + h + "px;"
				+ (up ? "bottom:50%" : "top:50%") + "' title='" + esc(e.w) + "'></span>";
		});

		var cls = Math.round(total) === 0 ? "nil" : (total > 0 ? "pos" : "neg");
		html += "<div class='row'>"
			+ "<div class='nm'>" + esc(r.name)
			+ "<i" + (r.reason ? " class='no'" : "") + ">"
			+ (r.reason ? esc(r.reason.split(":")[0]) : esc(r.cycle) + " " + mine.length + " events")
			+ "</i></div>"
			+ "<div class='lane" + (mine.length ? "" : " empty") + "'>" + lane + "</div>"
			+ "<div class='tot " + cls + "'>" + (mine.length ? money(total) : "") + "</div>"
			+ "</div>";
	});

	document.getElementById("rows").innerHTML = html;
	document.getElementById("sum").textContent = count + " events " + String.fromCharCode(183)
		+ " " + shown + " of " + S.length + " streams " + String.fromCharCode(183)
		+ " net " + money(net);
}

document.getElementById("hz").addEventListener("click", function(ev){
	var b = ev.target.closest("button.h");
	if(!b)return;
	days = parseInt(b.getAttribute("data-d"), 10);
	var all = document.querySelectorAll("button.h");
	for(var i = 0; i < all.length; i++)all[i].classList.toggle("on", all[i] === b);
	draw();
});
draw();
})();
`;

export default buildScheduleAuditPage;
