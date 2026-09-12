/* ==================================================================================================
   §1 OF THE STREAM PREDICTOR, RUN AGAINST THE USER'S OWN LEDGER.

   TWO JOBS, AND THEY ARE THE SAME JOB. The assertions below are the invariants a partition must hold
   whatever the data says - each percentage sums to 100, nothing is NaN, the leg count reconciles with
   the ledger it was flattened from. The page written afterwards is those same runtime results,
   printed. Nothing on it is composed by hand, so if the code produces something odd the page shows
   the odd thing rather than a description of it.

   A MISSING ACCOUNT IS REPORTED, NOT FAILED. `mapAccounts` deliberately keeps a leg whose account is
   not in the account list, typed `null`. Asserting it away would delete the finding: the ledger and
   the account list disagreeing is exactly what an audit is for.

   THE FIXTURE IS THE USER'S REAL LEDGER AND IS GITIGNORED, so a machine without it must SKIP rather
   than fail - the suite has to stay green for anyone who has never captured a portfolio. Same reason
   the generated page is gitignored: it embeds every account name and partition in that ledger.
   ================================================================================================== */

import fs from 'fs';
import path from 'path';
import {buildAuditPage, enrich, summarize, DIVERGENCE_THRESHOLD_POINTS, TAIL_THRESHOLD_PERCENT}
	from './buildAuditPage';
import {buildCycleAuditPage, enrichCycles, summarizeCycles, EMPTY_CYCLE_THRESHOLD}
	from './buildCycleAuditPage';
import {determineCycle} from './cycleDetermination';
import {buildFitAuditPage, enrichFits, summarizeFits, WEAK_FIT_CUTOFF} from './buildFitAuditPage';
import {cycleBuckets} from './shapeDetermination';

const FIXTURE = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');
const OUT = path.join(__dirname, 'audit-account-mapping.html');
const OUT_CYCLE = path.join(__dirname, 'audit-cycle.html');
const OUT_FIT = path.join(__dirname, 'audit-cycle-fit.html');
const HAS_FIXTURE = fs.existsSync(FIXTURE);

//`describe.skip` rather than a failing require, so the suite passes on a machine with no capture
const suite = HAS_FIXTURE ? describe : describe.skip;

suite('StreamPredictor §1 - account mapping, against the captured portfolio', () => {
	let portfolio, predictor, rows, enriched, summary;

	beforeAll(() => {
		// eslint-disable-next-line global-require
		const {StreamPredictor} = require('./index');
		portfolio = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
		predictor = new StreamPredictor(portfolio);
		rows = predictor.mapAllAccounts();
		enriched = enrich(rows, predictor.accountsByHash);
		summary = summarize(enriched);
	});

	test('the walk reaches 87 terminal streams and maps every one of them', () => {
		expect(predictor.terminalStreams().length).toBe(87);
		expect(rows.length).toBe(87);
	});

	/* PINNED TO THE CAPTURE, NOT LEFT AS A SHAPE ASSERTION. §1 does not bucket anything, so nothing
	   downstream of it - the cycle anchor least of all - can move these five numbers. If one of them
	   drifts, a change meant for §2-§4 has leaked upstream into the mapping, and that is exactly the
	   failure a green suite would otherwise hide. */
	test('the §1 numbers are the captured ones: 87 / 32 split / 29 single / 26 empty / 1392 legs', () => {
		expect(summary.total).toBe(87);
		expect(summary.split).toBe(32);
		expect(summary.single).toBe(29);
		expect(summary.empty).toBe(26);
		expect(summary.totalLegs).toBe(1392);
	});

	/* ONE LEG PER (transaction, allocation) PAIR is the flattening `streamLedger` documents, so the
	   legs the 87 partitions were built from must account for every allocation in the ledger and no
	   more. A leg count that drifts from this is a stream silently dropped or double-counted. */
	test('total legs equal the total streamAllocation entries in the ledger', () => {
		const allocationsInLedger = portfolio.transactions.reduce(
			(n, t) => n + (t.streamAllocation || []).filter(a => a && a.streamId).length, 0);
		const legsInLedger = [...predictor.ledger().values()].reduce((n, l) => n + l.length, 0);
		expect(legsInLedger).toBe(allocationsInLedger);
		//terminal streams hold all of them only if no allocation names a compound; report either way
		const legsOnTerminals = rows.reduce((n, r) => n + r.legs.length, 0);
		if(legsOnTerminals !== allocationsInLedger){
			console.log('LEGS ON TERMINAL STREAMS ' + legsOnTerminals
				+ ' vs ALLOCATIONS IN LEDGER ' + allocationsInLedger
				+ ' - ' + (allocationsInLedger - legsOnTerminals) + ' allocation(s) name a non-terminal '
				+ 'or unknown stream');
		}
		expect(legsOnTerminals).toBe(allocationsInLedger);
	});

	test('every non-empty partition is a partition: both percentages sum to 100', () => {
		rows.forEach(r => {
			if(!r.partition.length)return;
			const amount = r.partition.reduce((s, a) => s + a.amountPercent, 0);
			const txn = r.partition.reduce((s, a) => s + a.transactionPercent, 0);
			expect(amount).toBeCloseTo(100, 3);
			expect(txn).toBeCloseTo(100, 3);
		});
	});

	test('no NaN anywhere in any partition', () => {
		rows.forEach(r => r.partition.forEach(a => {
			expect(Number.isNaN(a.amountPercent)).toBe(false);
			expect(Number.isNaN(a.transactionPercent)).toBe(false);
			expect(Number.isFinite(a.amountPercent)).toBe(true);
			expect(Number.isFinite(a.transactionPercent)).toBe(true);
		}));
	});

	/* REPORTED, NOT ASSERTED - see the header. The count still lands on the page. */
	test('accounts named by partitions are reported against the account list', () => {
		const missing = [];
		rows.forEach(r => r.partition.forEach(a => {
			if(!predictor.accountsByHash[a.accountId])missing.push(r.stream.name + ' -> ' + a.accountId);
		}));
		if(missing.length)console.log('ACCOUNTS IN LEDGER BUT NOT IN portfolio.accounts:\n  '
			+ missing.join('\n  '));
		else console.log('ACCOUNT COVERAGE: every accountId in every partition is in portfolio.accounts');
		expect(Array.isArray(missing)).toBe(true);
	});

	test('writes the audit page from the real results', () => {
		const html = buildAuditPage(rows, {
			version: portfolio.version,
			capturedAt: portfolio.capturedAt,
			transactionCount: portfolio.transactions.length,
			accountCount: portfolio.accounts.length,
			accountsByHash: predictor.accountsByHash
		});
		fs.writeFileSync(OUT, html, 'utf8');

		expect(html.startsWith('<!doctype html>')).toBe(true);
		expect(html.trim().endsWith('</html>')).toBe(true);
		expect(fs.statSync(OUT).size).toBeGreaterThan(20000);

		/* THE PAGE'S OWN JAVASCRIPT MUST PARSE, and this is the assertion that was missing when a
		   broken page shipped twice. The generator writes that script from inside a template
		   literal, which silently eats one level of backslash: a "\n" meant for the emitted string
		   arrives as a real line break and every checkbox on the page stops working, while the
		   markup stays perfectly well-formed and every other assertion here still passes. */
		const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
		expect(scripts.length).toBeGreaterThan(0);
		scripts.forEach(block => {
			const src = block.replace(/^<script>/, '').replace(/<\/script>$/, '');
			expect(() => new Function(src)).not.toThrow();
		});

		console.log('§1 ACCOUNT MAPPING: ' + summary.total + ' terminal streams | '
			+ summary.split + ' split across 2+ accounts | ' + summary.single + ' single-account | '
			+ summary.empty + ' with zero transactions | ' + summary.totalLegs + ' legs | '
			+ summary.divergentStreams + ' streams diverging >' + DIVERGENCE_THRESHOLD_POINTS + 'pts ('
			+ summary.divergentAllocations + ' allocations) | ' + summary.tailStreams
			+ ' streams with a tail <' + TAIL_THRESHOLD_PERCENT + '% (' + summary.tailAllocations
			+ ' allocations) | ' + summary.unknownAccountAllocations + ' unknown-account allocations');
		console.log('AUDIT PAGE: ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes)');
	});
});

/* ==================================================================================================
   §2, RUN OVER THE SAME 87 STREAMS.

   THE RULE UNDER TEST IS THAT THERE IS NO INFERENCE. determineCycle takes no transactions, so every
   stream must come back sourced from its declaration; a 'ledger' answer would mean the stage had
   grown an opinion nobody specified, and the assertion is written to FAIL on that rather than to
   tolerate it.

   THE PAGE IS WHERE THE REAL QUESTION LIVES. Whether a declaration is TRUE is not something an
   assertion can decide - it needs the ledger next to it and a person reading both - so the test
   asserts the invariants and prints the evidence.
   ================================================================================================== */
const YEARLY_DECLARATIONS = {yearly: true, biyearly: true};

suite('StreamPredictor §2 - cycle determination, against the captured portfolio', () => {
	let portfolio, predictor, rows, streams, cycles, enriched, summary, anchor;

	beforeAll(() => {
		// eslint-disable-next-line global-require
		const {StreamPredictor} = require('./index');
		portfolio = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
		predictor = new StreamPredictor(portfolio);
		rows = predictor.mapAllAccounts();
		streams = predictor.terminalStreams();
		cycles = streams.map(s => ({stream: s, cycle: determineCycle(s)}));
		anchor = predictor.analysisAnchor();
		enriched = enrichCycles(rows, anchor);
		summary = summarizeCycles(enriched);
	});

	/* THE SEAM IS A DATE, SO IT IS ASSERTED AS A DATE. The capture says today is 2026-09-09 and
	   carries no reportingStartingDay, so the analysis root is December 21st of the year before -
	   the same date ReportingCore's getAnalysisRootDate would produce from the same config.

	   CHECKED IN LOCAL FIELDS, NOT AS AN ISO STRING: the anchor is a local midnight, and east of
	   Greenwich its ISO form reads as the 20th. */
	test('the analysis anchor is 2025-12-21, the analysis root date for the captured instant', () => {
		expect(anchor instanceof Date).toBe(true);
		expect(anchor.getFullYear()).toBe(2025);
		expect(anchor.getMonth()).toBe(11);
		expect(anchor.getDate()).toBe(21);
		//memoised: the same instant every time, so two stages cannot be handed two different seams
		expect(predictor.analysisAnchor().getTime()).toBe(anchor.getTime());
	});

	/* THE BUCKETS STILL PARTITION THE LEGS. Re-phasing the lattice on the anchor moves every seam, and
	   the one thing that must survive the move is that the buckets are contiguous and cover the legs:
	   a leg that falls through a crack is a movement the shape and the amount never see. Asserted
	   stream by stream and then in total, over all 87. */
	test('every leg lands in exactly one bucket, for every stream', () => {
		let totalLegs = 0, totalBucketed = 0;
		const lost = [];
		rows.forEach(r => {
			const cycle = determineCycle(r.stream || {}).inferredCycle;
			if(!cycle)return;
			const legs = r.legs || [];
			const buckets = cycleBuckets(legs, cycle, anchor);
			const bucketed = buckets.reduce((n, b) => n + b.legs.length, 0);
			totalLegs += legs.length;
			totalBucketed += bucketed;
			if(bucketed !== legs.length)lost.push(r.stream.name + ': ' + bucketed + '/' + legs.length);
			//contiguous and strictly increasing, or "exactly one" is an accident rather than a property
			for(let i = 1; i < buckets.length; i++)
				expect(buckets[i].start.getTime()).toBe(buckets[i-1].end.getTime());
			buckets.forEach(b => expect(b.end.getTime()).toBeGreaterThan(b.start.getTime()));
		});
		if(lost.length)console.log('LEGS OUTSIDE EVERY BUCKET:\n  ' + lost.join('\n  '));
		expect(lost).toEqual([]);
		expect(totalBucketed).toBe(totalLegs);
	});

	test('every one of the 87 terminal streams gets a period name', () => {
		expect(streams.length).toBe(87);
		const nameless = cycles.filter(c => c.cycle.periodName === null).map(c => c.stream.name);
		if(nameless.length)console.log('STREAMS WITH NO DECLARED PERIOD: ' + nameless.join(', '));
		expect(nameless).toEqual([]);
	});

	/* THE DECLARATION WINS OUTRIGHT AND THE LEDGER IS NOT CONSULTED. Loosening this to "usually
	   declaration" would delete the only thing §2 currently promises. */
	test('every cycle is sourced from the declaration, never from the ledger', () => {
		const inferred = cycles.filter(c => c.cycle.cycleDetermination !== 'declaration')
			.map(c => c.stream.name + ' -> ' + c.cycle.cycleDetermination);
		if(inferred.length)console.log('CYCLES NOT SOURCED FROM THE DECLARATION:\n  ' + inferred.join('\n  '));
		expect(inferred).toEqual([]);
	});

	test('isYearly is true exactly for the streams declaring yearly or biyearly', () => {
		const disagree = cycles.filter(c => c.cycle.isYearly !== !!YEARLY_DECLARATIONS[c.stream.period])
			.map(c => c.stream.name + ' declared ' + c.stream.period + ' but isYearly='
				+ c.cycle.isYearly);
		if(disagree.length)console.log('isYearly DISAGREES WITH THE DECLARATION:\n  ' + disagree.join('\n  '));
		expect(disagree).toEqual([]);
		expect(cycles.filter(c => c.cycle.isYearly).length)
			.toBe(streams.filter(s => YEARLY_DECLARATIONS[s.period]).length);
	});

	test('writes the cycle audit page from the real results', () => {
		const html = buildCycleAuditPage(rows, {
			version: portfolio.version,
			capturedAt: portfolio.capturedAt,
			transactionCount: portfolio.transactions.length,
			anchor: anchor
		});
		fs.writeFileSync(OUT_CYCLE, html, 'utf8');

		expect(html.startsWith('<!doctype html>')).toBe(true);
		expect(html.trim().endsWith('</html>')).toBe(true);
		expect(fs.statSync(OUT_CYCLE).size).toBeGreaterThan(20000);
		//the seam the page's every count was cut on is stated on the page
		expect(html).toContain('2025-12-21</span> cycle anchor');

		/* SAME ASSERTION AS §1's, AND FOR THE SAME REASON. The shell writes its script from inside a
		   template literal, which silently eats one level of backslash: a "\n" meant for the emitted
		   string arrives as a real line break, every checkbox on the page stops working, and the
		   markup stays perfectly well-formed while every other assertion here still passes. */
		const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
		expect(scripts.length).toBeGreaterThan(0);
		scripts.forEach(block => {
			const src = block.replace(/^<script>/, '').replace(/<\/script>$/, '');
			expect(() => new Function(src)).not.toThrow();
		});

		//every stream lands in exactly one group, so the four counts must still add up to 87
		expect(summary.yearly + summary.sparse + summary.matched + summary.nolegs)
			.toBe(summary.total);

		console.log('§2 CYCLE ANCHOR: ' + anchor.toString());
		console.log('§2 CYCLE DETERMINATION: ' + summary.total + ' terminal streams | '
			+ summary.yearly + ' yearly (deferred) | ' + summary.sparse + ' mostly-empty cycles (>'
			+ (EMPTY_CYCLE_THRESHOLD * 100).toFixed(0) + '% empty) | ' + summary.matched
			+ ' cycle carries the movements | ' + summary.nolegs + ' with zero transactions | '
			+ summary.totalLegs + ' legs | ' + summary.fromLedger + ' sourced from the ledger | '
			+ summary.unknownCycle + ' with an unrecognised period');
		console.log('CYCLE AUDIT PAGE: ' + OUT_CYCLE + ' (' + fs.statSync(OUT_CYCLE).size + ' bytes)');
	});
});

/* ==================================================================================================
   THE CYCLE-FIT DETECTOR, MEASURED BEFORE IT IS BELIEVED.

   The cohort is the 25 streams that are open, non-yearly and carry transactions: their declared
   period has been validated by hand, so it is the only ground truth this detector will ever get.
   The 44 yearly streams it is ultimately FOR have none, which is exactly why the number below has
   to be taken here first.

   THE AGREEMENT RATE IS REPORTED, NOT ASSERTED. Locking a threshold in would turn a measurement
   into a rule and hide the next regression behind a passing test; the console line is the result,
   and a human reads it. What IS asserted is that the scorer stays in range and that Utilities -
   the case the whole design turns on - resolves to monthly rather than semimonthly.
   ================================================================================================== */
suite('StreamPredictor cycle fit - the detector, against known-good declarations', () => {
	let portfolio, predictor, rows, list, summary;

	beforeAll(() => {
		// eslint-disable-next-line global-require
		const {StreamPredictor} = require('./index');
		portfolio = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
		predictor = new StreamPredictor(portfolio);
		rows = predictor.mapFitCohort();
		list = enrichFits(rows, predictor.analysisAnchor());
		summary = summarizeFits(list);
	});

	test('the cohort is the 25 open, non-yearly streams that carry transactions', () => {
		expect(predictor.terminalStreams().length).toBe(87);
		expect(predictor.reviewable().length).toBe(64);
		expect(rows.length).toBe(25);
		const byPeriod = {};
		rows.forEach(r => { byPeriod[r.stream.period] = (byPeriod[r.stream.period] || 0) + 1; });
		expect(byPeriod).toEqual({monthly: 23, semimonthly: 1, weekly: 1});
	});

	test('every misfit is null or inside [0,1] - no NaN, nothing out of range', () => {
		list.forEach(r => [...r.merged, ...r.split].forEach(c => {
			if(c.misfit === null || c.misfit === undefined)return;
			expect(Number.isFinite(c.misfit)).toBe(true);
			expect(c.misfit).toBeGreaterThanOrEqual(0);
			expect(c.misfit).toBeLessThanOrEqual(1);
		}));
	});

	/* THE CASE THE DESIGN TURNS ON. Utilities' 24 legs all land on days 1-6 of the month, so folding
	   on semimonthly leaves every other bucket empty - two lumps early in one cycle, not one lump per
	   half-cycle. A scorer that rewards a single tight peak picks semimonthly and is wrong. */
	test('Utilities resolves to monthly, not semimonthly', () => {
		const u = list.find(r => /^utilities$/i.test(r.name || ''));
		expect(u).toBeTruthy();
		expect(u.bestMerged.period).toBe('monthly');
		const semi = u.merged.find(c => c.period === 'semimonthly');
		expect(u.bestMerged.misfit).toBeLessThan(semi.misfit);
	});

	test('writes the fit audit page from the real results', () => {
		const html = buildFitAuditPage(rows, {
			version: portfolio.version,
			capturedAt: portfolio.capturedAt,
			anchor: predictor.analysisAnchor()
		});
		fs.writeFileSync(OUT_FIT, html, 'utf8');
		expect(html.startsWith('<!doctype html>')).toBe(true);

		const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
		expect(scripts.length).toBeGreaterThan(0);
		scripts.forEach(block => {
			const src = block.replace(/^<script>/, '').replace(/<\/script>$/, '');
			expect(() => new Function(src)).not.toThrow();
		});

		console.log('CYCLE FIT: ' + summary.total + ' cohort | ' + summary.agree + ' agree | '
			+ summary.disagree + ' disagree | ' + summary.weak + ' no fit (>' + WEAK_FIT_CUTOFF + ') | '
			+ 'AGREEMENT vs declaration: merged ' + summary.agreeMerged + '/' + summary.total
			+ ', split ' + summary.agreeSplit + '/' + summary.total
			+ ' | merged and split differ on ' + summary.splitDiffers);
		console.log('FIT PAGE: ' + OUT_FIT + ' (' + fs.statSync(OUT_FIT).size + ' bytes)');
	});
});
