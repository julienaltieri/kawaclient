import Cookies from 'js-cookie'
import AppConfig from './AppConfig'
import TransactionTypes from './TransactionTypes'

const API = {
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
	constructor(){this.token = Cookies.get('token')}
	setToken(token){this.token = token}
	sendRequest(request){
		return fetch(request).then(res => {
			if(res.status==401){throw new Error("Login required")}
			else if(!res.ok){console.log(res);throw new Error(res.statusText)}
			else return res.json()
		})
	}

	authenticate(username,password){
		const request = new Request(API.login,{
			method:"post",headers:{"Content-Type":"application/json"},
			body:JSON.stringify({username:username,password:password})
		})
		return this.sendRequest(request)
	}

	validateToken(authToken){
		const request = new Request(API.validateToken,{
			method:"post",headers:{"Content-Type":"application/json"},
			body:JSON.stringify({token:authToken})
		})
		return this.sendRequest(request)
	}

	getUserData(){
		const request = new Request(API.getUserData,{
			method:"post",headers:{"Content-Type":"application/json",accesstoken:Cookies.get('token')},
		})
		return this.sendRequest(request)
	}

	saveAmazonOrderHistory(history){
		const request = new Request(API.saveAmazonOrderHistory,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({
				history: history //valid json representation of all stream (will be saved in userData)
			})
		})
		return this.sendRequest(request)
	}

	//Saves new master stream to this user data
	updateMasterStream(jsonMasterStream){
		if(!AppConfig.featureFlags.apiUncategorizationOfflineMode){
			const request = new Request(API.updateMasterStream,{
				method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
				body:JSON.stringify({
					jsonMasterStream: jsonMasterStream //valid json representation of all stream (will be saved in userData)
				})
			})
			return this.sendRequest(request)
		}else{
			console.log("Simulated request to "+API.updateMasterStream+" with parameters:",jsonMasterStream)
		}
		return Promise.resolve()
	}

	//return both categorized and uncategorized transactions between specified dates.
	getTransactionsBetweenDates(startDate,endDate){
		const request = new Request(API.getTransactionsBetweenDates,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({
				startDate: 	startDate, 		//valid json parsable date string
				endDate: 	endDate 		//valid json parsable date string
			})
		})
		return this.sendRequest(request)
	}

	//rerun categorizer, mostly to handle new rules
	refreshCategorizationBetweenDates(startDate,endDate){
		const request = new Request(API.refreshCategorizationBetweenDates,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({
				startDate: 	startDate, 		//valid json parsable date string
				endDate: 	endDate 		//valid json parsable date string
			})
		})
		return this.sendRequest(request)
	}

	//Updates categorization rules
	updateCategorizationRules(ruleUpdates){
		const payload = {
			ruleUpdates: ruleUpdates			//[{"allocations":[{"streamId": "...","type": "value","amount":1.0}],"matchingString": "...", "priority": 0}]
		}
		if(!AppConfig.featureFlags.apiCategorizationOfflineMode){
			const request = new Request(API.updateCategorizationRules,{
				method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
				body:JSON.stringify(payload)
			})
			return this.sendRequest(request)
		}else{
			console.log("Simulated request API.toupdateCategorizationRules")
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
			const request = new Request(API.excludeStringFromCategorizationRules,{
				method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
				body:JSON.stringify(payload)
			})
			return this.sendRequest(request)
		}else{
			console.log("Simulated request API.toexcludeStringFromCategorizationRules")
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
			const request = new Request(API.categorizeTransactionsAllocationsTupples,{
				method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
				body:JSON.stringify(payload)
			})
			return this.sendRequest(request)
		}else{//emulation
			console.log("Simulated request API.tocategorizeTransactionsAllocationsTupples")
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
		const request = new Request(API.plaidCreateLinkToken,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({})
		})
		return this.sendRequest(request)
	}

	//exchange a public token returned from a successful link against a long-term access token
	exchangePlaidLinkTokenAndSaveConnection(publicToken,friendlyName){
		console.log(friendlyName)
		const request = new Request(API.plaidExchangeLinkTokenAndSaveConnection,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({publicToken: publicToken,friendlyName: friendlyName})
		})
		return this.sendRequest(request)
	}

	//save a new connection to userdata
	saveNewPlaidConnectionToUserData(co){
		const request = new Request(API.plaidSaveNewConnectionToUserData,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify(co)
		})
		return this.sendRequest(request)
	}

	getPlaidLinkTokenUpdateMode(itemId){
		const request = new Request(API.plaidUpdateLinkToken,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({itemId: itemId})
		})
		return this.sendRequest(request)
	}

	getPlaidItemStatus(itemId){
		const request = new Request(API.plaidGetItemStatus,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({itemId: itemId})
		})
		return this.sendRequest(request)
	}

	forceRefreshItemTransactions(itemId){
		const request = new Request(API.forceRefreshItemTransactions,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({itemId: itemId})
		})
		return this.sendRequest(request)
	}
	undoCategorizations(catIds,dates){
		const payload =  {
			catIds:catIds, // [...catIds]
			dates: dates // [...javascript dates objects]
		}
		if(!AppConfig.featureFlags.apiUncategorizationOfflineMode){
			const request = new Request(API.undoCategorizations,{
				method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
				body:JSON.stringify(payload)
			})
			return this.sendRequest(request)
		}else{
			console.log("Simulated request API.toundoCategorizations")
			console.log(payload);
			return Promise.resolve()
		}
	}
}


const instance = new ApiCaller();

export default instance 