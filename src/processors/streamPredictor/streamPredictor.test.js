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
import {determineCycle, cycleOf, declaredCycleOf, isYearlyDeclaration}
	from './cycleDetermination';
import {buildFitAuditPage, fitData, COHORTS} from './buildFitAuditPage';
import {summarizeAll, resolveOne, explainCycle, confidenceOf, DEFAULT_KNOBS}
	from './cycleDecision';
import {FIT_CONFIG} from './fitConfig';
import {fitTable, legsInWindow, emptyCyclesSince, CANDIDATE_PERIODS} from './cycleFit';
import {cycleBuckets} from './shapeDetermination';
import {Period} from '../../Time';

const FIXTURE = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');
const OUT = path.join(__dirname, 'audit-account-mapping.html');
const OUT_CYCLE = path.join(__dirname, 'audit-cycle.html');
const OUT_FIT = path.join(__dirname, 'audit-cycle-fit.html');
const GROUND_TRUTH = path.join(__dirname, '..', '..', 'tests', 'fixtures',
	'cycleGroundTruth.json');
const HAS_FIXTURE = fs.existsSync(FIXTURE);
const HAS_GROUND_TRUTH = fs.existsSync(GROUND_TRUTH);

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
		cycles = streams.map(s => ({stream: s, cycle: {declared: declaredCycleOf(s.period)}}));
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
			const cycle = declaredCycleOf((r.stream || {}).period);
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
		//the declaration path carries no inference at all, and the shape says so by having no key
		const inferred = cycles.filter(c => 'inferred' in c.cycle)
			.map(c => c.stream.name + ' -> inferred');
		if(inferred.length)console.log('CYCLES NOT SOURCED FROM THE DECLARATION:\n  ' + inferred.join('\n  '));
		expect(inferred).toEqual([]);
	});

	test('isYearlyDeclaration is true exactly for the streams declaring yearly or biyearly', () => {
		const disagree = streams
			.filter(st => isYearlyDeclaration(st.period) !== !!YEARLY_DECLARATIONS[st.period])
			.map(st => st.name + ' declared ' + st.period);
		expect(disagree).toEqual([]);
		expect(streams.filter(st => isYearlyDeclaration(st.period)).length)
			.toBe(streams.filter(st => YEARLY_DECLARATIONS[st.period]).length);
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
	let portfolio, predictor, anchor, now, rows, yearlyRows, data, yearlyData, s, sy;

	beforeAll(() => {
		// eslint-disable-next-line global-require
		const {StreamPredictor} = require('./index');
		portfolio = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
		predictor = new StreamPredictor(portfolio);
		anchor = predictor.analysisAnchor();
		now = predictor.analysisNow();
		rows = predictor.mapFitCohort();
		yearlyRows = predictor.mapYearlyCohort();
		data = fitData(rows, anchor, now, 'validated');
		yearlyData = fitData(yearlyRows, anchor, now, 'yearly');
		s = summarizeAll(data, DEFAULT_KNOBS);
		sy = summarizeAll(yearlyData, DEFAULT_KNOBS);
	});

	test('two cohorts: 25 validated non-yearly, 35 yearly, both open and carrying transactions', () => {
		expect(predictor.terminalStreams().length).toBe(87);
		expect(predictor.reviewable().length).toBe(64);
		expect(rows.length).toBe(25);
		expect(yearlyRows.length).toBe(35);
		const byPeriod = {};
		rows.forEach(r => { byPeriod[r.stream.period] = (byPeriod[r.stream.period] || 0) + 1; });
		expect(byPeriod).toEqual({monthly: 23, semimonthly: 1, weekly: 1});
		//COHORTS names exactly the two the page renders, in the order the tab shows them
		expect(COHORTS.map(c => c.key)).toEqual(['validated', 'yearly']);
	});

	test('every misfit is null or inside [0,1] - no NaN, nothing out of range', () => {
		data.concat(yearlyData).forEach(d => [].concat(d.m, d.s).forEach(m => {
			if(m === null || m === undefined)return;
			expect(Number.isFinite(m)).toBe(true);
			expect(m).toBeGreaterThanOrEqual(0);
			expect(m).toBeLessThanOrEqual(1);
		}));
	});

	/* THE CASE THE DESIGN TURNS ON. Utilities' 24 legs all land on days 1-6 of the month, so folding
	   on semimonthly leaves every other bucket empty - two lumps early in one cycle, not one lump per
	   half-cycle. A scorer that rewards a single tight peak picks semimonthly and is wrong. */
	test('Utilities resolves to monthly, not semimonthly', () => {
		const u = data.find(d => /^utilities$/i.test(d.name || ''));
		expect(u).toBeTruthy();
		const at = p => u.m[CANDIDATE_PERIODS.indexOf(p)];
		expect(at('monthly')).toBeLessThan(at('semimonthly'));
	});

	/* THE TRIM, PINNED TO THE ONE STREAM THAT SEPARATES ITS SETTINGS. Earnin Internet's monthly
	   lattice is 1 1 1 1 2 0 2 - one doubled cycle, one empty one - and dropping the two worst
	   buckets reads it as the monthly rhythm it kept. Its bimonthly lattice is 2 2 2 2, which has no
	   outlier to drop, so it must read the SAME at every trim: that is what proves the trim is not
	   simply inventing a better score wherever it is pointed. */
	test('the trim reads Earnin Internet monthly 60.2 -> 81.6, bimonthly flat at 79.6', () => {
		const row = rows.find(r => /^earnin/i.test(r.stream.name || ''));
		expect(row).toBeTruthy();
		const legs = legsInWindow(row.legs, anchor);
		const at = (trim, p) => {
			const c = fitTable(legs, anchor, trim).find(f => f.period === p);
			return ((1 - c.misfit) * 100).toFixed(1);
		};
		expect([0, 1, 2].map(t => at(t, 'monthly'))).toEqual(['60.2', '71.6', '81.6']);
		expect([0, 1, 2].map(t => at(t, 'bimonthly'))).toEqual(['79.6', '79.6', '79.6']);
		//the configured trim is the one the page and production both use
		expect(at(undefined, 'monthly')).toBe(at(FIT_CONFIG.trimBuckets, 'monthly'));
	});

	/* THE CONFIGURED RULE IS A MEASUREMENT AND THE PAGE OPENS ON IT, so the result is pinned here.
	   The browser and this assertion run THE SAME engine source - cycleDecision.js evaluates the
	   string it also emits - so a drift between what the reader sees and what this test claims is
	   impossible rather than merely unlikely.

	   MEASURED IS PINNED ALONGSIDE AGREED. A rule that agrees 25/25 by declining 25 times has
	   established nothing, so the count of streams it actually read off the ledger is the number
	   that says whether the agreement was earned. */
	test('the configured rule reads the validated cohort with no disagreement', () => {
		expect(DEFAULT_KNOBS).toEqual({thr: FIT_CONFIG.fitThreshold,
			minLegs: FIT_CONFIG.minLegsToClaim, minGroup: FIT_CONFIG.minGroupLegs,
			maxYearlyPeriod: FIT_CONFIG.maxYearlyInferredPeriod,
			maxQuiet: FIT_CONFIG.maxEmptyCyclesToStayActive});
		expect(s.total).toBe(25);
		expect(s.agree).toBe(25);
		expect(s.bad.length).toBe(0);
		expect(s.measured).toBeGreaterThanOrEqual(12);
		console.log('VALIDATED: ' + s.headline);
	});

	/* THE POPULATION THE DETECTOR EXISTS FOR, AND THE ONE WITH NO GROUND TRUTH. Nothing here is
	   asserted as correct because nothing here can be: the declaration says "yearly" and means an
	   amount, not a rhythm. The line is reported so a human can read it. */
	test('the yearly cohort resolves without error and reports what it found', () => {
		expect(sy.total).toBe(35);
		expect(sy.measured + sy.counts.declared + sy.counts.declined + sy.counts.capped
			+ sy.counts.atypical + sy.counts.stale).toBe(35);
		console.log('YEARLY: ' + sy.headline);
		sy.rows.forEach((r, i) => {
			const d = yearlyData[i];
			if(r.measured)
				console.log('   KEPT    ' + d.name + ' -> ' + r.period + ' (' + r.route + ', '
					+ d.windowLegs + ' legs)');
			else if(r.route === 'atypical' || r.route === 'stale'){
				const got = r.split && r.merged ? (r.split.period === r.merged.period
					? r.merged.period : r.merged.period + '/' + r.split.period) : '?';
				const q = d.quiet[CANDIDATE_PERIODS.indexOf(r.merged ? r.merged.period : 'monthly')];
				console.log('   BLOCKED ' + d.name + ' -> ' + got + ' (' + r.route
					+ ', quiet ' + q + ' cycles, ' + d.windowLegs + ' legs)');
			}
		});
	});


	/* ---- THE VALIDATED YEARLY DECISIONS -------------------------------------------------------------
	   THE YEARLY COHORT HAS NO DECLARED GROUND TRUTH, SO THE GROUND TRUTH IS JULIEN'S. He read the
	   yearly tab at a 75% threshold and ticked the streams whose detected cycle he accepts; those
	   decisions are recorded per stream id in cycleGroundTruth.json, and this is what holds the
	   detector to them. Without it the 14 claims below are a console line nobody can regress.

	   THE FILE SITS BESIDE THE PORTFOLIO CAPTURE AND UNDER THE SAME IGNORE RULE, because it names real
	   streams - and in its OWN file rather than inside portfolio.json, so recapturing the portfolio
	   does not erase a judgement that took a person to make.

	   `basis` IS NOT A CONFIDENCE, IT IS A KIND. `rhythm` means the stream really runs on that cycle.
	   `behavioural` means the pattern is genuinely in the ledger but is a side effect of how the
	   spending is initiated rather than a property of the stream - Medical HSA reads quarterly because
	   Julien submits the reimbursements in batches, which is real behaviour and a coincidence at the
	   same time. Both are accepted detections; only one of them should ever carry structural weight,
	   and nothing downstream consumes the distinction yet. */
	test('the detector still produces every yearly decision Julien accepted', () => {
		if(!HAS_GROUND_TRUTH){
			console.log('NO GROUND TRUTH FILE - skipped');
			return;
		}
		const gt = JSON.parse(fs.readFileSync(GROUND_TRUTH, 'utf8'));
		const ids = Object.keys(gt.yearly || {});
		expect(ids.length).toBeGreaterThan(0);

		//the recorded decisions were taken at these knobs, so a knob change has to re-open the review
		expect(gt.knobs.fitThreshold).toBe(FIT_CONFIG.fitThreshold);
		expect(gt.knobs.minLegsToClaim).toBe(FIT_CONFIG.minLegsToClaim);
		expect(gt.knobs.minGroupLegs).toBe(FIT_CONFIG.minGroupLegs);
		expect(gt.knobs.minSplitLegShare).toBe(FIT_CONFIG.minSplitLegShare);
		expect(gt.knobs.maxYearlyInferredPeriod).toBe(FIT_CONFIG.maxYearlyInferredPeriod);
		expect(gt.knobs.maxEmptyCyclesToStayActive).toBe(FIT_CONFIG.maxEmptyCyclesToStayActive);

		const now = {};
		sy.rows.forEach((r, i) => { now[yearlyData[i].id] = r; });

		const drifted = [];
		ids.forEach(id => {
			const want = gt.yearly[id], got = now[id];
			if(!got || got.period !== want.accepted)
				drifted.push(want.name + ': accepted ' + want.accepted + ', now '
					+ (got ? (got.period || 'no claim') + ' (' + got.route + ')' : 'not in the cohort'));
		});
		expect(drifted).toEqual([]);

		const by = kind => ids.filter(id => gt.yearly[id].basis === kind)
			.map(id => gt.yearly[id].name + ' (' + gt.yearly[id].accepted + ')');
		const part = (label, list) => list.length ? ' | ' + list.length + ' ' + label + ': '
			+ list.join(', ') : '';
		console.log('YEARLY GROUND TRUTH: ' + ids.length + ' accepted decisions hold'
			+ part('rhythm', by('rhythm')) + part('behavioural, not rhythm', by('behavioural'))
			+ ' | ' + ids.filter(id => gt.yearly[id].supersededBy).length
			+ ' superseded by a later rule');
	});

	/* ---- THE TWO PIECES THE YEARLY RULE RESTS ON ----------------------------------------------------

	   HOW LONG A PATTERN HAS BEEN QUIET IS ARITHMETIC, so it is pinned to dates that can be checked by
	   hand rather than to the capture. Anchor 2025-12-21 puts every monthly lattice edge on the 21st.
	   Three legs on the 5th, the last of them 2026-03-05, so the first edge after the history is
	   2026-03-21 and the empty cycles run 03-21..04-21, 04-21..05-21, 05-21..06-21. At a `now` of
	   2026-06-09 the third is still running and is not counted: two complete empty cycles. */
	test('emptyCyclesSince counts only cycles that have fully elapsed', () => {
		/* EVERY DATE HERE IS BUILT LOCALLY. The lattice edges come from Time.js, which works in local
		   midnight; `new Date('2026-04-21')` is UTC midnight and lands on the 20th west of Greenwich,
		   so a string would make this test pass or fail by timezone. */
		const on = (y, m, d) => new Date(y, m - 1, d);
		const anchorDate = on(2025, 12, 21);
		const legs = [on(2026, 1, 5), on(2026, 2, 5), on(2026, 3, 5)].map(d => ({date: d}));
		const at = (y, m, d) => emptyCyclesSince(legs, 'monthly', anchorDate, on(y, m, d));
		expect(at(2026, 3, 20)).toBe(0);
		expect(at(2026, 4, 20)).toBe(0);
		//a cycle that ends exactly at `now` has fully elapsed and counts
		expect(at(2026, 4, 21)).toBe(1);
		expect(at(2026, 6, 9)).toBe(2);
		expect(at(2026, 6, 21)).toBe(3);
		//nothing to count from is a different fact from "it moved recently"
		expect(emptyCyclesSince([], 'monthly', anchorDate, on(2026, 6, 9))).toBe(null);
	});

	/* THE DEBUG SURFACE AND THE AUDIT PAGE MUST NOT DRIFT. explainCycle builds the evidence from the
	   legs; the page resolves from a precomputed blob. They run the same engine, but only because
	   explainCycle assembles the evidence the same way - and that is the part a signature change
	   would break silently, so it is asserted on every stream in both cohorts. */
	test('explainCycle answers exactly what the audit page resolves, for all 60 streams', () => {
		const all = rows.concat(yearlyRows);
		const blob = data.concat(yearlyData);
		expect(all.length).toBe(60);
		all.forEach((r, i) => {
			const direct = explainCycle(r.stream, r.legs, anchor, now);
			const viaPage = resolveOne(blob[i], DEFAULT_KNOBS);
			expect(direct.period).toBe(viaPage.period);
			expect(direct.route).toBe(viaPage.route);
			expect(direct.measured).toBe(viaPage.measured);
		});
	});

	/* ---- THE DECISIONER'S CONTRACT ------------------------------------------------------------------
	   THREE KEYS, TWO OF THEM OPTIONAL. `inferred` is present ONLY where the ledger actually decided,
	   which is a yearly stream whose reading cleared every gate - so `inferred || declared` is always
	   the cycle to use and there is no third field to get wrong. A refused reading is ABSENT, not
	   reported as something: the caller asked what cycle to use, not what was considered. */
	test('determineCycle returns {declared, inferred?, confidence?} and nothing else', () => {
		const all = rows.concat(yearlyRows);
		let withInference = 0;

		all.forEach(r => {
			const c = determineCycle(r.stream, {legs: r.legs, anchor: anchor, now: now});
			expect(Object.keys(c).sort()).toEqual(
				'inferred' in c ? ['confidence', 'declared', 'inferred'] : ['declared']);
			expect(c.declared).toBe(Period[r.stream.period]);
			expect(cycleOf(c)).toBe(c.inferred || c.declared);

			if(!('inferred' in c)){
				expect('confidence' in c).toBe(false);
				return;
			}
			withInference++;
			//only a yearly declaration ever hands the answer to the ledger
			expect(isYearlyDeclaration(r.stream.period)).toBe(true);
			expect(c.inferred).not.toBe(c.declared);
			expect(c.confidence).toBeGreaterThanOrEqual(0.5);
			expect(c.confidence).toBeLessThanOrEqual(1);
		});

		expect(withInference).toBe(6);
		console.log('DECISION: ' + all.length + ' streams | ' + withInference
			+ ' answered by the ledger | ' + (all.length - withInference)
			+ ' by the declaration alone');
	});

	/* A BLOCKED READING IS NOT AN INFERENCE. Cadeaux famille Mdm scores bimonthly at 82.2% and the
	   yearly gate refuses it, so the decision carries no `inferred` at all - while explainCycle, the
	   debug surface, still holds the whole working. */
	test('a reading the gates refused leaves no trace in the decision', () => {
		const r = yearlyRows.find(x => /^Cadeaux famille Mdm$/i.test(x.stream.name || ''));
		expect(r).toBeTruthy();
		const c = determineCycle(r.stream, {legs: r.legs, anchor: anchor, now: now});
		expect(Object.keys(c)).toEqual(['declared']);
		expect(cycleOf(c)).toBe(Period.yearly);

		const why = explainCycle(r.stream, r.legs, anchor, now);
		expect(why.route).toBe('atypical');
		expect(why.measured).toBe(false);
		expect(why.merged.period).toBe('bimonthly');
		expect(why.split.period).toBe('monthly');
		console.log('Cadeaux famille Mdm: decision is {declared: yearly} | explain says merged '
			+ why.merged.period + ' ' + ((1 - why.merged.misfit) * 100).toFixed(1)
			+ '%, split ' + why.split.period + ', route ' + why.route);
	});

	/* CALLED WITH NO EVIDENCE IT IS THE DECLARATION ALONE, which is the same shape by construction
	   and is how the cycle audit page reads it. */
	/* EVIDENCE IS REQUIRED, AND AN EMPTY LEDGER IS EVIDENCE. The two used to be the same call and
	   returned the same thing, which meant a caller who simply forgot the argument got a
	   confident-looking answer instead of a failure. A stream with no transactions still falls back
	   to the declaration - that is a fact about the stream, not a wiring mistake. */
	test('evidence is required; an empty ledger falls back to the declaration', () => {
		const bare = {legs: [], anchor: anchor, now: now};
		const c = determineCycle(rows[0].stream, bare);
		expect(Object.keys(c)).toEqual(['declared']);
		expect(cycleOf(c)).toBe(Period[rows[0].stream.period]);

		//a yearly stream with nothing in the ledger is the same answer, by the same route
		expect(Object.keys(determineCycle({period: 'yearly'}, bare))).toEqual(['declared']);

		//a malformed declaration is reported, never thrown
		expect(determineCycle({period: 'fortnightly'}, bare).declared).toBe(null);
		expect(declaredCycleOf('fortnightly')).toBe(null);

		//but a missing argument is a wiring bug and says so
		expect(() => determineCycle(rows[0].stream)).toThrow(/needs evidence/);
	});

	/* ---- THE CONFIDENCE SCORE -----------------------------------------------------------------------
	   PINNED AT THE THREE POINTS THAT DEFINE IT. Landing on the declaration is 100%; a disagreement
	   is the fit rescaled from the threshold up onto a floor of 50%, so sitting exactly on the
	   threshold reads 50% and a perfect fit reads 100%. Nothing measured has no score at all.

	   BOTH ENDS MOVE WITH THE THRESHOLD, so the knob is swept here too rather than assumed. */
	test('confidence: 100% on agreement, else 50% + (fit - threshold) / (1 - threshold) x 50%', () => {
		const at = (fit, agree, thr) => confidenceOf(
			{measured: true, agree: agree, misfit: 1 - fit, route: 'both'}, {thr: thr || 0.75}).score;

		//agreement is 100% whatever the fit
		expect(at(0.751, true)).toBe(1);
		expect(at(0.999, true)).toBe(1);

		//disagreement: the three defining points
		expect(at(0.75, false)).toBeCloseTo(0.5, 10);
		expect(at(0.875, false)).toBeCloseTo(0.75, 10);
		expect(at(1.0, false)).toBeCloseTo(1, 10);

		//linear in between, and never below the floor
		expect(at(0.80, false)).toBeCloseTo(0.6, 10);
		expect(at(0.90, false)).toBeCloseTo(0.8, 10);
		expect(at(0.70, false)).toBe(0.5);

		//the formula is written in terms of the threshold, so it follows the knob
		expect(at(0.90, false, 0.90)).toBeCloseTo(0.5, 10);
		expect(at(0.95, false, 0.90)).toBeCloseTo(0.75, 10);

		//no inference, no score - the declaration standing is not a prediction that can be wrong
		expect(confidenceOf({measured: false, route: 'declared'}, DEFAULT_KNOBS).score).toBe(null);
	});

	test('every measured stream carries a score, and no unmeasured one does', () => {
		const lines = [];
		data.concat(yearlyData).forEach(d => {
			const r = resolveOne(d, DEFAULT_KNOBS);
			const c = confidenceOf(r, DEFAULT_KNOBS);
			if(!r.measured){ expect(c.score).toBe(null); return; }
			expect(c.score).toBeGreaterThanOrEqual(0.5);
			expect(c.score).toBeLessThanOrEqual(1);
			if(c.score < 1)lines.push('   ' + d.name.slice(0, 22).padEnd(23) + d.declared.padEnd(9)
				+ '-> ' + r.period.padEnd(9) + 'fit ' + ((1 - r.misfit) * 100).toFixed(1)
				+ '%  confidence ' + c.text);
		});
		console.log('CONFIDENCE BELOW 100% (the inferences that disagree with a declaration):');
		lines.forEach(l => console.log(l));
	});

	test('writes the fit audit page from the real results', () => {
		const html = buildFitAuditPage({validated: rows, yearly: yearlyRows}, {
			version: portfolio.version,
			capturedAt: portfolio.capturedAt,
			anchor: anchor,
			now: now
		});
		fs.writeFileSync(OUT_FIT, html, 'utf8');
		expect(html.startsWith('<!doctype html>')).toBe(true);

		const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
		expect(scripts.length).toBe(2);
		scripts.forEach(block => {
			const src = block.replace(/^<script>/, '').replace(/<\/script>$/, '');
			expect(() => new Function(src)).not.toThrow();
			/* THE TWO CHARACTERS THAT HAVE TAKEN THIS PAGE DOWN. A backslash survives the generator's
			   template literal as a real control character inside a quoted string; a backtick closes
			   the literal early. Neither shows up in the markup, so this is the only thing that
			   catches them. */
			expect(src.indexOf(String.fromCharCode(92))).toBe(-1);
			expect(src.indexOf(String.fromCharCode(96))).toBe(-1);
		});

		//the page opens on the configured knobs, so the number it opens on is the number pinned above
		expect(html).toContain(s.headline);
		//the three numbers that stayed adjustable, and the cohort tab
		['thr', 'minlegs', 'mingroup'].forEach(id => expect(html).toContain('id="' + id + '"'));
		expect(html).toContain('name="cohort"');
		COHORTS.forEach(c => expect(html).toContain('value="' + c.key + '"'));
		//the algorithm switches that the tuning settled are gone for good
		['variant', 'pick', 'dis', 'fb'].forEach(n =>
			expect(html.indexOf('name="' + n + '"')).toBe(-1));

		console.log('FIT PAGE: ' + OUT_FIT + ' (' + fs.statSync(OUT_FIT).size + ' bytes)');
	});
});
