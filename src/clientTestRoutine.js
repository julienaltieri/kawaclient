import ApiCaller from './ApiCaller'
import Core from './core'
import {ModalTemplates} from './ModalManager.js'
import BaseComponent from './components/BaseComponent';
import DS from './DesignSystem'
import styled from 'styled-components'

import utils from './utils'
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


class TestRoutineView extends BaseComponent{

	render(){return (
		<div>
		<DS.component.SentenceWrapper>
			I want all my 
			<DS.component.StreamTag>Groceries and hygiene</DS.component.StreamTag>
			transactions to be labeled as
			<DS.component.Input style={{maxWidth:"8rem"}}></DS.component.Input>
		</DS.component.SentenceWrapper>
		</div>
	)}
}


export default TestRoutine



/* Roadmap

- categorization rule view
- custom categorization UX
- create new rule UX




*/