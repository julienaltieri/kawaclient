import React from 'react';
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DS from '../DesignSystem.js';
import Core from '../core.js';
import {reportingConfig} from '../processors/ReportingCore.js';
import {reconstruct, forecast, histogramOf, accountRoutingOf, dayKey, monthlyExpectationAt,
	groupByStream, pointPrediction, dayLabel, TIERS, observedSettlement, settlementInReading,
	inferSettlements} from '../processors/BankBalance.js';

/* ==================================================================================================
   THE BALANCE FORECAST BENCH - the numbers behind page three, on real data.

   The tile's tests prove the model is self-consistent, not that it is right about THIS portfolio.
   Whether a stream is regular is a question about real transactions, and no fixture can answer it.

   ONE HEADLINE NUMBER, so improvements can be compared rather than argued about.

     surface error  = integral |predicted balance - actual balance| dt, over the settled month
     normaliser     = integral |actual balance| dt, over the same days
     accuracy       = 1 - surface/normaliser

   Dollar-days rather than dollars, because a balance chart is a CURVE and being wrong for a day is a
   smaller error than being wrong for three weeks - a plain end-of-month difference cannot tell those
   apart and would score a forecast that was wrong all month and right on the last day as perfect.
   Normalising by the actual integral makes it comparable across months and across balances: without
   it, the same model scores better in a month that simply held less money.

   The forecast it scores is run OUT OF SAMPLE - shapes and routing built only from transactions dated
   before the window opened - so it is the prediction that would have been made on the day.
   ================================================================================================== */

const DAY = 86400000;
const money = v => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString();

const Wrap = styled.div`
	max-width:60rem; margin:0 auto; color:${props => DS.getStyle().bodyText};
`
/* MOBILE FIRST, because that is where it is read. A pre-formatted table cannot fit 360 pixels and
   there is no font size at which it can - so the screen gets stacked rows that wrap, and the CLIPBOARD
   gets the aligned columns. Two renderings of one dataset, each shaped for the reader it has. */
const Score = styled.div`
	background:${props => DS.getStyle().UIElementBackground};
	border-radius:${DS.borderRadius}; padding:${DS.spacing.xs}rem;
	margin-bottom:${DS.spacing.xs}rem;
`
const Big = styled.div`
	font-size:2rem; font-weight:400; line-height:1.1; font-family:Barlow,sans-serif;
`
const Note = styled.div`
	font-size:${DS.fontSize.little}rem; color:${props => DS.getStyle().bodyTextSecondary};
	margin-top:0.15rem;
`
const Row = styled.div`
	display:grid; grid-template-columns:1fr auto; gap:0.1rem 0.5rem;
	padding:0.45rem 0; border-top:1px solid ${props => DS.getStyle().borderColor};
`
const Name = styled.div`font-size:${DS.fontSize.body}rem; overflow-wrap:anywhere;`
const Tier = styled.div`
	font-size:${DS.fontSize.little}rem; white-space:nowrap; align-self:start;
	color:${props => props.$t === 3 ? DS.getStyle().bodyTextSecondary : DS.getStyle().bodyText};
`
const Line = styled.div`
	grid-column:1 / -1; font-size:${DS.fontSize.little}rem;
	color:${props => DS.getStyle().bodyTextSecondary};
	font-family:Barlow,sans-serif; overflow-wrap:anywhere;
`
const Small = styled.span`
	font-size:${DS.fontSize.little}rem; color:${props => DS.getStyle().bodyTextSecondary};
`
const Head = styled.div`
	font-size:${DS.fontSize.little}rem; font-weight:600; margin-top:${DS.spacing.s}rem;
	color:${props => DS.getStyle().bodyTextSecondary};
`
const Bar = styled.div`display:flex; gap:${DS.spacing.xxs}rem; margin:${DS.spacing.xs}rem 0;`
const Btn = styled.button`
	appearance:none; cursor:pointer; font:inherit; font-size:${DS.fontSize.little}rem;
	background:none; color:${props => DS.getStyle().bodyText};
	border:1px dashed ${props => DS.getStyle().borderColor};
	padding:0.25rem 0.7rem; border-radius:${DS.borderRadiusSmall};
`

export default class BalanceBench extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {accounts:null, copied:null, open:null}
	}
	componentDidMount(){
		Core.getAccountsWithBalances()
			.then(a => this.updateState({accounts:a||[]}))
			.catch(() => this.updateState({accounts:[]}))
	}

	/* ---- the same inputs the tile uses ----------------------------------------------------------- */
	/* ACTIVE STREAMS ONLY. A closed stream carries an endDate and is not going to move money again;
	   listing it invites auditing a prediction nobody will ever see, and it pads the table with rows
	   whose only honest verdict is "not applicable". getAllTerminalStreams(true) is the model's own
	   filter, so this agrees with every other view rather than inventing a second definition. */
	terminals(){const m = Core.getMasterStream(); return m ? m.getAllTerminalStreams(true) : []}
	credit(){return (this.state.accounts||[]).filter(a => a.type === "credit").map(a => a.hash)}
	spending(){
		const dep = (this.state.accounts||[]).filter(a => a.type === "depository"
			&& a.current !== undefined)
		const chk = dep.filter(a => (a.subtype||"").toLowerCase().indexOf("check") > -1)
		return (chk.length ? chk : dep).map(a => a.hash)
	}
	today(){const n = new Date()
		return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()))}

	/* HOW FAR BACK TO LOOK, and the default is SHORT.
	   Three years of history was the wrong instrument: a stream is coherent within its own year, and
	   before that it is a different stream wearing the same name - a rent that has moved, a childcare
	   bill that changed provider, a salary from another job. Averaging those together produces a shape
	   that describes nothing that is currently happening.

	   The floor is the start of the CURRENT reporting year, because a stream's definition is set
	   against that cycle and history before it belongs to the previous one. The ceiling is three
	   months, which is long enough to see a monthly rhythm three times over. Whichever is SHORTER
	   wins - in February that is a few weeks, and a few weeks of truth beats three years of averages.

	   The alternatives are offered beside it rather than argued about: the bench scores every window,
	   so "does a longer lookback help" is answered by the number rather than by me. */
	cycleStart(now){
		const day = (Core.getUserData() || {}).userPreferences
			? ((Core.getUserData().userPreferences || {}).reportingStartingDay
				|| reportingConfig.startingDay) : reportingConfig.startingDay
		const m = reportingConfig.startingMonth - 1
		let start = new Date(Date.UTC(now.getUTCFullYear(), m, day))
		if(start > now)start = new Date(Date.UTC(now.getUTCFullYear() - 1, m, day))
		return start
	}
	windows(now){
		const threeMonths = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3,
			now.getUTCDate()))
		const cycle = this.cycleStart(now)
		const short = threeMonths > cycle ? threeMonths : cycle
		return [
			["short", short],
			["cycle", cycle],
			["1 year", new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()))],
			["all", new Date(0)]
		]
	}
	anchor(){
		const keep = this.spending()
		return (this.state.accounts||[]).filter(a => a.current !== undefined
			&& keep.indexOf(a.hash) > -1).reduce((s,a) => s + a.current, 0)
	}
	ledger(){
		const keep = this.spending()
		return (this.props.transactions||[])
			.filter(t => keep.indexOf(t.userInstitutionAccountId) > -1)
			.map(t => ({date:t.date, amount:t.amount, accountHash:t.userInstitutionAccountId}))
	}
	byStream(){
		if(this._byStream)return this._byStream
		const now = this.today()
		const dir = {}
		this.terminals().forEach(s => {
			const a = monthlyExpectationAt(s, now, "monthly")
			dir[s.id] = a < 0 ? -1 : (a > 0 ? 1 : 0)
		})
		this._byStream = groupByStream(this.props.transactions, this.terminals().map(s => s.id),
			id => dir[id])
		return this._byStream
	}

	/* ---- the score, and who is responsible for it ----------------------------------------------
	   The headline is one number so improvements can be compared rather than argued about. The
	   per-stream figure beside it answers the only question that follows from a bad one: WHICH stream.

	   PER-STREAM ERROR IS THE STREAM ON ITS OWN, not its effect on the total.

	   Leave-one-out was tried and is wrong here, for a reason worth keeping: it credits CANCELLATION.
	   A stream forecast badly whose error happens to offset another stream's error scores near zero,
	   because removing it alone changes little - and that offset is luck, not a property of either
	   stream and not something anyone controls. Next month it cancels the other way and both look
	   terrible with nothing having changed.

	   So each stream is reconstructed alone: its own predicted cumulative curve against its own actual
	   cumulative curve, both starting from zero, and the dollar-days between them. That number is a
	   fact about that stream and nothing else. It is divided by the same account-level denominator as
	   the headline, so a stream's figure reads directly as "this much of a full-scale error is mine". */
	analyse(from, monthsBack){
		const back = monthsBack || 0
		const key = (from ? from.getTime() : "default") + "|" + back
		this._cache = this._cache || {}
		if(this._cache[key])return this._cache[key]
		const now = this.today()
		const since = from || this.windows(now)[0][1]
		const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate()
		const c = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - back,
			Math.min(now.getUTCDate(), lastDay)))
		const open = new Date(c.getTime() - 15*DAY), close = new Date(c.getTime() + 15*DAY)
		const record = reconstruct(this.ledger(), now, this.anchor(), open)
			.filter(p => p.date <= close)
		if(record.length < 2)return null

		const byStream = this.byStream()
		const keep = this.spending(), cards = this.credit(), fallback = keep[0]
		const shapes = {}, dir = {}, sliced = {}, seen = {}
		this.terminals().forEach(t => {
			//OUT OF SAMPLE at the top, no further back than the lookback at the bottom
			seen[t.id] = byStream[t.id].filter(x => x.date < open && x.date >= since)
			/* THE SHAPE learns only from the account being predicted. A card payment and a savings
			   transfer both touch two accounts, and learning from both sides at once averages an
			   outflow with its own mirror - describing no account and predicting neither. */
			sliced[t.id] = seen[t.id].filter(x => keep.indexOf(x.accountHash) > -1)
			shapes[t.id] = histogramOf(sliced[t.id], {prefer: t.getPreferredPeriod
				? t.getPreferredPeriod() : "monthly"})
			const a = monthlyExpectationAt(t, open, "monthly")
			dir[t.id] = a < 0 ? -1 : (a > 0 ? 1 : 0)
		})
		/* ROUTING SEES EVERY ACCOUNT, because deciding WHICH account a stream lives on is the one
		   question that cannot be answered from a single account's ledger.

		   Routing off the filtered set was a real fault and an expensive one: a stream paid entirely
		   by credit card has no checking history, so it routed to `undefined`, fell through to the
		   default account, and was forecast onto checking where nothing of it ever happens. Guaranteed
		   maximum error, on exactly the streams the model understands best - a renter's insurance that
		   pays $10 like clockwork scored 0%.

		   The default is now reserved for a stream with no history AT ALL. A stream with history that
		   simply is not here belongs somewhere else, and saying so is the whole point of routing. */
		const routed = accountRoutingOf(seen, id => dir[id])
		const days = Math.round((record[record.length-1].date - open)/DAY)
		const covers = h => keep.indexOf(h || fallback) > -1
		//decided below, once `observed` is known - a stream on this account that is budgeted at
		//nothing and still moves money IS the settlement, whether or not the ledger pairs it
		let settles = h => cards.indexOf(h) > -1
		/* A LONG-PERIOD BUDGET SPREADS ITS REMAINDER, not its twelfth.
		   A $10,000 yearly stream with $6,000 already gone has $4,000 left, and dividing the whole
		   budget by twelve forecasts money that has already been spent - twice over by December. The
		   reporting side of the app has always done this (getProjectedPeriodicAmountForStream: "if
		   there is $600 left to spend over 4 months, this should return $150"), and the balance view
		   was the only place still dividing by twelve.

		   It reads the stream's own budget for its own period, subtracts what the ledger says has gone
		   since that period began, and spreads the rest over the months remaining. Clamped at zero in
		   the direction of spending: a budget already overspent predicts nothing further rather than
		   predicting money coming back. */
		const cycleFrom = this.cycleStart(now)
		const monthsLeft = Math.max(1, 12 - Math.round((open - cycleFrom)/(30.44*DAY)))
		const spentSince = {}
		this.terminals().forEach(t => {
			let v = 0
			byStream[t.id].forEach(x => {if(x.date >= cycleFrom && x.date < open
				&& keep.indexOf(x.accountHash) > -1)v += x.amount})
			spentSince[t.id] = v
		})
		const longPeriod = t => {
			const p = t.getPreferredPeriod ? t.getPreferredPeriod() : "monthly"
			return p === "yearly" || p === "biyearly" || p === "bimonthly"
		}
		/* A ZERO-SUM STREAM STILL MOVES THIS ACCOUNT.
		   "Zero sum" means the money comes back eventually, and that is true of a refund landing in
		   the same account and false of a transfer between two. A credit-card payment nets to nothing
		   across the pair and takes several thousand dollars out of checking every week, so a budget
		   of $0 predicts $0 and the largest recurring outflow in the portfolio is simply missing.

		   Where the declared budget is nothing and the ledger says otherwise, the ledger wins: the
		   mean of what actually left this account over the lookback, per month. The MEAN rather than a
		   median because these amounts are genuinely variable - a card bill is whatever was spent -
		   and the median of a variable series systematically under-predicts its own total. */
		const monthsSeen = Math.max(1, (open - since)/(30.44*DAY))
		const observed = {}
		this.terminals().forEach(t => {
			let v = 0
			sliced[t.id].forEach(x => {v += x.amount})
			observed[t.id] = v/monthsSeen
		})
		/* three ways to know the ledger already carries the payment, in order of how directly they
		   say so: a stored pair, an inferred one (same amount leaving here and arriving on a card
		   within days), or a stream on this account budgeted at nothing that still moves money. Any of
		   them means synthesising a second settlement would pay the card twice. */
		const inferred = inferSettlements(this.props.transactions, keep, cards)
		this._settlements = inferred
		if(observedSettlement(this.props.transactions, keep, cards).count > 0
			|| inferred.length > 0
			|| settlementInReading(this.terminals(), routed, observed,
				h => keep.indexOf(h || fallback) > -1,
				t => monthlyExpectationAt(t, open, "monthly")))settles = null

		const expectedFor = (t, when) => {
			const declared = monthlyExpectationAt(t, when, "monthly")
			if(Math.abs(declared) < 0.005 && Math.abs(observed[t.id] || 0) > 1)return observed[t.id]
			if(!longPeriod(t))return declared
			const budget = monthlyExpectationAt(t, when, t.getPreferredPeriod())
			if(!budget)return 0
			const left = budget - (spentSince[t.id] || 0)
			//never predict the opposite direction: an exhausted budget is done, not reversed
			if(budget < 0 && left > 0)return 0
			if(budget > 0 && left < 0)return 0
			return left/monthsLeft
		}

		const run = (terms, withSettlement) => forecast({terminals:terms, shapes:shapes,
			expectedFor:expectedFor,
			routing:routed, now:open, balanceNow:0, days:days, covers:covers,
			settles: withSettlement ? settles : null, periodName:"monthly",
			settlementDay: withSettlement ? this.settlementDay() : null})
		const flowsOf = series => {
			const d = {}
			for(let k = 1; k < series.length; k++){
				d[dayKey(series[k].date)] = series[k].value - series[k-1].value
			}
			return d
		}

		const dayKeys = record.map(p => dayKey(p.date))
		const actualFlow = {}
		record.forEach((p, k) => {if(k)actualFlow[dayKeys[k]] = p.value - record[k-1].value})

		//the settlement is not a stream, so it is measured as what having it adds
		const withS = flowsOf(run(this.terminals(), true))
		const withoutS = flowsOf(run(this.terminals(), false))
		const settlementFlow = {}
		dayKeys.forEach(k => {settlementFlow[k] = (withS[k]||0) - (withoutS[k]||0)})

		const perStream = {}, actualByStream = {}
		this.terminals().forEach(t => {
			perStream[t.id] = flowsOf(run([t], false))
			const act = {}
			byStream[t.id].forEach(x => {
				if(x.date < open || x.date > close || !covers(x.accountHash))return
				const k = dayKey(x.date); act[k] = (act[k]||0) + x.amount
			})
			actualByStream[t.id] = act
		})

		//score a set of daily flows against the record, in dollar-days
		const surfaceOf = flow => {
			let bal = record[0].value, out = 0
			for(let k = 0; k < dayKeys.length; k++){
				if(k)bal += (flow[dayKeys[k]] || 0)
				out += Math.abs(bal - record[k].value)
			}
			return out
		}
		const total = {}
		dayKeys.forEach(k => {
			let v = settlementFlow[k] || 0
			this.terminals().forEach(t => {v += (perStream[t.id][k] || 0)})
			total[k] = v
		})
		let area = 0
		record.forEach(p => {area += Math.abs(p.value)})
		const surface = surfaceOf(total)

		/* Each stream scored the way the account is scored, but ON ITSELF: its predicted cumulative
		   curve against its own actual cumulative curve, and its own integral as the denominator. A
		   share of the account's error told you how much a stream mattered and not how well it was
		   predicted - a large stream forecast well outscored a small one forecast disastrously. This
		   is the same question the headline asks, asked of one stream: how accurate would this stream
		   have been in isolation.

		   A stream that moved nothing and was predicted to move nothing is perfect, not undefined. One
		   that moved nothing and WAS predicted has no denominator of its own, so it is scored against
		   the size of the mistake - which lands it at zero rather than at infinity. */
		const gain = {}
		this.terminals().forEach(t => {
			let p = 0, a = 0, err = 0, own = 0
			for(let k = 0; k < dayKeys.length; k++){
				if(k){
					p += (perStream[t.id][dayKeys[k]] || 0)
					a += (actualByStream[t.id][dayKeys[k]] || 0)
				}
				err += Math.abs(p - a)
				own += Math.abs(a)
			}
			/* NOT FLOORED AT ZERO, for the same reason the headline is not: a stream predicted at
			   three times reality is worse than one predicted at nothing, and a floor makes them look
			   identical. The four cases this has to get right:
			     moved nothing, predicted nothing  -> 100%, not undefined
			     moved nothing, predicted something -> 0%, scored against the size of the mistake
			     moved something, predicted nothing -> 0%
			     predicted the opposite direction   -> negative, and it should say so */
			const denom = own > 0.005 ? own : err
			gain[t.id] = denom > 0.005 ? 1 - err/denom : 1
		})

		/* TWO ACCURACIES, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.

		   BALANCE accuracy compares the two CURVES - predicted balance against actual balance, day by
		   day. It is what the reader sees, and it is the number that matters. It also has a property
		   worth naming: errors PERSIST. A payment missed on the 3rd is still wrong on the 30th,
		   because every later balance carries it. One mistake early costs twenty-seven days of surface.

		   TRANSACTION accuracy compares the FLOWS - what moved each day against what was predicted to
		   move that day. An error costs once, on the day it happens. This is the model's own score,
		   with accumulation taken out of it.

		   THEY ARE NOT DIRECTLY COMPARABLE, and assuming otherwise produced a wrong diagnosis that a
		   test caught. The denominators differ by construction: balance divides by the integral of the
		   BALANCE, transactions by the integral of the FLOWS. An account holding $8,000 and moving
		   $100 a day has a denominator eighty times larger on one than the other, so a bias that
		   compounds all month still scores 91% on balance and 80% on transactions - the opposite way
		   round from "biased errors show up as a low balance score". A healthy balance FLATTERS the
		   balance metric, and no comparison between the two survives that.

		   So read each for what it is, and use the other two figures for the diagnosis:
		     BIAS, signed        -> the errors compound. Something is systematically over- or under-
		                            predicted and the sign says which way. This is the fixable kind.
		     HORIZON, degrading  -> the same thing seen over time: accuracy falling as the window
		                            lengthens is accumulation, accuracy flat is noise.
		     bias near zero, transaction accuracy low -> random error that cancels. The noise floor,
		                            and no modelling removes it.

		   BIAS is signed on purpose. An unsigned error cannot distinguish "wrong in both directions"
		   from "always short", and only the second one can be corrected. */
		let flowErr = 0, flowMag = 0, biasSum = 0
		dayKeys.forEach((k, i) => {
			if(!i)return
			const p = total[k] || 0, act = actualFlow[k] || 0
			flowErr += Math.abs(p - act)
			flowMag += Math.abs(act)
			biasSum += (p - act)
		})
		const flowAccuracy = flowMag ? 1 - flowErr/flowMag : 1
		const bias = flowMag ? biasSum/flowMag : 0

		/* ACCURACY BY HORIZON: the same metric truncated at n days.
		   "How accurate is this chart" is not one question - a balance three days out and a balance
		   thirty days out are different claims, and only one of them is load-bearing for a decision
		   taken now. Truncating the surface rather than comparing single points keeps it the same
		   measure at every horizon, so the numbers are comparable down the row. */
		const horizon = [1, 3, 7, 14, 30].filter(n => n < dayKeys.length).map(n => {
			let bal = record[0].value, e = 0, ar = 0
			for(let k = 0; k <= n; k++){
				if(k)bal += (total[dayKeys[k]] || 0)
				e += Math.abs(bal - record[k].value)
				ar += Math.abs(record[k].value)
			}
			return {days: n, accuracy: ar ? 1 - e/ar : 1}
		})

		//the arithmetic behind one stream's score, so a surprising number can be audited rather than
		//taken on trust
		const detail = {}
		this.terminals().forEach(t => {
			let fe = 0, fm = 0
			dayKeys.forEach((k, i) => {
				if(!i)return
				fe += Math.abs((perStream[t.id][k] || 0) - (actualByStream[t.id][k] || 0))
				fm += Math.abs(actualByStream[t.id][k] || 0)
			})
			let p = 0, a = 0, worst = 0, worstDay = null
			dayKeys.forEach((k, i) => {
				if(i){p += (perStream[t.id][k] || 0); a += (actualByStream[t.id][k] || 0)}
				if(Math.abs(p - a) > Math.abs(worst)){worst = p - a; worstDay = k}
			})
			let pt = 0, at = 0
			dayKeys.forEach(k => {pt += (perStream[t.id][k] || 0); at += (actualByStream[t.id][k] || 0)})
			const days = Object.keys(actualByStream[t.id]).sort()
			detail[t.id] = {predTotal: pt, actTotal: at, worst: worst, worstDay: worstDay,
				flowAccuracy: fm ? 1 - fe/fm : (fe > 0.005 ? 0 : 1),
				actDays: days.map(d => d.slice(5) + " " + money(actualByStream[t.id][d])).join(", "),
				predDays: Object.keys(perStream[t.id]).filter(k => Math.abs(perStream[t.id][k]) > 1)
					.sort().map(d => d.slice(5) + " " + money(perStream[t.id][d])).join(", ")}
		})

		this._cache[key] = {open:open, close:record[record.length-1].date, days:record.length,
			since:since, surface:surface, area:area, error: area ? surface/area : 0,
			accuracy: area ? 1 - surface/area : 0, gain:gain, horizon:horizon, detail:detail,
			flowAccuracy:flowAccuracy, bias:bias, expectedFor:expectedFor}
		return this._cache[key]
	}
	//the same month, one month earlier - a single score says nothing about whether the model is
	//improving or the month was simply kind
	prior(){
		if(this._prior === undefined){
			try{this._prior = this.analyse(null, 1)}catch(e){this._prior = null}
		}
		return this._prior
	}
	//every window scored, so the choice is a measurement rather than an argument
	scoreboard(){
		if(this._board)return this._board
		const now = this.today()
		this._board = this.windows(now).map(w => {
			let a = null
			try{a = this.analyse(w[1])}catch(e){}
			return {name:w[0], since:w[1], accuracy:a ? a.accuracy : null}
		})
		return this._board
	}

	settlementDay(){
		const cards = this.credit()
		if(!cards.length)return undefined
		const byDay = new Array(32).fill(0)
		;(this.props.transactions||[]).forEach(t => {
			if(cards.indexOf(t.userInstitutionAccountId) < 0 || t.amount <= 0)return
			byDay[t.date.getUTCDate()] += t.amount
		})
		let best = 0, day
		byDay.forEach((v,i) => {if(v > best){best = v; day = i}})
		return day
	}

	/* ---- the table -------------------------------------------------------------------------------
	   THE CYCLE AND THE AMOUNTS ARE THE STREAM'S OWN, not the detector's. Wages Julien is semimonthly
	   by definition and the table said "monthly", because it was reporting what `detectCycle` found in
	   the transactions - and the detector has no semimonthly candidate on purpose: two paydays show up
	   as two spikes in a month of bins, which is a true description and is what the forecast wants.
	   Both are right about different questions. This column answers "what did the user declare", so it
	   reads `period` off the stream, and the amounts are converted into that period - which is why the
	   expected figure was twice what a payslip says.

	   The conversion ratio is taken from the model rather than a table of periods: asking the stream
	   for its expectation in two periods and dividing gives the occurrences per month, whatever the
	   period is, with no second place to keep in step. */
	/* the date this stream's CURRENT agreement began: the last time its expected amount changed. Turns
	   before it describe a different arrangement - a day-care rate that went from $1,500 to $1,700 in
	   July is not evidence of $1,600. */
	regimeStart(s){
		const h = (s.expAmountHistory || []).slice()
			.sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
		const now = this.today()
		let last = null, prev = null
		h.forEach(e => {
			if(new Date(e.startDate) > now)return
			if(prev === null || e.amount !== prev){last = new Date(e.startDate); prev = e.amount}
		})
		return last
	}

	rows(){
		if(this._rows)return this._rows
		const now = this.today()
		const byStream = this.byStream()
		const a = this.analyse()
		const since = (a && a.since) || this.windows(now)[0][1]
		this._rows = this.terminals().map(s => {
			const declared = s.getPreferredPeriod ? s.getPreferredPeriod() : "monthly"
			const perMonth = monthlyExpectationAt(s, now, "monthly")
			const perCycle = monthlyExpectationAt(s, now, declared)
			const ratio = (perCycle && perMonth) ? perMonth/perCycle : 1
			const declaredCycle = ["monthly","semimonthly","weekly","biweekly"]
				.indexOf(declared) > -1 ? declared : "monthly"
			const p = pointPrediction((byStream[s.id] || []).filter(x => x.date >= since), perMonth,
				{prefer: declaredCycle, regimeFrom: this.regimeStart(s),
					//what the stream ITSELF expected at that moment - a turn it was budgeted at
					//nothing for is not a turn it failed to fill
					expectedAt: d => Math.abs(monthlyExpectationAt(s, d, "monthly")) > 0.005})
			let day = dayLabel(p.cycle, p.day)
			//a stream that fires twice a turn has two answers, and one of them is not the prediction
			if(p.day !== null && p.second !== null && Math.abs(ratio) > 1.5){
				day += " + " + dayLabel(p.cycle, p.second)
			}
			/* THE AMOUNT THE FORECAST ACTUALLY USES, not the one the classifier would like to.
			   A yearly budget spreads its REMAINDER over the months that are left, and a zero-sum
			   stream is predicted from the ledger - so the table was reporting a figure the forecast
			   never saw. A column that disagrees with the thing it describes is worse than no column,
			   because it sends the reader to audit a number nobody used. */
			const used = a && a.expectedFor ? a.expectedFor(s, now) : p.amount
			return {name:s.name, cycle:declared, expected:perCycle,
				tier:p.thin ? 0 : p.tier, day:day,
				amount:(p.tier === TIERS.spread ? used : p.amount)/(ratio || 1),
				spread:p.confidence, gain:(a && a.gain[s.id]) || 0, sort:Math.abs(perMonth),
				detail:(a && a.detail && a.detail[s.id]) || null}
		}).sort((x, y) => (x.gain - y.gain) || (y.sort - x.sort))
		return this._rows
	}
	//grouped, because a list of eighty-seven is audited a tier at a time
	groups(){
		const by = {1:[], 2:[], 3:[], 0:[]}
		this.rows().forEach(r => by[r.tier].push(r))
		return [[1, "TIER 1  dated - same day, same amount", by[1]],
			[2, "TIER 2  drifting - same amount, moving day", by[2]],
			[3, "TIER 3  spread - no single event", by[3]],
			[0, "TOO LITTLE HISTORY  spread by fallback - still forecast", by[0]]]
	}

	report(){
		const a = this.analyse()
		const out = []
		if(a){
			const prev = this.prior()
			out.push("BALANCE accuracy " + (a.accuracy*100).toFixed(1) + "%"
				+ "   TRANSACTION accuracy " + (a.flowAccuracy*100).toFixed(1) + "%"
				+ "   bias " + (a.bias > 0 ? "+" : "") + (a.bias*100).toFixed(1) + "%")
			out.push("surface " + money(a.surface) + " / " + money(a.area) + " $-days"
				+ (prev ? "   prior month " + (prev.accuracy*100).toFixed(1) + "%" : ""))
			out.push("by horizon: " + a.horizon.map(h => "+" + h.days + "d "
				+ (h.accuracy*100).toFixed(0) + "%").join("   "))
			out.push(dayKey(a.open) + " to " + dayKey(a.close)
				+ "   lookback since " + dayKey(a.since))
			const st = this._settlements || []
			const inWin = st.filter(x => x.date >= a.open && x.date <= a.close)
			out.push("card settlements found: " + st.length + " total, " + inWin.length
				+ " in window (" + money(inWin.reduce((x, y) => x + y.amount, 0)) + ")")
			out.push("windows: " + this.scoreboard().map(w => w.name + " "
				+ (w.accuracy === null ? "-" : (w.accuracy*100).toFixed(1) + "%")).join("   "))
			out.push("")
		}
		const w = [26, 12, 12, 9, 14, 12, 7]
		const line = c => c[0].slice(0,w[0]).padEnd(w[0]) + c[1].padEnd(w[1])
			+ c[2].padStart(w[2]) + c[3].padStart(w[3]) + "  " + c[4].padEnd(w[4])
			+ c[5].padStart(w[5]) + c[6].padStart(w[6])
		this.groups().forEach(g => {
			if(!g[2].length)return
			out.push(g[1])
			out.push(line(["  stream","cycle","expected","spread","pred day","pred amt","acc"]))
			g[2].forEach(r => {
				out.push(line(["  " + r.name, r.cycle, money(r.expected),
					(r.spread*100).toFixed(0) + "%", r.day, money(r.amount),
					(r.gain*100).toFixed(0) + "%"]))
				//the arithmetic behind a surprising score, for the rows where it is worth seeing
				if(r.detail && r.gain < 0.9 && (Math.abs(r.detail.predTotal) > 1
						|| Math.abs(r.detail.actTotal) > 1)){
					out.push("      predicted " + money(r.detail.predTotal) + "  ["
						+ (r.detail.predDays || "nothing") + "]")
					out.push("      actual    " + money(r.detail.actTotal) + "  ["
						+ (r.detail.actDays || "nothing") + "]")
					out.push("      transaction accuracy "
						+ (r.detail.flowAccuracy*100).toFixed(0) + "%"
						+ "   worst gap " + money(r.detail.worst)
						+ (r.detail.worstDay ? " on " + r.detail.worstDay : ""))
				}
			})
			out.push("")
		})
		return out.join("\n")
	}

	copy(){
		const text = this.report()
		const done = ok => this.updateState({copied: ok ? "Copied" : "Copy failed"},
			() => setTimeout(() => this.updateState({copied:null}), 1600))
		try{
			if(navigator.clipboard && navigator.clipboard.writeText)
				return navigator.clipboard.writeText(text).then(() => done(true), () => done(false))
			const ta = document.createElement("textarea")
			ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"
			document.body.appendChild(ta); ta.select()
			const ok = document.execCommand("copy")
			document.body.removeChild(ta); done(ok)
		}catch(e){done(false)}
	}

	render(){
		if(!this.state.accounts)return <Wrap>Reading balances…</Wrap>
		let a, groups, err = null
		try{a = this.analyse(); groups = this.groups()}
		catch(e){err = (e && e.message) + " | " + (e && e.stack)}
		if(err)return <Wrap><Line>{err}</Line></Wrap>
		return <Wrap>
			{/* BOTH numbers, both named. One of them was read as the other, and a metric everything
			    else is benchmarked against cannot afford that ambiguity - accuracy reaches 100% when
			    the forecast is perfect, error reaches 0%. */}
			<Score>
				<Big>{a ? (a.accuracy*100).toFixed(1) + "%" : "—"}<Small> balance accuracy</Small></Big>
				<Note>transactions {a ? (a.flowAccuracy*100).toFixed(1) + "%" : "—"}
					{a ? " · bias " + (a.bias > 0 ? "+" : "") + (a.bias*100).toFixed(1) + "%" : ""}</Note>
				<Note>surface {a ? money(a.surface) : "—"} of {a ? money(a.area) : "—"} $·days</Note>
				<Note>{a ? dayKey(a.open) + " to " + dayKey(a.close) : ""}
					{a ? " · " + a.days + " settled days" : ""}</Note>
				<Note>{this.prior() ? "prior month " + (this.prior().accuracy*100).toFixed(1) + "%" : ""}</Note>
				<Note>{a && a.horizon ? "by horizon " + a.horizon.map(h => "+" + h.days + "d "
					+ (h.accuracy*100).toFixed(0) + "%").join("  ") : ""}</Note>
				<Note>{this._settlements
					? "card settlements matched: " + this._settlements.length : ""}</Note>
			</Score>
			<Score>
				<Note>lookback windows, same forecast, same month:</Note>
				{this.scoreboard().map(w => <Note key={w.name}>
					{w.name.padEnd(7)} {w.accuracy === null ? "—"
						: (w.accuracy*100).toFixed(1) + "%"} {" · since " + dayKey(w.since)}
				</Note>)}
			</Score>
			<Bar>
				<Btn type="button" onClick={() => this.copy()}>{this.state.copied || "Copy report"}</Btn>
			</Bar>
			{(groups||[]).map(g => g[2].length ? <div key={g[0]}>
				<Head>{g[1]}</Head>
				{g[2].map((r,i) => <Row key={i}
						onClick={() => this.updateState({open: this.state.open === r.name ? null : r.name})}
						style={{cursor:"pointer"}}>
					<Name>{r.name}</Name>
					<Tier $t={r.tier}>{(r.gain*100).toFixed(0) + "%"}</Tier>
					<Line>{r.cycle} · expects {money(r.expected)} · predicts {money(r.amount)} on {r.day}
						{r.tier && r.tier < 3 ? " · " + (r.spread*100).toFixed(0) + "% there" : ""}</Line>
					{r.detail && this.state.open === r.name ? <Line>
						{"predicted " + money(r.detail.predTotal) + ": " + (r.detail.predDays || "nothing")}
						{" — actual " + money(r.detail.actTotal) + ": " + (r.detail.actDays || "nothing")}
						{" — transactions " + (r.detail.flowAccuracy*100).toFixed(0) + "%"}
						{r.detail.worstDay ? " — worst gap " + money(r.detail.worst)
							+ " on " + r.detail.worstDay : ""}
					</Line> : null}
				</Row>)}
			</div> : null)}
		</Wrap>
	}
}
