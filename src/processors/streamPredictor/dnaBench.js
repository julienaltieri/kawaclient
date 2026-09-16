/* ==================================================================================================
   THE ROUND TRIP — DID THE DNA COME BACK?  TEST INSTRUMENT.

   A STREAM IS GROWN FROM WRITTEN-DOWN TRUTH, its transactions are handed to the real predictor, and
   every answer is scored against the parameters that produced it. Nothing here reimplements the
   detector or reaches inside it: the portfolio goes in at the front door and the answer comes out of
   `shapeOf`, exactly as a caller would get it.

   SCORED PER MODE, NOT PER STREAM, because a stream with three modes can be two thirds right and a
   pass/fail on the whole thing would hide that.

   WHAT COUNTS AS AGREEMENT is stated per question below, and each is deliberately generous about the
   things the DNA did not promise and strict about the things it did. A mode generated with eight days
   of jitter is not expected back on an exact day; one generated as a metronome is.
   ================================================================================================== */

import {StreamPredictor} from './index';
import {Shape} from './shapeDetermination';
import {rng, randomStream, buildPortfolio, CYCLE_DAYS} from './syntheticDna';

/* WHAT THE DETECTOR SHOULD HAVE SAID, from the DNA alone. This is the honest half of the exercise:
   the expectation is derived from the parameters, not from what the code happens to do. */
export function expectedShape(mode){
	if(mode.diedAt !== null && mode.diedAt !== undefined)return 'dead';
	if(mode.kind === 'sparse')return Shape.unknown;
	if(mode.kind === 'spread')return Shape.spread;
	//a lump and a wandering lump are both lumps; what differs is how sure of the day
	return Shape.lump;
}


/* THE DAY IS ALLOWED THE JITTER IT WAS GROWN WITH, and no more. A metronome must come back exact; a
   mode that wanders five days either way cannot be held to better than five. The cycle is circular,
   so a claim of day 0 against a truth of day 29 is one day out, not twenty-nine. */
const dayGap = (a, b, span) => {
	const raw = Math.abs(a - b) % span;
	return raw > span / 2 ? span - raw : raw;
};

export function scoreMode(truth, answer, cycleDays){
	const want = expectedShape(truth);
	const got = answer ? answer.shape : Shape.unknown;
	const out = {kind: truth.kind, want: want, got: got, checks: {}};

	//1. SHAPE. A dead mode may answer anything in §3; what matters is that §4 silences it.
	out.checks.shape = (want === 'dead') ? null : (want === got);

	//2. DAY, where one was claimed and one was promised
	if(want === Shape.lump && got === Shape.lump && answer.days && answer.days.length){
		const tol = Math.max(1, truth.jitter || 0);
		out.checks.day = truth.days.some(d =>
			answer.days.some(a => dayGap(a, d, cycleDays) <= tol));
		out.dayOff = Math.min.apply(null, truth.days.map(d =>
			Math.min.apply(null, answer.days.map(a => dayGap(a, d, cycleDays)))));
	}

	//3. RAIL, only where the DNA gave one AND the answer claims one. Absent is not wrong: a mode
	//   whose due days never met a closure has nothing to learn from, and saying so is correct.
	if(answer && answer.rail)out.checks.rail = answer.rail.closures === truth.rail;

	return out;
}

/* ---- ONE RUN ------------------------------------------------------------------------------------ */
export function runDnaBench(opts){
	const o = opts || {};
	const count = o.count || 1000;
	const months = o.months || o.cycles || 12;
	const seed = o.seed || 20260913;
	const r = rng(seed);
	/* LOCAL MIDNIGHT, NOT UTC MIDNIGHT. The detector pins every seam with local getters, so an anchor
	   built at UTC midnight lands on the previous calendar day west of Greenwich and lays the whole
	   lattice one day early: every metronome mode came back at exactly -1, 58 times out of 58. */
	const anchor = new Date(2025, 11, 21);

	const truths = [];
	for(let i = 0; i < count; i++)truths.push(randomStream(r, i));

	const portfolio = buildPortfolio(truths, anchor, months, r, {country: o.country || 'US'});
	const predictor = new StreamPredictor(portfolio);

	const tally = {
		streams: truths.length, modes: 0,
		shape: {right: 0, wrong: 0, by: {}},
		day: {right: 0, wrong: 0, offs: []},
		rail: {right: 0, wrong: 0, absent: 0},
		dead: {silenced: 0, missed: 0},
		cycle: {right: 0, wrong: 0}
	};
	const misses = [];

	truths.forEach(truth => {
		const node = predictor.reviewable().find(x => x.id === truth.id)
			|| predictor.terminalStreams().find(x => x.id === truth.id);
		if(!node)return;
		const answer = predictor.shapeOf(truth.id, node);
		const cycleDays = CYCLE_DAYS[truth.cycle];

		//THE CYCLE FIRST: every question below is asked inside a rhythm, and a wrong rhythm makes
		//the rest meaningless rather than wrong.
		const gotCycle = answer.cycle ? answer.cycle.name : null;
		if(gotCycle === truth.cycle)tally.cycle.right++;
		else{
			tally.cycle.wrong++;
			misses.push({stream: truth.id, what: 'cycle',
				want: truth.cycle, got: gotCycle});
		}

		truth.modes.forEach(mode => {
			tally.modes++;
			//the answer for this mode: matched by payee, which is what splits modes in the first place
			const mine = answer.modes.filter(m => m.label === mode.payee);
			const got = mine.length === 1 ? mine[0]
				: (mine.find(m => m.shape === Shape.lump) || mine[0] || null);
			const s = scoreMode(mode, got, cycleDays);

			if(s.checks.shape === true)tally.shape.right++;
			else if(s.checks.shape === false){
				tally.shape.wrong++;
				misses.push({stream: truth.id, what: 'shape', kind: mode.kind,
					want: s.want, got: s.got, jitter: mode.jitter,
					arrivalP: Math.round(mode.arrivalP * 100) / 100,
					perMonth: Math.round((mode.perMonth || 0) * 10) / 10});
			}
			const by = tally.shape.by[mode.kind] || (tally.shape.by[mode.kind] = {right: 0, n: 0});
			if(s.checks.shape !== null){ by.n++; if(s.checks.shape)by.right++; }

			if(s.checks.day === true){ tally.day.right++; tally.day.offs.push(s.dayOff); }
			else if(s.checks.day === false){
				tally.day.wrong++;
				tally.day.offs.push(s.dayOff);
				misses.push({stream: truth.id, what: 'day', kind: mode.kind,
					want: mode.days.join(','), got: (got.days || []).join(','),
					jitter: mode.jitter, off: s.dayOff});
			}

			if(s.checks.rail === true)tally.rail.right++;
			else if(s.checks.rail === false){
				tally.rail.wrong++;
				misses.push({stream: truth.id, what: 'rail', want: mode.rail,
					got: got.rail.closures, tests: got.rail.tests});
			}else if(mode.accountType === 'realTime' && mode.rail !== 'ignored')tally.rail.absent++;
		});
	});

	return {tally: tally, misses: misses, seed: seed, portfolio: portfolio, truths: truths};
}

export default runDnaBench;
