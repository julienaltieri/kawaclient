import React from 'react';
import BaseComponent from './BaseComponent';
import Core from '../core.js';
import DS from '../DesignSystem.js';
import AppConfig from '../AppConfig';
import memoize from 'memoize-one';
import {getStreamAnalysis,reportingConfig,getAnalysisRootDate} from '../processors/ReportingCore.js';
import {getAnalysisStartDate} from './StreamAuditView';
import {TimeAndMoneyProgressView,TerminalStreamCurrentReportPeriodView,format} from './AnalysisView';
import MiniGraph from './MiniGraph';
import {Period} from '../Time';
import utils from '../utils';
import PageLoader from './PageLoader';
import HeaderRowDrawer from './HeaderRowDrawer';
import BalanceBench from './BalanceBench';

//General sandbox page, hosting experiments. A first-class route behind login, so it follows the same
//loading lifecycle every other page uses (see loadData() below) rather than reading Core before it's ready.
//
//Currently two:
//  - the BALANCE FORECAST BENCH, which is where page three's accuracy is actually measured. Its unit
//    tests only prove the model is self-consistent; whether it is RIGHT is a question about this
//    portfolio's real transactions, and there is nowhere else in the app those and the forecast meet.
//  - several real compound-stream header rows (the same row CompoundStreamAuditView renders in
//    StreamAuditView.js), composed from HeaderRowDrawer - the same drawer that row uses in production.

const titleStyle = {marginBottom:DS.spacing.xxs+"rem",textAlign:"left",fontWeight:"bold"};
const ringConfig = {timeThickness:0.4,moneyThickness:1.3,moneyRadius:45,subdivGapAngles:0.0001};

//Same reporting-date logic StreamAuditView keeps privately (it isn't exported): the end of the current
//observation period, computed once since it doesn't change while this page is open.
//Called, not computed at module scope. getAnalysisRootDate reads the user's preferences, which do not
//exist until Core has loaded - and a module body runs the moment anything imports this file, which is
//long before that. Evaluating it eagerly threw on `userPreferences` of undefined and took the whole app
//down, from a page nobody had opened.
const analysisDate = () => reportingConfig.observationPeriod.nextDateFromNow(getAnalysisRootDate());

//One compound-stream header row, built on HeaderRowDrawer: this component supplies the stream's data and
//the drawer/text/chart content, HeaderRowDrawer supplies the window, the gesture and the spring.
class CompoundStreamHeaderRow extends BaseComponent{
	constructor(props){
		super(props);
		//own memoize instance per row, not the shared module-level one StreamAuditView uses: several of these
		//rows are on screen together, and a single shared cache would miss on every render as rows alternate.
		this.mAnalyze = memoize((s,txns,observationPeriod,subReportingPeriod) => getStreamAnalysis(analysisDate(),s,txns,observationPeriod,subReportingPeriod));
	}
	getAnalysis(options){
		return this.mAnalyze(this.props.stream,this.props.transactions,
			options?.observationPeriod || reportingConfig.observationPeriod,
			options?.subReportingPeriod || options?.observationPeriod?.subdivision)
	}
	//The ring compares money spent against time elapsed but never says the number it is comparing. Beside it
	//goes exactly what the app already says about a period elsewhere - the same value and the same word
	//("left", "over", "saved", "received", "paid") - taken from TerminalStreamCurrentReportPeriodView rather
	//than re-derived. Those methods read only props.analysis and hold no state, so borrowing them costs an
	//object and keeps the rule in one place; re-implementing its savings/income/paid branches here would be
	//a second copy to keep in step.
	periodValue(analysis){
		var view = new TerminalStreamCurrentReportPeriodView({analysis:analysis});
		return {text:format(view.getPrimaryValue()), word:view.getSubtext()}
	}
	renderDrawerCaption(analysis){
		var v = this.periodValue(analysis);
		//one wrapping line rather than two fixed ones - see the same caption in StreamAuditView
		return <div style={{lineHeight:1.15,
				fontSize:DS.fontSize.little+"rem",color:DS.getStyle().bodyText}}>{v.text}{" "}
				<span style={{color:DS.getStyle().bodyTextSecondary}}>{v.word}</span></div>
	}
	render(){
		var analysis = this.getAnalysis();
		var current = analysis.getCurrentPeriodReport();
		return <HeaderRowDrawer
				//these rows never collapse, so there is only the one (expanded) margin to reproduce
				style={{marginBottom:DS.verticalSpacing.s}}
				drawer={<TimeAndMoneyProgressView analysis={current} viewConfig={ringConfig}/>}
				drawerCaption={this.renderDrawerCaption(current)}
				chart={<MiniGraph analysis={this.getAnalysis({observationPeriod:Period.yearly})} stream={this.props.stream}/>}>
			<div style={{padding:DS.spacing.xs+"rem",flexGrow:0,marginRight:"auto",textAlign:"left"}}>
				<div style={titleStyle}>{this.props.stream.name}</div>
				<div>{utils.formatCurrencyAmount(this.props.stream.getExpectedAmountAtDate(current.reportingDate),0,true,null,Core.getPreferredCurrency())} per {Period[this.props.stream.period].unitName}</div>
			</div>
		</HeaderRowDrawer>
	}
}

//Picks a handful of real streams for display: sorted by name length and the extremes (plus a couple of
//midpoints) kept, so a long name and a short one both end up on screen rather than however many happen to
//come first.
function pickStreams(){
	var master = Core.getMasterStream();
	var all = master.getAllStreams().filter(s => s!==master && !s.isTerminal() && s.isActiveAtDate(new Date()));
	var byLength = [...all].sort(utils.sorters.asc(s => s.name.length));
	if(byLength.length<=5)return byLength
	var picks = [byLength[0],byLength[Math.floor(byLength.length/3)],byLength[Math.floor(byLength.length*2/3)],byLength[byLength.length-1]];
	return picks.filter((s,i) => picks.indexOf(s)===i)
}

export default class Sandbox extends BaseComponent{
	constructor(props){
		super(props);
		this.state = {fetching:true,transactions:[]};
	}
	//Same loading lifecycle every page follows (see StreamView.js's MasterStreamView): fetching starts
	//true, loadData() waits on Core.loadData() before touching Core for anything, then flips fetching
	//off. Reading Core before that resolves - including at module scope - is what crashed this page before.
	loadData(){
		//same range MissionControl fetches over, so these rows analyze the same real transactions the audit view does
		return Core.loadData()
			.then(() => Core.getTransactionsBetweenDates(new Date(Math.min(AppConfig.transactionFetchMinDate,getAnalysisStartDate())),new Date()))
			//ALL of them, categorised or not. The header rows want only the categorised ones and filter
			//for themselves below; the balance bench needs the others, because money that no stream
			//claims is exactly what its residual row exists to measure - and filtering here would have
			//zeroed that row while leaving it looking computed.
			.then(txns => this.updateState({fetching:false,transactions:(txns||[])}))
	}
	componentDidMount(){
		super.componentDidMount?.();
		this.loadData();
	}
	getTransactionsForStream(s){
		return this.state.transactions.filter(t => t.categorized && t.isAllocatedToStream(s))}
	render(){
		if(this.state.fetching)return <PageLoader/>
		var streams = pickStreams();
		if(!streams.length)return <div style={{padding:DS.spacing.xs+"rem"}}>No streams to show.</div>
		//DS.spacing.xs, not .l: production's header rows come within 1rem of the screen edge, and a page
		//gutter three times that made every row narrower than the thing it is reproducing
		//the bench takes ALL the transactions, not one stream's: it reconstructs an account, and an
		//account is moved by everything that touched it - including whatever no stream claims, which
		//is the number it exists to surface
		return <div style={{maxWidth:"60rem",margin:"0 auto",padding:DS.spacing.xs+"rem"}}>
			<div style={titleStyle}>Balance forecast bench</div>
			<BalanceBench transactions={this.state.transactions}/>
			<div style={{...titleStyle,marginTop:DS.spacing.m+"rem"}}>Header rows</div>
			{streams.map(s => <CompoundStreamHeaderRow key={s.id} stream={s} transactions={this.getTransactionsForStream(s)}/>)}
		</div>
	}
}
