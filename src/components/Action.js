import styled, { keyframes } from 'styled-components'
import BaseComponent from './BaseComponent';
import DS from '../DesignSystem.js'
import {PlaidLink} from "react-plaid-link";
import {relativeDates} from '../Time'
import { fadeIn } from 'react-animations' 
import TransactionTypes from '../TransactionTypes'
import Core from '../core.js';
import utils from '../utils'
import {UpdateBankConnectionFlow} from './BankUI.js'
import ApiCaller from '../ApiCaller'
import {getBankErrorMessage} from '../Bank.js'


export const ActionStyles = {
	moveOutOfTheWayAnimationTime : 500,
	cardRemPadding : 0,
	sideRemMargins: 1,
	cardRemSpacing : 0.5,
	cardContentWidth : 26
}

export class Action{
	constructor(id,appContext,startsOutOfTheWay,onActionConcluded){
		this.id = id
		this.appContext = appContext
		this.reactComponent = undefined
		this.isVisible = true
		this.startsOutOfTheWay = false || startsOutOfTheWay
		this.onActionConcluded = onActionConcluded //callback to call when action is concluded and should be consumed
	}
	renderComponent(inFocus){
		return (<ActionCard startsOutOfTheWay={this.startsOutOfTheWay} appContext={this.appContext} inFocus={inFocus} id={this.id} key={this.id} parentAction={this}/>)
	}
	willEnterInFocus(){return Promise.resolve()}//to override - called right before the previous element enters in focus
	getSortValue(){}//to override - value used by the queue to sort all actions
}


export class ActionCard extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {
			visible: true,
			moveOutOfTheWay: props.startsOutOfTheWay,
			shouldHide:false
		}
		this.props.parentAction.reactComponent = this;
		this.getNoLeftMargin = this.getNoLeftMargin.bind(this)
	}
	componentDidMount(){if(this.props.startsOutOfTheWay){setTimeout(() => this.updateState({moveOutOfTheWay:false}),50)}}
	willEnterInFocus(){return Promise.resolve()}//to overide to customize
	preExitAnimation(){//to overide to customize
		return new Promise((res,rej)=> {
			this.updateState({visible:false},() => {
				setTimeout(res,ActionStyles.moveOutOfTheWayAnimationTime)
			})
		})
	}
	getNoLeftMargin(){return this.props.appContext.state.actionQueueManager.queue.length <=2}
	renderContent(){return ""}//to override to include content
	render(){return (
		<ActionViewContainer noMargin={this.getNoLeftMargin()} style={{display:this.state.shouldHide?"none":"inherit",opacity: (this.state.visible&&!this.state.moveOutOfTheWay?1:0),
			marginRight: (this.state.moveOutOfTheWay?-(ActionStyles.cardRemPadding*2+ActionStyles.cardRemSpacing+ActionStyles.cardContentWidth)+"rem":ActionStyles.cardRemSpacing+"rem")}}>
			<ActionViewContentContainer style={{width:"calc(100vw - "+ActionStyles.sideRemMargins*2+"rem)",opacity: (this.state.visible?1:0)}}>
				{this.renderContent(this.props.inFocus)}
			</ActionViewContentContainer>
		</ActionViewContainer>
	)}
}




const ActionViewContainer = styled.div `
	text-align: center;
	display: flex;
    box-sizing: border-box;
	padding:${props => ActionStyles.cardRemPadding}rem;
    border-radius: ${props => DS.borderRadius};
    transition: margin-right ${props => ActionStyles.moveOutOfTheWayAnimationTime/1000}s ease-out, opacity ${props => ActionStyles.moveOutOfTheWayAnimationTime/1000}s ease-out 0.2s;
`


const ActionViewContentContainer = styled.div `
    transition: opacity ${props => ActionStyles.moveOutOfTheWayAnimationTime/1000}s ease-out;
    max-width: ${props => ActionStyles.cardContentWidth-1}rem;
`


export const ActionsContainerBox = styled.div `
	margin-top: 5rem;
    display: flex;
    margin: 5rem auto;
    flex-wrap: wrap;
    flex-direction: row;
    flex-grow:1;
    justify-content: center;
    transition: opacity 0.3s ease;
`

/**************************************/



/******Sample implementation*******/

class YesNoAction extends Action{
	//note the function renderComponent() and not render()
	renderComponent(inFocus){return (<YesNoActionCard startsOutOfTheWay={this.startsOutOfTheWay} appContext={this.appContext} inFocus={inFocus} id={this.id} key={this.id} parentAction={this}/>)}
}


class YesNoActionCard extends ActionCard{
	onAnswer(a){
		//do stuff here
		//...
		//trigger consume animation
	}
	//note the function renderContent() and not render()
	renderContent(inFocus){
		return <div>
			<div>Answer this question? {this.props.id}</div>
			<ActionsContainerBox>{
				<a onClick={e => this.onAnswer("Yes")}>Yes</a>		
			}</ActionsContainerBox>
		</div>
	}
}

/**************************************/

export class EmptyStateAction extends Action{
	getSortValue(){return relativeDates.oneYearInTheFuture().getTime()}//always sits at the end
	renderComponent(inFocus){return (<EmptyStateCard inFocus={inFocus} id={this.id} key={this.id} parentAction={this}/>)}
}

class EmptyStateCard extends ActionCard{
	getNoLeftMargin(){return true}
	renderContent(inFocus){
		return <ActionsContainerBox style={{opacity: 0,height: "5rem",alignContent: "center",padding: "2rem",backgroundColor: DS.getStyle().UIElementBackground,borderRadius: DS.borderRadius,"marginTop":"0"}}>
			All done!
		</ActionsContainerBox>
	}
}


/**************************************/ 
/*Bank reconnection card 
/**************************************/

export class BankReconnectAction extends Action{
	constructor(id,appContext,startsOutOfTheWay,onActionConcluded,connectionData){
		super(id,appContext,startsOutOfTheWay,onActionConcluded)
		this.connectionData = connectionData
	}
	getSortValue(){return new Date("01/01/1980").getTime()+this.id}//always sits at the end
	renderComponent(inFocus){return (<BankReconnectActionCard appContext={this.appContext} startsOutOfTheWay={this.startsOutOfTheWay} inFocus={inFocus} id={this.id} key={this.id} parentAction={this} data={this.connectionData}/>)}
}



class BankReconnectActionCard extends ActionCard{
	constructor(props){
		super(props)
		this.presentBankUpdateFlow = this.presentBankUpdateFlow.bind(this)
	}
	presentBankUpdateFlow(){
		return UpdateBankConnectionFlow.Summon({
			itemId: this.props.data.itemId,
      		connectorName: this.props.data.connectorName
		})
		.then(() => this.props.parentAction.onActionConcluded(this.props.parentAction))
		.catch(e => console.log("Flow didn't complete",e))
	}
	renderContent(inFocus){
		return <ActionsContainerBox style={{opacity: (inFocus?1:0.5),height: "5rem",alignContent: "center",padding: "2rem",backgroundColor: DS.getStyle().alert,color:"white", borderRadius: DS.borderRadius,"marginTop":"0"}}>
			{this.props.data.name}: {getBankErrorMessage(this.props.data)}<br/><br/>
            {this.state.working?<DS.component.Loader/>:<span><DS.component.Button.Action small onClick={this.presentBankUpdateFlow}>Continue</DS.component.Button.Action></span>}
		</ActionsContainerBox>
	}
}


/**************************************/
/*Transaction clarification card
/**************************************/

export class TransactionTypeClarificationAction extends Action{
	constructor(id,appContext,startsOutOfTheWay,transaction,allocation,onActionConcluded){
		super(id,appContext,startsOutOfTheWay,onActionConcluded);
		this.transaction = transaction;
		this.allocatedStream = Core.getStreamById(allocation.streamId);
	}
	getSortValue(){return this.transaction.date.getTime()}
	renderComponent(inFocus){return (<TransactionTypeClarificationActionCard appContext={this.appContext} allocatedStream={this.allocatedStream} inFocus={inFocus} id={this.id} key={this.id} parentAction={this} transaction={this.transaction} startsOutOfTheWay={this.startsOutOfTheWay}/>)}
}

class TransactionTypeClarificationActionCard extends ActionCard{
	constructor(props){
		super(props)
		this.onChange = this.onChange.bind(this)
		this.handleOnSuccess = this.handleOnSuccess.bind(this)
	}
	handleOnExit(){console.log("exit")}
	handleOnSuccess(){this.props.parentAction.onActionConcluded(this.props.parentAction,this.state.selectedType)}// transaction type
	onChange(e,type){this.updateState({selected:true,selectedType:type})}
	renderContent(inFocus){
		return <FadeInWrap><ActionsContainerBox style={{opacity: (inFocus?1:0.5),height: "auto",alignContent: "center",padding: "2rem",marginBottom:"",backgroundColor: DS.getStyle().UIElementBackground,color:"white", borderRadius: DS.borderRadius,"marginTop":"0"}}>
			<div style={{display:"flex",flexDirection:"column"}}>
				<div style={{display:"flex",width:"100%", flexDirection:"column",marginBottom:"1rem"}}>
					<div style={{marginBottom:"0.5rem"}}>What best describes this transaction?</div>
					<div style={{display:"flex",justifyContent:"space-between",backgroundColor:DS.getStyle().UIElementBackground,padding:"0.5rem",margin:"0.5rem",borderRadius:"0.2rem"}}>
						<div>
							<span>{this.props.transaction.description}</span>
							<div style={{marginTop:"0.2rem",fontSize:"0.7rem",textAlign:"left"}}>{utils.formatDateShort(this.props.transaction.date)}</div>
						</div>
						<div style={{display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
							<span>{utils.formatCurrencyAmount(this.props.transaction.evaluator.getAllocationForStream(this.props.allocatedStream)?.amount,null,null,null,Core.getPreferredCurrency())}</span>
							<DS.component.StreamTag>{this.props.allocatedStream.name}</DS.component.StreamTag>					
						</div>
					</div>
					
				</div>
				<div>
					<fieldset id="txnType">
						{[TransactionTypes.transferFromDisconnectedSavings, TransactionTypes.movedFromDisconnectedCheckingToSavings, TransactionTypes.incomeToSavings].map(type => {
							return (<div key={type.code} style={{marginBottom:"0.2rem"}}>
								<DS.component.Label size="xs" highlight style={{display:"flex", textAlign:"left", alignItems:"center"}}>     
							    	<input onChange={e => this.onChange(e,type)} type="radio" id={type.code} name="txnType" value={type.description} style={{width:"1rem",height:"1rem",margin:"0"}}/>
							    	<div style={{marginLeft:"0.3rem",alignSelf:"center",lineHeight:"1rem"}}>{type.shortDescription}</div>
								</DS.component.Label>
							</div>)
						})}
					</fieldset>
				</div>
				<div style={{marginTop:"1rem"}}>
					<DS.component.Button.Action primary onClick={this.handleOnSuccess} disabled={!this.state.selected}>Confirm</DS.component.Button.Action>
				</div>
			</div>
		</ActionsContainerBox></FadeInWrap>
	}
}

const fadeInAnimation = keyframes`${fadeIn}`;
const FadeInWrap = styled.div`
	animation: 0.5s ${fadeInAnimation};
`
const StreamTag = styled.div`
	background-color: ${props => props.highlight?DS.getStyle().commonTag:DS.getStyle().specialTag};
	padding: 0.2rem 0.4rem ;
	margin:0.2rem;
	border-radius: 100vw;
	font-size: 0.7rem;
	opacity:0.8;
`
/**************************************/