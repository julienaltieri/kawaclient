import React from "react"
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import Core from '../core.js';
import CategorizeAction from './CategorizeAction.js';
import AuditView from './StreamAuditView'
import AppConfig from '../AppConfig'
import ActionQueueManager from './ActionQueueManager'
import {ActionTypes} from '../HistoryManager.js'
import DS from '../DesignSystem.js'
import {BankReconnectAction,TransactionTypeClarificationAction} from './Action'
import {refreshLiveRenderComponents} from './AnalysisView'
import utils from '../utils'
import PageLoader from './PageLoader'

const loading = require('../assets/blue_loading.gif');
const Grouper = require('../processors/TransactionGrouper')
const undoIcon = require('../assets/undo.svg').default;

class MissionControl extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {...this.state,
			fetching:true,
			instanceMaxDate: new Date(),
			instanceMinDate: AppConfig.transactionFetchMinDate,
			availableTransactions: [],
			streamTree: Core.getMasterStream(),
			actionQueueManager : new ActionQueueManager()
		}

		//binds
		this.onRequestedToUncategorizeFromAuditView = this.onRequestedToUncategorizeFromAuditView.bind(this);
		this.onCategorizeActionConcluded = this.onCategorizeActionConcluded.bind(this);
		this.onUserDefinedTransactionTypeClarified = this.onUserDefinedTransactionTypeClarified.bind(this);
		this.onClickUndoButton = this.onClickUndoButton.bind(this);
		this.onCategorizationUpdate = this.onCategorizationUpdate.bind(this);

		//query parameters
		Core.subscribeToQueryParamsReceived(this)
	}
	componentDidMount(){this.loadData()}
	didReceiveQueryParams(params){//TODO
		console.log("Query Params Received on home: ", params.toString())
		Core.consumeQueryParams()//clear the params after taking action
	}
	loadData(){
		return Promise.all([
			Core.getTransactionsBetweenDates(this.state.instanceMinDate, this.state.instanceMaxDate)?.then(res => {
				var txns = res.filter(t => !t.categorized).sort(utils.sorters.asc(t => t.date.getTime()));
				var startingId = this.state.actionQueueManager.getNextAvailableId();
				this.state.actionQueueManager.insertActions(txns.map((t,i) => new CategorizeAction(startingId+i+1,this,false,t,this.onCategorizeActionConcluded)).reverse());
				this.insertClarificationActionsIfNeeded(res.filter(t => t.categorized))
				return res
			}),
			Core.checkBankConnectionsStatus()?.then(() => this.addBankConnectionCards()),
			Core.loadData()
		]).then(([res,o]) => {
			this.props.refresh()
			this.updateState({fetching: false,availableTransactions:res})
		})
	}
	addBankConnectionCards(){
		var startingId = this.state.actionQueueManager.getNextAvailableId();
		this.state.actionQueueManager.insertActions(Core.getErroredBankConnections().map((co,i) => {
			let br = new BankReconnectAction(startingId+i,this,false,() => {
				this.state.actionQueueManager.consumeActions([br]).then(() => {
					return 	this.updateState({rerender:true,rerenderCount:(this.state.rerenderCount+1||0)})
				})
			},co)
			return br
		}))
	}
	
	//operations
	categorizeTransactions(txns,streamAllocations){//categorize transactions and update ActionQueue
		var txnsIds = txns.map(t=>t.categorized?t.transactionId:t.id);
		streamAllocations.forEach(allocs => allocs.forEach(al => {
			delete al.userDefinedTransactionType
		}));
		var tupples = txns.map((t,i) => {return {transaction:t,streamAllocation:streamAllocations[i]}})
		var actionsToConsume = this.state.actionQueueManager.getQueue().filter(a => a.transaction && txnsIds.indexOf(a.transaction.id)>-1);
		return Promise.all([this.state.actionQueueManager.consumeActions(actionsToConsume),Core.categorizeTransactionsAllocationsTupples(tupples)])
		.then(([actionsConsumeResults,cats]) => this.insertClarificationActionsIfNeeded(cats))
	}
	insertClarificationActionsIfNeeded(cats){
		let startingId = this.state.actionQueueManager.getNextAvailableId();
		let CAs = [];
		cats?.forEach((c,i) => c.streamAllocation.forEach(al => {
			if(c.evaluator.doesNeedClarificationForAllocation(al)){
				CAs.push(new TransactionTypeClarificationAction(startingId+i,this,true,c,al,this.onUserDefinedTransactionTypeClarified))
			}
		}));
		if(CAs.length > 0){this.state.actionQueueManager.insertActions(CAs)}
	}
	uncategorizeTransactions(txns){//uncategorize transactions and update the ActionQueue
		return Core.undoCategorizations(txns).then(() => {
			var startingId = this.state.actionQueueManager.getNextAvailableId();
			let ids = txns.map(txn => txn.transactionId)
			let toConsume = this.state.actionQueueManager.getQueue().filter(a => !!a.transaction && ids.indexOf(a.transaction.transactionId)>-1 && a.constructor.name==TransactionTypeClarificationAction.name)
			let toInsert = txns.map((t,i) => new CategorizeAction(startingId+i,this,true,t,this.onCategorizeActionConcluded)).reverse();
			return Promise.all([this.state.actionQueueManager.consumeActions(toConsume),this.state.actionQueueManager.insertActions(toInsert)
			]).then(() => this.updateState({rerender:true,rerenderCount:(this.state.rerenderCount+1||0)}))
		})
	}
	onUserDefinedTransactionTypeClarified(parentAction,selectedType){
		parentAction.transaction.evaluator.getAllocationForStream(parentAction.allocatedStream).userDefinedTransactionType = selectedType.name
		let tupple = {transaction:parentAction.transaction,streamAllocation:parentAction.transaction.streamAllocation}
		//TODO: save undo in history
		return Promise.all([Core.categorizeTransactionsAllocationsTupples([tupple]),this.state.actionQueueManager.consumeActions([parentAction])
		]).then(() => this.updateState({rerender:true,rerenderCount:(this.state.rerenderCount+1||0)}))
	}

	//getters
	getTransactionsInQueue(){return this.state.actionQueueManager.getQueue().filter(a => a.transaction).map(a => a.transaction)}
	getAllAvailableTransactions(){return this.state.availableTransactions}

	//UI Callbacks
	onClickUndoButton(e){//top level undo button
		//get the action to undo
		var lastState = Core.globalState.history.getLastState();
		if(!lastState)return;

		//play button animation
		e.target.style.transition = "transform 1.5s"; e.target.style.transform = "rotate(-1080deg)";
		setTimeout(() => {e.target.style.transition = ""; e.target.style.transform = ""},1500)
		
		//call server
		var txnsToCategorize = lastState.transactions.filter(t => t.categorized);
		var allocs = txnsToCategorize.map((t,i) => t.streamAllocation);
		if(lastState.action == ActionTypes.TransactionUpdate){
			return Promise.all([
				this.uncategorizeTransactions(lastState.transactions.filter(t => !t.categorized)),
				this.categorizeTransactions(txnsToCategorize,allocs)
			]).then(() => {
				Core.globalState.history.popState();
				this.updateState({rerender:true,rerenderCount:(this.state.rerenderCount+1||0)})
			})
		}
	}
	onCategorizeActionConcluded(action, txnsToCategorize, streamAllocation){//categorization card concluded
		//streamAllocations is an array of allocations. All txnsToCategorize will be allocated using the allocation array
		this.onCategorizationUpdate(txnsToCategorize,txnsToCategorize.map(t => streamAllocation));
	}
	onCategorizationUpdate(txnsToUpdate,streamAllocations){
		var txnsSnapshot = Core.globalState.history.snapshot(txnsToUpdate);
		this.categorizeTransactions(txnsToUpdate,streamAllocations).then(() => {
			Core.globalState.history.recordTransactionUpdate(txnsSnapshot);
			this.updateState({rerender:true,rerenderCount:(this.state.rerenderCount+1||0)}).then(refreshLiveRenderComponents)
		})
	}
	onRequestedToUncategorizeFromAuditView(txns){//uncategorize button from audit view
		var txnsSnapshot = Core.globalState.history.snapshot(txns);
		this.uncategorizeTransactions(txns).then(() => {
			Core.globalState.history.recordTransactionUpdate(txnsSnapshot);
			this.updateState({rerender:true,rerenderCount:(this.state.rerenderCount+1||0)}).then(refreshLiveRenderComponents)
		})
	}

	render(){
		if(this.state.fetching){return (<PageLoader/>)}
		else if(this.state.availableTransactions.length==0){return (<div></div>)}
		else{return <StyledHomeContainer>
				<ActionZoneContainer style={this.state.actionQueueManager.hasActions()?{height:'20rem',opacity:1}:{height:0,opacity:0}}>
					<UndoButtonContainer><UndoButton src={undoIcon} onClick={this.onClickUndoButton}></UndoButton></UndoButtonContainer>
					{this.state.actionQueueManager.renderComponent()}
				</ActionZoneContainer>
				<div style={{width:"100%",display: "flex",flexDirection: "column",alignItems: "stretch"}}>
					<AuditView  auditedTransactions={this.state.availableTransactions} stream={this.state.streamTree} 
								onCategorizationUpdate={this.onCategorizationUpdate} 
								onRequestedToUncategorize={this.onRequestedToUncategorizeFromAuditView}
								rerenderCount={this.state.rerenderCount}/></div>{/*rerenderCount is here because AuditView is expensive and uses React's memoization, which only rerenders when props change*/}
			</StyledHomeContainer>
		}
	}
}

export default React.memo(MissionControl)



const ActionZoneContainer = styled.div`
    transition: all 0.5s;
    max-width: 26rem;
    width: 100%;
`

const StyledHomeContainer = styled.div `
	width:calc(100% - 2rem);
	padding: 1rem;
	text-align: center; 
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: ${(props) => Core.isMobile()?DS.verticalSpacing.s:DS.verticalSpacing.m};
`   

const UndoButton = styled.img`
    width: 1.5rem;
    height: 2.5rem;
    opacity: 0.3;
    cursor: pointer;
    filter: ${"brightness("+(DS.isDarkMode()?9:1)+")"};
    
    &:hover{
    	opacity:0.5;
    }
`

const UndoButtonContainer = styled.div`
	max-width: 26rem;
    margin: auto;
    display: flex;
    justify-content: flex-end;
`