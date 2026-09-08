import React from 'react';
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DS from '../DesignSystem.js';
import Core from '../core.js';
import {reportingConfig} from '../processors/ReportingCore.js';
import {reconstruct, forecast, histogramOf, dayKey, monthlyExpectationAt, buildModel,
	groupByStream, pointPrediction, dayLabel, TIERS, cycleStartOf}
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
export const BENCH_VERSION = "b30 - rolling 7d, the next payment, and one stream at a time";

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
		const excludeIds = model.excludeIds
		const shapes = model.shapes, routed = model.routing
		const sliced = model.meta.sliced
		/* TWO LEDGERS, AND THEY ARE NOT INTERCHANGEABLE. The model's is truncated at the as-of date -
		   that is the law it is built on - so scoring against it asked what actually happened using a
		   ledger that stops before the window opens, and every stream's actuals came back empty. The
		   report printed "actual $0" beside every prediction and transaction accuracy went negative.
		   Named apart so the two can never be swapped again by autocomplete. */
		const modelLedger = model.meta.byStream
		const actualLedger = this.byStream()
		const inferred = model.meta.inferred
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

		const settleActual = inferred.map(x => ({date: x.date, amount: x.amount,
			accountHash: x.accountHash}))
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
		actualByStream[CARD_ID] = {}
		settleActual.forEach(x => {
			if(x.date < open || x.date > close || keep.indexOf(x.accountHash) < 0)return
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
		forecastTerminals.concat([{id: CARD_ID, name: "Card settlement"}]).forEach(t => {
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
				dayKeys: dayKeys, pred: perStream[t.id], act: actualByStream[t.id],
				actDays: days.map(d => d.slice(5) + " " + money(actualByStream[t.id][d])).join(", "),
				predDays: Object.keys(perStream[t.id]).filter(k => Math.abs(perStream[t.id][k]) > 1)
					.sort().map(d => d.slice(5) + " " + money(perStream[t.id][d])).join(", ")}
		})

		this._cache[key] = {open:open, close:record[record.length-1].date, days:record.length,
			since:since, surface:surface, area:area, error: area ? surface/area : 0,
			accuracy: area ? 1 - surface/area : 0, gain:gain, horizon:horizon, detail:detail,
			flowAccuracy:flowAccuracy, bias:bias, expectedFor:expectedFor,
			settlements:inferred, settleMonthly:settleMonthly, cards:model.meta.cards,
			cardNames:(this.state.accounts||[]).reduce((m, x) => {m[x.hash] = x.name; return m}, {}),
			excluded:Object.keys(excludeIds).length}
		return this._cache[key]
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
		const span = (hi - lo) || 1
		const x = i => PAD + (i/(Math.max(1, s.days.length - 1)))*(W - 2*PAD)
		const y = v => PAD + (1 - (v - lo)/span)*(H - 2*PAD)
		const path = arr => arr.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1)
			+ " " + y(v).toFixed(1)).join(" ")
		return {W: W, H: H, zero: y(0), pred: path(s.pred), act: path(s.act), series: s}
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
						projected: p.projected}
			})
		})
		return cards.map(h => {
			const c = cy[h] || {}
			const last = (c.events || []).length
				? (c.events || [])[(c.events || []).length - 1] : null
			const n = soonest[h]
			const close = n ? new Date(new Date(n.day + "T00:00:00Z").getTime()
				- (c.lagDays || 0)*DAY) : null
			return {hash: h, name: names[h] || h.slice(0, 20),
				last: last ? dayKey(last.date) : null, lastAmount: last ? last.amount : 0,
				every: c.intervalDays ? Math.round(c.intervalDays) : null,
				lag: c.lagDays || 0, ratio: c.ratio || 1, rate: c.rate || 0,
				purchases: c.spend || 0, settlements: (c.events || []).length,
				when: n ? n.day : null, close: close ? dayKey(close) : null,
				daysToClose: close ? Math.max(0, Math.round((close - now)/DAY)) : null,
				posted: n ? n.posted : 0, projected: n ? n.projected : 0,
				amount: n ? n.amount : 0,
				known: n && Math.abs(n.amount) > 0.005
					? Math.abs(n.posted)/Math.abs(n.amount) : null}
		}).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
	}

	nextPaymentLines(){
		return this.nextPayments().map(c => {
			if(!c.when)return "  " + c.name + ": no next payment modelled ("
				+ c.settlements + " settlements, " + c.purchases + " purchases seen)"
			return "  " + c.name + ": " + money(c.amount) + " on " + c.when
				+ "\n      statement closed " + c.close + " (" + c.lag + "d before payment)"
				+ (c.daysToClose ? ", " + c.daysToClose + "d still open" : ", already shut")
				+ "\n      " + money(c.posted) + " already posted"
				+ " + " + money(c.projected) + " projected at " + money(-c.rate) + "/day"
				+ (c.ratio !== 1 ? " x " + Math.round(c.ratio*100) + "% pass-through" : "")
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
			const per = c.events.length > 1
				? c.events.slice(1).reduce((x, e) => x + Math.abs(e.amount), 0)/(c.events.length - 1)
				: 0
			return {hash: h, name: names[h] || h.slice(0, 18),
				matched: c.events.length, purchases: c.spend,
				byReceipt: c.events.filter(e => e.by === "receipt").length,
				byAmount: c.events.filter(e => e.by === "amount").length,
				interval: Math.round(c.intervalDays), lag: c.lagDays,
				ratio: c.ratio, rate: c.rate || 0, per: per,
				fit: c.fit === null ? null : c.fit}
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
		//the settlement is forecast like a stream, so it is listed like one - otherwise the single
		//largest outflow in the portfolio has no row and its accuracy cannot be read
		const synthetic = (a && a.settleMonthly) ? [{name: "Card settlement (from card spend)",
			cycle: "per cycle", expected: a.settleMonthly, tier: 3, day: "posted + rate",
			amount: a.settleMonthly, spread: 0, gain: (a.gain || {})["__card__"] || 0,
			sort: Math.abs(a.settleMonthly),
			detail: (a.detail || {})["__card__"] || null}] : []
		this._rows = synthetic.concat(this.terminals().map(s => {
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
			return {name:s.name, id:s.id, cycle:declared, expected:perCycle,
				tier:p.thin ? 0 : p.tier, day:day,
				amount:(p.tier === TIERS.spread ? used : p.amount)/(ratio || 1),
				spread:p.confidence, gain:(a && a.gain[s.id]) || 0, sort:Math.abs(perMonth),
				detail:(a && a.detail && a.detail[s.id]) || null}
		})).sort((x, y) => (x.gain - y.gain) || (y.sort - x.sort))
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
			out.push("card settlements identified before the window: " + st.length
				+ "   payment streams excluded: " + (a.excluded || 0))
			const r7 = this.rolling(7)
			if(r7)out.push("ROLLING 7-DAY accuracy " + (r7.accuracy*100).toFixed(1)
				+ "%   (re-forecast from " + r7.origins + " mornings, scored over the week after each)")
			out.push("")
			out.push("NEXT CARD PAYMENT (as of today, not the scored window)")
			this.nextPaymentLines().forEach(l => out.push(l))
			out.push("")
			this.cardLines().forEach(c => {
				out.push("  " + c.name + ": " + c.matched + " settlements from " + c.purchases
					+ " purchases (" + c.byReceipt + " by receipt, " + c.byAmount + " by amount)"
					+ ", every " + c.interval + "d, statement closes "
					+ c.lag + "d before payment, clears "
					+ Math.round(c.ratio*100) + "% at " + money(-c.rate) + "/day"
					+ (c.fit === null ? "  (offset not fitted: too few settlements)"
						: "  (spread " + Math.round(c.fit*100) + "%)"))
			})
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
				<Note>{a ? "card settlements matched: " + (a.settlements || []).length
					+ " · excluded: " + (a.excluded || 0)
					+ " · modelled " + money(a.settleMonthly || 0) + "/mo" : ""}</Note>
				{this.cardLines().map(c => <Note key={c.hash}>
					{c.name}: {c.matched} settlements ({c.byReceipt} by receipt, {c.byAmount} by
					amount) from {c.purchases} purchases · every
					{" " + c.interval}d · closes {c.lag}d before payment · clears
					{" " + Math.round(c.ratio*100)}% · {money(-c.rate)}/day
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
