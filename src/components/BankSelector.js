import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import {BankConnectionStatuses,getBankErrorMessage,AccountTypes,Connectors} from '../Bank.js'
import ApiCaller from '../ApiCaller'
import Core from '../core'
import ModalManager, {ModalTemplates} from '../ModalManager.js'
import utils from '../utils'
import DS from '../DesignSystem'
import {usePlaidLink,PlaidLink,PlaidLinkOnEvent,PlaidLinkOnSuccess} from "react-plaid-link";
import React, { useCallback, useState } from 'react';



//class responsible to present the bank selection flow (selector -> bank link -> name institution -> select checking vs. savings)
//should return a promise
/*class BankSelector{
	constructor(){
		this.onNewConnectionCreated = ()=>{};
		this.promise = new Promise((res,rej)=> {this.onNewConnectionCreated = res;this.onCancel = rej})
		this.onConnectionSuccess = this.onConnectionSuccess.bind(this)
		this.onConnectionExit = this.onConnectionExit.bind(this)
		
	}
	present(){
		Core.presentModal(ModalTemplates.ModalWithComponent("Select your institution",<BankSelectorComponent controller={ModalManager.currentModalController} onSelect={b => {
			Core.dismissModal()
		}}/>,[])).then((b) => {
			if(b && b.state.selectedInstitution){
				let institution = b.state.selectedInstitution
				if(institution.connectorName==Connectors.plaid){
					ApiCaller.bankInitiateConnection(Connectors.plaid,{routingNumber:institution.routingNumbers[0],institutionId:institution.id}).then((r) => {
						Core.presentModal(ModalTemplates.ModalWithComponent("Loading Plaid",<BankSelectorContainer>
							<PlaidLinkLoader token={r.link_token} onSuccess={(public_token,metadata) => this.onConnectionSuccess(public_token)} 
												onExit={this.onConnectionExit}/>
						</BankSelectorContainer> ,[])).catch(e => console.log("Exiting Plaid"))
					})
				}else if(institution.connectorName==Connectors.powens){
					//Powens Code
				}
			}
		}).catch(e => this.onCancel())
		return this.promise
	}
	onConnectionSuccess(token){//Later: should resolve the promise of the plaid screen flow and move to the next page
		Core.dismissModal()
			.then(() => Core.presentModal(ModalTemplates.ModalWithSingleInput("What should we name this connection?")))
			.then(r => r.state.inputValue)
		    .then(friendlyName => ApiCaller.bankExchangeTokenAndSaveConnection(token,friendlyName))
		    .then(() => this.onNewConnectionCreated())//doesn't call reload in bank settings but should
		    .catch(err => this.onCancel("Connection creation failed"))
	}
	onConnectionExit(){Core.dismissModal()}//should really go back to bank select
}
*/


export const PlaidLinkLoader = (props) => {
	const {token,onSuccess,onExit} = props;
	const { open, ready } = usePlaidLink({token,onSuccess,onExit});
 	open()
  	return (<div/>);
};


let bankFrontPageList = []

//sole job of this component: select a bank and return its institution. Should be presented in a flow (to design)
export class BankSelectorComponent extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {
			fetching:true,
			bankList:bankFrontPageList,
			invisible:!this.isDataLoaded(),//don't start invisible if the data is already loaded
		}
		this.onSearchInputChanged = this.onSearchInputChanged.bind(this)
		this.searchInputTimer = null;
		this.searchInputTimerTimeout = 400 //time that should have no keystrokes to send the search request
	}
	componentDidMount(){this.loadData()}
	isDataLoaded(){return bankFrontPageList.length>0}
	onSearchInputChanged(e){
		if(this.searchInputTimer){clearTimeout(this.searchInputTimer)}
		this.searchInputTimer = setTimeout(() => {
			let s = e.target.value
			if(s.length>0){
				this.updateState({searching:true}).then(() => ApiCaller.getSupportedInstitutions(s))
				.then(r => this.updateState({searching:false, bankList: r}))
			}else{this.updateState({searching: false, bankList: bankFrontPageList})}
		},this.searchInputTimerTimeout)
	}
	loadData(){
		return (this.isDataLoaded()?Promise.resolve():
					ApiCaller.getSupportedInstitutions().then(r => bankFrontPageList = r))
		.then(() => this.updateState({fetching:false,bankList:bankFrontPageList}))
		.then(() => setTimeout(() => this.updateState({invisible: false})),50)//needed for smooth fade in
	}
	render(){return(
		this.state.fetching?<PageCenterer><DS.component.Loader/></PageCenterer>:
		<BankSelectorContainer invisible={this.state.invisible}>
			<div><DS.component.Input placeholder="Search" textAlign="left" onChange={this.onSearchInputChanged}/></div>
			{this.state.searching?<PageCenterer><DS.component.Loader/></PageCenterer>:this.state.bankList.length>0?<DS.component.ScrollableList>{
				this.state.bankList.map((b,i) => <DS.component.ListItem fullBleed key={i} onClick={(e) => this.props.onSelect(b)}>
					{b.logo?<DS.component.Avatar src={`data:image/png;base64,${b.logo}`}/>:<DS.component.AvatarIcon iconName="bank" style={{color: DS.getStyle().modalPrimaryButton}}/>}
					<DS.component.Label>{b.name}</DS.component.Label>
					<DS.component.Spacer/>
					<DS.component.Button.Icon iconName="caretDown" style={{transform:"rotate(-"+90+"deg)"}}/>	
				</DS.component.ListItem>)
			}</DS.component.ScrollableList>:<PageCenterer><DS.component.Label secondary>Sorry, we couldn't find a bank with this name.</DS.component.Label></PageCenterer>}
		</BankSelectorContainer>
		
	)}
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
    margin-bottom: ${props => DS.spacing.l}rem;
    opacity: ${props => props.invisible?0:1};
    transition: opacity 0.5s;
    flex-shrink: 0;
    flex-grow: 1;
`
