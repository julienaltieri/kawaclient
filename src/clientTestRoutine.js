import ApiCaller from './ApiCaller'
import Core from './core'
import {ModalTemplates} from './ModalManager.js'


const utils = require('./utils.js')
const reporter = require('./processors/ReportingCore')

class TestRoutine{

	static start(){
		var globals = window.appGlobals;
		var sd = new Date("Wed Jun 19 2022 00:00:00 GMT-0800 (Pacific Standard Time)");
		var ed = new Date("Tue Jun 20 2022 01:00:00 GMT-0800 (Pacific Standard Time)");
		//console.log(Core.getStreamById("374c30a1-3ff3-49b3-8145-d969db005e53"))
	/*	Core.getTransactionsBetweenDates(sd,ed).then(data => {
			console.log(data)
			var txn = data[0]
			txn.userDefinedTransactionType = "totoro"
			
		})*/

		//var s = Core.getUserData().masterStream.children[4].children[1];
/*		ApiCaller.forceRefreshItemTransactions("P4713prkyMF0jYE4Be7DCZXpzYvxmkCmJk1ky").then(r => {
			console.log(r)
		}).catch(err => console.log(err))*/
		
/*

			var config = PlaidLinkOptions = {
			  onSuccess: (public_token, metadata) => {},
			  onExit: (err, metadata) => {},
			  onEvent: (eventName, metadata) => {},
			  token: tok,
			  // required for OAuth:
			  receivedRedirectUri: window.location.href,
			  // if not OAuth, set to null or do not include:
			  receivedRedirectUri: null,
			};
			const { open, exit, ready } = usePlaidLink(config);
		})*/
/*
		Core.getTransactionsBetweenDates(sd,ed)
		.then(d => d.filter(t => t.categorized && t.isAllocatedToStream(s)))
		.then(txns => {
			console.log(txns)
			var report = reporter.getReportFromDateForTerminalStream(sd,s,txns)

			

			console.log(report)
		})*/
	}
}

//needs more testing, especially for wages
//doesn't work for compound stream


export default TestRoutine



/* Roadmap

- categorization rule view
- custom categorization UX
- create new rule UX




*/