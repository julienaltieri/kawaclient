import React from 'react';
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DS from '../DesignSystem.js';
import Core from '../core.js';
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

	/* ---- the score ------------------------------------------------------------------------------- */
	analyse(){
		if(this._analysis)return this._analysis
		const now = this.today()
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
		this.terminals().forEach(s => {
			sliced[s.id] = byStream[s.id].filter(t => t.date < open)
			shapes[s.id] = histogramOf(sliced[s.id])
			const a = monthlyExpectationAt(s, open, "monthly")
			dir[s.id] = a < 0 ? -1 : (a > 0 ? 1 : 0)
		})
		const routed = accountRoutingOf(sliced, id => dir[id])

		const predicted = forecast({terminals:this.terminals(), shapes:shapes, routing:routed,
			now:open, balanceNow:record[0].value,
			days:Math.round((record[record.length-1].date - open)/DAY),
			covers:h => keep.indexOf(h || fallback) > -1,
			settles:h => cards.indexOf(h) > -1,
			periodName:"monthly", settlementDay:this.settlementDay()})

		//paired by DAY, so a missing day on either side cannot silently shift the comparison
		const predByDay = {}
		predicted.forEach(p => {predByDay[dayKey(p.date)] = p.value})
		let surface = 0, area = 0, paired = 0
		record.forEach(p => {
			const k = dayKey(p.date)
			const q = predByDay[k]
			area += Math.abs(p.value)
			if(q === undefined)return
			surface += Math.abs(q - p.value)
			paired++
		})
		this._analysis = {open:open, close:record[record.length-1].date, days:record.length,
			paired:paired, surface:surface, area:area,
			accuracy: area ? 1 - surface/area : 0,
			opening:record[0].value, closing:record[record.length-1].value,
			predClose: predicted.length ? predicted[predicted.length-1].value : record[0].value}
		return this._analysis
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

	/* ---- the table ------------------------------------------------------------------------------- */
	rows(){
		if(this._rows)return this._rows
		const now = this.today()
		const byStream = this.byStream()
		this._rows = this.terminals().map(s => {
			const expected = monthlyExpectationAt(s, now, "monthly")
			const p = pointPrediction(byStream[s.id] || [], expected)
			const perCycle = p.cycle === "weekly" ? expected*7/30.44
				: (p.cycle === "biweekly" ? expected*14/30.44 : expected)
			return {name:s.name, cycle:p.cycle, expected:perCycle, tier:p.tier, thin:p.thin,
				day:dayLabel(p.cycle, p.day), amount:p.amount, sort:Math.abs(perCycle)}
		}).sort((a,b) => b.sort - a.sort)
		return this._rows
	}

	report(){
		const a = this.analyse()
		const out = []
		if(a){
			out.push("accuracy " + (a.accuracy*100).toFixed(1) + "%"
				+ "   surface " + money(a.surface) + " over " + money(a.area) + " $-days"
				+ "   " + dayKey(a.open) + " to " + dayKey(a.close))
			out.push("")
		}
		const w = [26, 10, 12, 6, 9, 12]
		const line = c => "  " + c[0].slice(0,w[0]).padEnd(w[0]) + c[1].padEnd(w[1])
			+ c[2].padStart(w[2]) + c[3].padStart(w[3]) + c[4].padStart(w[4]) + c[5].padStart(w[5])
		out.push(line(["stream","cycle","expected","tier","pred day","pred amount"]))
		this.rows().forEach(r => out.push(line([r.name, r.cycle, money(r.expected),
			r.thin ? "-" : String(r.tier), r.day, money(r.amount)])))
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
		let a, rows, err = null
		try{a = this.analyse(); rows = this.rows()}
		catch(e){err = (e && e.message) + "\n" + (e && e.stack)}
		if(err)return <Wrap><Line>{err}</Line></Wrap>
		return <Wrap>
			<Score>
				<Big>{a ? (a.accuracy*100).toFixed(1) + "%" : "—"}</Big>
				<Note>accuracy over {a ? a.days : 0} settled days{a
					? ", " + dayKey(a.open) + " to " + dayKey(a.close) : ""}</Note>
				<Note>surface {a ? money(a.surface) : "—"} of {a ? money(a.area) : "—"} $·days</Note>
			</Score>
			<Bar>
				<Btn type="button" onClick={() => this.copy()}>{this.state.copied || "Copy report"}</Btn>
			</Bar>
			{(rows||[]).map((r,i) => <Row key={i}>
				<Name>{r.name}</Name>
				<Tier $t={r.tier}>{r.thin ? "no data" : "tier " + r.tier}</Tier>
				<Line>{r.cycle} · expects {money(r.expected)} · predicts {money(r.amount)} on {r.day}</Line>
			</Row>)}
		</Wrap>
	}
}
