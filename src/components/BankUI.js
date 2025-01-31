import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import ApiCaller from '../ApiCaller'
import DS from '../DesignSystem'
import {Flow,FlowStep} from './Workflow'
import {usePlaidLink} from "react-plaid-link";
import {BankConnectionStatuses,getBankErrorMessage,AccountTypes,Connectors} from '../Bank.js'
import { createMachine, createActor } from 'xstate';
import Core from '../core'
import React from 'react';
import Navigation, {NavRoutes} from './Navigation'
import utils from '../utils'


//This file implements the bank selection logic, meant to be presented in a modal or workflow. It's scope is only the component that enables bank selection. 
/*NOTE FOR FUTURE
Since the implementation of Powens on 5/1/2024, this workflow has to be "restorable" from the page reload if there is a "state" parameter. This feature isn't well contained right now and lives in Settings page and in BankUI. This means that the bankUI flow isn't really modular and can't be done from another page like an onboarding flow right now, or reconnect from Home action card.
*/


let bankFrontPageList = []

//sole job of this component: select or search a bank and return its institution rich object. Should be presented in a flow.
export class BankSelectorComponent extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {
			fetching:true,
			searching: false,
			searchMode: false,
			bankList:bankFrontPageList,
			invisible:!this.isDataLoaded(),//don't start invisible if the data is already loaded
		}
		this.onSearchInputChanged = this.onSearchInputChanged.bind(this)
		this.searchInputTimer = null;
		this.searchInputTimerTimeout = 400 //time that should have no keystrokes to send the search request
		this.pageContainerRef = React.createRef()
		this.latestSearchString = ""
	}
	componentDidMount(){this.loadData()}
	setFixedHeight(b){
		if(b){
			let h = this.pageContainerRef.current.clientHeight - parseInt(getComputedStyle(this.pageContainerRef.current).marginBottom.split('px')[0]);
				if(this.pageContainerRef.current){this.pageContainerRef.current.style.height = h+"px"}
		}else{
			this.pageContainerRef.current.style.height = ""
		}
	}
	isDataLoaded(){return bankFrontPageList.length>0}
	onSearchInputChanged(e){
		let s = e.target.value
		this.latestSearchString = s
		if(this.searchInputTimer){clearTimeout(this.searchInputTimer)} //this avoids doing an API call on every key stroke as the user is typing
		if(s.length==0){this.updateState({searching: false, searchMode:false, bankList: bankFrontPageList})}
		else{
			this.searchInputTimer = setTimeout(() => {
				this.setFixedHeight(true)//fixes height of the content before rendering the loading state
				this.updateState({searching:true, searchMode:true})
				.then(() => ApiCaller.getSupportedInstitutions(s))//searches
				.then(r => {
					this.setFixedHeight(false)
					if(this.latestSearchString==""){return}//prevents the list to update to search results if the result comes back after clearing the search bar asynchronously
					else{this.updateState({searching:false, bankList: r})}
				})
			},this.searchInputTimerTimeout)
		}
	}
	loadData(){
		return (this.isDataLoaded()?Promise.resolve():ApiCaller.getSupportedInstitutions().then(r => bankFrontPageList = r)).then(() => 
			new Promise((res,rej) => this.updateState({fetching:false,bankList:bankFrontPageList})
					.then(() => setTimeout(() => this.updateState({invisible: false}).then(() => res()))),50))//needed for smooth fade in
	}
	render(){return(
		this.state.fetching?<PageCenterer><DS.component.Loader/></PageCenterer>:
		<BankSelectorContainer ref={this.pageContainerRef} invisible={this.state.invisible}>
			<DS.component.SearchBar placeholder="Search" placeholderIcon="search" textAlign="left" onChange={this.onSearchInputChanged}/>
			<DS.component.Spacer size="xxs"/>
			{this.state.searchMode?this.state.searching?<PageCenterer><DS.component.Loader/></PageCenterer>:this.state.bankList.length>0?<DS.component.ScrollableList>{
				this.state.bankList.slice(0,8).map((b,i) => <DS.component.ListItem fullBleed key={i} onClick={(e) => this.props.onSelect(b)}>
					{b.logo?<DS.component.Avatar src={isValidUrl(b.logo)?b.logo:`data:image/png;base64,${b.logo}`}/>:<DS.component.AvatarIcon iconName="bank" style={{color: DS.getStyle().modalPrimaryButton}}/>}
					{/*<div>*/}
						<DS.component.Label >{b.name}</DS.component.Label>
						{/*<DS.component.Label style={{marginTop:DS.spacing.xxs/2+"rem"}} size="xs">via {utils.capitalize(b.connectorMetadata.connectorName)}</DS.component.Label>
					</div>*/}
					<DS.component.Spacer/>
					<DS.component.Button.Icon iconName="caretDown" style={{transform:"rotate(-"+90+"deg)"}}/>	
				</DS.component.ListItem>)
			}</DS.component.ScrollableList>:<PageCenterer><DS.component.Label secondary>Sorry, we couldn't find a bank with this name.</DS.component.Label></PageCenterer>
			:<DS.component.ScrollableGrid>{//front page display as a grid
				this.state.bankList.map((b,i) => <DS.component.GridItem key={i} onClick={(e) => this.props.onSelect(b)}>
					{b.logo?<DS.component.Avatar src={isValidUrl(b.logo)?b.logo:`data:image/png;base64,${b.logo}`}/>:<DS.component.AvatarIcon iconName="bank" style={{color: DS.getStyle().modalPrimaryButton}}/>}
					<DS.component.Label style={{textOverflow:"unset",textWrap:"wrap"}}>{b.name}</DS.component.Label>
					<DS.component.Spacer/>
				</DS.component.GridItem>)
			}</DS.component.ScrollableGrid>
		}
		</BankSelectorContainer>
		
	)}
}

const isValidUrl = urlString=> {
	try { 
		return Boolean(new URL(urlString)); 
	}
	catch(e){ 
		return false; 
	}
}

const PageCenterer = styled.div`
	width: 100%;
	margin: auto;

`
const BankSelectorContainer = styled.div`
	display: flex;
    text-align: center;
    flex-direction: column;
    align-items: stretch;
    margin-bottom: ${props => Core.isMobile()?DS.spacing.s:DS.spacing.l}rem;
    opacity: ${props => props.invisible?0:1};
    transition: opacity 0.5s;
    flex-shrink: 0;
    flex-grow: 1;
    height: 100%;
`



export const PlaidLinkLoader = (props) => {
	const {token,onSuccess,onExit} = props;
	const { open, ready } = usePlaidLink({token,onSuccess,onExit});
 	open()
  	return (<div/>);
};




//New bank connection flow
export class NewBankConnectionFlow extends Flow{//a class defining the flow logic (state machine)
	setMachine(initialContext = {}){
		return createMachine({
			id: 'NewBankCo',
			context: initialContext,
			initial: initialContext.step || 'selectBank',
			states:{
				success:{type: "final"},
				fail: {type: "final"},
				selectBank:{
					on: {
						SELECT:  {target: 'aggregatorConnect'},
						CLOSE: {target:'fail'}
					},
					meta: {
						title: "Select your bank",
						allowClose: true,
						renderable: <BankSelectorStep parentFlow={this}/>,
					}
				},
				aggregatorConnect:{
					on: {
						BACK: {target: 'selectBank'},
						CONNECTED: {target: 'nameConnection'},
						FAIL: {target:'selectBank'}
					},
					meta: {
						title: "Loading...",
						renderable: (ctx) => {
							switch(ctx.institution.connectorMetadata.connectorName){
								case Connectors.plaid:
									return <AggregatorConnectorStepPlaid parentFlow={this}/>
								case Connectors.powens:
									return <AggregatorConnectorStepPowens isReturnFromRedirect={initialContext.step=='aggregatorConnect'} parentFlow={this}/>
							}	
						},
					}
				},
				nameConnection:{
					on: {
						SUBMIT: {target: 'saveConnection'},
						CANCEL: {target:'fail'} 
					},
					meta: {
						title: "Name this connection",
						renderable: <NewBankConnectionNameStep parentFlow={this}/>,
					}
				},
				saveConnection:{
					on: {
						SAVED: {target: 'success'}
					},
					meta: {
						title: "Saving...",
						renderable: <SaveConnectionStep parentFlow={this}/>
					}
				}
			}
		})
	}

	static RestoreFlowIfNeeded(){
		return Core.getQueryParamsPromise().then(p => {
			let param = p.get('state')?JSON.parse(p.get('state')):undefined;

			if(param && param.connectorName == Connectors.powens && param.step == 'aggregatorConnect'){//qualifies for a restore for Powens' flow
				if(!p.get('error') && p.get('code') && p.get('code')){//return from redirect
					Core.consumeQueryParams(['state','code','connection_id'])
					return this.Summon({...param,code:p.get('code'),connectionId:p.get('connection_id')})
				}else if(p.get('error')){Core.consumeQueryParams(['state','error'])}
			}
			return Promise.reject()
		})

	}
}



//steps
export class BankSelectorStep extends FlowStep{
	onSubmit(selectedInsitution){
		this.updateContext({institution: selectedInsitution})
		this.transitionWith('SELECT')
	}
	renderContent(){return (<BankSelectorComponent onSelect={this.onSubmit}/>)}
}

export class AggregatorConnectorStep extends FlowStep{
	constructor(props){
		super(props)
		this.state = {...this.state,fetching:true}
	}
	getConnector(){return this.getContext().institution.connectorMetadata.connectorName}
	onSubmit(public_token){
		this.updateContext({public_token : public_token})
		this.transitionWith('CONNECTED')
	}
	renderContent(){return([
		<DS.component.Loader key={1}/>,
		<DS.component.Spacer size={"l"} key={3}/>,
	])}
}

export class AggregatorConnectorStepPlaid extends AggregatorConnectorStep{
	componentDidMount(){
		if(this.props.updateMode){
			ApiCaller.bankInitiateUpdate(this.getContext().itemId).then(data => {
		        this.updateState({updateModeLinkToken:data.link_token,fetching:false})
		    })
		}else{
			ApiCaller.bankInitiateConnection(Connectors.plaid,{
				routingNumber:this.getContext().institution.routingNumbers[0],
				institutionId:this.getContext().institution.id
			})
			.then(r => this.updateState({link_token:r.link_token,fetching:false}))
		}
	}
	renderContent(){
		return([
			<DS.component.Loader key={1}/>,
			this.state.fetching?"":<PlaidLinkLoader key={2} 
				token={this.state.updateModeLinkToken || this.state.link_token} 
				onSuccess={(public_token,metadata) => this.onSubmit(public_token)} 
				onExit={this.onFail}
			/>,
			<DS.component.Spacer size={"l"} key={3}/>,
		])
	}
}

export class AggregatorConnectorStepPowens extends AggregatorConnectorStep{
	getURIState(){
		let a = JSON.parse(JSON.stringify(this.getContext()))
		delete a.institution.logo
		a.step = 'aggregatorConnect'
		a.connectorName = Connectors.powens
		return encodeURIComponent(JSON.stringify(a))
	}
	componentDidMount(){
		if(this.props.updateMode){
			ApiCaller.bankInitiateUpdate(this.getContext().itemId,{
				redirectRoute: Navigation.getCurrentRoute()
			}).then(r => window.location.replace(r.reconnectUrl))
		}
		else if(this.props.isReturnFromRedirect){
			this.updateContext({connectionMetadata: {
				...this.getContext().connectionMetadata,
				connectionId: this.getContext().connectionId
			}})
			this.onSubmit(this.getContext().code)
		}else{
			if(!this.getContext().institution.connectorMetadata.connectorInstitutionId){
				
			}

			ApiCaller.bankInitiateConnection(Connectors.powens,{
				connectorInstitutionId:this.getContext().institution.connectorMetadata.connectorInstitutionId,
				redirectRoute: Navigation.getCurrentRoute()
			})
			.then(r => window.location.replace(r.connectUrl+"&state="+this.getURIState()))
		}
	}
}



export class NewBankConnectionNameStep extends FlowStep{
	constructor(props){
		super(props)
		this.onChangeInputValue = this.onChangeInputValue.bind(this)
	}
	getButtons(){return [
		{name:'finish',primary:true}, //default action for primary is onSubmit
		{name:'cancel',action:() => this.transitionWith('CANCEL')}
	]}
	onSubmit(){this.transitionWith('SUBMIT')}
	onChangeInputValue(e){
		this.updateContext({friendlyName:e.target.value})
		//validation
		if(this.state.primaryButtonDisabled && e.target.value.length>0){this.updateState({primaryButtonDisabled:false})}
		else if(!this.state.primaryButtonDisabled && e.target.value.length == 0){this.updateState({primaryButtonDisabled:true})}
	}
	renderContent(){return(<div><DS.component.Input onChange={this.onChangeInputValue}/></div>)}
}

export class SaveConnectionStep extends FlowStep{
	componentDidMount(){
		let r = this.getContext()
		ApiCaller.bankExchangeTokenAndSaveConnection(
			r.institution.connectorMetadata.connectorName,
			r.public_token,
			r.friendlyName,
			r.institution.id,
			r.connectionMetadata
		).then(() => this.onSubmit())
	}
	onSubmit(){this.transitionWith('SAVED')}
	renderContent(){return (<DS.component.Loader/>)}
}


//Update bank connection flow
export class UpdateBankConnectionFlow extends Flow{//a class defining the flow logic (state machine)
	setMachine(initialContext = {}){return createMachine({
			id: 'UpdateBankCo',
			context: initialContext,
			initial:'aggregatorUpdate',
			states:{
				success:{type: "final"},
				fail: {type: "final"},
				aggregatorUpdate:{
					on: {
						CONNECTED: {target: 'refreshConnection'},
						FAIL: {target:'fail'},
						CLOSE: {target:'fail'}
					},
					meta: {
						title: "Loading...", 		
						renderable: (ctx) => {
							console.log(ctx)
							switch(ctx.connectorName){
								case Connectors.plaid:
									return <AggregatorConnectorStepPlaid updateMode parentFlow={this}/>
								case Connectors.powens:
									return <AggregatorConnectorStepPowens updateMode parentFlow={this}/>
							}	
						},
					}
				},
				refreshConnection:{
					on: {
						DONE: {target: 'success'}
					},
					meta: {
						title: "Refreshing connection...",
						renderable: <RefreshConnectionStep parentFlow={this}/>
					}
				}

			}
		})
	}
}



export class RefreshConnectionStep extends FlowStep{
	componentDidMount(){
		let r = this.getContext()
      	ApiCaller.bankForceRefreshItemTransactions(r.itemId)
      	.then(() => this.onSubmit())
	}
	onSubmit(){this.transitionWith('DONE')}
	renderContent(){return (<DS.component.Loader/>)}
}

