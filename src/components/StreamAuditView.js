import React from "react"
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import Core from '../core.js';
import dateformat from "dateformat";
import memoize from "memoize-one";
import AnimatedNumber from "animated-number-react";
import DS from '../DesignSystem.js'
import {getStreamAnalysis,getMultiStreamAnalysis,reportingConfig,getAnalysisRootDate,analysisRootDateForYear} from '../processors/ReportingCore.js';
import {TimeAndMoneyProgressView,TerminalStreamCurrentReportPeriodView,EndOfPeriodProjectionSummary,EndOfPeriodProjectionGraph} from './AnalysisView'
import {StreamObservationPeriodView} from './StreamObservationPeriodAnalysisView'
import {format} from './AnalysisView'
import MiniGraph from './MiniGraph'
import {Period,timeIntervals} from '../Time'
import utils from '../utils'
import {ModalTemplates} from '../ModalManager.js'

const transitionStyle = "cubic-bezier(0.33, 0.02, 0.05, 0.98)"

if(reportingConfig.startingDay<1 || reportingConfig.startingDay>28 || reportingConfig.startingMonth>12 || reportingConfig.startingMonth<1){
	throw new Error(`Selected reporting date has invalid parameters. Month: ${reportingConfig.startingMonth} Day: ${reportingConfig.startingDay}. Reporting month must be between 1 and 12 and day must be between 1 and 28`)
}
let analysisDate
const getAnalysisDate = () => {
	analysisDate = analysisDate || reportingConfig.observationPeriod.nextDateFromNow(getAnalysisRootDate());
	return analysisDate
}
//let getAnalysisDate() = analysisRootDateForYear(2023);

//if we're in the first period of the observation period, show the graph from the previous period
let getPreviousAnalysisDate = () => reportingConfig.observationPeriod.previousDate(getAnalysisDate());
let shouldShowContextForObservationPeriodTransition = () => ((new Date() - getPreviousAnalysisDate())< 2*reportingConfig.observationPeriod.subdivision.getTimeIntervalFromDate(getPreviousAnalysisDate()))
//return the start date of the resulting analysis based on wether or not to show context for observation period transition
export const getAnalysisStartDate = () => (!shouldShowContextForObservationPeriodTransition()?reportingConfig.observationPeriod:Period.biyearly).previousDate(getAnalysisDate())


const mAnalyze = memoize((s,txns,observationPeriod,subReportingPeriod) => getStreamAnalysis(getAnalysisDate(),s,txns,observationPeriod,subReportingPeriod))

var count = 0;
//generic component
export class StreamAuditView extends BaseComponent{
	getTransactionsForStream(s){return this.props.auditedTransactions.filter(t => t.categorized && t.isAllocatedToStream(s))}
	getStreamAnalysis(options){
		return mAnalyze(this.props.stream,this.props.auditedTransactions,options?.observationPeriod ||(!shouldShowContextForObservationPeriodTransition()?reportingConfig.observationPeriod:Period.biyearly),options?.subReportingPeriod || options?.observationPeriod?.subdivision)} 
	render(){return (<div>I'm a generic StreamAuditView</div>)}
}

//data for display functions
const validStreamsForDisplay = (s,analysis) => s.isActiveAtDate(analysis.getCurrentPeriodReport().reportingDate)
const getStreamsForDisplay = (children,analysis) => children?.filter(c => validStreamsForDisplay(c,analysis)).sort(utils.sorters.asc(c => c.name.charCodeAt()))||[]
const valueForDisplay = (analysis) => analysis.getCurrentPeriodReport().reportingDate

//master audit view
class MasterAuditView extends StreamAuditView{
	render(){
		return (<AuditViewContainer>
			{this.props.auditedTransactions.filter(t => t.categorized).length>0?<MasterStreamAuditView stream={Core.getMasterStream()} key={0} auditedTransactions={this.props.auditedTransactions.filter(t => t.categorized)}/>:""}
			{Core.getMasterStream().children.map((s,i) => {
				return <MacroCompoundStreamAuditView stream={s} key={i+1} auditedTransactions={this.getTransactionsForStream(s)}
	 				onCategorizationUpdate={this.props.onCategorizationUpdate}
	 				onRequestedToUncategorize={this.props.onRequestedToUncategorize} 
	 				onStreamDefinitionChange={this.props.onStreamDefinitionChange}
		 		/>})}
		</AuditViewContainer>)
	}
}
export default React.memo(MasterAuditView)

//Level 0: High-level view of the entire portfolio and projections across the observation period 
class MasterStreamAuditView extends StreamAuditView{
	getAnalysisForStreams(ss){
		return getMultiStreamAnalysis(getAnalysisDate(),ss,this.props.auditedTransactions,!shouldShowContextForObservationPeriodTransition()?reportingConfig.observationPeriod:Period.biyearly,reportingConfig.observationPeriod.subdivision)
	}
	render(){return (<div>
		<EndOfPeriodProjectionGraph  	
			incomeAnalysis = {this.getAnalysisForStreams(this.props.stream.children.filter(s => s.getExpectedAmountAtDate(valueForDisplay(this.getStreamAnalysis()))>0 && !s.isSavings))}
			expenseAnalysis= {this.getAnalysisForStreams(this.props.stream.children.filter(s => s.getExpectedAmountAtDate(valueForDisplay(this.getStreamAnalysis()))<0 && !s.isSavings))}
			savingsAnalysis= {this.getAnalysisForStreams(this.props.stream.children.filter(s => s.isSavings))}
		/></div>)
	}
}


//Level 1: macro category (income, savings, recurring expense, annual expense)
class MacroCompoundStreamAuditView extends StreamAuditView{
	constructor(props) {
		super(props);
		this.state = { isCollapsed: false };
		this.toggleCollapse = this.toggleCollapse.bind(this);
	}

	toggleCollapse() {
		this.setState(prev => ({ isCollapsed: !prev.isCollapsed }));
	}

	render(){
		const { isCollapsed } = this.state;
		return (<TopLevelStreamAuditViewContainer 
			isCollapsed={isCollapsed} 
			onClick={isCollapsed ? this.toggleCollapse : undefined}
			style={{ cursor: isCollapsed ? 'pointer' : 'default' }}>
			<TopLevelHeaderContainer 
				isCollapsed={isCollapsed}
				onClick={!isCollapsed ? this.toggleCollapse : undefined} 
				style={{ cursor: !isCollapsed ? 'pointer' : 'inherit' }}>
				<StreamGroupHeaderTitle>{this.props.stream.name}</StreamGroupHeaderTitle>
				<div onClick={e => e.stopPropagation()}>
					<MiniGraph analysis={this.getStreamAnalysis({subReportingPeriod:Period.monthly})} stream={this.props.stream}/>
				</div>
			</TopLevelHeaderContainer>
			<StreamAuditCellContainer isCollapsed={isCollapsed}>
				{this.props.stream.getDepth()==1?
					<RowLayout>
						{getStreamsForDisplay(this.props.stream.children,this.getStreamAnalysis()).map((s,i) => <TerminalStreamCard 
							auditedTransactions={this.getTransactionsForStream(s)}
							analysis={this.getStreamAnalysis().getCurrentPeriodReport()} stream={s} key={i}
							onRequestedToUncategorize={this.props.onRequestedToUncategorize} 
							onCategorizationUpdate={this.props.onCategorizationUpdate}
							onStreamDefinitionChange={this.props.onStreamDefinitionChange}
						/>)}
					</RowLayout>:
					<ColumnLayout>
						<RowLayout style={{"marginBottom":DS.spacing.l+"rem"}}>{getStreamsForDisplay(this.props.stream.children.filter(c => c.isTerminal()),this.getStreamAnalysis()).map((s,i) => <TerminalStreamCard 
							auditedTransactions={this.getTransactionsForStream(s)}
							analysis={this.getStreamAnalysis().getCurrentPeriodReport()} stream={s} key={i}
							onRequestedToUncategorize={this.props.onRequestedToUncategorize} 
							onCategorizationUpdate={this.props.onCategorizationUpdate}
							onStreamDefinitionChange={this.props.onStreamDefinitionChange}
						/>)}</RowLayout>
						{getStreamsForDisplay(this.props.stream.children.filter(c => !c.isTerminal()),this.getStreamAnalysis()).map((s,i) => <CompoundStreamAuditView 
							auditedTransactions={this.getTransactionsForStream(s)}
							title={s.name} analysis={this.getStreamAnalysis().getCurrentPeriodReport()} stream={s} key={i}
							onRequestedToUncategorize={this.props.onRequestedToUncategorize} 
							onCategorizationUpdate={this.props.onCategorizationUpdate}
							onStreamDefinitionChange={this.props.onStreamDefinitionChange}
						/>)}
					</ColumnLayout>
				}
			</StreamAuditCellContainer>
		</TopLevelStreamAuditViewContainer>);
	}
}

//Level 2: component for category aggregate containing multiple terminal streams
class CompoundStreamAuditView extends StreamAuditView{
	constructor(props) {
		super(props);
		this.state = { isCollapsed: true };
		this.toggleCollapse = this.toggleCollapse.bind(this);
	}

	toggleCollapse() {
		this.setState(prev => ({ isCollapsed: !prev.isCollapsed }));
	}

	render(){
		const { isCollapsed } = this.state;
		if(this.props.stream.name == "Retraite"){console.log(this.getStreamAnalysis({
			observationPeriod:this.props.stream.getPreferredReportingPeriod()
		}))}
 		return (<CompountStreamAuditViewContainer isCollapsed={isCollapsed}>
 			<DS.component.ContentTile 
				onClick={this.toggleCollapse}
				style={{
					flexDirection: "row",
					justifyContent: "space-between",
					width: "calc(100% - "+DS.spacing.xs+"rem)", 
					margin: 0,
					marginBottom: this.state.isCollapsed ? DS.verticalSpacing.xs : DS.verticalSpacing.s ,
					cursor: "pointer"
				}}>
 				<div style={{width:"3rem",marginLeft:"1rem",flexShrink:0}}>
					<TimeAndMoneyProgressView analysis={this.getStreamAnalysis().getCurrentPeriodReport()} viewConfig={{timeThickness:0.4,moneyThickness:1.3,moneyRadius:45,subdivGapAngles:0.0001}}/>
 				</div>
 				<div style={{padding:"1rem",flexGrow: 0,marginRight:"auto",textAlign:"left"}}>
 					<StreamGroupHeaderTitle>{this.props.stream.name}</StreamGroupHeaderTitle>
 					<div>{utils.formatCurrencyAmount(this.props.stream.getExpectedAmountAtDate(valueForDisplay(this.getStreamAnalysis())),0,true,null,Core.getPreferredCurrency())} per {Period[this.props.stream.period].unitName}</div>
 				</div>
 				<MiniGraph analysis={this.getStreamAnalysis({observationPeriod:Period.yearly})} stream={this.props.stream}/>
 			</DS.component.ContentTile>
 			<StreamAuditCellContainer isCollapsed={isCollapsed}>
 				<RowLayout>
 					{getStreamsForDisplay(this.props.stream.children,this.getStreamAnalysis()).map((s,i) => 
 					<TerminalStreamCard 
						auditedTransactions={this.getTransactionsForStream(s)}
						analysis={this.getStreamAnalysis().getCurrentPeriodReport()} stream={s} key={i}
						onRequestedToUncategorize={this.props.onRequestedToUncategorize} 
						onCategorizationUpdate={this.props.onCategorizationUpdate}
						onStreamDefinitionChange={this.props.onStreamDefinitionChange}
					/>)}
 				</RowLayout>
 			</StreamAuditCellContainer>
 		</CompountStreamAuditViewContainer>)
	}
}

//Stream Details Modal Component
class StreamDetailsModalView extends BaseComponent{
	constructor(props){
		super(props);
		const { stream, analysis } = props;
		const currentAmount = stream.getExpectedAmountAtDate(valueForDisplay(analysis));
		this.originalState = {
			name: stream.name,
			amount: currentAmount,
			period: stream.period,
			isSavings: stream.isSavings,
			isInterestIncome: stream.isInterestIncome,
			isZeroSumStream: stream.isZeroSumStream
		};
		this.state = { ...this.originalState };
		props.controller.state.modalContentState = {...props.controller.state.modalContentState,...this.state}
		this.handleNameChange = this.handleNameChange.bind(this);
		this.handleAmountChange = this.handleAmountChange.bind(this);
		this.handlePeriodChange = this.handlePeriodChange.bind(this);
		this.handleSavingsChange = this.handleSavingsChange.bind(this);
		this.handleInterestChange = this.handleInterestChange.bind(this);
		this.handleZeroSumChange = this.handleZeroSumChange.bind(this);
	}
	
	componentDidMount(){this.updateSaveButtonState()}
	hasChanges(){return Object.keys(this.originalState).some(key => this.state[key] !== this.originalState[key])}
	updateSaveButtonState(){if(this.props.controller){this.props.controller.setPrimaryButtonDisabled(!this.hasChanges())}}
	updateContentState(changes){
		this.props.controller.state.modalContentState = {...this.props.controller.state.modalContentState,...changes}
		this.updateState(changes).then(() => this.updateSaveButtonState())
	}
	
	handleNameChange(e) { this.updateContentState({name: e.target.value})}
	handleAmountChange(e) { this.updateContentState({amount: parseFloat(e.target.value) || 0})}
	handlePeriodChange(e) { this.updateContentState({period: e.target.value})}
	handleSavingsChange(e) { this.updateContentState({isSavings: e.target.value === 'is'})}
	handleInterestChange(e) { this.updateContentState({isInterestIncome: e.target.value === 'is'})}
	handleZeroSumChange(e) { this.updateContentState({isZeroSumStream: e.target.value === 'is'})}
	
	render(){
		const { name, amount, period, isSavings, isInterestIncome, isZeroSumStream } = this.state;
		
		return <DS.component.SentenceWrapper>
			The stream named <DS.component.Input type="text" value={name} onChange={this.handleNameChange} autoSize inline /> should expect <DS.component.Input type="number" value={amount} onChange={this.handleAmountChange} autoSize inline /> every <DS.component.DropDown value={period} onChange={this.handlePeriodChange} autoSize inline>
				{Object.keys(Period).map(p => <option key={p} value={p}>{Period[p].unitName}</option>)}
			</DS.component.DropDown>. This stream <DS.component.DropDown value={isSavings ? 'is' : 'is not'} onChange={this.handleSavingsChange} autoSize inline>
				<option value="is">is</option>
				<option value="is not">is not</option>
			</DS.component.DropDown> a savings stream, <DS.component.DropDown value={isInterestIncome ? 'is' : 'is not'} onChange={this.handleInterestChange} autoSize inline>
				<option value="is">is</option>
				<option value="is not">is not</option>
			</DS.component.DropDown> an interest income stream, and <DS.component.DropDown value={isZeroSumStream ? 'is' : 'is not'} onChange={this.handleZeroSumChange} autoSize inline>
				<option value="is">is</option>
				<option value="is not">is not</option>
			</DS.component.DropDown> a transaction-neutral stream for tracking reimbursements.
		</DS.component.SentenceWrapper>
	}
}

//Level 3: A tile representing the state of a stream for the current period
class TerminalStreamCard extends StreamAuditView{
	constructor(props){
		super(props);
		this.state = {detailView:false,reconciliation:[]}
		this.handleClick = this.handleClick.bind(this)
		this.handleTitleClick = this.handleTitleClick.bind(this)
	}
	getTitle(){return this.props.stream.name}
	
	handleClick(){
		this.updateState({detailView:!this.state.detailView})
		
		
		//pretty print the stats object for the stream analysis of this stream
		const stats = this.getStreamAnalysis().stats;
		console.log(`Stream Analysis Stats: ${this.props.stream.name}`);
		console.log(`- Average per period: ${stats.avgByPeriods}`);
		console.log(`- Expected Amount: ${stats.expected}`);
		console.log(`- Total Amount: ${stats.total}`);
		console.log(`- Included Reports:`,stats.includedReports);
	}
	
	handleTitleClick(){
		Core.presentModal(ModalTemplates.ModalWithComponent(`Edit stream`,
			<StreamDetailsModalView stream={this.props.stream} analysis={this.getStreamAnalysis()} />,
			[{name:"Cancel"},{name:"Save",primary:true}]
		)).then(r => {
			if(r.buttonIndex === 1){
				// Get the updated state from the modal
				const updatedState = r.state;
				const stream = this.props.stream;
				
				// Update the stream properties
				stream.name = updatedState.name;
				stream.isSavings = updatedState.isSavings || false;
				stream.isInterestIncome = updatedState.isInterestIncome || false;
				stream.isZeroSumStream = updatedState.isZeroSumStream || false;
				stream.period = updatedState.period;
				
				// Update the expected amount if it changed
				if(updatedState.amount !== stream.getExpectedAmountAtDate(valueForDisplay(this.getStreamAnalysis()))){
					// Add new expected amount entry
					stream.expAmountHistory = stream.expAmountHistory || [];
					stream.expAmountHistory.push({
						amount: updatedState.amount,
						startDate: new Date()
					});
				}
				// Save the changes
				Core.saveStreams().then(() => {
					console.log("Stream saved successfully");
					this.props.onStreamDefinitionChange();
				}).catch(err => {console.error("Failed to save stream:", err);});
			}
		}).catch(() => {console.log("Modal dismissed")})
	}
	
	render(){
		return (<DS.component.ContentTile style={{height:"14rem",maxWidth: "10.5rem",width: "calc(50% - 2rem)"}}>
			<TSCardHeader>{/*Title*/}
				<ClickableTitleContainer onClick={this.handleTitleClick}>
					<AuditViewTitle>{this.getTitle()}</AuditViewTitle>
					<div style={{fontSize:"0.8rem",color:DS.getStyle().bodyTextSecondary}}>{
						format((this.props.analysis.isSavings()?-1:1)*this.props.stream.getExpectedAmountAtDate(valueForDisplay(this.getStreamAnalysis())),true,!(this.props.analysis.isIncome()||this.props.analysis.isSavings()))
						} per {Period[this.props.stream.period].unitName}</div>
				</ClickableTitleContainer>
			</TSCardHeader>
			<TSCardContent style={{transform: "scale(1)"}}>{/*transform here is needed to get the positioning of annotations tooltips to work*/}
				{this.state.detailView?
					<StreamObservationPeriodView analysis={this.getStreamAnalysis({subReportingPeriod:this.props.stream.getReportingPeriod()})} 
						onCategorizationUpdate={this.props.onCategorizationUpdate} 
						onStreamDefinitionChange={this.props.onStreamDefinitionChange}/>
					:<TerminalStreamCurrentReportPeriodView analysis={this.getStreamAnalysis().getCurrentPeriodReport()} onStreamDefinitionChange={this.props.onStreamDefinitionChange} />}
			</TSCardContent>
			<TSFooter>{/*Switch link*/}
				<StyledLink onClick={this.handleClick}>{this.state.detailView?"Hide":"See"} details</StyledLink>
			</TSFooter>
		</DS.component.ContentTile>) 
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

/*const StreamGroupHeader = styled.div`
	margin-bottom: 1rem;
	height:5rem;
    text-align: left;
    padding:0;

    background-color: ${props => DS.getStyle().UIElementBackground};
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    border-radius:  ${props => DS.borderRadius};
    align-items: center;
    position: relative;
`*/

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
    margin-bottom: ${props => props.isCollapsed ? (Core.isMobile()?DS.spacing.xs:DS.spacing.m) +'rem' : DS.spacing.m +'rem'};
    justify-content: space-between;
    align-items: flex-start;
   	width:  ${props => !props.isCollapsed ? '100%' : 'calc(100% - '+ 2*DS.spacing.xs +'rem)'};
    max-width: 50rem;
    background-color: ${props => props.isCollapsed ? DS.getStyle().UIElementBackground : 'transparent'};
    border-radius: ${DS.borderRadius };
    padding: ${props => props.isCollapsed ? DS.spacing.xs +'rem' : '0'};
	-webkit-tap-highlight-color: transparent;
	user-select: none;
	transition: all 0.3s ${transitionStyle};
`


/*const BaseStreamAuditViewContainer = styled(FlexColumn)`
	background: ${props => DS.getStyle().UIElementBackground};
	position:inherit;
    justify-content: space-between;
    flex-grow: 0;
    padding: 0.5rem;
    border-radius: ${props => DS.borderRadius};
    margin: 0.5rem;
    margin-bottom: 0.5rem;
    height:14rem;
    max-width: 10.5rem;
    width: calc(50% - 2rem);
`*/

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
	color: ${props => DS.getStyle().bodyTextSecondary};
	margin-bottom:0.3rem;
	font-weight:bold;
`
export const StyledLink = styled.a`
	height: 1rem;
    font-size: 0.8rem;
    text-decoration: underline;
    cursor: pointer;
    color: ${props => DS.getStyle().bodyTextSecondary}
`

const TopLevelHeaderContainer = styled.div`
	display:flex;
	direction: row;
	align-items: center;
	justify-content: space-between;
    border-bottom: solid 1px;
    border-color: ${props => props.isCollapsed ? 'transparent' : DS.getStyle().borderColor};
    margin-bottom: ${DS.verticalSpacing[Core.isMobile()?"s":"s"]};
    margin-top: ${DS.verticalSpacing[Core.isMobile()?"s":"s"]};
    width: 100%;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    transition: border-color 0.2s ${transitionStyle};
`


const CompountStreamAuditViewContainer = styled.div`
	margin-bottom: ${props => props.isCollapsed ? (Core.isMobile()? DS.spacing.xxs+"rem" : DS.verticalSpacing.s) :  DS.verticalSpacing.l};
	width: 100%;
	max-width: 100%;
	transition: margin-bottom 0.3s ${transitionStyle};
	-webkit-tap-highlight-color: transparent;
	user-select: none;
`

const StreamGroupHeaderTitle = styled.div`
	margin-bottom: 0.5rem;
    text-align: left;
    font-weight: bold;
`



const StreamAuditCellContainer = styled.div`
	display: flex;
	justify-content: space-evenly;
	align-items: center;
	width:  100%;
	max-height: ${props => props.isCollapsed ? '0' : '10000px'};
	overflow: hidden;
	opacity: ${props => props.isCollapsed ? '0' : '1'};
	transition: max-height 0.2s ${transitionStyle}, opacity 0.2s ${transitionStyle};
	-webkit-tap-highlight-color: transparent;
	user-select: none;
`


const ClickableTitleContainer = styled.div`
	cursor: pointer;
	transition: opacity 0.2s ease;
	&:hover {
		opacity: 0.7;
	}
	-webkit-tap-highlight-color: transparent;
	user-select: none;
`
