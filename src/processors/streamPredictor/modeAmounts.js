/* ==================================================================================================
   §4, PROTOTYPE — HOW MUCH EACH MODE MOVES, AND WHEN THE NEXT ONE LANDS.

   §3 SAYS WHEN, THIS SAYS HOW MUCH. A mode already carries its shape, its days and how sure it is;
   what it does not carry is a number, and a forecast is a date and a number or it is nothing.

   THE STREAM'S OWN LATTICE IS THE DENOMINATOR, NEVER THE MODE'S. A mode that appeared in three
   cycles out of nine is a rate over NINE - over its own three it reads -$73.82 a month when the
   truth is -$24.61, because its buckets only exist where it moved. Every amount here is measured on
   one spine, cut from every leg the stream has in the window, so the modes of a stream add up.

   MEDIAN FOR A LUMP, MEAN FOR A RATE, AND THE SHAPE DECIDES WHICH.

     A LUMP IS A REPEATED THING and a one-off should not move it. Julien's savings transfer is four
     months at exactly $6,000 and two larger transfers to fund something; the median says $6,000, the
     mean says $9,200, and $6,000 is the habit.

     A RATE IS A TOTAL OVER TIME and the median destroys it. Most cycles of a spread are empty, so
     the median cycle is $0.00 - it answers "nothing usually happens" to a question about how much
     money moves. Business Expenses' loose card spend reads $0.00 median against a real -$20.06 a
     cycle.

   BOTH ARE WEIGHTED BY RECENCY, on §3's own cycle weights, for §3's own reason: a habit that changed
   is not a habit that is unreliable. Wages Julien's disability deposits hold 10% of the stream by
   raw share and 2% once the old cycles fade, and 2% is what the stream is now.

   NOTHING HERE IS THE ANSWER YET. §4 is not specified - this is the bench's arithmetic, kept in a
   module so it can be tested and so the page stays a renderer rather than a calculator.
   ================================================================================================== */

import {cycleBuckets, dayInCycle, weightsOf, lumpDays, Shape} from './shapeDetermination';
import {isBusinessDay, isHoliday, settleDate} from './businessCalendar';
import {AMOUNT_CONFIG} from './amountConfig';
import {budgetPosition, breaksPlan, rebaseline, plannedStart, ENVELOPE}
	from './budgetPosition';

const ONE_DAY = 24 * 60 * 60 * 1000;

/* ONE LATTICE FOR THE WHOLE STREAM. Every mode is measured against this, so a mode that was quiet
   for six cycles is quiet for six cycles rather than invisible. */
export function streamSpine(modes, cycle, anchor, taper){
	const all = (modes || []).reduce((acc, m) => acc.concat(m.rawLegs || []), []);
	return cycleBuckets(all, cycle, anchor, taper);
}

const bucketIndexAt = (spine, date) => {
	const t = new Date(date).getTime();
	for(let i = 0; i < spine.length; i++)
		if(t >= spine[i].start.getTime() && t < spine[i].end.getTime())return i;
	return -1;
};

/* HALF THE WEIGHT ON EITHER SIDE - the same middle §3 uses for the day, applied to money. */
export function weightedMiddle(values, weights){
	if(!values.length)return 0;
	const a = values.map((x, i) => ({x: x, w: (weights && weights[i] !== undefined) ? weights[i] : 1}))
		.sort((p, q) => p.x - q.x);
	const total = a.reduce((n, p) => n + p.w, 0);
	if(!total)return a[Math.floor(a.length / 2)].x;
	const half = total / 2;
	let run = 0;
	for(let i = 0; i < a.length; i++){
		run += a[i].w;
		if(run > half)return a[i].x;
		if(run === half)return (a[i].x + a[Math.min(i + 1, a.length - 1)].x) / 2;
	}
	return a[a.length - 1].x;
};

/* WHAT ONE MODE MOVES, PER CYCLE.

   `perCycle` is the number a forecast adds up, whatever the shape: for a lump it is the amount that
   lands on its day, for a rate it is the amount spent across the whole cycle. `kind` says which of
   the two promises it is, because they are drawn differently and a caller must not confuse them.

   THE SHAPE IS AN ARGUMENT BECAUSE THE ANSWER'S SHAPE IS NOT THE WORKING'S. A mode under
   minLumpConfidence still holds its day in explainShape - that is the working, and the reading is
   real - but determineShape answers it as a rate, and a page that read the working would offer a
   date §3 has already refused. Earnin's phone reimbursement is exactly that mode. Pass the ANSWER's
   shape; the mode's own is only the fallback for a caller that has nothing else. */
export function modeAmount(mode, spine, shape, cfg){
	const ac = Object.assign({}, AMOUNT_CONFIG, cfg || {});
	const weights = weightsOf(spine);
	const per = new Array(spine.length).fill(0);
	const count = new Array(spine.length).fill(0);
	(mode.rawLegs || []).forEach(l => {
		const i = bucketIndexAt(spine, l.date);
		if(i >= 0){ per[i] += l.amount; count[i]++; }
	});

	const landed = [];
	per.forEach((x, i) => { if(count[i])landed.push({x: x, w: weights[i], i: i}); });
	const use = shape || mode.shape;
	const lump = use === Shape.lump;
	//GATE 0: a mode nobody could read promises nothing, whatever the arithmetic would have said
	const unread = use === Shape.unknown;

	const wTotal = weights.reduce((n, x) => n + x, 0) || 1;
	const weightedSum = per.reduce((n, x, i) => n + x * weights[i], 0);

	const amount = lump
		? weightedMiddle(landed.map(p => p.x), landed.map(p => p.w))
		: weightedSum / wTotal;

	/* SILENCE IS ITS OWN SIGNAL. The taper makes an old cycle worth less and never worth nothing, so
	   a rate that has ended goes on claiming a fraction of itself forever - the disability deposits
	   still asked for $191.46 a cycle twelve cycles after the leave finished. A rate quiet this long
	   claims zero. It keeps its history and its money share; what it loses is the promise.

	   A LUMP IS LEFT ALONE: how often it turns up is already half of its confidence, and a bill that
	   skipped two months is a bill with a low confidence rather than a bill that has stopped. */
	const quiet = mode.quiet === undefined
		? (landed.length ? spine.length - 1 - landed[landed.length - 1].i : spine.length)
		: mode.quiet;
	const silenced = !lump && quiet >= ac.maxQuietCycles;

	/* AND THE SAME QUESTION FOR A LUMP, ASKED ITS OWN WAY. A rate stops by going silent for a couple
	   of cycles; a bill stops by missing a date it has never missed. Gembah is 43 days past a payment
	   that never took more than 31. */
	const late = lump && mode.overdue !== null && mode.overdue !== undefined
		&& mode.overdue > ac.lateMultiple;

	return {
		kind: lump ? 'lump' : unread ? 'unknown' : 'rate',
		perCycle: (silenced || unread || late) ? 0 : amount,
		silenced: silenced,
		late: late,
		overdue: (mode.overdue === undefined) ? null : mode.overdue,
		unread: unread,
		observed: amount,
		cyclesLanded: landed.length,
		cyclesObserved: spine.length,
		//how many cycles since it last moved: a rate nobody has paid in months is a stale rate
		quiet: quiet,
		total: per.reduce((n, x) => n + x, 0),
		perCycleTotals: per
	};
}

/* ---- WHICH DAYS OF A CYCLE THE BANKS WERE SHUT --------------------------------------------------
   A PAYMENT THAT SLID IS NOT A PAYMENT THAT MOVED. §3 already undoes the bank's weekend to read a
   rhythm; the lanes have to show the same calendar or a reader sees a mark two days off its day and
   concludes the stream is unreliable rather than that the 15th was a Saturday.

   HOLIDAYS AND WEEKENDS ARE TOLD APART because they read differently: a weekend is every week and a
   reader stops seeing it, while a holiday is the explanation for the one month that looks wrong.

   DRAWN ON EVERY LANE, ADJUSTED ON NONE OF THEM. A card is never snapped for closures - it posts
   when the merchant presents it - but the calendar is still the calendar, and seeing that a card
   charge landed on a Sunday is how a reader knows the rule is doing what it says. */
export function closedDays(start, days, country){
	const out = [];
	for(let d = 0; d < days; d++){
		const on = new Date(start.getTime() + d * ONE_DAY);
		if(isBusinessDay(on, country))continue;
		out.push({day: d, holiday: isHoliday(on, country)});
	}
	return out;
}

/* THE NEXT CYCLE, DRAWN. The lattice is walked one step past its end and every lump is placed on the
   day it claims; the rates have no day and travel as a band across the whole cycle. */
export function nextCycle(spine, cycle){
	if(!spine.length || !cycle)return null;
	const last = spine[spine.length - 1];
	const start = new Date(last.end);
	const end = cycle.nextDate(start);
	return {start: start, end: end,
		days: Math.max(1, Math.round((end.getTime() - start.getTime()) / ONE_DAY))};
}

/* ---- WHAT THE BENCH DRAWS ----------------------------------------------------------------------
   ONE SECTION PER ACCOUNT, because an account is where money actually arrives and the two kinds
   settle differently - a card clears once a month whatever day the purchase happened, a current
   account moves the day the money does. A stream paid two ways is two forecasts, not one averaged.

   THE PAST IS SHOWN BECAUSE A PREDICTION WITHOUT ITS CONTEXT IS UNCHECKABLE. Three cycles of what
   actually happened, then the one being claimed, drawn on the same axis and the same scale. */
export function predictionRows(predictor, streamId, stream, opts, cfg){
	const c = Object.assign({}, AMOUNT_CONFIG, cfg || {});
	const o = opts || {};
	const back = o.cyclesBack === undefined ? 3 : o.cyclesBack;
	const answer = predictor.shapeOf(streamId, stream);
	const working = predictor.explainShapeOf(streamId, stream);
	const cycle = answer.cycle;
	if(!cycle)return null;

	const anchor = predictor.analysisAnchor();
	const spine = streamSpine(working.modes, cycle, anchor);
	if(!spine.length)return null;

	/* ---- GATE 3: WHERE THE STREAM STANDS AGAINST ITS ENVELOPE -------------------------------
	   ASKED ONCE, FOR THE WHOLE STREAM, because a yearly declaration is a plan for the stream and
	   not for any one of its modes. */
	const position = budgetPosition(stream, predictor.legsOf(streamId) || [], anchor,
		predictor.analysisNow());

	/* ---- A DECLARATION THE LEDGER HAS ALREADY AGREED WITH -----------------------------------
	   Where a stream was declared and then paid as declared, the declaration is evidence and the
	   mode carrying that first payment may predict the declared amount even though §3 could not
	   read a shape from two cycles. It buys evidence and nothing else: the liveness and budget
	   gates still run. */
	const planned = plannedStart(stream, predictor.legsOf(streamId) || [], cycle, c);

	const byAccount = new Map();
	working.modes.forEach((w, i) => {
		const a = answer.modes[i];
		const amt = modeAmount(w, spine, a.shape);
		const key = w.accountId;
		if(!byAccount.has(key)){
			/* THE ACCOUNT'S OWN NAME, NOT ITS HASH. A reader checking a forecast knows the account by
			   the name on it; ins_25::4759::depository is an identifier, not a place money lands. */
			const acct = (predictor.accountsByHash || {})[key];
			byAccount.set(key, {
				accountId: key, accountType: w.accountType || null,
				name: acct ? acct.name : null, mask: acct ? acct.mask : null, modes: []
			});
		}
		/* THE MODE THAT CARRIES THE MATCHED PAYMENT is the one the declaration speaks for. A
		   declaration is a statement about the STREAM, and crediting a mode that had nothing to do
		   with the movement that matched it would be borrowing someone else's evidence. */
		const carries = !!planned && (w.rawLegs || [])
			.some(l => l && l.transactionId === planned.transactionId);

		/* ---- A PLANNED CLAIM STILL NEEDS A DAY ----------------------------------------------
		   AN AMOUNT WITH NOWHERE TO PUT IT IS NOT A FORECAST. The declaration says how much and how
		   often; it says nothing about when in the cycle, and §3 could not read a day from two
		   movements. So the day falls back to the middle of the days this mode has actually used -
		   the same weighted middle every other lump gets, from the same function, so a planned day
		   and a measured one are not two different kinds of number.

		   THE WOBBLE TRAVELS WITH IT, and on thin evidence it will be wide. That is the honest
		   shape of the claim: Day Care Eleonore's two cheques landed on day 22 and day 14, so the
		   middle is day 18 and it is worth eight days of doubt. */
		const plannedAt = (carries && amt.kind === 'unknown' && cycle)
			? lumpDays(cycleBuckets(w.rawLegs, cycle, anchor, o.taper), 1)[0] : null;

		byAccount.get(key).modes.push({
			label: w.label,
			shape: a.shape,
			days: plannedAt ? [plannedAt.day] : (a.days || []),
			wobble: plannedAt ? [plannedAt.wobble] : (w.wobble || []),
			confidence: a.confidence === undefined ? null : a.confidence,
			moneyShare: a.moneyShare,
			direction: w.direction,
			exceptions: w.exceptions || 0,
			legs: w.legs,
			amount: (amt.kind === 'unknown' && carries) ? planned.amount : amt.perCycle,
			planned: (amt.kind === 'unknown' && carries) ? planned : null,
			observed: (amt.kind === 'unknown' && carries) ? planned.amount : amt.observed,
			silenced: amt.silenced,
			late: amt.late,
			overdue: amt.overdue,
			kind: (amt.kind === 'unknown' && carries) ? 'planned' : amt.kind,
			rail: w.rail || null,
			quiet: amt.quiet,
			cyclesLanded: amt.cyclesLanded,
			rawLegs: w.rawLegs
		});
	});

	/* ---- WOULD THE NEXT CYCLE BREAK THE PLAN? -----------------------------------------------
	   EVERY MODE'S NEXT CLAIM, SUMMED, AGAINST WHAT THE ENVELOPE HAS LEFT. If the stream would end
	   up further than budgetBand past its plan, the plan is spent: every dated claim and every rate
	   goes to zero for this cycle. Not scaled down - zero. */
	let claimed = 0;
	byAccount.forEach(acc => acc.modes.forEach(m => { claimed += m.amount; }));
	/* A STREAM THAT WAS GOING TO CLAIM NOTHING CANNOT BE REFUSED ANYTHING. Voyages is 138% through a
	   plan it has already overspent, and every one of its modes is unread - reporting it as "capped"
	   would credit the budget gate with a silence the evidence gate had already produced. */
	const capped = claimed !== 0 && breaksPlan(position, claimed, c.budgetBand);
	if(capped)byAccount.forEach(acc => acc.modes.forEach(m => {
		m.cappedAmount = m.amount;
		m.amount = 0;
		m.capped = true;
	}));

	/* THE LANES: the last `back` cycles as they happened, then the one being claimed. A cycle is
	   drawn on its own day axis, so a 31-day month has one column a 30-day month never fills. */
	const nxt = nextCycle(spine, cycle);
	const window = spine.slice(Math.max(0, spine.length - back));

	const accounts = [];
	byAccount.forEach(acc => {
		const mine = acc.modes;
		const lanes = window.map(b => ({
			start: b.start, end: b.end,
			days: Math.max(1, Math.round((b.end.getTime() - b.start.getTime()) / ONE_DAY)),
			closed: closedDays(b.start,
				Math.max(1, Math.round((b.end.getTime() - b.start.getTime()) / ONE_DAY)), o.country),
			predicted: false,
			events: mine.reduce((out, m) => out.concat((m.rawLegs || [])
				.filter(l => {
					const t = new Date(l.date).getTime();
					return l.accountId === acc.accountId
						&& t >= b.start.getTime() && t < b.end.getTime();
				})
				.map(l => ({day: dayInCycle(l, b), amount: l.amount, label: m.label}))), [])
		}));

		/* ---- THE CLAIM IS MOVED TO WHERE IT WILL ACTUALLY LAND ----------------------------------
		   §3 LEARNED WHAT THE BANKS DO TO THIS RAIL; this is where that becomes a date. A payroll
		   due on a Saturday is paid on the Friday, a direct debit is collected on the Monday, and a
		   card posts on the Saturday - so the day drawn is the settled day, not the due day, and
		   `movedFrom` keeps the due day so the page can show the slide rather than hide it.

		   A MODE WITH NO LEARNED RAIL IS NOT MOVED. Not enough closures have been met to know which
		   way it goes, and guessing would put the money on a day nothing has ever landed on. */
		if(nxt)lanes.push({
			start: nxt.start, end: nxt.end, days: nxt.days,
			closed: closedDays(nxt.start, nxt.days, o.country),
			predicted: true,
			/* A PLANNED CLAIM IS DRAWN LIKE A LUMP, because it is one: an amount on a day. Where it
			   differs is the source of both numbers, and the mode says so. */
			events: mine.filter(m => m.kind === 'lump' || m.kind === 'planned')
				.reduce((out, m) => out.concat(m.days.map((d, k) => {
					const due = new Date(nxt.start.getTime() + d * ONE_DAY);
					const rule = m.rail ? m.rail.closures : null;
					const at = settleDate(due, rule, o.country);
					const day = Math.round((at.getTime() - nxt.start.getTime()) / ONE_DAY);
					return {
						day: day, amount: m.amount, label: m.label,
						wobble: m.wobble[k] || 0, confidence: m.confidence,
						movedFrom: day === d ? null : d,
						rail: rule
					};
				})), []),
			rate: mine.filter(m => m.kind === 'rate')
				.reduce((n, m) => n + m.amount, 0),
			rateModes: mine.filter(m => m.kind === 'rate').length
		});

		accounts.push(Object.assign({}, acc, {lanes: lanes}));
	});

	//the account carrying the most money leads, because that is the forecast a reader checks first
	accounts.sort((a, b) => b.modes.reduce((n, m) => n + m.moneyShare, 0)
		- a.modes.reduce((n, m) => n + m.moneyShare, 0));

	/* AND WHERE A REFILLING BUDGET SITS AGAINST WHAT IS ACTUALLY BEING SPENT. This changes no
	   forecast - the observed rate is already what is predicted - it is the number that says the
	   BUDGET is wrong rather than the spending.

	   ASKED PER ACCOUNT, because a transfer between two of your own accounts nets to nothing at the
	   stream and moves both balances. Savings reads $0 a month summed, and -$6,000 a month out of
	   Spending, which is the number a balance forecast for Spending actually needs. */
	const legs = predictor.legsOf(streamId) || [];
	accounts.forEach(acc => {
		let rate = 0;
		acc.modes.forEach(m => { rate += m.capped ? m.cappedAmount : m.amount; });
		acc.budget = budgetPosition(stream, legs, anchor, predictor.analysisNow(), acc.accountId);
		acc.rate = rate;
		acc.rebaseline = rebaseline(acc.budget, rate);
	});

	let perCycle = 0;
	accounts.forEach(acc => acc.modes.forEach(m => { perCycle += m.capped ? m.cappedAmount : m.amount; }));

	return {cycle: cycle, declared: stream.period, accounts: accounts,
		cyclesObserved: spine.length,
		planned: planned,
		budget: position,
		capped: capped,
		rebaseline: rebaseline(position, perCycle)};
}

export default predictionRows;
