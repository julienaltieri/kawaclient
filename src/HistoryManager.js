import utils from './utils'

export const ActionTypes = {
	TransactionUpdate: "TransactionUpdate",
	ActionSkip: "ActionSkip"
}

class HistoryManager{
	constructor(){
		this.queue = [];
	}
	pushState = (state) => this.queue.push(state);
	popState = () => this.queue.pop();
	getLastState = () => this.queue[this.queue.length-1];
	recordTransactionUpdate(transactionsInPreviousState){
		this.pushState({
			action: ActionTypes.TransactionUpdate,
			transactions: transactionsInPreviousState
		})
	}
	recordActionSkip(){
		this.pushState({
			action: ActionTypes.ActionSkip,
		})
	}
	snapshot = (object) => utils.getObjectClone(object)
}

const instance = new HistoryManager();
export default instance