/* ==================================================================================================
   A STREAM GROWN FROM ITS DNA — TEST INSTRUMENT, NOT PRODUCTION.

   EVERY RULE IN THIS MODULE WAS FOUND BY READING ONE LEDGER. That is the right way to find them and
   the wrong way to trust them: a rule tuned until it agrees with sixty streams has been fitted to
   sixty streams, and nothing in that exercise can tell you which of the rules would survive the
   sixty-first.

   SO THE TRUTH IS WRITTEN DOWN FIRST AND THE LEDGER IS GROWN FROM IT. A mode is described by the
   parameters that actually produce its behaviour - when it is due, how far it wanders, how often it
   turns up at all, what it costs, which way the bank moves it, when it started and whether it
   stopped - and transactions are generated from that description. The detector then sees only the
   transactions, and the question is whether what comes back is what went in.

   WHAT THIS CANNOT TELL YOU. The DNA is the model's own vocabulary, so a round trip proves the
   detector inverts ITS OWN assumptions. A stream that changes rhythm halfway through the year, two
   payees that are really one merchant, a habit that responds to something outside the ledger - none
   of those can be expressed here, and all of them exist. This measures calibration and coverage. It
   does not measure whether the model is right about the world, and a good score must not be read as
   though it did.
   ================================================================================================== */

import {isBusinessDay} from './businessCalendar';
import {Period} from '../../Time';

const DAY = 24 * 60 * 60 * 1000;
export const CYCLE_DAYS = {weekly: 7, semimonthly: 15, monthly: 30};

/* ---- A REPEATABLE RANDOM ------------------------------------------------------------------------
   SEEDED, BECAUSE A FAILING CASE HAS TO BE REPRODUCIBLE. A harness that cannot be re-run on the seed
   that broke it produces anecdotes rather than findings. */
export function rng(seed){
	let s = (seed >>> 0) || 1;
	const next = () => {
		s ^= s << 13; s >>>= 0;
		s ^= s >> 17;
		s ^= s << 5; s >>>= 0;
		return s / 4294967296;
	};
	next.pick = arr => arr[Math.floor(next() * arr.length) % arr.length];
	next.between = (lo, hi) => lo + next() * (hi - lo);
	next.int = (lo, hi) => Math.floor(next.between(lo, hi + 1 - 1e-9));
	next.chance = p => next() < p;
	return next;
}

/* ---- ONE MODE'S DNA ------------------------------------------------------------------------------
   THE PARAMETERS ARE CHOSEN SO EVERY BRANCH OF THE DECISION TREE IS REACHABLE. A high `jitter` with
   one movement a cycle produces the payment whose date wanders; a low `arrivalP` pushes it under the
   arrival bar; `diedAt` is what the liveness gate has to catch; `rail` only becomes learnable if
   enough due days happen to land on closures, and where they do not, ABSENT is the right answer. */
export function randomMode(r, opts){
	const o = opts || {};
	const kind = o.kind || r.pick(['lump', 'lump', 'lump', 'wandering', 'spread', 'sparse']);
	const cycleDays = o.cycleDays || 30;
	const out = {
		kind: kind,
		accountType: o.accountType || r.pick(['realTime', 'realTime', 'deferred']),
		direction: o.direction || (r.chance(0.75) ? 'out' : 'in'),
		payee: o.payee || 'PAYEE ' + r.int(1000, 9999),
		amount: 0,
		amountJitter: 0,
		arrivalP: 1,
		jitter: 0,
		days: [],
		perMonth: 1,
		rail: 'ignored',
		exceptionP: 0,
		bornAt: 0,
		diedAt: null
	};

	const size = r.pick([9.99, 25, 50, 62, 99, 250, 1700, 2626, 3121, 6000]);
	out.amount = (out.direction === 'out' ? -1 : 1) * size;

	if(kind === 'lump'){
		out.days = [r.int(1, cycleDays - 2)];
		out.jitter = r.int(0, 2);
		out.arrivalP = r.between(0.85, 1);
		out.amountJitter = r.between(0, 0.05);
		out.exceptionP = r.chance(0.3) ? r.between(0.05, 0.15) : 0;
	}else if(kind === 'wandering'){
		//one a cycle, certain to come, no telling when - the Earnin reimbursement
		out.days = [r.int(1, cycleDays - 2)];
		out.jitter = r.int(5, Math.max(6, Math.floor(cycleDays / 3)));
		out.arrivalP = r.between(0.85, 1);
		out.amountJitter = r.between(0, 0.05);
	}else if(kind === 'spread'){
		out.perMonth = r.between(2.5, 9);
		out.amountJitter = r.between(0.3, 0.7);
		out.clusters = r.chance(0.5)
			? [r.int(0, cycleDays - 1), r.int(0, cycleDays - 1)]
			: null;
	}else{
		//sparse: too little to read, and the honest answer is that we do not know
		out.days = [r.int(1, cycleDays - 2)];
		out.jitter = r.int(0, 3);
		out.arrivalP = r.between(0.15, 0.35);
		out.amountJitter = r.between(0, 0.4);
	}

	if(out.accountType === 'realTime')out.rail = r.pick(['early', 'late', 'ignored']);
	//a mode that ran and stopped: the liveness gate has to notice
	if(o.dies)out.diedAt = o.diesAt;
	return out;
}

/* WHAT ONE CYCLE OF THIS STREAM MOVES, from the parameters rather than from any ledger: a dated
   mode moves its amount once per day it names, a flow moves its amount as often as its rate says. */
/* A BUDGET IS WHAT YOU EXPECT TO SPEND, so a dated mode counts at the rate it actually turns up.
   A $1,700 charge that arrives in one cycle out of five is $340 of envelope, not $1,700 - budgeting
   it at full size made the plan gate five times too generous on any stream carrying one. */
const cycleTotal = (modes, cycleDays) => modes.reduce((n, m) => n
	+ (m.kind === 'spread' ? m.amount * m.perMonth * (cycleDays / 30)
		: m.amount * m.days.length * (m.arrivalP === undefined ? 1 : m.arrivalP)), 0);

const YEAR = 365;
function declaredFrom(modes, cycleDays, declared){
	const perCycle = cycleTotal(modes, cycleDays);
	const scale = (declared === 'yearly' || declared === 'biyearly') ? YEAR / cycleDays : 1;
	return Math.round(perCycle * scale);
}

/* ---- ONE STREAM'S DNA ---------------------------------------------------------------------------- */
export function randomStream(r, i, opts){
	const o = opts || {};
	const cycle = o.cycle || r.pick(['monthly', 'monthly', 'monthly', 'weekly', 'semimonthly']);
	const cycleDays = CYCLE_DAYS[cycle];
	const declared = o.declaredPeriod
		|| (r.chance(0.25) ? 'yearly' : cycle);

	const howMany = o.modes || (r.chance(0.7) ? 1 : r.int(2, 3));
	const accounts = ['acct-A', 'acct-B'];
	const modes = [];
	for(let k = 0; k < howMany; k++){
		/* THE ACCOUNT IS CHOSEN FIRST, AND THE TYPE FOLLOWS IT. Rolling a mode's accountType
		   independently of the account it lands on produced modes labelled "deferred" sitting in
		   the checking account - and the detector reads the type off the ACCOUNT, so the DNA and
		   the portfolio were describing two different worlds. The rail follows too: only a
		   real-time account is ever read around closures. */
		const accountId = r.chance(0.8) ? accounts[0] : accounts[1];
		const m = randomMode(r, {cycleDays: cycleDays,
			accountType: accountId === accounts[0] ? 'realTime' : 'deferred'});
		m.accountId = accountId;
		/* A MODE THAT STOPPED PARTWAY, EXPRESSED AS A FRACTION OF ITS OWN RUN. As a cycle index it
		   was not portable: cycle 3 of a monthly stream is a quarter of the way in, cycle 3 of a
		   weekly one is three weeks into a year and the stream reads as long dead. The index is
		   resolved once the lattice is known. */
		if(r.chance(0.08))m.diesFrac = r.between(0.2, 0.5);
		modes.push(m);
	}

	return {
		id: 'syn-' + i,
		name: 'Synthetic ' + i,
		cycle: cycle,
		cycleDays: cycleDays,
		declaredPeriod: declared,
		/* WHAT A PERSON WOULD ACTUALLY HAVE WRITTEN DOWN. Summing the modes' amounts was wrong for
		   every stream carrying a flow: a flow's `amount` is the size of ONE payment, so a stream
		   moving $3,096 a cycle declared $1,396 and the budget gate was being tested against a
		   number nobody could have meant. A declaration states the money per DECLARED period, so a
		   yearly envelope is the cycle total times the cycles in a year. */
		declaredAmount: r.chance(0.7) ? declaredFrom(modes, cycleDays, declared) : 0,
		isZeroSumStream: false,
		modes: modes
	};
}

/* ---- GROWING THE LEDGER --------------------------------------------------------------------------
   THE SEAM IS THE ANCHOR and cycles are counted forward from it, exactly as cycleBuckets walks them,
   so a day generated as day 12 is the day the detector should read back as 12. Dates are built at UTC
   midnight, which is what a real ledger carries.

   THE RAIL IS APPLIED LAST, to the date the movement was due. That is the order it happens in life:
   the bill falls on a Saturday and the bank moves it, so the ledger never holds the due date at all -
   which is exactly why the detector has to infer the rule rather than read it. */
const shift = (date, rail, country) => {
	if(rail === 'ignored' || isBusinessDay(date, country))return date;
	const step = rail === 'early' ? -DAY : DAY;
	let probe = new Date(date.getTime() + step), guard = 0;
	while(!isBusinessDay(probe, country) && ++guard < 30)
		probe = new Date(probe.getTime() + step);
	return probe;
};

/* ---- THE SAME LATTICE THE DETECTOR WALKS --------------------------------------------------------
   A MONTH IS NOT THIRTY DAYS. The first cut of this generator strode thirty days a cycle while the
   detector cut real calendar months, and over twelve cycles the two drifted five days apart: weekly
   streams came back on the exact day 93% of the time and monthly ones 1%, with a mean error of -2.7
   days. The detector was right and the instrument was wrong, which is the failure mode a synthetic
   bench exists to have loudly rather than quietly.

   SO THE SEAMS COME FROM Period.nextDate, the same walk cycleBuckets uses, and each cycle carries its
   own length. Pinned to UTC midnight for the same reason the buckets are: both sides of a day
   subtraction have to be midnights or the arithmetic loses a day to the timezone. */
const utcSeam = d => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

export function cycleSeams(cycle, anchor, cycles){
	const period = Period[cycle];
	const out = [];
	let cur = new Date(anchor);
	for(let i = 0; i <= cycles; i++){
		out.push(utcSeam(cur));
		cur = period.nextDate(cur);
	}
	return out;
}

/* EVERY STREAM IS WATCHED OVER THE SAME CALENDAR WINDOW, each on its own lattice.

   COUNTING CYCLES INSTEAD OF DAYS WAS A BUG, and an expensive one. Twelve cycles of a weekly stream
   is twelve WEEKS, so with a twelve-MONTH monthly stream in the same portfolio the clock ran nine
   months past the weekly stream's last payment - and the cycle detector, correctly, called it dead.
   Seventy-seven of the hundred and thirty-four rhythm misses were that: the detector found weekly,
   found semimonthly, found biweekly, and then the staleness gate threw the reading away because the
   instrument had stopped feeding the stream nine months ago.

   SO THE WINDOW IS A SPAN OF MONTHS and each stream fills it with as many of its own cycles as fit. */
export function seamsUntil(cycle, anchor, horizon){
	const period = Period[cycle];
	const out = [];
	let cur = new Date(anchor), guard = 0;
	while(++guard < 2000){
		const s = utcSeam(cur);
		out.push(s);
		if(s.getTime() >= horizon.getTime())break;
		cur = period.nextDate(cur);
	}
	//the last seam is the first one at or past the horizon, so the cycle before it is the last full one
	return out;
}

export function growLegs(stream, anchor, seams, r, country){
	const legs = [];
	const cycles = seams.length - 1;
	const push = (mode, when, amount) => legs.push({
		date: new Date(when),
		amount: Math.round(amount * 100) / 100,
		accountId: mode.accountId,
		description: mode.payee
	});

	stream.modes.forEach(mode => {
		const jitterAmount = () => mode.amount
			* (1 + (r() * 2 - 1) * (mode.amountJitter || 0));

		for(let c = 0; c < cycles; c++){
			if(c < (mode.bornAt || 0))continue;
			if(mode.diedAt !== null && mode.diedAt !== undefined && c >= mode.diedAt)continue;
			const start = seams[c];
			//this cycle's own length, which is 28, 29, 30 or 31 for a month
			const span = Math.round((seams[c + 1].getTime() - start.getTime()) / DAY);

			if(mode.kind === 'spread'){
				/* HOW MANY THIS CYCLE IS A COUNT, NOT A RATE. A rate of 3.4 a month means three some
				   months and four others, and rounding it every cycle would manufacture a regularity
				   the stream does not have. */
				const perCycle = mode.perMonth * (span / 30);
				let n = Math.floor(perCycle);
				if(r.chance(perCycle - n))n++;
				for(let k = 0; k < n; k++){
					const day = mode.clusters
						? (mode.clusters[k % mode.clusters.length] + r.int(-1, 1) + span) % span
						: r.int(0, span - 1);
					push(mode, new Date(start.getTime() + day * DAY), jitterAmount());
				}
				continue;
			}

			if(!r.chance(mode.arrivalP))continue;
			mode.days.forEach(d => {
				const wobble = mode.jitter ? r.int(-mode.jitter, mode.jitter) : 0;
				let day = d + wobble;
				if(day < 0)day = 0;
				if(day > span - 1)day = span - 1;
				const due = new Date(start.getTime() + day * DAY);
				push(mode, shift(due, mode.rail, country), jitterAmount());
			});
			//an off-pattern one-off: a late month, a double payment
			if(mode.exceptionP && r.chance(mode.exceptionP))
				push(mode, new Date(start.getTime() + r.int(0, span - 1) * DAY), jitterAmount());
		}
	});

	legs.sort((a, b) => a.date - b.date);
	return legs;
}

/* ---- A PORTFOLIO THE PREDICTOR WILL ACCEPT -------------------------------------------------------
   THE SAME SHAPE A REAL CAPTURE HAS, and no more of it than the module reads: accounts by hash, a
   master stream whose leaves are the terminal streams, and transactions carrying a streamAllocation.
   Building it by hand rather than trimming a real one keeps the instrument honest about what the
   module actually depends on. */
export function buildPortfolio(streams, anchor, months, r, opts){
	const o = opts || {};
	const country = o.country || 'US';
	const transactions = [];
	let n = 0;

	/* THE WINDOW, IN MONTHS, AND EVERY STREAM IS WATCHED FOR ALL OF IT. Today sits on the far edge,
	   so a stream that is still running has a payment in its last cycle and a stream that stopped
	   is genuinely silent - which is the only way the liveness gate can be tested at all. */
	const horizon = cycleSeams('monthly', anchor, months).pop();

	streams.forEach(stream => {
		const seams = seamsUntil(stream.cycle, anchor, horizon);
		//a death written as a fraction of the run becomes a cycle index once the lattice is known
		stream.cycles = seams.length - 1;
		stream.modes.forEach(m => {
			if(m.diesFrac)m.diedAt = Math.max(1, Math.round(stream.cycles * m.diesFrac));
		});
		growLegs(stream, anchor, seams, r, country).forEach(leg => {
			transactions.push({
				transactionId: 'syn-t-' + (n++),
				date: leg.date.toISOString(),
				amount: leg.amount,
				description: leg.description,
				userInstitutionAccountId: leg.accountId,
				streamAllocation: [{streamId: stream.id, amount: leg.amount}]
			});
		});
	});

	const today = horizon;
	return {
		version: 'synthetic',
		capturedAt: today.toISOString(),
		today: today.toISOString(),
		country: country,
		timeZoneOffset: 0,
		accounts: [
			{hash: 'acct-A', name: 'Synthetic Checking', mask: '0001', type: 'depository'},
			{hash: 'acct-B', name: 'Synthetic Card', mask: '0002', type: 'credit'}
		],
		accountTypes: {'acct-A': 'checking', 'acct-B': 'credit'},
		masterStream: {
			name: 'master',
			id: 'syn-master',
			children: streams.map(s => ({
				id: s.id,
				name: s.name,
				period: s.declaredPeriod,
				isSavings: false,
				isZeroSumStream: !!s.isZeroSumStream,
				expAmountHistory: s.declaredAmount
					? [{amount: s.declaredAmount, startDate: new Date(anchor).toISOString()}]
					: [{amount: 0, startDate: new Date(anchor).toISOString()}]
			}))
		},
		transactions: transactions
	};
}

export default buildPortfolio;
