/* ==================================================================================================
   IS THE LEDGER RIGHT?  PROTOTYPE BENCH.

   ONE ACCOUNT AT A TIME, because a ledger is checked against an account and averaging seven of them
   answers about none.

   THE TOP CHART IS THE REAL BALANCE, pinned to what the bank reports on the analysis date; history
   runs backwards from it and the forecast forwards. A constant offset changes no slope, so nothing
   about the shape is lost - but the axis must then scale to the SERIES rather than always include
   zero, or a $36,000 savings balance drawn down to zero makes a wrong $200 subscription invisible.

   THE CYCLE CHARTS STAY AT ZERO. They compare one cycle against another and an anchor is a constant
   that belongs to neither.

   THE TWO SHAPES ARE DRAWN ON ONE AXIS. What happened over the last thirty days and what is claimed
   for the next thirty, both starting at zero on day one, so the question "does the prediction look
   like the month it came from" is answered by looking rather than by arithmetic.

   THE ENTRY LIST SAYS WHICH TRANSACTIONS THE PREDICTION COVERS. A posted entry whose stream produces
   no events is money that moved and will not be forecast, and that is the gap between the two shapes.

   THE EMITTED SCRIPT CARRIES NO BACKSLASH AND NO BACKTICK - same rule as the other bench pages.
   ================================================================================================== */

import {plain} from '../streamPredictor/auditShell';

const DOT = '·';

const esc = s => String(s === null || s === undefined ? '' : s)
	.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
	.split('"').join('&quot;');

/* ---- THE DATA ------------------------------------------------------------------------------------ */
export function ledgerData(built, opts){
	const o = opts || {};
	const back = (o.daysBack === undefined ? 400 : o.daysBack) * 24 * 3600 * 1000;
	const asOf = new Date(built.asOf).getTime();

	return {
		asOf: asOf,
		seamDay: o.seamDay === undefined ? 1 : o.seamDay,
		//what the module forecast for each past cycle, rebuilt from the ledger as it stood then
		past: o.backtests || [],
		until: new Date(built.until).getTime(),
		streams: built.streams,
		reviewable: built.reviewable,
		events: built.events,
		setAside: built.setAside,
		links: built.links,
		accounts: built.accounts.map(a => ({
			id: a.accountId,
			name: plain(a.name || a.accountId),
			mask: a.mask || null,
			kind: a.accountType,
			reported: a.reported ? a.reported.current : null,
			//the balance the whole series is pinned to, already in this ledger's sign convention
			anchor: a.anchor ? Math.round(a.anchor.balance * 100) / 100 : null,
			closing: a.closing === undefined ? null : Math.round(a.closing * 100) / 100,
			sameDay: a.sameDay || 0,
			cal: (o.calibration && o.calibration[a.accountId]) || null,
			rows: a.ledger
				.filter(e => new Date(e.date).getTime() >= asOf - back)
				.map(e => ({
					t: new Date(e.date).getTime(),
					a: Math.round(e.amount * 100) / 100,
					s: e.source === 'posted' ? 0 : 1,
					//a computed repayment: drawn on the balance, never in the spending comparison
					g: e.source === 'settlement' ? 1 : 0,
					c: e.covered ? 1 : 0,
					r: e.refused ? 1 : 0,
					p: e.repayment ? 1 : 0,
					y: e.silence || null,
					w: plain(e.label),
					n: e.streamName ? plain(e.streamName) : null
				})),
			aside: a.setAside.map(e => ({
				t: new Date(e.date).getTime(),
				a: Math.round(e.amount * 100) / 100,
				w: plain(e.label)
			}))
		}))
	};
}

export function buildLedgerAuditPage(data, meta){
	const m = meta || {};
	return '<title>Account ledgers</title>'
		+ '<style>' + CSS + '</style>'
		+ '<main>'
		+ '<header class="top">'
			+ '<b>Account ledgers</b>'
			+ '<span class="sum" id="sum"></span>'
			+ '<span class="seed">as of ' + esc(m.asOf ? String(m.asOf).slice(0, 10) : '?')
				+ ' ' + DOT + ' balances pinned to the reported figure</span>'
		+ '</header>'
		+ '<div class="tabs" id="tabs"></div>'
		+ '<div id="panel"></div>'
		+ '</main>'
		+ '<script>window.LEDGER=' + JSON.stringify(data) + ';</script>'
		+ '<script>' + SCRIPT + '</script>';
}

/* ================================================================================================== */
const CSS = `
:root{
	--paper:#F4F5F7; --surface:#FFFFFF; --sunk:#E9EBF0;
	--ink:#14171C; --ink-soft:#4A5160; --ink-faint:#79808F;
	--rule:#D4D8E0; --accent:#2E4A7D; --accent-soft:#5C7AB0;
	--flag:#8A6520; --flag-bg:#F6EDDA;
	--past:#2E4A7D; --fwd:#B07A3C; --in:#3A6153; --out:#7A4A5E; --miss:#9B3B42;
	--sans:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
	--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
	--paper:#131619; --surface:#1A1E24; --sunk:#22272F;
	--ink:#DFE3EA; --ink-soft:#A7AEBC; --ink-faint:#79808F;
	--rule:#2E343E; --accent:#9DB8E4; --accent-soft:#5C7AB0;
	--flag:#D2AC63; --flag-bg:#2B2418;
	--past:#9DB8E4; --fwd:#E0AC6B; --in:#8CB6A4; --out:#C99BAC; --miss:#E39AA0;
}}
:root[data-theme="dark"]{
	--paper:#131619; --surface:#1A1E24; --sunk:#22272F;
	--ink:#DFE3EA; --ink-soft:#A7AEBC; --ink-faint:#79808F;
	--rule:#2E343E; --accent:#9DB8E4; --accent-soft:#5C7AB0;
	--flag:#D2AC63; --flag-bg:#2B2418;
	--past:#9DB8E4; --fwd:#E0AC6B; --in:#8CB6A4; --out:#C99BAC; --miss:#E39AA0;
}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font:400 13px/1.4 var(--sans);margin:0}
main{max-width:1060px;margin:0 auto;padding:10px 12px 26px}
:focus-visible{outline:2px solid var(--accent-soft);outline-offset:2px}

header.top{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;
	padding-bottom:7px;border-bottom:1px solid var(--rule)}
header.top > b{font:600 15px/1.2 var(--sans)}
.sum{font:500 11px/1 var(--mono);color:var(--ink-soft);background:var(--sunk);
	padding:5px 8px;border-radius:5px}
.seed{font:400 10.5px/1.3 var(--mono);color:var(--ink-faint);margin-left:auto}

.tabs{display:flex;gap:4px;flex-wrap:wrap;margin:9px 0 10px}
button.tb{font:500 11px/1.3 var(--mono);padding:6px 9px;border-radius:6px;cursor:pointer;
	border:1px solid var(--rule);background:var(--surface);color:var(--ink-soft);text-align:left}
button.tb.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
button.tb i{font-style:normal;opacity:.65;display:block;font-size:9.5px}

h3{margin:14px 0 5px;font:600 9.5px/1.3 var(--mono);text-transform:uppercase;
	letter-spacing:.07em;color:var(--ink-faint)}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:10px 11px}
svg{display:block;width:100%;height:auto;overflow:visible}
.gl{stroke:var(--rule);stroke-width:1}
.zero{stroke:var(--ink-faint);stroke-width:1;stroke-dasharray:2 3}
.div{stroke:var(--miss);stroke-width:1.5}
.lpast{fill:none;stroke:var(--past);stroke-width:2}
.lfwd{fill:none;stroke:var(--fwd);stroke-width:2;stroke-dasharray:4 3}
/* THE ACTUAL SIDE SPLIT IN TWO: the part a stream predicts onto this account, and the part nothing
   forecasts. Their sum is the solid line, so the gap between COVERED and PREDICTED is the real
   error and everything below it is the yearly tail. */
.lcov{fill:none;stroke:var(--in);stroke-width:1.6}
.lunc{fill:none;stroke:var(--miss);stroke-width:1.3;stroke-dasharray:2 2}
.lend{fill:none;stroke:var(--ink-faint);stroke-width:1.3;stroke-dasharray:5 3}
.sw.e{background:var(--ink-faint)}
.sw.c{background:var(--in)}
.sw.u{background:var(--miss)}
td.n.dim{color:var(--ink-faint)}
text{font:400 9px var(--mono);fill:var(--ink-faint)}
text.v{font-size:9.5px}

.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
/* THE ACTUAL SIDE STEPS, THE PREDICTION DOES NOT. One forecast against many months is the only
   comparison this bench can honestly make - predicting a month from a ledger that contains it would
   flatter the answer - and stepping back through the months shows whether the forecast sits among
   them or outside them. */
.step{display:flex;gap:5px;align-items:center;margin:0 0 7px;flex-wrap:wrap}
.step button{font:600 12px/1 var(--mono);width:26px;height:26px;border-radius:6px;cursor:pointer;
	border:1px solid var(--rule);background:var(--surface);color:var(--ink)}
.step button:disabled{opacity:.3;cursor:not-allowed}
.step .lab{font:500 11px/1 var(--mono);color:var(--ink);min-width:150px;text-align:center}
.step .vs{font:400 10.5px/1 var(--mono);color:var(--ink-faint)}

.legend{margin:7px 0 0;font:400 10.5px/1.7 var(--mono);color:var(--ink-faint)}
.sw{display:inline-block;width:14px;height:3px;vertical-align:3px;margin:0 4px 0 10px}
.sw.p{background:var(--past);margin-left:0}
.sw.f{background:var(--fwd)}
.sw.d{width:9px;height:9px;border-radius:2px;vertical-align:-1px;background:var(--miss)}

table{border-collapse:collapse;width:100%;margin-top:4px;
	font:400 11px/1.35 var(--mono);font-variant-numeric:tabular-nums}
th{text-align:left;font:500 9px var(--mono);text-transform:uppercase;letter-spacing:.05em;
	color:var(--ink-faint);padding:0 8px 3px 0;border-bottom:1px solid var(--rule)}
td{padding:3px 8px 3px 0;border-bottom:1px solid var(--rule)}
tr:last-child td{border-bottom:0}
td.n{text-align:right;white-space:nowrap}
td.n.pos{color:var(--in)}
td.n.neg{color:var(--out)}
tr.fwd td{color:var(--fwd)}
tr.gap td:first-child{box-shadow:inset 2px 0 0 var(--miss)}
tr.gap .w{color:var(--miss)}
.w{word-break:break-word}
.scroll{max-height:330px;overflow-y:auto}
.tag{display:inline-block;font-size:9px;padding:1px 4px;border-radius:3px;background:var(--sunk);
	color:var(--ink-faint);margin-left:5px}

@media (max-width:660px){
	.two{grid-template-columns:1fr}
	.seed{margin-left:0;width:100%}
}
`;

/* ================================================================================================== */
const SCRIPT = `
(function(){
var D = window.LEDGER || {};
var DAY = 24 * 60 * 60 * 1000;
var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var pick = 0;
/* HOW MANY WHOLE CYCLES BACK THE ACTUAL SIDE IS DRAWN FROM. 0 is the last complete one. */
var back = 0;

function esc(s){return String(s === null || s === undefined ? "" : s)
	.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");}
function money(n){
	var a = Math.abs(n), t;
	if(a >= 1000)t = (a / 1000).toFixed(a >= 10000 ? 0 : 1) + "k";
	else t = a.toFixed(a >= 100 ? 0 : 2);
	return (n < 0 ? "-" : "") + "$" + t;
}
function day(t){ var d = new Date(t); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; }

/* THE CUMULATIVE SUM FROM ZERO. Entries are already ordered; each one is a step, and the line
   between two steps is flat because nothing happened there. */
function curve(rows){
	var pts = [], run = 0, i;
	for(i = 0; i < rows.length; i++){
		run += rows[i].a;
		pts.push({t: rows[i].t, v: run});
	}
	return pts;
}

function path(pts, x, y){
	if(!pts.length)return "";
	var d = "M " + x(pts[0].t) + " " + y(0), i;
	for(i = 0; i < pts.length; i++){
		d += " L " + x(pts[i].t) + " " + y(i ? pts[i - 1].v : 0);
		d += " L " + x(pts[i].t) + " " + y(pts[i].v);
	}
	return d;
}

/* ---- THE WHOLE LEDGER, PAST THEN PREDICTED ---------------------------------------------------- */
function wide(acc){
	var W = 1000, H = 190, P = 26;
	var rows = acc.rows;
	if(!rows.length)return "<svg viewBox='0 0 " + W + " " + H + "'></svg>";

	var t0 = rows[0].t, t1 = D.until;
	var past = curve(rows.filter(function(r){ return r.s === 0; }));
	var base = past.length ? past[past.length - 1].v : 0;
	var fwd = [], run = base;
	rows.filter(function(r){ return r.s === 1; }).forEach(function(r){
		run += r.a;
		fwd.push({t: r.t, v: run});
	});

	/* PINNED TO THE REPORTED BALANCE. Everything posted has already happened, so the cumulative at
	   the last posted entry IS the balance the bank reports; one offset carries that to every point,
	   backwards through the history and forwards through the forecast. */
	var off = acc.anchor === null ? 0 : acc.anchor - base;
	var all = past.concat(fwd);
	all.forEach(function(p){ p.v += off; });
	base += off;

	//the axis scales to the series, not to zero: a $36k account has nothing to say near the origin
	var lo = all[0].v, hi = all[0].v;
	all.forEach(function(p){ if(p.v < lo)lo = p.v; if(p.v > hi)hi = p.v; });
	if(hi === lo){ hi = 1; lo = -1; }
	var pad = (hi - lo) * 0.12;
	lo -= pad; hi += pad;

	var x = function(t){ return P + (t - t0) / (t1 - t0) * (W - P - 46); };
	var y = function(v){ return H - 16 - (v - lo) / (hi - lo) * (H - 30); };

	var g = "";
	var d = new Date(t0);
	d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
	while(d.getTime() < t1){
		g += "<line class='gl' x1='" + x(d.getTime()) + "' y1='6' x2='" + x(d.getTime())
			+ "' y2='" + (H - 16) + "'/>"
			+ "<text x='" + (x(d.getTime()) + 3) + "' y='" + (H - 5) + "'>"
			+ MONTHS[d.getMonth()] + "</text>";
		d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
	}
	//zero is a line worth drawing only where the account actually crosses it
	if(lo < 0 && hi > 0)
		g += "<line class='zero' x1='" + P + "' y1='" + y(0) + "' x2='" + (W - 46)
			+ "' y2='" + y(0) + "'/>";
	g += "<line class='div' x1='" + x(D.asOf) + "' y1='6' x2='" + x(D.asOf) + "' y2='"
		+ (H - 16) + "'/>"
		+ "<text class='v' x='" + (x(D.asOf) + 4) + "' y='14' fill='currentColor'>as of</text>";

	g += "<path class='lpast' d='" + path(past, x, y) + "'/>";
	if(fwd.length){
		var seam = [{t: D.asOf, v: base}].concat(fwd);
		var dd = "M " + x(seam[0].t) + " " + y(seam[0].v), i;
		for(i = 1; i < seam.length; i++)
			dd += " L " + x(seam[i].t) + " " + y(seam[i - 1].v)
				+ " L " + x(seam[i].t) + " " + y(seam[i].v);
		g += "<path class='lfwd' d='" + dd + "'/>";
	}
	g += "<text class='v' x='" + (W - 42) + "' y='" + (y(hi - pad) + 3) + "'>"
		+ money(hi - pad) + "</text>"
		+ "<text class='v' x='" + (W - 42) + "' y='" + (y(lo + pad) + 3) + "'>"
		+ money(lo + pad) + "</text>";
	return "<svg viewBox='0 0 " + W + " " + H + "'>" + g + "</svg>";
}

/* ---- ONE CYCLE AGAINST ANOTHER, BOTH FROM ZERO -------------------------------------------------
   REPAYMENTS ARE IN, ON BOTH SIDES. They were excluded while the forecast had none of them - a month
   of spending against a month of spending PLUS being paid off runs the two lines in opposite
   directions for a reason that has nothing to do with the prediction. Now that a repayment is
   computed rather than discarded, both halves carry them and the comparison is a BALANCE rather than
   a cumulative spend: the card climbs back on every repayment day in both lines, or the settlement
   stage is wrong about something. */
function shapes(acc){
	var W = 480, H = 150, P = 30;

	/* TWO WHOLE CYCLES OF THE LATTICE, NOT TWO WINDOWS ENDING AT TODAY.

	   THIRTY DAYS BACK FROM THE CAPTURE IS NOT A CYCLE. It straddles two seams, so a bill that
	   drifted a week earlier appears TWICE in it - both daycare cheques landed on the 11th of August
	   and again on the 4th and 8th of September - while the month ahead holds one of each. The actual
	   line then carries two large steps against the prediction's one, and the shapes look nothing
	   alike for a reason that is entirely the window.

	   SO BOTH SIDES ARE WHOLE CYCLES ON THE SAME LATTICE: the last complete one behind the capture,
	   and the next complete one ahead of it, seamed on the analysis anchor like every cycle the
	   prediction is built from. Same phase, same length, one payment of each in each. */
	var seam = function(t, step){
		var d = new Date(t);
		var s = new Date(d.getFullYear(), d.getMonth(), D.seamDay);
		if(s.getTime() > d.getTime())s.setMonth(s.getMonth() - 1);
		s.setMonth(s.getMonth() + (step || 0));
		return s.getTime();
	};
	/* POSITION 0 IS THE CYCLE AHEAD - a forecast with no answer yet. Every position after it is a
	   cycle that has already happened, drawn against the forecast made at its own start. */
	var bt = back > 0 ? D.past[back - 1] : null;
	var A0, A1, B0, B1, pred = null;
	if(bt){
		A0 = bt.from; A1 = bt.to; B0 = bt.from; B1 = bt.to;
		var mine = null, q;
		for(q = 0; q < bt.accounts.length; q++)
			if(bt.accounts[q].id === acc.id)mine = bt.accounts[q];
		pred = mine ? mine.rows.map(function(r){
			return {t: r.t, a: r.a, k: r.k, w: r.w, n: r.n, s: 1, c: 0, p: 0, r: 0};
		}) : [];
	}else{
		/* THE CYCLE AHEAD HAS NO ACTUALS, so both windows are that cycle and the posted filter
		   below finds nothing. Pointing the actual window at a PAST month here was the mismatched
		   comparison this stepper exists to remove: July's spending drawn against October's
		   forecast, on one axis, with only the forecast's dates in the caption. */
		A0 = seam(D.asOf, 1); A1 = seam(D.asOf, 2);
		B0 = A0; B1 = A1;
	}

	var a = acc.rows.filter(function(r){ return r.s === 0 && r.t >= A0 && r.t < A1; });
	var b = pred || acc.rows.filter(function(r){ return r.s === 1 && r.t >= B0 && r.t < B1; });
	/* THE SPLIT IS ABOUT CHARGES, AND A REPAYMENT IS NOT ONE. It clears everything the card spent,
	   predicted or not, so filing it under "carried by a predicting stream" made that line climb
	   strictly upward - carrying a whole month of repayments against a fraction of a month's
	   spending. The three sub-lines decompose the SPENDING; the solid line is the balance, and the
	   difference between them is the repayments. */
	var charges = a.filter(function(r){ return !r.p && !r.g; });
	var repaid = a.filter(function(r){ return r.p || r.g; });

	var aCov = charges.filter(function(r){ return r.c; });
	/* THREE STATES, NOT TWO. Money the module forecasts, money it deliberately says nothing about
	   because the stream is over, and money it cannot see. Only the third is a gap. */
	var aEnd = charges.filter(function(r){ return !r.c && r.y === "stopped"; });
	var aUnc = charges.filter(function(r){ return !r.c && r.y !== "stopped"; });

	var mk = function(rows, from, to, open){
		var out = [], run = open || 0;
		rows.forEach(function(r){
			run += r.a;
			out.push({d: (r.t - from) / (to - from), v: run});
		});
		return out;
	};
	//both halves open on the same carried-in balance, or they are not comparable
	var A = mk(a, A0, A1, opening), B = mk(b, B0, B1, opening);

	/* ---- A REPAYMENT IS SHARED OUT ACROSS WHAT IT CLEARED ---------------------------------------
	   THE SUB-LINES ARE BALANCES, NOT SPEND. Drawn from charges alone they slide down for ever and
	   never climb back, which is the one thing a card balance always does. A repayment clears the
	   charges since the last one, and those charges have a known split - predicted, over, unseen -
	   so the repayment is divided in the same proportion. Each line is then "the balance this kind
	   of spending would leave on its own", the three still sum to the solid line, and all of them
	   sawtooth.

	   WHERE THERE IS NOTHING TO CLEAR the repayment goes to the predicted share: a payment against a
	   balance carried in from before the window is not evidence about anything inside it. */
	var walk = function(rows, from, to, seed){
		var cov = [], over = [], unc = [];
		var pend = seed ? {c: seed.pend.c, e: seed.pend.e, u: seed.pend.u} : {c: 0, e: 0, u: 0};
		var run = seed ? {c: seed.run.c, e: seed.run.e, u: seed.run.u} : {c: 0, e: 0, u: 0};
		rows.forEach(function(r){
			var f = (r.t - from) / (to - from);
			if(r.p || r.g){
				/* A REPAYMENT CLEARS AS MUCH AS IT COVERS AND NO MORE. Emptying the pending charges
				   whatever the payment was worth threw away the uncleared remainder along with the
				   class that made it, so an under-payment - which every week is, while the forecast
				   sees a fraction of the card's spending - orphaned the difference and no later
				   repayment could ever be credited to it. Gembah's charges piled up unpaid to
				   -$4,667 while the predicted share climbed to +$1,767 on the same card. */
				var tot = pend.c + pend.e + pend.u;
				if(tot){
					var share = Math.min(1, Math.abs(r.a / tot));
					var used = -tot * share;
					["c", "e", "u"].forEach(function(k){
						var part = -pend[k] * share;
						run[k] += part;
						pend[k] += part;
					});
					//an overpayment settles a balance carried in from before anything pending here
					var excess = r.a - used;
					if(Math.abs(excess) > 0.005)run.c += excess;
				}else run.c += r.a;
			}else{
				var k = r.c ? "c" : (r.y === "stopped" ? "e" : "u");
				pend[k] += r.a;
				run[k] += r.a;
			}
			cov.push({d: f, v: run.c});
			over.push({d: f, v: run.e});
			unc.push({d: f, v: run.u});
		});
		return {cov: cov, over: over, unc: unc, run: run, pend: pend};
	};

	/* ---- THE WINDOW DOES NOT START AT ZERO -------------------------------------------------------
	   A CARD OWES SOMETHING ON THE FIRST DAY OF ANY CYCLE. Started at zero, the repayments inside a
	   window clear charges made before it and the lines drift upward by exactly the balance carried
	   in - the predicted-spending line ended a cycle at +$2.2k, which is not a balance any card has.

	   SO EVERY LINE OPENS WHERE THE PREVIOUS CYCLES LEFT IT: the same walk is run over everything
	   before the window, and its running totals and its unrepaid charges seed this one. The lines
	   then oscillate around zero the way the account does, and a repayment made inside the window
	   for a charge made outside it is charged to the class that actually made it. */
	var before = acc.rows.filter(function(r){ return r.s === 0 && r.t < A0; })
		.sort(function(x, y){ return x.t - y.t; });
	var seed = walk(before, A0 - 1, A0);
	var opening = before.reduce(function(n, r){ return n + r.a; }, 0);

	var split = walk(a, A0, A1, seed);
	var AC = split.cov, AU = split.unc, AE = split.over;
	var spanA = Math.round((A1 - A0) / DAY), spanB = Math.round((B1 - B0) / DAY);

	var lo = 0, hi = 0;
	var scale = split3
		? A.concat(B).concat(AC).concat(AU).concat(AE)
			.concat([{v: opening}, {v: seed.run.c}, {v: seed.run.e}, {v: seed.run.u}])
		: A.concat(B).concat([{v: opening}]);
	scale.forEach(function(p){ if(p.v < lo)lo = p.v; if(p.v > hi)hi = p.v; });
	if(hi === lo){ hi = 1; lo = -1; }
	var pad = (hi - lo) * 0.12; lo -= pad; hi += pad;

	var x = function(f){ return P + f * (W - P - 44); };
	var y = function(v){ return H - 18 - (v - lo) / (hi - lo) * (H - 32); };
	var line = function(pts, cls, open){
		if(!pts.length)return "";
		var from = open || 0;
		var d = "M " + x(0) + " " + y(from), i;
		for(i = 0; i < pts.length; i++)
			d += " L " + x(pts[i].d) + " " + y(i ? pts[i - 1].v : from)
				+ " L " + x(pts[i].d) + " " + y(pts[i].v);
		return "<path class='" + cls + "' d='" + d + "'/>";
	};

	var g = "<line class='zero' x1='" + P + "' y1='" + y(0) + "' x2='" + (W - 44)
		+ "' y2='" + y(0) + "'/>";
	[0, 0.25, 0.5, 0.75, 1].forEach(function(f){
		g += "<line class='gl' x1='" + x(f) + "' y1='6' x2='" + x(f) + "' y2='" + (H - 18) + "'/>"
			+ "<text x='" + (x(f) + 3) + "' y='" + (H - 6) + "'>"
			+ Math.round(f * 100) + "%</text>";
	});
	/* ---- ON A CARD, TWO LINES ---------------------------------------------------------------------
	   THE SPLIT ANSWERS A QUESTION THE CORRECTION HAS ALREADY ANSWERED. Covered against not-seen was
	   how the under-read was found; now the charges are scaled to match what the account actually
	   does, so what matters is whether the corrected forecast tracks the balance - and three extra
	   lines drawn from the uncorrected shares only obscure it. */
	var split3 = acc.kind !== "deferred";
	g += line(A, "lpast", opening);
	if(split3)g += line(AU, "lunc", seed.run.u) + line(AE, "lend", seed.run.e)
		+ line(AC, "lcov", seed.run.c);
	g += line(B, "lfwd", opening);
	g += "<text class='v' x='" + (W - 40) + "' y='" + (y(hi - pad) + 3) + "'>"
		+ money(hi - pad) + "</text>"
		+ "<text class='v' x='" + (W - 40) + "' y='" + (y(lo + pad) + 3) + "'>"
		+ money(lo + pad) + "</text>";

	var end = function(xs){ return xs.length ? xs[xs.length - 1].v : 0; };
	return {svg: "<svg viewBox='0 0 " + W + " " + H + "'>" + g + "</svg>",
		actual: end(A), predicted: end(B), covered: end(AC), uncovered: end(AU),
		ended: end(AE), ne: aEnd.length, sameMonth: !!bt, split3: split3,
		repaid: repaid.reduce(function(n, r){ return n + r.a; }, 0), nr: repaid.length,
		opening: opening,
		n: a.length, m: b.length, nc: aCov.length, nu: aUnc.length,
		spanA: spanA, spanB: spanB, A0: A0, A1: A1, B0: B0, B1: B1,
		rowsA: a, rowsB: b};
}

/* ---- THE ENTRIES ------------------------------------------------------------------------------ */
function table(acc){
	var rows = acc.rows.filter(function(r){
		return r.t >= D.asOf - 45 * DAY && r.t <= D.asOf + 45 * DAY;
	});
	var h = "<table><thead><tr><th>date</th><th>amount</th><th>what</th><th>stream</th>"
		+ "</tr></thead><tbody>";
	rows.forEach(function(r){
		var cls = (r.s ? "fwd" : "") + (!r.s && !r.c ? " gap" : "");
		h += "<tr class='" + cls + "'><td>" + day(r.t) + "</td>"
			+ "<td class='n " + (r.a < 0 ? "neg" : "pos") + "'>" + money(r.a) + "</td>"
			+ "<td class='w'>" + esc(r.w).slice(0, 44)
			+ (r.r ? "<span class='tag'>refused</span>" : "")
			+ (r.s ? "<span class='tag'>predicted</span>" : "") + "</td>"
			+ "<td class='w'>" + esc(r.n || "") + "</td></tr>";
	});
	return h + "</tbody></table>";
}

function draw(){
	var acc = D.accounts[pick];
	var sh = shapes(acc);
	var posted = acc.rows.filter(function(r){ return r.s === 0; });
	var gap = posted.filter(function(r){ return !r.c; });

	document.getElementById("sum").textContent =
		D.streams + " of " + D.reviewable + " streams in scope "
		+ String.fromCharCode(183) + " " + D.events + " events "
		+ String.fromCharCode(183) + " " + D.setAside + " card repayments set aside";

	var h = "<div class='card'>";
	h += "<h3>" + esc(acc.name) + " " + String.fromCharCode(183) + " " + acc.kind
		+ " " + String.fromCharCode(183) + " " + money(acc.anchor) + " on " + day(D.asOf)
		+ " " + String.fromCharCode(8594) + " " + money(acc.closing) + " on " + day(D.until)
		+ " " + String.fromCharCode(183) + " "
		+ posted.length + " posted then " + (acc.rows.length - posted.length) + " predicted"
		+ (acc.cal ? " " + String.fromCharCode(183) + " charges scaled x"
			+ acc.cal.multiplier.toFixed(2)
			+ (acc.cal.reason ? " (" + esc(acc.cal.reason) + ")" : "") : "")
		+ "</h3>";
	h += wide(acc);
	h += "<p class='legend'><i class='sw p'></i>posted <i class='sw f'></i>predicted "
		+ "<i class='sw d'></i>as of " + day(D.asOf)
		+ (acc.aside.length ? " " + String.fromCharCode(183) + " " + acc.aside.length
			+ " predicted repayments replaced by computed settlements" : "") + "</p>";
	h += "</div>";

	h += "<div class='two'>";
	h += "<div class='card'><h3>" + (sh.sameMonth
		? "forecast for this cycle against what actually happened in it"
		: "the cycle ahead, forecast from today") + ", repayments included</h3>"
		+ "<div class='step'>"
		+ "<button id='older'" + (back >= D.past.length ? " disabled" : "") + ">&lsaquo;</button>"
		+ "<span class='lab'>" + day(sh.A0) + " &ndash; " + day(sh.A1) + "</span>"
		+ "<button id='newer'" + (back === 0 ? " disabled" : "") + ">&rsaquo;</button>"
		+ "<span class='vs'>" + (sh.sameMonth
			? "same month both sides: forecast made " + day(sh.A0) + ", against what happened"
			: "the cycle ahead - forecast only, nothing has happened in it yet")
		+ "</span></div>"
		+ sh.svg
		+ "<p class='legend'>"
		+ "<i class='sw p'></i>actual " + money(sh.actual) + " / " + sh.n
		+ (sh.split3
			? " <i class='sw c'></i>carried by a predicting stream " + money(sh.covered)
				+ " / " + sh.nc
				+ " <i class='sw e'></i>stream is over, correctly silent " + money(sh.ended)
				+ " / " + sh.ne
				+ " <i class='sw u'></i>not seen at all " + money(sh.uncovered) + " / " + sh.nu
			: "")
		+ " <i class='sw f'></i>predicted " + money(sh.predicted) + " / " + sh.m + "</p>"
		+ "<p class='legend' style='margin-top:2px'>"
		+ (sh.split3
			? "each line is the balance that kind of spending would leave on its own - every "
				+ "repayment shared out across the charges it cleared - so the three sum to the "
				+ "solid line. "
			: "charges scaled to what this account actually spends, so the two lines are "
				+ "comparable balances. ")
		+ "Repayments " + money(sh.repaid) + " over " + sh.nr
		+ ". Opening balance " + money(sh.opening) + ".</p>"
		+ "<p class='legend' style='margin-top:2px'>" + day(sh.A0) + " to " + day(sh.A1)
		+ " against " + day(sh.B0) + " to " + day(sh.B1)
		+ " " + String.fromCharCode(183) + " " + sh.spanA + " and " + sh.spanB + " days"
		+ " " + String.fromCharCode(183) + " the gap worth reading is covered against predicted"
		+ "</p></div>";
	/* ---- STREAM BY STREAM, LAST CYCLE AGAINST NEXT --------------------------------------------
	   THE SURFACE IS THE AREA A STREAM ADDS TO ITS CURVE: an amount that lands early sits under the
	   line for longer than the same amount landing late, so amount times one-minus-position is
	   eye is actually comparing between the two shapes. Sorted by how much of the difference each
	   stream accounts for. */
	var surf = {};
	var take = function(rows, from, to, side){
		rows.forEach(function(r){
			var k = r.n || "UNCATEGORISED";
			surf[k] = surf[k] || {a: 0, b: 0, sa: 0, sb: 0, na: 0, nb: 0, cov: 0};
			//the money, which is what the columns show
			surf[k][side] += r.a;
			//and its surface, which is what the eye compares and what orders the table
			surf[k][side === "a" ? "sa" : "sb"] += r.a * (1 - (r.t - from) / (to - from));
			surf[k][side === "a" ? "na" : "nb"]++;
			if(side === "a" && r.c)surf[k].cov = 1;
		});
	};
	take(sh.rowsA, sh.A0, sh.A1, "a");
	take(sh.rowsB, sh.B0, sh.B1, "b");
	var list = Object.keys(surf).map(function(k){
		return {k: k, d: surf[k].b - surf[k].a, a: surf[k].a, b: surf[k].b,
			s: surf[k].sb - surf[k].sa,
			na: surf[k].na, nb: surf[k].nb, cov: surf[k].cov};
	}).sort(function(p, q){ return Math.abs(q.s) - Math.abs(p.s); });
	var gross = list.reduce(function(n, r){ return n + Math.abs(r.d); }, 0);

	/* THE COLUMNS ARE MONEY AND THE ORDER IS SURFACE. They were both surface, and a payment landing
	   three fifths of the way through a cycle showed as -$737 when it is -$1,800 - the area it adds
	   to the curve rather than the money that moves. The area is the right thing to RANK by, because
	   it is what separates the two lines on the chart; it is the wrong thing to print. */
	h += "<div class='card'><h3>stream by stream, ordered by how far apart the curves run</h3>"
		+ "<p class='legend' style='margin:0 0 6px'>gross difference " + money(gross)
		+ " " + String.fromCharCode(183) + " " + gap.length + " of " + posted.length
		+ " posted entries belong to no stream predicting onto this account</p>"
		+ "<div class='scroll'><table><thead><tr><th>stream</th><th>last</th><th>next</th>"
		+ "<th>delta</th><th>n</th></tr></thead><tbody>"
		+ list.slice(0, 26).map(function(r){
			return "<tr" + (r.nb ? "" : " class='gap'") + "><td class='w'>" + esc(r.k).slice(0, 30)
				+ (r.nb ? "" : "<span class='tag'>not predicted</span>") + "</td>"
				+ "<td class='n dim'>" + money(r.a) + "</td>"
				+ "<td class='n dim'>" + money(r.b) + "</td>"
				+ "<td class='n " + (r.d < 0 ? "neg" : "pos") + "'>" + money(r.d) + "</td>"
				+ "<td class='n dim'>" + r.na + "/" + r.nb + "</td></tr>";
		}).join("") + "</tbody></table></div></div>";
	h += "</div>";

	h += "<div class='card' style='margin-top:10px'><h3>entries, 45 days either side</h3>"
		+ "<div class='scroll'>" + table(acc) + "</div></div>";

	document.getElementById("panel").innerHTML = h;
	var all = document.querySelectorAll("button.tb");
	for(var i = 0; i < all.length; i++)all[i].classList.toggle("on", i === pick);

	var older = document.getElementById("older"), newer = document.getElementById("newer");
	if(older)older.addEventListener("click", function(){ back++; draw(); });
	if(newer)newer.addEventListener("click", function(){ if(back > 0){ back--; draw(); } });
}

document.getElementById("tabs").innerHTML = D.accounts.map(function(a, i){
	return "<button class='tb" + (i ? "" : " on") + "' data-i='" + i + "'>"
		+ esc(a.name).slice(0, 26) + "<i>" + a.kind + " " + String.fromCharCode(183) + " "
		+ a.rows.length + " entries</i></button>";
}).join("");
document.getElementById("tabs").addEventListener("click", function(ev){
	var b = ev.target.closest("button.tb");
	if(!b)return;
	pick = parseInt(b.getAttribute("data-i"), 10);
	back = 0;
	draw();
});
draw();
})();
`;

export default buildLedgerAuditPage;
