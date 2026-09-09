import React from 'react';
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DS from '../DesignSystem.js';
import Core from '../core.js';
import {reportingConfig} from '../processors/ReportingCore.js';
import {reconstruct, forecast, histogramOf, dayKey, monthlyExpectationAt, buildModel,
	groupByStream, dayLabel, TIERS, cycleStartOf, accountLinks, cardSchedule,
	cardSpend, shareOfDay}
	from '../processors/BankBalance.js';

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

/* BUMPED IN EVERY COMMIT THAT CHANGES THE FORECAST. A pasted report has to name the code that
   produced it: three rounds were spent comparing numbers that came from different builds, and a
   regression is invisible if the version is a guess. Hand-maintained rather than a git SHA because
   the alternative is a build-config change on a production deploy, and this costs one line. */
export const BENCH_VERSION = "b45 - narrow the wording gate, do not remove it";

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
/* the picture belongs INSIDE the row it explains, not in a panel elsewhere with its own selector -
   the row is already the thing being asked about, and a second place to choose a stream is a second
   thing to keep in sync */
const Chart = styled.svg`
	grid-column:1 / -1; width:100%; height:auto; margin:0.3rem 0 0.1rem;
	overflow:visible;
`
const Key = styled.div`
	grid-column:1 / -1; display:flex; gap:0.8rem; flex-wrap:wrap;
	font-size:${DS.fontSize.little}rem; color:${props => DS.getStyle().bodyTextSecondary};
`
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
	//the reporting year, from the one definition - see cycleStartOf
	cycleStart(now){
		const prefs = (Core.getUserData() || {}).userPreferences || {}
		return cycleStartOf(now, reportingConfig.startingMonth,
			prefs.reportingStartingDay || reportingConfig.startingDay)
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

		const keep = this.spending(), cards = this.credit(), fallback = keep[0]
		/* ONE MODEL, and the bench does not build one. Everything that used to be assembled here -
		   shapes, routing, the account filter, the settlement, the exclusions, the zero-sum override
		   and the remaining-budget rule - is buildModel, which the tile calls with the same arguments.
		   Five sessions were spent on the consequences of these having been two assemblies; the point
		   of the bench is to measure what ships, and it could not while it modelled something else. */
		const prefs = (Core.getUserData() || {}).userPreferences || {}
		const model = buildModel({
			transactions: this.props.transactions,
			terminals: this.terminals(),
			accounts: this.state.accounts || [],
			covered: keep, cards: cards, fallback: fallback,
			netted: false,
			asOf: open, until: new Date(record[record.length - 1].date),
			since: since,
			settlementDay: this.settlementDay(),
			startingMonth: reportingConfig.startingMonth,
			startingDay: prefs.reportingStartingDay || reportingConfig.startingDay})

		const forecastTerminals = model.terminals
	/* THE REPAYMENT LEGS, which are what the card row is scored against. A repayment is not spending
	   on either side, so both legs are out of the stream forecast - and the checking-side legs ARE
	   the money the card model has to reproduce. */
		const legIds = model.meta.legIds || {}
		const linked = model.meta.linked || []
		const shapes = model.shapes, routed = model.routing
		const sliced = model.meta.sliced
		/* TWO LEDGERS, AND THEY ARE NOT INTERCHANGEABLE. The model's is truncated at the as-of date -
		   that is the law it is built on - so scoring against it asked what actually happened using a
		   ledger that stops before the window opens, and every stream's actuals came back empty. The
		   report printed "actual $0" beside every prediction and transaction accuracy went negative.
		   Named apart so the two can never be swapped again by autocomplete. */
		const modelLedger = model.meta.byStream
		const actualLedger = this.byStream()
		const repayments = model.meta.repayments || []
		const extraFlow = model.extraFlow || {}
		const observed = model.meta.observed
		const expectedFor = model.expectedFor
		const days = Math.round((record[record.length-1].date - open)/DAY)
		const covers = model.covers
		const settleMonthly = Object.keys(extraFlow).reduce((a, k) => a + extraFlow[k].amount, 0)
			/ Math.max(1, (record[record.length-1].date - open)/(30.44*DAY))
		const useSettle = Object.keys(extraFlow).length > 0

		/* THE ABLATIONS ARE OVERRIDES ON THE ONE MODEL, never a second assembly. Each variant differs
		   from what ships by exactly the term named in its arguments, which is the only way the
		   difference in score can be attributed to that term. */
		const run = (terms, withSettlement, withCard) => forecast(Object.assign({}, model, {
			terminals: terms, now: open, balanceNow: 0, days: days,
			extraFlow: withCard === false ? null : model.extraFlow,
			settles: withSettlement ? (h => cards.indexOf(h) > -1) : null,
			settlementDay: withSettlement ? this.settlementDay() : null}))
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
		/* THE CARD IS COUNTED ONCE, and it is not a stream, so it is kept out of the per-stream runs
		   entirely and added back as its own series. Leaving extraFlow switched on inside them would
		   have put a whole card bill into every one of eighty-seven streams. */
		const withS = flowsOf(run(forecastTerminals, true, false))
		const withoutS = flowsOf(run(forecastTerminals, false, false))
		const settlementFlow = {}
		dayKeys.forEach(k => {settlementFlow[k] = (withS[k]||0) - (withoutS[k]||0)
			+ ((extraFlow[k] || {}).amount || 0)})

		const settleActual = repayments.map(x => ({date: x.date, amount: x.amount,
			accountHash: x.checking}))
		const perStream = {}, actualByStream = {}
		forecastTerminals.forEach(t => {
			perStream[t.id] = flowsOf(run([t], false, false))
			const act = {}
			;(t.id === "__settlement__" ? settleActual : (actualLedger[t.id] || [])).forEach(x => {
				if(x.date < open || x.date > close || !covers(x.accountHash))return
				const k = dayKey(x.date); act[k] = (act[k]||0) + x.amount
			})
			actualByStream[t.id] = act
		})

		//the card as a pseudo-stream for scoring only: predicted events against real settlements
		const CARD_ID = "__card__"
		perStream[CARD_ID] = {}
		dayKeys.forEach(k => {perStream[CARD_ID][k] = (extraFlow[k] || {}).amount || 0})
		/* ONE ROW OF MONEY, NOT TWO.

		   "Card settlement (from card spend)" and "Credit Card Payments" were both being scored, and
		   both against the same $9,800 - because they ARE the same money seen from two ends. The card
		   model forecasts the bill; the payment stream is the bill, excluded from the forecast
		   precisely so it is not counted twice. Excluding it from the FORECAST was right and always
		   has been; leaving it in the SCORING was not, and it went unnoticed until b31 gave the card
		   row a real actual - before that the duplicate showed as $0 and looked like an empty row
		   rather than a second copy of the largest flow in the portfolio.

		   So the excluded streams stop being rows of their own, and the card becomes ONE row PER CARD:
		   two cards settle on their own cycles for their own amounts and pooling them describes
		   neither, which is the same reason the model itself is per card.

		   THE ACTUALS ARE ATTRIBUTED FROM THE WHOLE LEDGER, not the model's. The model may not look
		   inside the window - that is the as-of law - but the report is describing what happened, and
		   asking which card a payment cleared is a question about the past. Anything that cannot be
		   attributed is reported as such rather than dropped: an unattributed payment is a mapping
		   gap, and it is the one number that says so. */
		const reportSettlements = accountLinks(this.props.transactions, cards, keep).repayments
		const cardName = (this.state.accounts || []).reduce((m, x) => {m[x.hash] = x.name; return m}, {})
		const cardIdOf = h => "__card__" + h
		const cardRows = cards.map(h => ({id: cardIdOf(h), name: "Card · " + (cardName[h] || h)}))
		cards.forEach(h => {
			perStream[cardIdOf(h)] = {}
			actualByStream[cardIdOf(h)] = {}
		})
		Object.keys(extraFlow).forEach(k => {
			;(extraFlow[k].parts || []).forEach(p => {
				const id = cardIdOf(p.card)
				if(perStream[id])perStream[id][k] = (perStream[id][k] || 0) + p.amount
			})
		})
		let attributed = 0
		reportSettlements.forEach(x => {
			if(x.date < open || x.date > close || !covers(x.accountHash))return
			const id = cardIdOf(x.card)
			if(!actualByStream[id])return
			const k = dayKey(x.date)
			actualByStream[id][k] = (actualByStream[id][k] || 0) + x.amount
			attributed += x.amount
		})

		/* THE CARD'S ACTUAL IS WHAT REALLY LEFT THE ACCOUNT, read from the payment streams.

		   It used to come from the inferred settlement list, which by the as-of law stops before the
		   window opens - so the largest flow in the portfolio printed "actual $0" and scored 0%
		   permanently, and its chart had nothing to draw. The payments themselves are in the ledger
		   the whole time: they are the covered-account legs of the streams the card model excluded,
		   which is the same $9,800 the "Credit Card Payments" row has been reporting all along. */
		actualByStream[CARD_ID] = {}
		reportSettlements.forEach(x => {
			if(x.date < open || x.date > close || !covers(x.checking))return
			const k = dayKey(x.date)
			actualByStream[CARD_ID][k] = (actualByStream[CARD_ID][k] || 0) + x.amount
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
			let v = (extraFlow[k] || {}).amount || 0
			forecastTerminals.forEach(t => {v += (perStream[t.id][k] || 0)})
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
		forecastTerminals.concat([{id: CARD_ID, name: "Card settlement"}]).forEach(t => {
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
		forecastTerminals.concat([{id: CARD_ID, name: "Card settlement"}]).concat(cardRows)
			.forEach(t => {
			let fe = 0, fm = 0
			dayKeys.forEach((k, i) => {
				if(!i)return
				fe += Math.abs((perStream[t.id][k] || 0) - (actualByStream[t.id][k] || 0))
				fm += Math.abs(actualByStream[t.id][k] || 0)
			})
			/* THE SURFACE THIS STREAM IS RESPONSIBLE FOR, in dollar-days.

			   A percentage says how wrong a stream is about itself; it cannot say whether that matters.
			   Renter's insurance is 100% wrong about $10 and Savings is 40% wrong about $4,000, and
			   the column ranked them by the wrong one. This is the same integral the headline scores -
			   the running gap between what this stream was predicted to have moved and what it moved,
			   summed over every day - so the rows add up to roughly the number at the top and sorting
			   by it puts the leverage first.

			   Cumulative, not daily: a payment three days late is wrong for three days and then right
			   again, which is exactly what it costs the balance. */
			let p = 0, a = 0, worst = 0, worstDay = null, surface = 0
			dayKeys.forEach((k, i) => {
				if(i){p += (perStream[t.id][k] || 0); a += (actualByStream[t.id][k] || 0)}
				surface += Math.abs(p - a)
				if(Math.abs(p - a) > Math.abs(worst)){worst = p - a; worstDay = k}
			})
			let pt = 0, at = 0
			dayKeys.forEach(k => {pt += (perStream[t.id][k] || 0); at += (actualByStream[t.id][k] || 0)})
			const days = Object.keys(actualByStream[t.id]).sort()
			detail[t.id] = {surface: surface, predTotal: pt, actTotal: at,
				worst: worst, worstDay: worstDay,
				flowAccuracy: fm ? 1 - fe/fm : (fe > 0.005 ? 0 : 1),
				dayKeys: dayKeys, pred: perStream[t.id], act: actualByStream[t.id],
				actDays: days.map(d => d.slice(5) + " " + money(actualByStream[t.id][d])).join(", "),
				predDays: Object.keys(perStream[t.id]).filter(k => Math.abs(perStream[t.id][k]) > 1)
					.sort().map(d => d.slice(5) + " " + money(perStream[t.id][d])).join(", ")}
		})

		this._cache[key] = {open:open, close:record[record.length-1].date, days:record.length,
			since:since, surface:surface, area:area, error: area ? surface/area : 0,
			accuracy: area ? 1 - surface/area : 0, gain:gain, horizon:horizon, detail:detail,
			flowAccuracy:flowAccuracy, bias:bias, expectedFor:expectedFor,
			settlements:repayments, settleMonthly:settleMonthly, cards:model.meta.cards,
			linked:linked, legIds:legIds,
			model:model,
			cardNames:(this.state.accounts||[]).reduce((m, x) => {m[x.hash] = x.name; return m}, {}),
			excluded:Object.keys(legIds).length, excludeIds:{},
			cardRows:cardRows, cardAttributed:attributed,
			cardTotal:Object.keys(actualByStream[CARD_ID] || {})
				.reduce((x, k) => x + actualByStream[CARD_ID][k], 0)}
		return this._cache[key]
	}
	/* THE CARD EXPORT - statement by statement, with the purchases that produced each one.

	   Everything about this card is inferred: which payments belong to it, where its statement closes,
	   what fraction it clears, how fast it is spent on. Four inferences compounding, and the report so
	   far has printed the CONCLUSIONS. When the conclusions disagreed with reality there was no way to
	   tell which of the four was wrong, and I have twice guessed and been wrong.

	   This prints the evidence instead: for each statement, the payments that cleared it and the
	   purchases that made it up, side by side. Two columns answer the question that matters -

	     purchases ~= payment, every statement  -> the feed is complete and the model's arithmetic is
	                                               sound; any remaining error is in the RATE, which is
	                                               only used for days that have not happened yet
	     purchases ~= half the payment          -> spending is missing from the data, and no amount of
	                                               modelling recovers money the ledger never saw

	   RATE AND PASS-THROUGH ARE NOT INDEPENDENT, which is worth stating because it looks like double
	   counting and is not, quite. Pass-through is fitted as payment divided by the purchases the model
	   can see; if it can see only half of them, pass-through comes out twice as large and the product
	   of the two is unchanged. It is self-correcting - up to the clamp at 1.5, beyond which the
	   correction is silently truncated and the bill comes out short. So a pass-through sitting AT 1.5
	   is not a revolver, it is a purchase feed with a hole in it, and that is the number to read
	   before anything else. */
	cardExport(statements){
		const cards = this.credit(), keep = this.spending()
		if(!cards.length)return "no credit accounts"
		const names = (this.state.accounts || []).reduce((m, x) => {m[x.hash] = x.name; return m}, {})
		const want = statements || 12
		const lk = accountLinks(this.props.transactions, cards, keep)
		const found = lk.repayments
		const cy = {}
		cards.forEach(h => {cy[h] = cardSchedule(this.props.transactions, h, found)})
		const out = ["CARD EXPORT  " + BENCH_VERSION, ""]

		cards.forEach(h => {
			const c = cy[h]
			if(!c || !c.events.length)return
			out.push(names[h] || h)
			out.push("  interval " + Math.round(c.intervalDays) + "d   offset " + c.offsetDays
				+ "d   pass-through " + Math.round(c.passThrough*100) + "%"
				+ (c.passThrough >= 1.49 ? "  <-- AT THE CLAMP: purchases are probably missing" : "")
				+ "   payments per statement " + (c.perStatement || 1).toFixed(1)
				+ (c.count ? "" : "   NO REPAYMENTS FOUND"))
			out.push("")
			out.push("  close        paid on      payment      n   purchases    n   pay/purch")
			const evs = c.events.slice(-want)
			evs.forEach((e, i) => {
				const pay = new Date(e.date)
				const close = new Date(pay.getTime() - c.offsetDays*DAY)
				const prev = i ? new Date(new Date(evs[i-1].date).getTime() - c.offsetDays*DAY)
					: new Date(close.getTime() - c.intervalDays*DAY)
				//the same netted list the model reads, so the export cannot flatter or accuse it
				let sum = 0, n = 0
				cardSpend(this.props.transactions, h, found).forEach(x => {
					const d = x.d.getTime()
					if(d > prev.getTime() && d <= close.getTime()){sum += x.v; n++}
				})
				out.push("  " + dayKey(close) + "   " + dayKey(pay)
					+ "   " + money(e.amount).padStart(9)
					+ "  " + String(e.parts || 1).padStart(2)
					+ "   " + money(sum).padStart(9)
					+ "  " + String(n).padStart(3)
					+ "   " + (sum ? (Math.abs(e.amount)/sum).toFixed(2) : "-").padStart(6))
			})
			out.push("")
			/* THE RATE UNDER EACH BASIS, side by side. Three ways to average the same purchases, and
			   the choice between them was made by preference rather than measurement - which is how
			   the projected half of every bill came to be built on the slowest of the three. */
			const now = this.today()
			const spent = cardSpend(this.props.transactions, h, found)
			const rateOver = from => {
				let sum = 0, earliest = null
				spent.forEach(x => {
					const d = x.d
					if(d < from || d >= now)return
					sum += x.v
					if(!earliest || d < earliest)earliest = d
				})
				const days = earliest ? Math.max(1, (now - earliest)/DAY) : 1
				return sum/days
			}
			const lastPay = new Date(c.events[c.events.length-1].date)
			/* A BACKWARD MEAN OF A RISING SERIES IS LOW, and that is arithmetic rather than bad luck.
			   Every basis above averages the past flat, so if the card is being used more each month
			   the estimate sits below the level it is predicting for - which is what a predicted line
			   running consistently ABOVE the actual one looks like. A recency-weighted mean is the
			   candidate: same window, but a day a fortnight ago counts more than a day three months
			   ago. Printed, not adopted - it becomes the model's rate when it measures better here,
			   and not before. */
			const ewma = halfLife => {
				let num = 0, den = 0
				for(let d = 0; d < 120; d++){
					const day = new Date(now.getTime() - d*DAY)
					let v = 0
					spent.forEach(x => {if(dayKey(x.d) === dayKey(day))v += x.v})
					const w = Math.pow(0.5, d/halfLife)
					num += w*v; den += w
				}
				return den ? num/den : 0
			}
			const bases = [
				["this cycle (since last payment)", rateOver(lastPay)],
				["trailing 90 days  <- in use", rateOver(new Date(now.getTime() - 90*DAY))],
				["since the reporting year began", rateOver(this.cycleStart(now))],
				["recency-weighted, 28d half-life", ewma(28)],
				["recency-weighted, 14d half-life", ewma(14)]
			]
			/* WHICH STREAMS WERE PROMOTED, named. The whole idea is that a lump has a name and an
			   average does not; if nothing qualifies, this line says so rather than leaving the
			   reader to infer it from a number that did not move. */
			//every stream routed to this card composes its statement now, so what is worth printing is
			//how much of the charges the streams account for at all
			const mdl = this.analyse() && this.analyse().model
			const routed = mdl ? this.terminals().filter(t => mdl.routing[t.id] === h) : []
			out.push("  streams routed to this card: "
				+ (routed.length ? routed.map(t => t.name).join(", ") : "none categorised"))
			out.push("")
			out.push("  rate basis                        $/day    implies per statement")

			bases.forEach(b => out.push("  " + b[0].padEnd(34) + money(-b[1]).padStart(8)
				+ "   " + money(-b[1]*c.intervalDays*c.passThrough).padStart(10)))
			const recent = c.events.slice(-8)
			const avg = recent.reduce((x, y) => x + Math.abs(y.amount), 0)/(recent.length || 1)
			out.push("  " + "what the last 8 statements ACTUALLY paid".padEnd(34)
				+ "".padStart(8) + "   " + money(-avg).padStart(10))
			out.push("")
		})

		out.push("RAW PURCHASES (the window above, newest first)")
		const from = new Date(this.today().getTime() - want*7*DAY)
		const rows = (this.props.transactions || []).filter(t =>
			cards.indexOf(t.userInstitutionAccountId) > -1 && new Date(t.date) >= from)
			.sort((a, b) => new Date(b.date) - new Date(a.date))
		rows.forEach(t => out.push("  " + dayKey(new Date(t.date))
			+ "  " + money(t.amount).padStart(9)
			+ "  " + (names[t.userInstitutionAccountId] || "").slice(0, 16).padEnd(16)
			+ "  " + String(t.description || "").slice(0, 40)))
		out.push("  (" + rows.length + " purchases)")
		return out.join("\n")
	}

	/* ROLLING SEVEN DAYS - the horizon a decision is actually taken at.

	   The headline is a single forecast made on one day and marked over the following month. That is
	   a fair test of a month-long claim and a poor test of this product, which is re-forecast every
	   morning and read to answer "is anything going to push me under in the next week". At a week the
	   card's next bill has mostly already been spent and the payroll is a known date; at a month
	   neither is true, and the month-long number is dominated by exactly the part nobody can know.

	   THE `horizon` ROW ABOVE IS NOT THIS. That truncates ONE forecast at n days, so its "+7d" is the
	   first week of a single month-old prediction - the easiest week there is, because it is the week
	   closest to the day the model was built. This re-forecasts from every third day in the window and
	   scores each one over the seven days that followed, which is the same question asked ten times
	   from ten different mornings. Errors are pooled rather than averaged so a quiet week cannot
	   outvote a busy one.

	   Each origin rebuilds the model at that date, which makes every one of them genuinely out of
	   sample - the as-of law does that for free, and is why this is only a few lines. */
	rolling(daysAhead){
		const key = "rolling" + daysAhead
		this._cache = this._cache || {}
		if(this._cache[key] !== undefined)return this._cache[key]
		const a = this.analyse()
		if(!a){this._cache[key] = null; return null}
		const now = this.today()
		const record = reconstruct(this.ledger(), now, this.anchor(), a.open)
			.filter(p => p.date <= a.close)
		const prefs = (Core.getUserData() || {}).userPreferences || {}
		const keep = this.spending(), cards = this.credit()
		const STEP = 3
		let err = 0, area = 0, origins = 0
		for(let i = 0; i + daysAhead < record.length; i += STEP){
			const asOf = record[i].date
			const until = new Date(asOf.getTime() + daysAhead*DAY)
			let fc
			try{
				const m = buildModel({transactions: this.props.transactions,
					terminals: this.terminals(), accounts: this.state.accounts || [],
					covered: keep, cards: cards, fallback: keep[0],
					asOf: asOf, until: until, settlementDay: this.settlementDay(),
					startingMonth: reportingConfig.startingMonth,
					startingDay: prefs.reportingStartingDay || reportingConfig.startingDay})
				fc = forecast(Object.assign({now: asOf, balanceNow: record[i].value,
					days: daysAhead}, m))
			}catch(e){continue}
			origins++
			for(let k = 0; k < daysAhead && i + 1 + k < record.length; k++){
				err += Math.abs(fc[k].value - record[i + 1 + k].value)
				area += Math.abs(record[i + 1 + k].value)
			}
		}
		this._cache[key] = area
			? {accuracy: 1 - err/area, origins: origins, days: daysAhead, err: err, area: area}
			: null
		return this._cache[key]
	}

	/* ONE STREAM, DRAWN. The table ranks streams by how much they cost, which finds the biggest
	   errors and not the most fixable ones. A row saying "predicted -$1,800 on the 6th, actual
	   -$1,700 on the 11th" is a five-day miss and a row saying "-$77 a day against one $2,400 event"
	   is a shape that is simply wrong, and both print as a percentage. Seen as two lines they are
	   obviously different problems.

	   CUMULATIVE, because that is what the balance is: the gap between the curves at any point is
	   exactly the dollars the balance is out by on that day, which is the quantity being scored. A
	   pair of daily bar charts shows the same data and hides the thing it is being read for. */
	streamSeries(id){
		const a = this.analyse()
		if(!a || !a.detail || !a.detail[id])return null
		const d = a.detail[id]
		if(!d.dayKeys)return null
		let p = 0, x = 0
		const pred = [], act = []
		d.dayKeys.forEach(k => {
			p += d.pred[k] || 0; x += d.act[k] || 0
			pred.push(p); act.push(x)
		})
		return {days: d.dayKeys, pred: pred, act: act, name: d.name,
			gap: pred.map((v, i) => v - act[i])}
	}

	streamChart(id){
		const s = this.streamSeries(id)
		if(!s || !s.days.length)return null
		const W = 320, H = 90, PAD = 4
		const all = s.pred.concat(s.act).concat([0])
		const lo = Math.min.apply(null, all), hi = Math.max.apply(null, all)
		/* A FLAT LINE MEANS NOTHING WITHOUT A SCALE. Renter's insurance moves $10 a month and drew
		   the same picture as a stream moving $4,000, because the frame rescales to whatever it
		   holds. The extremes are labelled so the reader can tell a stream that is genuinely steady
		   from one whose whole range is smaller than the ink. */
		const span = (hi - lo) || 1
		const x = i => PAD + (i/(Math.max(1, s.days.length - 1)))*(W - 2*PAD)
		const y = v => PAD + (1 - (v - lo)/span)*(H - 2*PAD)
		const path = arr => arr.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1)
			+ " " + y(v).toFixed(1)).join(" ")
		return {W: W, H: H, zero: y(0), lo: lo, hi: hi, span: hi - lo,
			yLo: y(lo), yHi: y(hi), pred: path(s.pred), act: path(s.act), series: s}
	}

	/* THE NEXT PAYMENT, AS OF NOW - not a score of a past window.

	   Every other number on this page is a backtest: a forecast made a month ago and marked against
	   what happened. That is the right way to score a MONTH, and the wrong way to look at a card,
	   because a card bill is re-evaluated every day. Most of the next one has already been spent, and
	   the part that has not is a few days at a known rate. Judging it by how a month-old single shot
	   performed hides the only property that matters: today, right now, how much is the next payment
	   and how much of that is already fact.

	   So this stands at TODAY and shows the arithmetic, term by term, for each card's next payment. */
	nextPayments(){
		const cards = this.credit(), keep = this.spending()
		if(!cards.length || !this.state.accounts)return []
		const now = this.today()
		const prefs = (Core.getUserData() || {}).userPreferences || {}
		const model = buildModel({
			transactions: this.props.transactions, terminals: this.terminals(),
			accounts: this.state.accounts, covered: keep, cards: cards, fallback: keep[0],
			asOf: now, until: new Date(now.getTime() + 45*DAY),
			settlementDay: this.settlementDay(),
			startingMonth: reportingConfig.startingMonth,
			startingDay: prefs.reportingStartingDay || reportingConfig.startingDay})
		const cy = model.meta.cards || {}
		const names = (this.state.accounts || []).reduce((m, x) => {m[x.hash] = x.name; return m}, {})
		const flow = model.extraFlow || {}
		//the soonest event per card, which is the one a decision this week depends on
		const soonest = {}
		Object.keys(flow).forEach(k => {
			(flow[k].parts || []).forEach(p => {
				if(!soonest[p.card] || k < soonest[p.card].day)
					soonest[p.card] = {day: k, amount: p.amount, posted: p.posted,
						planned: p.planned || 0, projected: p.projected}
			})
		})
		return cards.map(h => {
			const c = cy[h] || {}
			const last = (c.events || []).length
				? (c.events || [])[(c.events || []).length - 1] : null
			const n = soonest[h]
			const close = n ? new Date(new Date(n.day + "T00:00:00Z").getTime()
				- (c.offsetDays || 0)*DAY) : null
			return {hash: h, name: names[h] || h.slice(0, 20),
				last: last ? dayKey(last.date) : null, lastAmount: last ? last.amount : 0,
				every: c.intervalDays ? Math.round(c.intervalDays) : null,
				lag: c.offsetDays || 0, ratio: c.passThrough || 1, rate: 0,
				purchases: c.spend || 0, settlements: (c.events || []).length,
				when: n ? n.day : null, close: close ? dayKey(close) : null,
				daysToClose: close ? Math.max(0, Math.round((close - now)/DAY)) : null,
				posted: n ? n.posted : 0, planned: n ? n.planned : 0,
				projected: n ? n.projected : 0,
				amount: n ? n.amount : 0,
				known: n && Math.abs(n.amount) > 0.005
					? Math.abs(n.posted)/Math.abs(n.amount) : null}
		}).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
	}

	nextPaymentLines(){
		return this.nextPayments().map(c => {
			if(!c.when)return "  " + c.name + ": no next repayment modelled ("
				+ c.settlements + " repayments seen)"
			return "  " + c.name + ": " + money(c.amount) + " on " + c.when
				+ "\n      statement closed " + c.close + " (" + c.lag + "d before payment)"
				+ (c.daysToClose ? ", " + c.daysToClose + "d still open" : ", already shut")
				+ "\n      " + money(c.posted) + " already posted"
				+ (c.planned ? " + " + money(c.planned) + " the card's streams still expect" : "")
				+ (c.passThrough !== 1 ? " x " + Math.round(c.passThrough*100) + "% pass-through" : "")
				+ "\n      " + Math.round((c.known || 0)*100) + "% of it is already fact"
				+ " · last paid " + money(c.lastAmount) + " on " + c.last
				+ " · every " + c.every + "d"
		})
	}

	/* THE CARD MODEL, PER CARD - because the whole claim rests on two things being right and neither
	   was ever shown. "Once the prediction day advances the card should be near exact, since it is a
	   re-evaluated pending amount and the transactions prove it - but only if you have the right
	   mapping and the right offset."

	   The MAPPING is which purchases belong to which card and which settlement clears them; get it
	   wrong and one card's spending is billed on another card's cycle. The OFFSET is the gap between
	   a statement closing and being paid; get it wrong and the imminent bill is loaded with spending
	   that has not been billed yet. Both are inferred, so both have to be inspectable - a model whose
	   preconditions cannot be checked is a model that can only be trusted or abandoned. */
	cardLines(){
		const a = this.analyse()
		if(!a || !a.cards)return []
		const names = a.cardNames || {}
		return Object.keys(a.cards).map(h => {
			const c = a.cards[h]
			const evs = c.events || []
			const per = evs.length > 1
				? evs.slice(1).reduce((x, e) => x + Math.abs(e.amount), 0)/(evs.length - 1) : 0
			return {hash: h, name: names[h] || h.slice(0, 18),
				matched: evs.length, legs: c.count || 0, perStatement: c.perStatement || 1,
				linked: !!(a && (a.linked || []).indexOf(h) > -1),
				interval: Math.round(c.intervalDays || 0), lag: c.offsetDays || 0,
				ratio: c.passThrough || 1, per: per,
				fit: c.fit === null || c.fit === undefined ? null : c.fit}
		}).sort((x, y) => y.matched - x.matched)
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
		/* THE CARD IS ONE ROW PER CARD, and the payment streams it replaces get none.

		   Two cards settle on their own cycles for their own amounts, so a pooled row describes
		   neither - the same reason the model itself is per card. And the streams those payments are
		   categorised to are the SAME MONEY: excluded from the forecast so the bill is counted once,
		   they must be excluded from the scoring for the same reason, or the largest flow in the
		   portfolio appears twice and the dollar-days column stops adding up. */
		const cardRows = ((a && a.cardRows) || []).map(c => {
			const d = (a.detail || {})[c.id] || null
			const pred = d ? d.predTotal : 0
			return {name: c.name, id: c.id, surface: (d && d.surface) || 0,
				cycle: "per cycle", expected: pred, tier: 3, day: "posted + rate",
				amount: pred, spread: 0, gain: (a.gain || {})[c.id] || 0,
				sort: Math.abs((d && d.actTotal) || pred), detail: d}
		})
		const dropped = {}
		/* THE TABLE ASKS THE MODEL, and until now it asked a second opinion.

		   Tier, predicted day and confidence all came from pointPrediction - a classifier written
		   before any of the shape rules and never told about them. So a yearly expense the forecast
		   now spreads across the month was still listed as "Tier 2, drifting, day 9", and a stream
		   the event rule collapses onto one date was still described by whatever the classifier made
		   of its raw history. The reader was auditing a description of a forecast that no longer
		   exists - the same two-models fault as b19 and b23, moved into the reporting layer.

		   These are now read off the forecast itself, by asking it what it puts on each day of a
		   month. That cannot disagree with the picture, because it IS the picture. */
		const mdl = a && a.model
		const probe = s => {
			if(!mdl)return null
			const y = now.getUTCFullYear(), m = now.getUTCMonth()
			const days = []
			let total = 0, big = 0, bigDay = 0
			for(let d = 1; d <= 31; d++){
				const at = new Date(Date.UTC(y, m, d))
				if(at.getUTCMonth() !== m)break
				const v = shareOfDay(s, at, mdl)
				days.push(v); total += v
				if(Math.abs(v) > Math.abs(big)){big = v; bigDay = d}
			}
			//a day counts as "live" when it carries a real share, not a rounding crumb
			const live = days.filter(v => Math.abs(v) > Math.abs(total)*0.02).length
			const h = mdl.shapes[s.id]
			/* dayLabel takes the cycle's PHASE, not the day of the month, and they only coincide for
			   a monthly cycle. Passing the calendar day named a weekly stream after a day number and
			   a semimonthly one after a phase it does not have; it read correctly on the 14th purely
			   because 14 is in the first half of the month. */
			const at = new Date(Date.UTC(y, m, bigDay || 1))
			const phase = h && h.cycle && h.cycle.phaseOf ? h.cycle.phaseOf(at) : (bigDay - 1)
			return {total: total, big: big, bigDay: bigDay, phase: phase, live: live,
				cycle: h && h.cycle ? h.cycle.name : "monthly",
				spreadReason: h ? h.spreadReason : null,
				confident: h ? h.confident : null,
				share: total ? Math.abs(big/total) : 0}
		}
		this._rows = cardRows.concat(this.terminals().filter(s => !dropped[s.id]).map(s => {
			const declared = s.getPreferredPeriod ? s.getPreferredPeriod() : "monthly"
			const perCycle = monthlyExpectationAt(s, now, declared)
			const p = probe(s)
			const det = (a && a.detail && a.detail[s.id]) || null
			/* ONE EVENT, A FEW, OR A TRICKLE - counted off the forecast rather than classified.
			   One live day is a dated stream; two to four is one that moves; more than that is not
			   an event at all, whatever it is called. */
			const tier = !p || !p.live ? 0
				: (p.spreadReason ? TIERS.spread
					: (p.live === 1 ? 1 : (p.live <= 4 ? 2 : TIERS.spread)))
			const day = !p || !p.live ? "-"
				: (p.spreadReason ? "spread by budget"
					: (tier === TIERS.spread ? "spread" : dayLabel(p.cycle, p.phase)))
			return {name:s.name, id:s.id, cycle:declared, expected:perCycle,
				surface:(det && det.surface) || 0,
				tier:tier, day:day,
				amount:(p ? (tier === TIERS.spread ? p.total : p.big) : 0),
				spread:(p ? p.share : 0),
				confident:(p ? p.confident : null),
				gain:(a && a.gain[s.id]) || 0, sort:Math.abs(p ? p.total : 0),
				detail:det}
		})).sort((x, y) => (y.surface - x.surface) || (x.gain - y.gain) || (y.sort - x.sort))
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
		const out = [BENCH_VERSION, ""]
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
			const st = a.settlements || []
			out.push("card settlement modelled at " + money(a.settleMonthly || 0) + "/month")
			//NOT filtered to the window: the model may not see inside it, so every settlement here is
			//by construction before it, and a count of those inside could only ever be zero
			const lkAll = accountLinks(this.props.transactions, this.credit(), this.spending())
			out.push("card repayments: " + lkAll.repayments.length + " found ("
				+ lkAll.stored + " stored pairs, " + lkAll.rebuilt + " reconstructed)"
				+ "   linked cards: " + Object.keys(lkAll.links).length
				+ " of " + this.credit().length)
			//amount and date agreed but no wording did: the vocabulary the gate is missing
			;(lkAll.rejected || []).forEach(r => out.push("      not paired (x" + r.n
				+ "), no payment wording: " + r.pair))
			out.push("card settlements identified before the window: " + st.length
				+ "   payment streams excluded: " + (a.excluded || 0))
			const r7 = this.rolling(7)
			if(r7)out.push("ROLLING 7-DAY accuracy " + (r7.accuracy*100).toFixed(1)
				+ "%   (re-forecast from " + r7.origins + " mornings, scored over the week after each)")
			out.push("")
			out.push("NEXT CARD PAYMENT (as of today, not the scored window)")
			this.nextPaymentLines().forEach(l => out.push(l))
			out.push("")
			if(a.cardTotal){
				const gap = a.cardTotal - a.cardAttributed
				out.push("card payments in window " + money(a.cardTotal)
					+ ", attributed to a card " + money(a.cardAttributed)
					+ (Math.abs(gap) > 1 ? "   UNATTRIBUTED " + money(gap) : "   all attributed"))
				out.push("  (the " + a.excluded + " payment stream(s) these belong to are not listed"
					+ " separately - the card rows ARE that money)")
			}
			this.cardLines().forEach(c => {
				out.push("  " + c.name + ": " + (c.linked ? "" : "NOT LINKED (no paired repayment) - ")
					+ c.matched + " statements from " + c.legs + " paired repayments"
					+ (c.perStatement > 1.2
						? " (" + c.perStatement.toFixed(1) + " per statement)" : "")
					+ ", every " + c.interval + "d, statement closes "
					+ c.lag + "d before payment, clears "
					+ Math.round(c.ratio*100) + "%"
					+ (c.fit === null ? "  (offset not fitted: too few repayments)"
						: "  (spread " + Math.round(c.fit*100) + "%)"))
			})
			out.push("windows: " + this.scoreboard().map(w => w.name + " "
				+ (w.accuracy === null ? "-" : (w.accuracy*100).toFixed(1) + "%")).join("   "))
			out.push("")
		}
		/* THE SURFACE COLUMN COMES FIRST, and the rows are sorted by it. A percentage says how wrong
		   a stream is about itself and cannot say whether that matters: renter's insurance is 100%
		   wrong about $10 and savings is 40% wrong about $4,000. Dollar-days is the same integral the
		   headline scores, so these rows add up to roughly the number at the top and reading down the
		   column is reading down the leverage. */
		const w = [26, 11, 11, 11, 8, 13, 11, 6]
		const line = c => c[0].slice(0,w[0]).padEnd(w[0]) + c[1].padStart(w[1])
			+ "  " + c[2].padEnd(w[2]) + c[3].padStart(w[3]) + c[4].padStart(w[4])
			+ "  " + c[5].padEnd(w[5]) + c[6].padStart(w[6]) + c[7].padStart(w[7])
		this.groups().forEach(g => {
			if(!g[2].length)return
			out.push(g[1])
			out.push(line(["  stream","$-days","cycle","expected","top day","pred day","pred amt","acc"]))
			g[2].forEach(r => {
				out.push(line(["  " + r.name, money(r.surface), r.cycle, money(r.expected),
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

	//takes the text to copy, so one button can hand over the report and another the card export
	copy(what){
		const text = typeof what === "string" ? what : this.report()
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

	/* PREDICTED against ACTUAL, cumulative, for one stream. The vertical gap at any day is exactly
	   the dollars the balance is out by because of this stream on that day - which is the quantity
	   the score integrates, so the picture and the number cannot disagree. */
	drawStream(id){
		let c = null
		try{c = this.streamChart(id)}catch(e){c = null}
		if(!c)return null
		const ink = DS.getStyle().bodyText, dim = DS.getStyle().bodyTextSecondary
		const last = c.series.gap[c.series.gap.length - 1]
		return <React.Fragment>
			<Chart viewBox={"0 0 " + c.W + " " + c.H} preserveAspectRatio="none">
				<line x1="0" y1={c.zero} x2={c.W} y2={c.zero} stroke={dim}
					strokeWidth="0.5" strokeDasharray="2,2"/>
				<path d={c.act} fill="none" stroke={ink} strokeWidth="1.6"/>
				<path d={c.pred} fill="none" stroke={ink} strokeWidth="1.4"
					strokeDasharray="3,2.5" opacity="0.75"/>
			</Chart>
			{/* the scale in words rather than tick marks: at this size a labelled axis is unreadable,
			    and the only thing the reader needs is how many dollars the frame is worth */}
			<Key>
				<span>top {money(c.hi)}</span>
				<span>bottom {money(c.lo)}</span>
				<span>full height {money(c.span)}</span>
			</Key>
			<Key>
				<span>—— actual, cumulative</span>
				<span>- - predicted</span>
				<span>{c.series.days[0].slice(5)} to {c.series.days[c.series.days.length-1].slice(5)}</span>
				<span>ends {money(last)} apart</span>
			</Key>
		</React.Fragment>
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
				<Note style={{fontWeight:600}}>{this.rolling(7)
					? "rolling 7-day " + (this.rolling(7).accuracy*100).toFixed(1) + "% · "
						+ this.rolling(7).origins + " mornings"
					: ""}</Note>
				<Note>{a && a.horizon ? "one shot, truncated: " + a.horizon.map(h => "+" + h.days + "d "
					+ (h.accuracy*100).toFixed(0) + "%").join("  ") : ""}</Note>
				<Note>{BENCH_VERSION}</Note>
				<Note>{a && a.cardTotal ? "card payments in window " + money(a.cardTotal)
					+ " · attributed " + money(a.cardAttributed)
					+ (Math.abs(a.cardTotal - a.cardAttributed) > 1
						? " · UNATTRIBUTED " + money(a.cardTotal - a.cardAttributed)
						: " · all attributed") : ""}</Note>
				<Note>{a ? "card settlements matched: " + (a.settlements || []).length
					+ " · excluded: " + (a.excluded || 0)
					+ " · modelled " + money(a.settleMonthly || 0) + "/mo" : ""}</Note>
				{this.cardLines().map(c => <Note key={c.hash}>
					{c.linked ? "" : "NOT LINKED · "}
					{c.name}: {c.matched} statements from {c.legs} paired repayments
					{c.perStatement > 1.2 ? " · " + c.perStatement.toFixed(1) + " per statement" : ""}
					· every
					{" " + c.interval}d · closes {c.lag}d before payment · clears
					{" " + Math.round(c.ratio*100)}%
					{c.fit === null ? " · offset not fitted"
						: " · spread " + Math.round(c.fit*100) + "%"}
				</Note>)}
			</Score>
			<Score>
				<Note style={{fontWeight:600}}>next card payment, as of today</Note>
				{this.nextPayments().map(c => <Note key={c.hash}>
					{c.when
						? c.name + ": " + money(c.amount) + " on " + c.when + " · "
							+ money(c.posted) + " posted + " + money(c.projected) + " projected · "
							+ Math.round((c.known || 0)*100) + "% already fact · closes " + c.close
							+ (c.daysToClose ? " (" + c.daysToClose + "d open)" : " (shut)")
						: c.name + ": no next payment modelled"}
				</Note>)}
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
				<Btn type="button" onClick={() => this.copy(this.cardExport())}>
					{this.state.copied === "cards" ? "Copied" : "Copy card export"}</Btn>
			</Bar>
			{(groups||[]).map(g => g[2].length ? <div key={g[0]}>
				<Head>{g[1]}</Head>
				{g[2].map((r,i) => <Row key={i}
						onClick={() => this.updateState({open: this.state.open === r.name ? null : r.name})}
						style={{cursor:"pointer"}}>
					<Name>{r.name}</Name>
					<Tier $t={r.tier}>{(r.gain*100).toFixed(0) + "%"}</Tier>
					<Line>{money(r.surface)} $·days · {r.cycle} · expects {money(r.expected)}
						· predicts {money(r.amount)} on {r.day}
						{r.tier && r.tier < 3
							? " · top day carries " + (r.spread*100).toFixed(0) + "%" : ""}</Line>
					{this.state.open === r.name ? this.drawStream(r.id) : null}
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
