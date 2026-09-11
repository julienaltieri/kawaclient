/* ==================================================================================================
   THE §2 AUDIT PAGE - THE DECLARED CYCLE, PUT NEXT TO WHAT THE LEDGER ACTUALLY DID.

   §2's ANSWER IS NOT AUDITABLE ON ITS OWN. determineCycle reads the declaration and nothing else, so
   printing "declared monthly" tells the reader only what he already typed into the app. The question
   he can actually answer is whether monthly is TRUE of this stream, and that question needs the
   movements. So every card carries the declared answer AND the ledger's own behaviour under that
   declaration, and the two sit side by side.

   THE EVIDENCE IS PRODUCTION CODE, NOT A SECOND OPINION. The buckets come from cycleBuckets() in
   shapeDetermination.js - the same walk §3 and §4 bucket with - because a page that computed its own
   cycles with its own calendar arithmetic would audit the page rather than the predictor.

   NO SUGGESTION IS PRINTED AND NO DECLARATION IS CALLED WRONG. A "suggested cycle" computed here
   would be an inference of exactly the kind §2 exists to refuse, and the reader would end up
   validating the suggestion instead of the stream. The counts are shown; the judgement is his.

   THE PER-CYCLE LEG COUNTS ARE THE POINT. A monthly stream whose sequence reads 2 0 1 1 1 2 1 0 1 is
   monthly; one that reads 1 0 0 0 1 0 0 0 1 is quarterly wearing a monthly label, and no summary
   statistic shows that as fast as the run of zeros does.
   ================================================================================================== */

import {renderAuditPage, esc} from './auditShell';
import {determineCycle} from './cycleDetermination';
import {cycleBuckets} from './shapeDetermination';

/* MORE THAN HALF THE OBSERVED CYCLES EMPTY is where a declaration stops being a rhythm the ledger
   keeps and starts being a budget line the money visits occasionally. Half is a judgement call, so
   it is named here and printed in the page header: a threshold the reader can see is a threshold he
   can disagree with. */
export const EMPTY_CYCLE_THRESHOLD = 0.5;

const median = xs => {
	if(!xs || !xs.length)return null;
	const a = xs.slice().sort((x, y) => x - y), m = Math.floor(a.length / 2);
	return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

const day = d => {
	const t = d instanceof Date ? d : new Date(d);
	return isNaN(t.getTime()) ? '?' : t.toISOString().slice(0, 10);
};

const num = n => (n === null || n === undefined ? '—' : String(n));

/* THE ANCHOR IS A LOCAL MIDNIGHT, NOT AN INSTANT, so it is printed in local fields. `toISOString` on
   a local midnight east of Greenwich rolls back to the previous day and would print a seam one day
   off the one the walk actually used - the exact confusion this header exists to remove. */
const localDay = d => {
	const t = d instanceof Date ? d : new Date(d);
	if(isNaN(t.getTime()))return '?';
	const p = n => (n < 10 ? '0' + n : String(n));
	return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
};

/* THE ONE DERIVATION IN THE FILE. §2's own answer is copied through untouched; everything added to it
   is counting, on buckets the production walk produced.

   THE ANCHOR IS THE CALLER'S, NOT THIS FILE'S. The seams the reader is looking at have to be the
   seams §3 and §4 will use, so the page is handed StreamPredictor.analysisAnchor() and prints the
   date in its header - a run of zeros means nothing until you can see which lattice produced it. */
export function enrichCycles(rows, anchor){
	return (rows || []).map(r => {
		const stream = r.stream || {};
		const legs = (r.legs || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
		const cycle = determineCycle(stream);
		const buckets = cycleBuckets(legs, cycle.inferredCycle, anchor);
		const legsPerCycle = buckets.map(b => b.legs.length);
		const emptyCycles = legsPerCycle.filter(n => n === 0).length;
		const emptyShare = legsPerCycle.length ? emptyCycles / legsPerCycle.length : null;
		const sparse = !cycle.isYearly && legs.length > 0 && emptyShare !== null
			&& emptyShare > EMPTY_CYCLE_THRESHOLD;
		return {
			id: stream.id,
			name: stream.name,
			declaredPeriod: stream.period === undefined ? null : stream.period,
			periodName: cycle.periodName,
			cycleDetermination: cycle.cycleDetermination,
			isYearly: cycle.isYearly,
			cycleKnown: !!cycle.inferredCycle,
			legCount: legs.length,
			firstLeg: legs.length ? day(legs[0].date) : null,
			lastLeg: legs.length ? day(legs[legs.length - 1].date) : null,
			cyclesObserved: buckets.length,
			legsPerCycle: legsPerCycle,
			medianLegsPerCycle: median(legsPerCycle),
			emptyCycles: emptyCycles,
			emptyShare: emptyShare,
			group: cycle.isYearly ? 'yearly'
				: !legs.length ? 'nolegs'
				: sparse ? 'sparse' : 'matched'
		};
	});
}

/* ONE COUNTING FUNCTION, used by the page header and by the test's console line, so the two can
   never disagree about how many streams are mostly empty. */
export function summarizeCycles(enriched){
	const e = enriched || [];
	const inGroup = g => e.filter(r => r.group === g).length;
	return {
		total: e.length,
		yearly: inGroup('yearly'),
		sparse: inGroup('sparse'),
		matched: inGroup('matched'),
		nolegs: inGroup('nolegs'),
		totalLegs: e.reduce((s, r) => s + r.legCount, 0),
		fromLedger: e.filter(r => r.cycleDetermination !== 'declaration').length,
		unknownCycle: e.filter(r => !r.cycleKnown).length
	};
}

//most evidence first; name breaks ties so two runs of the same portfolio print the same order
const byEvidence = (a, b) => b.legCount - a.legCount
	|| (String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0);

const pctOf = share => (share === null ? '—' : (share * 100).toFixed(0) + '%');

const stat = (k, v) => '<span><span class="evk">' + esc(k) + '</span>'
	+ '<span class="num">' + esc(v) + '</span></span>';

/* OLDEST FIRST, MOST RECENT LAST - the reading order of a sentence, so the end of the line is the
   stream as it stands today. Only the empty cycles are marked: the zeros are what the reader is
   looking for and everything else is context for them. */
const sequence = counts => '<div class="seqwrap">'
	+ '<span class="seqlab">legs per cycle, oldest first</span>'
	+ '<div class="seq" title="one number per observed cycle, oldest on the left">'
	+ counts.map(n => (n === 0 ? '<span class="z">0</span>' : '<span>' + n + '</span>')).join('')
	+ '</div></div>';

const evidence = r => {
	if(!r.cycleKnown)return '<div class="nobody">declared period '
		+ (r.declaredPeriod === null ? 'missing' : esc(r.declaredPeriod) + ' is not a period')
		+ ' - no cycle to bucket the ledger with</div>';
	if(!r.legCount)return '<div class="nobody">no transactions - the declaration is the only '
		+ 'evidence there is</div>';
	return '<div class="ev">'
		+ stat('legs', r.legCount)
		+ stat('span', r.firstLeg + ' → ' + r.lastLeg)
		+ stat('cycles', r.cyclesObserved)
		+ stat('median/cycle', num(r.medianLegsPerCycle))
		+ stat('empty', r.emptyCycles + '/' + r.cyclesObserved + ' ' + pctOf(r.emptyShare))
		+ '</div>'
		+ sequence(r.legsPerCycle);
};

const streamCard = r => ({
	id: r.id,
	name: r.name,
	search: [r.name, r.id, r.periodName, r.cycleDetermination, r.group,
		r.isYearly ? 'yearly' : ''].join(' '),
	meta: [
		{cls: 'period', value: r.periodName === null ? 'no period' : r.periodName},
		{cls: 'chip', value: r.cycleDetermination},
		...(r.isYearly ? [{cls: 'chip warn', value: 'yearly special case'}] : []),
		{cls: 'legs', value: r.legCount, label: 'legs'},
		{cls: 'sid', value: r.id}
	],
	flagged: r.group === 'sparse',
	body: evidence(r)
});

const group = (key, title, list) =>
	({key: key, title: title, cards: list.slice().sort(byEvidence).map(streamCard)});

/* `rows` is exactly what StreamPredictor.mapAllAccounts() returned - §2 needs a stream's declaration
   and its legs, and both are already on that row. `meta` carries the fixture facts the header states.

   THE GROUP ORDER IS THE READING ORDER: the case the spec defers (yearly), then the case that is a
   real finding (mostly empty), then the ordinary case, then the class the reader has already
   accepted as correct-by-definition and does not need to look at again. */
export function buildCycleAuditPage(rows, meta){
	const m = meta || {};
	const enriched = enrichCycles(rows, m.anchor);
	const s = summarizeCycles(enriched);
	const of = g => enriched.filter(r => r.group === g);

	/* THE ANCHOR IS PRINTED BECAUSE IT DECIDES EVERY SEAM ON THE PAGE. The same 27 wage payments read
	   as four empty cycles on one lattice and none on another, so a reader shown the counts without
	   the date they were cut on is being shown an opinion he cannot check. */
	const metaLine = [
		{value: s.total, label: 'streams'},
		...(m.anchor ? [{value: localDay(m.anchor), label: 'cycle anchor'}] : []),
		{value: s.yearly, label: 'yearly', flag: true},
		{value: s.sparse, label: 'mostly empty >' + (EMPTY_CYCLE_THRESHOLD * 100).toFixed(0) + '%',
			flag: true},
		{value: s.matched, label: 'cycle carries'},
		{value: s.nolegs, label: 'no transactions'},
		{value: s.totalLegs, label: 'legs'}
	];

	return renderAuditPage({
		title: 'Cycle audit',
		phase: '§2',
		storageKey: 'kawa.audit.cycle.v1',
		metaLine: metaLine,
		capturedAt: String(m.capturedAt || '').slice(0, 10),
		versionTitle: String(m.version || '') + ' — captured ' + String(m.capturedAt || ''),
		groups: [
			group('yearly', 'Yearly — deferred to the yearly special case', of('yearly')),
			group('sparse', 'Mostly empty cycles', of('sparse')),
			group('matched', 'Cycle carries the movements', of('matched')),
			group('nolegs', 'No transactions', of('nolegs'))
		]
	});
}

export default buildCycleAuditPage;
