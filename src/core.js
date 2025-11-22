import utils from './utils'
import Cookies from 'js-cookie'
import ApiCaller, {API} from './ApiCaller'
import UserData, {GenericTransaction,CompoundStream,TerminalStream,invalidateStreamMap} from './model'
import ModalManager, {ModalController, ModalTemplates, ModalWorkflowController} from './ModalManager.js'
import Navigation, {NavRoutes} from './components/Navigation'
import AppConfig from './AppConfig'
import HistoryManager, {ActionTypes} from './HistoryManager.js'
import DesignSystem from './DesignSystem.js'
import {Period,timeIntervals,relativeDates} from './Time.js'
import dateformat from 'dateformat'
const amazonRegex = new RegExp(/amz|amazon/,"i")
const amazonExcludeRegex = new RegExp(/amazon web services|amazon\.fr|amazon\.co\.uk|foreign|amazon prime/,"i")
export const amazonConfig = {include:amazonRegex,exclude:amazonExcludeRegex}


class Core{
	constructor(){
		this.globalState = {
			userData:undefined,
			queriedTransactions:{
				transactions:[],
				mustRefresh:false,
				minDate: undefined,
				maxDate: undefined
			},
			periods: Period,
			amzHistorySaving: false,
			transactionUpdateListeners: [],
			erroredBankConnections: [],
			history: HistoryManager
		}
		//this.queryParamsReceivedListeners = []
		// expose search helpers attached to this Core instance (bound methods)
		this.search = {
			searchTransactions: this.searchTransactions ? this.searchTransactions.bind(this) : null,
			searchStream: this.searchStream ? this.searchStream.bind(this) : null
		}
	}

	init(){
		window.appGlobals = {
			globalState: this.globalState,
			// delegate search operations to Core instance methods (keeps single source of truth)
			searchTransactions: (...args) => this.search.searchTransactions(...args),
			findTransaction: (opts) => this.search.searchTransactions(...[opts])[0],
			searchStream: (...args) => this.search.searchStream(...args)
		};
		this.globalState.Period = Period;
		
		//register amazon history handler
		var amazonHistoryHandler = function(e) {
			if(!!this.getUserData() && e && e.data && e.data.substring && e.data.substring(0,17)== "kawaAmazonOrders-" && this.globalState.amzHistorySaving == false){
			  	var data = JSON.parse(decodeURI(e.data.slice(17)));
				this.globalState.amzHistorySaving = true
			  	ApiCaller.saveAmazonOrderHistory(data).then((r) => {
		  			this.getUserData().amazonOrderHistory = r.newHistory
		  			this.refreshAmazonTransactions()
		  			this.globalState.amzHistorySaving = false
			  	})
			}
			return true
		}
		window.addEventListener('message', amazonHistoryHandler.bind(this),false);
		window.matchMedia('(prefers-color-scheme: dark)').addListener((e) => {
			instance.app.updateState({refresh:new Date()})
		});
		
		//query parameters handling
		this.globalState.queryParamPromise = new Promise((res,rej) => {
	 		let qp = Navigation.getCurrentQueryParameters()
	 		window.history.pushState({},'',Navigation.getCurrentRoute())
			res(qp)
		})

		//check auth and redirects if needed		
		return this.checkAuthentication()
			.then(() => console.log("User is authenticated"))
			.then(() => this.setLoggedIn(true))
			.catch((e) => this.setLoggedIn(false)
				.then(() => console.log("User is not authenticated"))
				.then(() => Navigation.navigateToRoute(NavRoutes.login))
			)
	}

	/*Query parameters handling*/
	/*To use: 
		1- call getQueryParamsPrimise().then(p => **p is a URLSearchParams object)
		2- call consumeQueryParams(['field1', ...]) with the fields that should no longer be used by the rest of the application after handling
	*/
	getQueryParamsPromise(){return this.globalState.queryParamPromise}
	consumeQueryParams(array){this.globalState.queryParamPromise.then(p => array.forEach(s => p.delete(s)))}
	/*------------------------*/

	refreshTheme(){
		document.getElementById('root').style.color = DesignSystem.getStyle().bodyTextSecondary;
		document.getElementsByTagName('html')[0].className = '';
		document.getElementsByTagName('html')[0].classList.add(DesignSystem.isDarkMode()?"backgroundPatternDark":"backgroundPatternLight");
	}
	loadData(forceReload = false){
		if(forceReload || !this.globalState.userData){	
			this.fetchingUserDataPromise = ApiCaller.getUserData().then(ud => {this.globalState.userData = new UserData(ud)})
			return this.fetchingUserDataPromise
		}
		else return Promise.resolve()
	}
	getPreferredCurrency(){return this.getUserData().preferredCurrency}
	checkBankConnectionsStatus(){
		return ApiCaller.bankGetItemStatuses().then(rs => {
      		this.globalState.erroredBankConnections = rs.filter(r => r.status != 'ok')
      		return this.globalState.erroredBankConnections
    	})
	}
	reloadUserData(){return this.loadData()} 
	registerApp(app){this.app = app}

	//getters
	getMasterStream(){return (this.getUserData()||{}).masterStream}
	getCategorizationRules(){return this.getUserData()?.getCategorizationRules() ||{}}
	getTimezoneOffsetInterval(){return timeIntervals.oneHour*this.getUserData().timeZoneOffset}
	getStreamById(id){
		if(!this.getUserData())return console.log("user data weren't ready")
		return this.getUserData().getAllStreams().filter(s => s.id == id)[0]
	}
	getStreamByName(name){
		if(!this.getUserData())return console.log("user data weren't ready")
		return this.getUserData().getAllStreams().filter(s => s.name == name)[0]
	}
	getUserData(){return this.globalState.userData}
	saveBankAccountSettings(){return this.getUserData().savingAccounts?ApiCaller.saveBankAccountSettings(this.getUserData().savingAccounts):Promise.resolve()}
	saveUserPreferences(){return this.getUserData().userPreferences?ApiCaller.saveUserPreferences(this.getUserData().userPreferences):Promise.resolve()}

	getErroredBankConnections(){return this.globalState.erroredBankConnections}
	isSavingAccount(accountId){return this.getUserData().savingAccounts?.indexOf(accountId)>-1}
	getTransactionsBetweenDates(start,end,forceFromCache){

		//TODO
		//when are the right times to set must refresh to true? (categorization update, new transactions available etc)
		return new Promise((res,rej) => {
			var prevState = this.globalState.queriedTransactions;
			if(alreadyHave(start,end,prevState)||forceFromCache){
				res(prevState.transactions.filter(t => t.date >= start && t.date <= end))
			}else{
				//this ensures we don't create "wholes" in our known timeline
				//at this point, new min and max represent the largest boundary
				var oldMin = prevState.minDate || new Date();
				var oldMax = prevState.maxDate || new Date(0);
				var newMin = new Date(Math.min(start,oldMin));
				var newMax = new Date(Math.max(end,oldMax));

				//if we didn't invalidate the existing data, we can refine the needed query interval
				if(!prevState.mustRefresh){
					//ABAB overlap where new is more ancient
					if(oldMax >= newMax && oldMin >= newMin){newMax = oldMin}
					//ABAB overlap where new is more recent
					else if(oldMax <= newMax && oldMin <= newMin){newMin = oldMax}
				}
				ApiCaller.getTransactionsBetweenDates(newMin,newMax).then(r => (this.fetchingUserDataPromise||this.loadData()).then(() => r)).then(r => {//needs to wait for any userData fetch to be resolved as it contains critical information to evaluate transactions
					var result = r.categorizedTransactions.map(GenericTransaction.MakeGTFromCategorizedTransaction)
					.concat(r.uncategorizedTransactions.map(GenericTransaction.MakeGTFromUncategorizedTransaction))
					.sort(utils.sorters.asc(t => t.date))
					
					this.globalState.queriedTransactions = {
						mustRefresh: false,	
						//we don't use the queried Dates due to the merge
						minDate: new Date(Math.min(start,this.globalState.queriedTransactions.minDate || new Date())), //important: re-evaluate mins/max as there might have been concurrent calls 
						maxDate: new Date(Math.max(end,this.globalState.queriedTransactions.maxDate || new Date())),
						transactions: mergeTxns(this.globalState.queriedTransactions.transactions, result) //result will always overrides existing transactions if they exist - not perfect but likely will handle most cases
					}
					this.refreshAmazonTransactions()
					res(this.globalState.queriedTransactions.transactions.filter(t => t.date >= start && t.date <= end))
				})
			}
		})


		function mergeTxns(arr,brr){//there could be an overlap between the two array, brr will override transactions in arr
			var hashes = brr.map(t => t.getTransactionHash());
			var res = [...brr];
			arr.forEach(t => {
				if(hashes.indexOf(t.getTransactionHash())==-1){//only if the txn from arr isn't already in brr, add it
					res.push(t)
					hashes.push(t.getTransactionHash())
				}
			})
			return res.sort(utils.sorters.asc(t => t.date));
		}

		function alreadyHave(start,end,prevState){
			return !prevState.mustRefresh 
				&& !!prevState.minDate && prevState.minDate <= start 
				&& !!prevState.maxDate && prevState.maxDate >= end 
		}
	}
	getParentOfStream(stream){
		return this.getUserData().masterStream.getAllStreams().filter(s => {
			if(!s.children)return false //terminal stream
			var cid = s.children.map(o => o.id);
			return cid.indexOf(stream.id)>-1
		})[0]
	}

	//operations
	refreshCategorizationBetweenDates(start,end){return ApiCaller.refreshCategorizationBetweenDates(start,end)}
	checkAuthentication(successCallback,failureCallback){
	  var authToken = Cookies.get('token');
	  this.routeOrder = Navigation.getCurrentRoute();
	  if(!authToken || authToken===""){return Promise.reject(new Error("no token passed"))}
	  else{return ApiCaller.validateToken(authToken)}
	}
	setLoggedIn(b){
		this.globalState.loggedIn = b;
		//transitioning to logged in state
		if(b){
			return Promise.resolve().then(() => {//load or reload the data
				if(!!this.routeOrder && this.routeOrder != NavRoutes.login){//if there was a remnant route order (pre-login) navigate back
					Navigation.navigateToRoute(this.routeOrder);
					this.routeOrder = undefined;
				}else { Navigation.navigateToRoute(NavRoutes.home) }

				return this.app?.updateState({loggedIn:true,refresh:new Date()}) || Promise.resolve()
			})
		}else{//logging out
			this.globalState = {...this.globalState, userData:undefined,
				queriedTransactions:{ transactions:[],mustRefresh:false,minDate: undefined,maxDate: undefined},
				transactionUpdateListeners: [],erroredBankConnections: [],history: HistoryManager
			}
			Navigation.navigateToRoute(NavRoutes.login);
			return this.app?.updateState({loggedIn:false,refresh:new Date()}) || Promise.resolve()
		}
	}
	isUserLoggedIn(){return this.globalState.loggedIn}
	saveCategorizationRules(updatedList){
		return ApiCaller.updateCategorizationRules(updatedList).then(()=> {
			this.getUserData().categorizationRules = updatedList;
			console.log("Profile Saved")
		})
	}
	addMatchingStringToCategorizationExclusionList(excludeString){
		return ApiCaller.excludeStringFromCategorizationRule(excludeString).then(updatedExclusionList => {
			this.getUserData().categorizationRulesExclusionList = updatedExclusionList
			console.log("String added to categorization rule exclusion list: "+excludeString)
		})
	}
	categorizeTransactionsAllocationsTupples(tupples){//tupples = [{transaction:..., streamAllocations: [...] }]
		if(tupples.length==0)return Promise.resolve();
		return ApiCaller.categorizeTransactionsAllocationsTupples(tupples).then(result => {
			var newCats = result.map(jsonCat => GenericTransaction.MakeGTFromCategorizedTransaction(jsonCat));
			this.getModelTransactions(tupples.map(t => t.transaction)).forEach(txn => {
				var c = newCats.filter(c => c.transactionId == (txn.categorized?txn.transactionId:txn.id))[0]; //get corresponding new categorization for original model transaction
				if(!c){console.log(newCats)}
				c.streamAllocation.forEach(a => a.type="value");//every transaction coming from the server uses a "value" type of allocation and don't return the type.
				utils.morphObjectAIntoB(txn,c)
				c.evaluator.invalidate()
			})
			return newCats
		})
	}
	searchCategorizedTransactionLastThreeMonths(searchStringArray){
		return this.getTransactionsBetweenDates(relativeDates.threeMonthsAgo(),new Date())
		.then(txns => txns.filter(a => a.categorized).filter(a => matchesSearchTerms(searchStringArray,a.description)))
		function matchesSearchTerms(arr,s){return utils.or(arr, a => s.indexOf(a)>-1)}
	}

		// Search helpers moved to Core methods so they can be reused programmatically
	searchTransactions({ amount, description, tolerance = 0.001, fromDate, toDate, limit = 50 } = {}){
		const txns = (this.globalState.queriedTransactions && this.globalState.queriedTransactions.transactions) || [];
		const descLower = description ? String(description).toLowerCase() : null;
		const matches = txns.filter(t => {
			if (amount != null) {
				const txnAmount = Number(t.amount);
				if (Number.isNaN(txnAmount) || Math.abs(txnAmount - Number(amount)) > tolerance) return false;
			}
			if (descLower) {
				const txnDesc = (t.description || '').toString().toLowerCase();
				if (!txnDesc.includes(descLower)) return false;
			}
			if (fromDate) {
				const fd = (fromDate instanceof Date) ? fromDate : new Date(fromDate);
				const txnDate = t.date instanceof Date ? t.date : new Date(t.date);
				if (txnDate < fd) return false;
			}
			if (toDate) {
				const td = (toDate instanceof Date) ? toDate : new Date(toDate);
				const txnDate = t.date instanceof Date ? t.date : new Date(t.date);
				if (txnDate > td) return false;
			}
			return true;
		}).slice(0, limit);

		// enrich results with a user-friendly payload attached to each transaction
		matches.forEach(t => {
			try{
				const txnDate = t.date instanceof Date ? t.date : new Date(t.date);
				const formattedDate = dateformat(txnDate, 'mmm dS, yyyy');
				const rawAlloc = t.streamAllocation || t.allocations || t.allocation || [];
				const streamAllocations = (Array.isArray(rawAlloc) ? rawAlloc : []).map(a => {
					const streamId = a.streamId || (a.stream && a.stream.id) || a.stream_id || null;
					const amountAllocated = Number(a.amount ?? a.value ?? a.allocated ?? 0);
					const streamName = a.streamName || (a.stream && a.stream.name) || (streamId ? (this.getStreamById(streamId)?.name || '') : '');
					return {streamId, amountAllocated, streamName};
				});
				const allocationSentence = streamAllocations.length>0 ? streamAllocations.map(sa => `${utils.formatCurrencyAmount(sa.amountAllocated,0,false,undefined,this.getPreferredCurrency())} allocated to ${sa.streamName}`).join(', ') : 'no allocations';
				const friendlyDescription = `${formattedDate} - ${t.description || ''} - ${allocationSentence}`;
				// attach userFriendlyResult as an array with a single enriched object (keeps extensibility)
				t.userFriendlyResult = [{
					transaction: t,
					transactionDescription: t.description || '',
					totalAmount: Number(t.amount),
					formattedDate,
					streamAllocations,
					friendlyDescription
				}];
			}catch(e){console.warn('Failed to build userFriendlyResult for transaction', e)}
		});

		return {userFriendlyResults: matches.map(t => t.userFriendlyResult[0].friendlyDescription),matches:matches};
	}


	undoCategorizationBySearchTermLastThreeMonths(searchString){return this.searchCategorizedTransactionLastThreeMonths(searchString).then(cats => instance.undoCategorizations(cats))}
	undoCategorizations(cats){
		if(!cats || cats.length==0)return Promise.resolve();
		
		var txns = instance.getModelTransactions(cats)
		return ApiCaller.undoCategorizations(txns.map(a => a.id), txns.map(a => a.date)).then(() => {
			txns.forEach(cat => {//update the local model
				cat.categorized = false;
				cat.id = cat.transactionId;
				cat.streamAllocation = undefined;
				cat.evaluator.unEnroll(cat);
			})
			return txns;
		})
	}
	getModelTransactions(txns){
		var ids = txns.map(t => t.categorized?t.transactionId:t.id);
		return this.globalState.queriedTransactions.transactions.filter(t => ids.indexOf(t.categorized?t.transactionId:t.id)>-1)
	}
	
	createCategorizationRule(rule){
		console.log("creating rule:", rule)
		var existingRules = this.getUserData().categorizationRules;
		var insertIndex = 0;
		//search existing rules that would be included in the new rule matching string (first catch)
		for(var i = 0; i<existingRules.length; i++){
			if(rule.matchingString.indexOf(existingRules[i].matchingString)>-1){
				insertIndex = i;
				break;
			}
		}
		var newRules = JSON.parse(JSON.stringify(this.getUserData().categorizationRules));
		newRules.splice(insertIndex,0,rule);//place this rule right above the other one.
		newRules.forEach((a,i) => a.priority=i)
		return this.saveCategorizationRules(newRules)
	}
	deleteCategorizationRule(rule){
		var rules = this.getUserData().categorizationRules;
		var i = rules.findIndex(rr => getRuleHash(rr) == getRuleHash(rule));
		rules.splice(i,1)
		rules.forEach((a,i) => a.priority=i)
		return this.saveCategorizationRules(rules)

		function getRuleHash(r){return utils.stringConcat([r.priority,"::",r.matchingString,"::",JSON.stringify(r.allocations)])}
	}

	//stream management
	groupStreams(s1,s2){//groups s1 and s2 into a new stream that replaces s2
	  	var parent = this.getParentOfStream(s2);
	  	var group = new CompoundStream({
	  		name:"New group",
	  		children:[],
	  		id: utils.getNewUuid()
	  	})
	  	let idx = this.getStreamIndexInParent(s2) //must calculate the index before moving parents
	  	parent.insertChildAt(group,idx)
	  	s2.moveFromParentToParentAtIndex(parent,group)
	  	s1.moveFromParentToParentAtIndex(this.getParentOfStream(s1),group)
	}
	pruneMasterStream(){//job: remove compound streams that have no terminal children at all. This can happen if the last terminal stream of russian dolls groups is taken out
		this.getUserData()?.masterStream?.pruneChildren()
	}
	getStreamIndexInParent(s){return this.getParentOfStream(s)?.children.map(ss => ss.id).indexOf(s.id)}
	makeNewTerminalStream(name,amount,period,parentStreamId){
		var parent = this.getStreamById(parentStreamId);
		var newStream = new TerminalStream({
			name:name,
			id:utils.getNewUuid(),
			period:period,
			expAmountHistory:[{amount:amount,startDate:new Date()}]
		})
		parent.insertChildAt(newStream,0);
		return newStream;
	}
	deleteStream(s){
		if(s.isFactory){//remove this stream from the tree if it wasn't graduated
			this.getParentOfStream(s).removeChild(s)
		}else{//else archive it
			s.endDate = new Date();
		}
	}
	saveStreams(){
		invalidateStreamMap()
		return ApiCaller.updateMasterStream(this.getUserData().masterStream).then(()=> console.log("Profile Saved")).catch(err => console.log(err))
	}

	//modal management
	//return a promise that resolves based on the user action
	presentModal(template,options){return ModalManager.presentModalIn(new ModalController(template,options),this.modalManagement)}
	presentWorkflow(workflow){return ModalManager.presentModalIn(new ModalWorkflowController(ModalTemplates.ModalWithWorkflow(workflow),{shouldAllowDismiss:workflow.shouldAllowDismiss}),this.modalManagement)}
	
	presentContextualMenu(list,displayItemAccessor,target,enableAccessor){
		if(this.isMobile()){//on mobile, contextual menus are displayed as bottom sheets 
			return this.presentModal(ModalTemplates.ModalWithListItems("Select",list,displayItemAccessor,enableAccessor))
		}else{//on desktop they are presented as floating contextual menu
			let prevOpacity = target.style["opacity"];
			let tPrime = target.cloneNode(true);
			let br = target.getBoundingClientRect()
			document.getElementById("root").appendChild(tPrime)
			target.style.opacity = 0;
			tPrime.style = {...target.style}
			tPrime.style.position = "fixed";
			tPrime.style.top = br.y+"px";
			tPrime.style.left = br.x+"px";
			tPrime.style["min-width"] = 0;
			tPrime.style["z-index"]=301//ensures the initial target is still clickable		
			let onReclick = (e => {instance.dismissModal();unPresent();e.stopPropagation()});
			tPrime.addEventListener("click",onReclick); //ensures we dismiss and remove the listener when reclicking on the same element.
			return this.presentModal(ModalTemplates.ModalContextualMenu(target,list,displayItemAccessor,enableAccessor),{
					noShade:true, noAnimation:true,
					onDismiss: () => unPresent(),
					onConfirm: () => unPresent()
				}
			)
			function unPresent(){
				tPrime.remove();
				target.style.opacity = prevOpacity;
			}
		}
	}
	registerModalManagement(present,unmount){
		this.modalManagement={presentModal:present,unmountModal:unmount}
	}
	dismissModal(){return ModalManager.dismissModal()}


	//amazon transactions matching
	getTransactionsForOrderNumber(orderNumber){
		var txns = this.globalState.queriedTransactions.transactions.filter(t => !!t.amazonOrderDetails).sort(utils.sorters.desc(t => t.date))
		return txns.filter(t => t.amazonOrderDetails.orderNumber==orderNumber)
	}
	isMobile(){return window.innerHeight > window.innerWidth}
	isAmazonTransaction(t){return amazonRegex.test(t.description.toLowerCase()) && !amazonExcludeRegex.test(t.description.toLowerCase())}
	refreshAmazonTransactions(){
		//helper functions can convenience
		var amz = this.getUserData().amazonOrderHistory.sort(utils.sorters.desc(am => new Date(am.date)))
		var getRemainingAmazonTransactions = () => this.globalState.queriedTransactions.transactions.filter(this.isAmazonTransaction).filter(t => !t.amazonOrderDetails /*&& !t.streamAllocation*/).filter(t => t.amount <0).sort(utils.sorters.desc(t => t.date));
		//quit here if no new work to be done	
		let categorizedTransactionsToUpdate = getRemainingAmazonTransactions().filter(t =>  t.categorized)
		if(!amz || getRemainingAmazonTransactions().length==0 || getRemainingAmazonTransactions().length<=this.globalState.remainingAmazonTransactionsCount)return
		var getAttributedAmazonTransactions = () => this.globalState.queriedTransactions.transactions.filter(this.isAmazonTransaction).filter(t => !!t.amazonOrderDetails).sort(utils.sorters.desc(t => t.date));
		var absAmountsMatch = (a,b) => (Math.abs(Math.abs(a) - Math.abs(b))<0.000001) //by doing so we avoid javascript rounding and precision errors
		var dateMatch = (order,transaction) => (new Date(order.date)<=new Date(transaction.date.getTime()+timeIntervals.oneDay*1) && new Date(order.date) >= new Date(transaction.date.getTime()-timeIntervals.oneDay*35))
		var getUnattributedAmzItems = () => {var orderNumberConsumed = getAttributedAmazonTransactions().map(t => t.amazonOrderDetails.orderNumber);return amz.filter(am => orderNumberConsumed.indexOf(am.orderNumber)==-1 && am.orderAmount!=null && am.orderAmount!=0)}

		//try direct match (transaction = 1 order)
		getRemainingAmazonTransactions().map(t => {
			var directItemMatch = amz.filter(am => dateMatch(am,t) && absAmountsMatch(am.orderAmount,t.amount))[0]
			if(directItemMatch){return t.amazonOrderDetails = {...directItemMatch,algo:"directMatch"}}
		})

		//match groupped by same dates (technically, this is the same as the combo technique for 1d, but allows to avoid using the combine function which is quite expensive)
		var sameDateClusters = utils.flatGroupBy(getRemainingAmazonTransactions(),t => t.date).filter(a => a.length>1).forEach(g => {
			var sum = utils.sum(g, t => t.amount),clusterMatch = amz.filter(am => dateMatch(am,g[0]) && absAmountsMatch(am.orderAmount,sum))[0]
			if(clusterMatch)return g.map((t,i) => t.amazonOrderDetails = {...clusterMatch,algo:"sameDate",part: i})
		})

		//try grouping by combinations for dates that are 1+ days appart and for which there is a amz order that match the sum
		if(getRemainingAmazonTransactions().length < 20)// becomes too complex after 20
		for(var d = 1;d<15;d++){
			//generate possible combinations of remaining transactions and keep the ones that are potential matches
			var looseCombos = utils.combine(getRemainingAmazonTransactions(),2)
				.filter(g => utils.max(g,t => t.date) - utils.min(g,t => t.date)<=timeIntervals.oneDay*d)//keep the ones whose date span isn't more than 1d
				.filter(g => getUnattributedAmzItems().filter(am => dateMatch(am,{date:new Date(utils.min(g,t => t.date))}) && absAmountsMatch(am.orderAmount,utils.sum(g, t => t.amount)))[0])//keep the ones who's sum matches an amz order
			//now we need to make sure there are no potential collision (one transaction that could belong to multiple different orders)
			var touchedTransactions = [], trash = []
			looseCombos.forEach(g => {g.forEach(t => {if(touchedTransactions.indexOf(t.getTransactionHash())==-1){touchedTransactions.push(t.getTransactionHash())}else{trash.push(t.getTransactionHash())}})})
			//keep only those who don't have ambiguous transactions, and assign them
			looseCombos.filter(g => g.map(t => t.getTransactionHash()).filter(h => trash.indexOf(h)>-1).length==0).forEach(g => {
				var comboMatch = getUnattributedAmzItems().filter(am => dateMatch(am,{date:new Date(utils.min(g,t => t.date))}) && absAmountsMatch(am.orderAmount,utils.sum(g, t => t.amount)))[0]
				if(comboMatch)g.forEach((t,i) => t.amazonOrderDetails = {...comboMatch,algo:"multipleDaysAppart", part: i})
			})
		}
		//keep track of last job state to avoid re-processing
		this.globalState.remainingAmazonTransactionsCount = getRemainingAmazonTransactions().length
		//brag about how great this algorithm is
		var total = this.globalState.queriedTransactions.transactions.filter(this.isAmazonTransaction).filter(t => !t.streamAllocation).filter(t => t.amount <0),totalMatched = total.filter(t => !!t.amazonOrderDetails).filter(t => !t.streamAllocation).filter(t => t.amount <0)
		console.log("Uncategorized Amazon transactions matched: "+(100*(totalMatched.length/total.length).toFixed(4))+"% ("+totalMatched.length+"/"+total.length+")")
		//if some of the mathched transaction are already categorized, we should save them with the amazon details
		console.log("Unmatched Categorized Amazon transactions remaining: "+categorizedTransactionsToUpdate.length)
		categorizedTransactionsToUpdate = categorizedTransactionsToUpdate.filter(t => !!t.amazonOrderDetails)
		if(categorizedTransactionsToUpdate.length > 0){
			console.log("updating "+categorizedTransactionsToUpdate.length+" categorized transactions with amazon details")
			this.categorizeTransactionsAllocationsTupples(categorizedTransactionsToUpdate
				.map(t => ({transaction:t,streamAllocation:t.streamAllocation})))
				.then(()=> console.log("update complete"))
		}
	}
}
 
const instance = new Core();

export default instance 


 