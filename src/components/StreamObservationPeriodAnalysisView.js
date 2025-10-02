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
		this.isZeroSumStream = this.props.analysis.stream.isZeroSumStream
	}
	
	findUnmatched(txnArr){//used for reconciliation 
		let debits = [], credits = [],  matches = [], stream = this.props.analysis.stream;

		//separate credits from debits and sort them by date
		txnArr.forEach(t => {
			if(t.amount>0){credits.push(t)}
			else {debits.push(t)}
		})
		debits = debits.sort(utils.sorters.asc(bt => bt.date.getTime()))
		credits = credits.sort(utils.sorters.asc(bt => bt.date.getTime()))

		//helper matching function taking in a config object with the following options:
		// elements - list of elements to try to match against other transactions
		// matchPool - pool of candidates for elements to be matched against 
		// oneToMany - wether or not we want to try matching one to many, instead of one to one 
		// poolDateFilter - what needs to be true on dates to be consider for matching
		function computeMatches(o){
			if(stream.isSavings || stream.isInterestIncome){return}
			let toRemove = [], getKeyForTransaction = (t) => t.moneyInForStream(stream)>0?"credit":"debit"
			o.elements.forEach(at => {
				let pool = o.matchPool.filter(bt => o.poolDateFilter(at,bt))//apply date conditions
				let possibleMatches = (o.oneToMany?utils.combine(pool,2):pool.map(t => [t]))
					.sort(utils.sorters.asc(arr => utils.sum(arr.map(c => c.date.getTime()))))//sort by earlier dates first
					.filter(bt => Math.abs(utils.sum([at,...bt],t => t.moneyInForStream(stream)))<0.001)//must be zero sum
				let matchedCandidate = possibleMatches[0] // default candidate is the first possible combo
				if(!matchedCandidate || matchedCandidate.length==0){return}
				matches.push({ [getKeyForTransaction(at)]: [at] , [getKeyForTransaction(matchedCandidate[0])]: matchedCandidate});
				o.matchPool.splice(0,o.matchPool.length,...o.matchPool.filter(bt => !matchedCandidate.includes(bt)))
				toRemove.push(at.transactionId)
			})
			o.elements.splice(0, o.elements.length, ...o.elements.filter(ct => !toRemove.includes(ct.transactionId)))//remove matched elements
		}

		//main exeuction function, testing gradual longer time windows in weeks
		function match(weekWindows,reverseTiming){
			weekWindows.forEach(i => {
				let filter = (ct,dt) => (reverseTiming?(ct.date.getTime() < dt.date.getTime()):(ct.date.getTime() >= dt.date.getTime()) 
				&& (reverseTiming?-1:1)*(ct.date.getTime() - dt.date.getTime()) <= (timeIntervals.oneWeek * i))
				computeMatches({elements: credits, matchPool: debits, oneToMany: false, poolDateFilter: (a,b) => filter(a,b)}) //credit <> debit
				computeMatches({elements: credits, matchPool: debits, oneToMany: true, poolDateFilter: (a,b) => filter(a,b)}) //credit <> [...debit]
				computeMatches({elements: debits, matchPool: credits, oneToMany: true, poolDateFilter: (a,b) => filter(b,a)}) //debit <> [...credit]
			})
		}

		//actual matching execution
		match([1,5,8,16],false);//start with forward order (credits refund debits)
		match([1,5,8,16],true);//for the rest, try reverse order (credits have to be paid afterwards)

		let res = {matches: matches, unmatched: [...credits,...debits]}
		return res
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
