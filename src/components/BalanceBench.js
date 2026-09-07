import React from 'react';
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DS from '../DesignSystem.js';
import Core from '../core.js';
import {reportingConfig} from '../processors/ReportingCore.js';
import {reconstruct, forecast, histogramOf, accountRoutingOf, dayKey, monthlyExpectationAt,
	groupByStream, pointPrediction, dayLabel, TIERS} from '../processors/BankBalance.js';

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
		this.state = {accounts:null, copied:null}
	}
	componentDidMount(){
		Core.getAccountsWithBalances()
			.then(a => this.updateState({accounts:a||[]}))
			.catch(() => this.updateState({accounts:[]}))
	}

	/* ---- the same inputs the tile uses ----------------------------------------------------------- */
	terminals(){const m = Core.getMasterStream(); return m ? m.getAllTerminalStreams() : []}
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
	analyse(from){
		const key = from ? from.getTime() : "default"
		this._cache = this._cache || {}
		if(this._cache[key])return this._cache[key]
		const now = this.today()
		const since = from || this.windows(now)[0][1]
		const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate()
		const c = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1,
			Math.min(now.getUTCDate(), lastDay)))
		const open = new Date(c.getTime() - 15*DAY), close = new Date(c.getTime() + 15*DAY)
		const record = reconstruct(this.ledger(), now, this.anchor(), open)
			.filter(p => p.date <= close)
		if(record.length < 2)return null

		const byStream = this.byStream()
		const keep = this.spending(), cards = this.credit(), fallback = keep[0]
		const shapes = {}, dir = {}, sliced = {}
		this.terminals().forEach(t => {
			//OUT OF SAMPLE at the top, and no further back than the lookback window at the bottom
			sliced[t.id] = byStream[t.id].filter(x => x.date < open && x.date >= since)
			shapes[t.id] = histogramOf(sliced[t.id], {prefer: t.getPreferredPeriod
				? t.getPreferredPeriod() : "monthly"})
			const a = monthlyExpectationAt(t, open, "monthly")
			dir[t.id] = a < 0 ? -1 : (a > 0 ? 1 : 0)
		})
		const routed = accountRoutingOf(sliced, id => dir[id])
		const days = Math.round((record[record.length-1].date - open)/DAY)
		const covers = h => keep.indexOf(h || fallback) > -1
		const settles = h => cards.indexOf(h) > -1
		const run = (terms, withSettlement) => forecast({terminals:terms, shapes:shapes,
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

		//each stream against itself: predicted cumulative vs actual cumulative, both from zero
		const gain = {}
		this.terminals().forEach(t => {
			let p = 0, a = 0, err = 0
			for(let k = 0; k < dayKeys.length; k++){
				if(k){
					p += (perStream[t.id][dayKeys[k]] || 0)
					a += (actualByStream[t.id][dayKeys[k]] || 0)
				}
				err += Math.abs(p - a)
			}
			gain[t.id] = area ? err/area : 0
		})

		this._cache[key] = {open:open, close:record[record.length-1].date, days:record.length,
			since:since, surface:surface, area:area, error: area ? surface/area : 0,
			accuracy: area ? 1 - surface/area : 0, gain:gain}
		return this._cache[key]
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
				{prefer: declaredCycle,
					//what the stream ITSELF expected at that moment - a turn it was budgeted at
					//nothing for is not a turn it failed to fill
					expectedAt: d => Math.abs(monthlyExpectationAt(s, d, "monthly")) > 0.005})
			let day = dayLabel(p.cycle, p.day)
			//a stream that fires twice a turn has two answers, and one of them is not the prediction
			if(p.day !== null && p.second !== null && Math.abs(ratio) > 1.5){
				day += " + " + dayLabel(p.cycle, p.second)
			}
			return {name:s.name, cycle:declared, expected:perCycle,
				tier:p.thin ? 0 : p.tier, day:day, amount:p.amount/(ratio || 1),
				spread:p.confidence, gain:(a && a.gain[s.id]) || 0, sort:Math.abs(perMonth)}
		}).sort((x, y) => (y.gain - x.gain) || (y.sort - x.sort))
		return this._rows
	}
	//grouped, because a list of eighty-seven is audited a tier at a time
	groups(){
		const by = {1:[], 2:[], 3:[], 0:[]}
		this.rows().forEach(r => by[r.tier].push(r))
		return [[1, "TIER 1  dated - same day, same amount", by[1]],
			[2, "TIER 2  drifting - same amount, moving day", by[2]],
			[3, "TIER 3  spread - no single event", by[3]],
			[0, "NO DATA", by[0]]]
	}

	report(){
		const a = this.analyse()
		const out = []
		if(a){
			out.push("accuracy " + (a.accuracy*100).toFixed(1) + "%"
				+ "   error " + (a.error*100).toFixed(1) + "%"
				+ "   surface " + money(a.surface) + " / " + money(a.area) + " $-days")
			out.push(dayKey(a.open) + " to " + dayKey(a.close)
				+ "   lookback since " + dayKey(a.since))
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
			out.push(line(["  stream","cycle","expected","spread","pred day","pred amt","err"]))
			g[2].forEach(r => out.push(line(["  " + r.name, r.cycle, money(r.expected),
				(r.spread*100).toFixed(0) + "%", r.day, money(r.amount),
				(r.gain*100).toFixed(1) + "%"])))
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
				<Big>{a ? (a.accuracy*100).toFixed(1) + "%" : "—"}<Small> accuracy</Small></Big>
				<Note>error {a ? (a.error*100).toFixed(1) + "%" : "—"}
					{" · "}surface {a ? money(a.surface) : "—"} of {a ? money(a.area) : "—"} $·days</Note>
				<Note>{a ? dayKey(a.open) + " to " + dayKey(a.close) : ""}
					{a ? " · " + a.days + " settled days" : ""}</Note>
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
				{g[2].map((r,i) => <Row key={i}>
					<Name>{r.name}</Name>
					<Tier $t={r.tier}>{r.gain > 0.0005 ? (r.gain*100).toFixed(1) + "% err" : ""}</Tier>
					<Line>{r.cycle} · expects {money(r.expected)} · predicts {money(r.amount)} on {r.day}
						{r.tier && r.tier < 3 ? " · " + (r.spread*100).toFixed(0) + "% there" : ""}</Line>
				</Row>)}
			</div> : null)}
		</Wrap>
	}
}
