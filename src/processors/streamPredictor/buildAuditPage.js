/* ==================================================================================================
   THE §1 AUDIT PAGE. Every value it prints is a runtime result handed in by the test that ran the
   real predictor over the real portfolio; nothing here invents, rounds early, or summarises by hand.

   IT IS A GENERATOR, NOT A REPORT. The page's job is to let one person read 87 partitions and say
   which are wrong, so the shape of the output is decided by that reading: the exceptional case
   first, the most evidence first inside it, and the two derived signals marked ON the row that
   carries them rather than counted in a paragraph somewhere above.

   THE TWO THRESHOLDS ARE CONSTANTS AND THEY ARE PRINTED. A marked row whose rule is buried in the
   source is a row the reader cannot argue with; the header states the number, so disagreeing with
   the threshold is a thing the reader can do.
   ================================================================================================== */

/* A stream can be 98% of the money on a card and half the transactions on debit. Ten points is where
   that stops being rounding and starts being two different stories about the same stream. */
export const DIVERGENCE_THRESHOLD_POINTS = 10;

/* No share gate collapses a partition - a 0.1% allocation is a real leg and stays visible - but a
   single stray transaction should READ as a stray at a glance rather than as a home for the money. */
export const TAIL_THRESHOLD_PERCENT = 1;

const esc = s => String(s === null || s === undefined ? '' : s)
	.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const pct = n => (Number.isFinite(n) ? n.toFixed(1) : String(n));

/* THE ONLY DERIVATION IN THE FILE, and it is arithmetic on numbers the predictor produced. The
   account's NAME is looked up rather than restated: the hash is the identity, the name is a display
   fact that lives on the account record, and copying it into the partition would be a second copy. */
export function enrich(rows, accountsByHash){
	const byHash = accountsByHash || {};
	return (rows || []).map(r => {
		const stream = r.stream || {};
		const allocations = (r.partition || []).map(a => {
			const acc = byHash[a.accountId];
			const divergence = Math.abs(a.amountPercent - a.transactionPercent);
			return {
				accountId: a.accountId,
				accountName: acc ? acc.name : null,
				accountMask: acc ? acc.mask : null,
				known: !!acc,
				accountType: a.accountType,
				amountPercent: a.amountPercent,
				transactionPercent: a.transactionPercent,
				divergence: divergence,
				diverges: divergence > DIVERGENCE_THRESHOLD_POINTS,
				tail: a.amountPercent < TAIL_THRESHOLD_PERCENT
			};
		});
		return {
			id: stream.id,
			name: stream.name,
			period: stream.period,
			legCount: (r.legs || []).length,
			allocations: allocations
		};
	});
}

/* ONE COUNTING FUNCTION, used by the page header and by the test's console line, so the two can
   never disagree about how many streams split. */
export function summarize(enriched){
	const e = enriched || [];
	const streamsWith = f => e.filter(r => r.allocations.some(f)).length;
	const allocsWith = f => e.reduce((s, r) => s + r.allocations.filter(f).length, 0);
	return {
		total: e.length,
		split: e.filter(r => r.allocations.length > 1).length,
		single: e.filter(r => r.allocations.length === 1).length,
		empty: e.filter(r => r.allocations.length === 0).length,
		totalLegs: e.reduce((s, r) => s + r.legCount, 0),
		allocations: e.reduce((s, r) => s + r.allocations.length, 0),
		divergentStreams: streamsWith(a => a.diverges),
		divergentAllocations: allocsWith(a => a.diverges),
		tailStreams: streamsWith(a => a.tail),
		tailAllocations: allocsWith(a => a.tail),
		unknownAccountStreams: streamsWith(a => !a.known),
		unknownAccountAllocations: allocsWith(a => !a.known)
	};
}

//most evidence first; name breaks ties so two runs of the same portfolio print the same order
const byEvidence = (a, b) => b.legCount - a.legCount
	|| (String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0);

const chip = kind => kind === null || kind === undefined
	? '<span class="kind kind-unknown">unknown</span>'
	: '<span class="kind kind-' + esc(kind) + '">' + esc(kind) + '</span>';

/* THE MASK IS APPENDED ONLY WHEN THE NAME DOES NOT ALREADY CARRY IT. Some institutions put the
   mask in the account name itself ("Robinhood Credit Card **9869"), and appending ours to that
   prints the digits twice. Comparing on digits alone ignores whichever bullet or asterisk the
   institution chose to pad with. */
const nameCarriesMask = (name, mask) =>
	!!mask && String(name || '').replace(/\D/g, '').includes(String(mask).replace(/\D/g, ''));

const accountCell = a => {
	const showMask = a.accountMask && !nameCarriesMask(a.accountName, a.accountMask);
	const label = a.known
		? esc(a.accountName) + (showMask ? ' <span class="mask">••' + esc(a.accountMask) + '</span>' : '')
		: '<span class="missing">not in accounts</span>';
	return '<span class="acct" title="' + esc(a.accountId) + '">' + label + '</span>';
};

const bar = (value, cls) => '<span class="bar"><span class="bar-fill ' + cls
	+ '" style="width:' + Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)).toFixed(2)
	+ '%"></span></span>';

const allocationRow = a => {
	const cls = ['alloc'];
	if(a.diverges)cls.push('diverges');
	if(a.tail)cls.push('tail');
	return '<tr class="' + cls.join(' ') + '">'
		+ '<td class="c-acct">' + accountCell(a) + '</td>'
		+ '<td class="c-kind">' + chip(a.accountType) + '</td>'
		+ '<td class="c-num"><span class="num">' + pct(a.amountPercent) + '</span>' + bar(a.amountPercent, 'fill-amount') + '</td>'
		+ '<td class="c-num"><span class="num">' + pct(a.transactionPercent) + '</span>' + bar(a.transactionPercent, 'fill-txn') + '</td>'
		+ '<td class="c-flag">'
		+ (a.diverges ? '<span class="flag" title="amount % and transaction % differ by more than '
			+ DIVERGENCE_THRESHOLD_POINTS + ' points">Δ ' + pct(a.divergence) + '</span>' : '')
		+ (a.tail ? '<span class="tailmark" title="amount share below ' + TAIL_THRESHOLD_PERCENT + '%">tail</span>' : '')
		+ '</td></tr>';
};

const partitionTable = r => {
	if(!r.allocations.length)return '<div class="nopart">no transactions</div>';
	return '<div class="partwrap"><table class="part">'
		+ '<thead><tr><th class="c-acct">account</th><th class="c-kind">kind</th>'
		+ '<th class="c-num">amount %</th><th class="c-num">txn %</th><th class="c-flag"></th></tr></thead>'
		+ '<tbody>' + r.allocations.map(allocationRow).join('') + '</tbody></table></div>';
};

const streamCard = r => {
	const search = [r.name, r.id, r.period]
		.concat(r.allocations.map(a => a.accountName || a.accountId))
		.join(' ').toLowerCase();
	const flagged = r.allocations.some(a => a.diverges);
	return '<article class="stream' + (flagged ? ' has-diverge' : '') + '" data-search="' + esc(search) + '">'
		+ '<header class="sh">'
		+ '<h3 class="sname">' + esc(r.name) + '</h3>'
		+ '<span class="period">' + esc(r.period === undefined || r.period === null ? 'no period' : r.period) + '</span>'
		+ '<span class="legs"><span class="num">' + r.legCount + '</span> legs</span>'
		+ '<code class="sid">' + esc(r.id) + '</code>'
		+ '</header>'
		+ partitionTable(r) + '</article>';
};

const section = (key, title, list) => '<section class="group group-' + key + '" data-group="' + key + '">'
	+ '<h2><span class="gtitle">' + esc(title) + '</span>'
	+ '<span class="gcount"><span class="num shown">' + list.length + '</span>'
	+ '<span class="of" hidden> of <span class="num">' + list.length + '</span></span></span></h2>'
	+ '<div class="cards">' + list.slice().sort(byEvidence).map(streamCard).join('') + '</div>'
	+ '<p class="gempty" hidden>nothing matches the filter</p></section>';

const stat = (label, value, cls) => '<div class="stat' + (cls ? ' ' + cls : '') + '">'
	+ '<span class="sv num">' + esc(value) + '</span><span class="sl">' + esc(label) + '</span></div>';

/* `rows` is exactly what StreamPredictor.mapAllAccounts() returned; `meta` carries the fixture facts
   the header states and the account list the hashes are resolved against. Nothing else is read. */
export function buildAuditPage(rows, meta){
	const m = meta || {};
	const enriched = enrich(rows, m.accountsByHash);
	const s = summarize(enriched);

	const split = enriched.filter(r => r.allocations.length > 1);
	const single = enriched.filter(r => r.allocations.length === 1);
	const empty = enriched.filter(r => r.allocations.length === 0);

	return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Account mapping audit</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&amp;family=IBM+Plex+Sans:wght@400;500;600&amp;display=swap" rel="stylesheet">
<style>
:root{
	--paper:#F4F5F7; --surface:#FFFFFF; --sunk:#E9EBF0;
	--ink:#14171C; --ink-soft:#4A5160; --ink-faint:#79808F;
	--rule:#D4D8E0; --accent:#2E4A7D; --accent-soft:#5C7AB0;
	--flag:#8A6520; --flag-bg:#F6EDDA;
	--realtime:#3A6153; --realtime-bg:#E3ECE7;
	--deferred:#7A4A5E; --deferred-bg:#F3E6EA;
	--sans:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
	--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
	--paper:#131619; --surface:#1A1E24; --sunk:#22272F;
	--ink:#DFE3EA; --ink-soft:#A7AEBC; --ink-faint:#79808F;
	--rule:#2E343E; --accent:#9DB8E4; --accent-soft:#5C7AB0;
	--flag:#D2AC63; --flag-bg:#2B2418;
	--realtime:#8CB6A4; --realtime-bg:#1B2724;
	--deferred:#C99BAC; --deferred-bg:#2A1E23;
}}
:root[data-theme="dark"]{
	--paper:#131619; --surface:#1A1E24; --sunk:#22272F;
	--ink:#DFE3EA; --ink-soft:#A7AEBC; --ink-faint:#79808F;
	--rule:#2E343E; --accent:#9DB8E4; --accent-soft:#5C7AB0;
	--flag:#D2AC63; --flag-bg:#2B2418;
	--realtime:#8CB6A4; --realtime-bg:#1B2724;
	--deferred:#C99BAC; --deferred-bg:#2A1E23;
}
*{box-sizing:border-box}
[hidden]{display:none !important}
html{color-scheme:light dark}
body{margin:0;background:var(--paper);color:var(--ink);
	font:400 14px/1.45 var(--sans);-webkit-text-size-adjust:100%;overflow-x:hidden}
.num,code,.mask,.sid{font-family:var(--mono);font-variant-numeric:tabular-nums}

header.top{position:sticky;top:0;z-index:10;background:var(--surface);
	border-bottom:1px solid var(--rule);padding:10px 14px 12px}
h1{margin:0;font-size:15px;font-weight:600;letter-spacing:-.01em}
.meta{margin:3px 0 0;color:var(--ink-faint);font-size:11.5px;word-break:break-word}
.meta .num{color:var(--ink-soft)}
.stats{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.stat{background:var(--sunk);border:1px solid transparent;border-radius:5px;
	padding:5px 8px;display:flex;align-items:baseline;gap:6px;min-width:0}
.stat .sv{font-size:14px;font-weight:500;color:var(--ink)}
.stat .sl{font-size:10.5px;color:var(--ink-faint);letter-spacing:.02em}
.stat.k-flag{background:var(--flag-bg);border-color:var(--flag)}
.stat.k-flag .sv{color:var(--flag)}
.stat.k-tail .sv{color:var(--ink-faint)}
#q{margin-top:10px;width:100%;font:400 13px var(--sans);color:var(--ink);
	background:var(--paper);border:1px solid var(--rule);border-radius:6px;padding:7px 10px}
#q:focus{outline:2px solid var(--accent-soft);outline-offset:-1px;border-color:var(--accent-soft)}

main{padding:14px 14px 48px;max-width:1000px;margin:0 auto}
.group{margin:0 0 26px}
.group h2{display:flex;align-items:baseline;gap:8px;margin:0 0 8px;font-size:12px;
	font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-soft)}
.gcount{font-family:var(--mono);font-size:12px;color:var(--ink-faint)}
.gempty{margin:0;padding:10px 12px;color:var(--ink-faint);font-size:12px;
	border:1px dashed var(--rule);border-radius:6px}

.cards{border:1px solid var(--rule);border-radius:7px;overflow:hidden;background:var(--surface)}
.group-split .cards{box-shadow:0 1px 3px rgba(20,23,28,.10)}
.group-empty .cards{background:var(--sunk)}
.stream{padding:9px 12px 10px;border-top:1px solid var(--rule)}
.stream:first-child{border-top:0}
.sh{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 9px;margin-bottom:6px}
.sname{margin:0;font-size:13.5px;font-weight:600;letter-spacing:-.005em}
.period{font-size:10.5px;color:var(--ink-soft);background:var(--sunk);border-radius:4px;padding:1px 5px}
.legs{font-size:11px;color:var(--ink-faint)}
.legs .num{color:var(--ink-soft);font-size:11.5px}
.sid{font-size:10px;color:var(--ink-faint);margin-left:auto;word-break:break-all}

.partwrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
table.part{border-collapse:collapse;width:100%;min-width:430px}
.part th{font-size:9.5px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;
	color:var(--ink-faint);text-align:left;padding:0 8px 3px 0;border-bottom:1px solid var(--rule)}
.part th.c-num{text-align:right}
.part td{padding:5px 8px 5px 0;border-bottom:1px solid var(--rule);vertical-align:top}
.part tr:last-child td{border-bottom:0}
.c-num{text-align:right;width:88px}
.c-kind{width:76px}
.c-flag{width:88px;text-align:right}

.acct{font-size:12.5px;color:var(--ink)}
.mask{color:var(--ink-faint);font-size:11px}
.missing{color:var(--flag);font-style:italic}
.kind{display:inline-block;font-size:10px;padding:1px 5px;border-radius:4px;white-space:nowrap}
.kind-realTime{color:var(--realtime);background:var(--realtime-bg)}
.kind-deferred{color:var(--deferred);background:var(--deferred-bg)}
.kind-unknown{color:var(--ink-faint);background:var(--sunk)}
.c-num .num{display:block;font-size:12.5px;color:var(--ink)}
.bar{display:block;height:3px;margin-top:3px;background:var(--sunk);border-radius:2px;overflow:hidden}
.bar-fill{display:block;height:100%;border-radius:2px}
.fill-amount{background:var(--accent)}
.fill-txn{background:var(--accent-soft)}

.alloc.diverges{background:var(--flag-bg)}
.alloc.diverges td:first-child{box-shadow:inset 2px 0 0 var(--flag)}
.flag{display:inline-block;font-family:var(--mono);font-size:10.5px;color:var(--flag);
	border:1px solid var(--flag);border-radius:4px;padding:0 4px;white-space:nowrap}
.alloc.tail .acct,.alloc.tail .c-num .num{color:var(--ink-faint)}
.alloc.tail .kind{opacity:.6}
.alloc.tail td:first-child{box-shadow:inset 2px 0 0 var(--rule)}
.alloc.tail.diverges td:first-child{box-shadow:inset 2px 0 0 var(--flag)}
.tailmark{display:inline-block;font-family:var(--mono);font-size:10px;
	color:var(--ink-faint);margin-left:5px;letter-spacing:.04em}
.nopart{font-size:11.5px;color:var(--ink-faint)}

@media (max-width:520px){
	.sid{margin-left:0;width:100%}
	main{padding:12px 10px 40px}
	header.top{padding:9px 10px 10px}
}
</style>
</head><body>
<header class="top">
	<h1>Account mapping audit &mdash; &sect;1</h1>
	<p class="meta">fixture <span class="num">${esc(m.version)}</span>
		&middot; captured <span class="num">${esc(m.capturedAt)}</span>
		&middot; <span class="num">${esc(m.transactionCount)}</span> transactions
		&middot; <span class="num">${s.totalLegs}</span> legs
		&middot; <span class="num">${esc(m.accountCount)}</span> accounts
		&middot; divergence &gt; <span class="num">${DIVERGENCE_THRESHOLD_POINTS}</span> pts
		&middot; tail &lt; <span class="num">${TAIL_THRESHOLD_PERCENT}</span>%</p>
	<div class="stats">
		${stat('terminal streams', s.total)}
		${stat('split', s.split)}
		${stat('one account', s.single)}
		${stat('no transactions', s.empty)}
		${stat('divergent streams', s.divergentStreams, 'k-flag')}
		${stat('divergent allocations', s.divergentAllocations, 'k-flag')}
		${stat('streams with a tail', s.tailStreams, 'k-tail')}
		${stat('tail allocations', s.tailAllocations, 'k-tail')}
		${stat('unknown-account allocations', s.unknownAccountAllocations, 'k-flag')}
	</div>
	<input id="q" type="search" placeholder="filter by stream name, account name, id" autocomplete="off">
</header>
<main>
${section('split', 'Split across accounts', split)}
${section('single', 'One account', single)}
${section('empty', 'No transactions', empty)}
</main>
<script>
(function(){
	var q = document.getElementById('q');
	var groups = [].slice.call(document.querySelectorAll('.group')).map(function(g){
		return {cards: [].slice.call(g.querySelectorAll('.stream')),
			shown: g.querySelector('.shown'), of: g.querySelector('.of'),
			empty: g.querySelector('.gempty')};
	});
	function apply(){
		var t = q.value.trim().toLowerCase();
		groups.forEach(function(g){
			var n = 0;
			g.cards.forEach(function(c){
				var hit = !t || c.getAttribute('data-search').indexOf(t) !== -1;
				c.hidden = !hit;
				if(hit)n++;
			});
			g.shown.textContent = n;
			g.of.hidden = !t;
			g.empty.hidden = n !== 0;
		});
	}
	q.addEventListener('input', apply);
	apply();
})();
</script>
</body></html>`;
}

export default buildAuditPage;
