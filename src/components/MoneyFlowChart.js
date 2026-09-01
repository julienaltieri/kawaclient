import React from 'react'
import styled from 'styled-components'
import memoize from 'memoize-one'
import BaseComponent from './BaseComponent'
import DS from '../DesignSystem.js'
import utils from '../utils'
import Core from '../core.js'
import MoneyFlowEngine from './MoneyFlowEngine'
import {buildFlowTree} from '../processors/MoneyFlow'

/* ==================================================================================================
   MONEY FLOW — the tile.

   Page two of the visualisation carousel: where the money came from and where it went, over the
   observation period or the current month, as budgeted or as it happened.

   This component is a binding and nothing else. The picture is MoneyFlowEngine, which has no imports
   and knows nothing about this app; the numbers are processors/MoneyFlow.js, which is the only thing
   that reads streams and transactions. What is left here is the tile, the title, and the wiring
   between them — which is what lets the visualisation be reused somewhere else by handing the engine
   a different FlowTree.

   See documentation/money-flow.md.
   ================================================================================================== */

/* §9.1  The header IS the title: one line saying what you are looking at, with the two words that
   could be something else made tappable. There is nothing to label and nothing to explain — the
   sentence already says which of the four views this is, and changing it is changing the thing. */
const Title = styled.h2`
	display:flex; align-items:baseline; gap:0.3rem; margin:0;
	font-size:${DS.fontSize.title}rem; font-weight:600;
	color:${props => DS.getStyle().bodyTextSecondary};
`
const TitleButton = styled.button`
	appearance:none; border:0; background:none; padding:0 0 1px; cursor:pointer; font:inherit;
	color:${props => DS.getStyle().bodyText};
	border-bottom:1px dashed ${props => DS.getStyle().borderColor};
	&:hover{border-bottom-color:${props => DS.getStyle().bodyText};}
	&:focus-visible{outline:2px solid ${props => DS.getStyle().savings}; outline-offset:2px;}
`
const ResetButton = styled.button`
	appearance:none; border:0; cursor:pointer;
	background:${props => DS.getStyle().UIElementBackground};
	color:${props => DS.getStyle().bodyTextSecondary};
	font:inherit; font-size:${DS.fontSize.little}rem;
	padding:0.15rem 0.5rem; border-radius:${DS.borderRadiusSmall};
	&:hover{color:${props => DS.getStyle().bodyText};}
`
const Head = styled.div`
	display:flex; align-items:center; justify-content:space-between;
	gap:${DS.spacing.xs}rem; margin-bottom:${DS.spacing.xs}rem; min-height:1.8rem;
`
/* §9.4  nothing in the diagram is text to be selected or a link to be flashed blue. The hover
   affordance the labels carry is gated inside the engine on a pointer that can actually hover; on a
   touch screen a hover state has no way to end and would sit on the label you just tapped. */
/* A period can legitimately hold nothing: "a period is the whole of itself", so on the first day of
   a month the month is nearly empty and the picture has nothing to draw. That is the truth rather
   than a failure, but an empty card does not say it, so a line does. It names the DATA, not the
   interface. */
const ChartArea = styled.div`position:relative;`
const Empty = styled.div`
	position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
	text-align:center; padding:${DS.spacing.xs}rem;
	font-size:${DS.fontSize.body}rem; color:${props => DS.getStyle().bodyTextSecondary};
`
const ChartHost = styled.div`
	overflow:hidden; -webkit-tap-highlight-color:transparent;
	& svg{ display:block; -webkit-user-select:none; user-select:none; }
	& .mf-tap{ cursor:pointer; }
	@media (hover:hover) and (pointer:fine){ & text.mf-tap:hover{ opacity:0.62; } }
`

export default class MoneyFlowChart extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {period:"observation", basis:"actual", focused:false}
		this.host = React.createRef()
	}

	/* The two windows come from the analysis the view already built, so the calendar has one author
	   (DECISION-PRINCIPLES.md #24): the observation period is the card's "year" and its own
	   subdivision is the "month".

	   The sub-period is read off the analysis's SCHEDULE rather than off getCurrentPeriodReport(),
	   because that report is subdivided by whatever the analysis was built with - and the stream view
	   builds this one with no override, which leaves ReportingCore to fall back to the master
	   stream's own period. Where that is yearly, the "current period" is a year, and both halves of
	   the toggle showed the same twelve months. Asking the schedule for the subdivision's boundaries
	   is independent of how the analysis happened to be sliced. */
	windows(){
		const a = this.props.analysis
		const sub = a.reportingPeriod.subdivision
		const sched = a.getReportingSchedule(sub)
		const to = sched[sched.length-1]                 // the first boundary after now
		return {
			observation:{from:a.reportingStartDate, to:a.reportingDate,
				periodName:a.reportingPeriod.name, label:a.reportingPeriod.unitName},
			subPeriod:{from:sub.previousDate(to), to:to,
				periodName:sub.name, label:sub.unitName}
		}
	}
	mTree = memoize((master,txns,from,to,periodName,basis) =>
		buildFlowTree(master,txns,{from:from,to:to,periodName:periodName,basis:basis}))
	tree(){
		const w = this.windows()[this.state.period]
		return this.mTree(this.props.stream,this.props.transactions,w.from,w.to,w.periodName,this.state.basis)
	}
	palette(){
		const s = DS.getStyle()
		return {income:s.income, savings:s.savings, expenses:s.expenses, alert:s.alert,
			bodyText:s.bodyText, bodyTextSecondary:s.bodyTextSecondary}
	}

	componentDidMount(){
		this.engine = new MoneyFlowEngine(this.host.current,{
			palette:this.palette(),
			/* the same two faces the design system uses elsewhere: names in Inter, amounts in the
			   numeric one (AnalysisView sets its value labels the same way) */
			fontFamily:"Inter",
			numberFamily:"Barlow, Inter",
			format:v => utils.formatCurrencyAmount(v,0,false,true,Core.getPreferredCurrency()),
			onFocusChange:path => this.updateState({focused:path.length>0})
		})
		this.engine.setTree(this.tree())
	}
	componentDidUpdate(){
		if(!this.engine)return
		this.engine.setPalette(this.palette())
		this.engine.setTree(this.tree())
	}
	componentWillUnmount(){if(this.engine)this.engine.destroy()}

	render(){
		const w = this.windows()
		const basisWord = this.state.basis==="target"?"Target":"Actuals"
		const periodWord = w[this.state.period].label
		return <DS.component.ContentTile style={{position:"relative",width:"100%",height:"100%",
				boxSizing:"border-box",margin:0,padding:DS.spacing.xs+"rem"}}>
			<Head>
				<Title>
					<TitleButton type="button" onClick={() =>
						this.updateState({basis:this.state.basis==="actual"?"target":"actual"})}>
						{basisWord}</TitleButton>
					<span>this</span>
					<TitleButton type="button" onClick={() =>
						this.updateState({period:this.state.period==="observation"?"subPeriod":"observation"})}>
						{periodWord}</TitleButton>
				</Title>
				{this.state.focused?<ResetButton type="button" onClick={() => this.engine.reset()}>
					Back to all</ResetButton>:null}
			</Head>
			{/* the chart answers its own pointer gestures, so a drag starting on it belongs to it and
			    not to the carousel — see documentation/visualisation-carousel.md */}
			<ChartArea>
				<ChartHost data-no-drag ref={this.host}/>
				{this.tree().inTotal>0?null:<Empty>{this.state.basis==="target"
					?"Nothing budgeted for this "+periodWord
					:"Nothing yet this "+periodWord}</Empty>}
			</ChartArea>
		</DS.component.ContentTile>
	}
}
