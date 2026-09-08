import React from 'react';
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DS from '../DesignSystem.js';

/* ==================================================================================================
   ONE DAY, SIDE BY SIDE: what posted, and what the forecast expected of it.

   The accuracy score says the month is 56% right. It cannot say WHICH day is wrong, or whether a bad
   day is a missing transaction, a mis-timed one, or an amount that drifted - and those have different
   fixes. This is the view that answers it: point at a day on the curve above, and read the two
   columns that produced its step.

   THE PREDICTED SIDE IS NOT RE-DERIVED. It comes from `contributionsOn`, which is the same function
   the forecast itself calls for every day - so this cannot drift from the thing it claims to explain.
   A breakdown that disagrees with the picture it sits under is worse than no breakdown, because it
   sends the reader to audit the wrong half.

   AND IT COPIES. The point of the page is to hand the numbers to someone who can say "that is wrong
   and here is why", which means plain text, aligned, without a screenshot.
   ================================================================================================== */

const money = v => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString();
const pad = (t, n) => String(t === undefined || t === null ? "" : t).slice(0, n).padEnd(n);
const padL = (t, n) => String(t === undefined || t === null ? "" : t).padStart(n);

const Wrap = styled.div`
	margin:${DS.spacing.xs}rem 0; color:${props => DS.getStyle().bodyText};
	min-height:6rem;
`
const Head = styled.div`
	display:flex; align-items:baseline; gap:${DS.spacing.xs}rem; flex-wrap:wrap;
	margin-bottom:0.3rem;
`
const When = styled.div`font-size:${DS.fontSize.title}rem;`
const Sub = styled.div`
	font-size:${DS.fontSize.little}rem; color:${props => DS.getStyle().bodyTextSecondary};
`
const Cols = styled.div`
	display:grid; grid-template-columns:1fr 1fr; gap:${DS.spacing.xs}rem;
	@media (max-width: 34rem){ grid-template-columns:1fr; }
`
const Col = styled.div`
	background:${props => DS.getStyle().UIElementBackground};
	border-radius:${DS.borderRadius}; padding:${DS.spacing.xs}rem;
`
const ColHead = styled.div`
	font-size:${DS.fontSize.little}rem; font-weight:600; margin-bottom:0.25rem;
	color:${props => DS.getStyle().bodyTextSecondary};
`
const Line = styled.div`
	display:flex; justify-content:space-between; gap:0.5rem;
	font-size:${DS.fontSize.little}rem; font-family:Barlow,sans-serif;
	padding:0.1rem 0; overflow-wrap:anywhere;
`
/* THE DERIVATION, under the number it produced. Every prediction is an expectation times a weight,
   and printing only the product turned each surprising row into a session of guessing: $406 out of a
   $1,700 month is a weight of 0.24, and 0.24 is either four clusters in the histogram or a weekly
   cycle taking 7/31 - one of those is a fault and the other is the stream genuinely being paid four
   times a month. The product alone cannot say which. */
const Why = styled.div`
	font-size:${DS.fontSize.little}rem; color:${props => DS.getStyle().bodyTextSecondary};
	font-family:Barlow,sans-serif; opacity:0.85; padding:0 0 0.2rem 0;
`
const Total = styled(Line)`
	border-top:1px solid ${props => DS.getStyle().borderColor};
	margin-top:0.25rem; padding-top:0.25rem; font-weight:600;
`
const Btn = styled.button`
	appearance:none; cursor:pointer; font:inherit; font-size:${DS.fontSize.little}rem;
	background:none; color:${props => DS.getStyle().bodyText};
	border:1px dashed ${props => DS.getStyle().borderColor};
	padding:0.15rem 0.6rem; border-radius:${DS.borderRadiusSmall};
`

export default class DayAudit extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {copied:null}
	}

	//"monthly x0.24 of $1,700, lands on 4 days" - the arithmetic behind the row, in one clause
	why(t){
		if(t.expected === undefined)return null
		const pct = Math.round((t.weight || 0)*1000)/10
		return t.cycle + " \u00d7" + pct + "% of " + money(t.expected)
			+ (t.liveDays ? ", on " + t.liveDays + (t.liveDays === 1 ? " day" : " days") : "")
	}

	text(){
		const d = this.props.day
		if(!d)return ""
		const w = [30, 12]
		const line = (a, b) => "  " + pad(a, w[0]) + padL(b, w[1])
		const out = ["day " + d.date + (d.projected ? "  (projected)" : "  (settled)"),
			"balance " + money(d.balance), ""]
		out.push("POSTED")
		if(!d.actual.length)out.push("  (nothing)")
		d.actual.forEach(t => out.push(line(t.name, money(t.amount))))
		out.push(line("total", money(d.actualTotal)))
		out.push("")
		out.push("PREDICTED")
		if(!d.predicted.length)out.push("  (nothing)")
		d.predicted.forEach(t => {
			out.push(line(t.name, money(t.amount)))
			const y = this.why(t)
			if(y)out.push("      " + y)
		})
		out.push(line("total", money(d.predictedTotal)))
		out.push("")
		out.push(line("difference", money(d.predictedTotal - d.actualTotal)))
		/* AND WHAT DID NOT FIRE. A rent absent from the day it posted on reads as an oversight, when
		   it is one of four decisions with four different fixes - a zero weight, a zero expectation,
		   an exclusion, or an account filter. Listing the silence with its reason is the only way an
		   audit can be read as complete. */
		if(d.silent && d.silent.length){
			out.push("")
			out.push("NOT TODAY")
			d.silent.slice(0, 10).forEach(t =>
				out.push(line("  " + t.name, money(t.expected)) + "   " + t.why))
		}
		return out.join("\n")
	}

	copy(){
		const text = this.text()
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
		const d = this.props.day
		//the height is reserved by the wrapper, so picking up and dropping the cursor does not make
		//the bench below jump around
		if(!d)return <Wrap><Sub>Drag across the chart to break a day down.</Sub></Wrap>
		return <Wrap>
			<Head>
				<When>{d.date}</When>
				<Sub>{d.projected ? "projected" : "settled"} · balance {money(d.balance)}</Sub>
				<Sub>difference {money(d.predictedTotal - d.actualTotal)}</Sub>
				<Btn type="button" onClick={() => this.copy()}>{this.state.copied || "Copy day"}</Btn>
			</Head>
			<Cols>
				<Col>
					<ColHead>POSTED</ColHead>
					{d.actual.length ? d.actual.map((t, i) =>
						<Line key={i}><span>{t.name}</span><span>{money(t.amount)}</span></Line>)
						: <Line><span>nothing</span><span/></Line>}
					<Total><span>total</span><span>{money(d.actualTotal)}</span></Total>
				</Col>
				<Col>
					<ColHead>PREDICTED</ColHead>
					{d.predicted.length ? d.predicted.map((t, i) =>
						<React.Fragment key={i}>
							<Line><span>{t.name}</span><span>{money(t.amount)}</span></Line>
							{this.why(t) ? <Why>{this.why(t)}</Why> : null}
						</React.Fragment>)
						: <Line><span>nothing</span><span/></Line>}
					<Total><span>total</span><span>{money(d.predictedTotal)}</span></Total>
				</Col>
			</Cols>
			{d.silent && d.silent.length ? <Col style={{marginTop:"0.4rem"}}>
				<ColHead>NOT TODAY</ColHead>
				{d.silent.slice(0, 10).map((t, i) =>
					<React.Fragment key={i}>
						<Line><span>{t.name}</span><span>{money(t.expected)}</span></Line>
						<Why>{t.why}</Why>
					</React.Fragment>)}
			</Col> : null}
		</Wrap>
	}
}
