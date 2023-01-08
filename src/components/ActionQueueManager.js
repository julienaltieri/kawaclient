import {EmptyStateAction,ActionStyles,BankReconnectAction} from './Action'
import styled from 'styled-components';
const utils = require('../utils.js')

const outOfFocusOpacity = 0.5;
const disappearAnimationTime = 300;

/* ActionQueueManager
.renderComponent() to get the html component
.insertActions(actions) to add actions. Actions must implement the .getSortValue() method
.consumeActions(actions) will play the exit animation of the passed actions and remove them from the queue afterwards
.getQueue() to read the queue  
*/
export default class ActionQueueManager{
	constructor(){
		this.queue = [new EmptyStateAction(0,this)]
	}
	getQueue(){return this.queue}
	getNextAvailableId(){return this.queue.map(a => a.id).sort(utils.sorters.desc())[0]+1}
	insertActions(actions){
		var sortedActionSortingValues = this.queue.map(a => a.getSortValue()).sort(utils.sorters.asc());
		var inserts = actions.map((a,i) => {
			return {action:a,index:utils.searchInsertAsc(sortedActionSortingValues,a.getSortValue())}
		}).sort(utils.sorters.desc(insert => insert.index))
		inserts.forEach(insert => this.queue.splice(insert.index,0,insert.action))
	}
	consumeActions(actions){
		const finalize = (a) => {
			if(!a.reactComponent){return Promise.resolve()} //if component isn't mounted, we'll skip this part
			return a.reactComponent.preExitAnimation().then(() => new Promise((res,rej) => a.reactComponent.updateState({moveOutOfTheWay:true})
				.then(()=> setTimeout(() => {a.isVisible = false;res()}, ActionStyles.moveOutOfTheWayAnimationTime)))) //leaves enough time to play the exit animation
		}
		//defines the animation promises to play
		var promises = actions.map(finalize), newIndex = 0;
		var consumingActionIndexes = actions.map(a => this.queue.findIndex(o => o.id == a.id));
		while(consumingActionIndexes.indexOf(newIndex)>-1 && newIndex<this.queue.length){newIndex++}	//deternime index of next card to enter 
		if(this.queue[newIndex]){promises.push(this.queue[newIndex].willEnterInFocus())}		//trigger entrance animation

		//run the promises
		return Promise.all(promises).then(() => this.queue = this.queue.filter(a => actions.indexOf(a)==-1))
	}
	isInFocus(action){return this.queue.filter(a => a.isVisible)[0]?.id == action.id} //focus logic

	renderComponent(){
		var title = " ";
		if(this.queue.length>1){title = "To review ("+(this.queue.length-1)+" more)"}
		else if(this.queue.length == 1){title = " "}  

		return (<div style={{width:"100%"}}>
			<TitleBox><Title >{title}</Title></TitleBox>
			<div>
				<ActionQueueViewContainer>{this.queue.slice(0,5).map((a,i) => <ActionCardContainer key={a.id} dimmed={!this.isInFocus(a)}>{a.renderComponent(this.isInFocus(a))}</ActionCardContainer>)}</ActionQueueViewContainer>			
			</div>
		</div>)
	}

}

const ActionCardContainer = styled.div`
	opacity: ${props => props.dimmed?outOfFocusOpacity:1};
	width:100%;
	transition: opacity ${disappearAnimationTime/1000}s ease;
`

const Title = styled.div`
	font-size: 1.5rem;
	text-align: left;
	padding: 1rem 0;
    height: 1.5rem;
`
const TitleBox = styled.div`
	display:flex;
	margin: auto;
	margin-top: -3rem;
	max-width: 26rem;
    justify-content: space-between;
`


const ActionQueueViewContainer = styled.div `
	text-align: center;
    display: flex;
    width:100%;
    flex-direction: row-reverse;
    justify-items: center;
    align-items: center;
	max-width: ${props => ActionStyles.cardRemPadding*2+ActionStyles.cardContentWidth}rem;
    align-items: center;
    margin: auto;
    position: relative;
    align-items: stretch;

` 