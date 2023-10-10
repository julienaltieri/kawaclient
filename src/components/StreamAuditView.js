import React from "react"
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import Core from '../core.js';
import {GenericTransaction} from '../model';
import dateformat from "dateformat";
import memoize from "memoize-one";
import AnimatedNumber from "animated-number-react";
import DesignSystem from '../DesignSystem.js'
import {getStreamAnalysis,getMultiStreamAnalysis} from '../processors/ReportingCore.js';
import {TimeAndMoneyProgressView,TerminalStreamCurrentReportPeriodView,EndOfPeriodProjectionSummary,EndOfPeriodProjectionGraph} from './AnalysisView'
import {StreamObservationPeriodView} from './StreamObservationPeriodAnalysisView'
import {format} from './AnalysisView'
import MiniGraph from './MiniGraph'
import ProgressRing from './ProgressRing';
import {Period,createDate} from '../Time'
import utils from '../utils'


const reportingConfig = {
	startingDay: 21,
	startingMonth: 12, //december = 12
	observationPeriod: Period.yearly, //this should be longer or equal to the longest stream's period, otherwise it doesn't make sense.
}
if(reportingConfig.startingDay<1 || reportingConfig.startingDay>28 || reportingConfig.startingMonth>12 || reportingConfig.startingMonth<1){
	throw new Error(`Selected reporting date has invalid parameters. Month: ${reportingConfig.startingMonth} Day: ${reportingConfig.startingDay}. Reporting month must be between 1 and 12 and day must be between 1 and 28`)
}
const analysisRootDate = createDate(new Date().getFullYear()-1,reportingConfig.startingMonth-1,reportingConfig.startingDay);//analysis starting date is Dec 21 GMT
let analysisDate = reportingConfig.observationPeriod.nextDateFromNow(analysisRootDate);

//if we're in the first period of the observation period, show the graph from the previous period
let previousAnalysisDate = reportingConfig.observationPeriod.previousDate(analysisDate);
let shouldShowContextForObservationPeriodTransition = () => ((new Date() - previousAnalysisDate)< 2*reportingConfig.observationPeriod.subdivision.getTimeIntervalFromDate(previousAnalysisDate))


const mAnalyze = memoize((s,txns,observationPeriod,subReportingPeriod) => getStreamAnalysis(analysisDate,s,txns,observationPeriod,subReportingPeriod))

var count = 0;
//generic component
export class StreamAuditView extends BaseComponent{
	getTransactionsForStream(s){return this.props.auditedTransactions.filter(t => t.categorized && t.isAllocatedToStream(s))}
	getStreamAnalysis(subReportingPeriod){return mAnalyze(this.props.stream,this.props.auditedTransactions,!shouldShowContextForObservationPeriodTransition()?reportingConfig.observationPeriod:Period.biyearly,subReportingPeriod)} 
	render(){return (<div>I'm a generic StreamAuditView</div>)}
}



//master audit view
class MasterAuditView extends StreamAuditView{
	render(){
		return (<AuditViewContainer>
			<MasterStreamAuditView stream={Core.getMasterStream()} key={0} auditedTransactions={this.props.auditedTransactions.filter(t => t.categorized)}/>
			{Core.getMasterStream().children.map((s,i) => {
				return <MacroCompoundStreamAuditView stream={s} key={i+1} auditedTransactions={this.getTransactionsForStream(s)}
	 				onCategorizationUpdate={this.props.onCategorizationUpdate}
	 				onRequestedToUncategorize={this.props.onRequestedToUncategorize} 
		 		/>})}
		</AuditViewContainer>)
	}
}
export default React.memo(MasterAuditView)

//Level 0: High-level view of the entire portfolio and projections across the observation period 
class MasterStreamAuditView extends StreamAuditView{
	getAnalysisForStreams(ss){
		return getMultiStreamAnalysis(analysisDate,ss,this.props.auditedTransactions,!shouldShowContextForObservationPeriodTransition()?reportingConfig.observationPeriod:Period.biyearly,reportingConfig.observationPeriod.subdivision)
	}
	render(){return (<div>
		<EndOfPeriodProjectionGraph  	
			incomeAnalysis = {this.getAnalysisForStreams(this.props.stream.children.filter(s => s.getExpectedAmountAtDate(this.getStreamAnalysis().getCurrentPeriodReport().reportingStartDate)>0 && !s.isSavings))}
			expenseAnalysis= {this.getAnalysisForStreams(this.props.stream.children.filter(s => s.getExpectedAmountAtDate(this.getStreamAnalysis().getCurrentPeriodReport().reportingStartDate)<0 && !s.isSavings))}
			savingsAnalysis= {this.getAnalysisForStreams(this.props.stream.children.filter(s => s.isSavings))}
		/></div>)
	}
}


//Level 1: macro category (income, savings, recurring expense, annual expense)
class MacroCompoundStreamAuditView extends StreamAuditView{
	render(){
		return (<TopLevelStreamAuditViewContainer>
			<TopLevelHeaderContainer>
				<StreamGroupHeaderTitle>{this.props.stream.name}</StreamGroupHeaderTitle>
				<MiniGraph analysis={this.getStreamAnalysis(Period.monthly)} stream={this.props.stream}/>
			</TopLevelHeaderContainer>
			<StreamAuditCellContainer>
				{this.props.stream.getDepth()==1?
					<RowLayout>
						{this.props.stream.children.filter(c => c.isActiveAtDate(this.getStreamAnalysis().getCurrentPeriodReport().reportingStartDate)).sort(utils.sorters.asc(c => c.name.charCodeAt())).map((s,i) => <TerminalStreamCard 
							auditedTransactions={this.getTransactionsForStream(s)}
							analysis={this.getStreamAnalysis().getCurrentPeriodReport()} stream={s} key={i}
							onRequestedToUncategorize={this.props.onRequestedToUncategorize} 
							onCategorizationUpdate={this.props.onCategorizationUpdate}
						/>)}
					</RowLayout>:
					<ColumnLayout>
						{this.props.stream.children.filter(c => c.isActiveAtDate(this.getStreamAnalysis().getCurrentPeriodReport().reportingStartDate)).sort(utils.sorters.asc(c => c.name.charCodeAt())).map((s,i) => <CompoundStreamAuditView 
							auditedTransactions={this.getTransactionsForStream(s)}
							title={s.name} analysis={this.getStreamAnalysis().getCurrentPeriodReport()} stream={s} key={i}
							onRequestedToUncategorize={this.props.onRequestedToUncategorize} 
							onCategorizationUpdate={this.props.onCategorizationUpdate}
						/>)}
					</ColumnLayout>
				}
			</StreamAuditCellContainer>
		</TopLevelStreamAuditViewContainer>)
	}
}

//Level 2: component for category aggregate containing multiple terminal streams
class CompoundStreamAuditView extends StreamAuditView{
	render(){
		/*if(this.props.stream.name == "Food"){console.log(this.getStreamAnalysis(Period.monthly))}*/
 		return (<CompountStreamAuditViewContainer >
 			<StreamGroupHeader>
 				<div style={{width:"3rem",marginLeft:"1rem"}}>
					<TimeAndMoneyProgressView analysis={this.getStreamAnalysis().getCurrentPeriodReport()} viewConfig={{timeThickness:0.4,moneyThickness:1.3,moneyRadius:45,subdivGapAngles:0.0001}}/>
 				</div>
 				<div style={{padding:"1rem",flexGrow: 1}}>
 					<StreamGroupHeaderTitle>{this.props.stream.name}</StreamGroupHeaderTitle>
 					<div>{utils.formatCurrencyAmount(this.props.stream.getExpectedAmountAtDate(this.getStreamAnalysis().getCurrentPeriodReport().reportingStartDate),0,true,null,Core.getPreferredCurrency())} per {Period[this.props.stream.period].unitName}</div>
 				</div>
 				<MiniGraph analysis={this.getStreamAnalysis(Period.monthly)} stream={this.props.stream}/>
 			</StreamGroupHeader>
 			<RowLayout>
 				<RowLayout>
 				{this.props.stream.children?.filter(c =>{
 					//if(c.name=="Dental Mr"){console.log(c, this.getStreamAnalysis().getCurrentPeriodReport())}
 					return c.isActiveAtDate(this.getStreamAnalysis().getCurrentPeriodReport().reportingStartDate)
 				}).sort(utils.sorters.asc(c => c.name.charCodeAt())).map((s,i) => 
 				<TerminalStreamCard 
					auditedTransactions={this.getTransactionsForStream(s)}
					analysis={this.getStreamAnalysis().getCurrentPeriodReport()} stream={s} key={i}
					onRequestedToUncategorize={this.props.onRequestedToUncategorize} 
					onCategorizationUpdate={this.props.onCategorizationUpdate}
				/>)}
 			</RowLayout></RowLayout>
 		</CompountStreamAuditViewContainer>)
	}
}

//Level 3: A tile representing the state of a stream for the current period
class TerminalStreamCard extends StreamAuditView{
	constructor(props){
		super(props);
		this.state = {detailView:false}
		this.handleClick = this.handleClick.bind(this)
	}
	getTitle(){return this.props.stream.name}
	handleClick(){this.updateState({detailView:!this.state.detailView})}
	render(){
/*		if(this.props.stream.name=="Savings"){console.log(this.getStreamAnalysis().getCurrentPeriodReport().transactions)}
*/		
		return (<BaseStreamAuditViewContainer>
			<TSCardHeader>{/*Title*/}
				<AuditViewTitle>{this.getTitle()}</AuditViewTitle>
				<div style={{fontSize:"0.8rem",color:DesignSystem.getStyle().bodyTextSecondary}}>{
					format((this.props.analysis.isSavings()?-1:1)*this.props.stream.getExpectedAmountAtDate(this.getStreamAnalysis().getCurrentPeriodReport().reportingStartDate),true,!(this.props.analysis.isIncome()||this.props.analysis.isSavings()))
					} per {Period[this.props.stream.period].unitName}</div>
			</TSCardHeader>
			<TSCardContent style={{transform:"scale(1)"}}>{/*Main content*/}
				{this.state.detailView?
					<StreamObservationPeriodView analysis={this.getStreamAnalysis(Period.shortestPeriod([Period[this.props.stream.getPreferredPeriod()],Period.monthly]))} onCategorizationUpdate={this.props.onCategorizationUpdate}/>
					:<TerminalStreamCurrentReportPeriodView analysis={this.getStreamAnalysis().getCurrentPeriodReport()}/>}
			</TSCardContent>
			<TSFooter>{/*Switch link*/}
				<StyledLink onClick={this.handleClick}>{this.state.detailView?"Hide":"See"} details</StyledLink>
			</TSFooter>
		</BaseStreamAuditViewContainer>) 
	}
}  

//Styles
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
const ColumnLayout = styled.div`
	display:flex;
	justify-content:space-evenly;
    flex-direction: column;
	align-items: flex-start;
	width:100%;
`
const RowLayout = styled.div`
	display:flex;
    flex-direction: row;
	align-items: flex-start;
	flex-wrap: wrap;
	justify-content: flex-start;
	width:100%;
`

const AuditViewContainer = styled(FlexColumn)`
    max-width: 50rem;
    margin: auto;
    justify-content: center;
    align-content: center;
    align-items: stretch;
`

const TopLevelStreamAuditViewContainer = styled(FlexColumn)`
    margin-bottom: 2rem;
    justify-content: space-between;
    align-items: flex-start;
    width:100%;
`


const BaseStreamAuditViewContainer = styled(FlexColumn)`
	background: ${props => DesignSystem.getStyle().UIElementBackground};
	position:inherit;
    justify-content: space-between;
    flex-grow: 0;
    padding: 0.5rem;
    border-radius: ${props => DesignSystem.borderRadius};
    margin: 0.5rem;
    margin-bottom: 0.5rem;
    height:14rem;
    max-width: 10.5rem;
    width: calc(50% - 2rem);
`

const TSCardHeader = styled.div`
	flex-grow: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
`
const TSCardContent = styled.div`
	margin-bottom: 0.5rem;
	height: 8rem;
	width: 8rem;
`
const TSFooter = styled.div`
	margin-bottom: 0.5rem;
	height: 1rem;
`
const AuditViewTitle = styled.div`
	font-size:0.8rem;
	color: ${props => DesignSystem.getStyle().bodyTextSecondary};
	margin-bottom:0.3rem;
	font-weight:bold;
`
export const StyledLink = styled.a`
	height: 1rem;
    font-size: 0.8rem;
    text-decoration: underline;
    cursor: pointer;
    color: ${props => DesignSystem.getStyle().bodyTextSecondary}
`

const TopLevelHeaderContainer = styled.div`
	display:flex;
	direction: row;
	align-items: center;
	justify-content: space-between;
    border-bottom: solid 1px;
    border-color: ${DesignSystem.getStyle().borderColor};
    margin-bottom: ${DesignSystem.verticalSpacing[Core.isMobile()?"s":"m"]};
    margin-top: ${DesignSystem.verticalSpacing[Core.isMobile()?"s":"m"]};
    width: 100%;
`


const CompountStreamAuditViewContainer =styled.div`
	margin-bottom:3rem;
	width:100%;
	max-width: 100%;
}
`

const StreamGroupHeaderTitle = styled.div`
	margin-bottom: 0.5rem;
    text-align: left;
    font-weight: bold;
`

const StreamGroupHeader = styled.div`
	margin-bottom: 1rem;
	height:5rem;
    text-align: left;
    padding:0;

    background-color: ${props => DesignSystem.getStyle().UIElementBackground};
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    border-radius:  ${props => DesignSystem.borderRadius};
    align-items: center;
    position: relative;
`

const StreamAuditCellContainer = styled.div`
	display:flex;
	justify-content:space-evenly;
	align-items: center;
	width:100%;
`
