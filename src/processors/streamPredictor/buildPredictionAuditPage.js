/* ==================================================================================================
   THE §4 BENCH — A PREDICTION, WITH THE THREE CYCLES THAT ARGUE FOR IT.  PROTOTYPE.

   A PREDICTION WITHOUT ITS CONTEXT CANNOT BE CHECKED. "-$9.99 on the 27th" is either obviously right
   or obviously wrong depending on what the last three months did, and a reader cannot tell which
   from the claim alone. So every claim is drawn on the same axis as the three cycles before it: the
   past in full, then the one being promised, and the eye does the checking.

   ONE SECTION PER ACCOUNT, NOT PER STREAM. An account is where money actually arrives, and the two
   kinds settle differently - a card clears once a month whatever day the purchase happened, a
   current account moves the day the money does. Business Expenses is a card subscription and a bank
   reimbursement; one averaged forecast describes neither and lands on neither.

   A LUMP IS A MARK ON A DAY, A RATE IS A BAND ACROSS THE CYCLE. The two promises are drawn as two
   different things on purpose - a band has no position because the money it describes has no date,
   and drawing it as a mark would be a claim nobody is making.

   THE EMITTED SCRIPT CARRIES NO BACKSLASH AND NO BACKTICK - see buildFitAuditPage.js.
   ================================================================================================== */

import {renderAuditPage, esc, plain} from './auditShell';
import {predictionRows} from './modeAmounts';
import {Shape} from './shapeDetermination';

const DASH = '—';
const DOT = '·';
const YEARLY = {yearly: true, biyearly: true};

const money = n => (n === null || n === undefined) ? DASH
	: (n < 0 ? '-' : '+') + '$' + Math.abs(n).toFixed(Math.abs(n) >= 100 ? 0 : 2);
const iso = d => {
	const x = new Date(d);
	return x.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
		'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getUTCMonth()];
};

/* WHAT THE MODE PROMISES, in the vocabulary its shape uses. */
const patternOf = m => {
	if(m.shape !== Shape.lump)return 'a rate ' + DOT + ' no day';
	return m.days.map((d, i) => 'd' + d + (m.wobble[i] ? '±' + m.wobble[i] : ''))
		.join(' ' + DOT + ' ');
};

export function predictionData(predictor){
	const out = [];
	predictor.reviewable().forEach(stream => {
		const r = predictionRows(predictor, stream.id, stream);
		if(!r || !r.accounts.length)return;
		/* A STREAM STILL YEARLY AFTER §2 HAS NO LANES WORTH DRAWING - one cycle is the whole window,
		   so there is no "past three" and nothing to compare a claim against. */
		if(YEARLY[r.cycle.name])return;
		out.push({
			id: stream.id,
			name: stream.name,
			cycle: r.cycle.name,
			declared: r.declared,
			overridden: !!YEARLY[r.declared] && !YEARLY[r.cycle.name],
			accounts: r.accounts.map(a => ({
				accountId: a.accountId,
				accountType: a.accountType,
				name: a.name || null,
				mask: a.mask || null,
				modes: a.modes.map(m => ({
					label: plain(m.label),
					shape: m.shape,
					pattern: plain(patternOf(m)),
					amount: m.amount,
					kind: m.kind,
					confidence: m.confidence,
					moneyShare: m.moneyShare,
					direction: m.direction,
					legs: m.legs,
					quiet: m.quiet,
					landed: m.cyclesLanded
				})),
				lanes: a.lanes.map(l => ({
					from: iso(l.start),
					to: iso(l.end),
					days: l.days,
					predicted: !!l.predicted,
					rate: l.rate === undefined ? null : l.rate,
					rateModes: l.rateModes || 0,
					events: l.events.map(e => ({
						day: e.day, amount: e.amount, label: plain(e.label),
						wobble: e.wobble || 0
					}))
				}))
			}))
		});
	});
	return out.sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1));
}

/* THE SHELL BINDS ITS TICK BOXES ONCE AT LOAD, so every stream's frame is rendered here and only
   the lanes inside it are drawn by the script. */
const streamBlock = (r, i) => '<section class="stream" data-search="'
		+ esc([r.name, r.cycle, r.declared,
			r.accounts.map(a => a.modes.map(m => m.label).join(' ')).join(' ')]
			.join(' ').toLowerCase()) + '">'
	+ '<header class="sh-head">'
		+ '<div class="s-name"><b>' + esc(r.name) + '</b>'
			+ '<span class="s-meta">' + esc(r.cycle)
				+ (r.overridden ? ' <i>declared ' + esc(r.declared) + '</i>' : '')
				+ ' ' + DOT + ' ' + r.accounts.length + ' account'
				+ (r.accounts.length === 1 ? '' : 's') + '</span></div>'
		+ '<div class="s-ck"><input type="checkbox" class="okbox" data-sid="' + esc(r.id) + '"'
			+ ' aria-label="accept ' + esc(r.name) + '"></div>'
	+ '</header>'
	+ '<div class="acs" id="a' + i + '"></div>'
	+ '</section>';

export function buildPredictionAuditPage(predictor, meta){
	const m = meta || {};
	const data = predictionData(predictor);
	const accounts = data.reduce((n, r) => n + r.accounts.length, 0);
	const lumps = data.reduce((n, r) => n + r.accounts.reduce((k, a) =>
		k + a.modes.filter(x => x.kind === 'lump').length, 0), 0);

	const anchor = m.anchor ? new Date(m.anchor) : null;
	const anchorText = anchor ? anchor.toISOString().slice(0, 10) : DASH;

	return renderAuditPage({
		title: 'Stream predictions',
		phase: '§4·prototype',
		storageKey: 'kawa.audit.prediction.v1',
		capturedAt: m.capturedAt,
		versionTitle: m.version,
		extraCss: CSS,
		legendHtml: LEGEND,
		panelHtml: '<section class="wrap">' + data.map(streamBlock).join('') + '</section>',
		extraScript: wiring(data),
		metaLine: [
			{label: 'streams', value: data.length},
			{label: 'accounts', value: accounts},
			{label: 'dated claims', value: lumps},
			{label: 'anchor', value: anchorText}
		],
		groups: []
	});
}

/* ---- THE PAGE'S OWN SCRIPT ---------------------------------------------------------------------
   NO BACKSLASH, NO BACKTICK. The data blob is CONCATENATED rather than dropped in a template
   literal, so JSON's own escapes reach the browser intact. */
const wiring = data => 'var DATA = ' + JSON.stringify(data) + ';' + `
var DOTCH = "${DOT}";

function esc2(s){
	return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
function money(n){
	if(n === null || n === undefined)return "${DASH}";
	var a = Math.abs(n);
	return (n < 0 ? "-" : "+") + "$" + (a >= 100 ? Math.round(a) : a.toFixed(2));
}

/* EVERY LANE OF ONE ACCOUNT SHARES ONE SCALE, so a tall bar is a big movement and not a big cycle.
   The scale is the largest single movement anywhere in the account, past or promised. */
function scaleOf(acc){
	var top = 0, i, j, e;
	for(i = 0; i < acc.lanes.length; i++)
		for(j = 0; j < acc.lanes[i].events.length; j++){
			e = Math.abs(acc.lanes[i].events[j].amount);
			if(e > top)top = e;
		}
	return top || 1;
}

function laneHtml(lane, scale){
	var marks = "", i, e, left, h, cls;
	for(i = 0; i < lane.events.length; i++){
		e = lane.events[i];
		left = Math.max(0, Math.min(100, (e.day / lane.days) * 100));
		h = Math.max(9, Math.round((Math.abs(e.amount) / scale) * 26));
		cls = "mk" + (e.amount < 0 ? " out" : " in");
		marks = marks + "<span class='" + cls + "' style='left:" + left + "%;height:" + h + "px'"
			+ " title='" + esc2(e.label) + " " + DOTCH + " d" + e.day + " " + money(e.amount) + "'>"
			+ "<i>" + money(e.amount) + "</i></span>";
	}
	/* A RATE HAS NO POSITION, so it is the lane's own ground rather than a mark on it. */
	var band = (lane.predicted && lane.rate)
		? "<span class='band'><i>" + money(lane.rate) + " across the cycle"
			+ (lane.rateModes > 1 ? " " + DOTCH + " " + lane.rateModes + " modes" : "")
			+ "</i></span>"
		: "";
	return "<div class='lane" + (lane.predicted ? " next" : "") + "'>"
		+ "<div class='lb'>" + esc2(lane.from) + " " + DOTCH + " " + esc2(lane.to)
			+ (lane.predicted ? "<b>predicted</b>" : "") + "</div>"
		+ "<div class='track'>" + band + marks + "</div>"
		+ "</div>";
}

function modeHtml(m){
	return "<div class='md" + (m.kind === "lump" ? "" : " rate") + "'>"
		+ "<span class='mdsh'>" + (m.kind === "lump" ? "lump" : "rate") + "</span>"
		+ "<span class='mdpat'>" + esc2(m.pattern) + "</span>"
		+ "<b class='mdamt'>" + money(m.amount) + (m.kind === "lump" ? "" : " / cycle") + "</b>"
		+ "<span class='mdcf'>" + (m.confidence === null ? DOTCH
			: Math.round(m.confidence * 100) + "% sure") + "</span>"
		+ "<div class='mdwho'>" + esc2(m.label) + "<i>" + m.legs + " movements "
			+ DOTCH + " " + Math.round(m.moneyShare * 100) + "% of the stream"
			+ (m.quiet > 2 ? " " + DOTCH + " quiet " + m.quiet + " cycles" : "")
			+ "</i></div></div>";
}

function accountHtml(acc){
	var scale = scaleOf(acc), h = "", i;
	h = h + "<div class='ac " + (acc.accountType === "deferred" ? "def" : "rt") + "'>"
		+ "<div class='achead'><span class='ackind'>"
		+ (acc.accountType === "deferred" ? "deferred" : "real time") + "</span>"
		+ "<span class='acid'>" + esc2(acc.name || acc.accountId)
			+ (acc.mask ? " <b>••" + esc2(acc.mask) + "</b>" : "") + "</span>"
		+ "<span class='acnote'>"
		+ (acc.accountType === "deferred" ? "settles with the card"
			: "moves the day the money does") + "</span></div>";
	for(i = 0; i < acc.modes.length; i++)h = h + modeHtml(acc.modes[i]);
	h = h + "<div class='lanes'>";
	for(i = 0; i < acc.lanes.length; i++)h = h + laneHtml(acc.lanes[i], scale);
	return h + "</div></div>";
}

for(var s = 0; s < DATA.length; s++){
	var box = document.getElementById("a" + s), html = "", k;
	for(k = 0; k < DATA[s].accounts.length; k++)html = html + accountHtml(DATA[s].accounts[k]);
	box.innerHTML = html;
}

/* THE SHELL FILTERS THE CARDS INSIDE ITS GROUPS and this page has none, so the filtering is here. */
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
if(only)only.addEventListener("click", filterBlocks);
document.addEventListener("change", function(e){
	if(e.target && e.target.className && String(e.target.className).indexOf("okbox") >= 0)
		filterBlocks();
});
filterBlocks();
`;

const LEGEND = '<span class="lg">three cycles of what happened, then the one being promised, on one '
		+ 'axis and one scale</span>'
	+ '<span class="lg">a mark is a dated claim; a band is money with no date, spread across the '
		+ 'cycle</span>'
	+ '<span class="lg">one section per ACCOUNT - a card settles once a month, a current account '
		+ 'moves the day the money does</span>'
	+ '<details class="more"><summary>more</summary>'
		+ '<span class="lg">dN = the day of the cycle, day 0 being the seam</span>'
		+ '<span class="lg">a lump amount is the middle of the cycles it landed in, weighted by how '
			+ 'recent they are - a one-off does not move it</span>'
		+ '<span class="lg">a rate is the total over EVERY cycle of the stream, not only the ones it '
			+ 'moved in</span>'
		+ '<span class="lg">"declared yearly" = §2 read a shorter rhythm off the ledger and the '
			+ 'lanes are those cycles</span>'
	+ '</details>';

const CSS = `
.wrap{max-width:1000px;margin:0 auto;padding:8px 14px 28px}
.stream{border:1px solid var(--rule);border-radius:8px;background:var(--surface);
	padding:9px 11px;margin:0 0 10px}
.stream.done{opacity:.5}
.sh-head{display:grid;grid-template-columns:1fr 26px;gap:10px;align-items:center;
	padding-bottom:6px;border-bottom:1px dashed var(--rule)}
.s-name b{font:600 13.5px/1.3 var(--sans);color:var(--ink)}
.s-meta{display:block;font:400 10px/1.4 var(--mono);color:var(--ink-faint)}
.s-meta i{font-style:normal;color:var(--flag)}
.s-ck{text-align:right}
.s-ck .okbox{width:20px;height:20px;accent-color:var(--accent);margin:0}

.ac{margin-top:9px;padding-top:7px;border-top:1px solid var(--rule)}
.ac:first-child{border-top:0;padding-top:2px}
.achead{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;margin-bottom:5px;
	font:500 9px/1.3 var(--mono);text-transform:uppercase;letter-spacing:.05em}
.ac.rt .ackind{color:var(--realtime)}
.ac.def .ackind{color:var(--deferred)}
.acid{color:var(--ink-soft);text-transform:none;letter-spacing:0;word-break:break-word}
.acid b{color:var(--ink-faint);font-weight:400}
.acnote{color:var(--ink-faint);text-transform:none;letter-spacing:0;font-weight:400;
	margin-left:auto;white-space:nowrap}

.md{display:grid;grid-template-columns:42px 1fr auto auto;gap:2px 8px;align-items:baseline;
	grid-template-areas:"sh pat amt cf" "who who who who";
	padding:4px 0;border-bottom:1px solid var(--rule);font:400 11px/1.35 var(--mono)}
.md:last-of-type{border-bottom:0}
.mdsh{grid-area:sh;font-weight:600;color:var(--realtime)}
.md.rate .mdsh{color:var(--ink-faint);font-weight:400}
.mdpat{grid-area:pat;color:var(--ink-soft)}
.mdamt{grid-area:amt;font:600 12px/1 var(--mono);color:var(--ink);
	font-variant-numeric:tabular-nums;white-space:nowrap}
.mdcf{grid-area:cf;font-size:10px;color:var(--ink-faint);white-space:nowrap}
.mdwho{grid-area:who;color:var(--ink-soft);word-break:break-word}
.mdwho i{display:block;font-style:normal;font-size:9.5px;color:var(--ink-faint)}

.lanes{margin-top:8px}
.lane{margin-bottom:2px}
.lb{font:400 9px/1.3 var(--mono);color:var(--ink-faint);display:flex;gap:6px}
.lb b{color:var(--accent);font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.track{position:relative;height:34px;margin-top:2px;background:var(--sunk);border-radius:3px}
.lane.next .track{background:transparent;border:1px dashed var(--accent-soft)}
.mk{position:absolute;bottom:0;width:5px;margin-left:-2px;border-radius:2px 2px 0 0;
	background:var(--realtime)}
.mk.out{background:var(--deferred)}
.mk i{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);
	font:500 8.5px/1 var(--mono);color:var(--ink-soft);white-space:nowrap;padding-bottom:1px}
.lane.next .mk{opacity:.85}
.band{position:absolute;left:0;right:0;bottom:0;height:11px;border-radius:0 0 3px 3px;
	background:repeating-linear-gradient(135deg,var(--sunk),var(--sunk) 4px,
		transparent 4px,transparent 8px)}
.band i{position:absolute;left:4px;bottom:11px;font:400 8.5px/1.3 var(--mono);
	color:var(--ink-faint);font-style:normal;white-space:nowrap}

.lg{display:inline-flex;align-items:center;gap:4px;margin-right:11px}
.more{display:inline}
.more summary{display:inline;cursor:pointer;color:var(--accent);list-style:none}
.more summary::-webkit-details-marker{display:none}
.more[open] summary{display:block;margin-bottom:3px}

@media (max-width:760px){
	header.top{position:static}
	.wrap{padding:6px 10px 28px}
	.md{grid-template-columns:40px 1fr auto;grid-template-areas:"sh pat amt" "who who cf";gap:2px 7px}
	.mdcf{text-align:right}
	.track{height:30px}
	.mk i{font-size:8px}
}
`;

export default buildPredictionAuditPage;
