import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import AppConfig from '../AppConfig'
import Core from '../core.js'
import { DragDropContext,Droppable,Draggable } from 'react-beautiful-dnd';
import {ModalTemplates} from '../ModalManager.js'
import DesignSystem from '../DesignSystem'
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
				dragHoveredStream:{},//stream being overed right now and need to make space
				dropTarget:{}//stream it will be dropped into
			},
			loading:false
		}
		this.onDragEnd = this.onDragEnd.bind(this)
	}

	onDragEnd(result){
		var destination = result.destination
		var source = result.source
		if(!destination || destination.index == source.index)return;
		var dragStartRule = this.state.ruleList[source.index];
		const newList = Array.from(this.state.ruleList)
		newList.splice(source.index,1);
		newList.splice(destination.index,0,dragStartRule);
		newList.forEach((a,i) => a.priority=i)

		this.updateState({ruleList:newList.sort(utils.sorters.asc(a => a.priority))})
		Core.saveCategorizationRules(newList)
	}

	reload(){
		this.updateState({ruleList:Core.getCategorizationRules(),loading:false})
	}

	render(){
		if(!this.state.ruleList)return(<div/>)
		else if(this.state.loading) return (<div style={{'textAlign':'center','marginTop':'3rem'}}>loading...</div>)
		var count=0;
		return(
		<DragDropContext onDragEnd={this.onDragEnd}>
			<Droppable droppableId="categorizationViewDroppable">
			{(provided) => (
				<StyledCategorizationRulesView ref={provided.innerRef} {...provided.doppableProps}>
					<DesignSystem.component.ScrollableList>
						{this.state.ruleList.map((r,index) => <RuleView rule={r} key={index} id={index} masterView={this}/>)}
						{provided.placeholder}
					</DesignSystem.component.ScrollableList>
				</StyledCategorizationRulesView>

			)}</Droppable>
		</DragDropContext>
	)}
}


const StyledCategorizationRulesView = styled.ul`
	max-width: ${DesignSystem.applicationMaxWidth}rem;
	margin: auto;
	margin-top:3rem;
`


class RuleView extends BaseComponent{
	constructor(props){
		super(props)
		this.state={toolVisible:false}
	}

	onClickedStreamTag(id,streamId){
		var s = Core.getStreamById(streamId)
		var a = relativeDates.fourWeeksAgo()
		Core.getTransactionsBetweenDates(a,new Date())
		.then(txns => txns.filter(t => t.categorized && t.isAllocatedToStream(s)))
		.then(txns => txns.filter(t => doesRuleMatchTransaction(this.props.rule.matchingString,t)))
		.then(txns => console.log(txns))

	}

	onEnterEditMode(e){
		Core.presentModal(ModalTemplates.ModalWithCategorizationRule("Edit rule","",this.props.rule)).then(({state,buttonIndex}) => {
			console.log(buttonIndex,state)
			if(buttonIndex == 1){//user asked to save changes
				/*var updatedList = JSON.parse(JSON.stringify(Core.getUserData().categorizationRules))//snapshot
				updatedList.filter(r => r.matchingString == this.props.rule.matchingString)[0].matchingString = state.matchingString//update this rule in the snapshot
				this.props.masterView.updateState({loading:true})
				var stream = Core.getStreamById(this.props.rule.allocations[0].streamId);
				console.log(state.uncategorizedMatchList)
				Promise.all([
					Core.saveCategorizationRules(updatedList),
					Core.categorizeTransactionsAllocationsTupples(state.uncategorizedMatchList.map(t => {
						return {transaction: t, streamAllocation: this.props.rule.allocations}
					}))
				]).then(() => this.props.masterView.reload())*/
			}
		}).catch(e => console.log(e));
	}
	onClickDelete(e,props){Core.deleteCategorizationRule(props.rule).then(() => this.props.masterView.reload())}
	render(){
		return(
		<Draggable draggableId={"dr-"+this.props.id} index={this.props.id}>
		{(provided) => (
			<StyledRuleView {...provided.draggableProps} {...provided.dragHandleProps} ref={provided.innerRef}
					onMouseEnter={(e)=> this.updateState({toolVisible:true})}
					onMouseLeave={(e)=> this.updateState({toolVisible:false})}>
				<DesignSystem.component.ListItem>
					<div style={{marginRight:"1rem"}}>{this.props.rule.priority}</div>
					<div style={{textOverflow: "ellipsis",textWrap: "nowrap",overflowX: "clip",paddingRight:"0.5rem"}} >{this.props.rule.matchingString}</div>
					<Spacer/>
					<StreamTagContainer style={{textAlign:"right"}}>{this.props.rule.allocations
						.sort((a,b) => (!!a.amount)?-1:1)
						.map(a => <DesignSystem.component.StreamTag highlight={true} onClick={()=> this.onClickedStreamTag(this.props.id,a.streamId)} key={a.streamId}>
							{Core.getStreamById(a.streamId).name}
						</DesignSystem.component.StreamTag>)}</StreamTagContainer>
					<ToolBox visible={this.state.toolVisible}>
						<StyledButton onClick={(e)=>this.onEnterEditMode(e)}>✎</StyledButton>
						<StyledButton onClick={(e)=>this.onClickDelete(e,this.props)}>✕</StyledButton>
					</ToolBox>
				</DesignSystem.component.ListItem>
			</StyledRuleView>
		)}
		</Draggable>
	)}

}


export class CategorizationModalView extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {
			fetching: true,
			uncategorizedMatchList: [],
			categorizedMatchList: [],
			summonDate: new Date(),
			matchingString: props.rule.matchingString,
		}
		props.controller.state.modalContentState = {...props.controller.state.modalContentState,...{matchingString:props.rule.matchingString}}
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
					.filter(t => doesRuleMatchTransaction(s,t))
			var matches = data.filter(t => doesRuleMatchTransaction(s,t))
			this.updateState({
				uncategorizedMatchList: matches.filter(t => !t.categorized),
				categorizedMatchList: matches.filter(t => t.categorized).filter(t => utils.or(ruleStreams.map(st => t.isAllocatedToStream(st)))),	
				fetching:false
			})
			this.props.controller.state.modalContentState = {...this.props.controller.state.modalContentState,...{uncategorizedMatchList:matches.filter(t => !t.categorized)}}
		})
	}
	handleStreamSelected(e,i){console.log(i)}

	render(){
			

		return(
			<div>
				<DesignSystem.component.Row>
					<StyledWord>Transactions like</StyledWord>
					<DesignSystem.component.Input type="text" 
						textAlign="left" defaultValue={this.props.rule.matchingString} onChange={this.onChangedText.bind(this)}/>
				</DesignSystem.component.Row>
				<DesignSystem.component.Row>
					<StyledWord>will be categorized as</StyledWord>
					<DesignSystem.component.DropDown
							value={(this.props.rule.allocations[0]?.streamId)?Core.getStreamById(this.props.rule.allocations[0].streamId).name:'DEFAULT'} 
							onChange={(e,i) => this.handleStreamSelected(e,i)}>
							<option value='DEFAULT' disabled hidden> </option>
							{Core.getMasterStream().getAllTerminalStreams().filter(s => s.isActiveAtDate(new Date()))
							.sort(utils.sorters.asc(s => s.name.charCodeAt()))
							.map((a,j) => <option key={j} sid={a.id}>{Core.getStreamById(a.id).name}</option>)}

					></DesignSystem.component.DropDown>
				</DesignSystem.component.Row>
				<div style={{width:"20rem", margin:"auto", minHeight:"5rem", 
				marginTop:"2rem",fontSize:"0.8rem","textAlign":"left", backgroundColor:"white"}}>
					{this.state.fetching?(<div>loading....</div>):<div>
						<ul><div style={{fontWeight:"bold",marginBottom:"0.3rem"}}>Categorized already: {this.state.categorizedMatchList.length} transaction(s)</div>
						{this.state.categorizedMatchList.slice(0,2).map((t,i) => <div key={i} style={{fontWeight:"normal",display:"flex",borderBottom:"1px solid #eeeeee"}}>
									<div>{t.description.substring(0,20)}...</div>
									<Spacer/>
									<div>{utils.formatCurrencyAmount(t.amount,null,null,null,Core.getPreferredCurrency())}</div>
							</div>)}
						{(this.state.categorizedMatchList.length>2)?<div style={{textAlign: "right"}}>...and {this.state.categorizedMatchList.length-2} other(s)</div>:""}
						 
						</ul>
						<ul style={{marginTop:"1rem",fontWeight:"bold"}}>Uncategorized matched: {this.state.uncategorizedMatchList.length} transaction(s)
							{this.state.uncategorizedMatchList.slice(0,5).map((t,i) => <div key={i} style={{fontWeight:"normal",display:"flex",borderBottom:"1px solid #eeeeee"}}>
									<div>{t.description.substring(0,20)}...</div>
									<Spacer/>
									<div>{utils.formatCurrencyAmount(t.amount,null,null,null,Core.getPreferredCurrency())}</div>
								</div>)}
							{(this.state.uncategorizedMatchList.length>5)?<div style={{textAlign: "right",fontWeith:"100"}}>...and {this.state.uncategorizedMatchList.length-5} other(s)</div>:""}
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


function doesRuleMatchTransaction(matchingString, transaction){
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


