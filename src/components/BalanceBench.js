import React from 'react';
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DS from '../DesignSystem.js';
import Core from '../core.js';
import ApiCaller from '../ApiCaller.js';
import {AccountTypes, inferAccountType} from '../Bank.js';
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
export const BENCH_VERSION = "b76 - the fixture is written where the tests read it";

const DAY = 86400000;
const NL = String.fromCharCode(10);
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
/* the two scannable columns: what the model thinks this stream IS, and what it predicts */
const Cols = styled.div`
	grid-column:1 / -1; display:grid; grid-template-columns:1fr auto; gap:0.5rem;
	font-size:${DS.fontSize.little}rem; color:${props => DS.getStyle().bodyTextSecondary};
`
const Cell = styled.div`overflow-wrap:anywhere;`
const CellR = styled.div`text-align:right; font-family:Barlow,sans-serif; white-space:nowrap;`
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
//the key of a key/value line: bold, and it does the work a column header would
const K = styled.span`
	font-weight: 600;
	display: inline-block;
	min-width: 62px;
	opacity: 0.75;
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
		this.state = {accounts:null, copied:null, open:null, remembered:null}
	}
	componentDidMount(){
		Core.getAccountsWithBalances()
			.then(a => this.updateState({accounts:a||[]}))
			.catch(() => this.updateState({accounts:[]}))
		/* THE REMEMBERED SERIES, which nothing has been reading. The reconstruction hangs off ONE
		   number - today's live balance - and every earlier point is that number minus the
		   transactions since. So a single missing or duplicated transaction displaces the whole
		   segment before it by a constant, and the curve is wrong in a way no part of it can report.

		   The stored snapshots are what the bank actually said on each day. They only accumulate
		   going forward, so an empty answer means "no history yet" and not "no money" - but wherever
		   they overlap the window they are ground truth the walk can be checked against. */
		const now = new Date()
		const from = new Date(now.getTime() - 400*DAY)
		ApiCaller.getBalanceHistory(from.toISOString(), now.toISOString())
			.then(r => this.updateState({remembered: (r && (r.balances || r)) || []}))
			.catch(() => this.updateState({remembered: []}))
	}

	/* EVERY ACCOUNT, AND WHICH READING CLAIMS IT.

	   "The balance is negative and I have never been negative" is not a forecast fault and not
	   necessarily drift either. The walk starts from the sum of the accounts a reading covers, so an
	   account left out takes its whole balance out of the anchor - and its transactions out of the
	   ledger with it, which makes the curve internally consistent and uniformly too low. Nothing in
	   the curve can report that, because from the inside it looks correct.

	   The tile and this bench do not select accounts the same way, which is the second half of the
	   problem. The tile asks Core.accountTypeOf - Plaid's type, then the user's own override. The
	   bench matches the subtype string for "check" and falls back to every depository account. Those
	   are two answers to "which accounts is this reading about", and they can disagree about the same
	   account, so both are printed against every account rather than either being trusted.

	   TRANSACTION COUNT IS THE THIRD COLUMN, because an account with a balance and no transactions
	   contributes its money to the anchor and nothing to the walk - which tilts the whole past by
	   that balance and is invisible in any total. */
	accountAudit(){
		const accts = this.state.accounts || []
		if(!accts.length)return null
		const benchSet = this.spending(), cards = this.credit()
		const overrides = (Core.getUserData() || {}).accountTypes || {}
		const counted = {}
		;(this.props.transactions || []).forEach(t => {
			const h = t.userInstitutionAccountId
			counted[h] = (counted[h] || 0) + 1
		})
		return accts.map(a => {
			const effective = Core.accountTypeOf ? Core.accountTypeOf(a) : inferAccountType(a)
			return {name: a.name, hash: a.hash, type: a.type, subtype: a.subtype,
				current: a.current, available: a.available,
				inferred: inferAccountType(a), override: overrides[a.hash] || null,
				effective: effective,
				inTile: effective === AccountTypes.checking,
				inBench: benchSet.indexOf(a.hash) > -1,
				isCard: cards.indexOf(a.hash) > -1,
				txns: counted[a.hash] || 0}
		})
	}

	/* WHERE THE WALK PARTS COMPANY WITH WHAT THE BANK SAID.

	   Reported minus reconstructed, per day, over the spending accounts. Anchored at today by
	   construction, so today is always zero and the interesting number is how far back the agreement
	   survives. A CONSTANT offset before some date is a missing or duplicated transaction on that
	   date; a drift that grows steadily is a whole category of movement the ledger never sees. */
	driftVsRemembered(){
		const snaps = this.state.remembered
		if(!snaps || !snaps.length)return null
		const keep = this.spending()
		if(!keep.length)return null
		const byDay = {}
		snaps.forEach(x => {
			const h = x.accountHash
			if(keep.indexOf(h) < 0 || isNaN(x.current))return
			const k = dayKey(new Date(x.date))
			if(!byDay[k])byDay[k] = {}
			byDay[k][h] = x.current           //one per account per day; the later one wins
		})
		const now = this.today()
		const walk = reconstruct(this.ledger(), now, this.anchor(),
			new Date(now.getTime() - 400*DAY))
		const seen = {}
		walk.forEach(p => {seen[dayKey(p.date)] = p.value})
		const rows = []
		Object.keys(byDay).sort().forEach(k => {
			//only days where EVERY spending account reported, or the sum is not comparable
			const got = Object.keys(byDay[k])
			if(got.length !== keep.length)return
			if(seen[k] === undefined)return
			let reported = 0
			got.forEach(h => {reported += byDay[k][h]})
			rows.push({day: k, reported: reported, walked: seen[k], gap: reported - seen[k]})
		})
		if(!rows.length)return null
		let worst = rows[0]
		rows.forEach(r => {if(Math.abs(r.gap) > Math.abs(worst.gap))worst = r})

		/* AND THE SAME COMPARISON ACCOUNT BY ACCOUNT, on the freshest day both series have.

		   The walk is anchored at today, so today's gap is zero BY CONSTRUCTION - unless the anchor
		   and the remembered series do not mean the same thing. A non-zero gap at the anchor point is
		   not drift at all; it is the live balance and the stored balance disagreeing about the same
		   account on the same day, which no amount of transaction history can explain. Summed, that
		   is one number and unattributable; per account it names the account. */
		const day = rows[rows.length - 1].day
		const live = {}
		;(this.state.accounts || []).forEach(a => {
			if(keep.indexOf(a.hash) > -1)live[a.hash] = a.current
		})
		/* THE REMEMBERED ROW IN FULL, because "they disagree" is not yet a diagnosis. Both sides
		   store a CURRENT and an AVAILABLE, and they are different quantities - available subtracts
		   pending holds. If one side's current equals the other side's available, the fault is a
		   field and not a balance, and that is a different fix from a stale reading. */
		const rememberedRow = {}
		snaps.forEach(x => {
			if(keep.indexOf(x.accountHash) < 0)return
			if(dayKey(new Date(x.date)) !== day)return
			rememberedRow[x.accountHash] = x
		})
		const perAccount = keep.map(h => {
			const acct = (this.state.accounts || []).filter(a => a.hash === h)[0] || {}
			const row = rememberedRow[h] || {}
			return {hash: h, name: acct.name || h,
				live: live[h], liveAvailable: acct.available,
				remembered: byDay[day] ? byDay[day][h] : undefined,
				rememberedAvailable: row.available,
				rememberedLimit: row.limit, rememberedAt: row.date || null}
		})
		perAccount.forEach(p => {p.gap = (p.remembered === undefined || p.live === undefined)
			? null : p.remembered - p.live})
		return {rows: rows, worst: worst, first: rows[0], last: rows[rows.length - 1],
			partial: Object.keys(byDay).length - rows.length,
			day: day, perAccount: perAccount,
			anchorGap: rows[rows.length - 1].gap}
	}

	/* ---- the same inputs the tile uses ----------------------------------------------------------- */
	/* ACTIVE STREAMS ONLY. A closed stream carries an endDate and is not going to move money again;
	   listing it invites auditing a prediction nobody will ever see, and it pads the table with rows
	   whose only honest verdict is "not applicable". getAllTerminalStreams(true) is the model's own
	   filter, so this agrees with every other view rather than inventing a second definition. */
	terminals(){const m = Core.getMasterStream(); return m ? m.getAllTerminalStreams(true) : []}
	/* THE TILE'S OWN ACCOUNT RULE, NOT A SECOND ONE.

	   The bench exists to measure what ships. It was selecting accounts by matching the subtype
	   string for "check" and falling back to every depository account, while the tile asks
	   Core.accountTypeOf - Plaid's type, then the USER'S OWN override. Those disagree the moment
	   somebody retypes an account, and then the two are not measuring the same portfolio: an account
	   in one reading and not the other takes its whole balance out of that reading's anchor and its
	   transactions out of that reading's walk.

	   Every number here is a sum over this set, so a set that differs from the tile's makes every
	   number differ from the tile's, in the same direction and with nothing to report it. */
	typeOf(a){return Core.accountTypeOf(a)}
	credit(){
		return (this.state.accounts||[]).filter(a => this.typeOf(a) === AccountTypes.credit)
			.map(a => a.hash)
	}
	spending(){
		return (this.state.accounts||[]).filter(a => this.typeOf(a) === AccountTypes.checking
			&& a.current !== undefined).map(a => a.hash)
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
	/* THE CYCLE IS THE WINDOW, and it is first because it scores best - measured, not preferred.

	   "short" was max(3 months, cycle start): a window with no meaning of its own, invented to be
	   recent. It was the default, it lost to the cycle on every reading, and being neither a natural
	   period nor the best number it had nothing left to be. Removed rather than demoted, because a
	   losing option left on an axis is a thing someone who does not know it lost will try again.

	   The reporting cycle is a real boundary: budgets are declared against it, a long-period stream
	   draws down within it, and the declared amounts change on it. A window starting anywhere else
	   averages across a change of arrangement. */
	windows(now){
		return [
			["cycle", this.cycleStart(now)],
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
	analyse(from, monthsBack, variant){
		const back = monthsBack || 0
		const key = (from ? from.getTime() : "default") + "|" + back + "|" + (variant || "")
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
			shapeFromRouted: variant === "base" ? false : undefined,
			noPartition: variant === "base" || variant === "shape",
			drawdownFromOwnAccount: variant === "draw",
			turnAwareEvents: variant === "turn",
			startingMonth: reportingConfig.startingMonth,
			startingDay: prefs.reportingStartingDay || reportingConfig.startingDay})

		const forecastTerminals = model.terminals
	/* THE REPAYMENT LEGS, which are what the card row is scored against. A repayment is not spending
	   on either side, so both legs are out of the stream forecast - and the checking-side legs ARE
	   the money the card model has to reproduce. */
	/* TWO LEDGERS AGAIN, and they are not interchangeable. The model's legs stop at the as-of date -
	   that is the law it is built on - so a repayment INSIDE the window is not among them. The
	   actuals are describing what happened, so they need the legs from the whole ledger; the
	   forecast needs the model's. Naming them apart is the only thing that keeps them straight. */
		const reportLinks = accountLinks(this.props.transactions, this.credit(), this.spending())
		const actualLegIds = reportLinks.legIds
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
		const partKey = model.meta.partitionKey || (id => id)
		/* A CARD-ROUTED STREAM IS SCORED ON THE CARD, NOT ON NOTHING.

		   shareOfDay returns zero for a stream whose money does not pass through this reading, which
		   is right for the FORECAST - drawing it in checking would count it twice, once directly and
		   once inside the repayment. It was also what the bench scored, so twenty-five rows read
		   "predicted $0, actual $0, 100%": arithmetically true, and useless. A row nobody can audit is
		   a row that cannot be wrong.

		   So a card-routed stream is measured in a reading where it IS visible, against its own
		   charges on that card. Those numbers are its contribution to the statement - the thing it is
		   actually responsible for. They are kept OUT of `total`, which is the checking balance and
		   must not gain them, so the headline is unchanged. */
		const cardReading = Object.assign({}, model, {covers: () => true})
		const onCardRouted = t => !covers(model.routing[t.id]) && !/^__card__/.test(t.id)
		const perStream = {}, actualByStream = {}
		forecastTerminals.forEach(t => {
			perStream[t.id] = onCardRouted(t)
				? flowsOf(forecast(Object.assign({}, cardReading, {terminals: [t], now: open,
					balanceNow: 0, days: days, extraFlow: null, settles: null,
					settlementDay: null})))
				: flowsOf(run([t], false, false))
			const act = {}
			/* THE ACTUALS ARE PARTITIONED BY THE MODEL'S OWN RULE, not by a second copy of it. A
			   stream paid two ways is forecast as two, so its transactions have to be scored as two -
			   and the moment this side decides which leg belongs to which partition, there are two
			   answers to that question and they will drift apart. `partitionKey` IS the model's
			   assignment, handed out rather than reimplemented. */
			const src = t.partitionOf
				? (actualLedger[t.partitionOf] || []).filter(x =>
					partKey(t.partitionOf, x.accountHash) === t.id)
				: (actualLedger[t.id] || [])
			//and a card-routed stream is scored against the card it is routed to
			const inReading = onCardRouted(t)
				? (h => h === model.routing[t.id]) : covers
			;(t.id === "__settlement__" ? settleActual : src).forEach(x => {
				if(x.date < open || x.date > close || !inReading(x.accountHash))return
				/* A REPAYMENT LEG IS THE CARD'S, NOT THIS STREAM'S. It is taken out of the forecast as
				   a transaction, so it has to leave the actuals the same way - otherwise the stream it
				   is categorised to shows the whole card bill as an unpredicted miss while the card
				   row shows the same money again, and the dollar-days column counts it twice. */
				if(actualLegIds[x.txnId])return
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
		const reportSettlements = reportLinks.repayments
		const cardName = (this.state.accounts || []).reduce((m, x) => {m[x.hash] = x.name; return m}, {})
		const cardIdOf = h => "__card__" + h
		const cardRows = cards.map(h => ({id: cardIdOf(h), hash: h,
			name: "Card · " + (cardName[h] || h)}))
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
		forecastTerminals.concat([{id: CARD_ID, name: "Card settlement"}]).concat(cardRows)
			.forEach(t => {
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

		/* TWO SURFACES, BECAUSE THEY MEASURE DIFFERENT THINGS.

		   The headline sums every stream's SIGNED flow for a day and then takes the gap, so a stream
		   predicted $500 early and another predicted $500 late cancel to nothing. That is honest about
		   the BALANCE - the line really was right, and the balance is what the reader looks at.

		   It is not honest about the MODEL. Both streams were wrong; they were wrong in opposite
		   directions, which is luck and not a property either of them controls. Next month the same
		   two errors add instead.

		   So the gross surface adds each stream's own error without letting any of it cancel. The
		   headline is the outcome; the gross is the raw work still to do; the ratio between them is
		   how much of the current score is cancellation rather than accuracy. */
		let grossSurface = 0
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
			grossSurface += surface
			detail[t.id] = {surface: surface, predTotal: pt, actTotal: at,
				worst: worst, worstDay: worstDay,
				flowAccuracy: fm ? 1 - fe/fm : (fe > 0.005 ? 0 : 1),
				dayKeys: dayKeys, pred: perStream[t.id], act: actualByStream[t.id],
				actDays: days.map(d => d.slice(5) + " " + money(actualByStream[t.id][d])).join(", "),
				predDays: Object.keys(perStream[t.id]).filter(k => Math.abs(perStream[t.id][k]) > 1)
					.sort().map(d => d.slice(5) + " " + money(perStream[t.id][d])).join(", ")}
		})

		this._cache[key] = {open:open, close:record[record.length-1].date, days:record.length,
			since:since, surface:surface, grossSurface:grossSurface, area:area,
			error: area ? surface/area : 0,
			accuracy: area ? 1 - surface/area : 0, gain:gain, horizon:horizon, detail:detail,
			flowAccuracy:flowAccuracy, bias:bias, expectedFor:expectedFor,
			settlements:repayments, settleMonthly:settleMonthly, cards:model.meta.cards,
			linked:linked, legIds:legIds,
			model:model,
			cardNames:(this.state.accounts||[]).reduce((m, x) => {m[x.hash] = x.name; return m}, {}),
			excluded:Object.keys(legIds).length, actualLegs:Object.keys(actualLegIds).length,
			excludeIds:{},
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
			out.push("  streams charged to this card, and what each is expected to add per month:")
			if(!routed.length)out.push("    (none categorised to it)")
			routed.forEach(t => {
				const now2 = this.today()
				const opts = Object.assign({}, mdl, {covers: () => true})
				let sum = 0
				for(let d = 1; d <= 31; d++){
					const at = new Date(Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth(), d))
					if(at.getUTCMonth() !== now2.getUTCMonth())break
					sum += shareOfDay(t, at, opts)
				}
				const prom = (mdl.meta.promoted || {})[t.id]
				out.push("    " + t.name.slice(0, 26).padEnd(26) + money(sum).padStart(10)
					+ (prom ? "   instalment " + money((mdl.meta.instalment || {})[t.id])
						: "   " + ((mdl.shapes[t.id] || {}).spreadReason || "")))
			})
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
	rolling(daysAhead, since){
		const key = "rolling" + daysAhead + "|" + (since ? since.getTime() : "d")
		this._cache = this._cache || {}
		if(this._cache[key] !== undefined)return this._cache[key]
		const a = this.analyse(since)
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
					asOf: asOf, until: until, since: since, settlementDay: this.settlementDay(),
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
				lag: c.offsetDays || 0, passThrough: c.passThrough || 1,
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
			const sch = ((a && a.cards) || {})[c.hash] || {}
			/* A REPAYMENT IS A DATED EVENT. It lands once per cycle on a schedule the model fitted -
			   "spread, no single event" was the opposite of what the card model establishes. Dated
			   where the schedule locked to a weekday or a day of the month, drifting where it did
			   not. The AMOUNT is what is estimated here, never the day. */
			const locked = !!(sch.schedule && (sch.schedule.every || sch.schedule.monthDay))
			const per = (sch.events || []).length
			const each = per ? pred/Math.max(1, Math.round(30.44/(sch.intervalDays || 30.44))) : pred
			return {name: c.name, id: c.id, hash: c.hash, surface: (d && d.surface) || 0,
				cycle: sch.intervalDays ? "every " + Math.round(sch.intervalDays) + "d" : "per cycle",
				expected: pred, tier: locked ? 1 : 3,
				day: sch.schedule && sch.schedule.every
					? "every " + sch.schedule.every + "d"
					: (sch.schedule && sch.schedule.monthDay
						? "day " + sch.schedule.monthDay : "unscheduled"),
				amount: each, spread: locked ? 1 : 0, gain: (a.gain || {})[c.id] || 0,
				interval: sch.intervalDays || 0, offset: sch.offsetDays || 0,
				pass: sch.passThrough === undefined ? 1 : sch.passThrough,
				fitFrom: (sch.repayments || []).length,
				repaidFrom: ((a.linked && a.model && a.model.meta.links) || {})[c.hash] || null,
				feeders: (a.model ? a.model.terminals.filter(t => a.model.routing[t.id] === c.hash)
					.length : 0),
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
		/* HOW A STREAM IS ACTUALLY PAID, over the whole ledger rather than the model's window.
		   "Routing chose the card" says which side won; it does not say by how much, and a stream
		   split 95/5 and one split 55/45 are different problems wearing the same label. Counted from
		   the full ledger because this is a fact about the past, not a model input. */
		const allLegs = this.byStream()
		const cardsNow = this.credit(), chkNow = this.spending()
		const splitOf = id => {
			const out = {card: 0, checking: 0, cardAmt: 0, checkingAmt: 0, other: 0}
			;(allLegs[id] || []).forEach(x => {
				if(cardsNow.indexOf(x.accountHash) > -1){out.card++; out.cardAmt += x.amount}
				else if(chkNow.indexOf(x.accountHash) > -1){out.checking++; out.checkingAmt += x.amount}
				else out.other++
			})
			const n = out.card + out.checking
			out.n = n
			out.cardShare = n ? out.card/n : 0
			const gross = Math.abs(out.cardAmt) + Math.abs(out.checkingAmt)
			out.cardShareByAmount = gross ? Math.abs(out.cardAmt)/gross : 0
			return out
		}
		//the same model, in a reading where card-routed streams are visible - they are hidden from the
		//checking view because that money has not moved through it, which makes their row unreadable
		const asCard = mdl ? Object.assign({}, mdl, {covers: () => true}) : null
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
			/* ON A CARD. Its money reaches the checking account inside a repayment, so the checking
			   reading is right to show nothing - and a row reading "predicts $0, 100%" is then true
			   and unreadable. What it actually forecasts is a CHARGE, so that is what is shown, with
			   the card it lands on. */
			const onCard = this.credit().indexOf(mdl.routing[s.id]) > -1
			if(onCard && !total){
				let c = 0, cBig = 0, cDay = 0, cDays = []
				for(let d = 1; d <= 31; d++){
					const at2 = new Date(Date.UTC(y, m, d))
					if(at2.getUTCMonth() !== m)break
					const v = shareOfDay(s, at2, asCard)
					cDays.push(v); c += v
					if(Math.abs(v) > Math.abs(cBig)){cBig = v; cDay = d}
				}
				const cLive = cDays.filter(v => Math.abs(v) > Math.abs(c)*0.02).length
				const at3 = new Date(Date.UTC(y, m, cDay || 1))
				return {total: c, big: cBig, bigDay: cDay, live: cLive, onCard: mdl.routing[s.id],
					phase: h && h.cycle && h.cycle.phaseOf ? h.cycle.phaseOf(at3) : (cDay - 1),
					cycle: h && h.cycle ? h.cycle.name : "monthly",
					spreadReason: h ? h.spreadReason : null,
					promoted: !!(mdl.meta.promoted || {})[s.id],
					instalment: (mdl.meta.instalment || {})[s.id],
					share: c ? Math.abs(cBig/c) : 0}
			}
			/* dayLabel takes the cycle's PHASE, not the day of the month, and they only coincide for
			   a monthly cycle. Passing the calendar day named a weekly stream after a day number and
			   a semimonthly one after a phase it does not have; it read correctly on the 14th purely
			   because 14 is in the first half of the month. */
			const at = new Date(Date.UTC(y, m, bigDay || 1))
			const phase = h && h.cycle && h.cycle.phaseOf ? h.cycle.phaseOf(at) : (bigDay - 1)
			return {total: total, big: big, bigDay: bigDay, phase: phase, live: live,
				cycle: h && h.cycle ? h.cycle.name : "monthly",
				promoted: !!(mdl.meta.promoted || {})[s.id],
				instalment: (mdl.meta.instalment || {})[s.id],
				cycle: h && h.cycle ? h.cycle.name : "monthly",
				spreadReason: h ? h.spreadReason : null,
				confident: h ? h.confident : null,
				share: total ? Math.abs(big/total) : 0}
		}
		/* THE MODEL'S TERMINALS, NOT THE DECLARED ONES. A stream paid two ways is forecast as two
		   streams, so it is audited as two rows - reading the declared list back would show one row
		   for a thing the model no longer has, scored against a forecast nothing produced. */
		const rowStreams = (mdl && mdl.terminals) || this.terminals()
		this._rows = cardRows.concat(rowStreams.filter(s => !dropped[s.id]).map(s => {
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
			/* THE DETECTED CYCLE, not the declared one - and both when they disagree.
			   The column was showing the user's own declaration back to them, which is the one thing
			   in the row they already know. What the model DETECTED is the interesting half, and a
			   disagreement between the two is the most interesting thing of all: a stream declared
			   weekly whose shape resolved to a single monthly day is predicting a month of spending
			   as one charge, and the row read "weekly" throughout. */
			return {name:s.name, id:s.id,
				cycle:(p && p.cycle && p.cycle !== declared)
					? p.cycle + " (declared " + declared + ")" : declared,
				detected:(p && p.cycle) || null, declared:declared, expected:perCycle,
				split:splitOf(s.partitionOf || s.id),
				amountRule:(mdl.meta.amountRule || {})[s.id] || null,
				routedTo:mdl.routing[s.id] || null,
				shapeFrom:(mdl.meta.shapeFrom || {})[s.id] || null,
				events:(mdl.meta.events || {})[s.id] || null,
				legs:((mdl.meta.seen || {})[s.id] || []).length,
				scoredOn:(p && p.onCard) ? "card" : "checking",
				partOf:s.partitionOf || null, partAccount:s.partitionAccount || null,
				partShare:s.partitionShare || 0,
				onCard:(p && p.onCard) || null, promoted:!!(p && p.promoted),
				instalment:(p && p.instalment) || 0,
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
	/* THE HORIZON AND THE LOOKBACK ARE THE TWO AXES, and everything else that was on the tile was a
	   number nobody chose. The horizon says how far ahead the forecast is being asked to see; the
	   lookback says how much history it was built from. One accuracy, and the two knobs that move it.

	   `month` is the original measure - one forecast made on the first day and marked over the whole
	   month. The others re-forecast from many mornings and score the days that followed, which is
	   what the tile is actually read for. */
	horizons(){return [["7d", 7], ["14d", 14], ["30d", 30], ["month", null]]}
	horizon(){return this.state.roll === undefined ? 7 : this.state.roll}
	lookback(){
		const list = this.windows(this.today())
		const i = this.state.look === undefined ? 0 : this.state.look
		return list[Math.min(i, list.length - 1)]
	}
	score(){
		const since = this.lookback()[1]
		const days = this.horizon()
		if(days === null){const a = this.analyse(since); return a ? a.accuracy : null}
		const r = this.rolling(days, since)
		return r ? r.accuracy : null
	}

	/* THE SAME MONTH SCORED WITHOUT LETTING ERRORS CANCEL.

	   The headline sums every stream's SIGNED flow for a day before taking the gap, so Savings
	   predicted $4,000 on the 15th against $6,000 on the 14th is partly paid for by some other stream
	   erring the other way. That is honest about the BALANCE, which is what the reader looks at, and
	   it is not a measure of the model: both streams were wrong, and the cancellation is luck neither
	   of them controls.

	   RAW adds each stream's own error and lets none of it cancel. It is always the lower number. The
	   gap between the two is how much of the score is currently luck. */
	rawScore(){
		const a = this.analyse(this.lookback()[1])
		if(!a || !a.area || !a.grossSurface)return null
		return 1 - a.grossSurface/a.area
	}

	/* GROUPED BY THE ACCOUNT THE MONEY LEAVES, not by how regular it is. The tier says how a stream
	   behaves and is on the row already; the account says which of two forecasts it belongs to, which
	   is the thing that has to be audited one side at a time.

	   AMBIGUOUS is its own group and not a mistake to hide: a stream with legs on both a checking and
	   a card account is being paid two ways, and the routing has to pick one. That choice is worth
	   seeing rather than discovering later as a stream that vanished from the reading it was in. */
	groups(){
		const cards = this.credit(), keep = this.spending()
		const mdl = (this.analyse() || {}).model
		const seen = (mdl && mdl.meta && mdl.meta.seen) || {}
		const where = r => {
			if(/^__card__/.test(r.id || ""))return "card"
			const legs = seen[r.id] || []
			let onChk = false, onCard = false
			legs.forEach(x => {
				if(cards.indexOf(x.accountHash) > -1)onCard = true
				else if(keep.indexOf(x.accountHash) > -1)onChk = true
			})
			if(onChk && onCard)return "both"
			if(onCard)return "card"
			if(onChk)return "checking"
			return r.onCard ? "card" : "checking"
		}
		const by = {checking:[], card:[], both:[]}
		this.rows().forEach(r => by[where(r)].push(r))
		return [["checking", "CHECKING ACCOUNT", by.checking],
			["card", "CARD ACCOUNT", by.card],
			["both", "BOTH - routing had to choose", by.both]]
	}

	/* ONE MECHANISM AT A TIME, AGAINST THE SAME MONTH.

	   Two changes shipped in one reading - shapes read from the routed account, and streams paid two
	   ways split in half - and the score fell eighteen points. Attributing that by reading the code is
	   guessing; both are switches, so the honest thing is to build the model three ways against the
	   same window and print what each is worth.

	   NESTED, NOT INDEPENDENT: each line adds one mechanism to the line above it, so the difference
	   between two adjacent lines is that mechanism's price. */
	variants(){
		if(this._variants)return this._variants
		/* THE HEADLINE'S WINDOW, NOT THE CONTROL'S. The ladder was scored on whichever lookback the
		   axis happened to be set to while the headline used the default, so its rungs were being
		   read against a number from a different window - the same like-for-like error the ladder
		   exists to prevent. It uses the headline's window and prints which one. */
		const win = this.windows(this.today())[0]
		this._variantWindow = win[0]
		const of = v => {
			const a = this.analyse(win[1], 0, v)
			return a ? a.accuracy : null
		}
		this._variants = [
			["baseline (covered-account shapes, no split)", of("base")],
			["+ shape from the routed account", of("shape")],
			["+ a stream paid two ways is two streams   <- shipping", of(null)],
			["+ a budget draws down wherever it was spent", of("draw")],
			["+ a turn is the stream's own period, not always a month", of("turn")]
		]
		return this._variants
	}

	/* A STATEMENT IS THREE TERMS, and the report showed their sum.

	   The card is 85% of the dollar-day surface, and "predicted -$1,625, actual -$2,075" cannot say
	   which half of the model is wrong. Fact, budget and residual fail in different ways and have
	   different cures:

	     posted     what has already hit the card. Too small means a posting lag, not a model fault.
	     planned    what the card's own streams say is still to come before the statement closes.
	     residual   what those streams are KNOWN to miss - the trailing gap between what the card was
	                actually charged and what they claimed over the same days.

	   A residual of zero on an under-predicted card is the diagnosis worth seeing: it means the
	   streams have already claimed the difference without spending it, so the gap that should have
	   carried it measured nothing. */
	/* WHAT THE CARD WAS CHARGED AGAINST WHAT IT WAS PAID, over the scored window.

	   A card that clears in full cannot be repaid more than it was charged. Where those two disagree
	   the card model's premise is wrong before any forecast is made, and no amount of tuning the rate
	   will close it - so it is printed next to the rate rather than left to be inferred. */
	chargeVsPay(hash){
		const a = this.analyse()
		if(!a)return null
		let charged = 0
		;(this.props.transactions || []).forEach(t => {
			if(t.userInstitutionAccountId !== hash)return
			const d = new Date(t.date)
			if(d < a.open || d > a.close)return
			if(t.amount < 0)charged += -t.amount
		})
		let paid = 0
		const act = (a.detail && a.detail["__card__" + hash] && a.detail["__card__" + hash].act) || {}
		Object.keys(act).forEach(k => {paid += Math.abs(act[k])})
		return {charged: charged, paid: paid}
	}

	statementLines(hash){
		const a = this.analyse()
		const ev = (a && a.model && a.model.meta && a.model.meta.settlementEvents) || {}
		const id = "__card__" + hash
		const act = (a && a.detail && a.detail[id] && a.detail[id].act) || {}
		const out = []
		let seenAny = false
		Object.keys(ev).sort().forEach(k => {
			;(ev[k].parts || []).forEach(p => {
				if(p.card !== hash)return
				seenAny = true
				out.push("      " + k.slice(5)
					+ "  posted " + money(p.posted || 0)
					+ " + planned " + money(p.planned || 0)
					+ " + residual " + money(p.projected || 0)
					+ (p.ahead ? " (" + money(-(p.rate || 0)) + "/d x " + Math.round(p.ahead) + "d)" : "")
					+ "  =  " + money(p.amount || 0)
					+ "   actual " + money(act[k] || 0))
			})
		})
		/* THE RATE IS A DIFFERENCE, so both halves are printed. Zero can mean the streams describe
		   the card completely or that they claim money they never spend; only the two quantities it
		   subtracts can say which. */
		const r = ((a.model.meta || {}).cardRate || {})[hash]
		if(seenAny && r)out.push("      rate = (charged " + money(-r.charged)
			+ " - streams said " + money(-r.said) + ") / " + Math.round(r.rateDays) + "d"
			+ "   =  " + money(-r.rate) + "/d"
			+ (r.charged <= r.said ? "   <- the streams claim MORE than the card was charged" : ""))
		const cp = this.chargeVsPay(hash)
		if(seenAny && cp)out.push("      in this window: charged " + money(-cp.charged)
			+ "   repaid " + money(-cp.paid)
			+ (cp.charged > 1 && cp.paid > cp.charged*1.15
				? "   <- repaid MORE than charged: the card does not clear from its own charges" : ""))
		return out
	}

	accountName(hash){
		const a = (this.state.accounts || []).filter(x => x.hash === hash)[0]
		return a ? a.name : null
	}

	/* THE FOUR ANSWERS, ONCE. The screen shows the VALUE and the copy shows the value and its
	   working - which is a fork in the rendering, not a second set of answers. Two authors for one
	   explanation is exactly what principle 29 is about, and it has already happened here once.

	   `short` is what a row is scanned for: four values, no sentences. `long` is what a row is argued
	   with, and it only reaches the clipboard. */
	rowAnswers(r){
		const acct = h => (this.accountName(h) || (h ? String(h).slice(0, 22) : "-"))
		const pct = v => Math.round((v || 0)*100) + "%"
		const sp = r.split
		if(r.hash)return [
			{key: "account", short: "the card itself, " + r.feeders + " streams charge to it",
				long: (r.repaidFrom ? "repaid from " + acct(r.repaidFrom) : "not linked to an account")
					+ " \u00b7 " + r.hash},
			{key: "cycle", short: "every " + Math.round(r.interval) + "d"
				+ (r.offset ? ", closes " + Math.round(r.offset) + "d before" : ""),
				long: "fitted from " + r.fitFrom + " paired repayment(s), not detected from a shape"},
			{key: "amount", short: money(r.amount) + "/statement",
				long: money(r.expected) + " over the window \u00b7 pass-through " + pct(r.pass)},
			{key: "method", short: "posted + planned + residual",
				long: "the schedule sets the day, never the amount"}
		]
		const cycleShort = (r.detected || "-")
			+ (r.declared === r.detected ? " (same as declared)" : " (declared " + r.declared + ")")
		//WHICH RULE, in two words - the sentence version is the working, not the value
		const m = r.amountRule || ""
		const method = /LEDGER/.test(m) ? "ledger mean"
			: (/INSTALMENT/.test(m) ? "instalment"
				: (/SPREAD/.test(m) ? "budget spread"
					: (/used up|not forecast|budget of nothing/.test(m) ? "nothing left"
						: "declared")))
		const when = r.day === "spread by budget" ? "spread by budget"
			: (r.day === "spread" ? "spread" : "lump day " + String(r.day).replace(/^day /, ""))
		return [
			/* THE SHARE IS OF THE ACCOUNT IT CHOSE, not of the card regardless.
			   "checking (0/27 tx, 0% money)" was the card's share printed under a checking heading -
			   a stream that never touches a card reading as though it had been measured and found
			   empty. The number has to answer the question the line is asking: how much of this
			   stream's money is where it says it routed. */
			{key: "account", short: (r.onCard ? "card" : "checking")
				+ (sp && sp.n
					? " (" + (r.onCard ? sp.card : sp.checking) + "/" + sp.n + " tx, "
						+ pct(r.onCard ? sp.cardShareByAmount : 1 - sp.cardShareByAmount)
						+ " money)"
					: ""),
				long: "routed to " + acct(r.routedTo)
					+ (r.partOf ? " \u00b7 one side of a split, " + pct(r.partShare) + " of the budget"
						: " \u00b7 whole stream")
					+ (r.onCard ? " \u00b7 not drawn in checking; scored against its charges on the card"
						: "")},
			{key: "cycle", short: cycleShort,
				long: "from " + r.legs + " transactions"
					+ (r.shapeFrom && r.shapeFrom !== "recent" ? " (" + r.shapeFrom + " window)" : "")
					+ (r.events ? " \u00b7 " + (Math.round(r.events*10)/10) + " movements per turn" : "")
					+ (r.declared !== r.detected
						? " \u00b7 declared is how the budget is WRITTEN, detected is how often money"
							+ " MOVES" : "")},
			{key: "amount", short: money(r.amount) + "/mo",
				long: "you declared " + money(r.expected) + " per " + (r.declared || "month")
					+ (m ? " \u00b7 " + m : "")},
			{key: "method", short: method + ", " + when,
				long: "top day carries " + pct(r.spread) + " \u00b7 tier " + r.tier
					+ (r.day === "spread by budget"
						? " \u00b7 the budget rule OVERRODE the measured shape" : "")
					+ (r.promoted ? " \u00b7 instalment " + money(r.instalment) : "")}
		]
	}

	/* THE WHOLE INPUT, AS A FILE.

	   Every algorithm change so far has been argued from a row pasted into a chat: one stream, one
	   month, no way to re-run it after the next change. A fixture is the same portfolio held still -
	   the model is a pure function of these five things, so a file containing them can be replayed
	   against any future version and the difference is the change.

	   Captured from the bench because the bench already holds all five for its own reasons. Raw, not
	   summarised: whatever is dropped here is a question that cannot be asked later, which is the
	   whole argument of principle 27. */
	fixture(){
		return {
			version: BENCH_VERSION,
			capturedAt: new Date().toISOString(),
			today: this.today().toISOString(),
			settlementDay: this.settlementDay(),
			//the master stream round-trips through its own constructor
			masterStream: Core.getMasterStream() || null,
			userPreferences: (Core.getUserData() || {}).userPreferences || {},
			accountTypes: (Core.getUserData() || {}).accountTypes || {},
			accounts: this.state.accounts || [],
			remembered: this.state.remembered || [],
			transactions: (this.props.transactions || []).map(t => ({
				transactionId: t.transactionId, id: t.id,
				date: t.date, frontendDate: t.frontendDate,
				amount: t.amount, description: t.description,
				categorized: t.categorized,
				streamAllocation: t.streamAllocation,
				userInstitutionAccountId: t.userInstitutionAccountId,
				pairedTransferTransactionId: t.pairedTransferTransactionId,
				disambiguationId: t.disambiguationId,
				userDefinedTransactionType: t.userDefinedTransactionType,
				connectorName: t.connectorName, institutionId: t.institutionId
			}))
		}
	}

	/* WRITTEN WHERE THE TESTS READ IT, by the local server.

	   A browser cannot write to disk, so a download lands in Downloads and has to be moved by hand
	   every time - which means it is done once, goes stale, and the tests quietly run against a
	   portfolio from three weeks ago. The local server can write the file, so it does.

	   The download stays as the fallback for a client not talking to a local server. It is worse in
	   exactly the way described above, so it says so instead of looking like a success. */
	saveFixture(){
		const say = m => this.updateState({copied: m},
			() => setTimeout(() => this.updateState({copied: null}), 3200))
		let f = null
		try{f = this.fixture()}
		catch(e){return say("could not build the fixture: " + (e && e.message))}
		say("writing " + f.transactions.length + " transactions...")
		ApiCaller.saveFixture(f).then(r => {
			if(r && r.saved)return say(r.transactions + " transactions written to " + r.path)
			this.downloadFixture(f, (r && r.error) || "the server did not write it")
		}).catch(e => this.downloadFixture(f, (e && e.message) || "the server refused"))
	}

	downloadFixture(f, why){
		try{
			const blob = new Blob([JSON.stringify(f)], {type: "application/json"})
			const url = URL.createObjectURL(blob)
			const a = document.createElement("a")
			a.href = url
			a.download = "portfolio.json"
			document.body.appendChild(a)
			a.click()
			document.body.removeChild(a)
			setTimeout(() => URL.revokeObjectURL(url), 4000)
			this.updateState({copied: "downloaded instead (" + why
				+ ") - move it to client/src/tests/fixtures/portfolio.json"},
				() => setTimeout(() => this.updateState({copied: null}), 6000))
		}catch(e){
			this.updateState({copied: "save failed: " + (e && e.message)},
				() => setTimeout(() => this.updateState({copied: null}), 4000))
		}
	}

	//the transactions a stream's shape was actually built from, as the model kept them
	shapeSourceOf(id){
		const a = this.analyse()
		return ((a && a.model && a.model.meta.shapeSource) || {})[id] || null
	}

	//everything needed to argue about one row, as text
	rowDebug(r){
		const d = r.detail || {}
		/* THE COPY PAYLOAD IS THE DEBUG SURFACE, so it carries the whole argument for the row and not
		   a subset of it. The card's statement arithmetic went into the report body and the row was
		   copied instead, so the diagnosis it was built to deliver never arrived.

		   A CARD ROW IS NOT A STREAM. It has no partition, no split and no account it is "paid by" -
		   it IS an account - so those three lines said "checking", "whole stream" and "one account
		   only" about the largest row in the reading, all three meaningless and one of them wrong. */
		const isCard = !!r.hash
		const out = [r.name + "   " + BENCH_VERSION]
		this.rowAnswers(r).forEach(x => out.push(x.key + ": " + x.short
			+ (x.long ? "  \u2014 " + x.long : "")))
		/* THE EVIDENCE FOR THE CYCLE, which the `cycle` line asserts and cannot show.

		   Grouped by day of month, because that is the axis the shape is binned on. Two clusters five
		   days apart is why a paycheck comes out as two steps, and no amount of prose about
		   events-per-turn makes that visible - the days and the mass on each of them do. */
		const src = this.shapeSourceOf(r.id)
		if(src && src.length){
			const byDay = {}
			src.forEach(x => {
				const dd = new Date(x.date).getUTCDate()
				if(!byDay[dd])byDay[dd] = {n: 0, sum: 0, when: []}
				byDay[dd].n++
				byDay[dd].sum += x.amount
				byDay[dd].when.push(dayKey(x.date).slice(5) + " " + money(x.amount))
			})
			let mass = 0
			Object.keys(byDay).forEach(dd => {mass += Math.abs(byDay[dd].sum)})
			out.push("shape read from " + src.length + " transaction(s), by day of month:")
			Object.keys(byDay).sort((x, y) => Number(x) - Number(y)).forEach(dd => {
				out.push("  day " + dd + "  " + byDay[dd].n + " tx  " + money(byDay[dd].sum) + "  "
					+ Math.round(100*Math.abs(byDay[dd].sum)/(mass || 1)) + "% of the mass  \u00b7 "
					+ byDay[dd].when.join(", "))
			})
		}
		out.push("score " + Math.round((r.gain || 0)*100) + "% \u00b7 surface " + money(r.surface)
			+ " $-days" + (r.onCard && !r.hash ? " (on the card)" : ""))
		out.push("pred  " + money(d.predTotal || 0) + " \u00b7 " + (d.predDays || "nothing"))
		out.push("act   " + money(d.actTotal || 0) + " \u00b7 " + (d.actDays || "nothing"))
		out.push("worst " + money(d.worst || 0) + (d.worstDay ? " on " + d.worstDay : "")
			+ " \u00b7 transactions " + Math.round((d.flowAccuracy || 0)*100) + "%")
		if(isCard)this.statementLines(r.hash).forEach(l => out.push(l.replace(/^ {6}/, "  ")))
		return out.join("\n")
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
			/* THE OUTCOME AND THE RAW WORK, side by side. The gap between them is cancellation - two
			   streams wrong in opposite directions - which flatters the balance and says nothing good
			   about the model. */
			if(a.grossSurface > 0)out.push("gross surface " + money(a.grossSurface)
				+ " $-days, summed per stream without cancelling"
				+ "   (" + Math.round(100*(1 - a.surface/a.grossSurface))
				+ "% of the stream error cancels)")
			out.push("by horizon: " + a.horizon.map(h => "+" + h.days + "d "
				+ (h.accuracy*100).toFixed(0) + "%").join("   "))
			out.push(dayKey(a.open) + " to " + dayKey(a.close)
				+ "   lookback since " + dayKey(a.since))
			/* THE ACTUALS CURVE, AGAINST WHAT THE BANK ACTUALLY SAID.

			   Everything above is scored against the reconstruction, and the reconstruction is one
			   live balance walked backwards over the transactions. If that walk is wrong the whole
			   reading is measured against a wrong line - so it is checked first, and against the only
			   independent record there is. */
			/* THE ACCOUNTS FIRST, because every number below is a sum over a set of them and a set
			   that is wrong makes every number below wrong in the same direction. */
			const aa = this.accountAudit()
			out.push("")
			if(aa){
				out.push("ACCOUNTS  (tile = Core.accountTypeOf; bench = subtype contains \"check\")")
				aa.forEach(x => out.push("  " + (x.name || "?")
					+ "   " + x.hash
					+ "   " + (x.type || "?") + "/" + (x.subtype || "?")
					+ "   current " + (x.current === undefined ? "NONE" : money(x.current))
					+ " / available " + (x.available === undefined ? "NONE" : money(x.available))
					+ "   inferred " + x.inferred
					+ (x.override ? " -> override " + x.override : "")
					+ "   " + x.txns + " txns"
					+ "   [" + (x.inTile ? "TILE" : "    ") + "]"
					+ "[" + (x.inBench ? "BENCH" : "     ") + "]"
					+ (x.isCard ? "[CARD]" : "")))
				const sum = list => list.reduce((n, x) => n + (x.current || 0), 0)
				const tileSet = aa.filter(x => x.inTile), benchSet2 = aa.filter(x => x.inBench)
				out.push("  anchor as the TILE builds it  " + money(sum(tileSet))
					+ "   over " + tileSet.length + " account(s)")
				out.push("  anchor as the BENCH builds it " + money(sum(benchSet2))
					+ "   over " + benchSet2.length + " account(s)")
				const missed = aa.filter(x => x.inTile !== x.inBench)
				if(missed.length)out.push("  THE TWO READINGS DISAGREE about: "
					+ missed.map(x => (x.name || x.hash)).join(", "))
				const silent = aa.filter(x => x.inTile && !x.txns)
				if(silent.length)out.push("  IN THE ANCHOR BUT WITH NO TRANSACTIONS: "
					+ silent.map(x => (x.name || x.hash) + " " + money(x.current || 0)).join(", ")
					+ "   - its money is in the anchor and its movements are not in the walk")
			}

			const dr = this.driftVsRemembered()
			out.push("")
			if(!dr){
				out.push("RECONSTRUCTION vs REMEMBERED BALANCES: no stored history covering this"
					+ " window yet (snapshots only accumulate going forward)")
			}else{
				out.push("RECONSTRUCTION vs REMEMBERED BALANCES  (reported - walked back from today)")
				out.push("  " + dr.rows.length + " days compared, " + dr.first.day + " to "
					+ dr.last.day + (dr.partial ? "   (" + dr.partial
						+ " days skipped: not every spending account reported)" : ""))
				out.push("  worst  " + dr.worst.day + "   reported " + money(dr.worst.reported)
					+ "   walked " + money(dr.worst.walked) + "   gap " + money(dr.worst.gap))
				const near = dr.rows.filter(r => Math.abs(r.gap) > 1)
				out.push("  " + near.length + " of " + dr.rows.length
					+ " days disagree by more than $1"
					+ (near.length ? "   first at " + near[near.length - 1].day : ""))
				dr.rows.slice(-14).forEach(r => out.push("      " + r.day
					+ "   reported " + money(r.reported) + "   walked " + money(r.walked)
					+ "   gap " + money(r.gap)))
				/* THE ANCHOR IS THE WALK'S ONE FIXED POINT, so a gap there is not drift. */
				if(Math.abs(dr.anchorGap) > 1){
					out.push("  THE GAP IS AT THE ANCHOR ITSELF (" + dr.day + "), so it is not drift:"
						+ " the live balance and the remembered one disagree about the same accounts"
						+ " on the same day. Account by account:")
					const m = v => (v === undefined || v === null ? "-" : money(v))
					dr.perAccount.forEach(p => {
						out.push("      " + p.name + "  " + p.hash
							+ (p.gap === null ? "   (no comparison)" : "   gap " + money(p.gap)))
						out.push("          live        current " + m(p.live)
							+ "   available " + m(p.liveAvailable))
						out.push("          remembered  current " + m(p.remembered)
							+ "   available " + m(p.rememberedAvailable)
							+ "   limit " + m(p.rememberedLimit)
							+ (p.rememberedAt ? "   observed " + p.rememberedAt : ""))
						/* THE SAME NUMBER UNDER A DIFFERENT NAME IS A FIELD FAULT, not a stale
						   balance, and the two have different fixes. */
						const near = (a, b) => a !== undefined && b !== undefined
							&& a !== null && b !== null && Math.abs(a - b) < 0.005
						if(near(p.live, p.rememberedAvailable))out.push("          <- the LIVE current"
							+ " equals the REMEMBERED available: this is a wrong FIELD, not a stale"
							+ " balance")
						if(near(p.liveAvailable, p.remembered))out.push("          <- the LIVE"
							+ " available equals the REMEMBERED current: the two sides are reading"
							+ " different fields")
					})
				}
			}
			out.push("")
			/* WHAT EACH MECHANISM IS WORTH, on this month. Nested: each line adds one thing to the
			   line above, so the step between two lines is that mechanism's price. */
			out.push("")
			this.variants()
			out.push("MECHANISMS, added one at a time to the \"" + (this._variantWindow || "?")
				+ "\" window - the one the headline above uses:")
			this.variants().forEach(v => out.push("  " + (v[1] === null ? "  -  "
				: ((v[1]*100).toFixed(1) + "%").padStart(7)) + "   " + v[0]))
			out.push("")
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
			out.push("repayment legs taken out of the forecast: " + (a.excluded || 0)
				+ "   and out of the actuals: " + (a.actualLegs || 0))
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
				//a card-routed stream is read on its card, and whether it promoted to an instalment
				//is the difference between a lump being named into a statement and being averaged
				if(r.split && r.split.card && r.split.checking)
					out.push("      paid " + Math.round(r.split.cardShare*100) + "% by card ("
						+ r.split.card + " of " + r.split.n + " transactions, "
						+ Math.round(r.split.cardShareByAmount*100) + "% of the money)"
						+ " - routing chose " + (r.onCard ? "the card" : "checking"))
				if(r.onCard)out.push("      charged to a card"
					+ (r.promoted ? " · INSTALMENT " + money(r.instalment) + " per turn"
						: " · not an instalment, so it is only in the card's average"))
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
					//and for a card, the three terms each statement was made of
					if(r.hash)this.statementLines(r.hash).forEach(l => out.push(l))
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
		let groups, score = null, err = null
		try{score = this.score(); groups = this.groups()}
		catch(e){err = (e && e.message) + " | " + (e && e.stack)}
		if(err)return <Wrap><Line>{err}</Line></Wrap>
		const look = this.lookback()
		return <Wrap>
			{/* ONE NUMBER AND THE TWO KNOBS THAT MOVE IT. Everything else that used to sit here was a
			    figure nobody had chosen to look at, and a tile of numbers that are all equally
			    prominent is a tile nobody reads. */}
			<Score>
				<Big>{score === null ? "—" : (score*100).toFixed(1) + "%"}
					<Small> balance accuracy</Small></Big>
				{/* the outcome and the raw work, because they are different claims and the headline
				    alone flatters the model whenever two streams happen to err in opposite
				    directions */}
				<Line>{(() => {
					let raw = null
					try{raw = this.rawScore()}catch(e){raw = null}
					return raw === null ? "" : (raw*100).toFixed(1)
						+ "% raw — each stream's own error, nothing cancelling"
				})()}</Line>
				<Bar>
					{this.horizons().map(h => <Btn key={h[0]} type="button"
						style={this.horizon() === h[1] ? {fontWeight:600, borderStyle:"solid"} : null}
						onClick={() => this.updateState({roll:h[1]})}>{h[0]}</Btn>)}
				</Bar>
				<Bar>
					{this.windows(this.today()).map((w, i) => <Btn key={w[0]} type="button"
						style={look[0] === w[0] ? {fontWeight:600, borderStyle:"solid"} : null}
						onClick={() => this.updateState({look:i})}>{w[0]}</Btn>)}
				</Bar>
				<Note>{BENCH_VERSION}</Note>
			</Score>
			<Bar>
				<Btn type="button" onClick={() => this.copy()}>{this.state.copied || "Copy report"}</Btn>
				<Btn type="button" onClick={() => this.copy(this.cardExport())}>Copy card export</Btn>
				<Btn type="button" onClick={() => this.saveFixture()}>Save fixture</Btn>
			</Bar>
			{(groups||[]).map(g => g[2].length ? <div key={g[0]}>
				<Head>{g[1]}</Head>
				{g[2].map((r,i) => <Row key={i}
						onClick={() => this.updateState({open: this.state.open === r.name ? null : r.name})}
						style={{cursor:"pointer"}}>
					{/* SCANNABLE: a name, a score, what it thinks the stream IS. The prose that used to
					    live here made every row the same width and none of them comparable. */}
					<Name>{r.name}</Name>
					<Tier $t={r.tier}>{Math.round((r.gain || 0)*100) + "%"}</Tier>
					<Cols>
						<Cell>{r.cycle}{r.day && r.day !== "-" ? " · " + r.day : ""}</Cell>
						<CellR>{money(r.amount)}</CellR>
					</Cols>
					{/* ONE AUTHOR FOR THE EXPLANATION. The expanded row was hand-built JSX and the copy
					    button called rowDebug(), so the two drifted: the four questions and the card's
					    statement arithmetic reached the clipboard and never reached the screen, and the
					    screen kept prose the payload had dropped. Whatever is worth copying is worth
					    reading, and there is no version of this where they should differ - so the row
					    RENDERS the payload. */}
					{/* FOUR VALUES, NOT FOUR SENTENCES. An expanded row is SCANNED - the reader wants to
					    know which account, how often, how much and by what rule, and each of those is
					    a value rather than an explanation. The working behind each one goes to the
					    clipboard, where there is room to argue with it.

					    Same four answers either way: rowAnswers() is the single source and this
					    renders `short` where the copy renders `short` and `long`. */}
					{this.state.open === r.name ? <React.Fragment>
						{this.drawStream(r.id)}
						{this.rowAnswers(r).map(x =>
							<Line key={x.key}><K>{x.key}</K>{x.short}</Line>)}
						<Line>{money(r.surface)} $·days
							{r.detail && Math.abs(r.detail.actTotal) > 1
								? " · actual " + money(r.detail.actTotal) : ""}</Line>
						<Bar onClick={e => e.stopPropagation()}>
							<Btn type="button" onClick={() => this.copy(this.rowDebug(r))}>
								Copy row</Btn>
						</Bar>
					</React.Fragment> : null}
				</Row>)}
			</div> : null)}
		</Wrap>
	}
}
