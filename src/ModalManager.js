import React from 'react'
import BaseComponent from './components/BaseComponent'
import ReactDOM from 'react-dom';
import Core from './core.js'
import styled from 'styled-components'
import {CategorizationModalView} from './components/CategorizationRulesView'
import DS from './DesignSystem.js'
import {TransactionView, AmazonItemImage, canSplitAmazonByItem, getAmazonOrderData, getAmazonItemSplit, getAmazonItemRefundStates, getAmazonUnpostedCharges} from './components/CategorizeAction'
import ChargeDeck from './components/ChargeDeck'
import utils from './utils'
import SideBar from './components/SideBar'
import Navigation from './components/Navigation'
import TransactionGrouper from './processors/TransactionGrouper'
import WorkflowPresenter from './components/Workflow'


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

	unmountModal(modalController){return modalController.getParent().unmountModal(modalController)}
	dismissModal(modalController){return (modalController || this.currentModalController).onDismiss()}
	updateState(changes){this.setState({...this.state,...changes})}		
}

export const ModalTemplates = {
	BaseModal: (title,message,buttonArray) => (that)=> {
		return ModalTemplates.ModalWithComponent(title,
			<div style={{textAlign:"left"}}>{message}</div>
		,buttonArray)(that)
	},
	ModalWithSingleInput: (title,buttonArray) => (that)=> {
		if(!buttonArray)buttonArray = [{name:"Confirm",primary:true}]
		return ModalTemplates.ModalWithComponent(title,<SingleInput controller={that.state.controller}/>,buttonArray)(that)
	},
	ModalWithCategorizationRule: (title,message,rule) => (that) => {
		return ModalTemplates.ModalWithComponent(title,<div>
			<div style={{textAlign:"left"}}>{message}</div>
			<CategorizationModalView controller={that.state.controller} rule={rule} />
		</div>,[{name:"Cancel"},{name:"Save",primary:true}])(that)
	},
	ModalWithTransactions: (title,message,transactions,buttonArray) => (that) => {
		return ModalTemplates.ModalWithComponent(title,<div>
			<div style={{textAlign:"left"}}>{message}</div>
			<TransactionsModalView controller={that.state.controller} transactions={transactions} />
		</div>,buttonArray)(that)
	},
	//`options.requireAll` says this dialog is clearing queued work rather than correcting it, so every
	//charge of the order that has never been categorized has to be answered before it can be confirmed.
	ModalWithStreamAllocationOptions: (title,message,buttonArray,transaction,streamRecs,options) => (that) => {
		//An amazon order is split by item, never by amount - the prices are already known. The amount-based
		//view is the fallback for orders with no per-item prices (amazon fresh, digital) and for splits that
		//cannot be read back onto their items; see getAmazonItemSplit.
		const isOrder = !!getAmazonOrderData(transaction);
		const AllocationView = isOrder?AmazonOrderAllocationView:StreamAllocationOptionView;
		return ModalTemplates.ModalWithComponent(title,<div>
			<div style={{textAlign:"left"}}>{message}</div>
			<AllocationView controller={that.state.controller} transaction={transaction} streamRecs={streamRecs}
				requireAll={!!options?.requireAll}/>
		</div>,buttonArray)(that)
	},
	ModalWithListItems: (title,items,itemRendered = (li) => li,enableAccessor = () => true) => (that) => {
		return ModalTemplates.ModalWithComponent(title,<DS.component.ScrollableBottomSheet>
			{items.map((s,i) => <DS.component.ListItem key={i} disabled={!enableAccessor(s)} onClick={(e)=>{enableAccessor(s)?that.state.controller.updateContentState({selectedItem:s}).then(() => that.state.controller.onConfirm(e,i)):e.stopPropagation()}}>
				{itemRendered(s)}
			</DS.component.ListItem>)}
		</DS.component.ScrollableBottomSheet>,[])(that)
	},
	ModalWithComponent: (title,component,buttonArray,subtitle) => (that)=> {
		if(!buttonArray){buttonArray = [{name:"Cancel"},{name:"Confirm",primary:true}]}
		return (<BaseModalWrapper isMobile={Core.isMobile()} bottomBleed={buttonArray.length==0}>
				<TopBar isMobile={Core.isMobile()}>
					<div style={{width:"100%"}}>
						<div style={{"display":"flex","flexDirection":"row","justifyContent":"space-between","alignItems":"center"}}>
							<DS.component.ModalTitle isMobile={Core.isMobile()}>{title}</DS.component.ModalTitle>
							<TopBarButton isMobile={Core.isMobile()} onClick={(e) => that.state.controller.onDismiss(e)}>{DS.icon.close}</TopBarButton>
						</div>
						{subtitle?<Subtitle isMobile={Core.isMobile()}>{subtitle}</Subtitle>:""}
					</div>
				</TopBar>
				<MainContent>{React.cloneElement(component,{...component.props,controller:that.state.controller})}</MainContent>
				{buttonArray.length?<DS.component.ButtonGroup>
					{buttonArray.map((b,i) => {
						return <DS.component.Button.Action style={{marginTop:DS.spacing.xs+"rem"}} primary={b.primary} key={i} disabled={b.primary && that.state.controller.state.primaryButtonDisabled} onClick={(e)=>(b.primary && that.state.controller.state.primaryButtonDisabled)?false:that.state.controller.onConfirm(e,i)}>{b.name}</DS.component.Button.Action>
					})}
				</DS.component.ButtonGroup>:<div></div>}
			</BaseModalWrapper>
		)
	},
	ModalWithWorkflow: (workflow) => (that) => {
		return (<BaseModalWrapper isMobile={Core.isMobile()} bottomBleed>
			<WorkflowPresenter workflow={workflow} controller={that.state.controller}/>
		</BaseModalWrapper>)
	},
	SideNavigation: () => (that) => {
		return (<BaseModalWrapper><SideBar items={Navigation.state.registeredViews}
	  		onClickCloseSideBar={e => that.state.controller.onDismiss(e)}
	  		activeIndex={Navigation.getCurrentRouteIndex()}
	  		onClickRoute={(e,route) => that.state.controller.onConfirm(e,route)}
		/></BaseModalWrapper>)
	},
	ModalContextualMenu: (target,optionList = [],displayListItemAccessor = (l) => l,enableAccessor = () => true) => (that) => { //target must be a dom element to point the contextual menu on
		let r = target.getBoundingClientRect();
		return (
			<FixedBase>
				<DS.component.Tooltip style={{paddingLeft:0,paddingRight:optionList.length>8?"":0}} x={r.x+r.width/2} y={r.y+r.height*3/4}>
					<DS.component.ScrollableList style={{maxHeight:"15rem"}}>{
						optionList.map((a,i) => 
						<DS.component.ListItem size="xs" disabled={!enableAccessor(a)} key={i} onClick={(e)=> enableAccessor(a)?that.state.controller.onConfirm(e,i):e.stopPropagation()}>{displayListItemAccessor(a)}</DS.component.ListItem>)}
					</DS.component.ScrollableList>
				</DS.component.Tooltip>
			</FixedBase>
		)
	}
}

const FixedBase = styled.div`
	position: fixed;
	top: 0;
 	left: 0;
`


export class ModalController{
	constructor(getContent,options){
		this.promise = new Promise((res,rej)=> {this.onAnswer = res;this.onCancel = rej})
		this.getContent = getContent;
		this.state = {modalContentState:{}};
		this.options = options || {};
		this.appearFromSide = this.options.fromSide;
		this.onConfirm = this.onConfirm.bind(this);
		this.shouldAllowDismiss = options?.shouldAllowDismiss || (() => true)
	}
	setParent(parent){this.parent = parent}
	getParent(){return this.parent}
	registerModal(modal){
		this.modal = modal;
		this.state.modalContentState = modal.state.content;
		this.modal.appearFromSide = this.appearFromSide;
	}
	updateContentState(s){
		this.state.modalContentState = {...this.state.modalContentState,...s}
		return Promise.resolve()
	}
	then(){return this.promise.then.apply(this.promise, arguments)}
	willShow(){
		document.body.style.overflow = 'hidden'
		if(!Core.isMobile()){document.body.style['margin-right'] = DS.barWidthRem+"rem"}
	}//prevents scrolling behind the modal
	hide(){
		return new Promise((res,rej) => {
			document.body.style.overflow = 'unset';
			document.body.style['margin-right'] = 'unset';
			this.modal.updateState({visible:false}).then(() => {
				//res()
				setTimeout(() => {
					let a = instance
					return instance.unmountModal(this).then(() => res())
				},this.options.noAnimation?0:animationTime)//leaves time to play the animation
			})
		})
	}
	setPrimaryButtonDisabled(b){
		this.state = {...this.state, ...{primaryButtonDisabled:b}};
		this.modal.refreshContent();
	}
	onDismiss(e){
		return this.hide().then(() => {
			this.onCancel();
			e?.preventDefault();
			e?.stopPropagation();
			if(this.options.onDismiss){this.options.onDismiss(e)}
		});
	}
	onConfirm(e,i){
		this.hide().then(() => this.onAnswer({state:this.state.modalContentState,buttonIndex:i}))
		e?.preventDefault();
		e?.stopPropagation();
		if(this.options.onConfirm){this.options.onConfirm(e)}
	}
}

export class ModalWorkflowController extends ModalController{
	constructor(getContent,options){
		super(getContent,{...options,fixed:true})
		this.onComplete = this.onComplete.bind(this)
		this.onFail = this.onFail.bind(this)
	}
	onConfirm(){console.error("ModalWorkflowController must use the onComplete method to end the promise. Call was made to onConfirm - this is a noop")}
	onComplete(data){this.hide().then(() => this.onAnswer(data))}
	onFail(e){this.hide().then(() => this.onCancel())}
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
			return (<ModalWrapper visible={this.state.visible} data-dismiss="true" onClick={(e)=> {if(e.target.dataset.dismiss && this.state.controller.shouldAllowDismiss()){this.state.controller.onDismiss(e)}}}>
				<ModalBaseSide visible={this.state.visible}>
					{this.state.content}
				</ModalBaseSide>
			</ModalWrapper>)
		}else if(Core.isMobile()){
			return (<ModalWrapper visible={this.state.visible} data-dismiss="true" onClick={(e)=> {if(e.target.dataset.dismiss && this.state.controller.shouldAllowDismiss()){this.state.controller.onDismiss(e)}}}>
				<ModalBaseMobile visible={this.state.visible}>
					{this.state.content}
				</ModalBaseMobile>
			</ModalWrapper>)
		}else{
			return (<ModalWrapper options={this.props.controller.options} data-dismiss="true" visible={this.state.visible} onClick={(e)=> {
				if(e.target.dataset.dismiss && this.state.controller.shouldAllowDismiss())this.state.controller.onDismiss(e)}}>
				<ModalBase options={this.props.controller.options}>
					{this.state.content}
				</ModalBase>
			</ModalWrapper>)
		}
	}
}




const ModalWrapper = styled.div`
	background: ${props => props.options?.noShade?"#00000000":"#00000036"};
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
    transition: ${props => props.options?.noAnimation?0:animationTime/1000}s opacity;
`

const ModalBase = styled.div`
	background: ${DS.getStyle().modalBackground};
    position: relative;
    flex-grow: 0;
    min-width: 30rem;
    max-width: 40rem;
    width: ${props => props.options.fixed?"20rem":"auto"};
    box-shadow: ${props => props.options?.noShade?"":"0 3px 14px 8px #0000001f"};
    border-radius: ${DS.borderRadius};
`

const ModalBaseMobile = styled.div`
	background: ${DS.getStyle().modalBackground};
    position: absolute;
    bottom:0;
    max-height: 95vh;
    z-index:99;
    display:flex;
    flex-grow: 0;
    width: 100vw;
    box-shadow: 0 3px 14px 8px #0000001f;
    border-radius: ${DS.borderRadius} ${DS.borderRadius} 0 0;
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
	font-size: ${DS.fontSize.header}rem;
	text-align: ${props => props.isMobile?"left":"center"};
	color: ${DS.getStyle().bodyText};
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
    color: ${DS.getStyle.bodyTextSecondary};
    -webkit-user-select: none; /* Safari */
  	-ms-user-select: none; /* IE 10 and IE 11 */
  	user-select: none; /* Standard syntax */
`

const BaseModalWrapper = styled.div`
	padding: ${props => props.isMobile?DS.spacing.s:DS.spacing.l}rem;
	padding-bottom: ${props => props.bottomBleed?"0rem":"auto"};
    box-sizing: border-box;
    position: relative;
 /*   height: 100%;*/
    width: 100%;
    display: flex;
    flex-direction: column;
`

const MainContent = styled.div`
	text-align: center;
	flex-grow:1;
	
`

//Splits an amazon transaction item by item. Same shape as StreamAllocationOptionView - same TransactionView
//on top, same ul of Rows below, same {streamId,amount,type} array handed to Confirm - but the amount per row
//is the item's own post-tax price rather than something typed, so the row reads "<picture> Goes to <stream>".
export class AmazonItemAllocationView extends BaseComponent{
	constructor(props){
		super(props)
		var amz = getAmazonOrderData(props.transaction);
		//only the items THIS charge paid for. An order billed as several charges carries the whole order's
		//item list on each of them, so asking the user to place every item while splitting one charge asks
		//about things this transaction never paid for - and prices them wrongly on top.
		//A split that already exists is read back onto the items it was made from, so editing one opens in
		//the view it was created in rather than dropping to amounts. Where it cannot be read back the
		//caller has already chosen the amount-based view, so `streamIds` is only ever absent here because
		//nothing has been allocated yet.
		var split = getAmazonItemSplit(props.transaction);
		var seeded = split?.streamIds;
		//what came back, per item - undefined where nothing on this charge is on a refund stream
		this.refunds = getAmazonItemRefundStates(props.transaction,split);
		this.state = {
			controller: props.controller,
			amz: amz,
			items: split.items,
			//already spread onto this charge, so the allocations sum to the transaction being split
			prices: split.prices,
			assignments: seeded?[...seeded]:split.items.map(() => undefined),
			pickOrder: seeded?seeded.filter((id,i) => seeded.indexOf(id)===i):[],//streamIds, most recent last
			allocations: []
		}
		this.state.allocations = this.buildAllocations(this.state.assignments);
		if(!this.props.embedded){
			this.state.controller.state.modalContentState = {...this.state.controller.state.modalContentState,...this.state}
			this.setPrimaryButtonDisabled(true);
		}
	}
	//Embedded, this view is one page of a deck: the page owns the transaction on show and the deck owns the
	//confirm button, so the only thing to do with a change is hand it up. Standalone it still owns both.
	postStateUpdateCallback(){
		if(this.props.embedded)return this.props.onChange?.(this.state.allocations,this.isValid())
		this.state.controller.state.modalContentState = {...this.state.controller.state.modalContentState,...this.state}
		this.validate();
	}
	setPrimaryButtonDisabled(b){this.state.controller.setPrimaryButtonDisabled(b)}
	isValid(){//every item needs a stream, and every stream needs to still exist
		return utils.and(this.state.assignments,streamId => !!streamId)
			&& utils.and(this.state.allocations,al => Core.getMasterStream().hasTerminalChild(al.streamId) && !isNaN(al.amount) && al.amount!=0)
	}
	validate(){this.setPrimaryButtonDisabled(!this.isValid())}
	handleStreamSelected(e,i){
		var s = Core.getStreamById(e.target.selectedOptions[0].getAttribute("sid"))
		this.assignItem(i,s.id)
	}
	assignItem(i,streamId){
		var assignments = [...this.state.assignments], pickOrder = [...this.state.pickOrder];
		var previous = assignments[i];
		if(previous){//drop the stale entry first, so a stream nothing points at anymore stops being suggested
			var at = pickOrder.lastIndexOf(previous);
			if(at>-1)pickOrder.splice(at,1)
		}
		assignments[i] = streamId;
		pickOrder.push(streamId);
		this.updateState({assignments:assignments,pickOrder:pickOrder,allocations:this.buildAllocations(assignments)},this.postStateUpdateCallback)
	}
	buildAllocations(assignments){
		//several items in the same stream make one allocation, not one each
		var sign = this.props.transaction.amount<0?-1:1;
		var streamIds = [], totals = {};
		assignments.forEach((streamId,i) => {
			if(!streamId)return
			if(!(streamId in totals)){totals[streamId] = 0;streamIds.push(streamId)}
			totals[streamId] += this.state.prices[i]
		})
		return streamIds.map(streamId => ({streamId:streamId,amount:sign*Math.round(totals[streamId]*100)/100,type:"value"}))
	}
	//streams already used on this transaction, most recently picked first
	getStreamsUsedSoFar(){
		var used = [];
		for(var i=this.state.pickOrder.length-1;i>=0;i--){
			if(used.indexOf(this.state.pickOrder[i])==-1)used.push(this.state.pickOrder[i])
		}
		return used
	}
	getAvailableStreams(){
		return Core.getMasterStream().getAllTerminalStreams()
			.filter(s => s.isActiveAtDate(this.props.transaction.date) || s.isActiveAtDate(new Date()))
			.sort(utils.sorters.asc(s => s.name.charCodeAt()))
	}
	getDropDownLabelForStreamId(id){
		var s = Core.getStreamById(id);
		return s.isActiveNow()?s.name:s.name+" (old)"
	}
	renderStreamOption(s,key){return <option key={key} sid={s.id}>{this.getDropDownLabelForStreamId(s.id)}</option>}
	//streams already used on this transaction float to the top of the list: splitting an order usually means
	//sending the next item to somewhere the previous one already went.
	renderStreamOptions(){
		var available = this.getAvailableStreams();
		var used = this.getStreamsUsedSoFar().map(id => available.find(s => s.id==id)).filter(s => !!s);
		var rest = available.filter(s => used.indexOf(s)==-1);
		if(!used.length)return rest.map((s,j) => this.renderStreamOption(s,j))
		return [
			<optgroup key="used" label="Already in this order">{used.map((s,j) => this.renderStreamOption(s,"u"+j))}</optgroup>,
			<optgroup key="rest" label="All streams">{rest.map((s,j) => this.renderStreamOption(s,"r"+j))}</optgroup>
		]
	}
	render(){
		return(<div>
			{this.props.embedded?"":<div style={{display:"flex", flexDirection: "column", paddingBottom: "2rem", justifyContent: "center"}}>
				<TransactionView transaction={this.props.transaction}/>
			</div>}
			<div style={{display:"flex",justifyContent: "center",flexDirection:"column",alignItems:"stretch"}}>
				<ul style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
					{this.state.items.map((it,i) => <DS.component.Row key={i}>
						<AmazonItemImage item={it} price={this.state.prices[i]} size={3} refund={this.refunds?.[i]} style={{
							overflow:"hidden",borderRadius: DS.borderRadiusSmall,
							alignSelf:"center",marginBottom:"0.5rem"}}/>
						{/*once the credit is in there is nothing left to choose, so the label and the field give
						   way to what happened - starting where "Goes to" starts, so a settled row still lines
						   up with the ones above and below it*/}
						{this.refunds?.[i]?.state==="back"
							?<StyledSpendReceive style={{maxWidth:"none",textAlign:"left",alignSelf:"center"}}>
								Refunded on {utils.formatDateShort(this.refunds[i].date)}</StyledSpendReceive>
							:<React.Fragment>
								{/*textAlign left so this starts at the same 0.5rem offset as the settled label above -
								   centered text would begin further right and the column would not line up*/}
								<StyledSpendReceive style={{textAlign:"left"}}>Goes to</StyledSpendReceive>
								<DS.component.DropDown
									value={(this.state.assignments[i])?this.getDropDownLabelForStreamId(this.state.assignments[i]):'DEFAULT'}
									onChange={((e)=>this.handleStreamSelected(e,i)).bind(this)}>
									<option value='DEFAULT' disabled hidden> </option>
									{this.renderStreamOptions()}
								</DS.component.DropDown>
							</React.Fragment>}
					</DS.component.Row>)}
				</ul>
			</div>
		</div>)
	}
}

//Every charge of one Amazon order, as pages of a deck.
//
//An order billed as several charges produces several bank transactions that are identical on screen and
//several cards in the queue. Listing the siblings under the tile only ever said that they existed; here
//they are the pages, so one pass answers the order and their queue cards leave together.
//
//This view owns no rows of its own. Each page is a charge tile plus whichever allocation view suits that
//charge - item-wise where the items are known and the existing split can be read back onto them, amounts
//where it cannot - and those views report upward instead of driving the modal, so there is one
//implementation of a row rather than two.
export class AmazonOrderAllocationView extends BaseComponent{
	constructor(props){
		super(props)
		var charges = AmazonOrderAllocationView.chargesOf(props.transaction);
		var at = charges.indexOf(props.transaction);
		this.state = {
			controller: props.controller,
			charges: charges,
			//amounts the ledger says were charged but no posted debit accounts for - a separate array,
			//never merged into `charges`, because nothing in it is a real transaction: there is nothing to
			//allocate and nothing publish() may ever write
			pending: getAmazonUnpostedCharges(props.transaction),
			index: at>-1?at:0,//chargesOf puts it first, so this is 0 - kept honest rather than hard-coded
			//what each charge was allocated when the dialog opened, so a change can be told from a re-render
			baselines: charges.map(t => normalizeAllocations(t.streamAllocation,t.amount)),
			allocationsByCharge: charges.map(() => undefined),
			validByCharge: charges.map(() => false)
		}
		this.publish(true);
	}
	//The order's charges: its bank debits, oldest first. Credits carry the same order number and are not
	//charges, so they are not pages - a refund is reconciled against the charge it cancels, which is a
	//different system (documentation/zero-sum-streams.md).
	static chargesOf(transaction){
		var amz = getAmazonOrderData(transaction);
		if(!amz)return [transaction]
		var found = (Core.getTransactionsForOrderNumber(amz.orderNumber)||[])
			.filter(t => t.amount<0)
			.sort(utils.sorters.asc(t => t.getDisplayDate()));
		//Identity is the wrong test for whether the lookup found it: the caller holds its own reference and
		//the lookup reads globalState, so the same charge can arrive as two objects. Adding it again would
		//make one charge two pages and write it twice on confirm.
		var same = (a,b) => a===b || (!!a.transactionId && a.transactionId===b.transactionId) || (!!a.id && a.id===b.id);
		//The CALLER's object wins wherever both exist. It is the one carrying whatever the view stamped on
		//it for this dialog - the zero-sum reconciliation, above all - and the copy from globalState has
		//none of that.
		found = found.map(t => same(t,transaction)?transaction:t);
		if(!found.some(t => same(t,transaction)))found = [transaction].concat(found);
		//The charge you opened leads, whatever order the bank posted them in. You asked about this one; the
		//others are context, and burying it behind a sibling because that sibling settled first makes you
		//hunt for the page you already chose.
		return [transaction].concat(found.filter(t => !same(t,transaction)))
	}
	//Item-wise where this charge's items are known AND any existing split can be read back onto them.
	//A split made by amount is not an item split and must not be shown as one.
	usesItemView(transaction){
		//a credit is not a charge and pays for no items; it is only ever here because it was opened directly
		if(!(transaction.amount<0))return false
		if(!canSplitAmazonByItem(transaction))return false
		if(!transaction.streamAllocation?.length)return true
		return !!getAmazonItemSplit(transaction)?.streamIds
	}
	onChargeChanged(i,allocations,valid){
		var allocationsByCharge = [...this.state.allocationsByCharge], validByCharge = [...this.state.validByCharge];
		allocationsByCharge[i] = allocations; validByCharge[i] = valid;
		this.updateState({allocationsByCharge:allocationsByCharge,validByCharge:validByCharge},() => this.publish())
	}
	//What the modal answers with, and whether it may be answered at all.
	//
	//Confirm asks two different questions depending on why the dialog is open. Clearing queued work
	//(`requireAll`): every charge that has never been categorized must be fully allocated, because leaving
	//one behind recreates exactly the half-answered order this deck exists to prevent. Correcting an
	//existing categorization: something must actually have changed since it opened, which is the same
	//validate rail as before with a comparison against the opening state added to it.
	publish(initial){
		var changed = this.state.charges.map((t,i) => {
			var now = this.state.allocationsByCharge[i];
			return !!now && !sameAllocations(normalizeAllocations(now,t.amount),this.state.baselines[i])
		});
		var incomplete = this.state.charges.some((t,i) => {
			if(this.props.requireAll && !t.streamAllocation?.length)return !this.state.validByCharge[i]
			return changed[i] && !this.state.validByCharge[i]
		});
		//only the charges the reader actually moved are written back
		var answers = this.state.charges.map((t,i) => (changed[i] && this.state.validByCharge[i])?this.state.allocationsByCharge[i]:undefined);
		var content = {charges:this.state.charges,allocationsByCharge:answers,
			//the single-charge shape the rest of the app still speaks. `index` now walks the full deck,
			//pending pages included, so it can point past the end of `answers` when one of those is open -
			//there is nothing to answer with there, hence undefined rather than an out-of-range read
			allocations:this.state.index<answers.length?answers[this.state.index]:undefined};
		this.state.controller.state.modalContentState = {...this.state.controller.state.modalContentState,...content};
		if(initial)return this.state.controller.setPrimaryButtonDisabled(true)
		this.state.controller.setPrimaryButtonDisabled(incomplete || !answers.some(a => !!a));
	}
	renderPage(transaction,i){
		var itemWise = this.usesItemView(transaction);
		var ItemView = itemWise?AmazonItemAllocationView:StreamAllocationOptionView;
		return <div key={transaction.getTransactionHash?.()||i}>
			<div style={{display:"flex",flexDirection:"column",justifyContent:"center"}}>
				<TransactionView transaction={transaction} inDeck pricedBelow={itemWise}
					refundShownOnItems={itemWise && !!getAmazonItemRefundStates(transaction,getAmazonItemSplit(transaction))}/>
			</div>
			<div style={{marginTop:DS.spacing.s+"rem"}} data-no-drag>
				<ItemView embedded controller={this.state.controller} transaction={transaction}
					streamRecs={this.props.streamRecs||[]}
					onChange={(allocations,valid) => this.onChargeChanged(i,allocations,valid)}/>
			</div>
		</div>
	}
	//A page for a charge the ledger says exists but the bank hasn't posted. Its tile is a display-only
	//stand-in - there is no transaction behind it, and there must not be one, or a categorization would end
	//up written against a charge that hasn't happened yet. The stub carries only what TransactionView reads:
	//an amount (so the item resolution below can find this charge's items on its own), the order's own
	//details, and a date/hash that say plainly this is not a real transaction.
	renderPendingPage(amount,k){
		var stub = {amount:-amount, amazonOrderDetails:this.props.transaction.amazonOrderDetails,
			getDisplayDate:() => undefined, getTransactionHash:() => "pending-"+k};
		return <div key={stub.getTransactionHash()}>
			<div style={{display:"flex",flexDirection:"column",justifyContent:"center"}}>
				<TransactionView transaction={stub} inDeck pending/>
			</div>
			{/*stands where the allocation rows would be on a posted page, so the deck doesn't lurch onto a
			   page an inch shorter than its neighbours*/}
			<div style={{marginTop:DS.spacing.s+"rem",minHeight:DS.spacing.m+"rem",display:"flex",
					alignItems:"center",justifyContent:"center",textAlign:"center",
					color:DS.getStyle().bodyTextSecondary,fontSize:DS.fontSize.little+"rem"}}>
				Not posted yet
			</div>
		</div>
	}
	//One line naming the order, above the deck rather than on every page: it is the only thing here that is
	//about the whole order rather than one charge of it.
	renderOrderLine(){
		var amz = getAmazonOrderData(this.props.transaction);
		if(!amz)return ""
		var ordered = amz.date?new Date(amz.date):undefined;
		//left, explicitly: MainContent centres its text, and a line that names the order should start where
		//the tile under it starts
		return <div title={"Amazon order #"+amz.orderNumber} style={{fontSize:DS.fontSize.little+"rem",
				textAlign:"left",color:DS.getStyle().bodyTextSecondary,whiteSpace:"nowrap",overflow:"hidden",
				textOverflow:"ellipsis",marginBottom:DS.spacing.xs+"rem"}}>
			{(amz.accountName?amz.accountName+"'s ":"")+"Amazon order #"+(amz.orderNumber+"").slice(-3)
				+(ordered?" from "+utils.formatDateMonthDay(ordered):"")}
		</div>
	}
	render(){
		//no padding of its own: the pager already carries the space under the deck, and adding a second
		//helping of it is what left a hole between the dots and the buttons
		//pending pages come last: they have not happened yet, so they trail the charges that already have
		return <div>
			{this.renderOrderLine()}
			<ChargeDeck pages={this.state.charges.map((t,i) => this.renderPage(t,i))
					.concat(this.state.pending.map((amount,k) => this.renderPendingPage(amount,k)))}
				index={this.state.index}
				onIndexChange={(i) => this.updateState({index:i},() => this.publish())}/>
		</div>
	}
}

//Allocations as a set of {streamId, amount} with the amount in cents, so two sets can be compared without
//caring about order, about percent versus value, or about which way the sign fell.
function normalizeAllocations(allocations,transactionAmount){
	return (allocations||[]).filter(al => !!al.streamId).map(al => ({
		streamId: al.streamId,
		cents: Math.round(Math.abs(al.type==="percent"?(al.amount||0)*(transactionAmount||0):(al.amount||0))*100)
	})).sort((a,b) => a.streamId<b.streamId?-1:(a.streamId>b.streamId?1:a.cents-b.cents))
}
function sameAllocations(a,b){
	return a.length===b.length && a.every((x,i) => x.streamId===b[i].streamId && x.cents===b[i].cents)
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
		if(!this.props.embedded){
			this.state.controller.state.modalContentState = {...this.state.controller.state.modalContentState,...this.state}
			this.setPrimaryButtonDisabled(true);
		}
	}
	//see AmazonItemAllocationView.postStateUpdateCallback - embedded, this is one page of a deck
	postStateUpdateCallback(){
		if(this.props.embedded)return this.props.onChange?.(this.state.allocations,this.isValid())
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
		// For number inputs, we can't use setSelectionRange, so just sanitize the value
		var input = e.target;
		var originalValue = input.value;
		
		var shouldInsertMinus = this.firstTimeMinusAttempt && this.props.transaction.amount<0;//if amount is negative and this is the first attempt
		if(originalValue == ""){shouldInsertMinus = false;this.firstTimeMinusAttempt = false}
		if(originalValue.charCodeAt(0)=="+".charCodeAt(0)){shouldInsertMinus = false;this.firstTimeMinusAttempt = false}//if inserting a +, don't force the minus
		if(originalValue.charCodeAt(0)=="-".charCodeAt(0)){shouldInsertMinus = false;}//if already a -, no need
		
		var valueToProcess = originalValue;
		if(shouldInsertMinus){valueToProcess = "-" + valueToProcess}
		
		// Apply sanitization regex
		var sanitized = valueToProcess.replace(/^\.|[^-?\d\.]|\.(?=.*\.)|^0+(?=\d)/g, '').replace(/(\..*?)\..*/g, '$1');
		
		// Update input value if changed
		if(sanitized !== originalValue){
			var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
			nativeSetter.call(input, sanitized);
		}
	}
	handleStreamSelected(e,i){
		var s = Core.getStreamById(e.target.selectedOptions[0].getAttribute("sid"))
		this.state.allocations[i].streamId = s.id;
		delete this.state.allocations[i].streamName
		this.updateState({allocations:[...this.state.allocations]},this.postStateUpdateCallback);
	}
	setPrimaryButtonDisabled(b){this.state.controller.setPrimaryButtonDisabled(b)}
	isValid(){//all streams should exist and have an allocated value
		return utils.and(this.state.allocations,al => Core.getMasterStream().hasTerminalChild(al.streamId) && !isNaN(al.amount) && al.amount!=0)
	}
	validate(){this.setPrimaryButtonDisabled(!this.isValid())}

	getDropDownLabelForStreamId(id){
		var s = Core.getStreamById(id);
		return s.isActiveNow()?s.name:s.name+" (old)"
	}

	render(){

		return(<div>
			{this.props.embedded?"":<div style={{display:"flex", flexDirection: "column", paddingBottom: "2rem", justifyContent: "center"}}>
				<TransactionView transaction={this.props.transaction}/>
			</div>}
			<div style={{display:"flex",justifyContent: "center",flexDirection:"column",alignItems:"stretch"}}>
				<ul style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
					{this.state.allocations.map((al,i) => <DS.component.Row key={al.nodeId}>
						{(i==0)?<DS.component.Input style={{width:"3rem"}} disabled positive={al.amount>0} value={al.amount.toFixed(2)}></DS.component.Input>:
								<DS.component.Input numerical style={{width:"3rem"}} positive={al.amount>0} defaultValue={al.amount.toFixed(2)}
										onChange={((e)=> this.handleOnChangeValue(e,i)).bind(this)}
										onBlur={((e)=> this.handleOnValueBlur(e,i)).bind(this)}
										onInput={((e)=>this.handleOnInput(e,i)).bind(this)}
										onFocus={e => {e.target.select()}}></DS.component.Input>
									}
						{al.amount>0?<StyledSpendReceive style={{color:DS.getStyle().positive}}>earnt as</StyledSpendReceive>:<StyledSpendReceive>spent as</StyledSpendReceive>}
						<DS.component.DropDown
							value={(this.state.allocations[i]?.streamId)?this.getDropDownLabelForStreamId(this.state.allocations[i].streamId):'DEFAULT'} 
							onChange={((e)=>this.handleStreamSelected(e,i)).bind(this)}>
							<option value='DEFAULT' disabled hidden> </option>
							{Core.getMasterStream().getAllTerminalStreams()
							.filter(s => s.isActiveAtDate(this.props.transaction.date) || s.isActiveAtDate(new Date()))
							.sort(utils.sorters.asc(s => s.name.charCodeAt()))
							.map((a,j) => <option key={j} sid={a.id}>{this.getDropDownLabelForStreamId(a.id)}</option>)}
						</DS.component.DropDown>
						{(i>0 && this.state.allocations.length>1)?<span 
							style={{fontWeight: 600, cursor:"pointer",paddingLeft:"1rem"}} 
							onClick={((e)=> this.handleOnClickRemoveAllocation(e,i)).bind(this)}>{DS.icon.close}</span>:""}
						
						
					</DS.component.Row>)}
					<li style={{color:DS.getStyle().modalPrimaryButton,cursor:"pointer",marginTop:"1rem"}} onClick={this.handleOnClickAddAllocation.bind(this)}>{DS.icon.plus} Add line</li>

				</ul>
			</div>

		</div>)
	}
}

const StyledSpendReceive = styled.span`
    display: inline-block;
    width: 100%;
    max-width: 4.5rem;
    text-align: left;
    padding-left: 0.5rem;
    padding-right: 0.5rem;
    font-size: 1rem;
    text-align: center;
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
		return(<div style={{marginTop:DS.spacing.xxs+"rem"}}>
			{this.props.transactions.slice(0,5).map((t,i) => <DS.component.TransactionListItem key={i} transaction={t}/>)}
			{(this.props.transactions.length>5)?<div style={{textAlign: "right",fontWeith:"100"}}>...and {this.props.transactions.length-5} other(s)</div>:""}
		</div>)
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
			var res = TransactionGrouper.clusterTransactions(categorizedTxns)
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
    background: ${DS.getStyle().inputFieldBackground};
    padding: 1rem;
    display: flex;
    flex-direction: column;
`
const TransactionListViewItem= styled.li`
	display: flex;
    flex-direction: row;
    align-items: center;
`



const instance = new ModalManager();
export default instance;
