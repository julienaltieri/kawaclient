/* ==================================================================================================
   THE SHELL EVERY AUDIT PAGE IS PRINTED INTO. §1-§4 each answer a different question about the same
   87 streams, and every one of them is read the same way: filter, take the exceptional group first,
   tick what is right, hand back what is not.

   THERE IS EXACTLY ONE COPY OF THAT BEHAVIOUR AND THIS IS IT. The checkbox that stopped responding
   had to be fixed once; four pages each owning a copy of the tick, the filter and the counter is
   three pages that get the fix late or never. A phase supplies only what is phase-specific - its
   header stats, its groups, and the body of each card - and inherits the rest.

   THE EMITTED <script> CONTAINS NO BACKSLASH, and that is a rule about this file rather than a
   preference. The document below is a template literal, which eats one level of escaping: a "\n"
   written for the emitted script arrives in the browser as a real line break inside a quoted string,
   the page's JavaScript fails to parse, and NOTHING on the page works - while the markup stays
   well-formed and every markup assertion still passes. That shipped twice. Newlines and tabs the
   emitted script needs are built with String.fromCharCode, and no backtick appears anywhere inside
   the literal because a backtick would close it early.

   THE STORAGE KEY IS PER PHASE. §1's ticks are not §2's ticks, and one shared key would mark a
   cycle validated because its partition was.
   ================================================================================================== */

export const esc = s => String(s === null || s === undefined ? '' : s)
	.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* THE KEY GOES INTO A JAVASCRIPT STRING, NOT INTO MARKUP, so it is stripped rather than
   HTML-escaped - an &#39; inside a quoted script literal is not an apostrophe, it is six characters
   of garbage in the middle of a storage key. Phase keys are our own constants; anything outside this
   alphabet is a typo, not data. */
const safeKey = k => String(k || 'kawa.audit.v1').replace(/[^A-Za-z0-9._:-]/g, '');

//value first, then the label, so the eye runs down a column of numbers rather than reading sentences
const metaItem = it => ' &middot; <span class="num' + (it.flag ? ' f' : '') + '">'
	+ esc(it.value) + '</span> ' + esc(it.label)
	+ (it.dim === undefined || it.dim === null ? '' : ' <span class="dim">(' + esc(it.dim) + ')</span>');

const metaChip = m => '<span class="' + esc(m.cls || 'chip') + '">'
	+ (m.label
		? '<span class="num">' + esc(m.value) + '</span> ' + esc(m.label)
		: esc(m.value))
	+ '</span>';

/* THE TICK IS THE LAST ELEMENT IN THE HEADER ROW. The page is read on a phone held in one hand, and
   the right edge is the half of the screen a thumb reaches. The label around the input is tap area
   and nothing else - the control itself is a plain native checkbox, because a faked one (the input
   hidden at opacity 0 with a styled sibling standing in for it) is a thing that can stop responding,
   and this one did. */
const card = c => '<article class="stream' + (c.flagged ? ' flagged' : '')
	+ '" data-search="' + esc(String(c.search || '').toLowerCase()) + '">'
	+ '<header class="sh"><div class="shmeta">'
	+ '<h3 class="sname">' + esc(c.name) + '</h3>'
	+ (c.meta || []).map(metaChip).join('')
	+ '</div>'
	+ '<label class="oktap" title="mark this stream validated">'
	+ '<input type="checkbox" class="okbox" data-sid="' + esc(c.id) + '"'
	+ ' aria-label="mark this stream validated"></label>'
	+ '</header>'
	+ (c.body || '') + '</article>';

const section = g => '<section class="group group-' + esc(g.key) + '" data-group="' + esc(g.key) + '">'
	+ '<h2><span class="gtitle">' + esc(g.title) + '</span>'
	+ '<span class="gcount"><span class="num shown">' + g.cards.length + '</span>'
	+ '<span class="of" hidden> of <span class="num">' + g.cards.length + '</span></span></span></h2>'
	+ '<div class="cards">' + g.cards.map(card).join('') + '</div>'
	+ '<p class="gempty" hidden>nothing matches the filter</p></section>';

/* THE COMPLETE DOCUMENT. `opts` is the whole contract: title, phase, storageKey, metaLine, capturedAt,
   versionTitle, groups. A phase that needs a new control adds it HERE, once, for all four pages. */
export function renderAuditPage(opts){
	const o = opts || {};
	const groups = (o.groups || []).filter(g => g && g.cards);
	const total = groups.reduce((n, g) => n + g.cards.length, 0);
	const KEY = safeKey(o.storageKey);

	return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)} ${esc(o.phase)}</title>
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

/* THE HEADER IS ONE LINE, because the per-group counts it used to repeat are already printed on each
   group's own heading, and a second copy of them cost half a phone screen before the first stream
   was visible. What survives here is only what is stated nowhere else. */
header.top{position:sticky;top:0;z-index:10;background:var(--surface);
	border-bottom:1px solid var(--rule);padding:7px 14px 8px}
.meta{margin:0;color:var(--ink-faint);font-size:11.5px;line-height:1.5}
.meta b{color:var(--ink);font-weight:600;font-size:12.5px}
.meta .num{color:var(--ink-soft);font-weight:500}
.meta .num.f{color:var(--flag)}
.meta .dim{color:var(--ink-faint);opacity:.75}
.meta .cap{float:right;color:var(--ink-faint);font-family:var(--mono);font-size:10.5px;
	margin-left:8px;cursor:help}
.bar-row{display:flex;gap:6px;align-items:stretch;margin-top:7px}
.bar-row #q{margin-top:0;flex:1;min-width:0}
#only{font:500 11px var(--sans);color:var(--ink-soft);background:var(--paper);
	border:1px solid var(--rule);border-radius:6px;padding:0 9px;cursor:pointer;white-space:nowrap}
#only[aria-pressed="true"]{color:var(--surface);background:var(--accent);border-color:var(--accent)}
.prog{display:flex;align-items:center;font-family:var(--mono);font-size:11.5px;
	color:var(--ink-faint);white-space:nowrap;padding:0 2px}
.prog .num{color:var(--ink-soft)}
#copy{font:500 11px var(--sans);color:var(--ink-soft);background:var(--paper);
	border:1px solid var(--rule);border-radius:6px;padding:0 9px;cursor:pointer;white-space:nowrap}
#copy.done{color:var(--realtime);border-color:var(--realtime)}

/* THE TICK IS THE AUDIT'S OUTPUT, and it sits at the RIGHT end of the header row: the page is read
   on a phone held in one hand and the right edge is the half of the screen a thumb reaches.
   Unchecked is the resting state and carries no claim - a stream is not "wrong" until the reader
   says so by leaving it.

   IT IS A PLAIN NATIVE CHECKBOX. A faked one - the input hidden at opacity 0 with a styled sibling
   standing in for it - is a thing that can stop responding, and this one did. The label adds tap
   area only; nothing stands in for the control, so there is nothing here for the browser to get
   wrong. */
.oktap{flex:0 0 auto;margin-left:auto;display:inline-flex;align-items:center;justify-content:center;
	width:30px;height:30px;margin-top:-5px;margin-right:-6px;cursor:pointer;
	-webkit-tap-highlight-color:transparent}
.okbox{width:18px;height:18px;margin:0;cursor:pointer;accent-color:var(--realtime)}
.okbox:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.stream.done{background:var(--sunk)}
.stream.done .sname{color:var(--ink-soft)}

#q{margin-top:7px;width:100%;font:400 13px var(--sans);color:var(--ink);
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
.group-sparse .cards{box-shadow:0 1px 3px rgba(20,23,28,.10)}
.group-empty .cards{background:var(--sunk)}
.group-nolegs .cards{background:var(--sunk)}
.stream{padding:9px 12px 10px;border-top:1px solid var(--rule)}
.stream:first-child{border-top:0}
.sh{display:flex;align-items:flex-start;gap:6px 9px;margin-bottom:6px}
.shmeta{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 9px;flex:1 1 auto;min-width:0}
.sname{margin:0;font-size:13.5px;font-weight:600;letter-spacing:-.005em}
.period{font-size:10.5px;color:var(--ink-soft);background:var(--sunk);border-radius:4px;padding:1px 5px}
.chip{display:inline-block;font-size:10.5px;color:var(--ink-soft);background:var(--sunk);
	border-radius:4px;padding:1px 5px;white-space:nowrap}
.chip.warn{color:var(--flag);background:var(--flag-bg)}
.chip.calm{color:var(--realtime);background:var(--realtime-bg)}
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

/* THE PER-CYCLE SEQUENCE IS THE POINT OF §2's CARD, so it is the widest thing on it and the empty
   cycles are the only marked ones - a run of zeros is the finding, and it has to be visible from
   arm's length without counting. */
.ev{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 14px;font-size:11.5px;
	color:var(--ink-faint)}
.evk{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-faint);
	margin-right:5px}
.ev .num{color:var(--ink);font-size:12px}
.seqwrap{margin-top:7px}
.seqlab{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-faint)}
.seq{margin-top:3px;font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:12.5px;
	color:var(--ink);line-height:1.7;word-break:break-all}
.seq span{display:inline-block;min-width:15px;text-align:center;border-radius:3px}
.seq .z{color:var(--flag);background:var(--flag-bg)}
.nobody{font-size:11.5px;color:var(--ink-faint)}

@media (max-width:520px){
	.sid{margin-left:0;width:100%}
	main{padding:12px 10px 40px}
	header.top{padding:9px 10px 10px}
}
</style>
</head><body>
<header class="top">
	<p class="meta"><b>${esc(o.title)} ${esc(o.phase)}</b>${(o.metaLine || []).map(metaItem).join('')}
		<span class="cap" title="${esc(o.versionTitle)}">${esc(o.capturedAt)}</span></p>
	<div class="bar-row">
		<input id="q" type="search" placeholder="filter by stream name, account name, id" autocomplete="off">
		<button id="only" type="button" aria-pressed="false">unvalidated</button>
		<span id="prog" class="prog"><span class="num" id="pn">0</span>/<span class="num">${total}</span></span>
		<button id="copy" type="button" title="copy the streams still unticked">copy rejects</button>
	</div>
</header>
<main>
${groups.map(section).join('')}
</main>
<script>
(function(){
	/* ONE CLICK TOUCHES ONE CARD. The version before this re-asserted the checked state of all 87 boxes from
	   a shared object every time any one of them changed, so a single bad or stale entry anywhere
	   fought every subsequent click and the whole grid read as frozen. A change handler has no
	   business writing to controls the reader did not touch. */
	var KEY = '${KEY}';
	var q = document.getElementById('q');
	var only = document.getElementById('only');
	var pn = document.getElementById('pn');
	var copy = document.getElementById('copy');
	var boxes = [].slice.call(document.querySelectorAll('.okbox'));
	var groups = [].slice.call(document.querySelectorAll('.group')).map(function(g){
		return {cards: [].slice.call(g.querySelectorAll('.stream')),
			shown: g.querySelector('.shown'), of: g.querySelector('.of'),
			empty: g.querySelector('.gempty')};
	});

	function read(){
		try{
			var v = JSON.parse(localStorage.getItem(KEY) || '{}');
			return (v && typeof v === 'object') ? v : {};
		}catch(e){ return {}; }
	}
	function write(v){
		try{ localStorage.setItem(KEY, JSON.stringify(v)); }catch(e){}
	}

	function count(){
		var n = 0;
		for(var i = 0; i < boxes.length; i++)if(boxes[i].checked)n++;
		pn.textContent = n;
		return n;
	}

	function apply(){
		var t = q.value.trim().toLowerCase();
		var hideDone = only.getAttribute('aria-pressed') === 'true';
		groups.forEach(function(g){
			var n = 0;
			g.cards.forEach(function(c){
				var hit = (!t || c.getAttribute('data-search').indexOf(t) !== -1)
					&& !(hideDone && c.classList.contains('done'));
				c.hidden = !hit;
				if(hit)n++;
			});
			g.shown.textContent = n;
			g.of.hidden = !t && !hideDone;
			g.empty.hidden = n !== 0;
		});
	}

	//restore, once, at load. After this nothing writes to a checkbox except the reader.
	var saved = read();
	boxes.forEach(function(b){
		var card = b.closest('.stream');
		if(saved[b.getAttribute('data-sid')]){
			b.checked = true;
			if(card)card.classList.add('done');
		}
		b.addEventListener('change', function(){
			var v = read();
			var id = b.getAttribute('data-sid');
			if(b.checked)v[id] = true; else delete v[id];
			write(v);
			if(card)card.classList.toggle('done', b.checked);
			count();
			if(only.getAttribute('aria-pressed') === 'true')apply();
		});
	});
	count();

	only.addEventListener('click', function(){
		only.setAttribute('aria-pressed', only.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
		apply();
	});
	q.addEventListener('input', apply);

	/* THE UNTICKED STREAMS ARE THE RESULT OF THE AUDIT, so there is a button that hands them over as
	   text. Nothing here reaches a server, which is the point: the page keeps working when no viewer
	   is listening, and the reader decides when the verdicts leave the browser. */
	var NL = String.fromCharCode(10), TAB = String.fromCharCode(9);
	copy.addEventListener('click', function(){
		var lines = [];
		boxes.forEach(function(b){
			if(b.checked)return;
			var card = b.closest('.stream');
			if(!card)return;
			var name = card.querySelector('.sname');
			lines.push((name ? name.textContent : '?') + TAB + b.getAttribute('data-sid'));
		});
		var text = lines.length
			? 'unvalidated (' + lines.length + ' of ' + boxes.length + '):' + NL + lines.join(NL)
			: 'all ' + boxes.length + ' streams validated';
		var done = function(){
			copy.textContent = 'copied ' + lines.length;
			copy.classList.add('done');
			setTimeout(function(){ copy.textContent = 'copy rejects'; copy.classList.remove('done'); }, 2000);
		};
		if(navigator.clipboard && navigator.clipboard.writeText){
			navigator.clipboard.writeText(text).then(done, function(){ window.prompt('unvalidated streams', text); });
		}else{
			window.prompt('unvalidated streams', text);
		}
	});

	apply();
})();
</script>
</body></html>`;
}

export default renderAuditPage;
