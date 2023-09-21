import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import Core from '../core.js';
import {GenericTransaction} from '../model';
import memoize from "memoize-one";
import AnimatedNumber from "animated-number-react";
import ModalManager, {ModalTemplates} from '../ModalManager.js'
import DesignSystem from '../DesignSystem.js'
import getReportFromDateForTerminalStream from '../processors/ReportingCore.js';
import ProgressRing, {FrequencyRing} from './ProgressRing';
import {Period,timeIntervals} from '../Time';
import dateformat from "dateformat";
import ReactDOM from 'react-dom';
import * as V from 'victory';
import React from "react"
import {StyledLink} from "./StreamAuditView"
import utils from '../utils'
const _ = require('lodash');
const stats = require('../processors/Statistics.js')
export function format(x,noMinusSign,noPlusSign){
	if(x==0){return "$0"}
	else {return utils.formatDollarAmount(x,(Math.abs(x)>=100 || (Math.floor(x)==x))?0:2,noMinusSign,noPlusSign)}
}
const liveRenderComponents = []
export const refreshLiveRenderComponents = () => liveRenderComponents.forEach(c => c._isMounted?c.updateState({rerender:true}):false)
/* class structure: 
    GenericAnalysisView: Generic component meant to display an analysis for a given stream or stream array, set of transaction and prefered unit of time
		|_ GenericPeriodReportView
			|_ TimeAndMoneyProgressView: represents the combined progress rings of Time and Money given a stream and a report
			|_ PeriodReportView: a tile representing the state of a stream for the current period
			|_ PeriodReportTransactionFeedView: represents a transaction feed for a given period
			|_ TerminalStreamCurrentReportPeriodView: displays the analysis of a terminal stream for the current period only
		|_ GenericStreamAnalysisView
			|_ StreamAnalysisTransactionFeedView: displays a transaction feed, grouped by a reporting period
			|_ [imported] StreamObservationPeriodView: displays the analysis view of a stream over the observation period (multiple subperiods)
			|_ [imported] Minigraph: graphic representation of evolution over time of a delta (expected - real) 
		|_ GenericMultiAnalysisView
			|_ EndOfPeriodProjectionSummary
*/


/* Generic component meant to handle the visualization of a specific report and should handle the display logic for different situations ($0 expectation, savings, income, etc)
	The logic Should be consistent across any custom visualisation. */
class GenericAnalysisView extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {}
	}
	isIncome(){return this.props.analysis.getExpected()>0}
	isSavings(){return this.props.analysis.isSavings()}
	isAlert(){
		if(this.isSavings()){return (-this.props.analysis.getNetAmount() + this.props.analysis.getMovedToSavings()) < -this.props.analysis.getExpected()}
		else if(this.isIncome()){return (this.props.analysis.getExpected()!=0 && this.props.analysis.getNetAmount()/this.props.analysis.getExpected())<1}
		else if(this.props.analysis.getExpected()==0){return this.props.analysis.getNetAmount()<0}
		else {return (this.props.analysis.getNetAmount()/this.props.analysis.getExpected())>1}
	}
	getMainColor(){
		if(this.isAlert()){return (this.isIncome() || this.isSavings())?DesignSystem.getStyle().warning:DesignSystem.getStyle().alert}
		else{return DesignSystem.getStyle().positive}
	}
	render(){return(<div>I am a GenericAnalysisView</div>)}
}
export class GenericPeriodReportView extends GenericAnalysisView{}//used for PeriodReport analyses
export class GenericStreamAnalysisView extends GenericAnalysisView{}//used for Stream analyses (multi-period)

const FlexColumn = styled.div`
	position:relative;
    display: flex;
    flex-direction: column;
    align-content: stretch;
    justify-content: flex-start;
    align-items: center;
    height: 100%;
    width:100%;
`


//Represents the combined progress rings of Time and Money given a stream and a report
export class TimeAndMoneyProgressView extends GenericPeriodReportView{
	getViewConfig(){return {
		moneyRadius: this.props.viewConfig?.moneyRadius || 52,
		moneyThickness: this.props.viewConfig?.moneyThickness || 0.9,
		timeRadius: this.props.viewConfig?.timeRadius || 71,
		timeThickness: this.props.viewConfig?.timeThickness || 0.2,
		subdivGapAngles: this.props.viewConfig?.subdivGapAngles || 0.005
	}}
	isCCW(){return ! (this.isIncome() || this.isSavings())}
	isExceedingInitialValue(){return this.props.analysis.getNetAmount()*this.props.analysis.getExpected()<0}
	getPrimaryPercentage(){//drives progress ring
		if(this.props.analysis.getExpected()==0){
			if(this.isSavings()){return (this.props.analysis.getNetAmount()<0)?1:0}
			else if(this.props.analysis.getNetAmount()==0) {return 0}
			else {return (this.props.analysis.getNetAmount()>0)?1:-1}
		}else{
			if(this.isIncome()){return Math.min(1,this.props.analysis.getNetAmount()/this.props.analysis.getExpected())}
			else if(this.isSavings()){return Math.min(Math.abs((-this.props.analysis.getNetAmount() + this.props.analysis.getMovedToSavings())/this.props.analysis.getExpected()),1)}
			else {return Math.max(-1,1-(this.isExceedingInitialValue()?0:1)*this.props.analysis.getNetAmount()/this.props.analysis.getExpected())};
		}
	}

	getSecondaryPercentage(){
		let date = this.props.analysis.reportingDate;
		let period = this.props.analysis.reportingPeriod;//period being visualized in the display report - the histogram will aggregate data from other periods in the observation period
		let n = Math.floor(period.getTimeSubdivisionsCount(period.previousDate(date)));//calculate subdivisions of the current period		
		return 1-this.props.analysis.getCompletedSubdivisionsCount()/n
	}
	render(){
		return (<FlexColumn style={{height:"auto",alignContent:"center","justifyContent":"center"}}  >
			<div style={{marginTop:"100%"}}></div>
			{this.props.hovering?<FrequencyRing  subdivisions={Math.round(this.props.analysis.getSubdivisionsCount())} frequencies={this.props.analysis.parentStreamAnalysis.getFrequencyHistogramAtDate(this.props.analysis.reportingDate)} />:""}
			<ProgressRing 	radius={this.getViewConfig().moneyRadius} thickness={this.getViewConfig().moneyThickness} ccw={this.isCCW()}  progress={this.getPrimaryPercentage()} 		color={this.getMainColor()}/>
			<ProgressRing 	radius={this.getViewConfig().timeRadius}  thickness={this.getViewConfig().timeThickness}  ccw={true}			progress={this.getSecondaryPercentage()}  	color={DesignSystem.getStyle().timePeriod}
							subdivisions={Math.round(this.props.analysis.getSubdivisionsCount())} 	subdivGapAngles={this.getViewConfig().subdivGapAngles}	highlightLastSubdivision={true} 			highlighColor={DesignSystem.getStyle().timePeriodHighlight}/>
		</FlexColumn>)
	}
}



export class TerminalStreamCurrentReportPeriodView extends GenericPeriodReportView{
	constructor(props){
		super(props)
		this.onMouseOver = this.onMouseOver.bind(this)
		this.onMouseOut = this.onMouseOut.bind(this)
	}
	onMouseOver(e){if(!this.state.hovering){this.updateState({ hovering: true })}}
	onMouseOut(e){if(this.state.hovering){this.updateState({ hovering: false })}}
	getPrimaryValue(){
		if(this.props.analysis.getLeftOver()==0 && this.props.analysis.getExpected()!=0){return "✔"}
		else if(this.isIncome()){return this.props.analysis.getNetAmount()}
		else if(this.isSavings()){return this.props.analysis.getMovedToSavings()}
		else {return this.props.analysis.getLeftOver()}
	}
	getSubtext(){
		if(this.props.analysis.getLeftOver()==0 && this.props.analysis.getExpected()!=0){return (this.isIncome() || this.isSavings())?"complete":"paid"}
		else if(this.isSavings() || this.isIncome()){return "/"+format(this.props.analysis.getExpected(),true,true)}
		else{return this.isAlert()?"over":"left"}
	}
	getFrequencyText(){
		return "ETA"
	}
	render(){
		return <FlexColumn style={{justifyContent: "center"}} onMouseOver={this.onMouseOver} onMouseOut={this.onMouseOut}>
			<div style={{width:"90%"}}>
				<TimeAndMoneyProgressView hovering={this.state.hovering} stream={this.props.analysis.stream} analysis={this.props.analysis}/>
			</div>
			<FlexColumn style={{position:"absolute",justifyContent: "center"}}>
				<div style={{color:this.getMainColor(),fontSize:"1.3rem",fontFamily:"Barlow",marginBottom:"0.2rem"}}>{
					isNaN(this.getPrimaryValue())?this.getPrimaryValue():<AnimatedNumber value={this.getPrimaryValue()} formatValue={x => format(x,true,!(this.isIncome()||this.isSavings()))}/>
				}</div>
				<div style={{color:this.getMainColor(),fontSize:"0.8rem"}}>{this.getSubtext()}</div>
			</FlexColumn>
{/*			{this.state.hovering||false?<AdditionalSubtitle>{this.getFrequencyText()}</AdditionalSubtitle>:""}
*/}		</FlexColumn>
	}
}


//Represents a transaction feed across the observation
export class StreamAnalysisTransactionFeedView extends GenericStreamAnalysisView{
	constructor(props){
		super(props)
		this.handleClickOnTransaction = this.handleClickOnTransaction.bind(this)
	}
	handleClickOnTransaction(txn){
		console.log(txn)
		return Core.presentModal(ModalTemplates.ModalWithStreamAllocationOptions("Edit",undefined,undefined,txn,[])).then(({state,buttonIndex}) => {
			if(buttonIndex==1){
				let txnToUpdate = [txn]
				let allocs = [state.allocations]
				let ptxn = txn.pairedTransferTransactionId?this.props.analysis.transactions.filter(t => t.transactionId==txn.pairedTransferTransactionId)[0]:undefined;
				if(!!ptxn){
					txnToUpdate.push(ptxn)
					//note: strictly speaking this isn't correct: the paired transaction should replicate the stream allocation of the original transaction but it's likely a non-use case
					allocs.push([{streamId: state.allocations[0].streamId,amount: ptxn.amount,type:"value",nodeId:1}])
				}
				console.log(txnToUpdate,allocs)
				this.props.onCategorizationUpdate(txnToUpdate,allocs)
			}
		}).catch(e => {})
	}
	render(){
		let prevExp = 0;
		let expChanges = this.props.analysis.stream.expAmountHistory.map(h => {
			let res = {startDate:h.startDate,newAmount:h.amount,previousAmount:prevExp}
			prevExp = h.amount
			return res
		})
		return (<div style={{width: "100%"}}>{	
			this.props.analysis.getPeriodReports()
			.sort(utils.sorters.desc(r => r.reportingDate))
			.map((r,i) => (
				<div key={i}>
					{expChanges?.filter(h => h.startDate >= r.reportingStartDate && h.startDate < r.reportingDate).map((h,k) => (
						<ExpectationChangePannel key={2*i+1+k}>
							<div>{utils.formatDollarAmount(h.previousAmount,0,true)+" → "+utils.formatDollarAmount(h.newAmount,0,true)}</div>
							<div style={{marginTop:"0.2rem"}}>per {Period[this.props.analysis.stream.period].unitName}</div>
						</ExpectationChangePannel>
					))}
					<PeriodReportTransactionFeedView key={2*i} analysis={r} stream={this.props.analysis.stream} handleClickOnTransaction={(e) => this.handleClickOnTransaction(e)}/>
				</div>
			))
		}</div>)
	}
}

const ExpectationChangePannel = styled.div`
	font-size: 0.7rem;
    padding: 0.7rem 0.5rem;
    margin: 0.7rem 0;
    background: ${DesignSystem.getStyle().warning+"55"};
    border-radius: ${DesignSystem.borderRadiusSmall};
    color: ${DesignSystem.getStyle().bodyText};
`

//Represents a transaction feed for a given period
class PeriodReportTransactionFeedView extends GenericPeriodReportView{
	getAggregateAmount(){
		if(this.isSavings()){return this.props.analysis.getMovedToSavings()}
		else return this.props.analysis.getNetAmount()
	}
	getReportDateString(){return this.props.analysis.getReportingPeriodString()}
	render(){
		return (<FlexColumn style={{alignItems:"stretch",height:"auto", marginBottom:"0.5rem"}}>
				<TransactionFeedHeaderViewContainer>
					<EllipsisText style={{width: "6rem"}}>{this.getReportDateString()}</EllipsisText>
					<div style={{color:this.getMainColor()}}>{utils.formatDollarAmount(this.getAggregateAmount(),2)}</div>
				</TransactionFeedHeaderViewContainer>
				{this.props.analysis.transactions.sort(utils.sorters.desc(t => t.date)).map((t,i) => (<MiniTransactionContainer onClick={(e)=> this.props.handleClickOnTransaction(t)} key={i}>
					<EllipsisText style={{fontSize:"0.7rem",width: "60%"}}>{t.description}</EllipsisText>
					<div style={{fontSize:"0.7rem",display:"block"}}>{utils.formatDollarAmount(t.streamAllocation.filter(a => a.streamId==this.props.stream.id)[0]?.amount)}</div>
				</MiniTransactionContainer>))}
		</FlexColumn>)
	}
}	

const EllipsisText = styled.div`
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	text-align:left;
`

const TransactionFeedHeaderViewContainer = styled.div`
	display: flex;
	flex-direction: row;
	justify-content: space-between;
	border-bottom: solid 1px;
	border-color: ${props => DesignSystem.getStyle().bodyTextSecondary};
	height: inherit;
	font-variant: all-petite-caps;
    font-weight: bold;
    margin-bottom: 0.1rem;
    padding-bottom: 0.1rem;

`

const MiniTransactionContainer = styled.div`
	display:flex;
	flex-direction:row;
	margin-top:0.3rem;
	justify-content: space-between;
	cursor:pointer;
	&:hover{
		color: green
	}
`


//component to display an end of period projection summary
export class EndOfPeriodProjectionSummary extends GenericAnalysisView{
	render(){
		return (<div>
		<div style={{"fontWeight":"bolder"}}>Period: {dateformat(this.props.expenseAnalysis.reportingStartDate,"mmm yyyy")} - {dateformat(this.props.expenseAnalysis.reportingDate,"mmm yyyy")} </div>
		<div>Projected Income: {format(this.props.incomeAnalysis.getEndOfOPProjection())}</div>
		<div>Projected Savings: {format(this.props.savingsAnalysis.getEndOfOPProjection())}</div>
		<div>Projected Spending: {format(this.props.expenseAnalysis.getEndOfOPProjection())}</div>
		<div>Income-Saving ratio to date: {Math.round(10000*this.props.savingsAnalysis.getAmountForCompletedPeriods()/this.props.incomeAnalysis.getAmountForCompletedPeriods())/100}%</div>
		<div>Projected income-Saving ratio: {Math.round(10000*this.props.savingsAnalysis.getEndOfOPProjection()/this.props.incomeAnalysis.getEndOfOPProjection())/100}%</div> 
	</div>)}
}

class SeriesDescriptor{
	constructor(o){
		this.name = o.name
		this.chartContext = o.chartContext
		this.config = {...o.config,...{barOffset:o.config.barOffset || {dx:0,dy:0}}} 
		this.target = this.getTimeSeries(o.target) 
		this.toDate = this.getTimeSeries(o.toDate)
		this.projected = this.getEOYProjection(o.toDate) //why do this rather than a method? to avoid having to recalculate it everytime
	}
	accessor(r){return this.toDate[r.index]?.y}
	getEOYProjection(yArray){return yArray.length > this.chartContext.timeAxisBoundIndex?yArray[this.chartContext.timeAxisBoundIndex]:this.getTrend(yArray).slice(-1)[0]?.y}
	getTimeSeries(series){return series.slice(0,this.chartContext.timeAxisBoundIndex+1).map((y,i) => {return {x:this.chartContext.xAccessor(this.chartContext.timeAxis[i]), y:y}})}
	getTrend(yArray){
		let fitIndex = yArray.length-1, {slope,yIntercept} = stats.trendLine([...[0],...yArray].map((y,i)=> {return {x: this.chartContext.timeAxis[i].getTime(), y:y}}))
		let res = this.chartContext.timeAxis.slice(fitIndex,this.chartContext.timeAxisBoundIndex+1).map(x => {return {
			x:this.chartContext.xAccessor(x), 
			y: x*slope +yArray[fitIndex]-slope*this.chartContext.timeAxis[fitIndex]
		}})
		return res
	}
}


class AnnotationInput extends BaseComponent{
	constructor(props){
		super(props)
		let annotationBody = this.getAnnotations()[0]?.body
		this.state={
			inputValue: annotationBody || "",
			previousInputValue: annotationBody || "",
			controller: props.controller,
			editMode: this.props.stream.isTerminal() && !annotationBody, //start in edit mode if a terminal stream doesn't have a body
			editStream: (this.props.stream.isTerminal() && !annotationBody)?this.props.stream:undefined,
			annotationSnapshot: this.getAnnotations()
		}
		this.handleOnChange = this.handleOnChange.bind(this)
		this.onEdit = this.onEdit.bind(this)
		this.onConfirm = this.onConfirm.bind(this)
	}
	getAnnotations(stream){
		if(!stream){stream = this.props.stream}
		return (stream.getAnnotations()).filter(an => new Date(an.date).getTime() == this.props.date.getTime()
			&& ((stream.isTerminal() && stream.id==an.streamId) || stream.hasTerminalChild(an.streamId)))
	}
	handleOnChange(e){
		this.updateState({inputValue:e.target.value})
		this.state.controller.state.modalContentState = {...this.state.controller.state.modalContentState,...{inputValue:e.target.value}}
	}
	getFormattedDate(t){
		let p = this.props.period.name, f="mm/dd";
		if(p == Period.quarterly.name){return "Q"+Math.ceil((new Date(t).getUTCMonth()+1)/3)}
		else if([Period.monthly.name,Period.bimonthly.name].indexOf(p)>-1){f= "mmmm"}
		else if(p==Period.yearly.name){f= "yyyy"}
		return dateformat(t,f)
	}
	onEdit(stream){
		this.updateState({editMode:true,editStream:stream,inputValue:this.getAnnotations(stream)[0]?.body||"",previousInputValue:((this.getAnnotations(stream)[0]?.body)||"")})
	}
	onConfirm(e){
		AnnotationInput.SaveAnnotation(this.state.editStream,this.props.date,this.state.inputValue)
		this.updateState({editMode:false,editStream:undefined,annotationSnapshot:this.getAnnotations()})
		if(!!this.props.shouldDismiss){
			if(this.props.stream.isTerminal() && this.state.inputValue=="" || !this.props.stream.isTerminal() && this.getAnnotations().length==0){
				this.props.shouldDismiss(this.state.inputValue)
			}
		}	
	} 
	render(){
		if(this.props.viewMode && !this.state.editMode){
			return(<div>{AnnotationTooltip.RenderContent(this.state.annotationSnapshot,{enableEditOption:true,onEdit:this.onEdit,disableTitle:this.props.stream.isTerminal()})}</div>)
		}else{
			return(<div>
				{this.props.stream.isTerminal()?"":<div style={{marginBottom:"1rem"}}>{(this.state.editStream || this.props.stream).name} - {this.getFormattedDate(this.props.date)}</div>}
				<textarea rows="5" autoFocus value={this.state.inputValue} onChange={this.handleOnChange} onFocus={e => {e.target.setSelectionRange(e.target.value.length,e.target.value.length)}}/>
				{(this.state.inputValue!=this.state.previousInputValue)?<div onClick={(e) => this.onConfirm(e)} style={{"position":"absolute",cursor:"pointer","top":"1.5rem","right":"1.5rem","background":DesignSystem.getStyle().modalBackground}}>
					{DesignSystem.icon.done}</div>:""}
				</div>
			)
		}
	}

	static SaveAnnotation(stream,date,input){
		if(input==""){return stream.saveAnnotation(date,"").then(refreshLiveRenderComponents)}
		else if(!input){console.log("do nothing")}
		else{
			let toSave = input.split('\n').map(a => a.trim()).filter(a => a!="").join("\n")
			return stream.saveAnnotation(date,toSave).then(refreshLiveRenderComponents)
		}
	}

}


//Victory charts
export class GenericChartView extends GenericAnalysisView{
	constructor(props){
		super(props)
		this.style = {
			chartHeight: 170, 
			chartWidth: 450,
			chartPadding: {top:20,bottom:10,left:10,right:60},
			midgroundOpacity: 0.5, 									//opacity of middle ground items (trends and projections)
			backgroundOpacity: 0.15, 								//opacity of background items (area charts)
			fontSizeTitle:20,										//Chart title
			fontSizeHeader:14,										//Big numbers
			fontSizeBody:7,											//Everthing else
		}

		//eventing
		this.onFlyOver = this.onFlyOver.bind(this)
		this.onFlyOut = this.onFlyOut.bind(this)
		this.voronoiCount = 0
		this.state = {...this.state,hovering:false}

		//domain
		this.timeAxis = this.getReportSchedule()
		this.timeAxisBoundIndex = this.timeAxis.length-2 			//maximum index of timeAxis data will be rendered. 
		
		this.handleClick = this.handleClick.bind(this);
		this.hoverData = undefined;
		this.svgClientSize = {width:0,height:0}						//used for annotations positioning for knowing the effective size of the svg container
		liveRenderComponents.push(this)
	}
	componentDidMount(){this._isMounted=true}
	componentWillUnmount(){this._isMounted=false}
	//eventing
	onEnter(){this.updateState({hovering:true})}
	onExit(){this.updateState({hovering:false})}
	onFlyOver(d,e){
		if(++this.voronoiCount==1){
		this.hoverData = d; 
		this.onEnter(d); 
		if(e?.parentSVG){this.svgClientSize = {width: e.parentSVG.clientWidth, height:e.parentSVG.clientHeight}}
	}}
	onFlyOut(d){
		if(--this.voronoiCount>-1){return}
		else{this.voronoiCount = 0;this.onExit(d)}
	}
	getFormattedDate(t,periodName){
		let p = periodName, f="mm/dd";
		if(p == Period.quarterly.name){return "Q"+Math.ceil((new Date(t).getUTCMonth()+1)/3)}
		else if([Period.monthly.name,Period.bimonthly.name].indexOf(p)>-1){f= "mmmm"}
		else if(p==Period.yearly.name){f= "yyyy"}
		return dateformat(t,f)
	}
	handleClick(d){
		let date = new Date(d[0].x)
		let ans = this.getAnnotationsAtDate(d[0].x)
		let p = this.props.analysis.subReportingPeriod;
		if(!this.props.analysis.stream.isTerminal() && !ans.length){return}//don't do anything on empty compound stream annotations
		return Core.presentModal((that) => ModalTemplates.ModalWithComponent(this.props.analysis.stream.name,
			<AnnotationInput	controller={ModalManager.currentModalController} viewMode={true} shouldDismiss={() => ModalManager.currentModalController.hide()}
								stream={this.props.analysis.stream} date={this.getReportAtDate(date).reportingDate} period={p}/>,[],this.getFormattedDate(date,p.name))(that))
			.then(({state,buttonIndex}) => {if(buttonIndex==1){AnnotationInput.SaveAnnotation(this.props.stream,date,state?.inputValue)}}).catch(e => {})


	}
	getAnnotationsAtDate(d){
		let s = this.props.analysis?.stream //the stream this of this graph
		return s?.getAnnotationsForReport(this.getReportAtDate(new Date(d))) || []
	}
	getData(){if(!!this.data){return this.data} else {return [{x:0,y:0}]}}//to override - data getter

	//domain definitions
	getReportSchedule(){return []}
	dateToTickDate(d){return (new Date(d)).setDate(1)}
	getDomainBounds(){return {//must override
		mx:this.dateToTickDate(this.timeAxis[0]),
		Mx:this.dateToTickDate(this.timeAxis[this.timeAxis.length-1]),
		my:-100,My:100
	}}
	svgToDomain(dx=0,dy=0){ let b = this.getDomainBounds();	return {
		dx:b.mx + (dx-this.style.chartPadding.left)*(b.Mx-b.mx)/(this.style.chartWidth-this.style.chartPadding.left-this.style.chartPadding.right),
		dy:b.My - (dy-this.style.chartPadding.top)*(b.My-b.my)/(this.style.chartHeight-this.style.chartPadding.top-this.style.chartPadding.bottom)		
	}}
	domainToSvg(dx=0,dy=0){ let b = this.getDomainBounds();	return {
		dx:this.style.chartPadding.left+(dx-b.mx)/(b.Mx-b.mx)*(this.style.chartWidth-this.style.chartPadding.left-this.style.chartPadding.right),
		dy:this.style.chartPadding.top+(b.My-dy)/(b.My-b.my)*(this.style.chartHeight-this.style.chartPadding.top-this.style.chartPadding.bottom)		
	}}
	getDomain(){let b = this.getDomainBounds(); return {x:[b.mx,b.Mx],y:[b.my,b.My]}}
	getReportAtDate(date){return {reportingDate:this.getReportSchedule().filter(d => date<=d)[0],
		reportingStartDate: this.getReportSchedule().filter(d => d<date).slice(-1)[0]}}

	//render to override
	render(){return (<V.VictoryChart events={{onClick:(d,e) => this.handleClick(this.hoverData)}} scale={{ x: "time", y:"linear" }} domain={this.getDomain()} height={this.style.chartHeight} width={this.style.chartWidth} padding={this.style.chartPadding} containerComponent={<V.VictoryVoronoiContainer onActivated={this.onFlyOver} onDeactivated={this.onFlyOut} activateData={true} voronoiDimension="x" labels={(d) => " "}/>}/>)}
}


//component to display an end of period projection summary
export class EndOfPeriodProjectionGraph extends GenericChartView{
	constructor(props){
		super(props)
		this.style = {...this.style,
			chartBarWidth:4, 										//bar width for the bar chart
			summaryBarOffset: -timeIntervals.oneDay*3,				//placement of the bar in x-domain coordinates
			summaryBarLabelXOffset: 7, 								//horizontal space between the bar and the labels
			summaryBarLabelYOffset: 0,								//not implemented
			statLabelSpacing:1, 									//space between text for projected savings/expenses and percentage
			scatterDotSize: 2,
			annotationTooltipHitRadius: 15,
		}
		//since the graph is expensive to render, we use internal eventing to update it instead of state
		this.listeners = []
		this.mouseMoveListeners = []
		this.hovering = false 
		this.onDataPointHovered = this.onDataPointHovered.bind(this)
		this.hoveredDataPoint = undefined
	}

	//plot configuration
	getData(){	
		if(!!this.data){return this.data}
		let savingsAnalysis = this.props.savingsAnalysis.getPeriodAggregates()
		let expenseAnalysis = this.props.expenseAnalysis.getPeriodAggregates()
		let incomeAnalysis = this.props.incomeAnalysis.getPeriodAggregates()
		let chartContext = {timeAxis: this.timeAxis,timeAxisBoundIndex: this.timeAxisBoundIndex, xAccessor:this.dateToTickDate}
		const addToSave = (r1,r2) => {r1.stats.savedToDate = r1.stats.savedToDate+ r2.stats.savedToDate; return r1}
		let res = {
			plotList: [
				new SeriesDescriptor({ name:"savings", chartContext:chartContext,
					config:{render:true,color:DesignSystem.getStyle().savings,barStrings: {toDate:"Saved to date",value:"Saved",projected:"Annual savings"}},
					target: this.timeAxis.map((d,i) => -(i+1)*this.props.savingsAnalysis.getExpectedAmountAtDateForPeriod(Period.monthly.previousDate(d),Period.monthly)),
					toDate: savingsAnalysis.map((r,i) => r.stats.savedToDate + incomeAnalysis[i].stats.savedToDate)
				}),
				new SeriesDescriptor({ name:"expenses", chartContext:chartContext,
					config:{render:true,color:DesignSystem.getStyle().expenses,barStrings: {toDate:"Spent to date",value:"Spent",projected:"Annual expenses"}},
					target: this.timeAxis.map((d,i) => (i+1)*this.props.expenseAnalysis.getExpectedAmountAtDateForPeriod(Period.monthly.previousDate(d),Period.monthly)),
					toDate: expenseAnalysis.map(r => r.stats.netToDate)
				}),
				new SeriesDescriptor({ name:"income", chartContext:chartContext,
					config:{render:false,noTarget:true,noBar:true,color:DesignSystem.getStyle().warning,barStrings: {toDate:"Earnt to date",value:"Earnt",projected:"Annual income"},barOffset: {dx:-this.style.summaryBarLabelXOffset,dy:0}},
					target: this.timeAxis.map((d,i) => (i+1)*(this.props.incomeAnalysis.getExpectedAmountAtDateForPeriod(Period.monthly.previousDate(d),Period.monthly)+this.props.expenseAnalysis.getExpectedAmountAtDateForPeriod(d,Period.monthly))),
					toDate: incomeAnalysis.map((r,i) => r.stats.netToDate+expenseAnalysis[i].stats.netToDate),
				}) //optional - not rendered
			],
			reportSchedule: this.timeAxis.slice(1).map((t,i) => !expenseAnalysis[i]?undefined:{
				reportingStartDate:Period.monthly.previousDate(Period.monthly.previousDate(new Date(t))),
				reportingDate:Period.monthly.previousDate(new Date(t)),
				index: i,
				x: this.dateToTickDate(this.timeAxis[i])
			}),
			maxPlottedIndex: expenseAnalysis.length
		}
		this.data = res;
		return res
	}

	//Data functions
	getDataByName(name){return this.getData().plotList.filter(p => p.name==name)[0]}
	getLatestReportSchedule(){return this.getData().reportSchedule.filter(a => !!a).slice(-1)[0]}
	getAnnotationsAtDate(d,config={expenses:true,savings:true,income:true}){
		let date = new Date(d) // the date that was clicked
		let ans = []
		if(config.expenses){ans.push(this.props.expenseAnalysis)}
		if(config.savings) {ans.push(this.props.savingsAnalysis)}
		if(config.income)  {ans.push(this.props.incomeAnalysis)}
 		return utils.flatten(ans.map(ana => utils.flatten(ana.analyses?.map(a => a.stream.getAnnotationsForReport(this.getReportAtDate(date))))))
	}

	//eventing
	getDefaultReport(){return this.getLatestReportSchedule()}
	registerListener(){this.listeners.push(React.createRef()); return this.listeners.slice(-1)[0]}
	registerMouseMoveListener(){this.mouseMoveListeners.push(React.createRef()); return this.mouseMoveListeners.slice(-1)[0]}
	updateListeners(report){this.listeners.forEach(l => {l.current.invalidate = true;l.current.updateState({focusReport:report})})}
	updateMouseMoveListeners(){this.mouseMoveListeners.forEach(l => {l.current.invalidate = true;l.current.updateState({refresh:true})})}
	onExit(d){this.hovering=false;this.hoveredDataPoint=undefined;this.updateListeners(this.getDefaultReport());this.updateMouseMoveListeners()}
	onEnter(d){this.hovering=true;this.updateListeners(this.getData().reportSchedule.filter(sc => sc?.x==d[0].x)[0])}
	handleClick(d){return false}
	onDataPointHovered(e,synthEvent){
		if(!this.hoveredDataPoint && !e){return}
		else if(this.hoveredDataPoint && e && this.hoveredDataPoint.x==e.x && this.hoveredDataPoint.y==e.y){return}
		else {this.hoveredDataPoint = e} //if we reach this point, this means there is a change and we need to refresh
		if(synthEvent?.parentSVG){this.svgClientSize = {width: synthEvent.parentSVG.clientWidth, height:synthEvent.parentSVG.clientHeight}}
		this.updateMouseMoveListeners()
	}
	

	//domain definition 
	getReportSchedule(){return this.props.savingsAnalysis.getFullSchedule()}
	getDomainBounds(){
		let acc = (g,f) =>  g(this.getData().plotList.filter(o=>o.config.render).map(p => f(p.target[p.target.length-1].y,p.projected)))
		return {...super.getDomainBounds(),my:acc(utils.min,Math.min),My:acc(utils.max,Math.max)}
	}

	//render functions
	renderScatterLine(series){
		return(<V.VictoryChart>
			<V.VictoryAxis style={{axis:{opacity:0}}} tickFormat={() => ''}/>
			<V.VictoryLine 		data={series.getTrend(series.toDate.map(p => p.y))} style={{data:{stroke:series.config.color,strokeWidth:0.9,opacity:this.style.midgroundOpacity,strokeDasharray: "1, 2"}}}/>
			<V.VictoryLine 		name={series.name+"Line"} data={series.toDate} style={{data:{stroke:series.config.color,strokeWidth:1}}}/>
			<V.VictoryScatter 	name={series.name+"Dots"} data={series.toDate} size={this.style.scatterDotSize} style={{data: {fill: ({datum})=>this.getAnnotationsAtDate(datum.x,{expenses: series.name=="expenses",savings: series.name=="savings", income: series.name =="savings"}).length?"url(#"+(datum.y<0?"alertHighlight":"savingsHighlight")+")":series.config.color}}}/>
		</V.VictoryChart>)
	}
	renderDynamicBarWithLabels(series){
		let c = series.config.color, b = this.style.fontSizeBody, h = this.style.fontSizeHeader, s = this.style.statLabelSpacing, labelHeight = 2*b+h+2*s , sign = Math.abs(series.projected)/series.projected
		let x0 = (this.timeAxis[this.timeAxisBoundIndex].getTime())+this.style.summaryBarOffset 						//base x value to draw the chart from
		let formatPercent = (x) => Math.round(100*x)+"%"
		let savingExpenseSum = (accessor) => accessor(this.getDataByName("savings"))+Math.abs(accessor(this.getDataByName("expenses")))
		let getYValue = (fr,ser) =>  (fr?ser.accessor(fr):series.projected)
		let getPosition = (fr,ser) => {let sign = series.projected>=0?1:-1; return {x:x0,y:sign*Math.max(sign*getYValue(fr,ser),this.svgToDomain(0,0).dy - this.svgToDomain(0,labelHeight+0.75*b).dy)}}
		let labelMutator = (valueAccessor) => (fr)=> {return {"datum": getPosition(fr,series),"text": valueAccessor(fr)}}	
		let getTitle = (fr,ser) => ser.config.barStrings[fr?"toDate":"projected"]	
		let	getValue = (fr,ser) => {return utils.formatDollarAmount(fr?ser.accessor(fr):series.projected,0,true)}		//bar $$ value
		let	getRatio = (fr,ser) => formatPercent(Math.abs(fr?ser.accessor(fr):ser.projected)/savingExpenseSum(r => fr?r.accessor(fr):r.projected))
		
		return (<SharedPropsWrapper style={{fill: c,fontSize:b, fontFamily:"Inter"}} dx={this.style.summaryBarLabelXOffset} dy={0} textAnchor={"start"} verticalAnchor={"start"}>
			<FocusReportWrapper 	name="bar" 		 	defaultReport={this.getDefaultReport()}	mutations={(fr)=> {return {"data":[{x:x0,y:getYValue(fr,series)+sign*(this.svgToDomain(0,0).dy-this.svgToDomain(0,this.style.chartBarWidth*0.25).dy)}],"style":{data:{fill: c,opacity:fr?1:this.style.midgroundOpacity}}}}} ref={this.registerListener()} ><V.VictoryBar standalone={false} barWidth={this.style.chartBarWidth} cornerRadius={0.5*this.style.chartBarWidth} style={{data:{fill: c,opacity:this.style.midgroundOpacity}}} /></FocusReportWrapper>
	    	<SharedPropsWrapper 	dy={series.projected>=0?0:-labelHeight} dx={series.config.barOffset.dx||0} >
		    	<FocusReportWrapper name="labelTitle"	defaultReport={this.getDefaultReport()} mutations={labelMutator(fr => getTitle(fr,series))} dy={0} 			ref={this.registerListener()}><V.VictoryLabel style={{fontSize:b, fontFamily:"Inter"}}/></FocusReportWrapper>
		    	<FocusReportWrapper name="labelValue"	defaultReport={this.getDefaultReport()} mutations={labelMutator(fr => getValue(fr,series))} dy={s+b} 		ref={this.registerListener()}><V.VictoryLabel style={{fontSize:h, fontFamily:"Barlow"}}/></FocusReportWrapper>
				<FocusReportWrapper name="labelRatio"	defaultReport={this.getDefaultReport()} mutations={labelMutator(fr => getRatio(fr,series))} dy={2*s+b+h} 	ref={this.registerListener()}><V.VictoryLabel style={{fontSize:b, fontFamily:"Inter"}}/></FocusReportWrapper>
			</SharedPropsWrapper>
		</SharedPropsWrapper>)
	}
	renderChartTitle(){
		const getIncrement = (seriesName,fr) => this.getDataByName(seriesName).accessor(fr)- (!fr.index?0:this.getDataByName(seriesName).accessor(this.getData().reportSchedule[fr.index-1]))
		const getTimePeriodString = (fr) => {
			let [s,e,f] = [ (fr && this.hovering)	?fr.reportingStartDate 	:this.props.expenseAnalysis.reportingStartDate 	,//start date
							(fr && this.hovering)	?fr.reportingDate 		:this.props.expenseAnalysis.reportingDate 		,//end date
							(this.hovering)			?'mmm dS, yyyy' 		:'mmm yyyy'										]//date format
			return [dateformat(s,f),"-",dateformat(new Date(e-timeIntervals.oneDay),f)].join(" ")
		}
		const getTitle = (fr) => {
			if(!this.hovering){return dateformat(this.props.expenseAnalysis.reportingDate,"yyyy")}
			else {return fr?dateformat(fr.reportingDate,"mmmm"):dateformat(this.props.expenseAnalysis.reportingDate,"yyyy")+" Projected"}
		}
		const getSavedInPeriod = (fr) => {return (fr && this.hovering)?"Saved "+utils.formatDollarAmount(getIncrement("savings",fr),0,true):""}
		const getExpensesInPeriod = (fr) => {return (fr && this.hovering)?"Spent "+utils.formatDollarAmount(getIncrement("expenses",fr),0,true):""}

		return (<SharedPropsWrapper datum={{x:this.dateToTickDate(this.timeAxis[0]),y:this.getDomainBounds().My}}>
        	<FocusReportWrapper defaultReport={this.getDefaultReport()} ref={this.registerListener()} mutations={(fr)=> {return {"text":getTitle(fr)
			}}}><V.VictoryLabel style={{fontSize:this.style.fontSizeTitle,fontFamily:"Inter",fill: DesignSystem.getStyle().bodyText}}/></FocusReportWrapper>
			<FocusReportWrapper defaultReport={this.getDefaultReport()} dy={this.style.fontSizeTitle*0.8+this.style.statLabelSpacing} ref={this.registerListener()} mutations={(fr)=> {return {"text":getTimePeriodString(fr)}}}><V.VictoryLabel style={{fontSize:this.style.fontSizeBody,fontFamily:"Inter",fill: DesignSystem.getStyle().bodyText}}/></FocusReportWrapper>
			<FocusReportWrapper defaultReport={this.getDefaultReport()} dy={this.style.fontSizeTitle*0.8+1*this.style.fontSizeBody+6*this.style.statLabelSpacing} ref={this.registerListener()} mutations={(fr)=> {return {"text":getExpensesInPeriod(fr)}}}><V.VictoryLabel style={{fontSize:this.style.fontSizeBody,fontFamily:"Inter",fill: DesignSystem.getStyle().bodyTextSecondary}}/></FocusReportWrapper>
			<FocusReportWrapper defaultReport={this.getDefaultReport()} dy={this.style.fontSizeTitle*0.8+2*this.style.fontSizeBody+8*this.style.statLabelSpacing} ref={this.registerListener()} mutations={(fr)=> {return {"text":getSavedInPeriod(fr)}}}><V.VictoryLabel style={{fontSize:this.style.fontSizeBody,fontFamily:"Inter",fill: DesignSystem.getStyle().bodyTextSecondary}}/></FocusReportWrapper>
		</SharedPropsWrapper>)
	}
	renderToolTip(){
		if(Core.isMobile()){return}
		const configFromChildName = x => {return {expenses:x=="expensesDots", savings:x=="savingsDots", income:x=="savingsDots"}}
		return (<ConditionalToolTip ref={this.registerMouseMoveListener()} shouldShow={() => this.hoveredDataPoint && this.getAnnotationsAtDate(this.hoveredDataPoint.x,configFromChildName(this.hoveredDataPoint.childName)).length}
			showAbove={() => this.hoveredDataPoint.childName=="savingsDots"} svgClientSize={() => this.svgClientSize}
			getHoverData={() => this.hoveredDataPoint} getReportDate={() => dateformat(new Date(this.hoveredDataPoint.x),"mmmm")} 
			getDatum={() => this.domainToSvg(this.hoveredDataPoint.x,this.hoveredDataPoint.y)} 
			scale={{x: u => u/this.style.chartWidth,y: u=> u/this.style.chartHeight}} 
			getContent={() => this.getAnnotationsAtDate(this.hoveredDataPoint.x,configFromChildName(this.hoveredDataPoint.childName))} 
		/>)
	}
	render(){
		this.data = undefined
		this.listeners.map(l => l.current.invalidate = true)
		this.listeners=[];
		this.mouseMoveListeners.map(l => l.current.invalidate = true)
		this.mouseMoveListeners=[];

		return (<div style={{position:"relative",width:"calc(100% - 2rem)",height:"100%",display:"flex",background:DesignSystem.getStyle().UIElementBackground,borderRadius:DesignSystem.borderRadius,padding:"1rem",marginBottom:"2rem"}}>
			<div style={{position:"relative",width:"100%",height:"100%"}}>
		       	<svg style={{position:"absolute",width:0}}><defs>
			        <radialGradient id="alertHighlight">
			            <stop offset="30%" stopColor={DesignSystem.UIColors.white}/>
			            <stop offset="70%" stopColor={DesignSystem.getStyle().alert}/>
			        </radialGradient>
			        <radialGradient id="savingsHighlight">
			            <stop offset="30%" stopColor={DesignSystem.UIColors.white}/>
			            <stop offset="70%" stopColor={DesignSystem.getStyle().savings}/>
			        </radialGradient>
				</defs></svg>
		        <V.VictoryChart height={this.style.chartHeight}  width={this.style.chartWidth} padding={this.style.chartPadding} scale={{ x: "time", y:"linear" }} domain={{x:[this.getDomainBounds().mx,this.getDomainBounds().Mx],y:[this.getDomainBounds().my,this.getDomainBounds().My]}} 
		        	containerComponent={<CustomVoronoiContainer sensibilityRadius={this.style.annotationTooltipHitRadius} chartContext={this} onDataPointHovered={this.onDataPointHovered} onDataPointExit={() => this.onDataPointHovered(undefined)} voronoiBlacklist={["expensesArea","savingsLine","expensesLine"]} activateData={false} onActivated={this.onFlyOver} onDeactivated={this.onFlyOut} voronoiDimension="x" style={{touchAction:"auto"}}
		        	labelComponent={<FocusLineToolTip yOffset={this.style.scatterDotSize} data={this.getData()} maxX={this.domainToSvg(this.dateToTickDate(this.timeAxis[this.timeAxisBoundIndex])).dx} domainToSvgY={y => this.domainToSvg(0,y).dy} minY={this.getDataByName("expenses").projected} maxY={this.getDataByName("savings").projected}/>} 
		        	labels={(d) => " "}/>}>
		          <V.VictoryAxis tickCount={this.getData().reportSchedule.length-1}  
		          	tickComponent={<BoundedTick maxX={this.timeAxis[this.timeAxisBoundIndex]}/>} 
		          	tickFormat={(t) => (t>this.timeAxis[this.timeAxisBoundIndex])?"":`${t.toLocaleString('en-US', {month: 'short'}).toUpperCase()}`} 
		          	style={{
		          		ticks: {stroke: DesignSystem.getStyle().bodyTextSecondary, size: 0, strokeWidth:3.5, strokeLinecap:"round"},
		          		tickLabels: {padding:-10,fill:DesignSystem.getStyle().bodyTextSecondary,fontSize: 7,fontFamily:"Inter",fontWeight:500},
		          		axis:{"stroke":DesignSystem.getStyle().bodyTextSecondary,strokeWidth:0}
		          	}} />
		        	
		        	{this.renderChartTitle() /*Period Title*/}
		           	{this.getData().plotList.filter(series => series.config.render).map((series,i) => ([
		           		(series.config?.noTarget)?<g></g>:<V.VictoryArea name={series.name+"Area"} 	/*Areas plot*/
		           			data={series.target} style={{data:{fill:series.config.color,opacity:this.style.backgroundOpacity}}}/>,	
		           		this.renderScatterLine(series),												/*Scatter lines & trends*/
						(series.config?.noBar)?<g></g>:this.renderDynamicBarWithLabels(series)		/*Bar projections*/
		           	]))}
		        </V.VictoryChart>
		        {this.renderToolTip()}
	        </div>
		</div>)
	}
}
const BoundedTick = (props) => (props.datum < props.maxX)?<V.LineSegment {...props}/>:""
const FocusLineToolTip = (props) => {
	let projection = (props.data.reportSchedule[props.data.maxPlottedIndex-1]?.x < props.datum.x);
	let x = projection?props.maxX:props.x;
	let minY = projection?props.minY:utils.min(props.activePoints.filter(c => c.childName=="expensesDots").map(p => p.y))
	let maxY = projection?props.maxY:utils.max(props.activePoints.filter(c => c.childName=="savingsDots").map(p => p.y))
	return <line x1={x} x2={x} y1={props.domainToSvgY(maxY)+props.yOffset} y2={props.domainToSvgY(minY)-props.yOffset} strokeDasharray="1" stroke="grey" strokeWidth="1"/>
}

//Victory wrapper that passes all its props to its children 
class SharedPropsWrapper extends BaseComponent{
	getProps(child){
		let res = {...this.props,...child.props,
		...{style:_.merge(this.props.style,child.props.style)},
		...{datum:{x:(this.props.datum?.x||0)+(child.props.datum?.x||0),y:(this.props.datum?.y||0)+(child.props.datum?.y||0)}},
		...{data:_.merge(this.props.data||[],child.props.data||[])},
		...{dy:(this.props.dy||0)+(child.props.dy||0)},
		...{dx:(this.props.dx||0)+(child.props.dx||0)},
		...{standalone: child.props.standalone || false}
		}
		return res
	}
	render() {return React.Children.toArray(this.props.children).map((child) => {return React.cloneElement(child,this.getProps(child))})}
}

//Shared Props Wrapper that applies mutations (props) when the focus report changes
class FocusReportWrapper extends SharedPropsWrapper{
	constructor(props){
		super(props); 
		this.state = {focusReport:this.props.defaultReport}
		this.lastRender = this.refreshRender()
		this.lastFocusReportX = undefined
		this.invalidate = false //used to trigger rerender when the graph is rerendered 
	}
	refreshRender(){return React.Children.toArray(this.props.children).map((child) => {return React.cloneElement(child, {...this.getProps(child),...this.props.mutations(this.state.focusReport)})})}
	render() {
		if(this.invalidate || this.lastFocusReportX != this.state.focusReport?.x){//only rerenders if the focus report changes
			this.lastFocusReportX = this.state.focusReport?.x
			this.lastRender = this.refreshRender()
			this.invalidate = false
		}
		return this.lastRender 
	}
}

//extension of Voronoi container that combines 1-dimentional voronoi events with additional callbacks when mouse is in range of data point 
class CustomVoronoiContainer extends V.VictoryVoronoiContainer{
	static defaultEvents = (props) => {
		let a = super.defaultEvents(props)
		a.filter(aa => aa.target=='parent')[0].eventHandlers.onMouseMove = (e,j) => {
			if(j.activePoints && j.mousePosition){
				const isInRadius = (p1,p2) => Math.pow(p1.x-p2.x,2)+Math.pow(p1.y-p2.y,2)<= Math.pow(props.sensibilityRadius,2)
				let inRangePoints = 0;
				j.activePoints.forEach(p => {
					let sp = p?props.chartContext.domainToSvg(p.x,p.y):{}
					if(isInRadius({x:sp.dx,y:sp.dy},j.mousePosition)){
						inRangePoints++;
						props.onDataPointHovered(p,j)
					}
					if(inRangePoints==0){props.onDataPointExit()}
				})
				if(!j.activePoints.length){props.onDataPointExit()}
			}else {props.onDataPointExit()}
			return super.defaultEvents(props).filter(aa => aa.target=='parent')[0].eventHandlers.onMouseMove(e,j)
		}
		return a
	}
}

export class AnnotationTooltip extends BaseComponent{
	static RenderContent(content,options){
		return (<div>{content.map((a,i) => <div style={{display: "flex",flexDirection: "column",alignContent: "flex-start",alignItems: "flex-start"}} key={i}> 
			<div style={{height:options?.disableTitle?0:"auto","display":"flex","alignItems":"baseline","flexDirection":"row","justifyContent":"space-between","width":"100%"}}>
				{options?.disableTitle?<div></div>:<div style={{fontWeight:900,marginTop: "0.4rem",marginBottom:"0.2rem"}}>{Core.getStreamById(a.streamId).name}</div>}
				{options?.enableEditOption? <StyledLink style={{marginTop:options?.disableTitle?"0.2rem":0}} onClick={() => options.onEdit(Core.getStreamById(a.streamId))}>edit</StyledLink>:""}
			</div>
			{a.body.split('\n').map((a,i) => <div key={i} style={{display:"flex",flexDirection: "row",justifyContent: "flexStart",marginBottom:"0.2rem",marginRight:options?.enableEditOption?"3rem":0}}>
				<div style={{margin: "0 0.4rem"}}>•</div>
				<div style={{textAlign: "start"}}>{a}</div>
			</div>)}
		</div>)}</div>)
	} 
	render(){
		return (<AnnotationTooltipContainer shouldOverrideOverflow={this.props.shouldOverrideOverflow} containerSVGWidth={this.props.containerSVGWidth} containerSVGHeight={this.props.containerSVGHeight} datum={this.props.datum} scale={this.props.scale} showAbove={this.props.showAbove}>
			<TooltipBackdrop/>
			<Arrow showAbove={this.props.showAbove}/>
			<div style={{	fontVariant:"all-petite-caps",
							color:DesignSystem.getStyle().bodyText,
							marginBottom:"0.3rem",
							marginTop:"-0.4rem",
							fontSize:"1rem",
							width:"100%",
							textAlign:"center",
							paddingBottom: "0.5rem",
							borderBottom: "1px solid "+DesignSystem.getStyle().borderColor
			}}>{this.props.reportDate}</div>
			{AnnotationTooltip.RenderContent(this.props.content)}

	</AnnotationTooltipContainer>)}
}

class ConditionalToolTip extends BaseComponent{
	render(){
		return (this.props.shouldShow()?<AnnotationTooltip shouldOverrideOverflow={this.props.shouldOverrideOverflow} containerSVGWidth={this.props.svgClientSize().width} containerSVGHeight={this.props.svgClientSize().height} 
			showAbove={this.props.showAbove()} scale={this.props.scale} reportDate={this.props.getReportDate()} 
     		datum={this.props.getDatum()} content={this.props.getContent()}/>:<div></div>)
	}
}


const AnnotationTooltipContainer = styled.div`
	position: ${props => props.shouldOverrideOverflow?"fixed":"absolute"};
    display: flex;
    width: max-content;
    padding: 0.75rem;
    min-width: 6rem;
    max-width: 12rem;
    /*the formula for shouldOverrideOverflow is not fully understood. There is another dependency on the container width of TSCardContent in StreamAuditView*/
    left: ${props => (props.shouldOverrideOverflow?-16*(1.25+0.5*DesignSystem.barWidthRem):0) +props.scale.x(props.datum.dx)*props.containerSVGWidth||0}px;
    /**/
    top: ${props => props.scale.y(props.datum.dy)*props.containerSVGHeight||0}px;
    transform:translate(-50% , ${props => props.showAbove?"-100%":0}) translateY(${props => (props.showAbove?-1:1)*1.25}rem);
    border-radius: ${props => DesignSystem.borderRadius};
    text-align: center;
    justify-content: center;
    flex-direction: column;
    align-items: flex-start;
    align-content: flex-start;
    font-size: 0.8rem;
    z-index:99;
    pointer-events: none;
`
const Arrow = styled.div`
	position: absolute;
	width:0rem;
	height:0rem;
	top: ${props =>  props.showAbove?"auto":"-1rem"};
	bottom: ${props =>  !props.showAbove?"auto":"-1rem"};
	left: 50%;
	transform:translate(-50%);
	border-left: 0.5rem solid transparent;
 	border-right: 0.5rem solid transparent;
  	border-bottom: 0.5rem solid ${props => !props.showAbove?DesignSystem.getStyle().ultimateBackground+"60":"transparent"};
  	border-top: 0.5rem solid ${props => props.showAbove?DesignSystem.getStyle().ultimateBackground+"60":"transparent"};
  	z-index:100;
 pointer-events: none;
`

const TooltipBackdrop = styled.div`
	background: ${props => DesignSystem.getStyle().ultimateBackground+"60"};
    border-radius: ${props => DesignSystem.borderRadius};
    box-shadow: 0 0 0.5rem #00000030;
    backdrop-filter: blur(1rem);
    position:absolute;
    z-index: -1;
    left: 0rem;
    width:100%;
    height:100%;
     pointer-events: none;

`