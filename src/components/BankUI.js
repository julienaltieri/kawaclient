import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import ApiCaller from '../ApiCaller'
import DS from '../DesignSystem'
import {Flow,FlowStep} from './Workflow'
import {usePlaidLink} from "react-plaid-link";
import {BankConnectionStatuses,getBankErrorMessage,AccountTypes,Connectors} from '../Bank.js'
import { createMachine, createActor } from 'xstate';
import Core from '../core'


//This file implements the bank selection logic, meant to be presented in a modal or workflow. It's scope is only the component that enables bank selection. 

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
		if(this.searchInputTimer){clearTimeout(this.searchInputTimer)} //this avoids doing an API call on every key stroke as the user is typing
		let s = e.target.value
		if(s.length==0){this.updateState({searching: false, searchMode:false, bankList: bankFrontPageList})}
		else{
			this.searchInputTimer = setTimeout(() => this.updateState({searching:true, searchMode:true})
				.then(() => ApiCaller.getSupportedInstitutions(s))
				.then(r => this.updateState({searching:false, bankList: r}))
			,this.searchInputTimerTimeout)
		}
	}
	loadData(){
		return (this.isDataLoaded()?Promise.resolve():ApiCaller.getSupportedInstitutions()
			.then(r => bankFrontPageList = r))
			.then(() => this.updateState({fetching:false,bankList:bankFrontPageList}))
			.then(() => setTimeout(() => this.updateState({invisible: false})),50)//needed for smooth fade in
	}
	render(){return(
		this.state.fetching?<PageCenterer><DS.component.Loader/></PageCenterer>:
		<BankSelectorContainer invisible={this.state.invisible}>
			<DS.component.SearchBar placeholder="Search" placeholderIcon="search" textAlign="left" onChange={this.onSearchInputChanged}/>
			<DS.component.Spacer size="xxs"/>
			{this.state.searchMode?this.state.searching?<PageCenterer><DS.component.Loader/></PageCenterer>:this.state.bankList.length>0?<DS.component.ScrollableList>{
				this.state.bankList.map((b,i) => <DS.component.ListItem fullBleed key={i} onClick={(e) => this.props.onSelect(b)}>
					{b.logo?<DS.component.Avatar src={`data:image/png;base64,${b.logo}`}/>:<DS.component.AvatarIcon iconName="bank" style={{color: DS.getStyle().modalPrimaryButton}}/>}
					<DS.component.Label>{b.name}</DS.component.Label>
					<DS.component.Spacer/>
					<DS.component.Button.Icon iconName="caretDown" style={{transform:"rotate(-"+90+"deg)"}}/>	
				</DS.component.ListItem>)
			}</DS.component.ScrollableList>:<PageCenterer><DS.component.Label secondary>Sorry, we couldn't find a bank with this name.</DS.component.Label></PageCenterer>
			:<DS.component.ScrollableGrid>{//front page display as a grid
				this.state.bankList.map((b,i) => <DS.component.GridItem key={i} onClick={(e) => this.props.onSelect(b)}>
					{b.logo?<DS.component.Avatar src={`data:image/png;base64,${b.logo}`}/>:<DS.component.AvatarIcon iconName="bank" style={{color: DS.getStyle().modalPrimaryButton}}/>}
					<DS.component.Label style={{textOverflow:"unset",textWrap:"wrap"}}>{b.name}</DS.component.Label>
					<DS.component.Spacer/>
				</DS.component.GridItem>)
			}</DS.component.ScrollableGrid>
		}
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
	setMachine(){return createMachine({
			id: 'NewBankCo',
			initial:'selectBank',
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
						title: "Loading",
						renderable: <AggregatorConnectorStep parentFlow={this}/>,
					}
				},
				nameConnection:{
					on: {
						SUBMIT: {target: 'success'},
						CANCEL: {target:'fail'} 
					},
					meta: {
						title: "Name this connection",
						renderable: <NewBankConnectionNameStep parentFlow={this}/>,
					}
				},
			}
		})
	}
}



//steps
export class BankSelectorStep extends FlowStep{
	onSubmit(selectedInsitution){
		this.updateContext({institution: selectedInsitution})
		this.transitionWith('SELECT')
	}
	renderContent(){return(<BankSelectorComponent onSelect={this.onSubmit}/>)}
}

export class AggregatorConnectorStep extends FlowStep{
	constructor(props){
		super(props)
		this.state = {...this.state,fetching:true}
	}
	componentDidMount(){
		let debug = false
		if(debug){setTimeout(() => this.onSubmit('fakeToken'),1000)}
		else {
			if(!this.props.parentFlow.updateModeToken){
				ApiCaller.bankInitiateConnection(Connectors[this.getContext().institution.connectorName],{routingNumber:this.getContext().institution.routingNumbers[0],institutionId:this.getContext().institution.id})
				.then(({link_token}) => this.updateState({link_token:link_token,fetching:false}))
			}else{this.updateState({fetching:false})}
		}
	}
	onSubmit(public_token){
		this.updateContext({public_token : public_token})
		this.transitionWith('CONNECTED')
	}
	renderContent(){
		//TODO: when implementing another connector, add the other connector UI here
		return(this.state.fetching?<DS.component.Loader/>:<PlaidLinkLoader token={this.props.parentFlow.updateModeToken || this.state.link_token} 
		onSuccess={(public_token,metadata) => this.onSubmit(public_token)} onExit={this.onFail}/>)
	}
}

export class NewBankConnectionNameStep extends FlowStep{
	constructor(props){
		super(props)
		this.onChangeInputValue = this.onChangeInputValue.bind(this)
	}
	getButtons(){return [
		{name:'continue',primary:true}, //default action for primary is onSubmit
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


//Update bank connection flow
export class UpdateBankConnectionFlow extends Flow{//a class defining the flow logic (state machine)
	constructor(updateModeToken){
		super()
		this.updateModeToken = updateModeToken
	}
	setMachine(){return createMachine({
			id: 'UpdateBankCo',
			initial:'aggregatorUpdate',
			states:{
				success:{type: "final"},
				fail: {type: "final"},
				aggregatorUpdate:{
					on: {
						CONNECTED: {target: 'success'},
						FAIL: {target:'fail'},
						CLOSE: {target:'fail'}
					},
					meta: {
						title: "Loading",
						renderable: <AggregatorConnectorStep parentFlow={this}/>,
					}
				}
			}
		})
	}
}






