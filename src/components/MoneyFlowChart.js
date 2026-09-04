import React from 'react'
import styled, {keyframes, css} from 'styled-components'
import memoize from 'memoize-one'
import BaseComponent from './BaseComponent'
import DS from '../DesignSystem.js'
import utils from '../utils'
import Core from '../core.js'
import MoneyFlowEngine from './MoneyFlowEngine'
import {buildFlowTree, flowAudit, masterSnapshot, measuredAmounts} from '../processors/MoneyFlow'
import AppConfig from '../AppConfig'

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
/* The title is set like page one's. That chart draws its own title inside the plot — the year, at
   `fontSizeTitle` in the body colour at normal weight — and the two tiles sit in one carousel, a
   thumb-flick apart, so a heavier and quieter heading on the second one reads as a different kind of
   thing rather than the same thing about a different picture.

   ON A DESKTOP IT IS THE DESIGN SYSTEM'S OWN LARGEST SIZE, not a size copied from page one's canvas.
   Page one draws its title in chart units, so the obvious way to match it is to convert - 20 units over
   a 450-unit width, times the card. That was tried and it came out MAGNIFIED: the conversion assumes the
   chart scales by its width, and what it actually scales by is whatever the tile lets its SVG have, so
   the arithmetic overstated it and the heading arrived a size larger than the picture it names.

   The lesson is the general one about borrowing a number across a boundary: two coordinate systems can
   be related without the relation being a constant you can write down, and a size that has to be right
   to the reader is better chosen for the reader than converted from somewhere else. Set empirically at
   2rem, which is `display` - added to the scale for this, since the tokens stopped at 1.4 and every one
   of them is for type that sits inside something rather than naming a whole card.

   The PHONE keeps `title`. There the two already agree, it is what the rest of the app's headings use at
   that size, and re-deriving it would move a calibrated thing for nothing. */
/* Laid out as a SENTENCE, not as a row of boxes. Spacing the three words with a flex gap left no
   actual space between them, so the heading's text - what a screen reader says, and what a test
   reads - came out as "Actualsthisyear". Ordinary inline text with real spaces also gets the baseline
   alignment for free, which is what the flex row was there to do. */
/* rem is what the design system speaks and px is what the engine measures in, so the root size is
   read rather than assumed - a reader who has set a larger one gets a larger chart with it. */
const rootPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize)||16
const Title = styled.h2`
	margin:0; line-height:1.15;
	font-size:${props => (props.$big ? DS.fontSize.display : DS.fontSize.title)}rem; font-weight:400;
	color:${props => DS.getStyle().bodyText};
`
const TitleButton = styled.button`
	appearance:none; border:0; background:none; padding:0 0 1px; cursor:pointer; font:inherit;
	color:${props => DS.getStyle().bodyText};
	/* the whole title is body-coloured now, so the dashed rule is the only thing saying these two
	   words can be changed — it carries the affordance on its own */
	border-bottom:1px dashed ${props => DS.getStyle().borderColor};
	&:hover{border-bottom-color:${props => DS.getStyle().bodyText};}
	&:focus-visible{outline:2px solid ${props => DS.getStyle().savings}; outline-offset:2px;}
`
/* STAGING ONLY. A bug in this picture usually arrives as a photograph, and the three or four facts
   that would settle it - which tree the adapter built, what the gathering did to it, whether a name
   gave up its amount - cannot be read off a photograph at all. This copies them. It is gated on
   AppConfig.staging, which is false in the built app, so it cannot reach a reader. */
const ToolButton = styled.button`
	appearance:none; border:0; cursor:pointer; font:inherit;
	font-size:${DS.fontSize.little}rem;
	background:none; color:${props => DS.getStyle().bodyTextSecondary};
	border:1px dashed ${props => DS.getStyle().borderColor};
	padding:0.15rem 0.5rem; border-radius:${DS.borderRadiusSmall}; margin-right:${DS.spacing.xxs}rem;
	&:hover{color:${props => DS.getStyle().bodyText};}
`
const ResetButton = styled.button`
	appearance:none; border:0; cursor:pointer;
	background:${props => DS.getStyle().UIElementBackground};
	color:${props => DS.getStyle().bodyTextSecondary};
	font:inherit; font-size:${DS.fontSize.little}rem;
	padding:0.15rem 0.5rem; border-radius:${DS.borderRadiusSmall};
	&:hover{color:${props => DS.getStyle().bodyText};}
`
/* THE TITLE IS LEFT-ALIGNED, ALWAYS. The tile is a FlexColumn and centres what it holds, so a header
   row only as wide as its contents gets centred with them — and the title then slid right by half the
   width of the "Back to all" button the moment that button appeared, which reads as the heading moving
   when you open a stream. Taking the tile's full width pins the title to the left edge and lets the
   button sit at the other end, whether or not it is there. */
/* §9.7  THE WORD IN FRONT OF THE UNIT SWAPS LIKE A DIGIT ON A COUNTER. It is not a control - only
   the two underlined words are - so it must not look like one, but it does change when the unit
   beside it does, and a word that simply replaces itself between two frames reads as a glitch rather
   than as an answer changing. The one leaving fades and slides out of the way; the one arriving fades
   in from the other side, so the two are plainly the same slot holding a different word. The
   direction follows the toggle: going to the closed period the words travel one way, coming back the
   other, which is what makes it read as a counter rather than a shuffle. */
const WORD_MS = 260;
const riseIn = keyframes`from{opacity:0;transform:translateY(90%)} to{opacity:1;transform:translateY(0)}`;
const riseOut = keyframes`from{opacity:1;transform:translateY(0)} to{opacity:0;transform:translateY(-90%)}`;
const dropIn = keyframes`from{opacity:0;transform:translateY(-90%)} to{opacity:1;transform:translateY(0)}`;
const dropOut = keyframes`from{opacity:1;transform:translateY(0)} to{opacity:0;transform:translateY(90%)}`;
/* No overflow clipping. An inline-block whose overflow is not visible takes its BASELINE from its
   bottom margin edge instead of from the text inside it, so the word sat a few pixels high against
   the two beside it - which is what a clipped slot costs. There is nothing to clip anyway: the word
   travels less than its own height and is transparent by the time it gets there, and the title is a
   single line, so it has nothing to bleed into. */
const Slot = styled.span`
	display:inline-block; position:relative; vertical-align:baseline;
	line-height:1.15; text-align:left;
`
const Wordy = styled.span`
	display:inline-block; white-space:nowrap;
	${props => props.$leaving?"position:absolute; left:0; top:0;":""}
	animation:${props => (props.$up
		? (props.$leaving?riseOut:riseIn)
		: (props.$leaving?dropOut:dropIn))} ${WORD_MS}ms ease both;
	@media (prefers-reduced-motion:reduce){ animation:none; ${props => props.$leaving?"display:none;":""} }
`
/* Keeping the outgoing word mounted is the whole trick: React would otherwise replace the text in
   place and there would be nothing left to animate out. It is taken out of flow so the slot's width
   follows the word arriving, and dropped once it has gone. */
class SlideWord extends React.Component{
	constructor(p){super(p); this.state={word:p.word, out:null, up:true}; this.timer=null}
	componentDidUpdate(prev){
		if(this.props.word!==this.state.word){
			clearTimeout(this.timer)
			const out = this.state.word
			this.setState({word:this.props.word, out:out, up:!!this.props.up})
			this.timer = setTimeout(() => this.setState({out:null}), WORD_MS)
		}
	}
	componentWillUnmount(){clearTimeout(this.timer)}
	render(){return <Slot aria-live="polite">
		{/* the word on its way out is a copy kept alive to animate; it is not part of the sentence,
		    so it is hidden from anything that reads rather than looks */}
		{this.state.out===null?null:<Wordy aria-hidden="true" key={"o"+this.state.out}
			$leaving $up={this.state.up}>{this.state.out}</Wordy>}
		<Wordy key={this.state.word} $up={this.state.up}>{this.state.word}</Wordy>
	</Slot>}
}

const Head = styled.div`
	display:flex; align-items:center; justify-content:space-between;
	width:100%; align-self:stretch; text-align:left;
	gap:${DS.spacing.xs}rem; margin-bottom:${DS.spacing.xs}rem; min-height:1.8rem;
`
/* §9.4  nothing in the diagram is text to be selected or a link to be flashed blue. The hover
   affordance the labels carry is gated inside the engine on a pointer that can actually hover; on a
   touch screen a hover state has no way to end and would sit on the label you just tapped. */
/* A period can legitimately hold nothing: "a period is the whole of itself", so on the first day of
   a month the month is nearly empty and the picture has nothing to draw. That is the truth rather
   than a failure, but an empty card does not say it, so a line does. It names the DATA, not the
   interface. */
const ChartArea = styled.div`position:relative; width:100%; align-self:stretch;`
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
	/* The sub-period is the last one that COMPLETED, not the one running. A month that is three days
	   old is not a month of spending, and a picture of it says the household has stopped buying food.
	   The observation period is different and stays as it is: "this year" is the thing being tracked,
	   and its whole point is that it is unfinished. That is what the word in front of the unit says -
	   "this" for the period in progress, "last" for the one that closed. */
	windows(){
		const a = this.props.analysis
		const sub = a.reportingPeriod.subdivision
		const sched = a.getReportingSchedule(sub)
		const to = sched[sched.length-1]                 // the first boundary after now
		const closed = sub.previousDate(to)              // ...so this one is the last that finished
		return {
			observation:{from:a.reportingStartDate, to:a.reportingDate, when:"this",
				periodName:a.reportingPeriod.name, label:a.reportingPeriod.unitName},
			subPeriod:{from:sub.previousDate(closed), to:closed, when:"last",
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
			/* §9.8  THE TYPE SIZES COME FROM THE DESIGN SYSTEM. They never did: the engine carried its
			   own 12 and 10 and the chart passed nothing, so the app's type scale had no bearing on the
			   one picture whose geometry grows with the card - and on a desktop card the labels ended up
			   half the size, relative to the picture, that they are on a phone. These are the WIDE end;
			   the engine keeps its own smaller sizes where the card is too narrow to carry these. */
			/* On a wide card the small size is retired: there is room for every name to be set at the body
			   size, and the amounts take the title size beside them. §9.6's channel - size says which level
			   you are standing on - is a phone's economy, and the wide card spends the room instead. */
			tune:{bodyWidePx:DS.fontSize.body*rootPx(), smallWidePx:DS.fontSize.body*rootPx(),
				amountWideK:DS.fontSize.title/DS.fontSize.body},
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

	/* THE SOURCE, not a picture of it (DECISION-PRINCIPLES.md #27). This used to copy the engine's three trees plus every name's
	   placement facts, which is a conclusion: the adapter had already dropped whatever it dropped, so
	   a stream missing from the copy was indistinguishable from a stream the layout was hiding, and
	   twice that ambiguity was read the wrong way round. What goes out now is what everything is
	   BUILT from - the master stream, and what each terminal actually saw - from which the bench can
	   rebuild the picture and then be asked any question, instead of one having been answered for it
	   in advance. The window and basis go too, because they are the conditions it was taken under and
	   the same portfolio says different things in different ones.

	   The clipboard API needs a secure context and a user gesture - it has both here - and falls back
	   to a hidden textarea where it is missing. */
	/* the master, what each terminal saw, and - as a convenience, since it is derived from exactly
	   those two - the list of streams that did not make it into the picture and why */
	source(){
		try{const w = this.windows()[this.state.period]
			return {master:masterSnapshot(this.props.stream),
				measured:measuredAmounts(this.props.stream,this.props.transactions,w.from,w.to),
				dropped:flowAudit(this.props.stream,this.props.transactions,
					{from:w.from, to:w.to, periodName:w.periodName, basis:this.state.basis})}
		}catch(e){return {error:String(e&&e.message||e)}}
	}
	copyDiagnostics(){
		const w = this.windows()[this.state.period]
		const payload = Object.assign({
			takenAt:new Date().toISOString(),
			basis:this.state.basis, period:this.state.period,
			window:{from:w.from&&w.from.toISOString(), to:w.to&&w.to.toISOString(),
				periodName:w.periodName, label:w.label, when:w.when}
		}, this.source(), {focus:this.engine ? this.engine.diagnose().focus : null})
		const text = JSON.stringify(payload,null,2)
		const done = ok => this.updateState({copied:ok?"Copied":"Copy failed"},
			() => setTimeout(() => this.updateState({copied:null}),1600))
		try{
			if(navigator.clipboard&&navigator.clipboard.writeText)
				return navigator.clipboard.writeText(text).then(() => done(true),() => done(false))
			const ta = document.createElement("textarea")
			ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"
			document.body.appendChild(ta); ta.select()
			const ok = document.execCommand("copy")
			document.body.removeChild(ta); done(ok)
		}catch(e){done(false)}
	}
	render(){
		const w = this.windows()
		const basisWord = this.state.basis==="target"?"Target":"Actuals"
		const periodWord = w[this.state.period].label
		const whenWord = w[this.state.period].when
		return <DS.component.ContentTile style={{position:"relative",width:"100%",height:"100%",
				boxSizing:"border-box",margin:0,padding:DS.spacing.xs+"rem"}}>
			<Head>
				<Title $big={!Core.isMobile()}>
					<TitleButton type="button" onClick={() =>
						this.updateState({basis:this.state.basis==="actual"?"target":"actual"})}
					>{basisWord}</TitleButton>{" "}
					<SlideWord word={whenWord} up={this.state.period==="subPeriod"}/>{" "}
					<TitleButton type="button" onClick={() =>
						this.updateState({period:this.state.period==="observation"?"subPeriod":"observation"})}
					>{periodWord}</TitleButton>
				</Title>
				{AppConfig.staging?<ToolButton type="button" data-no-drag
					onClick={() => this.copyDiagnostics()}
					title="Copy this view's trees and label facts to the clipboard">
					{this.state.copied||"Copy tree"}</ToolButton>:null}
				{this.state.focused?<ResetButton type="button" onClick={() => this.engine.reset()}>
					Back to all</ResetButton>:null}
			</Head>
			{/* the chart answers its own pointer gestures, so a drag starting on it belongs to it and
			    not to the carousel — see documentation/visualisation-carousel.md */}
			<ChartArea>
				<ChartHost data-no-drag ref={this.host}/>
				{this.tree().inTotal>0?null:<Empty>{this.state.basis==="target"
					?"Nothing budgeted for "+whenWord+" "+periodWord
					:(whenWord==="this"?"Nothing yet this ":"Nothing ")+periodWord}</Empty>}
			</ChartArea>
		</DS.component.ContentTile>
	}
}
