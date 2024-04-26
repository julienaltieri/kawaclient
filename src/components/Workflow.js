import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import Core from '../core'
import utils from '../utils'
import DS from '../DesignSystem'
import ApiCaller from '../ApiCaller'
import { createMachine, createActor } from 'xstate';


/*features of workflows
+ return promises upon completion with context 
+ can be easily chained and reordered
+ steps and subflows are homogeneous and can be used interchangably
+ embedded as part of the UI / presented in a specific component (should work in a modal or plain page)
+ should handle back arrow navigation when allowed.
*/

let pageTransitionAnimationTime = 300


export default class WorkflowPresenter extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {...this.state, displayedStep:undefined}
		this.onClickBackButton = this.onClickBackButton.bind(this)
		this.onClickCloseButton = this.onClickCloseButton.bind(this)
	}
	componentDidMount(){
		this.props.workflow.actor.subscribe((snapshot) => this.updateState({displayedStep:this.props.workflow.getStateMeta()}))//rerenders the page on each state machine state change
		this.props.workflow.presentIn(this).then(this.props.controller.onComplete).catch(this.props.controller.onFail)//starts the flow promise
	}
	backAllowed(){return this.props.workflow.getCurrentState().can({type: 'BACK'})}
	closeAllowed(){return this.props.workflow.getCurrentState().can({type: 'CLOSE'})}
	onClickBackButton(e){if(this.backAllowed()){this.props.workflow.actor.send({type: 'BACK'})}}
	onClickCloseButton(e){if(this.closeAllowed()){this.props.controller.onFail()}}
	render(){
		return (<FlowPageContainer>
			<FlowNavBar>
				<DS.component.Button.Icon onClick={this.onClickBackButton} iconName={this.backAllowed()?"leftArrow":"placeholder"}/>
				<DS.component.ModalTitle  mobileCentered>{this.state.displayedStep?.title}</DS.component.ModalTitle>
				<DS.component.Button.Icon onClick={this.onClickCloseButton} iconName={this.closeAllowed()?"close":"placeholder"}/>
			</FlowNavBar>
			<FlowSlideContainer>
				<Page>{this.state.displayedStep?.renderable}</Page>
			</FlowSlideContainer>
		</FlowPageContainer>)
	}
}

const FlowPageContainer = styled.div`
    transition: opacity ${props => pageTransitionAnimationTime/1000}s;
    height:100%;
    display: flex;
    flex-direction: column;
`

const Page = styled.div`
	width: 100%;
    flex-shrink: 0;
    display:flex;
    flex-direction: column;
`

const FlowSlideContainer = styled.div`
	display: flex;
    flex-direction: row;
    overflow: hidden;
    justify-content: flex-start;
`

const FlowNavBar = styled.div`	
	display: flex;
	flex-direction: row;
	justify-content: space-between;
	margin-top: ${props => Core.isMobile()?0:0}rem;
    margin-bottom: ${props => Core.isMobile()?2:2.5}rem;
    align-items: center;
`

//meant to be a higher-level Flow comprised of subflows or steps
export class Flow{
	constructor(){
		this.machine = this.setMachine()
		if(!this.machine){throw new Error("A Flow subclass must implement a setMachine method that returns a XState state machine. This is error likely happenning because you didn't override the method setMachine.")}
		this.actor = createActor(this.machine)
		this.shouldAllowDismiss = this.shouldAllowDismiss.bind(this)
	}
	setMachine(){/*override, return createMachine(_config_) */}
	getStateMeta(){//returns most of what we're interested in a state
		let s = this.getCurrentState()
		return s?.getMeta()[`${s.machine.id}.${s.value}`]
	}
	getContext(){return this.getCurrentState().context}
	getCurrentState(){return this.actor?.getSnapshot()}
	shouldAllowDismiss(){return this.getCurrentState().can({type: 'CLOSE'})}
	updateContext(updates){ this.getCurrentState().context = {...this.getContext(), ...updates} }
	presentIn(presenter){/*return a promise that resolves if the flow is complete (defined by the state machine)*/ 
		return new Promise((res,rej) => {
			this.actor.subscribe((snapshot) => {
				if(snapshot.status == 'done'){
					if(snapshot.value == 'success'){res(snapshot.context)}
					else if(snapshot.value == 'fail'){rej(snapshot.context)}
				}
			});
			this.actor.start()
		})
	}
}

export class FlowStep extends BaseComponent{
	constructor(props){
		super(props);
		this.onSubmit = this.onSubmit.bind(this)
		this.onFail = this.onFail.bind(this)
		this.state = {primaryButtonDisabled:true}
	}
	//I/O methods: use if needed, already bound
	onSubmit(){}
	onFail(){this.transitionWith('FAIL')}
	
	//convenience
	getContext(){return this.props.parentFlow.getContext()}
	transitionWith(event){return this.props.parentFlow.actor.send({type:event})}
	updateContext(updates){return this.props.parentFlow.updateContext(updates)}

	//page configuration
	renderContent(){return("")}//use to render the page. Must not include title or buttons 
	getButtons(){return []}//[{primary,name,action}] 

	//do not override, use the renderContent method instead to render the inside of the page
	render(){return(<FlowStepContainer>
		{this.renderContent()}
		{this.getButtons().length>0?<DS.component.ButtonGroup>{
			this.getButtons().sort((a,b) => a.primary?1:-1).map((b,i) => <DS.component.Button.Action style={{marginTop:DS.spacing.xs+"rem"}} primary={b.primary} key={i} disabled={b.primary && this.state.primaryButtonDisabled} 
				onClick={(e)=>{
					if(b.primary && this.state.primaryButtonDisabled){return}
					else if(b.action){b.action()}
					else if(b.primary){this.onSubmit()}
				}}>{b.name}</DS.component.Button.Action>)
		}</DS.component.ButtonGroup>:""}
	</FlowStepContainer>)}
}

const FlowStepContainer = styled.div`
	height:100%;
	display:flex;
	flex-direction:column;
	justify-content:space-between;
`



/*// Example of how to create a account creation flow
import { createMachine, createActor } from 'xstate';

//Account Creation Flow
export class AccountCreationFlow extends Flow{//a class defining the flow logic (state machine)
	setMachine(){return createMachine({
			id: 'accountCreation',
			initial:'enterName',
			states:{
				success:{type: "final"},
				fail: {type: "final"},
				enterName:{
					on: {
						SUBMIT:  {target: 'enterEmail'},
						CLOSE: {target:'fail'}
					},
					meta: {
						title: "What's your name?",
						renderable: <NameInputStep parentFlow={this}/>,
					}
				},
				enterEmail:{
					on: {
						BACK: {target: 'enterName'},
						SUBMIT: {target: 'success'}
					},
					meta: {
						title: "What's your email?",
						renderable: <NameInputStep parentFlow={this}/>,
					}
				}
			}
		})
	}
}

export class NameInputStep extends FlowStep{
	constructor(props){
		super(props)
		this.onChangeInputValue = this.onChangeInputValue.bind(this)
	}
	onSubmit(name){
		this.updateContext({name: name})
		this.transitionWith('SUBMIT')
	}
	getButtons(){return [
		{name:'continue',primary:true}, //default action for primary is onSubmit
	]}
	onChangeInputValue(e){
		this.updateContext({name:e.target.value})
		//validation
		if(this.state.primaryButtonDisabled && e.target.value.length>0){this.updateState({primaryButtonDisabled:false})}
		else if(!this.state.primaryButtonDisabled && e.target.value.length == 0){this.updateState({primaryButtonDisabled:true})}
	}
	renderContent(){return(<div><DS.component.Input onChange={this.onChangeInputValue}/></div>)}
}

*/