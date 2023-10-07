import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import AppConfig from '../AppConfig'
import Core from '../core.js'
import { DragDropContext,Droppable,Draggable } from 'react-beautiful-dnd';
import {ModalTemplates} from '../ModalManager.js'
import DS from '../DesignSystem'
import utils from '../utils'
import {relativeDates} from '../Time'
import transactionGrouper from '../processors/TransactionGrouper.js'


/*TODO
- add stream allocations on rule view
- decide what's editable on edit view (perhaps not the name, but just the allocation), or just delete the rule
- create new rule view
- ask to update categorization to older transactions ? update stream dates if necessary - what happens if the amount changes?



*/


export default class CategorizationRulesView extends BaseComponent{
	constructor(props){
		super(props);
		this.state={
			ruleList:Core.getCategorizationRules(),
			ddContext:{
				draggingStreamNode:undefined,
				dragHoveredStream:{},
				dropTarget:{}
			},
			loading:false,
			dragging:false
		}
		this.onDragEnd = this.onDragEnd.bind(this)
		this.onDragStart = this.onDragStart.bind(this)
	}

	onDragEnd(result){
		var destination = result.destination
		var source = result.source
		if(!destination || destination.index == source.index)return this.updateState({dragging:false});
		var dragStartRule = this.state.ruleList[source.index];
		if(destination.droppableId = "trash"){
			Core.deleteCategorizationRule(dragStartRule).then(() => this.reload())
		}else{
			const newList = Array.from(this.state.ruleList)
			newList.splice(source.index,1);
			newList.splice(destination.index,0,dragStartRule);
			newList.forEach((a,i) => a.priority=i)

			this.updateState({ruleList:newList.sort(utils.sorters.asc(a => a.priority)),dragging:false})
			Core.saveCategorizationRules(newList)
		}
	}

	onDragStart(e){
		this.updateState({dragging:true})
	}

	reload(){
		this.updateState({ruleList:Core.getCategorizationRules(),loading:false,dragging:false})
	}

	render(){
		if(!this.state.ruleList)return(<div/>)
		else if(this.state.loading) return (<div style={{'textAlign':'center','marginTop':'3rem'}}>loading...</div>)
		var count=0;
		return(
		<DragDropContext onDragEnd={this.onDragEnd} onDragStart={this.onDragStart}>
			<Droppable droppableId="trash" key={0}>
			{(provided,snapshot) => (
				<StyledTopArea  >
					<StyledDeleteZone ref={provided.innerRef} style={getTrashDropStyle(snapshot.isDraggingOver)}  {...provided.droppableProps} visible={this.state.dragging}><DS.component.Label highlight>Drag here to remove</DS.component.Label></StyledDeleteZone>
					<div style={{display:"none"}}>{provided.placeholder}</div>
				</StyledTopArea>
			)}</Droppable>

			<Droppable droppableId="categorizationViewDroppable" key={1}>
			{(provided,snapshot) => (
			<div>
				<DS.component.PageHeader>Categorization rules</DS.component.PageHeader>
				<StyledCategorizationRulesView  ref={provided.innerRef} {...provided.doppableProps}>
					<DS.component.ScrollableList>
						{this.state.ruleList.map((r,index) => <RuleView rule={r} key={index} id={index} masterView={this}/>)}
						{provided.placeholder}
					</DS.component.ScrollableList>
				</StyledCategorizationRulesView>
			</div>
			)}</Droppable>
		</DragDropContext>
	)}
}

const getTrashDropStyle = isDraggingOver => ({
  	border: isDraggingOver ? DS.borderThickness + "rem solid "+ DS.getStyle().borderColorHighlight : "none",
});

const getTrashingDropStyle = isDraggingOver => ({
  	width: isDraggingOver ? "3rem" : "auto",
});

const StyledTopArea = styled.div`
	height: 5rem;
    position: fixed;
    width: 100%;
    display: flex;
    flex-direction: row;
    align-content: center;
    justify-content: center;
    align-items: center;
    z-index:99;
`

const StyledDeleteZone = styled.div`
	padding: 1rem 2rem;
	border-radius: ${DS.borderRadius};
	opacity: ${(props) => props.visible?1:0};
    background: ${DS.getStyle().alert};
    transition: opacity 0.3s ease-in-out;
    &:hover{
    	border: ;
    }
`

const StyledCategorizationRulesView = styled.ul`
	max-width: ${DS.applicationMaxWidth}rem;
	margin: auto;
`


class RuleView extends BaseComponent{
	constructor(props){
		super(props)
		this.state={toolVisible:false}
	}

	onEnterEditMode(e){
		Core.presentModal(ModalTemplates.ModalWithCategorizationRule("Edit rule","",this.props.rule)).then(({state,buttonIndex}) => {
			if(buttonIndex == 1){//user asked to save changes
				var updatedList = JSON.parse(JSON.stringify(Core.getUserData().categorizationRules))//snapshot
				updatedList.filter(r => r.matchingString == this.props.rule.matchingString)[0].allocations = [{streamId: state.allocatedStream.id, type: 'percent', amount: 1}];
				updatedList.filter(r => r.matchingString == this.props.rule.matchingString)[0].matchingString = state.matchingString//update this rule in the snapshot
				this.props.masterView.updateState({loading:true})
				Promise.all([
					Core.saveCategorizationRules(updatedList),
					Core.categorizeTransactionsAllocationsTupples(state.uncategorizedMatchList.map(t => {
						return {transaction: t, streamAllocation: this.props.rule.allocations}
					}))
				]).then(() => this.props.masterView.reload())
			}
		}).catch(e => console.log(e));
	}
	//onClickDelete(e,props){Core.deleteCategorizationRule(props.rule).then(() => this.props.masterView.reload())}
	render(){
		return(
		<Draggable draggableId={"dr-"+this.props.id} index={this.props.id}>
		{(provided) => (
			<StyledRuleView {...provided.draggableProps} {...provided.dragHandleProps} ref={provided.innerRef}>
				<DS.component.ListItem onClick={(e)=>this.onEnterEditMode(e)} fullBleed>
					<div style={{margin:"0 1rem"}}>{this.props.rule.priority}</div>
					<div style={{textOverflow: "ellipsis",textWrap: "nowrap",overflowX: "clip",paddingRight:"0.5rem"}} >{this.props.rule.matchingString}</div>
					<Spacer/>
					<StreamTagContainer style={{textAlign:"right",margin:"0 1rem"}}>{this.props.rule.allocations
						.sort((a,b) => (!!a.amount)?-1:1)
						.map(a => <DS.component.StreamTag noHover highlight={true} key={a.streamId}>
							{Core.getStreamById(a.streamId).name}
						</DS.component.StreamTag>)}</StreamTagContainer>
				</DS.component.ListItem>
			</StyledRuleView>
		)}
		</Draggable>
	)}

}


export class CategorizationModalView extends BaseComponent{
	constructor(props){
		super(props)
		let d = new Date();
		d.setHours(0, 0, 0, 0);
		this.state = {
			fetching: true,
			uncategorizedMatchList: [],
			categorizedMatchList: [],
			summonDate: d,
			matchingString: props.rule.matchingString,
			allocatedStream: Core.getStreamById(props.rule.allocations[0].streamId)
		}
		props.controller.state.modalContentState = {...props.controller.state.modalContentState,...{
			matchingString: props.rule.matchingString,
			allocatedStream: this.state.allocatedStream
		}}
		this.queryMatchesForString(this.props.rule.matchingString)
		this.handleStreamSelected = this.handleStreamSelected.bind(this)
	}

	onChangedText(e){
		var s = e.target.value
		this.updateState({fetching:true,matchingString:s})		
		this.queryMatchesForString(s)
		this.props.controller.state.modalContentState = {...this.props.controller.state.modalContentState,...{matchingString:e.target.value}}
	
	}
	queryMatchesForString(s){
		var ruleStreams = this.props.rule.allocations.map(al => Core.getStreamById(al.streamId))
		Core.getTransactionsBetweenDates(AppConfig.transactionFetchMinDate, this.state.summonDate).then(data => {
			var ruleMatchedAlready = data.filter(t => t.categorized)
					.filter(t => utils.or(ruleStreams.map(st => t.isAllocatedToStream(st))))
					.filter(t => doesStringMatchTransaction(s,t))
			var matches = data.filter(t => doesStringMatchTransaction(s,t))
			this.updateState({
				uncategorizedMatchList: matches.filter(t => !t.categorized),
				categorizedMatchList: matches.filter(t => t.categorized).filter(t => utils.or(ruleStreams.map(st => t.isAllocatedToStream(st)))),	
				fetching:false
			})
			this.props.controller.state.modalContentState = {...this.props.controller.state.modalContentState,...{uncategorizedMatchList:matches.filter(t => !t.categorized)}}
		})
	}
	handleStreamSelected(e){
		var s = Core.getStreamById(e.target.selectedOptions[0].getAttribute("sid"))
		this.props.controller.state.modalContentState = {...this.props.controller.state.modalContentState,...{allocatedStream:s}};
		this.updateState({allocatedStream:s});	
	}

	render(){
		return(
			<div>
				<DS.component.Row>
					<StyledWord>Transactions like</StyledWord>
					<DS.component.Input type="text" 
						textAlign="left" defaultValue={this.props.rule.matchingString} onChange={this.onChangedText.bind(this)}/>
				</DS.component.Row>
				<DS.component.Row>
					<StyledWord>will be categorized as</StyledWord>
					<DS.component.DropDown
							value={this.state.allocatedStream.name?this.state.allocatedStream.name:'DEFAULT'} 
							onChange={this.handleStreamSelected}>
							<option value='DEFAULT' disabled hidden> </option>
							{Core.getMasterStream().getAllTerminalStreams().filter(s => s.isActiveAtDate(new Date()))
							.sort(utils.sorters.asc(s => s.name.charCodeAt()))
							.map((a,j) => <option key={j} sid={a.id}>{Core.getStreamById(a.id).name}</option>)}

					></DS.component.DropDown>
				</DS.component.Row>
				<div style={{margin:"auto", minHeight:"5rem", 
				marginTop:"3rem",fontSize:"0.8rem","textAlign":"left"}}>
					{this.state.fetching?(<div>loading....</div>):<div>
						<ul><div style={{fontWeight:"bold",marginBottom:"1rem"}}></div>
						{[...this.state.uncategorizedMatchList,...this.state.categorizedMatchList].slice(0,4).map((t,i) => 
							<DS.component.ListItem noHover fullBleed size="xs" key={i}>
									<DS.component.Label style={{minWidth:"3rem"}}>{t.date.toLocaleDateString("default",{month: "2-digit", day: "2-digit"})}</DS.component.Label>
									<DS.component.Label style={{marginRight:"0.5rem"}}>{t.description}</DS.component.Label><Spacer/>
									<DS.component.StreamTag style={{maxWidth:"30vw"}} noHover highlight={t.categorized}>{t.categorized?Core.getStreamById(t.streamAllocation[0].streamId).name:"new"}</DS.component.StreamTag>
									<div style={{maxWidth:"3rem",textAlign:"right",marginLeft:"0.5rem",flexShrink:0}}>{utils.formatCurrencyAmount(t.amount,0,null,null,Core.getPreferredCurrency())}</div>
							</DS.component.ListItem>)}
						{(this.state.categorizedMatchList.length>4)?<DS.component.ListItem noHover fullBleed size="xs" style={{justifyContent:"flex-end",border:"none"}}>and {this.state.categorizedMatchList.length-2} other(s)</DS.component.ListItem>:""}
						 
						</ul>
					</div>
				}
				</div>
			</div>
		)
	}
}


const StyledWord = styled.div`
	margin-right: 1rem;
	text-align: left;
	flex-shrink: 0;
	flex-grow: 0;
`


function doesStringMatchTransaction(matchingString, transaction){
	return transactionGrouper.doesTransactionContainStringByWords(transaction,matchingString)
}

const StyledButton = styled.div`
	display: flex;
    justify-content: center;
    align-items: center;
	width: fit-content;
    padding: 0.2rem;
    font-size: 1rem;
    margin-left: 0.4rem;
    color: #565656
`

const ToolBox = styled.div`
	display: flex;
    margin-right: -4rem;
    width:4rem;
    cursor:pointer;
    opacity: ${(props) => props.visible?1:0}
`


const StreamTagContainer = styled.div`
	display: flex;
    text-align: right;
    flex-direction: column;
    align-items: flex-end;
`

const StyledRuleView = styled.div`
	display:flex;
	align-items: center;
`

const Spacer = styled.div`
	flex-grow:1;
`


