import BaseComponent from './components/BaseComponent'
import ReactDOM from 'react-dom';
import Core from './core.js'
import styled from 'styled-components'
import {CategorizationModalView} from './components/CategorizationRulesView'
import DesignSystem from './DesignSystem.js'
const transactionGrouper = require('./processors/TransactionGrouper')
const utils = require('./utils.js')

/* A quick manual because this modal management is super complicated - One day, let's refactor it
- Modals are promises that return once the modal is responded (cancel, confirm etc)
- The App renders a component called ModalContainer when a modal is active (aka, when it holds a ModalController in its state)
- The ModalContainer and ModalController classes are defined in this file
- The ModalContainer is meant to represent the View of an MVC, and is a React component
- The ModalController is  meant to represent the Controller of an MVC, holding informations such as the state etc
- The ModalContainer is designed to be "inflated" with a template. Templates aren't components though, they're fragments of a render function - this makes state management complicated
- The ModalTemplates object contains a bunch of templates for various situations. The most generic one is ModalWithComponent
- ModalWithComponent is great for custom implementations that can hold a state, but require a specific treatment for the promise callback Then() to return the state of the component. See example with SingleInput
*/

const animationTime = 200//on mobile, controls the speed at which the modal comes from the bottom

class ModalManager{
	presentModalIn(modalController,component){//component must implement presentModal(modal) and unmountModal(modal) methods
		this.currentModalController = modalController
		modalController.setParent(component);
		component.presentModal(modalController);
		return modalController.then()
	}

	dismissModal(modalController){
		modalController.getParent().unmountModal(modalController)
	}
	updateState(changes){this.setState({...this.state,...changes})}		
}

export const ModalTemplates = {
	BaseModal: (title,message,buttonArray) => (that)=> {
		return ModalTemplates.ModalWithComponent(title,<div>{message}</div>,buttonArray)(that)
	},
	ModalWithSingleInput: (title,buttonArray) => (that)=> {
		if(!buttonArray)buttonArray = [{name:"Confirm",primary:true}]
		return ModalTemplates.ModalWithComponent(title,<SingleInput controller={instance.currentModalController}/>,buttonArray)(that)
	},
	ModalWithStreamTransactions: (title,message,stream) => (that) => {
		return ModalTemplates.ModalWithComponent(title,<div>
			<div>{message}</div>
			<StreamTransactionView controller={instance.currentModalController} stream={stream} key={stream.id}/>
		</div>)(that)
	},
	ModalWithCategorizationRule: (title,message,rule) => (that) => {
		return ModalTemplates.ModalWithComponent(title,<div>
			<div>{message}</div>
			<CategorizationModalView controller={instance.currentModalController} rule={rule} />
		</div>,[{name:"Cancel"},{name:"Save",primary:true}])(that)
	},
	ModalWithTransactions: (title,message,transactions,buttonArray) => (that) => {
		return ModalTemplates.ModalWithComponent(title,<div>
			<div>{message}</div>
			<TransactionsModalView controller={instance.currentModalController} transactions={transactions} />
		</div>,buttonArray)(that)
	},
	ModalWithStreamAllocationOptions: (title,message,buttonArray,transaction,streamRecs) => (that) => {
		return ModalTemplates.ModalWithComponent(title,<div>
			<div>{message}</div>
			<StreamAllocationOptionView controller={instance.currentModalController} transaction={transaction} streamRecs={streamRecs}/>
		</div>,buttonArray)(that)
	},
	ModalWithComponent: (title,component,buttonArray) => (that)=> {
		if(!buttonArray){buttonArray = [{name:"Cancel"},{name:"Confirm",primary:true}]}

		return (<BaseModalWrapper>
				<TopBar>
					{/*<div style={{width: "1rem"}}></div>*/}
					<Title>{title}</Title>
					{<TopBarButton onClick={(e) => that.state.controller.onDismiss(e)}>✕</TopBarButton>}
				</TopBar>
				<MainContent>{component}</MainContent>
				<ActionButtons>
					{buttonArray.map((b,i) => {
						return <ActionButton primary={b.primary} key={i} disabled={b.primary && that.state.controller.state.primaryButtonDisabled} onClick={(e)=>(b.primary && that.state.controller.state.primaryButtonDisabled)?false:that.state.controller.onConfirm(e,i)}>{b.name}</ActionButton>
					})}
				</ActionButtons>
			</BaseModalWrapper>
		)
	}	
}


export class StreamAllocationOptionView extends BaseComponent{
	constructor(props){
		super(props)
		this.state={
			controller: props.controller,
			allocationNumber: this.props.transaction.streamAllocation?.length || 2,
			allocations: this.props.transaction.streamAllocation?JSON.parse(JSON.stringify(this.props.transaction.streamAllocation)).map((a,i)=>{a.nodeId=i;a.type="value";return a}) 
						:[{streamId: (props.streamRecs.length>0)?props.streamRecs[0].id:undefined,amount: this.props.transaction.amount,type:"value",nodeId:0},
			{streamId: undefined,amount: 0,type:"value",nodeId:1}]
		}
		this.firstTimeMinusAttempt= true;//used to match the minus sign if needed
		this.state.controller.state.modalContentState = {...this.state.controller.state.modalContentState,...this.state}
		this.setPrimaryButtonDisabled(true);
	}
	postStateUpdateCallback(){
		this.state.controller.state.modalContentState = {...this.state.controller.state.modalContentState,...this.state}
		this.validate();
	}
	handleOnClickAddAllocation(e){
		var n = this.state.allocationNumber
		this.updateState({allocationNumber:n+1,allocations:[...this.state.allocations,{streamId:"",amount:0,type:"value",nodeId: n+1}]},this.postStateUpdateCallback)
	}
	handleOnClickRemoveAllocation(e,i){
		this.state.allocations.splice(i,1);
		var totalAmount = this.props.transaction.amount
		this.state.allocations[0].amount = Math.round(100*(totalAmount -utils.sum(this.state.allocations.slice(1), a => a.amount)))/100;
		this.updateState({allocations:[...this.state.allocations]},this.postStateUpdateCallback)
	}
	handleOnChangeValue(e,i){
		var x = (e.target.value==""||e.target.value=="-")?0:parseFloat(e.target.value);
		var totalAmount = this.props.transaction.amount

		this.state.allocations[i].amount = x;
		this.state.allocations[0].amount = Math.round(100*(totalAmount -utils.sum(this.state.allocations.slice(1), a => a.amount)))/100;
		this.updateState({allocations:[...this.state.allocations]},this.postStateUpdateCallback)
	}
	handleOnValueBlur(e,i){
		var x = (["","-","."].indexOf(e.target.value)>-1)?0:parseFloat(e.target.value);
		e.target.value = x;
		this.state.allocations[i].amount = parseFloat(e.target.value);
		this.updateState({allocations:[...this.state.allocations]},this.postStateUpdateCallback);
	}
	handleOnInput(e,i){
		var shouldInsertMinus = this.firstTimeMinusAttempt && this.props.transaction.amount<0;//if amount is negative and this is the first attempt
		if(e.target.value == ""){shouldInsertMinus = false;this.firstTimeMinusAttempt = false}
		if(e.target.value.charCodeAt(0)=="+".charCodeAt(0)){shouldInsertMinus = false;this.firstTimeMinusAttempt = false}//if inserting a +, don't force the minus
		if(e.target.value.charCodeAt(0)=="-".charCodeAt(0)){shouldInsertMinus = false;}//if already a -, no need
    	if(shouldInsertMinus){e.target.value="-"+e.target.value}

    	e.target.value = e.target.value.replace(/^\.|[^-?\d\.]|\.(?=.*\.)|^0+(?=\d)/g, '').replace(/(\..*?)\..*/g, '$1');
	}
	handleStreamSelected(e,i){
		var s = Core.getStreamById(e.target.selectedOptions[0].getAttribute("sid"))
		this.state.allocations[i].streamId = s.id;
		delete this.state.allocations[i].streamName
		this.updateState({allocations:[...this.state.allocations]},this.postStateUpdateCallback);
	}
	setPrimaryButtonDisabled(b){this.state.controller.setPrimaryButtonDisabled(b)}
	validate(){
		this.setPrimaryButtonDisabled(//all streams should exist and have an allocated value
			!utils.and(this.state.allocations,al => Core.getMasterStream().hasTerminalChild(al.streamId) && !isNaN(al.amount) && al.amount!=0)
		);
	}

	getDropDownLabelForStreamId(id){
		var s = Core.getStreamById(id);
		return s.isActiveNow()?s.name:s.name+" (old)"
	}

	render(){

		return(<div>
			<div style={{display:"flex", flexDirection: "row", paddingBottom: "2rem", margin: "0 3.7rem",justifyContent: "space-between"

}}>
				<div style={{textAlign: "left"}}>
					{this.props.transaction.description}
				</div>
				<div style={{textAlign: "right"}}>
					<div style={{fontWeight: "bold"}}>{utils.formatDollarAmount(this.props.transaction.amount)}</div>
					<div>{utils.formatDateShort(this.props.transaction.getDateInDisplayTimezone())}</div>
				</div>
			</div>
			<div style={{display:"flex",justifyContent: "center"}}>
				<ul style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
					{this.state.allocations.map((al,i) => <li key={al.nodeId} style={{margin: "0.5rem 0rem", position: "relative"}}>
						{(i==0)?<StyledInput disabled positive={al.amount>0} value={al.amount.toFixed(2)}></StyledInput>:
								<StyledInput positive={al.amount>0} defaultValue={al.amount.toFixed(2)}
										onChange={((e)=> this.handleOnChangeValue(e,i)).bind(this)}
										onBlur={((e)=> this.handleOnValueBlur(e,i)).bind(this)}
										onInput={((e)=>this.handleOnInput(e,i)).bind(this)}
										onFocus={e => {e.target.select()}}></StyledInput>
									}
						{al.amount>0?<StyledSpendReceive style={{color:DesignSystem.getStyle().positive}}>received as</StyledSpendReceive>:<StyledSpendReceive>spent as</StyledSpendReceive>}
						<StyledDropDown style={{marginLeft:"0.5rem"}} 
							value={(this.state.allocations[i]?.streamId)?this.getDropDownLabelForStreamId(this.state.allocations[i].streamId):'DEFAULT'} 
							onChange={((e)=>this.handleStreamSelected(e,i)).bind(this)}>
							<option value='DEFAULT' disabled hidden> </option>
							{Core.getMasterStream().getAllTerminalStreams()
							.filter(s => s.isActiveAtDate(this.props.transaction.date) || s.isActiveAtDate(new Date()))
							.sort(utils.sorters.asc(s => s.name.charCodeAt()))
							.map((a,j) => <option key={j} sid={a.id}>{this.getDropDownLabelForStreamId(a.id)}</option>)}
						</StyledDropDown>
						<DownArrow shouldOffset={(i>0 && this.state.allocations.length>1)}></DownArrow>
						{(i>0 && this.state.allocations.length>1)?<span 
							style={{fontWeight: 600, cursor:"pointer",marginLeft:"1.5rem",padding:"0 0.5rem"}} 
							onClick={((e)=> this.handleOnClickRemoveAllocation(e,i)).bind(this)}>✕</span>:""}
						
						
					</li>)}
					<li style={{color:DesignSystem.getStyle().modalPrimaryButton,cursor:"pointer",marginTop:"1rem"}} onClick={this.handleOnClickAddAllocation.bind(this)}>🞢 Add line</li>

				</ul>
			</div>
		</div>)
	}
}
const StyledInput= styled.input`
	color:  ${(props) => props.positive?DesignSystem.getStyle().positive:"inherit"};
	background-color: ${DesignSystem.getStyle().inputFieldBackground};
    width: 6rem;
    height: 1.5rem;
    padding: 0.5rem;
	margin-left: 0.2rem;
    margin-right: 0.5rem;
    text-align: center;
    font-size: 1rem;
    border-radius: 0.2rem;
    border: 0.1rem solid #BDBDBD;
`
const StyledSpendReceive = styled.span`
    display: inline-block;
    width: 6rem;
    text-align: left;
    padding-left: 0.5rem;
    font-size: 1rem;
`
const StyledDropDown= styled.select`
	width: 16rem;
	background-color: ${DesignSystem.getStyle().inputFieldBackground};
	color: ${DesignSystem.getStyle().bodyText};
    padding: 0 1rem;
    height: 2.5rem;
    border-radius: 0.2rem;
    text-align: left;
    font-size: 1rem;
    border: 0.1rem solid #BDBDBD;
    cursor: pointer;
    appearance: none;
`

const DownArrow = styled.div`
    position: absolute;
    right: ${(props) => props.shouldOffset?"4.3rem":"1rem"};
    top: calc(50% - 0.15rem);
    border-left: 0.3rem solid transparent;
    border-right: 0.3rem solid transparent;
    border-top: 0.3rem solid #bdbdbd;
    cursor: pointer;
    pointer-events: none;
`

export class TransactionsModalView extends BaseComponent{
	render(){
		return(
			<div>
				<div style={{width:"20rem", minHeight:"5rem",margin:"auto",marginTop:"1rem",fontSize:"0.8rem","textAlign":"left", backgroundColor:"white"}}>
					<ul style={{marginTop:"1rem",fontWeight:"bold"}}>{this.props.transactions.length} transaction(s)
						{this.props.transactions.slice(0,5).map((t,i) => <div key={i} style={{fontWeight:"normal",display:"flex",borderBottom:"1px solid #eeeeee"}}>
								<div>{t.description.substring(0,20)}...</div><Spacer/>
								<div>{t.getDateInDisplayTimezone().toDateString()}</div><Spacer/>
								<div>{utils.formatDollarAmount(t.amount)}</div>
						</div>)}
						{(this.props.transactions.length>5)?<div style={{textAlign: "right",fontWeith:"100"}}>...and {this.props.transactions.length-5} other(s)</div>:""}
					</ul>
				</div>
			</div>
		)
	}
}

const Spacer = styled.div`
	flex-grow:1;
`


class SingleInput extends BaseComponent{
	constructor(props){
		super(props)
		this.state={
			inputValue:null,
			controller: props.controller
		}
	}
	handleOnChange(e){
		this.updateState({inputValue:e.target.value})
		this.state.controller.state.modalContentState = {...this.state.controller.state.modalContentState,...{inputValue:e.target.value}}
	}
	render(){
		return(
			<div><input onChange={this.handleOnChange.bind(this)}/>
			</div>
		)
	}

}

class StreamTransactionView extends BaseComponent{
	constructor(props){
		super(props)
		this.state={
			stream:props.stream,
			loading:true,
			grouping: {},
			controller: props.controller
		}
	}
	componentWillMount(){
		var start = this.state.stream.getOldestDate();
		var end = this.state.stream.getMostRecentDate();
		Core.getTransactionsBetweenDates(start,end).then(data => {
			var categorizedTxns = data.filter(t => t.categorized && t.isAllocatedToStream(this.state.stream));
			var res = transactionGrouper.clusterTransactions(categorizedTxns)
			var obj = Object.keys(res).map(k => {
				return {key: k,txns: utils.flatten(res[k]).sort(utils.sorters.asc(t => t.date)),include: true}
			})
			this.updateState({transactions:categorizedTxns, loading:false,grouping:obj})
		})
	}
	checkedBox(e,key){
		var newGrouping = this.state.grouping
		newGrouping.filter(g => g.key==key)[0].include = e.target.checked
		this.updateState({grouping:newGrouping})
	}
	updateState(changes){
		this.setState({...this.state,...changes});
		this.state.controller.state.modalContentState = {...this.state.controller.state.modalContentState,...changes}
	}
	render(){
		return (<div> {this.state.message}
		{this.state.loading?"Working...":(<TransactionListView>{this.state.grouping.map(g => (<TransactionListViewItem key={g.key}>
			<input type="checkbox" checked={g.include} onChange={(e) => this.checkedBox(e,g.key)} style={{marginRight:"0.3rem"}}></input>
			<div style={{flexGrow:"1"}}>{g.txns[0].description.toLowerCase().split(" ").slice(0,2).reduce(utils.reducers.stringConcat(undefined," "),"")}</div>
			<div>({g.txns.length} transaction{g.txns.length.length>1?"s":''})</div>
			</TransactionListViewItem>))}</TransactionListView>)}
	</div>)}
}

const TransactionListView= styled.ul`
	text-align: left;
    max-width: 20rem;
    margin: auto;
    margin-top: 1rem;
    background: ${DesignSystem.getStyle().inputFieldBackground};
    padding: 1rem;
    display: flex;
    flex-direction: column;
`
const TransactionListViewItem= styled.li`
	display: flex;
    flex-direction: row;
    align-items: center;
`

export class ModalController{
	constructor(getContent){
		this.promise = new Promise((res,rej)=> {this.onAnswer = res;this.onCancel = rej})
		this.getContent = getContent;
		this.state = {modalContentState:{}};
	}
	setParent(parent){this.parent = parent}
	getParent(){return this.parent}
	registerModal(modal){this.modal = modal; this.state.modalContentState = modal.state.content}
	then(){return this.promise.then.apply(this.promise, arguments)}
	hide(){
		this.modal.updateState({visible:false}).then(() => {
			setTimeout(() => instance.dismissModal(this),animationTime)//leaves time to play the animation
		})
	}
	setPrimaryButtonDisabled(b){
		this.state = {...this.state, ...{primaryButtonDisabled:b}};
		this.modal.refreshContent();
	}
	onDismiss(e){
		this.hide();
		this.onCancel();
		e.preventDefault();
		e.stopPropagation();
	}
	onConfirm(e,i){
		this.onAnswer({state:this.state.modalContentState,buttonIndex:i});
		this.hide();
		e.preventDefault();
		e.stopPropagation();
	}
}


export class ModalContainer extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {
			controller: props.controller,
			visible:false
		} 
		props.controller.registerModal(this)
	}
	componentDidMount(){this.setState({...this.state,visible:true,content:this.state.controller.getContent(this)})}
	refreshContent(){this.updateState({content:this.state.controller.getContent(this)})}
	render(){
		if(Core.isMobile()){
			return (<ModalWrapper visible={this.state.visible} data-dismiss="true" onClick={(e)=> {if(e.target.dataset.dismiss){this.state.controller.onDismiss(e)}}}>
				<ModalBaseMobile visible={this.state.visible}>
					{this.state.content}
				</ModalBaseMobile>
			</ModalWrapper>)
		}else{
			return (<ModalWrapper data-dismiss="true" onClick={(e)=> {if(e.target.dataset.dismiss)this.state.controller.onDismiss(e)}}>
				<ModalBase>
					{this.state.content}
				</ModalBase>
			</ModalWrapper>)
		}
	}
}




const ModalWrapper = styled.div`
	background: #00000036;
    width: 100%;
    height: 100%;
    position: fixed;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
	z-index: 3;
	opacity: ${props => props.visible?1:0};
    transition: ${animationTime/1000}s opacity;
`

const ModalBase = styled.div`
	background: ${DesignSystem.getStyle().modalBackground};
    position: relative;
    flex-grow: 0;
    width: 44rem;
    box-shadow: 0 3px 14px 8px #0000001f;
    border-radius: 0.1rem;
`
const ModalBaseMobile = styled.div`
	background: ${DesignSystem.getStyle().modalBackground};
    position: absolute;
    bottom:0;
    z-index:99;
    flex-grow: 0;
    width: 100vw;
    box-shadow: 0 3px 14px 8px #0000001f;
    border-radius: ${DesignSystem.borderRadius} ${DesignSystem.borderRadius} 0 0;
    transform: translateY(${props => props.visible?"0":"100%"});
    transition: ${animationTime/1000}s transform;
`


const TopBar = styled.div`
	width: 100%;
	height: 3rem;
	display: flex;
	justify-content: center;
    align-items: center;
    margin-bottom: 2.5rem;
`
const Title = styled.div`
	flex-grow:1;
	font-size:2rem;
	text-align: center;
	font-weight: bold;
`
const TopBarButton = styled.div`
	width: 1rem;
    cursor: pointer;
    position: absolute;
    top: 1.5rem;
    right: 1.5rem;
    color: #BDBDBD;
`

const BaseModalWrapper = styled.div`
	padding: 3rem;
    box-sizing: border-box;
    position: relative;
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
`
const ActionButtons = styled.div`
	width: 100%;
    align-self: flex-end;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    margin-top: 3.5rem;
    flex-direction: row;
 
`

const MainContent = styled.div`
	text-align: center;
	flex-grow:1;
`
const ActionButton = styled.div`
	background: ${(props) => props.primary?DesignSystem.getStyle().modalPrimaryButton:DesignSystem.getStyle().modalSecondaryButton};
    color: ${(props) => props.primary?"white":"default"};
    border: ${(props) => props.primary?"solid 1px #2f80ed":"solid 1px #BDBDBD"};
    padding: 1rem;
    border-radius: 0.2rem;
    width: 8rem;
    text-align: center;
    cursor: ${(props) => props.disabled?"default":"pointer"};
   	margin: 0 1rem;
   	font-size:1.3rem;
   	opacity: ${(props) => props.disabled?"0.5":"1"};
   	line-height: 1rem;
    vertical-align: middle;
    height:1rem;	
    &:hover {
	    background: ${(props) => props.disabled?props.primary?DesignSystem.getStyle().modalPrimaryButton:"white":props.primary?"#157eff":"#f9f9f9"};
	}
`



const instance = new ModalManager();
export default instance;
