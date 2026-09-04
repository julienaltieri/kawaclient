import Cookies from 'js-cookie'
import AppConfig from './AppConfig'
import TransactionTypes from './TransactionTypes'

const API = {
	login: 										AppConfig.serverURL + "/login",
	validateToken: 								AppConfig.serverURL + "/validateToken",
	refreshSession: 							AppConfig.serverURL + "/refreshSession",
	getUserData: 								AppConfig.serverURL + "/api" + "/getUserData",
	saveAmazonOrderHistory: 					AppConfig.serverURL + "/api" + "/saveAmazonOrderHistory",
	getAmazonOrderHistory: 						AppConfig.serverURL + "/api" + "/getAmazonOrderHistory",
	updateMasterStream: 						AppConfig.serverURL + "/api" + "/updateMasterStream",
	getTransactionsBetweenDates: 				AppConfig.serverURL + "/api" + "/getTransactionsBetweenDates",
	refreshCategorizationBetweenDates: 			AppConfig.serverURL + "/api" + "/refreshCategorizationBetweenDates",
	updateCategorizationRules: 					AppConfig.serverURL + "/api" + "/updateCategorizationRules",
	excludeStringFromCategorizationRules: 		AppConfig.serverURL + "/api" + "/excludeStringFromCategorizationRules",
	categorizeTransactionsAllocationsTupples: 	AppConfig.serverURL + "/api" + "/categorizeTransactionsAllocationsTupples",

	bankInitiateConnection: 					AppConfig.serverURL + "/api" + "/bankInitiateConnection",
	bankExchangeTokenAndSaveConnection: 		AppConfig.serverURL + "/api" + "/bankExchangeTokenAndSaveConnection",
	bankInitiateUpdate: 						AppConfig.serverURL + "/api" + "/bankInitiateUpdate",
	bankGetItemStatuses: 						AppConfig.serverURL + "/api" + "/bankGetItemStatuses",
	bankGetAccountsForUser: 					AppConfig.serverURL + "/api" + "/bankGetAccountsForUser",
	getBalanceHistory: 							AppConfig.serverURL + "/api" + "/getBalanceHistory",
	bankRemoveItem: 							AppConfig.serverURL + "/api" + "/bankRemoveItem",
	forceRefreshItemTransactions: 				AppConfig.serverURL + "/api" + "/forceRefreshItemTransactions",
	getSupportedInstitutions:  					AppConfig.serverURL + "/api" + "/getSupportedInstitutions",
	
	undoCategorizations: 						AppConfig.serverURL + "/api" + "/undoCategorizations",
	saveBankAccountSettings: 					AppConfig.serverURL + "/api" + "/saveBankAccountSettings",
	saveUserPreferences: 						AppConfig.serverURL + "/api" + "/saveUserPreferences",
}

const SESSION_KEY = "kawa.session"

class ApiCaller{
	constructor(){
		this.session = this.readSession()
		this.token = this.session.accessToken || Cookies.get('token') //cookie fallback migrates a session that predates the store below
		this.refreshPromise = undefined
		this.onSessionExpired = undefined //set by Core, which cannot be imported here without a cycle
	}
	setToken(token){this.token = token}

	/*Session store.
	  The refresh token is a long-lived bearer credential and lives in localStorage rather than an
	  httpOnly cookie. That is weaker by default and it is deliberate: the biometric unlock has to be
	  able to WITHHOLD the token until the device reports a successful user verification, and a cookie
	  the browser attaches automatically cannot be withheld. localStorage also survives the PWA being
	  evicted from memory, which the old session cookie did not — that eviction is half of why the
	  password used to be needed several times a day. See client/documentation/authentication.md.*/
	readSession(){
		try{return JSON.parse(window.localStorage.getItem(SESSION_KEY)) || {}}
		catch(e){return {}}
	}
	setSession(s){
		this.session = {...this.session, ...s}
		if(this.session.accessToken){this.token = this.session.accessToken}
		try{window.localStorage.setItem(SESSION_KEY,JSON.stringify(this.session))}catch(e){console.log(e)}
	}
	clearSession(){
		this.session = {}
		this.token = undefined
		this.refreshPromise = undefined
		try{window.localStorage.removeItem(SESSION_KEY)}catch(e){console.log(e)}
		Cookies.remove("token") //clears the pre-localStorage cookie the constructor still falls back to
	}

	/*Startup gate. Prefers the refresh token when there is one, because that always yields a fresh
	  access token in a single round trip — validating the stored one first would cost a second call in
	  the common case, since an access token older than an hour is dead anyway. Falls back to validating
	  a bare access token for a session created before this store existed.*/
	/*Whether there is something a biometric unlock could actually release. Both halves are needed:
	  Cognito requires the username to rebuild the user when spending the refresh token.*/
	hasStoredSession(){return !!(this.session.username && this.session.refreshToken)}

	ensureValidSession(){
		if(this.session.refreshToken){return this.refreshSession()}
		if(this.token){return this.validateToken(this.token)}
		return Promise.reject(new Error("no token passed"))
	}

	/*Spends the refresh token for a new access token. Uses fetch directly rather than sendRequest, so a
	  failure here cannot re-enter the 401 handling below and recurse.*/
	refreshSession(){
		if(this.refreshPromise){return this.refreshPromise} //concurrent 401s share one refresh
		const username = this.session.username, refreshToken = this.session.refreshToken
		if(!username || !refreshToken){return Promise.reject(new Error("no refresh token"))}
		this.refreshPromise = fetch(new Request(API.refreshSession,{
				method:"post",headers:{"Content-Type":"application/json"},
				body:JSON.stringify({username:username,refreshToken:refreshToken})
			}))
			.then(res => {if(!res.ok){throw new Error("Refresh rejected")};return res.json()})
			.then(r => {this.setSession({accessToken:r.accessToken,refreshToken:r.refreshToken});return r})
			.finally(() => {this.refreshPromise = undefined})
		return this.refreshPromise
	}

	sendRequest(request){
		const replayable = request.clone() //clone before fetch consumes the body, so the call can be replayed
		return fetch(request)
			.then(res => (res.status==401)?this.retryAfterRefresh(replayable):res)
			.then(res => {
				if(res.status==401){throw new Error("Login required")}
				else if(!res.ok){console.log(res);throw new Error(res.statusText)}
				else return res.json()
			})
	}

	/*A 401 usually means the access token expired, not that the session is over. Every API method
	  funnels through sendRequest, so this is the only place that has to know how to recover.*/
	retryAfterRefresh(request){
		return this.refreshSession()
			.catch(() => {
				this.clearSession()
				if(this.onSessionExpired){this.onSessionExpired()}
				throw new Error("Login required")
			})
			.then(() => {
				const headers = new Headers(request.headers)
				headers.set("accesstoken",this.token)
				return fetch(new Request(request,{headers:headers}))
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
		console.log("checking authentication")
		return this.sendRequest(request)
	}

	getUserData(){
		const request = new Request(API.getUserData,{
			method:"post",headers:{"Content-Type":"application/json",accesstoken:this.token},
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

	//Retrieve Amazon order history for a specified date range
	getAmazonOrderHistory(startDate, endDate){
		const request = new Request(API.getAmazonOrderHistory,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({
				startDate: startDate,
				endDate: endDate
			})
		})
		return this.sendRequest(request)
	}

	//Saves new master stream to this user data
	updateMasterStream(jsonMasterStream){
		if(!AppConfig.featureFlags.apiDisableMasterStreamUpdates){
			const request = new Request(API.updateMasterStream,{
				method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
				body:JSON.stringify({
					jsonMasterStream: jsonMasterStream //valid json representation of all stream (will be saved in userData)
				})
			})
			return this.sendRequest(request)
		}else{
			//console.log("Simulated request to "+API.updateMasterStream+" with parameters:",jsonMasterStream)
			return Promise.resolve()
		}
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
				t.transaction.frontendDate = t.transaction.frontendDate
				t.transaction.transactionId = t.transaction.id
				return t.transaction
			}))

		}
		function transform(alloc,amount){
			return alloc.map(a => a.type=="value"?a:{amount: amount,streamId: a.streamId})
		}
	}

	//get an initial token to initiate the connector experience
	bankInitiateConnection(connectorName,options = {}){
		const request = new Request(API.bankInitiateConnection,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({connectorName:connectorName,options:{...options}})
		})
		return this.sendRequest(request)
	}

	//exchange a public token returned from a successful link against a long-term access token
	bankExchangeTokenAndSaveConnection(connectorName,publicToken,friendlyName,institutionId,connectionMetadata={}){
		const request = new Request(API.bankExchangeTokenAndSaveConnection,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({connectorName: connectorName,publicToken: publicToken,friendlyName: friendlyName,institutionId:institutionId,connectionMetadata:connectionMetadata})
		})
		return this.sendRequest(request)
	}

	bankInitiateUpdate(itemId, options = {}){
		const request = new Request(API.bankInitiateUpdate,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({itemId: itemId,options:{...options}})
		})
		return this.sendRequest(request)
	}

	bankGetItemStatuses(){
		const request = new Request(API.bankGetItemStatuses,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({})
		})
		return this.sendRequest(request)
	}

	getSupportedInstitutions(query){
		const request = new Request(API.getSupportedInstitutions,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({searchQuery:query})
		})
		return this.sendRequest(request)
	}


	//The REMEMBERED balance series. Today's live figure arrives with the accounts instead - this only
	//has whatever has accumulated since balance capture went in, so a caller must treat an empty
	//answer as "no history yet" rather than as "no money".
	getBalanceHistory(startDate, endDate){
		const request = new Request(API.getBalanceHistory,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({startDate: startDate, endDate: endDate})
		})
		return this.sendRequest(request)
	}

	bankGetAccountsForUser(){
		const request = new Request(API.bankGetAccountsForUser,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({})
		})
		return this.sendRequest(request)
	}

	bankForceRefreshItemTransactions(itemId){
		const request = new Request(API.forceRefreshItemTransactions,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify({itemId: itemId})
		})
		return this.sendRequest(request)
	}
	
	bankRemoveItem(itemId){
		const request = new Request(API.bankRemoveItem,{
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


	saveBankAccountSettings(savingAccounts){
		const request = new Request(API.saveBankAccountSettings,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify(savingAccounts)
		})
		return this.sendRequest(request)
	}

	saveUserPreferences(userPreferences){
		const request = new Request(API.saveUserPreferences,{
			method:"post",headers: {"Content-Type":"application/json",accesstoken:this.token},
			body:JSON.stringify(userPreferences)
		})
		return this.sendRequest(request)
	}
}


const instance = new ApiCaller();

export default instance 