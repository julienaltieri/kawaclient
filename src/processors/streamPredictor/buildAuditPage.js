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

   THE PAGE ITSELF - the checkbox, the filter, the counter, the grouping and every line of CSS -
   lives in auditShell.js, because §1 through §4 are four readings of the same 87 streams and the
   tick that stopped responding had to be fixed once rather than four times. What stays here is only
   what §1 knows: what a partition is and which of them are worth looking at first.
   ================================================================================================== */

import {renderAuditPage, esc} from './auditShell';

/* A stream can be 98% of the money on a card and half the transactions on debit. Ten points is where
   that stops being rounding and starts being two different stories about the same stream. */
export const DIVERGENCE_THRESHOLD_POINTS = 10;

/* No share gate collapses a partition - a 0.1% allocation is a real leg and stays visible - but a
   single stray transaction should READ as a stray at a glance rather than as a home for the money. */
export const TAIL_THRESHOLD_PERCENT = 1;

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

const streamCard = r => ({
	id: r.id,
	name: r.name,
	search: [r.name, r.id, r.period]
		.concat(r.allocations.map(a => a.accountName || a.accountId))
		.join(' '),
	meta: [
		{cls: 'period', value: r.period === undefined || r.period === null ? 'no period' : r.period},
		{cls: 'legs', value: r.legCount, label: 'legs'},
		{cls: 'sid', value: r.id}
	],
	flagged: r.allocations.some(a => a.diverges),
	body: partitionTable(r)
});

const group = (key, title, list) =>
	({key: key, title: title, cards: list.slice().sort(byEvidence).map(streamCard)});

/* `rows` is exactly what StreamPredictor.mapAllAccounts() returned; `meta` carries the fixture facts
   the header states and the account list the hashes are resolved against. Nothing else is read. */
export function buildAuditPage(rows, meta){
	const m = meta || {};
	const enriched = enrich(rows, m.accountsByHash);
	const s = summarize(enriched);

	const metaLine = [
		{value: s.total, label: 'streams'},
		{value: s.totalLegs, label: 'legs'},
		{value: m.transactionCount, label: 'txns'},
		{value: s.divergentStreams, label: 'diverge >' + DIVERGENCE_THRESHOLD_POINTS + 'pts',
			flag: true, dim: s.divergentAllocations},
		{value: s.tailStreams, label: 'tail <' + TAIL_THRESHOLD_PERCENT + '%',
			dim: s.tailAllocations}
	];
	if(s.unknownAccountAllocations)
		metaLine.push({value: s.unknownAccountAllocations, label: 'unknown account', flag: true});

	return renderAuditPage({
		title: 'Account mapping',
		phase: '§1',
		storageKey: 'kawa.audit.accountMapping.v1',
		metaLine: metaLine,
		capturedAt: String(m.capturedAt || '').slice(0, 10),
		versionTitle: String(m.version || '') + ' — captured ' + String(m.capturedAt || ''),
		groups: [
			group('split', 'Split across accounts', enriched.filter(r => r.allocations.length > 1)),
			group('single', 'One account', enriched.filter(r => r.allocations.length === 1)),
			group('empty', 'No transactions', enriched.filter(r => r.allocations.length === 0))
		]
	});
}

export default buildAuditPage;
