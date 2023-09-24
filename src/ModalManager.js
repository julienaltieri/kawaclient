import BaseComponent from './components/BaseComponent'
import ReactDOM from 'react-dom';
import Core from './core.js'
import styled from 'styled-components'
import {CategorizationModalView} from './components/CategorizationRulesView'
import DesignSystem from './DesignSystem.js'
import {TransactionView} from './components/CategorizeAction'
import utils from './utils'
import SideBar from './components/SideBar'
import Navigation from './components/Navigation'


const transactionGrouper = require('./processors/TransactionGrouper')

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
		modalController.willShow();
		return modalController.then()
	}

	dismissModal(modalController){
		return modalController.getParent().unmountModal(modalController)
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
	ModalWithComponent: (title,component,buttonArray,subtitle) => (that)=> {
		if(!buttonArray){buttonArray = [{name:"Cancel"},{name:"Confirm",primary:true}]}

		return (<BaseModalWrapper isMobile={Core.isMobile()}>
				<TopBar isMobile={Core.isMobile()}>
					<div style={{width:"100%"}}>
						<div style={{"display":"flex","flexDirection":"row","justifyContent":"space-between","alignItems":"center"}}>
							<Title isMobile={Core.isMobile()}>{title}</Title>
							<TopBarButton isMobile={Core.isMobile()} onClick={(e) => that.state.controller.onDismiss(e)}>{DesignSystem.icon.close}</TopBarButton>
						</div>
						{subtitle?<Subtitle isMobile={Core.isMobile()}>{subtitle}</Subtitle>:""}
					</div>
				</TopBar>
				<MainContent>{component}</MainContent>
				{buttonArray.length?<ActionButtons>
					{buttonArray.map((b,i) => {
						return <ActionButton primary={b.primary} key={i} disabled={b.primary && that.state.controller.state.primaryButtonDisabled} onClick={(e)=>(b.primary && that.state.controller.state.primaryButtonDisabled)?false:that.state.controller.onConfirm(e,i)}>{b.name}</ActionButton>
					})}
				</ActionButtons>:<div style={{marginBottom:"1rem"}}></div>}
			</BaseModalWrapper>
		)
	},
	SideNavigation: () => (that) => {
		return (<BaseModalWrapper><SideBar items={Navigation.state.registeredViews}
	  		onClickCloseSideBar={e => that.state.controller.onDismiss(e)}
	  		activeIndex={Navigation.getCurrentRouteIndex()}
	  		onClickRoute={(e,route) => that.state.controller.onConfirm(e,route)}
		/></BaseModalWrapper>)
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
			<div style={{display:"flex", flexDirection: "column", paddingBottom: "2rem", justifyContent: "center"}}>
				<TransactionView style={{background:"red"}} transaction={this.props.transaction}/>
			</div>
			<div style={{display:"flex",justifyContent: "center",flexDirection:"column",alignItems:"stretch"}}>
				<ul style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
					{this.state.allocations.map((al,i) => <li key={al.nodeId} style={{margin: "0.5rem 0rem", position: "relative",display: "flex", flexDirection:"row", alignItems:"center",width:"100%"}}>
						{(i==0)?<StyledInput disabled positive={al.amount>0} value={al.amount.toFixed(2)}></StyledInput>:
								<StyledInput positive={al.amount>0} defaultValue={al.amount.toFixed(2)}
										onChange={((e)=> this.handleOnChangeValue(e,i)).bind(this)}
										onBlur={((e)=> this.handleOnValueBlur(e,i)).bind(this)}
										onInput={((e)=>this.handleOnInput(e,i)).bind(this)}
										onFocus={e => {e.target.select()}}></StyledInput>
									}
						{al.amount>0?<StyledSpendReceive style={{color:DesignSystem.getStyle().positive}}>earnt as</StyledSpendReceive>:<StyledSpendReceive>spent as</StyledSpendReceive>}
						<StyledDropDown style={{marginLeft:"0.5rem"}} 
							value={(this.state.allocations[i]?.streamId)?this.getDropDownLabelForStreamId(this.state.allocations[i].streamId):'DEFAULT'} 
							onChange={((e)=>this.handleStreamSelected(e,i)).bind(this)}>
							<option value='DEFAULT' disabled hidden> </option>
							{Core.getMasterStream().getAllTerminalStreams()
							.filter(s => s.isActiveAtDate(this.props.transaction.date) || s.isActiveAtDate(new Date()))
							.sort(utils.sorters.asc(s => s.name.charCodeAt()))
							.map((a,j) => <option key={j} sid={a.id}>{this.getDropDownLabelForStreamId(a.id)}</option>)}
						</StyledDropDown>
						<DownArrow shouldOffset={(i>0 && this.state.allocations.length>1)}>{DesignSystem.icon.caretDown}</DownArrow>
						{(i>0 && this.state.allocations.length>1)?<span 
							style={{fontWeight: 600, cursor:"pointer",paddingLeft:"1rem"}} 
							onClick={((e)=> this.handleOnClickRemoveAllocation(e,i)).bind(this)}>{DesignSystem.icon.close}</span>:""}
						
						
					</li>)}
					<li style={{color:DesignSystem.getStyle().modalPrimaryButton,cursor:"pointer",marginTop:"1rem"}} onClick={this.handleOnClickAddAllocation.bind(this)}>{DesignSystem.icon.plus} Add line</li>

				</ul>
			</div>
		</div>)
	}
}
const StyledInput= styled.input`
	color:  ${(props) => props.positive?DesignSystem.getStyle().positive:"inherit"};
	background-color: ${DesignSystem.getStyle().inputFieldBackground};
    width: 4.5rem;
    height: 1.5rem;
    padding: 0.5rem;
    margin-right: 0.5rem;
    text-align: center;
    font-size: 1rem;
    border-radius: 0.2rem;
    border: 0.1rem solid #BDBDBD;
`
const StyledSpendReceive = styled.span`
    display: inline-block;
    width: 100%;
    max-width: 4.5rem;
    text-align: left;
    padding-left: 0.5rem;
    padding-right: 0.5rem;
    font-size: 1rem;
`
const StyledDropDown= styled.select`
	width: 100%;
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
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 2rem;
`

const DownArrow = styled.div`
    position: absolute;
    right: ${(props) => props.shouldOffset?"3rem":"0.7rem"};
    top: calc(50% - 0.55rem);
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
								<div>{utils.formatCurrencyAmount(t.amount,null,null,null, Core.getPreferredCurrency())}</div>
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
	constructor(getContent,fromSide){
		this.promise = new Promise((res,rej)=> {this.onAnswer = res;this.onCancel = rej})
		this.getContent = getContent;
		this.state = {modalContentState:{}};
		this.appearFromSide = fromSide;
	}
	setParent(parent){this.parent = parent}
	getParent(){return this.parent}
	registerModal(modal){
		this.modal = modal;
		this.state.modalContentState = modal.state.content;
		this.modal.appearFromSide = this.appearFromSide;
	}
	then(){return this.promise.then.apply(this.promise, arguments)}
	willShow(){document.body.style.overflow = 'hidden'}//prevents scrolling behind the modal
	hide(){
		return new Promise((res,rej) => {
			document.body.style.overflow = 'unset';
			this.modal.updateState({visible:false}).then(() => {
				res()
				setTimeout(() => {
					let a = instance
					return instance.dismissModal(this)/*.then(() => res())*/
				},animationTime)//leaves time to play the animation
			})
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
		this.hide().then(() => this.onAnswer({state:this.state.modalContentState,buttonIndex:i}))
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
	componentDidMount(){setTimeout(() => this.setState({...this.state,visible:true,content:this.state.controller.getContent(this)}),5)}
	refreshContent(){this.updateState({content:this.state.controller.getContent(this)})}
	render(){
		if(this.appearFromSide){
			return (<ModalWrapper visible={this.state.visible} data-dismiss="true" onClick={(e)=> {if(e.target.dataset.dismiss){this.state.controller.onDismiss(e)}}}>
				<ModalBaseSide visible={this.state.visible}>
					{this.state.content}
				</ModalBaseSide>
			</ModalWrapper>)
		}else if(Core.isMobile()){
			return (<ModalWrapper visible={this.state.visible} data-dismiss="true" onClick={(e)=> {if(e.target.dataset.dismiss){this.state.controller.onDismiss(e)}}}>
				<ModalBaseMobile visible={this.state.visible}>
					{this.state.content}
				</ModalBaseMobile>
			</ModalWrapper>)
		}else{
			return (<ModalWrapper data-dismiss="true" visible={this.state.visible} onClick={(e)=> {if(e.target.dataset.dismiss)this.state.controller.onDismiss(e)}}>
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
	z-index: 300;
	opacity: ${props => props.visible?1:0};
    transition: ${animationTime/1000}s opacity;
`

const ModalBase = styled.div`
	background: ${DesignSystem.getStyle().modalBackground};
    position: relative;
    flex-grow: 0;
    min-width: 30rem;
    max-width: 40rem;
    box-shadow: 0 3px 14px 8px #0000001f;
    border-radius: ${DesignSystem.borderRadius};
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
const ModalBaseSide = styled.div`
    position: absolute;
    top:0;
    left:0;
    z-index:99;
    flex-grow: 0;
    width: 16rem;
    height: 100vh;
    transform: translateX(${props => props.visible?"0":"-16rem"});
    transition: ${animationTime/1000}s transform;
`

const TopBar = styled.div`
	width: 100%;
	height: ${props => props.isMobile?"auto":"3rem"};
	display: flex;
	justify-content: ${props => props.isMobile?"flex-start":"center"};
    align-items: center;
    margin-top: ${props => props.isMobile?0:0}rem;
    margin-bottom: ${props => props.isMobile?2:2.5}rem;
`
const Title = styled.div`
	flex-grow:1;
	font-size: ${props => props.isMobile?1.4:2}rem;
	text-align: ${props => props.isMobile?"left":"center"};
	font-weight: ${props => props.isMobile?"normal":"bold"};;
	color: ${DesignSystem.getStyle().bodyText};
`
const Subtitle = styled.div`
	flex-grow:1;
	font-size: 0.8rem;
	text-align: ${props => props.isMobile?"left":"center"};
	font-weight: normal;
	margin-top: 0.3rem;
`
const TopBarButton = styled.div`
    cursor: pointer;
    position:  ${props => props.isMobile?"static":"absolute"};
    top: 1.5rem;
    right: 1.5rem;
    color: ${DesignSystem.getStyle.bodyTextSecondary};
    -webkit-user-select: none; /* Safari */
  	-ms-user-select: none; /* IE 10 and IE 11 */
  	user-select: none; /* Standard syntax */
`

const BaseModalWrapper = styled.div`
	padding: ${props => props.isMobile?1.5:3}rem;
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
