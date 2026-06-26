import styled from 'styled-components';
import DesignSystem from '../DesignSystem.js'
import {CompactMiniGraph} from './MiniGraph'
import {GenericStreamAnalysisView, StreamAnalysisTransactionFeedView} from './AnalysisView'
import utils from '../utils'
import {timeIntervals} from '../Time'
import { reconcileZeroSumStreamTransactions, suggestAmazonReturnSplits } from '../transactionMatching'
import Core from '../core'



export class StreamObservationPeriodView extends GenericStreamAnalysisView{
	constructor(props){
		super(props)
		this.state = {minigraphLastRefresh:new Date()}
		this._processedSplitIds = new Set()
	}

	get isZeroSumStream() {
        return this.props.analysis.stream.isZeroSumStream;
    }

	componentDidMount() { this._applyAmazonReturnSplitsIfNeeded() }

	componentDidUpdate(prevProps) {
		if (prevProps.analysis !== this.props.analysis) { this._applyAmazonReturnSplitsIfNeeded() }
	}

	_applyAmazonReturnSplitsIfNeeded() {
		if (!this.isZeroSumStream) return
		const { transactions, stream } = this.props.analysis
		const { unmatched } = reconcileZeroSumStreamTransactions(transactions, stream)
		const unmatchedAmazonCredits = unmatched.filter(t => t.amount > 0 && t.amazonOrderDetails)
		if (unmatchedAmazonCredits.length === 0) return

		const allTransactions = Core.globalState.queriedTransactions?.transactions || []
		const candidates = suggestAmazonReturnSplits(unmatchedAmazonCredits, allTransactions, stream)
			.filter(({ debit }) => !this._processedSplitIds.has(debit.transactionId))
		if (candidates.length === 0) return

		candidates.forEach(({ debit }) => this._processedSplitIds.add(debit.transactionId))

		const tupples = candidates.map(({ debit, splitAmount }) => ({
			transaction: debit,
			streamAllocation: [
				{ streamId: stream.id, amount: -splitAmount, type: 'value' },
				{ streamId: debit.streamAllocation[0].streamId, amount: -(Math.abs(debit.amount) - splitAmount), type: 'value' }
			]
		}))

		Core.categorizeTransactionsAllocationsTupples(tupples).then(() => {
			candidates.forEach(({ credits, debit }) =>
				console.log(`[Amazon Return Split] Auto-split charge ${debit.transactionId} ($${debit.amount}) to fund ${credits.length} refund(s): ${credits.map(c => `${c.transactionId} ($${c.amount})`).join(', ')}`)
			)
			this.props.onStreamDefinitionChange?.()
		})
	}

	render(){
		const { transactions, stream } = this.props.analysis
		const reconciliation = this.isZeroSumStream
			? reconcileZeroSumStreamTransactions(transactions, stream)
			: undefined

		return <ObsPeriodViewContainer style={{paddingRight: '0.4rem'}}>
			<CompactMiniGraph refresh={this.state.minigraphLastRefresh} shouldOverrideOverflow={true} analysis={this.props.analysis} stream={this.props.analysis.stream}/>
			<StreamAnalysisTransactionFeedView
				analysis={this.props.analysis}
				reconciliation={reconciliation}
				onMinigraphUpdateRequested={() => this.updateState({minigraphLastRefresh:new Date()})}
				onCategorizationUpdate={this.props.onCategorizationUpdate}
				onStreamDefinitionChange={this.props.onStreamDefinitionChange}/>
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
