import BaseComponent from './BaseComponent'
import Core from '../core.js'
import styled from 'styled-components'
import ApiCaller from '../ApiCaller'
import {ModalController, ModalTemplates} from '../ModalManager.js'
import {Period} from '../Time'
import DS from '../DesignSystem'
import utils from '../utils'
import {CompoundStream} from '../model'
import React from "react";

var streamReactNodeMap = {}
var isInEditMode = false
let instance;
let DragGhostInstance;




export default class MasterStreamView extends BaseComponent{
	constructor(props){
		super(props);
		this.factoryActive = false;
		this.state={
			masterStream:Core.getMasterStream(),
			ddContext:{
				draggedOverStream:{},//stream being overed right now and need to make space
				dropTarget:{},//stream it will be dropped into
			},
		}
		instance = this;
		this.onDragOverNoMansLand = this.onDragOverNoMansLand.bind(this)
	}
	setFactoryActive(b){this.factoryActive=b}
	updateClonePositionWithEvent(e){
		this.state.ddContext.clone.style.left = Math.floor(e.pageX-this.state.ddContext.dragAnchorOffset)+"px"
		this.state.ddContext.clone.style.top = Math.floor(e.pageY-this.state.ddContext.clone.offsetHeight/2)+"px"
	}
	onDragOverNoMansLand(e){
		this.updateClonePositionWithEvent(e)
		this.state.ddContext.draggedOverStream = {}
	}
	takeSnapshot(){return new CompoundStream(JSON.parse(JSON.stringify(Core.getMasterStream())))}
	isFactoryActive(){return this.factoryActive}
	refresh(){return this.updateState({refresh:new Date()})}
	saveMasterStream(){
		let tsSnap = this.masterStreamSnapshot, ts = Core.getMasterStream();
		if(ts.getAllTerminalStreams().length < tsSnap.getAllTerminalStreams().length){
			throw new Error("Stream Integrity is compromised. Less terminal streams are present after the change than before.")
		} else {Core.saveStreams().then(() => this.masterStreamSnapshot = this.takeSnapshot())}
	}
	render(){
		if(!this.state.masterStream)return(<div/>)
		if(!this.masterStreamSnapshot){this.masterStreamSnapshot = this.takeSnapshot()}
		return(<div style={{minHeight:"100vh"}} onDragOver={e => this.onDragOverNoMansLand(e)} >
			<DS.Layout.PageWithTitle title="Streams" content={<div>
				<DragGhost/>
				<StyledMasterStreamView>
					<DraggableStreamView ddContext={this.state.ddContext} stream={this.state.masterStream} />
				</StyledMasterStreamView>
			</div>}/>
		</div>
	)}
}

const StyledMasterStreamView = styled.div`
    margin-top: 0rem;
`








class DraggableStreamView extends BaseComponent{
	/*This class acts as a generic draggable stream view that abstracts away the hover and move out of the way behavior.*/
	constructor(props){
		super(props)
		this.state={isDraggingOverTerminalStream:false}
		streamReactNodeMap[props.stream.id]=this
		this.onDragOver = this.onDragOver.bind(this)
		this.onDragEnd = this.onDragEnd.bind(this)
		this.onDragStart = this.onDragStart.bind(this)
	}

	//drag and drop handling
	onDragStart(e){
		//console.log(e)
		if(this.isInEditMode() || this.props.stream.isRoot){return e.preventDefault()}

		this.props.ddContext.dragStartDomHeight = e.target.clientHeight			//used for animating the height on drop
		this.props.ddContext.dragAnchorOffset = e.pageX-e.target.offsetLeft; 	//used for clone placement
		this.props.ddContext.lastDraggedStream = this.props.stream;				//used to test that a node is the one of the dragged stream
		this.props.ddContext.isDragging = true;									//idem

		//shrink animation
		e.target.style["height"] = this.props.ddContext.dragStartDomHeight +"px" //set to numerical value
		setTimeout(() => e.target.style["height"] = 0,20) 						 //after letting the dom update, change to animate

		//handle the dragging image: set the default ghost to nothing and create our own clone
		e.dataTransfer.setDragImage(new Image(),0,0)
		DragGhostInstance.updateState({stream: this.props.stream,width:(e.target.clientWidth-3*DS.remToPx)+"px",visible:true})
		this.props.ddContext.clone = DragGhostInstance.dom.current;

		e.stopPropagation();//stop propagating the event to parents
	}
	onDragOver(e){
		const stopAndExit = () => {e.preventDefault();e.stopPropagation()}
		if(this.isInEditMode() || !this.props.ddContext.clone){return stopAndExit()}

		//update dragging image
		instance.updateClonePositionWithEvent(e)
		
		//Skip frequent refreshes while moving fast 
		if(new Date().getTime() - this.props.ddContext.lastMoveTime < 75){return stopAndExit()}
		else {this.props.ddContext.lastMoveTime = new Date().getTime()}

		if(this.amIDraggingNow()){return}//hovering over myself: ignore actions and let events flow to streams underneath
		else if(!this.amIBeingDraggedOver()){//If I'm not already being hovered: make space for drop
			this.props.ddContext.draggedOverStream = this.props.stream;
			Object.keys(streamReactNodeMap).forEach(k => streamReactNodeMap[k].updateState({moveOutOfTheWay: (k == this.props.stream.id)}))
		}
		return stopAndExit();
	}
	onDragEnd(e){
		if(this.isInEditMode()){return}
		e.preventDefault();
		e.stopPropagation();

		//stream grouping or insertion
		let draggedOverStreamParent = Core.getParentOfStream(this.props.ddContext.draggedOverStream)
		let draggedStreamParent = Core.getParentOfStream(this.props.ddContext.lastDraggedStream);
		this.props.ddContext.dropTargetStream = this.props.ddContext.draggedOverStream
		if(!draggedOverStreamParent || !this.props.ddContext.draggedOverStream.id || this.amIBeingDraggedOver()){}//do nothing if dropped on masterstream, outside of the zone, or on itself
		else if(streamReactNodeMap[this.props.ddContext.draggedOverStream.id].state.isDraggingOverTerminalStream){//dropped over a terminal stream: group together
			Core.groupStreams(this.props.stream,this.props.ddContext.draggedOverStream)
		}else{//dropped over the placeholder: move to this 
			var idx = Core.getStreamIndexInParent(this.props.ddContext.draggedOverStream);
			if(draggedOverStreamParent.id == draggedStreamParent.id && idx > Core.getStreamIndexInParent(this.props.ddContext.lastDraggedStream)){idx--} //adjust index if dropped after the original position in same parent
			this.props.stream.moveFromParentToParentAtIndex(draggedStreamParent,draggedOverStreamParent,idx)
		}

		//update to non-dragging state & manage animations
		Object.keys(streamReactNodeMap).forEach(k => streamReactNodeMap[k].updateState({moveOutOfTheWay:false}))
		this.props.ddContext.draggedOverStream = {};
		DragGhostInstance.updateState({visible:false})
		if(this.shouldAnimateHeight()){
			setTimeout(() => {//setup debounce animation: this has the effect of setting the height of the dragged node back to original value
				this.props.ddContext.isDragging = false;
				instance.refresh();
			},10)
			setTimeout(() => {//reset the streamViews as pre-drag: this has the effect of removing the element style height
				this.props.ddContext.lastDraggedStream = {}
				instance.refresh();
			},300)
		}else{//if we don't want an animation (terminal stream being dropped), we immediately setup so that the element style height is removed
			this.props.ddContext.isDragging = false;
			this.props.ddContext.lastDraggedStream = {}
			instance.refresh();
		}
		setTimeout(() => this.props.ddContext.dropTargetStream = {},300)//dropTargetStream is used to suppress the drop animation for the target stream.

		//save
		instance.saveMasterStream();
	}

	//convenience
	isInEditMode(){return isInEditMode}
	amILastDraggedStream(){return this.props.stream.id == this.props.ddContext.lastDraggedStream?.id}
	amIBeingDraggedOver(){return this.props.ddContext.draggedOverStream?.id==this.props.stream.id}
	amIDraggingNow(){return this.amILastDraggedStream() && this.props.ddContext.isDragging}
	amIDropTarget(){return this.props.ddContext.dropTargetStream?.id==this.props.stream.id}
	setDraggingOverTerminalStream(b){if(this.state.isDraggingOverTerminalStream!=b){this.updateState({isDraggingOverTerminalStream:b})}}
	shouldAnimateHeight(){
		return !(this.amILastDraggedStream() && !this.props.stream.children) //don't animate a terminal stream that's beeing dropped
		&& !this.amIDropTarget() //don't animate the drop target itself
	}

	render(){
		return(
			<DraggableStreamContainer style={(this.amILastDraggedStream())?(this.amIDraggingNow()?{height:0,opacity:0}:{height:this.props.ddContext.dragStartDomHeight +"px",opacity:1}):{}} animate={this.shouldAnimateHeight()}
				key={"cont-"+this.props.stream.id} draggable onDragStart={this.onDragStart} onDragOver={this.onDragOver} onDragEnd={this.onDragEnd} onDragEnter={e => e.preventDefault()}>
				<Placeholder highlight={this.state.moveOutOfTheWay && !this.state.isDraggingOverTerminalStream} moveOutOfTheWay={this.state.moveOutOfTheWay} onDragOver={e => this.setDraggingOverTerminalStream(false)} animate={this.shouldAnimateHeight()}/>
				{this.props.stream.children?
					<CompoundStreamView ddContext={this.props.ddContext} stream={this.props.stream} draggableNode={this}/>:
					<TerminalStreamView ddContext={this.props.ddContext} stream={this.props.stream} draggableNode={this}/>}
			</DraggableStreamContainer>
		)
	}
}

const DraggableStreamContainer = styled.div`
    cursor: pointer !important;
    opacity: ${props => props.inVisible?0:1};
    transition: opacity 0.2s, height ${props => props.animate?0.2:0}s;
    overflow: hidden;
`

const Placeholder = (props) => <div onDragOver={props.onDragOver} id={props.id} style={{paddingTop:props.moveOutOfTheWay?0.3+"rem":0}}>
	<StreamPlaceholder animate={props.animate} highlight={props.highlight} style={{height:props.moveOutOfTheWay?DS.inputHeightInline+"rem":0}}/>
</div>

const StreamPlaceholder = styled.div`
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    color: ${DS.getStyle().bodyTextSecondary};
    background: ${props => DS.getStyle().UIElementBackground};
    padding: 0 1.5rem;
    height:${props => DS.inputHeightInline}rem;
    border-radius: 100vw;
    transition: margin 0.2s, height ${props => props.animate?0.2:0}s;
    opacity: ${props => props.highlight?0.8:0};
    &:hover{
    	opacity:1;
    }
`







class GenericEditableStreamView extends BaseComponent{
	/*This class acts as generic wrapper for a stream view (inside a draggable) responsible to display a stream and allow editing*/
	constructor(props){
		super(props)
		this.state={isInEditMode:false,showToolButtons:false}
	}
	onEnterEditMode(e){isInEditMode=true;this.updateState({isInEditMode:true})}
	onExitEditMode(e){isInEditMode=false;this.updateState({isInEditMode:false});instance.saveMasterStream()}
	onHover(e){if(!this.state.showToolButtons && !isInEditMode){this.updateState({showToolButtons:true})}}
	onMouseLeave(e){if(this.state.showToolButtons){this.updateState({showToolButtons:false})}}
	isInEditMode(){return this.state.isInEditMode}
	isToolsVisible(){return this.state.showToolButtons}
	isStreamBeingDragged(){return this.props.stream.id == this.props.ddContext.lastDraggedStream?.id && this.props.ddContext.isDragging}
	isStreamDropReceiver(){return this.props.stream.id == this.props.ddContext.draggedOverStream?.id}
	getStreamAmountString(){return utils.formatCurrencyAmount(this.props.stream.getCurrentExpectedAmount(),undefined,undefined,undefined,Core.getPreferredCurrency())+" / "+Period[this.props.stream.period].unitName}
	render(){return (<div/>)}//to override
}









class CompoundStreamView extends GenericEditableStreamView{
	constructor(props){
		super(props)
		this.state = {...this.state,newStreamNameErrorState: false}
	}
	onEditConfirm(e){
		var name = e.target.parentElement.parentElement.getElementsByTagName("input")[0].value;
		if(!name || name.length==0)return this.updateState({newStreamNameErrorState:(!name || name.length==0)});
		this.props.stream.name = name;
		instance.refresh();
		this.onExitEditMode();
	}
	onClickPlusButton(e){
		if(instance.isFactoryActive()){return}//don't create a new stream is one is already being created
		else{
			Core.makeNewTerminalStream("",0,"monthly",this.props.stream.id).isFactory = true;
			isInEditMode=true;
			instance.setFactoryActive(true);
			instance.refresh();
		}
	}
	render(){
		return(
			<CompoundStreamContainer key={this.props.stream.id} onDragOver={e => this.props.draggableNode.setDraggingOverTerminalStream(false)}>	
				<StreamInfoContainer editing={this.state.isInEditMode} onMouseOver={(e)=>this.onHover(e)} onMouseLeave={(e)=> this.onMouseLeave(e)}>
					<DS.component.Label size={Core.isMobile()?"xs":""} style={{overflow:this.state.isInEditMode?"visible":""}}>{
						this.isInEditMode()?(<DS.component.Input inline autoSize style={{textAlign:"left",marginLeft:-DS.spacing.xxs-DS.borderThickness.m+"rem"}} noMargin autoFocus type="text" defaultValue={this.props.stream.name}
							onKeyUp={(e)=>(e.keyCode===13)?this.onEditConfirm(e):""}
						></DS.component.Input>):this.props.stream.isRoot?"Total":this.props.stream.name}</DS.component.Label>
					{this.isToolsVisible()?(<DS.component.Button.Icon style={{marginLeft:"0.5rem",marginTop:"0.2rem"}} iconName="plus" onClick={(e)=>this.onClickPlusButton(e)}/>):""}
					<DS.component.Spacer/>
					<DS.component.Label style={{flexShrink:0}} size={Core.isMobile()?"xs":""}>{this.getStreamAmountString()}</DS.component.Label>
					{(this.isToolsVisible() && !this.isInEditMode() && !this.props.stream.isRoot)?(<DS.component.Button.Icon style={{marginRight:"-1.5rem",marginTop:"0.2rem"}} iconName="edit" onClick={(e)=>this.onEnterEditMode(e)}/>):""}
					{this.isInEditMode()?(<GridButtonContainer style={{marginLeft:"0.4rem",marginRight:"-1.5rem",flexDirection:"row",alignItems:"center"}}>
						<div onClick={(e)=>this.onEditConfirm(e)} style={{marginBottom:"0.2rem"}}>✓</div>
						<div onClick={(e)=>this.onExitEditMode(e)} style={{marginLeft:"0.2rem",marginLeft:"0.4rem"}}>✕</div>
					</GridButtonContainer>):""}
				</StreamInfoContainer>
				{this.isStreamBeingDragged()?"":
				<StreamChildrenContainer>
					{this.props.stream.children.filter(c => c.isActiveNow())
						.map(c => <DraggableStreamView key={"child-"+c.id} ddContext={this.props.ddContext} stream={c}/>)}</StreamChildrenContainer>}
			</CompoundStreamContainer>
		)
	}
}

const CompoundStreamContainer = styled.div`
	padding-bottom: ${DS.spacing.xxs}rem;
`
const StreamInfoContainer = styled.div`
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    padding: 0 1.5rem;
    height:${props => props.editing?DS.inputHeight:DS.inputHeightInline}rem;
    border-radius: 100vw;
 	color: ${DS.getStyle().bodyTextSecondary}; 
 	border-top: 1px solid ${DS.getStyle().borderColor};
 	transition: height 0.2s;
	margin-top:0.3rem;
`
const StreamChildrenContainer = styled.div`
    margin-left: 1.5rem;   
    padding-top: 0.0rem;
    transition: padding 0.15s,margin-top 0.2s;
`








class TerminalStreamView extends GenericEditableStreamView{
	constructor(props){
		super(props)
		this.state = {...this.state,isInEditMode:false || props.stream.isFactory,
			newStreamNameErrorState:false,
			newStreamAmountErrorState:false,
			zeroHeight: props.stream.isFactory
		}
		this.onEditCancelled = this.onEditCancelled.bind(this)
	}
	onEditConfirm(e){
		var form = e.target.parentElement.parentElement;
		var name = form.getElementsByTagName("input")[0].value
		var amount = parseFloat(form.getElementsByTagName("input")[1].value)
		if(!name || name.length==0 || isNaN(amount))return this.updateState({newStreamNameErrorState:(!name || name.length==0),newStreamAmountErrorState:(isNaN(amount))});											
		this.props.stream.name = name;
		this.props.stream.period = form.getElementsByTagName("select")[0].value;
		this.props.stream.updateExpAmount(amount,new Date)
		instance.refresh()
		if(this.props.stream.isFactory)delete this.props.stream.isFactory
		this.onExitEditMode()
	}
	componentDidMount(){this.updateState({zeroHeight:false})}
	onEditCancelled(e){
		let that = this;
		if(this.props.stream.isFactory){
			Core.deleteStream(this.props.stream)
			instance.setFactoryActive(false);
			this.updateState({zeroHeight:true}).then(() => setTimeout(function() {
				instance.refresh()
				that.onExitEditMode(e);
			}, 500));
		}else {this.onExitEditMode(e)} 
	}
	onTrash(e){
		return Core.presentModal(ModalTemplates.ModalWithComponent("Are you sure?",<TrashStreamModalView stream={this.props.stream}/>)).then(({state,buttonIndex}) => {
			if(buttonIndex==1){//button clicked is confirm
				Core.deleteStream(this.props.stream)
				instance.refresh();
				isInEditMode=false;
				instance.saveMasterStream();
	            console.log("Stream deleted: "+this.props.stream.name);
			}
        }).catch((e)=>{console.log(e)})
	}
	render(){
		return(
			<TerminalStreamContainer onDragOver={e => this.props.draggableNode.setDraggingOverTerminalStream(true)} editing={this.state.isInEditMode} stream={this.props.stream} style={{
					fontWeight: this.props.draggableNode.state.moveOutOfTheWay && this.props.draggableNode.state.isDraggingOverTerminalStream?"bold":"inherit",
					height: (this.state.zeroHeight)?0:"",//for editing only
				}}
				onMouseOver={(e)=> this.onHover(e)} onMouseLeave={(e)=> this.onMouseLeave(e)}>
			{this.state.isInEditMode?<StreamRowContainer style={{opacity:this.state.zeroHeight?0:1}}>
					<DS.component.Input inline autoSize noMargin name="name" autoFocus defaultValue={this.props.stream.name} placeholder="name" 
						style={{textAlign:"left",border:this.state.newStreamNameErrorState?"1px solid "+DS.getStyle().alert:"",marginLeft:-DS.spacing.xxs-DS.borderThickness.m+"rem"}}/>
					<DS.component.Spacer/>
					<DS.component.Input numerical inline noMargin autoSize name="value" placeholder="0.00" defaultValue={this.props.stream.isFactory?"":this.props.stream.getCurrentExpectedAmount()}
							style={{textAlign:"right",border:this.state.newStreamAmountErrorState?"1px solid "+DS.getStyle().alert:""}}></DS.component.Input>
					<div>&nbsp;/&nbsp;</div>
					<DS.component.DropDown inline autoSize noMargin name="period" id="period" defaultValue={this.props.stream.period} onChange={(e)=>{}}>
						{Object.keys(Period.periodName).map((val) => (<option key={val} value={val}>{Period[val].unitName}</option>))}
					</DS.component.DropDown>
					<GridButtonContainer style={{marginRight:"-1rem",marginLeft:"0.5rem"}}>
						<div onClick={(e)=>this.onEditConfirm(e)} style={{marginBottom:"0.2rem"}}>✓</div>
						<div onClick={(e)=>this.onTrash(e)}>🗑</div>
						<div onClick={this.onEditCancelled} style={{marginLeft:"0.2rem"}}>✕</div>
					</GridButtonContainer>	
				</StreamRowContainer>:
				<StreamRowContainer>
					<DS.component.Label style={{marginRight:"1rem"}} size={Core.isMobile()?"xs":""}>{this.props.stream.name}</DS.component.Label>
					<DS.component.Spacer/>
					<DS.component.Label size={Core.isMobile()?"xs":""}>{this.getStreamAmountString()}</DS.component.Label>
					{this.isToolsVisible()?(<DS.component.Button.Icon style={{marginRight:"-1.5rem",marginTop:"0.2rem"}} iconName="edit" onClick={(e)=>this.onEnterEditMode(e)}/>):""}
				</StreamRowContainer>				
			}
		</TerminalStreamContainer>)
	}

}

const TerminalStreamContainer = styled.div`
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    color: ${DS.getStyle().bodyTextSecondary};
    background: ${props => props.editing?DS.getStyle().UIElementBackground:(props.stream.isSaving()?DS.getStyle().savings:(props.stream.isIncome()?DS.getStyle().income:DS.getStyle().expenses))+Math.floor(DS.backgroundOpacity*255).toString(16)};
    padding: 0 1.5rem;
    height:${props => props.editing?DS.inputHeight:DS.inputHeightInline}rem;
    border-radius: 100vw;
    margin-top:0.3rem;
    transition: margin 0.2s, height 0.2s;
`

const StreamRowContainer = styled.div`
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    width:100%;
    transition: opacity 0.5s;
`

const GridButtonContainer = styled.div`
	display: flex;
    width: 2rem;
    height: 2.2rem;
    flex-wrap: wrap;
    flex-direction: column;
    text-align: center;
    justify-content: center;
`

class TrashStreamModalView extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {fetching: true, transactions: []}
		this.loadTransactions()
	}

	loadTransactions(){
		Core.getTransactionsBetweenDates(this.props.stream.getOldestDate(),this.props.stream.getMostRecentDate())
		.then(data => this.updateState({transactions: data.filter(t => t.categorized && t.isAllocatedToStream(this.props.stream)),fetching:false}))
	}

	render(){
		return(
			<div>
				<DS.component.SentenceWrapper>
					After deleting<DS.component.StreamTag noHover highlight>{this.props.stream.name}</DS.component.StreamTag>, you won't be able to add more transactions to it.
				{this.state.fetching?"":this.state.transactions.length>0?"It currently contains these transactions:":""}
				</DS.component.SentenceWrapper>
				<div style={{margin:"auto", minHeight:"5rem", 
				marginTop:"3rem",fontSize:"0.8rem","textAlign":"left"}}>
					{this.state.fetching?<div>loading preview....</div>:
					<div>
						<ul><div style={{fontWeight:"bold",marginBottom:"1rem"}}></div>
						{this.state.transactions.slice(0,4).map((t,i) => <DS.component.TransactionListItem key={i} transaction={t}/>)}
						{this.state.transactions.length>4?<DS.component.ListItem noHover fullBleed size="xs" style={{justifyContent:"flex-end",border:"none"}}>and {this.state.transactions.length-2} other(s)</DS.component.ListItem>:""}
						</ul>
					</div>
				}
				</div>
			</div>
		)
	}
}




class DragGhost extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {stream : Core.getMasterStream(),width: "",visible:false}
		DragGhostInstance = this
		this.dom = React.createRef() 
	}
	render(){
		return(<DraggableGhostContainer ref={this.dom} style={{width:this.state.width,display:this.state.visible?"flex":"none"}} stream={this.state.stream} id="clone"><DS.component.Label highlight>{this.state.stream.name}</DS.component.Label><DS.component.Spacer/>{this.state.stream.isTerminal()?"":<Badge> {this.state.stream.getAllTerminalStreams(true).length}</Badge>}</DraggableGhostContainer>)
	}
}

const Badge = styled.div`
	display:flex;
	background: ${props=> DS.getStyle().inputFieldBackground};
	padding: 0 0.5rem;
    height: 1.5rem;
    display: flex;
    font-size: 1rem;
    align-content: center;
    justify-content: center;
    color: white;
    align-items: center;
    border-radius: 100vw;
    text-shadow: 0 0 4px black;
    margin-left: 2rem;
`

const DraggableGhostContainer = styled.div`
	display:none;
	position: absolute;
	height: ${DS.inputHeightInline}rem;
	pointer-events: none;
	padding-left: 1.5rem;
	padding-right: ${props => props.stream.isTerminal()?1.5:0.4}rem;
	border-radius: 100vw;
	z-index: 1;
	flex-direction: row;
	color: ${DS.getStyle().bodyTextSecondary}; 
    align-items: center;
    background: ${props => props.stream.isTerminal()?((props.stream.isSaving()?DS.getStyle().savings:(props.stream.isIncome()?DS.getStyle().income:DS.getStyle().expenses))+Math.floor(DS.backgroundOpacity*255).toString(16)):DS.getStyle().UIElementBackground};
}
`

