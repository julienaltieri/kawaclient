import React from 'react';
import BaseComponent from './BaseComponent';
import Core from '../core.js';
import DS from '../DesignSystem.js';
import AppConfig from '../AppConfig';
import {getAnalysisStartDate} from './StreamAuditView';
import PageLoader from './PageLoader';
import BalanceChart from './BalanceChart';
import CardRepaymentProbe from './CardRepaymentProbe';

/* General sandbox page, hosting experiments. A first-class route behind login, so it follows the same
   loading lifecycle every other page uses (see loadData() below) rather than reading Core before it's
   ready.

   THE WORKBENCH IS WHATEVER IS BEING WORKED ON, and it is deliberately not an accumulating museum.
   The balance readout, the forecast bench and a row of real compound-stream headers stood here while
   each was the question; each is still its own component (BalanceReadout, BalanceBench,
   HeaderRowDrawer) and comes back by re-adding one line and its import.

   Currently one:
     - the TILE itself, on live transactions, and under it the CARD REPAYMENT PROBE - because the
       forecast and the card issuer's own app disagree about the next repayment, and no fixture can
       settle that: a fixture is a photograph of a day that has already passed and the argument is
       about today. See CardRepaymentProbe.js. */

const titleStyle = {marginBottom:DS.spacing.xxs+"rem",textAlign:"left",fontWeight:"bold"};

export default class Sandbox extends BaseComponent{
	constructor(props){
		super(props);
		this.state = {fetching:true,transactions:[]};
		//the probe reads the TILE ITSELF through this - not a rebuild beside it. See CardRepaymentProbe:
		//every reconstruction so far has agreed with the bank while the tile on screen did not, which
		//leaves only one place the disagreement can be hiding: the instance that is actually drawing.
		this.tile = React.createRef();
	}
	//Same loading lifecycle every page follows (see StreamView.js's MasterStreamView): fetching starts
	//true, loadData() waits on Core.loadData() before touching Core for anything, then flips fetching
	//off. Reading Core before that resolves - including at module scope - is what crashed this page before.
	loadData(){
		//same range MissionControl fetches over, so this page analyzes the same real transactions the
		//audit view does
		return Core.loadData()
			.then(() => Core.getTransactionsBetweenDates(new Date(Math.min(AppConfig.transactionFetchMinDate,getAnalysisStartDate())),new Date()))
			//ALL of them, categorised or not. Money that no stream claims moved the balance exactly as
			//much as money that does - and a card charge is a card charge whether or not anything has
			//been told to expect it, which is the whole subject of the probe below.
			.then(txns => this.updateState({fetching:false,transactions:(txns||[])}))
	}
	componentDidMount(){
		super.componentDidMount?.();
		this.loadData();
	}
	render(){
		if(this.state.fetching)return <PageLoader/>
		//DS.spacing.xs, not .l: production's own tiles come within 1rem of the screen edge, and a page
		//gutter three times that made every one of them narrower than the thing it is reproducing
		return <div style={{maxWidth:"60rem",margin:"0 auto",padding:DS.spacing.xs+"rem"}}>
			{/* THE TILE ITSELF, on the page beside the instrument that questions it. */}
			<div style={titleStyle}>The tile</div>
			<div style={{maxWidth:"24.4rem"}}>
				{/* sticky: a reading that survives the finger lifting, so a day can be looked at
				    rather than only glimpsed under the drag. Tapping it again clears it. */}
				<BalanceChart ref={this.tile} stream={Core.getMasterStream()}
					transactions={this.state.transactions} sticky={true}/>
			</div>
			<div style={{...titleStyle,marginTop:DS.spacing.m+"rem"}}>Card repayment, showing its working</div>
			<CardRepaymentProbe transactions={this.state.transactions} tileRef={this.tile}/>
		</div>
	}
}
