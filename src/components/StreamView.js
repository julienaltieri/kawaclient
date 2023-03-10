import BaseComponent from './BaseComponent'
import Core from '../core.js'
import styled from 'styled-components'
import ApiCaller from '../ApiCaller'
import {ModalController, ModalTemplates} from '../ModalManager.js'
import {Period} from '../Time'
const utils = require('../utils.js')

var streamNodeMap = {}
var isInEditMode = false

export default class MasterStreamView extends BaseComponent{
	constructor(props){
		super(props);
		this.state={
			masterStream:Core.getMasterStream(),
			ddContext:{
				draggingStreamNode:undefined,
				dragHoveredStream:{},//stream being overed right now and need to make space
				dropTarget:{}//stream it will be dropped into
			}
		}
	}
	render(){
		if(!this.state.masterStream)return(<div/>)
		return(
		<StyledMasterStreamView>
			<DraggableStreamViewContainer ddContext={this.state.ddContext} streamId={this.state.masterStream.id} masterStreamNode={this} />
		</StyledMasterStreamView>
	)}
}

function onChangeDone(){
	Core.saveStreams()

}

class DraggableStreamViewContainer extends BaseComponent{
	constructor(props){
		super(props)
		this.state={
			stream: Core.getStreamById(props.streamId),
			ddContext: this.props.ddContext,
			masterStreamNode: this.props.masterStreamNode,
		}
		streamNodeMap[this.state.stream.id]=this
	}

	//drag and drop handling
	onDragStart(e,streamId){
		if(this.isInEditMode()){return e.preventDefault()}
		this.updateState({dragging :true});
		e.target.style.opacity = 0.5
		this.state.ddContext.draggingDOM = e.target;
		this.state.ddContext.draggingStreamNode = this;

		//handle the dragging image
		var clone = this.state.ddContext.draggingDOM.cloneNode(true);
		clone.style.position = "absolute"
		clone.style["pointer-events"] = "none"
		clone.style.opacity = 0.9
		if(this.state.ddContext.clone)this.state.ddContext.clone.remove()
		this.state.ddContext.clone = clone;
		document.body.appendChild(clone)

		//set ghost image to nothing
		var img = new Image();
	    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
		e.dataTransfer.setDragImage(img,0,0)

		e.stopPropagation();
	}
	onDragEnter(e){
		if(this.isInEditMode()){return e.preventDefault()}
		this.state.ddContext.hoveredDOM = e.target
		e.preventDefault()
		e.stopPropagation();
	}
	onDragOver(e){
		if(this.isInEditMode()){return e.preventDefault()}

		//position dragging image
		this.state.ddContext.clone.style.left = Math.floor(e.pageX-this.state.ddContext.clone.offsetWidth/2)+"px"
		this.state.ddContext.clone.style.top = Math.floor(e.pageY-this.state.ddContext.clone.offsetHeight/2)+"px"
		
		//this react node's stream
		var stream = Core.getStreamById(this.props.streamId)
		var node = getNodeById(stream.id);

		//find the drop target
		var dt = node.state.stream;
		var parentStream = Core.getParentOfStream(stream)

		//if hover is above a free space, update the drop target to be the parent
		if(findStreamDom(e.target).isSameNode(e.target)){dt = parentStream}
		
		//if this is a new drop target, update
		if(this.state.ddContext.dropTarget.id != dt.id){this.setDropTarget(dt)}

		
		
		//move out of the way if there is a change
		if(stream.id != this.state.ddContext.dragHoveredStream.id){
			this.state.ddContext.dragHoveredStream=stream
			node.moveOutOfTheWay(true)
		}

		e.preventDefault()
		e.stopPropagation();
	}
	onDragEnd(e){
		if(this.isInEditMode()){return e.preventDefault()}
		var dropStream = this.state.ddContext.dropTarget
		var parentStream = Core.getParentOfStream(this.state.stream)
		if(!dropStream.id || this.state.stream.id == dropStream.id){
			endDragNDropInteraction(this.state.ddContext)
			e.preventDefault()
			e.stopPropagation()
		}
		if(!!dropStream.children){
			var dropIndex = dropStream.children.map(c => c.id).indexOf(this.state.ddContext.dragHoveredStream.id);
			this.state.stream.moveFromParentToParentAtIndex(parentStream,dropStream,dropIndex)
			if(parentStream.children.length==0){
		        Core.getParentOfStream(parentStream).removeChild(parentStream)
		    }
			getNodeById(parentStream.id).refreshStream(parentStream)
			getNodeById(dropStream.id).refreshStream(dropStream)
			
		}else if(this.state.stream.id!=dropStream.id){//create a new stream to group the two
			Core.groupStreams(this.state.stream,dropStream)
			getNodeById(parentStream.id).refreshStream()
		}

		endDragNDropInteraction(this.state.ddContext)
		e.preventDefault()
		e.stopPropagation()
		onChangeDone()
	}
	onDrop(e){
		this.state.ddContext.draggingDOM.style.opacity = 1
		this.state.ddContext.draggingStreamNode.updateState({dragging :false});
		this.state.ddContext.clone.remove()
		e.preventDefault()
		e.stopPropagation();
	}
	moveOutOfTheWay(bool){
		Object.keys(streamNodeMap).forEach(k => {
			var n = streamNodeMap[k];
			if(n.state.stream.id != this.state.stream.id)n.updateState({moveOutOfTheWay:false})
		})
		this.updateState({moveOutOfTheWay:bool})
	}
	setDropTarget(s){this.state.ddContext.dropTarget = s;streamNodeMap[s.id].setDropZoneActive(true)}
	setDropZoneActive(bool){
		Object.keys(streamNodeMap).forEach(k => {
			var n = streamNodeMap[k];
			if(n.state.stream.id != this.state.stream.id)n.updateState({dropZoneActive:false})
		})
		this.updateState({dropZoneActive:bool})
	}

	//getters
	isIncome(){return this.state.stream.getCurrentExpectedAmount()>0}
	isInEditMode(){return isInEditMode}
	getStreamAmountString(){
		var amt = this.state.stream.getCurrentExpectedAmount();
		return (amt>0?"+":"-")+utils.formatDollarAmount(Math.abs(amt))+" /"+Period[this.state.stream.period].unitName
	}

	//operations
	refreshStream(s){this.updateState({stream:(s||this.state.stream)})}
	refreshMasterStream(){this.state.masterStreamNode.updateState({masterStream:this.state.masterStreamNode.state.masterStream})}
	render(){
		var isTerminal = !this.state.stream.children;
		return(
			<StreamContainer key={this.state.streamId} draggable 
				onDragStart={(e) => this.onDragStart(e,this.state.stream.id)}
				onDragEnter={(e) => this.onDragEnter(e)}
				onDragOver={(e) => this.onDragOver(e)}
				onDragEnd={(e) => this.onDragEnd(e)}
				onDrop={(e) => this.onDrop(e)}
				>
				{this.state.stream.children?(<CompoundStreamView streamNode={this}/>):/*//compound stream*/
											(<TerminalStreamView streamNode={this}/>)}{/*terminal stream*/}
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
	onExitEditMode(e){isInEditMode=false;this.updateState({isInEditMode:false});onChangeDone()}
	onHover(e){if(!this.state.showToolButtons && !isInEditMode){this.updateState({showToolButtons:true})}}
	onMouseLeave(e){if(this.state.showToolButtons){this.updateState({showToolButtons:false})}}
	isInEditMode(){return this.state.isInEditMode}
	isToolsVisible(){return this.state.showToolButtons}
	getStream(){return this.state.streamNode.state.stream}
	getStreamNode(){return this.state.streamNode}
	render(){return (<div //template
		onMouseOver={(e)=> this.onHover(e)} onMouseLeave={(e)=> this.onMouseLeave(e)}>
		{this.isToolsVisible()?(<EditButton onClick={(e)=>this.onEnterEditMode(e)}>???</EditButton>):""}
	</div>)}
}


class CompoundStreamView extends GenericEditableStreamView{
	constructor(props){
		super(props)
		this.state = {...this.state,newStreamNameErrorState: false,dropZoneActive: false}
	}
	onEditConfirm(e){
		var name = e.target.parentElement.parentElement.getElementsByTagName("input")[0].value;
		if(!name || name.length==0)return this.updateState({newStreamNameErrorState:(!name || name.length==0)});
		this.getStream().name = name;
		this.getStreamNode().refreshMasterStream();
		this.onExitEditMode();
	}
	onClickPlusButton(e){
		Core.makeNewTerminalStream("",0,"monthly",this.getStream().id).isFactory = true;
		this.getStreamNode().refreshMasterStream()
	}
	render(){
		return(
			<div>	
				<StreamInfoContainer onMouseOver={(e)=>this.onHover(e)} onMouseLeave={(e)=> this.onMouseLeave(e)}>
					<StreamTitle>{
							this.isInEditMode()?(<input	style={{width:"6rem"}} autoFocus type="text" defaultValue={this.getStream().name} onChange={()=>{}}
								onKeyUp={(e)=>(e.keyCode===13)?this.onEditConfirm(e):""}
							></input>):this.getStream().name}</StreamTitle>
					{this.isToolsVisible()?(<PlusButton onClick={(e)=>this.onClickPlusButton(e)}>+</PlusButton>):""}
					<Spacer/>
					<StreamAmount>{this.getStreamNode().getStreamAmountString()}</StreamAmount>
					{(this.isToolsVisible() && !this.isInEditMode())?(<EditButton onClick={(e)=>this.onEnterEditMode(e)}>???</EditButton>):""}
					{this.isInEditMode()?(<GridButtonContainer style={{marginLeft:"0.4rem",marginRight:"-1.5rem",flexDirection:"row",alignItems:"center"}}>
						<div onClick={(e)=>this.onEditConfirm(e)} style={{marginBottom:"0.2rem"}}>???</div>
						<div onClick={(e)=>this.onExitEditMode(e)} style={{marginLeft:"0.2rem",marginLeft:"0.4rem"}}>???</div>
					</GridButtonContainer>):""}
				</StreamInfoContainer>
				<StreamChildrenContainer style={{"background":this.getStreamNode().state.dropZoneActive?"#dbf2ff":"inherit"}}>
					{this.getStream().children.filter(c => c.isActiveNow())
						.map(c => <DraggableStreamViewContainer masterStreamNode={this.getStreamNode().state.masterStreamNode} key={c.id} ddContext={this.getStreamNode().state.ddContext} streamId={c.id}/>)}</StreamChildrenContainer>
			</div>
		)
	}
}


class TerminalStreamView extends GenericEditableStreamView{
	constructor(props){
		super(props)
		this.state = {...this.state,isInEditMode:false || props.streamNode.state.stream.isFactory,newStreamNameErrorState:false,newStreamAmountErrorState:false}
	}
	onEditConfirm(e){
		var form = e.target.parentElement.parentElement;
		var name = form.getElementsByTagName("input")[0].value
		var amount = parseFloat(form.getElementsByTagName("input")[1].value)
		if(!name || name.length==0 || isNaN(amount))return this.updateState({newStreamNameErrorState:(!name || name.length==0),newStreamAmountErrorState:(isNaN(amount))});											
		this.getStream().name = name;
		this.getStream().period = form.getElementsByTagName("select")[0].value;
		this.getStream().updateExpAmount(amount,new Date)
		this.getStreamNode().refreshMasterStream()
		if(this.getStream().isFactory)delete this.getStream().isFactory
		this.onExitEditMode()
	}
	onEditCancelled(e){
		if(this.getStream().isFactory){
			Core.deleteStream(this.getStream())
			this.getStreamNode().refreshMasterStream()
		}
		this.onExitEditMode(e)
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
			console.log(buttonIndex)
			if(buttonIndex==1){//button clicked is confirm
				Core.deleteStream(s);
				this.getStreamNode().refreshMasterStream(); //no need to call onExitEditMode() because the component will be unmounted 
				isInEditMode=false;
				onChangeDone();
	            console.log("Stream deleted: "+s.name);
			}
        }).catch((e)=>{console.log(e)})
	}
	render(){
		//terminal view that supports edit mode
		var editMode = 
		<NewStreamContainer style={{paddingRight: "0.6rem",height: "1rem"}}	onKeyUp={(e)=>(e.keyCode===13)?this.onEditConfirm(e):""}>
			<NameInput 	name="name" autoFocus defaultValue={this.getStream().name} placeholder="name" style={{border:this.state.newStreamNameErrorState?"1px solid red":"inherit"}}></NameInput>
			<Spacer/>
			<AmountInput  name="value" placeholder="0.00"  defaultValue={this.getStream().isFactory?"":this.getStream().getCurrentExpectedAmount()}
					style={{border:this.state.newStreamAmountErrorState?"1px solid red":"inherit"}}></AmountInput>
			<div style={{"height":"1rem",marginLeft:"0.2rem"}}>/</div>
			<StreamPeriodInput 	name="period" id="period" defaultValue={this.getStream().period} onChange={(e)=>{}}>
				{Object.keys(Period.periodName).map((val) => (<option key={val} value={val}>{Period[val].unitName}</option>))}
			</StreamPeriodInput>
			<GridButtonContainer style={{}}>
				<div onClick={(e)=>this.onEditConfirm(e)} style={{marginBottom:"0.2rem"}}>???</div>
				<div onClick={(e)=>this.onTrash(e)}>????</div>
				<div onClick={(e)=>this.onEditCancelled(e)} style={{marginLeft:"0.2rem"}}>???</div>
			</GridButtonContainer>
		</NewStreamContainer>

		var normalMode = 
		<StreamInfoContainerTerminal 
			isIncome={this.getStreamNode().isIncome()} isSavings={this.getStreamNode().state.stream.isSavings}
			style={{
				marginTop: 		(this.getStreamNode().state.moveOutOfTheWay)?"30px":"inherit",
				fontWeight: 	this.getStreamNode().state.dropZoneActive?"bold":"inherit"
			}}
			onMouseOver={(e)=> this.onHover(e)} onMouseLeave={(e)=> this.onMouseLeave(e)}>
			<StreamTitle>{this.getStream().name}</StreamTitle>
			<Spacer/>
			<StreamAmountTerminal>{this.getStreamNode().getStreamAmountString()}</StreamAmountTerminal>
			{this.isToolsVisible()?(<EditButton onClick={(e)=>this.onEnterEditMode(e)}>???</EditButton>):""}
		</StreamInfoContainerTerminal>

		return (this.isInEditMode()?editMode:normalMode)
	}

}


/**helper functions*****/
function findStreamDom(dom){return (dom.draggable)?dom:findStreamDom(dom.parentElement)}
function getNodeById(id){return streamNodeMap[id]}
function endDragNDropInteraction(ctx){
	Core.getUserData().getAllStreams().forEach(s => {
		var node = getNodeById(s.id) 
		if(node)node.updateState({moveOutOfTheWay:false,dropZoneActive:false})
	})
	ctx.dragHoveredStream = {...ctx,dragHoveredStream:{},dropTarget:{}};
	ctx.draggingDOM.style.opacity = 1;
	ctx.clone.remove();
}


/********Styled Components********/

const StyledMasterStreamView = styled.div`
	max-width: 600px;
    margin: auto;
    margin-top: 6vh;
`

const StreamInfoContainerTerminal = styled.div`
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    background: ${props => props.isSavings?"#63d9e8":(props.isIncome?"#98edc2":"#f6c1a8")};
    padding: 0 3vw;
    height:2.3rem;
    border-radius: 100vw;
    transition: margin 0.15s;
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

const NameInput = styled.input`
	height: 	1rem;
	width: 		6rem;
`

const AmountInput = styled.input`
	height: 	1rem;
	width: 		3rem;
	text-align: right;
`
const Spacer = styled.div`
flex-grow:1
`

const StreamChildrenContainer = styled.div`
    margin-left: 5vw;
    margin-bottom: 1rem;
    padding-top: 0.0rem;
    transition: padding 0.15s
`

const PlusButton = styled.div`
	margin-left:1vw;
	border:1px solid grey;
	border-radius: 50%;
	height: 0.9rem;
	width: 1rem;
	text-align: center;
	padding-bottom: 0.1rem;
	color:grey;
	display: flex;
    justify-content: center;
    align-items: center;
`
const EditButton = styled.div`
	display: flex;
    justify-content: center;
    align-items: center;
	width: fit-content;
    padding: 0.2rem;
    font-size: 1rem;
    margin-right: -1.8rem;
    margin-left: 0.4rem;
    color: #565656
`

const StreamContainer = styled.div`
    padding-top:0.2rem;
    cursor: pointer !important;
`

const NewStreamContainer = styled.div`
    padding-top:0.2rem;
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    padding: 1vw 3vw;
    border-radius: 100vw;
    background: beige;
    border: 1px solid lightgray;
`

const StreamInfoContainer = styled.div`
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    align-items: center;
    padding: 0 3vw;
    height:2.3rem;
    border-radius: 100vw;
    border-top: 1px solid lightgray;
`



const StreamTitle = styled.div`
    flex-grow: 0;
`

const StreamPeriod = styled.select`
    margin-right: 3vw;
    border: none;
    height: 1rem;
    cursor: pointer;
    background: none;
    border-radius: 2px;
    appearance: none;
`
const StreamPeriodInput = styled.select`
    margin-right: 3vw;
    border: none;
    height: 1rem;
    cursor: pointer;
    appearance: 	none;
	width: 			4.2rem;
	margin-right: 	1rem;
	background: 	white;
`



const StreamAmountTerminal = styled.div`
`
const StreamAmount = styled.div`
font-style:italic;
color:gray

`
const StreamAmountInput = styled.input`
	width: 5vw;
    height: 1.5rem;
    border: none;
    margin-left: 0.5vw;
    border-radius: 2px;
`