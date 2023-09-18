import Cookies from 'js-cookie'
import AppConfig from './AppConfig'
import TransactionTypes from './TransactionTypes'

const APISpec = {
	login: 										AppConfig.serverURL + "/login",
	validateToken: 								AppConfig.serverURL + "/validateToken",
	getUserData: 								AppConfig.serverURL + "/api" + "/getUserData",
	saveAmazonOrderHistory: 					AppConfig.serverURL + "/api" + "/saveAmazonOrderHistory",
	updateMasterStream: 						AppConfig.serverURL + "/api" + "/updateMasterStream",
	getTransactionsBetweenDates: 				AppConfig.serverURL + "/api" + "/getTransactionsBetweenDates",
	refreshCategorizationBetweenDates: 			AppConfig.serverURL + "/api" + "/refreshCategorizationBetweenDates",
	updateCategorizationRules: 					AppConfig.serverURL + "/api" + "/updateCategorizationRules",
	excludeStringFromCategorizationRules: 		AppConfig.serverURL + "/api" + "/excludeStringFromCategorizationRules",
	categorizeTransactionsAllocationsTupples: 	AppConfig.serverURL + "/api" + "/categorizeTransactionsAllocationsTupples",
	plaidCreateLinkToken: 						AppConfig.serverURL + "/api" + "/plaidCreateLinkToken",
	plaidExchangeLinkTokenAndSaveConnection: 	AppConfig.serverURL + "/api" + "/plaidExchangeLinkTokenAndSaveConnection",
	plaidUpdateLinkToken: 						AppConfig.serverURL + "/api" + "/plaidUpdateLinkToken",
	plaidGetItemStatus: 						AppConfig.serverURL + "/api" + "/plaidGetItemStatus",
	forceRefreshItemTransactions: 				AppConfig.serverURL + "/api" + "/forceRefreshItemTransactions",
	undoCategorizations: 						AppConfig.serverURL + "/api" + "/undoCategorizations",
}


class ApiCaller{

	constructor(){
		this.token = Cookies.get('token')
	}

	setToken(token){this.token = token}

	authenticate(username,password){
		const request = new Request(APISpec.login,{
			method:"post",headers:{"Content-Type":"application/json"},
			body:JSON.stringify({username:username,password:password})
		})
		return fetch(request).then(res => {
			if(!res.ok)throw new Error(res.statusText)
			else return res.json()
		})
	}


	getUserData(){
		const request = new Request(APISpec.getUserData,{
			method:"post",headers:{"Content-Type":"application/json",accesstoken:Cookies.get('token')},
		})
		return fetch(request).then(res => {
			if(!res.ok)throw new Error(res.statusText)
			else return res.json()
		})
	}

	saveAmazonOrderHistory(history){
		const request = new Request(APISpec.saveAmazonOrderHistory,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({
				history: history //valid json representation of all stream (will be saved in userData)
			})
		})
		return fetch(request).then(res => {
			if(!res.ok)throw new Error(res.statusText)
			else return res.json()
		})
	}

	//Saves new master stream to this user data
	updateMasterStream(jsonMasterStream){
		const request = new Request(APISpec.updateMasterStream,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({
				jsonMasterStream: jsonMasterStream //valid json representation of all stream (will be saved in userData)
			})
		})

		return fetch(request).then(res => {
			if(!res.ok)throw new Error(res.statusText)
			else return res.json()
		})
	}

	//return both categorized and uncategorized transactions between specified dates.
	getTransactionsBetweenDates(startDate,endDate){
		const request = new Request(APISpec.getTransactionsBetweenDates,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({
				startDate: 	startDate, 		//valid json parsable date string
				endDate: 	endDate 		//valid json parsable date string
			})
		})
		return fetch(request).then(res => {
			if(!res.ok)throw new Error(res.statusText)
			else return res.json()
		})
	}

	//rerun categorizer, mostly to handle new rules
	refreshCategorizationBetweenDates(startDate,endDate){
		const request = new Request(APISpec.refreshCategorizationBetweenDates,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({
				startDate: 	startDate, 		//valid json parsable date string
				endDate: 	endDate 		//valid json parsable date string
			})
		})
		return fetch(request).then(res => {
			if(!res.ok)throw new Error(res.statusText)
			else return res.json()
		})
	}

	//Updates categorization rules
	updateCategorizationRules(ruleUpdates){
		const payload = {
			ruleUpdates: ruleUpdates			//[{"allocations":[{"streamId": "...","type": "value","amount":1.0}],"matchingString": "...", "priority": 0}]
		}
		if(!AppConfig.featureFlags.apiCategorizationOfflineMode){
			const request = new Request(APISpec.updateCategorizationRules,{
				method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
				body:JSON.stringify(payload)
			})
			return fetch(request).then(res => {
				if(!res.ok)throw new Error(res.statusText)
				else return res.json()
			})
		}else{
			console.log("Simulated request APISpec.toupdateCategorizationRules")
			console.log(payload);
			return Promise.resolve()
		}
	}

	//Add a string to categorization Exclusion list - this is done to remember not to ask the user again about categorizing a certain term
	excludeStringFromCategorizationRule(excludeString){//untested
		const payload = {
			excludeString: excludeString //must be a string			
		}

		if(!AppConfig.featureFlags.apiCategorizationOfflineMode){
			const request = new Request(APISpec.excludeStringFromCategorizationRules,{
				method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
				body:JSON.stringify(payload)
			})
			return fetch(request).then(res => {
				if(!res.ok)throw new Error(res.statusText)
				else return res.json()
			})
		}else{
			console.log("Simulated request APISpec.toexcludeStringFromCategorizationRules")
			console.log(payload);
			return Promise.resolve()
		}
	}

	categorizeTransactionsAllocationsTupples(tupples){
		const payload =  {
			tupples: 		tupples,	//tupples = [{transaction:..., streamAllocation: [...] }]
		}
		//console.log(payload)
//		payload.tupples[0].streamAllocation[0].userDefinedTransactionType = TransactionTypes.ambiguous.name

		if(!AppConfig.featureFlags.apiCategorizationOfflineMode){
			const request = new Request(APISpec.categorizeTransactionsAllocationsTupples,{
				method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
				body:JSON.stringify(payload)
			})
			return fetch(request).then(res => {
				if(!res.ok)throw new Error(res.statusText)
				else return res.json()
			})
		}else{//emulation
			console.log("Simulated request APISpec.tocategorizeTransactionsAllocationsTupples")
			console.log(payload);
			return Promise.resolve(tupples.map(t => {
				t.transaction.streamAllocation = transform(t.streamAllocation,t.transaction.amount);
				t.transaction.transactionAmount = t.transaction.amount
				t.transaction.transactionDescription = t.transaction.description
				t.transaction.transactionDate = t.transaction.date
				t.transaction.transactionId = t.transaction.id
				return t.transaction
			}))

		}
		function transform(alloc,amount){
			return alloc.map(a => a.type=="value"?a:{amount: amount,streamId: a.streamId})
		}
	}

	//get a PlaidLinkToken to initiate the Link experience
	getPlaidLinkToken(){
		const request = new Request(APISpec.plaidCreateLinkToken,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({})
		})
		return fetch(request).then(res => {
			if(!res.ok)throw new Error(res.statusText)
			else return res.json()
		})
	}

	//exchange a public token returned from a successful link against a long-term access token
	exchangePlaidLinkTokenAndSaveConnection(publicToken,friendlyName){
		console.log(friendlyName)
		const request = new Request(APISpec.plaidExchangeLinkTokenAndSaveConnection,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({publicToken: publicToken,friendlyName: friendlyName})
		})
		return fetch(request).then(res => {
			if(!res.ok)throw new Error(res.statusText)
			else return res.json()
		})
	}

	//save a new connection to userdata
	saveNewPlaidConnectionToUserData(co){
		const request = new Request(APISpec.plaidSaveNewConnectionToUserData,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify(co)
		})
		return fetch(request).then(res => {
			if(!res.ok)throw new Error(res.statusText)
			else return res.json()
		})
	}

	getPlaidLinkTokenUpdateMode(itemId){
		const request = new Request(APISpec.plaidUpdateLinkToken,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({itemId: itemId})
		})
		return fetch(request).then(res => {
			if(!res.ok)throw new Error(res.statusText)
			else return res.json()
		})
	}

	getPlaidItemStatus(itemId){
		const request = new Request(APISpec.plaidGetItemStatus,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({itemId: itemId})
		})
		return fetch(request).then(res => {
			if(!res.ok)throw new Error(res.statusText)
			else return res.json()
		})
	}

	forceRefreshItemTransactions(itemId){
		const request = new Request(APISpec.forceRefreshItemTransactions,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({itemId: itemId})
		})
		return fetch(request).then(res => {
			if(!res.ok)throw new Error(res.statusText)
			else return res.json()
		})
	}
	undoCategorizations(catIds,dates){
		const payload =  {
			catIds:catIds, // [...catIds]
			dates: dates // [...javascript dates objects]
		}
		if(!AppConfig.featureFlags.apiUncategorizationOfflineMode){
			const request = new Request(APISpec.undoCategorizations,{
				method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
				body:JSON.stringify(payload)
			})
			return fetch(request).then(res => {
				if(!res.ok)throw new Error(res.statusText)
				else return res.json()
			})
		}else{
			console.log("Simulated request APISpec.toundoCategorizations")
			console.log(payload);
			return Promise.resolve()
		}
	}
}


const instance = new ApiCaller();

export default instance 