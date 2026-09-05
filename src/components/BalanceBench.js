import React from 'react';
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DS from '../DesignSystem.js';
import Core from '../core.js';
import {histogramOf, accountRoutingOf, reconstruct, forecast, dayKey, monthlyExpectationAt,
	classifyAll, CLASSES} from '../processors/BankBalance.js';

/* ==================================================================================================
   THE BALANCE FORECAST BENCH - the numbers behind page three, on real data.

   WHY THIS EXISTS. The tile's tests are synthetic: they prove the classifier is self-consistent, not
   that it is right about THIS portfolio. And the question that actually matters cannot be answered by
   a fixture at all - which streams have exhausted their potential, and which are still carrying a
   fixable mistake. That needs the real ledger, so the bench lives inside the app, behind staging.

   WHAT IT MEASURES. For the last settled month it runs the same forecast the tile runs, OUT OF SAMPLE
   (shapes built only from transactions before the window opened), and then attributes the error one
   stream at a time. Every error is split in two, because the two have different cures:

     LEVEL   the stream moved a different TOTAL than expected over the window.
             |sum(predicted) - sum(actual)|. The budgeted amount is out of date - a fact about the
             master stream, fixable by editing it.

     TIMING  the same money, on the wrong days.
             sum(|predicted[d] - actual[d]|) - level. A shape or cycle that does not match reality.
             Fixable IF the stream is regular; irreducible if it genuinely is not.

   Crossing that split with the predictable/erratic class is what produces a verdict rather than a
   number:

     predictable + timing error  -> a MODELLING BUG. The stream is regular and we are drawing it in
                                    the wrong place. This is the category worth working on.
     any + level error           -> the BUDGET is stale. Not a code problem.
     erratic + timing error      -> IRREDUCIBLE. No amount of modelling fixes an irregular stream, and
                                    pretending otherwise is how a chart loses trust.

   THE RESIDUAL ROW IS THE POINT OF THE WHOLE EXERCISE. Everything the account did that no stream
   accounts for - uncategorised transactions, unlinked transfers, the card settlement - is money the
   master stream cannot see. If the residual is large, no improvement to any stream will make the
   picture accurate, and the fix is categorisation rather than modelling.
   ================================================================================================== */

const DAY = 86400000;
const money = v => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString();
const pad = (t, n) => String(t === undefined || t === null ? "" : t).slice(0, n).padEnd(n);
const padL = (t, n) => String(t === undefined || t === null ? "" : t).padStart(n);

const Wrap = styled.div`
	max-width:60rem; margin:0 auto; padding:${DS.spacing.xs}rem;
	color:${props => DS.getStyle().bodyText};
`
const Pre = styled.pre`
	font-family:Barlow,ui-monospace,monospace; font-size:0.72rem; line-height:1.35;
	white-space:pre; overflow-x:auto; margin:0;
	background:${props => DS.getStyle().UIElementBackground};
	padding:${DS.spacing.xs}rem; border-radius:${DS.borderRadius};
`
const Bar = styled.div`display:flex; gap:${DS.spacing.xxs}rem; margin-bottom:${DS.spacing.xs}rem;`
const Btn = styled.button`
	appearance:none; cursor:pointer; font:inherit; font-size:${DS.fontSize.little}rem;
	background:none; color:${props => DS.getStyle().bodyText};
	border:1px dashed ${props => DS.getStyle().borderColor};
	padding:0.2rem 0.6rem; border-radius:${DS.borderRadiusSmall};
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

	/* ---- the same inputs the tile uses, derived the same way ------------------------------------ */
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
	//every transaction on the spending account, at its raw amount - categorised or not
	ledger(){
		const keep = this.spending()
		return (this.props.transactions||[])
			.filter(t => keep.indexOf(t.userInstitutionAccountId) > -1)
			.map(t => ({date:t.date, amount:t.amount, accountHash:t.userInstitutionAccountId}))
	}
	byStream(){
		if(this._byStream)return this._byStream
		const out = {}
		this.terminals().forEach(s => {out[s.id] = []})
		;(this.props.transactions||[]).filter(t => t.categorized).forEach(t => {
			this.terminals().forEach(s => {
				if(!t.isAllocatedToStream(s))return
				out[s.id].push({date:t.date, amount:t.amount,
					accountHash:t.userInstitutionAccountId})
			})
		})
		this._byStream = out
		return out
	}

	/* ---- the analysis ---------------------------------------------------------------------------- */
	analyse(){
		const now = this.today()
		const c = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1,
			Math.min(now.getUTCDate(),
				new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate())))
		const open = new Date(c.getTime() - 15*DAY), close = new Date(c.getTime() + 15*DAY)
		const txns = this.ledger()
		const record = reconstruct(txns, now, this.anchor(), open).filter(p => p.date <= close)
		if(record.length < 2)return null

		const days = Math.round((record[record.length-1].date - open)/DAY)
		const byStream = this.byStream()
		const keep = this.spending(), cards = this.credit(), fallback = keep[0]
		const covers = h => keep.indexOf(h || fallback) > -1
		const settles = h => cards.indexOf(h) > -1

		//OUT OF SAMPLE: nothing dated inside the window may inform the prediction of it
		const shapes = {}, routing = {}, dir = {}
		this.terminals().forEach(s => {
			const before = byStream[s.id].filter(t => t.date < open)
			shapes[s.id] = histogramOf(before)
			const a = monthlyExpectationAt(s, open, "monthly")
			dir[s.id] = a < 0 ? -1 : (a > 0 ? 1 : 0)
		})
		const sliced = {}
		this.terminals().forEach(s => {sliced[s.id] = byStream[s.id].filter(t => t.date < open)})
		const routed = accountRoutingOf(sliced, id => dir[id])

		const deltasOf = series => {
			const d = {}
			for(let i = 1; i < series.length; i++){
				d[dayKey(series[i].date)] = series[i].value - series[i-1].value
			}
			return d
		}
		const runFor = terms => forecast({terminals:terms, shapes:shapes, routing:routed,
			now:open, balanceNow:0, days:days, covers:covers, settles:null,
			periodName:"monthly", settlementDay:null})

		//what actually moved on the account, per day
		const actualAll = {}
		record.forEach((p,i) => {if(i)actualAll[dayKey(p.date)] = p.value - record[i-1].value})

		const classes = {}
		classifyAll(this.terminals(), byStream, s => monthlyExpectationAt(s, now, "monthly"))
			.forEach(r => {classes[r.id] = r})

		const inWindow = t => t.date >= open && t.date <= close
		const rows = []
		let attributed = {}
		this.terminals().forEach(s => {
			const pred = deltasOf(runFor([s]))
			const act = {}
			byStream[s.id].filter(t => inWindow(t) && covers(t.accountHash)).forEach(t => {
				const k = dayKey(t.date); act[k] = (act[k]||0) + t.amount
				attributed[k] = (attributed[k]||0) + t.amount
			})
			const keys = {}
			Object.keys(pred).forEach(k => {keys[k] = true})
			Object.keys(act).forEach(k => {keys[k] = true})
			let sp = 0, sa = 0, l1 = 0
			Object.keys(keys).forEach(k => {
				const p = pred[k]||0, a = act[k]||0
				sp += p; sa += a; l1 += Math.abs(p - a)
			})
			if(!sp && !sa && !l1)return                     //silent all window: nothing to report
			const level = Math.abs(sp - sa)
			rows.push({id:s.id, name:s.name, klass:(classes[s.id]||{}).klass,
				cycle:(classes[s.id]||{}).cycle, timingScore:(classes[s.id]||{}).timing || 0,
				steadyScore:(classes[s.id]||{}).steadiness || 0,
				predicted:sp, actual:sa, level:level, timing:Math.max(0, l1 - level), total:l1})
		})

		//everything the account did that no stream explains
		let residual = 0
		Object.keys(actualAll).forEach(k => {residual += Math.abs(actualAll[k] - (attributed[k]||0))})

		const benchAll = runFor(this.terminals())
		const regular = this.terminals().filter(s =>
			(classes[s.id]||{}).klass === CLASSES.predictable)
		const benchReg = runFor(regular)
		const closeActual = record[record.length-1].value - record[0].value
		rows.sort((a,b) => b.total - a.total)
		return {open:open, close:record[record.length-1].date, days:days, rows:rows,
			residual:residual, opening:record[0].value,
			actualMove:closeActual,
			predAll:benchAll.length ? benchAll[benchAll.length-1].value : 0,
			predReg:benchReg.length ? benchReg[benchReg.length-1].value : 0,
			regularCount:regular.length}
	}

	verdict(r){
		if(r.klass === CLASSES.thin)return "no data yet"
		if(r.total < 1)return "exact"
		if(r.level > r.timing)return "budget stale"
		if(r.klass === CLASSES.predictable)return "MODEL BUG"
		return "irreducible"
	}

	report(){
		const a = this.analyse()
		if(!a)return "no settled window to analyse (no balance, or no transactions)"
		const d = x => new Date(x).toISOString().slice(0,10)
		const out = []
		out.push("BALANCE FORECAST BENCH  " + new Date().toISOString())
		out.push("window " + d(a.open) + " to " + d(a.close) + "  (" + a.days + " settled days)")
		out.push("opening balance " + money(a.opening))
		out.push("")
		out.push("            what the account did   " + padL(money(a.actualMove), 12))
		out.push("  forecast, all streams            " + padL(money(a.predAll), 12)
			+ "   drift " + money(a.predAll - a.actualMove))
		out.push("  forecast, regular streams only   " + padL(money(a.predReg), 12)
			+ "   drift " + money(a.predReg - a.actualMove)
			+ "   (" + a.regularCount + " of " + this.terminals().length + " streams)")
		out.push("")
		out.push("  unexplained by ANY stream        " + padL(money(a.residual), 12)
			+ "   <- categorisation, not modelling")
		out.push("")
		out.push("ERROR BY STREAM, out of sample, biggest first")
		out.push("  " + pad("stream", 26) + pad("class", 13) + pad("cycle", 10)
			+ padL("predicted", 11) + padL("actual", 11) + padL("level", 9) + padL("timing", 9)
			+ "  tim/std   verdict")
		a.rows.forEach(r => out.push("  " + pad(r.name, 26) + pad(r.klass, 13) + pad(r.cycle, 10)
			+ padL(money(r.predicted), 11) + padL(money(r.actual), 11)
			+ padL(money(r.level), 9) + padL(money(r.timing), 9)
			+ "  " + r.timingScore.toFixed(2) + "/" + r.steadyScore.toFixed(2)
			+ "   " + this.verdict(r)))
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
		let text
		try{text = this.report()}
		catch(e){text = "bench failed: " + (e && e.message) + "\n" + (e && e.stack)}
		return <Wrap>
			<Bar>
				<Btn type="button" onClick={() => this.copy()}>{this.state.copied || "Copy report"}</Btn>
			</Bar>
			<Pre>{text}</Pre>
		</Wrap>
	}
}
