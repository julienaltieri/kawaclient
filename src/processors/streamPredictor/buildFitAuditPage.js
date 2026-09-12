/* ==================================================================================================
   THE CYCLE-FIT AUDIT PAGE — a side quest off §2, and the missing piece of the yearly case.

   determineCycle reads the declaration and never looks at a transaction, which is right for a
   non-yearly stream and useless for a yearly one: the spec says a yearly stream's rhythm must be
   INFERRED. This page shows what inference would say, measured against 25 streams whose declared
   period is known-good, so the detector can be judged BEFORE it is pointed at the 44 yearly streams
   that have no ground truth at all.

   THE BARS ARE NOT NORMALISED, PER STREAM OR AT ALL. The bar height is the absolute misfit on a
   fixed 0..1 scale, so the best bar on a row is the best score actually available for that stream
   rather than the best of a bad set rescaled to look good. A stream nothing fits shows seven tall
   bars and must keep showing seven tall bars - that is the finding.

   MERGED AND SPLIT ARE BOTH RENDERED, never one chosen for the reader. Splitting a stream's legs by
   merchant turns Utilities into the two twelve-leg series it really is; whether that helps in
   general is the question this page exists to answer.
   ================================================================================================== */

import {renderAuditPage, esc} from './auditShell';
import {CANDIDATE_PERIODS, fitTable, bestFit, fitTableSplit, merchantGroups} from './cycleFit';

/* NOTHING FITS BELOW THIS AND THE PAGE SAYS SO RATHER THAN NAMING A WINNER. A stream whose best
   candidate is still this bad has no cycle to find, and printing the least-bad one as an answer
   would dress a coin flip as a measurement. */
export const WEAK_FIT_CUTOFF = 0.5;

const SHORT = {weekly: 'w', biweekly: 'b', semimonthly: 's', monthly: 'M',
	bimonthly: 'B', quarterly: 'q', yearly: 'y'};

const f3 = n => (n === null || n === undefined) ? '—' : n.toFixed(3);

/* ONE BAR PER CANDIDATE, height = misfit on a FIXED 0..1 scale. An unscorable candidate - too few
   legs or too few buckets to say anything - renders as an empty slot, which must not be mistakable
   for a misfit of zero: zero means "repeats exactly", and the two would otherwise look identical. */
const bars = (table, best, declared) => '<span class="bars">' + (table || []).map(c => {
	const un = c.misfit === null || c.misfit === undefined;
	const pctH = un ? 0 : Math.max(2, Math.round(Math.min(1, Math.max(0, c.misfit)) * 100));
	const cls = ['bar'];
	if(un)cls.push('un');
	if(best && c.period === best.period)cls.push('win');
	if(c.period === declared)cls.push('decl');
	return '<span class="' + cls.join(' ') + '" title="' + esc(c.period) + ' ' + f3(c.misfit) + '">'
		+ (un ? '<i class="none"></i>' : '<i style="height:' + pctH + '%"></i>')
		+ '</span>';
}).join('') + '</span>';

const verdict = (best, declared) => {
	if(!best)return '<span class="vd none">unscorable</span>';
	if(best.misfit >= WEAK_FIT_CUTOFF)
		return '<span class="vd weak">no fit · best ' + esc(best.period) + ' ' + f3(best.misfit) + '</span>';
	const ok = best.period === declared;
	return '<span class="vd ' + (ok ? 'ok' : 'bad') + '">' + esc(best.period) + ' ' + f3(best.misfit)
		+ (ok ? ' ✓' : ' ✗ declared ' + esc(declared)) + '</span>';
};

/* THE ROW IS TWO LINES BECAUSE THE COMPARISON IS THE POINT - merged against merchant-split - and
   they are the two the reader is asked to choose between.

   THE INITIALS SIT ABOVE THE PAIR, ONCE. Repeating them under both rows cost a line of vertical
   space each and said the same thing twice; the columns are the same seven in the same order on
   every row of the page, so naming them once at the top of the stream is enough. */
const scaleHead = declared => '<div class="frow head"><span class="flab"></span><span class="bars">'
	+ CANDIDATE_PERIODS.map(pd => '<span class="tick' + (pd === declared ? ' decl' : '') + '"'
		+ ' title="' + esc(pd) + '">' + esc(SHORT[pd]) + '</span>').join('')
	+ '</span></div>';

const body = r => '<div class="fit">' + scaleHead(r.declared)
	+ '<div class="frow"><span class="flab">merged</span>' + bars(r.merged, r.bestMerged, r.declared)
		+ verdict(r.bestMerged, r.declared) + '</div>'
	+ '<div class="frow"><span class="flab">split</span>' + bars(r.split, r.bestSplit, r.declared)
		+ verdict(r.bestSplit, r.declared)
		+ (r.groups.length > 1
			? '<span class="grp">' + r.groups.map(g => esc(g.key) + '×' + g.legs.length).join(' · ') + '</span>'
			: '<span class="grp one">one merchant</span>')
	+ '</div></div>';

/* EVERY NUMBER ON THE PAGE COMES FROM RUNNING THE REAL SCORER over the real legs. Nothing here
   recomputes, rounds early, or decides anything the detector did not decide. */
export function enrichFits(rows, anchor){
	return (rows || []).map(r => {
		const legs = r.legs || [];
		const merged = fitTable(legs, anchor);
		const sp = fitTableSplit(legs, anchor);
		const bestMerged = bestFit(merged);
		const bestSplit = bestFit(sp.table);
		const declared = r.stream.period;
		const weak = !bestMerged || bestMerged.misfit >= WEAK_FIT_CUTOFF;
		return {
			id: r.stream.id, name: r.stream.name, declared: declared, legCount: legs.length,
			merged: merged, split: sp.table, groups: merchantGroups(legs),
			bestMerged: bestMerged, bestSplit: bestSplit,
			agreeMerged: !!bestMerged && bestMerged.period === declared,
			agreeSplit: !!bestSplit && bestSplit.period === declared,
			group: weak ? 'weak' : (bestMerged.period === declared ? 'agree' : 'disagree')
		};
	});
}

export function summarizeFits(list){
	const e = list || [];
	return {
		total: e.length,
		agree: e.filter(r => r.group === 'agree').length,
		disagree: e.filter(r => r.group === 'disagree').length,
		weak: e.filter(r => r.group === 'weak').length,
		agreeMerged: e.filter(r => r.agreeMerged).length,
		agreeSplit: e.filter(r => r.agreeSplit).length,
		splitDiffers: e.filter(r => (r.bestMerged && r.bestMerged.period)
			!== (r.bestSplit && r.bestSplit.period)).length
	};
}

const byEvidence = (a, b) => b.legCount - a.legCount
	|| (String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0);

const card = r => ({
	id: r.id, name: r.name,
	search: [r.name, r.id, r.declared,
		r.bestMerged ? r.bestMerged.period : '', r.bestSplit ? r.bestSplit.period : '',
		r.group].join(' ').toLowerCase(),
	meta: [
		{cls: 'period', value: r.declared === null || r.declared === undefined ? 'no period' : r.declared},
		{cls: 'legs', value: r.legCount, label: 'legs'},
		{cls: 'sid', value: r.id}
	],
	flagged: r.group === 'disagree',
	body: body(r)
});

const group = (key, title, list) =>
	({key: key, title: title, cards: list.slice().sort(byEvidence).map(card)});

export function buildFitAuditPage(rows, meta){
	const m = meta || {};
	const list = enrichFits(rows, m.anchor);
	const s = summarizeFits(list);
	const of = k => list.filter(r => r.group === k);
	const anchor = m.anchor ? new Date(m.anchor) : null;
	const anchorText = anchor
		? anchor.getFullYear() + '-' + String(anchor.getMonth() + 1).padStart(2, '0')
			+ '-' + String(anchor.getDate()).padStart(2, '0')
		: '—';

	return renderAuditPage({
		title: 'Cycle fit',
		phase: '§2·detector',
		storageKey: 'kawa.audit.cyclefit.v1',
		capturedAt: m.capturedAt,
		versionTitle: m.version,
		extraCss: CSS,
		legendHtml: LEGEND,
		metaLine: [
			{label: 'cohort', value: s.total},
			{label: 'anchor', value: anchorText},
			{label: 'agree', value: s.agree},
			{label: 'disagree', value: s.disagree, flag: true},
			{label: 'no fit', value: s.weak, flag: true},
			{label: 'merged agrees', value: s.agreeMerged + '/' + s.total},
			{label: 'split agrees', value: s.agreeSplit + '/' + s.total},
			{label: 'merged≠split', value: s.splitDiffers}
		],
		groups: [
			group('disagree', 'Detected period differs from the declaration', of('disagree')),
			group('agree', 'Detected period matches the declaration', of('agree')),
			group('weak', 'Nothing fits — best candidate still above ' + WEAK_FIT_CUTOFF, of('weak'))
		]
	});
}

const LEGEND = '<span class="lg"><i class="sw win"></i>best fit</span>'
	+ '<span class="lg"><i class="sw decl"></i>declared period</span>'
	+ '<span class="lg"><i class="sw un"></i>not scorable</span>'
	+ '<span class="lg">taller bar = worse fit · 0 repeats exactly · 1 no structure</span>'
	+ '<span class="lg">scale is absolute, never rescaled per stream</span>'
	+ '<span class="lg">' + CANDIDATE_PERIODS.map(p => SHORT[p] + ' ' + p).join(' · ') + '</span>';

const CSS = `
.tick{width:15px;text-align:center;font:500 8.5px/1 var(--mono);color:var(--ink-faint);
	flex:0 0 15px}
.tick.decl{color:var(--flag);font-weight:600}
.frow.head{align-items:center;margin-bottom:1px}
.frow.head .bars{height:auto}
.lg{display:inline-flex;align-items:center;gap:4px;margin-right:11px;white-space:nowrap}
.sw{display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--sunk)}
.sw.win{background:var(--accent)}
.sw.decl{background:transparent;outline:1px solid var(--flag);outline-offset:1px}
.sw.un{background:repeating-linear-gradient(45deg,transparent,transparent 2px,
	var(--rule) 2px,var(--rule) 3px)}
.fit{display:flex;flex-direction:column;gap:3px;margin-top:2px}
.frow{display:flex;align-items:flex-end;gap:7px;min-width:0;flex-wrap:wrap}
.flab{font:500 9.5px/1 var(--mono);color:var(--ink-faint);text-transform:uppercase;
	letter-spacing:.06em;width:38px;flex:0 0 38px;padding-bottom:2px}
.bars{display:inline-flex;align-items:flex-end;gap:2px;height:26px;flex:0 0 auto}
.bar{position:relative;width:15px;height:26px;display:flex;flex-direction:column;
	justify-content:flex-end;align-items:center;background:var(--sunk);border-radius:2px}
.bar i{display:block;width:100%;background:var(--accent-soft);border-radius:2px 2px 0 0}
.bar i.none{height:100%;background:repeating-linear-gradient(45deg,transparent,transparent 2px,
	var(--rule) 2px,var(--rule) 3px)}
.bar.win i{background:var(--accent)}
.bar.decl{outline:1px solid var(--flag);outline-offset:1px}
.vd{font:500 11px/1 var(--mono);padding-bottom:2px}
.vd.ok{color:var(--realtime)}
.vd.bad{color:var(--flag)}
.vd.weak,.vd.none{color:var(--ink-faint)}
.grp{font:400 10px/1.3 var(--mono);color:var(--ink-faint);padding-bottom:2px;
	word-break:break-all;min-width:0}
.grp.one{opacity:.6}
`;

export default buildFitAuditPage;
