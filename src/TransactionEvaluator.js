import Core from './core.js';
import TransactionTypes from './TransactionTypes'
import utils from './utils'


class TransactionEvaluator {
	constructor(txn){
		updateTxnMap(txn)	
		this.transactionIds = [txn.transactionId];
		this.invalidate()
	}

	//operations
	addTransaction(txn){
		updateTxnMap(txn)
		if(this.getTransactions.length>=2 || txn.amount+this.getTransactions()[0].amount!=0){throw new Error("TransactionEvaluator integrity error: trying to add a transaction to a TransactionEvaluator object where the amount doesn't match")}
		if(this.transactionIds.filter(t => t==txn.transactionId).length==0){this.transactionIds.push(txn.transactionId)}
		this.invalidate()
	}
	unEnroll(txn){//when txn just got uncategorized
		console.log("unenrolling",txn)
		this.transactionIds = this.transactionIds.filter(id => id!=txn.transactionId)
		delete transactionMap[txn.transactionId]
		delete evaluatorMap[txn.transactionId]
		if(this.transactionIds.length>0){
			this.invalidate()
			evaluatorMap[this.transactionIds[0]]=this
		}
		delete txn.evaluator;
	}
	refreshTransactionType(){
		this.getTransactions()[0].streamAllocation.map(al => {
			al.transactionType = getTransactionTypeForAllocationToStream(this.getTransactions(),Core.getStreamById(al.streamId))
		})
	}
	invalidate(){//reset the memory if this evaluator
		this.refreshTransactionType()
		this.amountForStreamMap = {}
	}

	//getters and convenience
	getTransactionTypeForStream(s){return this.getAllocationForStream(s)?.transactionType}
	getAllocationForStream(s){return getTransactionAllocationForStream(this.getTransactions()[0],s)}
	getTransactions(){return this.transactionIds.map(id => transactionMap[id]).filter(t => t.categorized)}
	isPair(){return this.getTransactions().length==2}
	doesNeedClarificationForAllocation(allocation){return this.getTransactionTypeForStream(Core.getStreamById(allocation.streamId))==TransactionTypes.ambiguous}

	//evaluation functions
	moneyInForStreamAndTransactionId(s,txnId){				return this.getAmountForStream(s,txnId)[0]}//passing the transaction Id lets us make sure we're only counting values once when transactions are paired.
	savedForStreamAndTransactionId(s,txnId){				return this.getAmountForStream(s,txnId)[1]}
	transferedNeutrallyForStreamAndTransactionId(s,txnId){	return this.getAmountForStream(s,txnId)[2]}
	getAmountForStream(s,txnId){
		if(this.transactionIds.indexOf(txnId)>0){return [0,0,0]}//this avoids that paired transactions get counted twice
		if(this.amountForStreamMap[s.id]!=undefined){return this.amountForStreamMap[s.id]}
		if(s.children){//compound stream
			let res = s.getAllTerminalStreams().reduce((acc,ss) => {
				let amss = this.getAmountForStream(ss,txnId);
				return [0,0,0].map((o,i) => acc[i]+amss[i]);
			},[0,0,0])
			this.amountForStreamMap[s.id] = res;
			return res
	    }else{//terminal stream
	    	if(!this.getTransactionTypeForStream(s)){return [0,0,0]}
	    	let res = [0,0,0].map((a,i) => Math.abs((this.getAllocationForStream(s)||{}).amount || 0)*this.getTransactionTypeForStream(s).mask[i])
	    	this.amountForStreamMap[s.id] = res;
		    return res
	    }
	}
}

var evaluatorMap = {}
var transactionMap = {}

//manages the complexity of paired transactions and reuses an existing evaluator in that case
const getEvaluator = (txn) => {
	if(!!evaluatorMap[txn.transactionId]){//trying to reinstanciate on transaction that has already been instantiated in the past
		return evaluatorMap[txn.transactionId]
	}else if(!!evaluatorMap[txn.pairedTransferTransactionId]){//paired transaction: reuse the same descriptor
		evaluatorMap[txn.pairedTransferTransactionId].addTransaction(txn)
		return evaluatorMap[txn.pairedTransferTransactionId]
	}else{
		evaluatorMap[txn.transactionId] = new TransactionEvaluator(txn);
		return evaluatorMap[txn.transactionId];	
	}
}

export default getEvaluator

//helpers
function updateTxnMap(txn){if(!transactionMap[txn.transactionId] && txn.categorized){transactionMap[txn.transactionId] = txn}}
function allocationForStream(txn,s){return txn.streamAllocation.filter(al => al.streamId==s.id)[0]}
function isTransactionFromSavingAccount(txn){return Core.isSavingAccount(txn.userInstitutionAccountId)}
function isAllocationASavingStream(txn,s){return Core.getStreamById(allocationForStream(txn,s).streamId).isSavings}
function isAllocationAnInterestIncomeStream(txn,s){return Core.getStreamById(allocationForStream(txn,s).streamId).isInterestIncome} 
function getTransactionAllocationForStream(txn,s){return txn.streamAllocation.filter(al => al.streamId==s.id)[0]}
function getTransactionTypeForAllocationToStream(txns,s){ //defines transaction type allocation logic
	/*if(txns[0].transactionId=="xzoROMDJNdsj6J9xpxoBCpZPdNvAMvFKkJer0"){
		console.log("lolo")
	}*/
	let t1 = txns[0], sa1 = isTransactionFromSavingAccount(t1), ss1 = isAllocationASavingStream(t1,s), p = getTransactionAllocationForStream(t1,s).amount>0, ii = isAllocationAnInterestIncomeStream(t1,s), udtt = allocationForStream(t1,s).userDefinedTransactionType;
	if(udtt){return TransactionTypes[udtt]}									//Was ambiguous but got informed by user (Types 10, 12, 16)
	else if(txns.length==2){//both sides of the transaction are available 
		let t2=txns[1], sa2 = isTransactionFromSavingAccount(t2);
		if 		(!sa1 && !sa2)				{return TransactionTypes.internalTransferChecking} 				//Type 3
		else if (sa1  && sa2)				{return TransactionTypes.internalTransferSavings}				//Type 8 
		else if (sa1  && p || sa2 && !p)	{return TransactionTypes.movedToSavings}						//Type 6 x
		else 								{return TransactionTypes.movedFromSavings}						//Type 7 x
	}else{					//when only one side of the transaction is available
		if  	(!sa1 && !ss1 && p)			{return TransactionTypes.income}								//Type 1  x
		else if (sa1  && p && ii)				{return TransactionTypes.incomeToSavings}						//Type 16 x
		else if (!sa1 && !ss1 && !p)		{return TransactionTypes.expense}								//Type 2  x
		else if (sa1  && !ss1 && !p)		{return TransactionTypes.movedFromSavingsToDisconnectedChecking}//Type 11 x
		else if (!sa1 && ss1  && p)			{return TransactionTypes.movedFromDisconnectedSavingAccount}	//Type 14 x
		else if (!sa1 && ss1  && !p)		{return TransactionTypes.movedToDisconnectedSavingAccount}		//Type 13 x
		else if (sa1  && ss1  && !p)		{return TransactionTypes.transferToDisconnectedSavings}			//Type 9  x
		else if (sa1  && ss1  && p)			{return TransactionTypes.ambiguous}								//Type 0  x(can be 10,12 or 16)
	}
}