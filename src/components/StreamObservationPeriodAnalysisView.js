import styled from 'styled-components';
import DesignSystem from '../DesignSystem.js'
import {CompactMiniGraph} from './MiniGraph'
import {GenericStreamAnalysisView, StreamAnalysisTransactionFeedView} from './AnalysisView'
import utils from '../utils'
import {timeIntervals} from '../Time'



export class StreamObservationPeriodView extends GenericStreamAnalysisView{
	constructor(props){
		super(props)
		this.state = {minigraphLastRefresh:new Date()}
		this.isZeroSumStream = this.props.analysis.stream.getCurrentExpectedAmount() === 0
	}
	findUnmatched(txnArr){//used for reconciliation 
		let debits = [], credits = [];
		let stream = this.props.analysis.stream;

		txnArr.forEach(t => {
			if(t.amount>0){credits.push(t)}
			else {debits.push(t)}
		})
		let matches = [], orphanCredits = [];

		//direct match
		credits.sort(utils.sorters.asc(ct => ct.date.getTime()))
		let debitAmounts = debits.map(t => t.moneyOutForStream(stream)) 
		credits.forEach(ct => {
			let j = debitAmounts.indexOf(ct.moneyInForStream(stream))
			let debit = debits[j]
			if(j>-1 && (debit.date.getTime() <= ct.date.getTime() + timeIntervals.oneWeek * 4 )){//match
				matches.push({credit: [ct], debit: [debit]})
				debits.splice(j,1)
				debitAmounts.splice(j,1)
			}else{orphanCredits.push(ct)}
		})
		//one debit to many refunds
		credits = orphanCredits
		orphanCredits = []
		let orphanDebits = []
		debits.forEach(dt => {
			let possibleCredits = credits.filter(ct => ct.moneyInForStream(stream)<= -dt.moneyInForStream(stream))
			possibleCredits.sort(utils.sorters.asc(ct => ct.date.getTime()))
			if(possibleCredits.length>0){
				let combinations = utils.combine(possibleCredits,2)
					.filter(combi => Math.abs(
						utils.sum([...combi.map(c => c.moneyInForStream(stream)),...[dt.moneyInForStream(stream)]]))<0.001
					)
				if(combinations.length>0){
					let bestCombination = combinations.sort(utils.sorters.asc(combi => utils.sum(combi.map(c => c.date.getTime()))))[0] //pick the one with the earliest dates
					matches.push({credit:bestCombination,debit:[dt]});	
					//remove matched credits from consideration
					bestCombination.forEach(c => {
						let j = credits.indexOf(c)
						if(j>-1){credits.splice(j,1)}
					})	
				}else{orphanDebits.push(dt)}
			}else{orphanDebits.push(dt)}
		})

		//one credit to many debits
		debits = orphanDebits;
		orphanDebits = []
		credits.sort(utils.sorters.asc(ct => ct.date.getTime())).forEach(ct => {
			let possibleDebits = debits.filter(dt => -dt.moneyOutForStream(stream)<= ct.moneyInForStream(stream) )
			possibleDebits.sort(utils.sorters.asc(dt => dt.date.getTime()))
			if(possibleDebits.length>0){
				let combinations = utils.combine(possibleDebits,2).filter(combi => Math.abs(
					utils.sum([...combi.map(c => c.moneyInForStream(stream)),...[ct.moneyInForStream(stream)]]))<0.001
				)
				if(combinations.length>0){
					let bestCombination = combinations.sort(utils.sorters.asc(combi => utils.sum(combi.map(c => c.date.getTime()))))[0] //pick the one with the earliest dates
					matches.push({credit:[ct],debit:bestCombination});
				}else{orphanCredits.push(ct)}
			}else{orphanCredits.push(ct)}
		})

		let unmatched = [...orphanDebits,...orphanCredits]
		console.log({matches: matches, unmatched: unmatched, balance: utils.sum(unmatched.map(t => t.moneyInForStream(stream)))})
		return {matches: matches, unmatched: unmatched}
	}
	render(){
		return <ObsPeriodViewContainer style={{paddingRight: '0.4rem'}}>
			<CompactMiniGraph refresh={this.state.minigraphLastRefresh} shouldOverrideOverflow={true} analysis={this.props.analysis} stream={this.props.analysis.stream}/>
			<StreamAnalysisTransactionFeedView analysis={this.props.analysis} reconciliation={this.isZeroSumStream?this.findUnmatched(this.props.analysis.transactions):undefined} onMinigraphUpdateRequested={() => this.updateState({minigraphLastRefresh:new Date()})} onCategorizationUpdate={this.props.onCategorizationUpdate}/>
		</ObsPeriodViewContainer>
	}
}


const FlexColumn = styled.div`
	position:relative;
    display: flex;
    flex-direction: column;
    align-content: stretch;
    justify-content: flex-start;
    align-items: center;
    height: 100%;
    width:100%;
`

const ObsPeriodViewContainer = styled(FlexColumn)`
	position:relative;
	overflow-x: clip;
	overflow-y: auto;

    ::-webkit-scrollbar {
    	width: ${props => (DesignSystem.barWidthRem+"rem")}
    }
	::-webkit-scrollbar-track {
		box-shadow: inset 0 0 0.5rem rgba(0, 0, 0, 0.3);
		border-radius: 1rem;
	}
	::-webkit-scrollbar-thumb {
	  	background-color: ${props => DesignSystem.getStyle().bodyTextSecondary};
	 	outline: none;
 		border-radius: 1rem;
	}
	::-webkit-scrollbar-corner {background: rgba(0,0,0,0.5)}
`
