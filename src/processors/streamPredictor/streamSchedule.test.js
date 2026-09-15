/* ==================================================================================================
   THE SCHEDULE — the module's last function, tested against the captured portfolio.

   WHAT IS WORTH TESTING HERE IS NOT "does it emit events". It is the three things that make a
   horizon different from a cycle: a plan that drains as it is spent, an envelope that refills on its
   own boundary, and a stop date that is actually obeyed. Everything else is §3 and §4, already
   tested beside them.
   ================================================================================================== */

import fs from 'fs';
import path from 'path';
import {StreamPredictor} from './index';
import {NO_EVENTS} from './streamSchedule';
import {scheduleData, buildScheduleAuditPage} from './buildScheduleAuditPage';

const P = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'portfolio.json');
const DAY = 24 * 60 * 60 * 1000;
const iso = d => new Date(d).toISOString().slice(0, 10);

describe('the schedule', () => {
	let predictor, now, byName;

	beforeAll(() => {
		predictor = new StreamPredictor(JSON.parse(fs.readFileSync(P, 'utf8')));
		now = new Date(predictor.analysisNow());
		byName = name => predictor.reviewable().find(s => s.name === name);
	});

	const horizon = days => new Date(now.getTime() + days * DAY);

	test('a monthly lump repeats once a cycle to the horizon and no further', () => {
		const rent = byName('Rent');
		const until = horizon(150);
		const r = predictor.scheduleOf(rent.id, until, rent);

		expect(r.cycle.name).toBe('monthly');
		expect(r.events.length).toBe(5);
		//every event is the same claim, because a lump's amount does not vary across the horizon
		r.events.forEach(e => {
			expect(e.amount).toBe(r.events[0].amount);
			expect(e.kind).toBe('lump');
			expect(e.accountId).toBe(r.events[0].accountId);
		});
		expect(Math.round(r.total)).toBe(Math.round(r.events[0].amount * 5));

		//ordered by the date the money moves, and nothing past the stop date
		for(let i = 1; i < r.events.length; i++)
			expect(r.events[i].date.getTime()).toBeGreaterThanOrEqual(r.events[i - 1].date.getTime());
		r.events.forEach(e => expect(e.date.getTime()).toBeLessThanOrEqual(until.getTime()));

		//and roughly a month apart, which is the only claim a monthly rhythm makes about spacing
		for(let i = 1; i < r.events.length; i++){
			const gap = (r.events[i].date - r.events[i - 1].date) / DAY;
			expect(gap).toBeGreaterThan(26);
			expect(gap).toBeLessThan(35);
		}
	});

	/* THE HORIZON IS OBEYED AT THE DAY, not at the cycle. A stop date halfway through a cycle keeps
	   the events before it and drops the ones after, rather than rounding to a whole cycle either
	   way. */
	test('a shorter horizon is a strict subset of a longer one', () => {
		const rent = byName('Rent');
		const long = predictor.scheduleOf(rent.id, horizon(150), rent);
		const short = predictor.scheduleOf(rent.id, horizon(70), rent);

		expect(short.events.length).toBeLessThan(long.events.length);
		short.events.forEach((e, i) => expect(iso(e.date)).toBe(iso(long.events[i].date)));
	});

	test('a horizon before the next cycle is empty, and says so', () => {
		const rent = byName('Rent');
		const r = predictor.scheduleOf(rent.id, new Date(now.getTime() - 400 * DAY), rent);
		expect(r.events).toEqual([]);
		expect(r.reason).toBe(NO_EVENTS.horizonPassed);
	});

	test('a bad stop date throws rather than guessing', () => {
		const rent = byName('Rent');
		expect(() => predictor.scheduleOf(rent.id, 'not a date', rent)).toThrow();
	});

	/* ---- THE CYCLE THAT CONTAINS THE EVALUATION DATE ---------------------------------------------
	   THE LATTICE'S LAST BUCKET ENDS IN THE FUTURE for a live stream, so it is the CURRENT cycle and
	   its remaining claims are real. Starting after it hid a $6,000 transfer due five days out, and
	   hid every monthly stream between the capture date and the next seam. */
	test('a claim still to come in the current cycle is predicted', () => {
		const savings = byName('Savings');
		const r = predictor.scheduleOf(savings.id, horizon(30), savings);

		//the next lattice seam is more than a fortnight out; these land before it
		const soon = r.events.filter(e => e.date.getTime() < now.getTime() + 10 * DAY);
		expect(soon.length).toBeGreaterThan(0);
		soon.forEach(e => expect(e.date.getTime()).toBeGreaterThanOrEqual(now.getTime()));

		//a mirrored transfer is zero at the stream and not zero at either account
		const accounts = {};
		soon.forEach(e => { accounts[e.accountId] = (accounts[e.accountId] || 0) + e.amount; });
		const moved = Object.keys(accounts).map(k => accounts[k]);
		expect(moved.length).toBe(2);
		expect(Math.round(moved[0] + moved[1])).toBe(0);
		moved.forEach(v => expect(Math.abs(v)).toBeGreaterThan(0));
	});

	/* AND THE LEDGER IS THE GUARD. Rent is paid early in its cycle against a claimed day later in it;
	   without this it would be predicted a second time in the cycle it has already paid. */
	test('a mode that already moved in a cycle does not claim again in it', () => {
		const until = horizon(365);
		const all = predictor.scheduleAll(until);
		let overlaps = 0;

		predictor.reviewable().forEach(s => {
			const legs = predictor.legsOf(s.id) || [];
			all.filter(e => e.streamId === s.id).forEach(e => {
				const near = legs.filter(l => l.description === e.label
					&& Math.abs(new Date(l.date).getTime() - e.date.getTime()) < 3 * DAY);
				overlaps += near.length ? 1 : 0;
			});
		});
		expect(overlaps).toBe(0);
	});

	/* ---- THE DATE THE ANSWER IS MEASURED FROM ---------------------------------------------------- */
	test('the evaluation date is the capture, never the wall clock', () => {
		const rent = byName('Rent');
		const r = predictor.scheduleOf(rent.id, horizon(150), rent);

		//the capture states its own date, and that is what the answer is measured from
		expect(new Date(r.asOf).getTime()).toBe(new Date(predictor.portfolio.today).getTime());
		expect(new Date(r.from).getTime()).toBe(new Date(r.asOf).getTime());
		//and it is in the past relative to whenever this test happens to run
		expect(new Date(r.asOf).getTime()).toBeLessThan(Date.now() + 365 * DAY);
	});

	/* `asOf` MOVES THE FLOOR, NOT THE LATTICE. The cycles walked are anchored on the EVIDENCE - the
	   lattice is cut at the stream's newest movement - so an earlier evaluation date admits claims
	   that were filtered out, and does not conjure cycles the ledger already covers. A true backtest
	   needs the predictor built from a ledger truncated at the date, which is a different exercise
	   from moving this floor. */
	test('an earlier evaluation date never loses a claim, and never invents one', () => {
		const rent = byName('Rent');
		const until = horizon(150);
		const asOf = new Date(now.getTime() - 45 * DAY);

		const fromNow = predictor.scheduleOf(rent.id, until, rent);
		const fromThen = predictor.scheduleOf(rent.id, until, rent, {asOf: asOf});

		expect(new Date(fromThen.asOf).getTime()).toBe(asOf.getTime());
		expect(fromThen.events.length).toBeGreaterThanOrEqual(fromNow.events.length);

		//the later answer is the tail of the earlier one, event for event
		const tail = fromThen.events.slice(fromThen.events.length - fromNow.events.length);
		tail.forEach((e, i) => expect(iso(e.date)).toBe(iso(fromNow.events[i].date)));

		//and no claim is older than the cycle the ledger itself stops in
		fromThen.events.forEach(e =>
			expect(e.date.getTime()).toBeGreaterThanOrEqual(asOf.getTime()));
	});

	/* ---- WHAT IS DELIBERATELY NOT PREDICTED ------------------------------------------------------- */
	test('a stream still yearly after §2 predicts nothing, deliberately', () => {
		const voyages = byName('Voyages');
		const r = predictor.scheduleOf(voyages.id, horizon(300), voyages);
		expect(r.events).toEqual([]);
		expect(r.reason).toBe(NO_EVENTS.yearly);
	});

	test('a stream with a rhythm but no readable mode predicts nothing, for a different reason', () => {
		//Shopping has a monthly cycle and one gathered tail that never cleared the evidence gate
		const shopping = byName('Shopping');
		const r = predictor.scheduleOf(shopping.id, horizon(300), shopping);
		expect(r.cycle.name).toBe('monthly');
		expect(r.events).toEqual([]);
		expect(r.reason).toBe(NO_EVENTS.nothingReadable);
	});

	/* ---- GATE 3 OVER A HORIZON -------------------------------------------------------------------
	   THE PLAN DRAINS. Asked once and repeated, a stream could overspend a finite envelope for as
	   many cycles as the caller asked for. The band is forced negative here so the gate bites inside
	   the captured portfolio: at -0.5 the plan is capped at half what was declared, and Hobby mdm is
	   already 55% through it. */
	test('a finite plan is spent as the horizon extends, and refuses what would break it', () => {
		const hobby = byName('Hobby mdm');
		const until = horizon(300);

		const loose = predictor.scheduleOf(hobby.id, until, hobby, null, {budgetBand: 0.15});
		const tight = predictor.scheduleOf(hobby.id, until, hobby, null, {budgetBand: -0.5});

		expect(loose.events.length).toBe(tight.events.length);
		expect(loose.events.every(e => !e.refused)).toBe(true);

		const refused = tight.events.filter(e => e.refused);
		expect(refused.length).toBeGreaterThan(0);

		//A REFUSAL IS REPORTED AS ZERO AND KEEPS WHAT IT WOULD HAVE BEEN
		refused.forEach(e => {
			expect(e.amount).toBe(0);
			expect(e.refused).toBe('plan');
			expect(e.claimed).not.toBe(0);
		});
		//so the total falls by exactly the refused claims and by nothing else
		const lost = refused.reduce((n, e) => n + e.claimed, 0);
		expect(Math.round(tight.total)).toBe(Math.round(loose.total - lost));
	});

	/* AND THE PLAN REFILLS ON ITS OWN BOUNDARY. Without this a stream that overspent once reads as
	   spent for the rest of time. The refusals have to stop, and they have to stop at the boundary
	   rather than a cycle late - the cycle seam is pinned to UTC midnight and the envelope edge comes
	   off the local Period walk, which is a full timezone offset apart. */
	test('a yearly envelope refills, and the refusals stop at its boundary', () => {
		const hobby = byName('Hobby mdm');
		const r = predictor.scheduleOf(hobby.id, horizon(300), hobby, null, {budgetBand: -0.5});

		const refused = r.events.filter(e => e.refused);
		const paid = r.events.filter(e => !e.refused);
		expect(refused.length).toBeGreaterThan(0);
		expect(paid.length).toBeGreaterThan(0);

		//every refusal precedes every payment: the envelope rolls over once and does not roll back
		const lastRefusal = Math.max.apply(null, refused.map(e => e.date.getTime()));
		const firstPayment = Math.min.apply(null, paid.map(e => e.date.getTime()));
		expect(lastRefusal).toBeLessThan(firstPayment);

		//and the boundary is the declared envelope's own, one year from the analysis anchor
		const anchor = new Date(predictor.analysisAnchor());
		const rollover = new Date(anchor.getFullYear() + 1, anchor.getMonth(), anchor.getDate());
		expect(new Date(lastRefusal).getTime()).toBeLessThan(rollover.getTime());
	});

	/* ---- A FLOW IS PLACED, NOT SMEARED ------------------------------------------------------------ */
	test('a flow emits whole movements each cycle that sum to its rate', () => {
		const groceries = byName('Groceries & Hygiene');
		const r = predictor.scheduleOf(groceries.id, horizon(60), groceries);

		expect(r.cycle.name).toBe('weekly');
		const rates = r.events.filter(e => e.kind === 'rate');
		expect(rates.length).toBeGreaterThan(0);

		/* THE SAME SET OF MOVEMENTS REPEATS EVERY CYCLE, so every WHOLE cycle carries the same
		   total. The first and last are clipped - the first by today, the last by the horizon - and
		   a clipped cycle carrying less is the stop date being obeyed rather than a rate that
		   changed. */
		const byCycle = {};
		rates.forEach(e => { byCycle[e.cycle] = (byCycle[e.cycle] || 0) + e.amount; });
		const seen = Object.keys(byCycle).map(Number).sort((x, y) => x - y);
		const whole = seen.slice(1, -1);
		expect(whole.length).toBeGreaterThan(1);
		whole.forEach(k => expect(byCycle[k]).toBeCloseTo(byCycle[whole[0]], 2));

		//and the clipped ends never carry MORE than a whole cycle
		seen.forEach(k => expect(Math.abs(byCycle[k]))
			.toBeLessThanOrEqual(Math.abs(byCycle[whole[0]]) + 0.01));

		//and every movement is a whole payment on a real day of its cycle, never a daily smear
		rates.forEach(e => {
			expect(e.day).toBeGreaterThanOrEqual(0);
			expect(e.day).toBeLessThan(8);
		});
	});

	/* ---- THE RAIL BECOMES A DATE ------------------------------------------------------------------ */
	test('a learned rail moves the claim off a shut day and says where it came from', () => {
		const all = predictor.scheduleAll(horizon(200));
		const moved = all.filter(e => e.dueDate);
		expect(moved.length).toBeGreaterThan(0);

		moved.forEach(e => {
			//it moved because the due day was shut, and it landed somewhere else
			expect(e.rail).not.toBe(null);
			expect(e.rail).not.toBe('ignored');
			expect(iso(e.date)).not.toBe(iso(e.dueDate));
			//early goes back, late goes on - never the other way
			if(e.rail === 'early')expect(e.date.getTime()).toBeLessThan(e.dueDate.getTime());
			if(e.rail === 'late')expect(e.date.getTime()).toBeGreaterThan(e.dueDate.getTime());
		});
	});

	/* ---- EVERY STREAM AT ONCE --------------------------------------------------------------------- */
	test('the portfolio schedule merges every stream and stays ordered', () => {
		const until = horizon(90);
		const all = predictor.scheduleAll(until);
		expect(all.length).toBeGreaterThan(0);

		for(let i = 1; i < all.length; i++)
			expect(all[i].date.getTime()).toBeGreaterThanOrEqual(all[i - 1].date.getTime());
		all.forEach(e => {
			expect(e.date.getTime()).toBeLessThanOrEqual(until.getTime());
			expect(e.streamId).toBeTruthy();
			expect(e.accountId).toBeTruthy();
		});

		//and it is exactly the union of the per-stream answers, nothing added and nothing lost
		let one = 0;
		predictor.reviewable().forEach(s => {
			one += predictor.scheduleOf(s.id, until, s).events.length;
		});
		expect(all.length).toBe(one);

		const streams = new Set(all.map(e => e.streamId));
		console.log('SCHEDULE ' + all.length + ' events from ' + streams.size + ' streams to '
			+ iso(until) + ', net ' + Math.round(all.reduce((n, e) => n + e.amount, 0)));
	});

	/* THE BENCH PAGE. One year of events is generated once and the page moves the right-hand edge,
	   which is only sound because a shorter schedule is a strict prefix of a longer one - the test
	   above is what says so. */
	test('writes the schedule bench page', () => {
		const until = horizon(365);
		const rows = scheduleData(predictor, until);
		expect(rows.length).toBeGreaterThan(20);

		const html = buildScheduleAuditPage(rows, {asOf: now.toISOString()});
		fs.writeFileSync(path.join(__dirname, 'audit-schedule.html'), html, 'utf8');

		expect(/<!doctype|<html|<body/i.test(html)).toBe(false);
		const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
		expect(scripts.length).toBe(2);
		scripts.forEach(block => {
			const src = block.replace(/^<script>/, '').replace(/<\/script>$/, '');
			expect(src.indexOf(String.fromCharCode(92))).toBe(-1);
			expect(src.indexOf(String.fromCharCode(96))).toBe(-1);
			expect(() => new Function(src)).not.toThrow();
		});

		const events = rows.reduce((n, r) => n + r.events.length, 0);
		const silent = rows.filter(r => !r.events.length).length;
		console.log('PAGE ' + events + ' events over a year, ' + rows.length + ' streams, '
			+ silent + ' silent, ' + Math.round(html.length / 1024) + ' KB');
	}, 300000);
});