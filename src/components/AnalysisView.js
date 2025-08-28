import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import Core from '../core.js';
import memoize from "memoize-one";
import AnimatedNumber from "animated-number-react";
import ModalManager, {ModalTemplates} from '../ModalManager.js'
import DS from '../DesignSystem.js'
import getReportFromDateForTerminalStream from '../processors/ReportingCore.js';
import ProgressRing, {FrequencyRing} from './ProgressRing';
import {Period,timeIntervals} from '../Time';
import dateformat from "dateformat";
import ReactDOM from 'react-dom';
import * as V from 'victory';
import React, {useState} from "react"
import {StyledLink} from "./StreamAuditView"
import utils from '../utils'
import Statistics from '../processors/Statistics';
import FlipMove from 'react-flip-move'

const _ = require('lodash');
export function format(x,noMinusSign,noPlusSign){
	if(x==0){return utils.formatCurrencyAmount(0,0,undefined,undefined,Core.getPreferredCurrency())}
	else {return utils.formatCurrencyAmount(x,(Math.abs(x)>=100 || (Math.floor(x)==x))?0:2,noMinusSign,noPlusSign,Core.getPreferredCurrency())}
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
	isIncome(){return this.props.analysis.isIncome()}
	isSavings(){return this.props.analysis.isSavings()}
	isInterest(){return this.props.analysis.isInterest()}
	isAlert(){
		if(this.isSavings()){return (-this.props.analysis.getNetAmount() + this.props.analysis.getMovedToSavings()) < -this.props.analysis.getExpected()}
		else if(this.isIncome()){return (this.props.analysis.getExpected()!=0 && this.props.analysis.getNetAmount()/this.props.analysis.getExpected())<1}
		else if(this.props.analysis.getExpected()==0){return this.props.analysis.getNetAmount()<0}
		else {return (this.props.analysis.getNetAmount()/this.props.analysis.getExpected())>1}
	}
	getMainColor(){
		if(this.isAlert()){return (this.isIncome() || this.isSavings())?DS.getStyle().warning:DS.getStyle().alert}
		else{return DS.getStyle().positive}
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
	isExceedingInitialValue(){return this.props.analysis.getNetAmount()*this.props.analysis.getExpectedAtMaturity()<0}
	getPrimaryPercentage(){//drives progress ring
		if(this.props.analysis.getExpectedAtMaturity()==0 || !this.props.analysis.getExpectedAtMaturity()){
			if(this.isSavings()){return (this.props.analysis.getNetAmount()<0)?1:0}
			else if(this.props.analysis.getNetAmount()==0) {return 0}
			else {return (this.props.analysis.getNetAmount()>0)?1:-1}
		}else{
			if(this.isIncome()){return Math.min(1,this.props.analysis.getNetAmount()/this.props.analysis.getExpectedAtMaturity())}
			else if(this.isSavings()){return Math.min(Math.abs((-this.props.analysis.getNetAmount() + this.props.analysis.getMovedToSavings())/this.props.analysis.getExpectedAtMaturity()),1)}
			else {return Math.max(-1,1-(this.isExceedingInitialValue()?0:1)*this.props.analysis.getNetAmount()/this.props.analysis.getExpectedAtMaturity())};
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
			<ProgressRing 	radius={this.getViewConfig().timeRadius}  thickness={this.getViewConfig().timeThickness}  ccw={true}			progress={this.getSecondaryPercentage()}  	color={DS.getStyle().timePeriod}
							subdivisions={Math.round(this.props.analysis.getSubdivisionsCount())} 	subdivGapAngles={this.getViewConfig().subdivGapAngles}	highlightLastSubdivision={true} 			highlightColor={DS.getStyle().timePeriodHighlight}/>
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
		if(!this.isSavings()&&this.props.analysis.getLeftOver()==0 && this.props.analysis.getExpected()!=0){return this.props.analysis.getNetAmount()}
		else if(this.isSavings() && !this.isInterest()){
			if(this.props.analysis.getExpectedAtMaturity()<0){return this.props.analysis.getMovedToSavings()}
			else {return this.props.analysis.getLeftOver()}
		}else if(this.isIncome()){return this.props.analysis.getNetAmount()}
		else {return this.props.analysis.getLeftOver()}
	}
	getSubtext(){
		if(this.isSavings() && !this.isInterest()){
			if(this.props.analysis.getExpectedAtMaturity()>=0){//expect to unsave savings
				return (this.props.analysis.getLeftOver()>0)?"over":"left"
			}else{return "saved"}
		}else if(this.isIncome()){
			return "received"
		}else if(this.props.analysis.getLeftOver()==0 && this.props.analysis.getExpected()!=0){return "paid"}
		else{return this.isAlert()?"over":"left"}
	}
	getFrequencyText(){
		return "ETA"
	}
	render(){
		return <FlexColumn style={{justifyContent: "center"}} onMouseOver={this.onMouseOver} onMouseOut={this.onMouseOut}>
			<div style={{width:"90%"}}>
				<TimeAndMoneyProgressView hovering={this.state.hovering} analysis={this.props.analysis}/>
			</div>
			<FlexColumn style={{position:"absolute",justifyContent: "center"}}>
				<div style={{color:this.getMainColor(),fontSize:"1.3rem",fontFamily:"Barlow",marginBottom:"0.2rem"}}>{
					isNaN(this.getPrimaryValue())?utils.formatCurrencyAmount(0,0,undefined,undefined,Core.getPreferredCurrency()):
					<AnimatedNumber value={this.getPrimaryValue()} formatValue={x => format(x,true,!(!this.isSavings() && this.isIncome() || this.isSavings() && (this.props.analysis.getExpectedAtMaturity()<0 || this.isInterest())))}/>
				}</div>
				<div style={{color:this.getMainColor(),fontSize:"0.8rem"}}>{this.getSubtext()}</div>
			</FlexColumn>
		</FlexColumn>
	}
}


//Represents a transaction feed across the observation
export class StreamAnalysisTransactionFeedView extends GenericStreamAnalysisView{
	constructor(props){
		super(props)
		this.state = {expectationEditPopupInputValue:undefined}
		this.handleClickOnTransaction = this.handleClickOnTransaction.bind(this)
		this.changeExpectationAmount = this.changeExpectationAmount.bind(this)
		this.changeExpectationPosition = this.changeExpectationPosition.bind(this)
		this.deleteExpectation = this.deleteExpectation.bind(this)
	}
	handleClickOnTransaction(txn){
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
				this.props.onCategorizationUpdate(txnToUpdate,allocs)
			}
		}).catch(e => {})
	}

	changeExpectationAmount(newAmount,expChange){
		this.props.analysis.stream.updateExistingExpChange(expChange.startDate,undefined,newAmount)
		return this.save()
	}
	changeExpectationPosition(delta,reportBefore,expChange){//Responsible to move an expectation change in a stream up or down 1 period
		let rds = this.props.analysis.getPeriodReports().sort(utils.sorters.asc(r => r.reportingDate)).map(r => r.reportingStartDate)//get the reporting dates in order
		let idx = rds.indexOf(reportBefore.reportingStartDate)//find the delta this expectation change currently is in
		this.props.analysis.stream.updateExistingExpChange(expChange.startDate,new Date(
			rds[idx+delta].getTime()-rds[idx].getTime()+expChange.startDate.getTime()))
		return this.save()
	}
	deleteExpectation(expChange){
		if(this.props.analysis.stream.expAmountHistory.length<=1){throw new Error("trying to delete the last amount expectation of stream: "+this.props.analysis.stream.name)}
			console.log("delete ", expChange)
		this.props.analysis.stream.removeExpChange(expChange.startDate)
		return this.save()
	}
	
	save(){return Promise.all([this.props.onMinigraphUpdateRequested(),this.updateState({refresh: new Date()}),Core.saveStreams()])}


	render(){
		let prevExp = 0;
		let expChanges = this.props.analysis.stream.expAmountHistory.sort(utils.sorters.asc(e => e.startDate)).map(h => {
			let res = {startDate:h.startDate,newAmount:h.amount,previousAmount:prevExp,origin:h}
			prevExp = h.amount;
			return res;
		})
		let elements = utils.flatten(this.props.analysis.getPeriodReports().sort(utils.sorters.desc(r => r.reportingDate)).map((r,i) => ([
			<PeriodReportTransactionFeedView key={1000*(1+i)} analysis={r} stream={this.props.analysis.stream} handleClickOnTransaction={(e) => this.handleClickOnTransaction(e)}/>,
			...expChanges?.sort(utils.sorters.desc(r => r.startDate)).filter(h => h.startDate >= r.reportingStartDate && h.startDate < r.reportingDate)
				.map((h,k) => <ExpectationChangePannel key={100*(i+1)+k} expChangeData={h} report={r} analysis={this.props.analysis} onRequestChangeAmount={(newAmount) => this.changeExpectationAmount(newAmount,h.origin)} onRequestChangePosition={(delta) => this.changeExpectationPosition(delta,r,h.origin)}
					onRequestToRemove={() => this.deleteExpectation(h.origin)}/>
				),
		])))
		return (<FlipMove style={{width: "100%"}}>{elements}</FlipMove>)
	}
}

class ExpectationChangePannel extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {hovering:false}
		this.onHoverOnExpectationPanel = this.onHoverOnExpectationPanel.bind(this)
		this.onLeaveHoverOnExpecationPanel = this.onLeaveHoverOnExpecationPanel.bind(this)
		this.onClickMoreInExpectationPanel = this.onClickMoreInExpectationPanel.bind(this)
	}

	isOldest(){return this.props.analysis.stream.getOldestDate().getTime()==this.props.expChangeData.startDate.getTime()}
	onHoverOnExpectationPanel(){
		if(!this.state.shouldShowExpectationPannelToolTip){
			this.updateState({shouldShowExpectationPannelToolTip:true})
		}
	}
	onLeaveHoverOnExpecationPanel(){
		if(this.state.shouldShowExpectationPannelToolTip && !this.state.stayExpanded){
			this.updateState({shouldShowExpectationPannelToolTip:false})
		}
	}
	shouldBeAllowedToMoveUp(){
		if(!this.isOldest()){return this.props.report.reportingDate.getTime() < new Date().getTime()}
		else{
			let expStart = this.props.expChangeData.startDate.getTime()
			console.log(this.props.analysis.transactions)
			let oldestTransactionDate = this.props.analysis.transactions.sort(utils.sorters.asc(t => t.getDisplayDate()))[0]?.getDisplayDate().getTime()
			return this.props.report.reportingDate.getTime() < new Date().getTime() && (!oldestTransactionDate || 
					(oldestTransactionDate > expStart + (this.props.report.reportingDate.getTime()-this.props.report.reportingStartDate.getTime()))) /*since reportingStartDate and reportingDate of the next report match, this calculation is equivalent to the jump calculated when moving up*/
		}
	}
	onClickMoreInExpectationPanel(targetRef){
		this.updateState({stayExpanded:true})
		let options = [
			{
				name:"Move up",
				enable: this.shouldBeAllowedToMoveUp(), 
				onSelect:() => this.props.onRequestChangePosition(1)
			},{
				name:"Edit",
				enable: true,
				onSelect:() => Core.presentModal(ModalTemplates.ModalWithComponent("Edit expected amount",
					<EditExpectationModalView stream={this.props.analysis.stream} expChange={this.props.expChangeData}/>)).then(({state,buttonIndex}) => {
					if(buttonIndex==1){//primary button
						return this.props.onRequestChangeAmount(state.expectationEditPopupInputValue)
					}else{return Promise.resolve()}
				}).catch(e => {})
			},{
				name:"Move down",
				enable: true,
				onSelect:() => this.props.onRequestChangePosition(-1)
			},{
				name: "Remove",
				enable: !this.isOldest(),
				onSelect: () => Core.presentModal(ModalTemplates.ModalWithComponent("Are you sure?",<DS.component.SentenceWrapper>Remove this change in expected amount to{format(this.props.expChangeData.newAmount)}starting from {this.props.expChangeData.startDate.toLocaleDateString()}?</DS.component.SentenceWrapper>)).then(({state,buttonIndex}) => {
					if(buttonIndex==1){//primary button
						return this.props.onRequestToRemove()//TODO
					}else{return Promise.resolve()}
				}).catch(e => {})
			}
		];
		Core.presentContextualMenu(options,o => o.name,targetRef.current,o => o.enable).then(({state,buttonIndex}) => {
			options[buttonIndex].onSelect().then(() => {this.updateState({stayExpanded:false,shouldShowExpectationPannelToolTip:false})})
		}).catch(e => {this.updateState({stayExpanded:false,shouldShowExpectationPannelToolTip:false})})
	}
	getText(){
		return (this.isOldest()?"Expecting ":utils.formatCurrencyAmount(this.props.expChangeData.previousAmount,0,true,undefined,Core.getPreferredCurrency())+" → ")+utils.formatCurrencyAmount(this.props.expChangeData.newAmount,0,true,undefined,Core.getPreferredCurrency())
	}

	render(){
		return (<ExpectationChangePannelContainer onMouseOver={this.onHoverOnExpectationPanel} onMouseLeave={this.onLeaveHoverOnExpecationPanel}>
			<div>{this.getText()}</div>
			<div style={{marginTop:"0.2rem"}}>per {Period[this.props.analysis.stream.period].unitName}</div>
			<ExpectationChangePanelMoreRow style={{height:this.state.shouldShowExpectationPannelToolTip?"1rem":0}}>
				{(() => {let ref = React.createRef();return (<div ref={ref}>
					<DS.component.Button.Icon iconName="more" onClick={() => this.onClickMoreInExpectationPanel(ref)}/>
				</div>)})()}
			</ExpectationChangePanelMoreRow>
		</ExpectationChangePannelContainer>)
	}
} 

const ExpectationChangePanelMoreRow = styled.div`
	display: flex;
	flex-direction: row;
	justify-content: flex-end;
	/*margin-bottom: ${props => -DS.spacing.xxs}rem;*/
	transition: height 0.2s;
	overflow: hidden;
`

const ExpectationChangePannelContainer = styled.div`
	font-size: 0.7rem;
    padding: 0.7rem 0.5rem;
    margin: 0.7rem 0;
    background: ${DS.getStyle().warning+"55"};
    border-radius: ${DS.borderRadiusSmall};
    color: ${DS.getStyle().bodyText};
`

export class EditExpectationModalView extends BaseComponent{
	constructor(props){
		super(props)
		this.updateNewValue(this.props.expChange.newAmount)
	}
	onChangedExpectationAmount(e){this.updateNewValue(parseFloat(e.target.value))}
	updateNewValue(a){
		this.props.controller.state.modalContentState = {...this.props.controller.state.modalContentState,expectationEditPopupInputValue: a}
		this.validate()
	}
	validate(){this.props.controller.setPrimaryButtonDisabled(//the input value should be a number
		isNaN(this.props.controller.state.modalContentState.expectationEditPopupInputValue)
	)}
	render(){return(
		<DS.component.SentenceWrapper>Starting on{this.props.expChange.startDate.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})}, the expected amount for<DS.component.StreamTag noHover highlight>{this.props.stream.name}</DS.component.StreamTag> should change from {utils.formatCurrencyAmount(this.props.expChange.previousAmount,undefined,undefined,undefined,Core.getPreferredCurrency())} to <DS.component.Input type="number" textAlign="left" defaultValue={this.props.expChange.newAmount} autoSize inline onChange={this.onChangedExpectationAmount.bind(this)}/>.
		</DS.component.SentenceWrapper>)
	}
}




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
					<div style={{color:this.getMainColor()}}>{utils.formatCurrencyAmount(this.getAggregateAmount(),2,undefined,undefined,Core.getPreferredCurrency())}</div>
				</TransactionFeedHeaderViewContainer>
				{this.props.analysis.transactions.sort(utils.sorters.desc(t => t.getDisplayDate())).map((t,i) => (<MiniTransactionContainer onClick={(e)=> this.props.handleClickOnTransaction(t)} key={i}>
					<EllipsisText style={{fontSize:"0.7rem",width: "60%"}}>{t.description}</EllipsisText>
					<div style={{fontSize:"0.7rem",display:"block"}}>{utils.formatCurrencyAmount(t.streamAllocation.filter(a => a.streamId==this.props.stream.id)[0]?.amount,undefined,undefined,undefined,Core.getPreferredCurrency())}</div>
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
	border-color: ${props => DS.getStyle().bodyTextSecondary};
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
		this.isSavings = o.isSavings
		this.projected = this.getEOYProjection(o.toDate) //why do this rather than a method? to avoid having to recalculate it everytime
	}
	accessor(r){return this.toDate[r.index]?.y}
	getEOYProjection(yArray){return yArray.length > this.chartContext.timeAxisBoundIndex?yArray[this.chartContext.timeAxisBoundIndex]:this.getTrend(yArray).slice(-1)[0]?.y}
	getTimeSeries(series){return series.slice(0,this.chartContext.timeAxisBoundIndex+1).map((y,i) => {return {x:this.chartContext.xAccessor(this.chartContext.timeAxis[i]), y:y}})}
	getTrend(yArray){
		let fitIndex = yArray.length-1, {slope,yIntercept} = Statistics.trendLine([...[0],...yArray].map((y,i)=> {return {x: this.chartContext.timeAxis[i]?.getTime(), y:y}}))
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
		return stream.getAnnotationsAtDate(this.props.date).filter(an => ((stream.isTerminal() && stream.id==an.streamId) || stream.hasTerminalChild(an.streamId)))
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
	onEdit(a){
		let stream = Core.getStreamById(a.streamId);
		this.updateState({editMode:true,editStream:stream,editedAnnotationDate:a.date,inputValue:this.getAnnotations(stream)[0]?.body||"",previousInputValue:((this.getAnnotations(stream)[0]?.body)||"")})
	}
	onConfirm(e,s){
		AnnotationInput.SaveAnnotation(this.state.editStream,this.state.editedAnnotationDate || this.props.date,this.state.inputValue)
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
				{(this.state.inputValue!=this.state.previousInputValue)?<div onClick={(e) => this.onConfirm(e,this.state.editStream)} style={{"position":"absolute",cursor:"pointer","top":"1.5rem","right":"1.5rem","background":DS.getStyle().modalBackground}}>
					{DS.icon.done}</div>:""}
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
			chartHeight: Core.isMobile()?200:170, 
			chartWidth: 450,
			chartPadding: {top:Core.isMobile()?60:20,bottom:Core.isMobile()?20:10,left:10,right:Core.isMobile()?120:60},
			midgroundOpacity: 0.5, 									//opacity of middle ground items (trends and projections)
			backgroundOpacity: DS.backgroundOpacity, 				//opacity of background items (area charts)
			fontSizeTitle:Core.isMobile()?40:20,										//Chart title
			fontSizeHeader:Core.isMobile()?28:14,										//Big numbers
			fontSizeBody:Core.isMobile()?14:7,											//Everthing else
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
			<div style={{marginBottom:DS.spacing[Core.isMobile()?"s":"l"]+"rem"}}>
			<AnnotationInput	controller={ModalManager.currentModalController} viewMode={true} shouldDismiss={() => ModalManager.currentModalController.hide()}
								stream={this.props.analysis.stream} date={this.getReportForDate(date).reportingDate} period={p}/></div>,[],this.getFormattedDate(date,p.name))(that)).catch(e => {})

	}
	getAnnotationsAtDate(d){return this.props.analysis?.stream?.getAnnotationsAtDate(this.getReportForDate(d).reportingDate) || []}
	getData(){if(!!this.data){return this.data} else {return [{x:0,y:0}]}}//to override - data getter

	//domain definitions
	getReportSchedule(){return []}
	dateToTickDate(d){return (new Date(d)).setDate(1)}
	getDomainBounds(){return {//must override
		mx:this.dateToTickDate(this.timeAxis[0]),
		Mx:this.dateToTickDate(this.timeAxis[this.timeAxis.length-1]),
		my:-100,
		My:100
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
	getReportForDate(date){return {reportingDate:this.getReportSchedule().filter(d => date<=d)[0],
		reportingStartDate: this.getReportSchedule().filter(d => d<date).slice(-1)[0]}}

	//render to override
	render(){return (<V.VictoryChart events={{onClick:(d,e) => this.handleClick(this.hoverData)}} scale={{ x: "time", y:"linear" }} domain={this.getDomain()} height={this.style.chartHeight} width={this.style.chartWidth} padding={this.style.chartPadding} containerComponent={<V.VictoryVoronoiContainer onActivated={this.onFlyOver} onDeactivated={this.onFlyOut} activateData={true} voronoiDimension="x" labels={(d) => " "}/>}/>)}
}


//component to display an end of period projection summary
export class EndOfPeriodProjectionGraph extends GenericChartView{
	constructor(props){
		super(props)
		this.style = {...this.style,
			chartBarWidth:Core.isMobile()?8:4, 										//bar width for the bar chart
			summaryBarOffset: -timeIntervals.oneDay*(Core.isMobile()?-6:3),				//placement of the bar in x-domain coordinates
			summaryBarLabelXOffset: Core.isMobile()?21:7, 								//horizontal space between the bar and the labels
			summaryBarLabelYOffset: 0,								//not implemented
			statLabelSpacing:1, 									//space between text for projected savings/expenses and percentage
			scatterDotSize: Core.isMobile()?4:2,
			annotationTooltipHitRadius: Core.isMobile()?30:15,
			secondaryLabelsOffset: Core.isMobile()?100:0,
			chartYScaleFactor: Core.isMobile()?1.1:1,
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
		let savingsAnalysis = this.props.savingsAnalysis.getPeriodAggregates() 	||[]
		let expenseAnalysis = this.props.expenseAnalysis.getPeriodAggregates() 	||[]
		let incomeAnalysis = this.props.incomeAnalysis.getPeriodAggregates() 	||[]
		let chartContext = {timeAxis: this.timeAxis,timeAxisBoundIndex: this.timeAxisBoundIndex, xAccessor:this.dateToTickDate}
		const addToSave = (r1,r2) => {r1.stats.savedToDate = r1.stats.savedToDate+ r2.stats.savedToDate; return r1}
		let res = {
			plotList: [
				new SeriesDescriptor({ name:"savings", chartContext:chartContext,
					config:{render:true,color:DS.getStyle().savings,barStrings: {toDate:"Saved to date",value:"Saved",projected:"Annual savings"}},
					target: this.timeAxis.map((d,i) => utils.sum(this.timeAxis.slice(0,i).map((dd,j) => -this.props.savingsAnalysis.getExpectedAmountAtDateForPeriod(Period.monthly.nextDate(dd),Period.monthly)))),
					toDate: savingsAnalysis.map((r,i) => r.stats.savedToDate + incomeAnalysis[i].stats.savedToDate),
					isSavings: true
				}),
				new SeriesDescriptor({ name:"expenses", chartContext:chartContext,
					config:{render:true,color:DS.getStyle().expenses,barStrings: {toDate:"Spent to date",value:"Spent",projected:"Annual expenses"}},
					target: this.timeAxis.map((d,i) => utils.sum(this.timeAxis.slice(0,i).map((dd,j) => this.props.expenseAnalysis.getExpectedAmountAtDateForPeriod(Period.monthly.nextDate(dd),Period.monthly)))),
					toDate: expenseAnalysis.map(r => r.stats.netToDate)
				}),
				new SeriesDescriptor({ name:"income", chartContext:chartContext,
					config:{render:false,noTarget:true,noBar:true,color:DS.getStyle().warning,barStrings: {toDate:"Earnt to date",value:"Earnt",projected:"Annual income"},barOffset: {dx:-this.style.summaryBarLabelXOffset,dy:0}},
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
		console.log(res)
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
 		return utils.flatten(ans.map(ana => utils.flatten(ana.analyses?.map(a => a.stream.getAnnotationsAtDate(this.getReportForDate(date).reportingDate)))))
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
		let acc = (g,f) =>  g(this.getData().plotList.filter(o=>o.config.render).map(p => f(p.target[p.target.length-1]?.y,p.projected)))
		return {...super.getDomainBounds(),
			my:this.style.chartYScaleFactor*acc(utils.min,Math.min),
			My:this.style.chartYScaleFactor*acc(utils.max,Math.max)
		}
	}

	//render functions
	renderScatterLine(series){
		return(<V.VictoryChart>
			<V.VictoryAxis style={{axis:{opacity:0}}} tickFormat={() => ''}/>
			<V.VictoryLine 		data={series.getTrend(series.toDate.map(p => p.y))} style={{data:{stroke:series.config.color,strokeWidth:0.9,opacity:this.style.midgroundOpacity,strokeDasharray: "1, 2"}}}/>
			<V.VictoryLine 		name={series.name+"Line"} data={series.toDate} style={{data:{stroke:series.config.color,strokeWidth:Core.isMobile()?3:1}}}/>
			<V.VictoryScatter 	name={series.name+"Dots"} data={series.toDate} size={this.style.scatterDotSize} style={{data: {fill: ({datum})=>this.getAnnotationsAtDate(datum.x,{expenses: series.name=="expenses",savings: series.name=="savings", income: series.name =="savings"}).length?"url(#"+(series.name=="expenses"?"alertHighlight":"savingsHighlight")+")":series.config.color}}}/>
		</V.VictoryChart>)
	}
	renderDynamicBarWithLabels(series){
		let c = series.config.color, b = this.style.fontSizeBody, h = this.style.fontSizeHeader, s = this.style.statLabelSpacing, labelHeight = 2*b+h+2*s , sign = Math.abs(series.projected)/series.projected
		let x0 = (this.timeAxis[this.timeAxisBoundIndex]?.getTime())+this.style.summaryBarOffset 						//base x value to draw the chart from
		let formatPercent = (x) => Math.round(100*x)+"%"
		let savingExpenseSum = (accessor) => accessor(this.getDataByName("savings"))-(accessor(this.getDataByName("expenses")))
		let getYValue = (fr,ser) =>  (fr?ser.accessor(fr):series.projected)
		let getPosition = (fr,ser) => {let sign = series.projected>=0?1:-1; return {
			x: x0,
			y: sign*Math.max(sign*getYValue(fr,ser),this.svgToDomain(0,0).dy - this.svgToDomain(0,labelHeight+0.75*b).dy)
		}}
		let labelMutator = (valueAccessor) => (fr)=> {return {"datum": getPosition(fr,series),"text": valueAccessor(fr)}}	
		let getTitle = (fr,ser) => ser.config.barStrings[fr?"toDate":"projected"]	
		let	getValue = (fr,ser) => {return utils.formatCurrencyAmount((!ser.isSavings?-1:1)*(fr?ser.accessor(fr):series.projected),0,false,undefined,Core.getPreferredCurrency())}		//bar $$ value
		let	getRatio = (fr,ser) => formatPercent(((!ser.isSavings?-1:1)*(fr?ser.accessor(fr):ser.projected))/savingExpenseSum(r => fr?r.accessor(fr):r.projected))
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
		const getSavedInPeriod = (fr) => {return (fr && this.hovering)?"Saved "+utils.formatCurrencyAmount(getIncrement("savings",fr),0,false,undefined,Core.getPreferredCurrency()):""}
		const getExpensesInPeriod = (fr) => {return (fr && this.hovering)?"Spent "+utils.formatCurrencyAmount(-getIncrement("expenses",fr),0,false,undefined,Core.getPreferredCurrency()):""}
		let labelHeight = 3*this.style.fontSizeBody+14*this.style.statLabelSpacing+2*this.style.secondaryLabelsOffset;
		let shouldShowTitleBottom = Math.abs(this.getDomainBounds().My/(this.getDomainBounds().My-this.getDomainBounds().my))<0.5

		return (<SharedPropsWrapper datum={{x:this.dateToTickDate(this.timeAxis[0]),y:(shouldShowTitleBottom?(this.getDomainBounds().my-this.svgToDomain(0,labelHeight).dy*(Core.isMobile()?0.1:1)):this.getDomainBounds().My*(Core.isMobile()?1.5:1))}}>
        	<FocusReportWrapper defaultReport={this.getDefaultReport()} ref={this.registerListener()} mutations={(fr)=> {return {"text":getTitle(fr)
			}}}><V.VictoryLabel style={{fontSize:this.style.fontSizeTitle,fontFamily:"Inter",fill: DS.getStyle().bodyText}}/></FocusReportWrapper>
			<FocusReportWrapper defaultReport={this.getDefaultReport()} dy={this.style.fontSizeTitle*0.8+this.style.statLabelSpacing} ref={this.registerListener()} mutations={(fr)=> {return {"text":getTimePeriodString(fr)}}}><V.VictoryLabel style={{fontSize:this.style.fontSizeBody,fontFamily:"Inter",fill: DS.getStyle().bodyText}}/></FocusReportWrapper>
			<FocusReportWrapper defaultReport={this.getDefaultReport()} dy={this.style.fontSizeTitle*0.8+1*this.style.fontSizeBody+6*this.style.statLabelSpacing+this.style.secondaryLabelsOffset} ref={this.registerListener()} mutations={(fr)=> {return {"text":getExpensesInPeriod(fr)}}}><V.VictoryLabel style={{fontSize:this.style.fontSizeBody,fontFamily:"Inter",fill: DS.getStyle().bodyTextSecondary}}/></FocusReportWrapper>
			<FocusReportWrapper defaultReport={this.getDefaultReport()} dy={this.style.fontSizeTitle*0.8+2*this.style.fontSizeBody+8*this.style.statLabelSpacing+this.style.secondaryLabelsOffset} ref={this.registerListener()} mutations={(fr)=> {return {"text":getSavedInPeriod(fr)}}}><V.VictoryLabel style={{fontSize:this.style.fontSizeBody,fontFamily:"Inter",fill: DS.getStyle().bodyTextSecondary}}/></FocusReportWrapper>
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

		return (<DS.component.ContentTile 
			style={{position:"relative",width:"calc(100% - 2rem)",height:"100%",margin:0,padding:"1rem",marginBottom:DS.verticalSpacing[Core.isMobile()?"s":"l"]}}>
			<div style={{position:"relative",width:"100%",height:"100%"}}>
		       	<svg style={{position:"absolute",width:0}}><defs>
			        <radialGradient id="alertHighlight">
			            <stop offset="30%" stopColor={DS.UIColors.white}/>
			            <stop offset="70%" stopColor={DS.getStyle().alert}/>
			        </radialGradient>
			        <radialGradient id="savingsHighlight">
			            <stop offset="30%" stopColor={DS.UIColors.white}/>
			            <stop offset="70%" stopColor={DS.getStyle().savings}/>
			        </radialGradient>
				</defs></svg>
		        <V.VictoryChart height={this.style.chartHeight}  width={this.style.chartWidth} padding={this.style.chartPadding} scale={{ x: "time", y:"linear" }} domain={{x:[this.getDomainBounds().mx,this.getDomainBounds().Mx],y:[this.getDomainBounds().my,this.getDomainBounds().My]}} 
		        	containerComponent={<CustomVoronoiContainer sensibilityRadius={this.style.annotationTooltipHitRadius} chartContext={this} onDataPointHovered={this.onDataPointHovered} onDataPointExit={() => this.onDataPointHovered(undefined)} voronoiBlacklist={["expensesArea","savingsLine","expensesLine"]} activateData={false} onActivated={this.onFlyOver} onDeactivated={this.onFlyOut} voronoiDimension="x" style={{touchAction:"auto"}}
		        	labelComponent={<FocusLineToolTip yOffset={this.style.scatterDotSize} data={this.getData()} maxX={this.domainToSvg(this.dateToTickDate(this.timeAxis[this.timeAxisBoundIndex])).dx} domainToSvgY={y => this.domainToSvg(0,y).dy} minY={this.getDataByName("expenses").projected} maxY={this.getDataByName("savings").projected}/>} 
		        	labels={(d) => " "}/>}>
		          <V.VictoryAxis tickCount={this.getData().reportSchedule.length-1}  
		          	tickComponent={<BoundedTick maxX={this.timeAxis[this.timeAxisBoundIndex]}/>} 
		          	tickFormat={(t) => (t>this.timeAxis[this.timeAxisBoundIndex])?"":`${t.toLocaleString('en-US', {month: Core.isMobile()?'narrow':'short'}).toUpperCase()}`} 
		          	style={{
		          		ticks: {stroke: DS.getStyle().bodyTextSecondary, size: 0, strokeWidth:Core.isMobile()?4:3.5, strokeLinecap:"round"},
		          		tickLabels: {padding:Core.isMobile()?-20:-10,fill:DS.getStyle().bodyTextSecondary,fontSize: this.style.fontSizeBody,fontFamily:"Inter",fontWeight:500},
		          		axis:{"stroke":DS.getStyle().bodyTextSecondary,strokeWidth:0}
		          	}} />
		        	
		        	{this.renderChartTitle() /*Period Title*/}
		           	{this.getData().plotList.filter(series => series.config.render).sort(utils.sorters.asc(s => s.projected)).map((series,i) => ([
		           		(series.config?.noTarget)?<g></g>:<V.VictoryArea name={series.name+"Area"} 	/*Areas plot*/
		           			data={series.target} style={{data:{fill:series.config.color,opacity:this.style.backgroundOpacity}}}/>,	
		           		this.renderScatterLine(series),												/*Scatter lines & trends*/
						(series.config?.noBar)?<g></g>:this.renderDynamicBarWithLabels(series)		/*Bar projections*/
		           	]))}
		        </V.VictoryChart>
		        {this.renderToolTip()}
	        </div>
		</DS.component.ContentTile>)
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
		return (<div>{content.map((a,i) => <div style={{display: "flex",flexDirection: "column",alignContent: "flex-start",alignItems: "flex-start",fontSize:DS.fontSize.little+"rem"}} key={i}> 
			<div style={{height:options?.disableTitle?0:"auto","display":"flex","alignItems":"baseline","flexDirection":"row","justifyContent":"space-between","width":"100%"}}>
				{options?.disableTitle?<div></div>:<div style={{fontWeight:900,marginTop: "0.4rem",marginBottom:"0.2rem"}}>{Core.getStreamById(a.streamId).name}</div>}
				{options?.enableEditOption? <StyledLink style={{marginTop:options?.disableTitle?"0.2rem":0}} onClick={() => options.onEdit(a)}>edit</StyledLink>:""}
			</div>
			{a.body.split('\n').map((a,i) => <div key={i} style={{display:"flex",flexDirection: "row",justifyContent: "flexStart",marginBottom:"0.2rem",marginRight:options?.enableEditOption?"3rem":0}}>
				<div style={{margin: "0 0.4rem"}}>•</div>
				<div style={{textAlign: "start"}}>{a}</div>
			</div>)}
		</div>)}</div>)
	} 
	render(){
		return (<DS.component.Tooltip showAbove={this.props.showAbove} shouldOverrideOverflow={this.props.shouldOverrideOverflow}
			x={this.props.scale.x(this.props.datum.dx)*this.props.containerSVGWidth} 
			y={this.props.scale.y(this.props.datum.dy)*this.props.containerSVGHeight}>
			
			<div style={{	fontVariant:"all-petite-caps",
							color:DS.getStyle().bodyText,
							marginBottom:"0.3rem",
							marginTop:"-0.4rem",
							fontSize:"1rem",
							width:"100%",
							textAlign:"center",
							paddingBottom: "0.5rem",
							borderBottom: "1px solid "+DS.getStyle().borderColor
			}}>{this.props.reportDate}</div>
			{AnnotationTooltip.RenderContent(this.props.content)}
		</DS.component.Tooltip>)
	}
}

class ConditionalToolTip extends BaseComponent{
	render(){
		return (this.props.shouldShow()?<AnnotationTooltip shouldOverrideOverflow={this.props.shouldOverrideOverflow} containerSVGWidth={this.props.svgClientSize().width} containerSVGHeight={this.props.svgClientSize().height} 
			showAbove={this.props.showAbove()} scale={this.props.scale} reportDate={this.props.getReportDate()} 
     		datum={this.props.getDatum()} content={this.props.getContent()}/>:<div></div>)
	}
}

