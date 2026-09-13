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
import {cycleBuckets, classifyShape, concentration, focusOf, lumpDays, dayHistogram, Shape}
	from './shapeDetermination';
import {buildShapeAuditPage, shapeRows, summarizeShapes} from './buildShapeAuditPage';
import {buildModesAuditPage, modeRows} from './buildModesAuditPage';
import {SHAPE_CONFIG} from './shapeConfig';
import {Period} from '../../Time';

const FIXTURE = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');
const OUT = path.join(__dirname, 'audit-account-mapping.html');
const OUT_CYCLE = path.join(__dirname, 'audit-cycle.html');
const OUT_FIT = path.join(__dirname, 'audit-cycle-fit.html');
const OUT_SHAPE = path.join(__dirname, 'audit-shape.html');
const OUT_MODES = path.join(__dirname, 'audit-modes.html');
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

   THE RULE UNDER TEST IS THAT A DECLARED RHYTHM IS NEVER OVERRULED. The detector now runs on every
   stream and reports what it read, so the invariant worth asserting is no longer "nothing is
   inferred" - it is that an inference on a weekly, monthly or quarterly declaration is REPORTED and
   never becomes the answer. Only a yearly envelope hands the answer to the ledger. The assertion is
   written to FAIL if the stage ever grows an opinion about a declaration nobody asked it to
   second-guess.

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

	/* EVERY STREAM RESOLVES TO A REAL Period, which is what `declared: null` would deny. A malformed
	   or missing declaration is reported rather than thrown, so nothing fails on its own - this is
	   the assertion that would catch it. */
	test('every one of the 87 terminal streams declares a period we recognise', () => {
		expect(streams.length).toBe(87);
		const nameless = cycles.filter(c => c.cycle.declared === null).map(c => c.stream.name);
		if(nameless.length)console.log('STREAMS WITH NO USABLE DECLARED PERIOD: ' + nameless.join(', '));
		expect(nameless).toEqual([]);
		//and the Period that comes back is the one the declaration names
		cycles.forEach(c => expect(c.cycle.declared.name).toBe(c.stream.period));
	});

	/* THE DECLARATION WINS OUTRIGHT FOR A DECLARED RHYTHM. Loosening this to "usually declaration"
	   would delete the thing §2 promises about the 43 streams that state a real period. */
	test('a declared rhythm is never overruled by the ledger, on any of the 87', () => {
		const now = predictor.analysisNow();
		const overruled = [], corroborated = [], disagreed = [];

		streams.forEach(st => {
			if(YEARLY_DECLARATIONS[st.period])return;
			const legs = predictor.legsOf(st.id);
			const c = determineCycle(st, {legs: legs, anchor: anchor, now: now});
			//whatever the ledger read, the answer is the declaration
			if(cycleOf(c) !== declaredCycleOf(st.period))
				overruled.push(st.name + ' declared ' + st.period + ' but answered '
					+ (cycleOf(c) && cycleOf(c).name));
			if(!('inferred' in c))return;
			(c.inferred === c.declared ? corroborated : disagreed)
				.push(st.name + ' -> ' + c.inferred.name);
		});

		expect(overruled).toEqual([]);
		//and a disagreement on a declared rhythm is a finding to print, not a failure to assert away
		if(disagreed.length)
			console.log('LEDGER DISAGREES WITH A DECLARED RHYTHM (reported, not acted on):\n  '
				+ disagreed.join('\n  '));
		console.log('DECLARED RHYTHMS: ' + corroborated.length
			+ ' corroborated by the ledger, ' + disagreed.length + ' disagreed with, 0 overruled');
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
	   THREE KEYS, TWO OF THEM OPTIONAL. `inferred` is present whenever the detector MEASURED something,
	   whether or not that measurement gets to decide - "the ledger agrees" and "the ledger was never
	   asked" are different facts and a prediction experiment has to tell them apart. Which of the two
	   is the ANSWER is cycleOf(), and that rule lives in exactly one place. */
	test('determineCycle returns {declared, inferred?, confidence?} and nothing else', () => {
		const all = rows.concat(yearlyRows);
		let measured = 0, agreeing = 0, decidedByLedger = 0;

		all.forEach(r => {
			const c = determineCycle(r.stream, {legs: r.legs, anchor: anchor, now: now});
			expect(Object.keys(c).sort()).toEqual(
				'inferred' in c ? ['confidence', 'declared', 'inferred'] : ['declared']);
			expect(c.declared).toBe(Period[r.stream.period]);

			const yearly = isYearlyDeclaration(r.stream.period);
			//a declared rhythm keeps the answer whatever the ledger found
			expect(cycleOf(c)).toBe(yearly ? (c.inferred || c.declared) : c.declared);

			if(!('inferred' in c)){
				expect('confidence' in c).toBe(false);
				return;
			}
			measured++;
			if(c.inferred === c.declared)agreeing++;
			if(cycleOf(c) === c.inferred && c.inferred !== c.declared)decidedByLedger++;
			expect(c.confidence).toBeGreaterThanOrEqual(0.5);
			expect(c.confidence).toBeLessThanOrEqual(1);
			//landing on the declaration is 100% by definition
			if(c.inferred === c.declared)expect(c.confidence).toBe(1);
		});

		expect(measured).toBe(18);
		expect(agreeing).toBe(12);
		expect(decidedByLedger).toBe(6);
		console.log('DECISION: ' + all.length + ' streams | ' + measured
			+ ' carry an inference (' + agreeing + ' corroborating the declaration, '
			+ decidedByLedger + ' deciding it) | ' + (all.length - measured)
			+ ' have none');
	});

	/* UTILITIES IS THE CASE THAT MOTIVATED REPORTING AN INFERENCE THE DECLARATION OVERRULES. Two
	   merchants, 18 legs, read monthly by both readings - the declaration was never in doubt, and
	   throwing the corroboration away because of that is what this asserts against. */
	test('a declared rhythm still reports what the ledger read', () => {
		const r = rows.find(x => /^utilities$/i.test(x.stream.name || ''));
		expect(r).toBeTruthy();
		const c = determineCycle(r.stream, {legs: r.legs, anchor: anchor, now: now});
		expect(c.declared).toBe(Period.monthly);
		expect(c.inferred).toBe(Period.monthly);
		expect(c.confidence).toBe(1);
		//reported, not acted on: the answer comes from the declaration either way
		expect(cycleOf(c)).toBe(c.declared);

		const why = explainCycle(r.stream, r.legs, anchor, now);
		expect(why.route).toBe('both');
		console.log('Utilities: declared ' + c.declared.name + ', inferred ' + c.inferred.name
			+ ' at 100% confidence, route ' + why.route + ' (merged '
			+ ((1 - why.merged.misfit) * 100).toFixed(1) + '%, split '
			+ ((1 - why.split.misfit) * 100).toFixed(1) + '%)');
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

/* ==================================================================================================
   §3, THE SHAPE INSIDE ONE CYCLE.

   THE CLASSIFIER IS ASSERTED ON HAND-WRITTEN COUNTS, not only on the portfolio, because the whole
   point of it is which arrangements of numbers mean which shape - and those are checkable without a
   ledger. The portfolio then says what the rule does to real streams, and the page prints it.
   ================================================================================================== */
suite('StreamPredictor §3 - the shape inside a cycle', () => {
	let portfolio, predictor;

	beforeAll(() => {
		// eslint-disable-next-line global-require
		const {StreamPredictor} = require('./index');
		portfolio = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
		predictor = new StreamPredictor(portfolio);
	});

	/* ---- FOCUS ------------------------------------------------------------------------------------
	   THE SHAPE COMES FROM HOW TIGHTLY THE MOVEMENTS LAND ON A DAY, not from how many there are per
	   cycle. `bins` is every cycle laid on top of every other: bins[3] is how many movements ever
	   landed on day 3 of a cycle. */
	const bins = (len, at) => {
		const b = new Array(len).fill(0);
		Object.keys(at).forEach(d => { b[Number(d)] = at[d]; });
		return b;
	};

	test('concentration is 1 on one day, 0 evenly smeared, and reads the cycle as a circle', () => {
		//everything on one day
		expect(concentration(bins(31, {11: 9}), 1)).toBeCloseTo(1, 6);
		//perfectly even round the cycle
		expect(concentration(new Array(28).fill(1), 1)).toBeCloseTo(0, 6);

		/* THE CIRCLE IS NOT A FLOURISH. Days 29, 30, 0 and 1 are four consecutive days that happen to
		   straddle the seam. On a straight line they look like two groups at opposite ends of the
		   month; on the circle they are one cluster, which is what they are. */
		expect(concentration(bins(31, {29: 2, 30: 2, 0: 2, 1: 2}), 1)).toBeGreaterThan(0.9);
	});

	/* TWO CLUSTERS HALF A CYCLE APART CANCEL when the circle is counted once round, and come back
	   into focus when it is wrapped twice. That is what finds a multiLump. */
	test('wrapping the circle k times finds k lumps', () => {
		const twice = bins(30, {4: 5, 19: 5});
		expect(concentration(twice, 1)).toBeLessThan(0.3);
		expect(concentration(twice, 2)).toBeGreaterThan(0.9);
		expect(focusOf(twice).lumps).toBe(2);

		//and a single tight cluster is one lump, tried first so it wins
		expect(focusOf(bins(31, {11: 9})).lumps).toBe(1);
	});

	/* THE DEFECT THIS REPLACED, PINNED SO IT CANNOT COME BACK. The old rule read the shape off how
	   many movements a cycle carried and a cutoff at four, which put groceries - four or five shops a
	   week, every week, the textbook spread - in the same class as a utility bill arriving twice a
	   month. Counting is not the question. Where they LAND is. */
	test('the shape comes from where the movements land, not from how many there are', () => {
		//rent: one a month, always on day 11
		const rent = classifyShape([1, 1, 1, 1, 1, 1, 1, 1, 1], bins(31, {10: 1, 11: 6, 12: 2}));
		expect(rent.shape).toBe(Shape.lump);
		expect(rent.concentration).toBeGreaterThan(0.95);

		//groceries: four or five a week, every day of the week
		const groceries = classifyShape([4, 5, 6, 3, 5, 4, 5, 4, 6, 5, 4, 3],
			bins(7, {0: 8, 1: 9, 2: 7, 3: 8, 4: 7, 5: 8, 6: 7}));
		expect(groceries.shape).toBe(Shape.spread);
		expect(groceries.concentration).toBeLessThan(0.2);
		//AND ITS CONFIDENCE IS HIGH. A flat cycle is a certain spread, not a doubtful lump.
		expect(groceries.confidence).toBeGreaterThan(0.8);

		//two bills a month, a fortnight apart
		const twice = classifyShape([2, 2, 2, 2, 2, 2], bins(30, {4: 6, 19: 6}));
		expect(twice.shape).toBe(Shape.multiLump);
	});

	/* ONCE A MONTH IS NOT A DAY. Earnin's phone reimbursement arrives exactly once every month and
	   the count-based rule called it a perfect lump for that reason. It lands anywhere across a
	   fortnight, so there is no day to predict and saying so is the answer. */
	test('steady as clockwork but landing anywhere is not a lump', () => {
		const v = classifyShape([1, 1, 1, 1, 1, 1, 1, 1],
			bins(31, {15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 23: 1, 27: 1, 29: 1}));
		expect(v.shape).toBe(null);
		expect(v.steady).toBe(1);
		expect(v.concentration).toBeLessThan(0.75);
		expect(v.reason).toMatch(/do not land on a day/);
	});

	/* ONE CYCLE MAKES ITS OWN COUNT THE COMMONEST and scores 100% steady by construction. Date had
	   three movements in a single month and claimed three lumps at full confidence. */
	/* TWO POINTS ON THE SAME DAY ARE PERFECTLY IN FOCUS BY CONSTRUCTION, and so are three - there is
	   nothing for them to disagree with. One old grocery card had two movements, both on day 1, and
	   read as a lump at 1.00; Tolls had three and claimed two lumps. */
	test('a handful of movements cannot be in focus', () => {
		expect(classifyShape([3], bins(31, {4: 1, 5: 1, 6: 1})).reason).toMatch(/only 1 cycle/);
		expect(classifyShape([1, 1], bins(31, {4: 2})).reason).toMatch(/only 2 cycles/);

		//three cycles, but only two movements between them
		expect(classifyShape([1, 0, 1], bins(31, {4: 2})).reason).toMatch(/only 2 movements/);
		//four movements on the same day over four cycles is the smallest real lump
		expect(classifyShape([1, 1, 1, 1], bins(31, {4: 4})).shape).toBe(Shape.lump);

		expect(SHAPE_CONFIG.minCyclesObserved).toBe(3);
		expect(SHAPE_CONFIG.minMovements).toBe(4);
	});

	/* THE TYPICAL COUNT IS ONE SOME CYCLE ACTUALLY HAD. A middle value over an even number of cycles
	   lands between two integers, and "how many cycles carry exactly it" is then zero for a stream
	   that is perfectly steady at two levels. */
	test('the typical count is never a value no cycle had', () => {
		//four cycles of 1 and four of 2: a middle value would say 1.5, which nothing ever was
		const v = classifyShape([1, 1, 1, 1, 2, 2, 2, 2], bins(31, {4: 12}));
		expect([1, 2]).toContain(v.typical);
		expect(v.steady).toBe(0.5);
	});

	/* THE DAYS ARE CUT AT THE BIGGEST GAPS, which is what "distinct lumps" means, and each group
	   answers its MIDDLE day so one late month cannot drag it. */
	test('lump days are cut at the gaps and read off the middle', () => {
		const day = 24 * 60 * 60 * 1000;
		const cycle = (startDay, offsets) => ({
			start: new Date(2026, 0, startDay),
			end: new Date(2026, 0, startDay + 30),
			legs: offsets.map(o => ({date: new Date(new Date(2026, 0, startDay).getTime() + o * day)}))
		});
		//two clusters, one around day 3 and one around day 17, over three cycles
		const buckets = [cycle(1, [3, 17]), cycle(1, [4, 17]), cycle(1, [3, 18])];
		const days = lumpDays(buckets, 2);
		expect(days.map(d => d.day)).toEqual([3, 17]);
		expect(days.map(d => d.events)).toEqual([3, 3]);

		//one outlier does not move the answer
		const withOutlier = buckets.concat([cycle(1, [3, 29])]);
		expect(lumpDays(withOutlier, 2)[0].day).toBe(3);

		//every cycle laid on top of every other: two towers, nothing between
		const bins = dayHistogram(buckets);
		expect(bins[3]).toBe(2);
		expect(bins[17]).toBe(2);
		expect(bins.slice(5, 16).every(n => n === 0)).toBe(true);
	});

	/* §3 CONSUMES §2's ANSWER. A stream that declared yearly and was read as monthly is shaped like
	   any other; one still yearly after §2 is not shaped at all. */
	test('the stage runs on the cycle §2 answered with, never the declaration', () => {
		const yearlyStill = predictor.reviewable().find(st => {
			const c = predictor.cycleOf(st.id, st);
			return st.period === 'yearly' && !c.inferred;
		});
		expect(yearlyStill).toBeTruthy();
		expect(predictor.shapeOf(yearlyStill.id, yearlyStill).allocations
			.every(a => a.shape === null)).toBe(true);

		const rescued = predictor.reviewable().find(st => {
			const c = predictor.cycleOf(st.id, st);
			return st.period === 'yearly' && !!c.inferred;
		});
		expect(rescued).toBeTruthy();
		expect(predictor.shapeOf(rescued.id, rescued).cycle.name).not.toBe('yearly');
	});

	/* THE ANSWER IS {accountId, shape, days?, confidence?} AND NOTHING ELSE - an undetermined field
	   is absent, not a placeholder, the same contract §2 answers on. */
	test('determineShape returns only the fields it determined', () => {
		let shaped = 0, unshaped = 0;
		predictor.reviewable().forEach(st => {
			predictor.shapeOf(st.id, st).allocations.forEach(a => {
				const keys = Object.keys(a).sort();
				if(a.shape === Shape.lump || a.shape === Shape.multiLump){
					shaped++;
					expect(keys).toEqual(['accountId', 'confidence', 'days', 'shape']);
					expect(a.days.length).toBeGreaterThan(0);
				}else if(a.shape === Shape.spread){
					shaped++;
					expect(keys).toEqual(['accountId', 'confidence', 'shape']);
				}else{
					unshaped++;
					expect(keys).toEqual(['accountId', 'shape']);
					expect(a.shape).toBe(null);
				}
			});
		});
		expect(shaped).toBeGreaterThan(0);
		console.log('§3 ANSWERS: ' + shaped + ' allocations shaped, ' + unshaped + ' not');
	});

	/* ---- THE PROTOTYPE: A STREAM AS A LIST OF MODES -------------------------------------------------
	   ONE SHAPE PER STREAM WAS THE WRONG SHAPE OF ANSWER. Utilities is a Conservice bill and a City
	   of Palo Alto bill, both on the 11th, two thirds and one third of the money; forcing them into
	   one verdict describes neither. Every payee gets its own mode, and a stream is allowed to be
	   several things at once - or, like Gas, nothing at all, which is also an answer. */
	test('a stream decomposes into one mode per payee, with its share of the money', () => {
		const utilities = predictor.reviewable().find(x => x.name === 'Utilities');
		const m = predictor.modesOf(utilities.id, utilities);
		expect(m.modes.length).toBe(2);
		expect(m.modes.every(x => x.shape === Shape.lump)).toBe(true);
		//the shares are a partition of the money
		expect(m.modes.reduce((n, x) => n + x.moneyShare, 0)).toBeCloseTo(1, 6);
		expect(m.predictableShare).toBeCloseTo(1, 6);
		expect(m.baseline.modes).toBe(0);
		console.log('Utilities: ' + m.modes.map(x => x.label + ' ' + x.shape
			+ ' d' + x.days.join(',') + ' ' + Math.round(x.moneyShare * 100) + '%').join(' | '));

		/* A STREAM WITH NO PATTERN IN IT IS NOT A FAILURE. Gas is twelve fill-ups at eight stations,
		   and "all of this is a rate, none of it is a date" is exactly what a forecast needs told. */
		const gas = predictor.reviewable().find(x => x.name === 'Gas');
		const g = predictor.modesOf(gas.id, gas);
		expect(g.predictable).toBe(0);
		expect(g.baseline.moneyShare).toBeCloseTo(1, 6);

		/* THE PAYROLL SEPARATES FROM THE DISABILITY DEPOSITS - where this started - AND THEN PUTS
		   ITSELF BACK TOGETHER. The payer is written two ways, "ACTIVEHOURS INC PAYROLL" sixteen
		   times and "ACTIVEHOURS D B PAYROLL" once, so splitting by payee cuts one rhythm in two.
		   The stray is offered back and absorbed because the merged mode still snaps to a pattern:
		   17 movements, 17 cycles, one lump. The disability deposits are offered too and refused. */
		const wages = predictor.reviewable().find(x => x.name === 'Wages Julien');
		const wm = predictor.modesOf(wages.id, wages);
		const payroll = wm.modes[0];
		expect(payroll.shape).toBe(Shape.lump);
		expect(payroll.legs).toBe(17);
		expect(payroll.absorbed).toEqual(['ACTIVEHOURS D B PAYROLL x1']);
		expect(wm.baseline.legs).toBe(3);

		/* AND A STRAY THAT DOES NOT BELONG IS NOT ABSORBED. Day care Emile is eight cheques and one
		   Zelle transfer; merging the transfer drops the fit from 0.81 to 0.76, and the arithmetic
		   saying so is the whole test - no rule about what the names look like. */
		const dc = predictor.reviewable().find(x => x.name === 'Day care Emile');
		const dm = predictor.modesOf(dc.id, dc);
		expect(dm.modes.length).toBe(2);
		expect(dm.modes[0].absorbed).toBe(undefined);
		expect(dm.modes[0].legs).toBe(8);

		/* EVERYTHING STILL LOOSE IS GATHERED INTO ONE MODE. Eight petrol stations are not eight facts
		   about a forecast - they are one habit with no rhythm, and one row saying so beats eight. */
		expect(g.modes.length).toBe(1);
		expect(g.modes[0].gathered.length).toBe(8);
		console.log('Wages Julien: ' + payroll.label + ' ' + payroll.shape + ' d'
			+ payroll.days.join(',') + ' ' + Math.round(payroll.moneyShare * 100) + '% of money, '
			+ wm.baseline.legs + ' movements in the baseline');
	});

	test('writes the modes audit page from the real results', () => {
		const rows = modeRows(predictor);
		const html = buildModesAuditPage(predictor, {
			version: portfolio.version,
			capturedAt: portfolio.capturedAt,
			anchor: predictor.analysisAnchor()
		});
		fs.writeFileSync(OUT_MODES, html, 'utf8');
		expect(html.startsWith('<!doctype html>')).toBe(true);

		const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
		expect(scripts.length).toBe(2);
		scripts.forEach(block => {
			const src = block.replace(/^<script>/, '').replace(/<\/script>$/, '');
			expect(() => new Function(src)).not.toThrow();
			expect(src.indexOf(String.fromCharCode(92))).toBe(-1);
			expect(src.indexOf(String.fromCharCode(96))).toBe(-1);
		});

		const modes = rows.reduce((n, r) => n + r.modes.length, 0);
		const shaped = rows.reduce((n, r) => n + r.modes.filter(x => x.shape).length, 0);
		console.log('§3 MODES: ' + rows.length + ' streams | ' + modes + ' modes | '
			+ shaped + ' with a pattern | '
			+ rows.filter(r => r.predictableShare >= 0.999).length + ' fully predictable | '
			+ rows.filter(r => r.predictableShare <= 0.001).length + ' with no pattern at all');
		console.log('MODES PAGE: ' + OUT_MODES + ' (' + fs.statSync(OUT_MODES).size + ' bytes)');
	});

	test('writes the shape audit page from the real results', () => {
		const rows = shapeRows(predictor);
		const by = summarizeShapes(rows);
		const html = buildShapeAuditPage(predictor, {
			version: portfolio.version,
			capturedAt: portfolio.capturedAt,
			anchor: predictor.analysisAnchor()
		});
		fs.writeFileSync(OUT_SHAPE, html, 'utf8');
		expect(html.startsWith('<!doctype html>')).toBe(true);

		const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
		expect(scripts.length).toBe(2);
		scripts.forEach(block => {
			const src = block.replace(/^<script>/, '').replace(/<\/script>$/, '');
			expect(() => new Function(src)).not.toThrow();
			expect(src.indexOf(String.fromCharCode(92))).toBe(-1);
			expect(src.indexOf(String.fromCharCode(96))).toBe(-1);
		});

		//no row for a stream §2 left yearly - 51 empty rows would bury the ones worth checking
		expect(rows.every(r => r.cycle !== 'yearly')).toBe(true);

		console.log('§3 SHAPE: ' + rows.length + ' rows | '
			+ Object.keys(by).sort().map(k => by[k] + ' ' + k).join(' | '));
		console.log('SHAPE PAGE: ' + OUT_SHAPE + ' (' + fs.statSync(OUT_SHAPE).size + ' bytes)');
	});
});
