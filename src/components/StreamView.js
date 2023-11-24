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
let isDraggingOverTerminalStreamGlobal = false; //using this variable for core logic as it has zero latency
let isDebouncing = false;
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
				dropTarget:{}//stream it will be dropped into
			},
			
		}
		instance = this;

	}
	setFactoryActive(b){this.factoryActive=b}
	takeSnapshot(){return new CompoundStream(JSON.parse(JSON.stringify(Core.getMasterStream())))}
	isFactoryActive(){return this.factoryActive}
	render(){
		if(!this.state.masterStream)return(<div/>)
		if(!this.masterStreamSnapshot){this.masterStreamSnapshot = this.takeSnapshot()}
		return(<DS.Layout.PageWithTitle title="Streams" content={
			<div>
				<DragGhost/>
				<StyledMasterStreamView>
					<DraggableStreamViewContainer ddContext={this.state.ddContext} stream={this.state.masterStream} masterStreamNode={this} />
				</StyledMasterStreamView>
			</div>
		}/>
	)}
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

function saveMasterStream(){
	let tsSnap = instance.masterStreamSnapshot;
	let ts = Core.getMasterStream();
	if(ts.getAllTerminalStreams().length < tsSnap.getAllTerminalStreams().length){throw new Error("Stream Integrity is compromised. Less terminal streams are present after the change than before.")}
	else {
		Core.saveStreams().then(() => instance.masterStreamSnapshot = instance.takeSnapshot());
	}
}

class DraggableStreamViewContainer extends BaseComponent{
	constructor(props){
		super(props)
		this.state={
			ddContext: this.props.ddContext,
			masterStreamNode: this.props.masterStreamNode,
		}
		streamReactNodeMap[props.stream.id]=this
		this.onDragOver = this.onDragOver.bind(this)
		this.onDragEnd = this.onDragEnd.bind(this)
		this.onDragStart = this.onDragStart.bind(this)
	}

	//drag and drop handling
	onDragStart(e){
		if(this.isInEditMode() || this.props.stream.isRoot){return e.preventDefault()}

		this.state.ddContext.dragStartDomHeight = e.target.clientHeight			//used for animating the height on drop
		this.state.ddContext.dragAnchorOffset = e.pageX-e.target.offsetLeft; 	//used for clone placement
		this.state.ddContext.lastDraggedStream = this.props.stream;				//used to test that a node is the one of the dragged stream
		this.state.ddContext.isDragging = true;									//idem

		//shrink animation
		e.target.style["height"] = this.state.ddContext.dragStartDomHeight +"px" //set to numerical value
		setTimeout(() => e.target.style["height"] = 0,20) 						 //after letting the dom update, change to animate

		//handle the dragging image: set the default ghost to nothing and create our own clone
		e.dataTransfer.setDragImage(new Image(),0,0)
		DragGhostInstance.updateState({stream: this.props.stream,width:(e.target.clientWidth-3*DS.remToPx)+"px",visible:true})
		this.state.ddContext.clone = DragGhostInstance.dom.current;

		e.stopPropagation();//stop propagating the event to parents
	}
	onDragOver(e){
		const stopAndExit = () => {e.preventDefault();e.stopPropagation()}
		if(this.isInEditMode() || !this.state.ddContext.clone){return stopAndExit()}

		//update dragging image
		this.state.ddContext.clone.style.left = Math.floor(e.pageX-this.state.ddContext.dragAnchorOffset)+"px"
		this.state.ddContext.clone.style.top = Math.floor(e.pageY-this.state.ddContext.clone.offsetHeight/2)+"px"
		
		if(this.amIDraggingNow()){return}//hovering over myself: ignore actions and let events flow to streams underneath
		else if(!this.amIBeingDraggedOver()){//If I'm not already being hovered: make space for drop
			this.state.ddContext.draggedOverStream = this.props.stream;
			Object.keys(streamReactNodeMap).forEach(k => streamReactNodeMap[k].updateState({moveOutOfTheWay: (k == this.props.stream.id)}))
		}
		return stopAndExit();
	}
	onDragEnd(e){
		if(this.isInEditMode()){return e.preventDefault()}
		e.preventDefault();
		e.stopPropagation();
		
		//stream grouping or insertion
		let draggedOverStreamParent = Core.getParentOfStream(this.state.ddContext.draggedOverStream)
		let draggedStreamParent = Core.getParentOfStream(this.state.ddContext.lastDraggedStream);
		if(!draggedOverStreamParent || !this.state.ddContext.draggedOverStream.id || this.amIBeingDraggedOver()){}//do nothing if dropped on masterstream, outside of the zone, or on itself
		else if(isDraggingOverTerminalStreamGlobal){//dropped over a terminal stream: group together
			Core.groupStreams(this.props.stream,this.state.ddContext.draggedOverStream)
		}else{//dropped over the placeholder: move to this 
			var idx = Core.getStreamIndexInParent(this.state.ddContext.draggedOverStream);
			if(draggedOverStreamParent.id == draggedStreamParent.id && idx > Core.getStreamIndexInParent(this.state.ddContext.lastDraggedStream)){idx--} //adjust index if dropped after the original position in same parent
			this.props.stream.moveFromParentToParentAtIndex(draggedStreamParent,draggedOverStreamParent,idx)
		}

		//update to non-dragging state
		isDebouncing = true;//suppress the height animation when the stream is reinsterted
		Object.keys(streamReactNodeMap).forEach(k => streamReactNodeMap[k].updateState({moveOutOfTheWay:false}))
		this.state.ddContext.draggedOverStream = {};
		DragGhostInstance.updateState({visible:false})
		setTimeout(() => {
			this.state.ddContext.isDragging = false;
			this.refreshMasterStream();
		},10)

		saveMasterStream();
	}

	//getters
	isIncome(){return this.props.stream.isIncome()}
	isInEditMode(){return isInEditMode}
	getStreamAmountString(){return utils.formatCurrencyAmount(this.props.stream.getCurrentExpectedAmount(),undefined,undefined,undefined,Core.getPreferredCurrency())+" / "+Period[this.props.stream.period].unitName}


	//operations
	setDraggingOverTerminalStream(b){
		isDraggingOverTerminalStreamGlobal = b
		if(this.state.isDraggingOverTerminalStream!=b){this.updateState({isDraggingOverTerminalStream:b})}//only for display
	}
	refreshMasterStream(){this.props.masterStreamNode.updateState({masterStream:this.props.masterStreamNode.state.masterStream})}
	amILastDraggedStream(){return this.props.stream.id == this.props.masterStreamNode.state.ddContext.lastDraggedStream?.id}
	amIBeingDraggedOver(){return this.state.ddContext.draggedOverStream?.id==this.props.stream.id}
	amIDraggingNow(){return this.amILastDraggedStream() && this.props.masterStreamNode.state.ddContext.isDragging}
	render(){
		return(
			<StreamContainer style={
				this.amILastDraggedStream()?(this.amIDraggingNow()?{height:0,opacity:0}:{height:this.props.masterStreamNode.state.ddContext.dragStartDomHeight +"px",opacity:1}):{}} key={"cont-"+this.props.stream.id} id={"cont-"+this.props.stream.id} draggable onDragStart={this.onDragStart} onDragOver={this.onDragOver} onDragEnd={this.onDragEnd} onDragEnter={e => e.preventDefault()}>
				{this.props.stream.children?<CompoundStreamView stream={this.props.stream} streamNode={this} masterStreamNode={this.props.masterStreamNode}/>:
				<TerminalStreamView stream={this.props.stream} streamNode={this} masterStreamNode={this.props.masterStreamNode}/>}
			</StreamContainer>
		)
	}
}

class GenericEditableStreamView extends BaseComponent{
	constructor(props){
		super(props)
		this.state={streamNode:props.streamNode,isInEditMode:false,showToolButtons:false}
	}
	onEnterEditMode(e){isInEditMode=true;this.updateState({isInEditMode:true})}
	onExitEditMode(e){isInEditMode=false;this.updateState({isInEditMode:false});saveMasterStream()}
	onHover(e){if(!this.state.showToolButtons && !isInEditMode){this.updateState({showToolButtons:true})}}
	onMouseLeave(e){if(this.state.showToolButtons){this.updateState({showToolButtons:false})}}
	isInEditMode(){return this.state.isInEditMode}
	isToolsVisible(){return this.state.showToolButtons}
	getStream(){return this.state.streamNode.props.stream}
	getMasterStreamNode(){return this.props.masterStreamNode}
	getDraggableStreamNode(){return this.state.streamNode}
	isStreamBeingDragged(){return this.state.streamNode.props.stream.id == this.props.masterStreamNode.state.ddContext.lastDraggedStream?.id}
	isStreamDropReceiver(){return this.state.streamNode.props.stream.id == this.props.masterStreamNode.state.ddContext.draggedOverStream?.id}
	render(){return (<div/>)}//template
}


class CompoundStreamView extends GenericEditableStreamView{
	constructor(props){
		super(props)
		this.state = {...this.state,newStreamNameErrorState: false}
	}
	onEditConfirm(e){
		var name = e.target.parentElement.parentElement.getElementsByTagName("input")[0].value;
		if(!name || name.length==0)return this.updateState({newStreamNameErrorState:(!name || name.length==0)});
		this.getStream().name = name;
		this.getDraggableStreamNode().refreshMasterStream();
		this.onExitEditMode();
	}
	onClickPlusButton(e){
		if(this.getMasterStreamNode().isFactoryActive()){return}//don't create a new stream is one is already being created
		else{
			Core.makeNewTerminalStream("",0,"monthly",this.getStream().id).isFactory = true;
			isInEditMode=true;
			this.getMasterStreamNode().setFactoryActive(true);
			this.getDraggableStreamNode().refreshMasterStream()
		}
	}
	render(){
		return(
			<CompoundStreamContainer key={this.props.stream.id} id={this.props.stream.id}>	
				{this.props.stream.isRoot?<div/>:<Placeholder shouldAnimateHeight={isDraggingOverTerminalStreamGlobal  || !this.isStreamDropReceiver()} highlight={this.getDraggableStreamNode().state.moveOutOfTheWay && !this.getDraggableStreamNode().state.isDraggingOverTerminalStream} onDragOver={e => this.getDraggableStreamNode().setDraggingOverTerminalStream(false)} moveOutOfTheWay={this.getDraggableStreamNode().state.moveOutOfTheWay} key={"placeholder-"+this.props.stream.id}/>}
				<StreamInfoContainer onDragOver={e => this.getDraggableStreamNode().setDraggingOverTerminalStream(false)} editing={this.state.isInEditMode} onMouseOver={(e)=>this.onHover(e)} onMouseLeave={(e)=> this.onMouseLeave(e)}>
					<DS.component.Label size={Core.isMobile()?"xs":""} style={{overflow:this.state.isInEditMode?"visible":""}}>{
						this.isInEditMode()?(<DS.component.Input inline autoSize style={{textAlign:"left",marginLeft:-DS.spacing.xxs-DS.borderThickness.m+"rem"}} noMargin autoFocus type="text" defaultValue={this.getStream().name}
							onKeyUp={(e)=>(e.keyCode===13)?this.onEditConfirm(e):""}
						></DS.component.Input>):this.getStream().isRoot?"Total":this.getStream().name}</DS.component.Label>
					{this.isToolsVisible()?(<DS.component.Button.Icon style={{marginLeft:"0.5rem",marginTop:"0.2rem"}} iconName="plus" onClick={(e)=>this.onClickPlusButton(e)}/>):""}
					<Spacer/>
					<DS.component.Label style={{flexShrink:0}} size={Core.isMobile()?"xs":""}>{this.getDraggableStreamNode().getStreamAmountString()}</DS.component.Label>
					{(this.isToolsVisible() && !this.isInEditMode() && !this.props.stream.isRoot)?(<DS.component.Button.Icon style={{marginRight:"-1.5rem",marginTop:"0.2rem"}} iconName="edit" onClick={(e)=>this.onEnterEditMode(e)}/>):""}
					{this.isInEditMode()?(<GridButtonContainer style={{marginLeft:"0.4rem",marginRight:"-1.5rem",flexDirection:"row",alignItems:"center"}}>
						<div onClick={(e)=>this.onEditConfirm(e)} style={{marginBottom:"0.2rem"}}>✓</div>
						<div onClick={(e)=>this.onExitEditMode(e)} style={{marginLeft:"0.2rem",marginLeft:"0.4rem"}}>✕</div>
					</GridButtonContainer>):""}
				</StreamInfoContainer>
				{this.props.streamNode.amIDraggingNow()?"":
				<StreamChildrenContainer>
					{this.getStream().children.filter(c => c.isActiveNow())
						.map(c => <DraggableStreamViewContainer masterStreamNode={this.getMasterStreamNode()} key={"child-"+c.id} ddContext={this.getDraggableStreamNode().state.ddContext} stream={c}/>)}</StreamChildrenContainer>}
			</CompoundStreamContainer>
		)
	}
}


class TerminalStreamView extends GenericEditableStreamView{
	constructor(props){
		super(props)
		this.state = {...this.state,isInEditMode:false || props.streamNode.props.stream.isFactory,
			newStreamNameErrorState:false,
			newStreamAmountErrorState:false,
			zeroHeight: props.streamNode.props.stream.isFactory
		}
		this.onEditCancelled = this.onEditCancelled.bind(this)
	}
	onEditConfirm(e){
		var form = e.target.parentElement.parentElement;
		var name = form.getElementsByTagName("input")[0].value
		var amount = parseFloat(form.getElementsByTagName("input")[1].value)
		if(!name || name.length==0 || isNaN(amount))return this.updateState({newStreamNameErrorState:(!name || name.length==0),newStreamAmountErrorState:(isNaN(amount))});											
		this.getStream().name = name;
		this.getStream().period = form.getElementsByTagName("select")[0].value;
		this.getStream().updateExpAmount(amount,new Date)
		this.getDraggableStreamNode().refreshMasterStream()
		if(this.getStream().isFactory)delete this.getStream().isFactory
		this.onExitEditMode()
	}
	componentDidMount(){this.updateState({zeroHeight:false})}
	onEditCancelled(e){
		let that = this;
		if(this.getStream().isFactory){
			Core.deleteStream(this.getStream())
			this.getMasterStreamNode().setFactoryActive(false);
			this.updateState({zeroHeight:true}).then(() => setTimeout(function() {
				that.getDraggableStreamNode().refreshMasterStream();
				that.onExitEditMode(e);
			}, 500));
		}else {this.onExitEditMode(e)} 
	}
	onTrash(e){
		var s = this.getStream();
		var start = s.getOldestDate();
		var end = s.getMostRecentDate();
		Core.getTransactionsBetweenDates(start,end)
		.then(data => {
			var txns = data.filter(t => t.categorized && t.isAllocatedToStream(s))
			if(txns.length>0)return Core.presentModal(ModalTemplates.ModalWithStreamTransactions("Are you sure?","This will terminate the stream "+s.name+" with the following transactions in it:",s))
			else return Core.presentModal(ModalTemplates.BaseModal("Are you sure?","This will terminate the stream "+s.name))
		})
		.then(({state,buttonIndex}) => {
			if(buttonIndex==1){//button clicked is confirm
				Core.deleteStream(s);
				this.getDraggableStreamNode().refreshMasterStream(); //no need to call onExitEditMode() because the component will be unmounted 
				isInEditMode=false;
				saveMasterStream();
	            console.log("Stream deleted: "+s.name);
			}
        }).catch((e)=>{console.log(e)})
	}
	render(){
		//terminal view that supports edit mode
		
		//this is to manage the suppression of the animation when a dragged stream ends
		let shouldAnimateHeightOfDraggedStream = true;
		if(this.isStreamBeingDragged()){
			shouldAnimateHeightOfDraggedStream = !isDebouncing;
			isDebouncing = false;
		}
		return(
			<div>
				<Placeholder highlight={this.getDraggableStreamNode().state.moveOutOfTheWay && !this.getDraggableStreamNode().state.isDraggingOverTerminalStream} moveOutOfTheWay={this.getDraggableStreamNode().state.moveOutOfTheWay} key={"placeholder-"+this.props.stream.id} id={this.props.stream.id+"-placeholder"} onDragOver={e => this.getDraggableStreamNode().setDraggingOverTerminalStream(false)}
					shouldAnimateHeight={isDraggingOverTerminalStreamGlobal  || !this.isStreamDropReceiver()}
				/>
				<StreamInfoContainerTerminal onDragOver={e => this.getDraggableStreamNode().setDraggingOverTerminalStream(true)} editing={this.state.isInEditMode} key={this.props.stream.id} id={this.props.stream.id}
					isIncome={this.getDraggableStreamNode().isIncome()} isSavings={this.getDraggableStreamNode().props.stream.isSavings}
					style={{
						fontWeight: this.getDraggableStreamNode().state.moveOutOfTheWay&&this.getDraggableStreamNode().state.isDraggingOverTerminalStream?"bold":"inherit",
						height: (this.props.streamNode.amIDraggingNow() || this.state.zeroHeight)?0:"",
					}}
					shouldAnimateHeight={shouldAnimateHeightOfDraggedStream}
					onMouseOver={(e)=> this.onHover(e)} onMouseLeave={(e)=> this.onMouseLeave(e)}>
				{this.state.isInEditMode?<StreamRowContainer style={{opacity:this.state.zeroHeight?0:1}}>
						<DS.component.Input inline autoSize noMargin name="name" autoFocus defaultValue={this.getStream().name} placeholder="name" 
							style={{textAlign:"left",border:this.state.newStreamNameErrorState?"1px solid "+DS.getStyle().alert:"",marginLeft:-DS.spacing.xxs-DS.borderThickness.m+"rem"}}/>
						<Spacer/>
						<DS.component.Input numerical inline noMargin autoSize name="value" placeholder="0.00" defaultValue={this.getStream().isFactory?"":this.getStream().getCurrentExpectedAmount()}
								style={{textAlign:"right",border:this.state.newStreamAmountErrorState?"1px solid "+DS.getStyle().alert:""}}></DS.component.Input>
						<div>&nbsp;/&nbsp;</div>
						<DS.component.DropDown inline autoSize noMargin name="period" id="period" defaultValue={this.getStream().period} onChange={(e)=>{}}>
							{Object.keys(Period.periodName).map((val) => (<option key={val} value={val}>{Period[val].unitName}</option>))}
						</DS.component.DropDown>
						<GridButtonContainer style={{marginRight:"-1rem",marginLeft:"0.5rem"}}>
							<div onClick={(e)=>this.onEditConfirm(e)} style={{marginBottom:"0.2rem"}}>✓</div>
							<div onClick={(e)=>this.onTrash(e)}>🗑</div>
							<div onClick={this.onEditCancelled} style={{marginLeft:"0.2rem"}}>✕</div>
						</GridButtonContainer>	
					</StreamRowContainer>:
					<StreamRowContainer>
						<DS.component.Label style={{marginRight:"1rem"}} size={Core.isMobile()?"xs":""}>{this.getStream().name}</DS.component.Label>
						<Spacer/>
						<DS.component.Label style={{flexShrink:0}} size={Core.isMobile()?"xs":""}>{this.getDraggableStreamNode().getStreamAmountString()}</DS.component.Label>
						{this.isToolsVisible()?(<DS.component.Button.Icon style={{marginRight:"-1.5rem",marginTop:"0.2rem"}} iconName="edit" onClick={(e)=>this.onEnterEditMode(e)}/>):""}
					</StreamRowContainer>				
				}
			</StreamInfoContainerTerminal>
		</div>)
	}

}

const Placeholder = (props) => <div onDragOver={props.onDragOver} id={props.id} style={{paddingTop:props.moveOutOfTheWay?0.3+"rem":0}}><StreamPlaceholder shouldAnimateHeight={props.shouldAnimateHeight} highlight={props.highlight} style={{height:props.moveOutOfTheWay?DS.inputHeightInline+"rem":0}}/></div>

/**helper functions*****/
function findStreamDom(dom){return (dom.draggable)?dom:findStreamDom(dom.parentElement)}

/********Styled Components********/

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
    background: ${props => props.stream.isTerminal()?((props.stream.isSavings?DS.getStyle().savings:(props.stream.isIncome()?DS.getStyle().income:DS.getStyle().expenses))+Math.floor(DS.backgroundOpacity*255).toString(16)):DS.getStyle().UIElementBackground};
}
`

const CompoundStreamContainer = styled.div`
	padding-bottom: ${DS.spacing.xxs}rem;
`

const StyledMasterStreamView = styled.div`
    margin-top: 0rem;
`

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
    transition: margin 0.15s, height ${props => props.shouldAnimateHeight?0.1:0}s;
    opacity: ${props => props.highlight?0.8:0};
    &:hover{
    	opacity:1;
    }
`
const StreamInfoContainerTerminal = styled.div`
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    color: ${DS.getStyle().bodyTextSecondary};
    background: ${props => props.editing?DS.getStyle().UIElementBackground:(props.isSavings?DS.getStyle().savings:(props.isIncome?DS.getStyle().income:DS.getStyle().expenses))+Math.floor(DS.backgroundOpacity*255).toString(16)};
    padding: 0 1.5rem;
    height:${props => props.editing?DS.inputHeight:DS.inputHeightInline}rem;
    border-radius: 100vw;
    margin-top:0.3rem;
    transition: margin 0.15s, height ${props => props.shouldAnimateHeight?0.1:0}s;
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
	margin-top:0.3rem;
 	transition: height 0.1s;
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

const Spacer = styled.div`
	flex-grow:1
`

const StreamChildrenContainer = styled.div`
    margin-left: 1.5rem;
    
    padding-top: 0.0rem;
    transition: padding 0.15s,margin-top 0.2s;
`

const StreamContainer = styled.div`
    cursor: pointer !important;
    opacity: ${props => props.inVisible?0:1};
    transition: all 0.2s;
`
