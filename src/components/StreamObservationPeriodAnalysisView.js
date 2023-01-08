import styled from 'styled-components';
import DesignSystem from '../DesignSystem.js'
import {CompactMiniGraph} from './MiniGraph'
import {GenericStreamAnalysisView, StreamAnalysisTransactionFeedView} from './AnalysisView'



export class StreamObservationPeriodView extends GenericStreamAnalysisView{
	render(){
		return <ObsPeriodViewContainer style={{paddingRight: '0.4rem'}}>
			<CompactMiniGraph shouldOverrideOverflow={true} analysis={this.props.analysis} stream={this.props.analysis.stream}/>
			<StreamAnalysisTransactionFeedView analysis={this.props.analysis} onCategorizationUpdate={this.props.onCategorizationUpdate}/>
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
