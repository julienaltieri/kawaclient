import Core from '../core.js';
import {Period,dateIterator,timeIntervals,createDate} from '../Time'
import dateformat from "dateformat";
import utils from '../utils'
import AppConfig from '../AppConfig'



export const reportingConfig = {
	startingDay: 21,
	startingMonth: 12, //december = 12
	observationPeriod: Period.yearly, //this should be longer or equal to the longest stream's period, otherwise it doesn't make sense.
}
export const analysisRootDateForYear = y => createDate(y,reportingConfig.startingMonth-1,Core.getUserData().userPreferences.reportingStartingDay || reportingConfig.startingDay)
export const getAnalysisRootDate = () => analysisRootDateForYear(new Date().getFullYear()-1);//analysis starting date is Dec 21 GMT

//note: it is expected that txns are categorized transactions. 
export const getStreamAnalysis = function(reportingDate,stream,txns,reportingPeriod,subReportingPeriodOverride){ //single stream Streamanalysis
	return new StreamAnalysis(stream,txns,reportingDate,reportingPeriod,subReportingPeriodOverride || Period[stream.period])// the stream's period is also the frequency at which it wants to be reported
}
export const getMultiStreamAnalysis = function(reportingDate,streams,txns,reportingPeriod,subReportingPeriodOverride){ //stream array Streamanalysis,
	return new MultiStreamAnalysis(streams,txns,reportingDate,reportingPeriod,subReportingPeriodOverride || Period.monthly)
}

/* An Analysis is a high-level structure to create insights on a stream, a set of transactions and over a period of time
It is a generic class embedding generic aggregation and statistics functions. Concepts are: 
- observation period: the timespan for which we're observing transactions and reporting on
- reporting period: the time unit this observation period is built on. Ex: reporting period is weekly, and the observation period is from 01/01/22 to 01/07/22
- reportingStartDate: start of the observation period
- reportingDate: end of the observation period
- subReportingPeriod: defines the subdivisions period if used (for StreamAnalysis, it is the frequency of the reports)

Subclass map for Analysis:
|_Report => Streamanalysis across a stream tree
|_StreamAnalysis => analysis across time periods (aggregates Report objects)
|_MultiStreamAnalysis => analysis accross a stream array (aggregates StreamAnalysis objects)
*/
class Analysis {
	constructor(stream,transactions,reportingDate,reportingPeriod,subReportingPeriod){
		this.stream = stream;//allowed to be null for Streamanalysis that aren't specific to a stream. 
		this.reportingDate = reportingDate;
		this.reportingPeriod = reportingPeriod; //Period.longestPeriod([reportingPeriod,Period[stream.period]]);
		this.subReportingPeriod = subReportingPeriod;
		let ancestors = (stream)?stream.getAncestors():undefined
		this.reportingStartDate = this.reportingPeriod.previousDate(reportingDate);
		this.transactions = transactions.filter(t => 	this.reportingStartDate.getTime() < t.getDisplayDate().getTime() && t.getDisplayDate().getTime() <= this.reportingDate.getTime() //date matches report
			&& (!stream || t.isAllocatedToStream(this.stream)) //&& //transaction is related to stream
			&& (AppConfig.featureFlags.includeInterestInBudgeting || (
				!t.isUnderInterestIncomeCompoundStream() || !stream 
				|| utils.or([this.stream,...ancestors], as => !as.isTerminal() && as.isInterestIncomeStream())
			)) // if feature flag not on, exclude transactions contributing to an interest stream
		);
		this.abstractMethodError = new Error("Trying to call an abstract method. Stats methods must be implemented by subclasses of Analysis");
	}

	//stats (abstract, subclasses must implement their own stats methods)
	getNetAmount(){throw this.abstractMethodError} //sum of all transactions to date
	getMovedToSavings(){throw this.abstractMethodError}  //sum of all transfers to saving accounts
	getExpected(){throw this.abstractMethodError} //expected amount in stream for this reporting period
	getLeftOver(){throw this.abstractMethodError} //left to spend / left to expect 

	//convenience period functions
	getCompletePeriodCountTillDate(date,period){let count = 0;dateIterator(this.reportingStartDate,date,period,(d) => count++);return count}
	getSubdivisionsCount(){return this.reportingPeriod.getTimeSubdivisionsCount(this.reportingStartDate)} 
	getCompletedSubdivisionsCount(){return this.getCompletePeriodCountTillDate(Date.now(),this.reportingPeriod.subdivision)};
	getIncompleteSubdivisionsCount(){return this.getSubdivisionsCount()-this.getCompletedSubdivisionsCount()}

	//helpers and getters
	getAggregateSum(arr,accessor = x => x){return utils.round2Decimals(arr.reduce(utils.reducers.sum(accessor),0))}
	getTransactionsBetweenDates(sd,ed){return this.transactions.filter(t => sd.getTime() < t.getDisplayDate().getTime() && t.getDisplayDate().getTime() <= ed.getTime())}
	isMature(){return this.reportingDate<new Date()}
	isSavings(){return this.stream.isSavings}
	isIncome(){return this.getExpected()>0}
	isInterest(){return this.stream.isInterestIncome}
	getTransactionsForStream(s){return this.transactions.filter(t => t.categorized && utils.or(s.getAllTerminalStreams(),ss => t.isAllocatedToStream(ss)))}
	getReportingPeriodString(){
		if(this.reportingPeriod.name == Period.quarterly.name){return "Q"+Math.ceil((this.reportingDate.getUTCMonth()+1)/3)}
			var formats = {};
			formats[Period.daily.name] 			= 'mm/dd';
			formats[Period.weekly.name] 		= '"Week of" mm/dd';
			formats[Period.biweekly.name] 		= 'mm/dd';
			formats[Period.semimonthly.name]	= "mm/dd";
			formats[Period.monthly.name] 		= "mmmm";
			formats[Period.bimonthly.name] 		= "mmm";
			formats[Period.yearly.name] 		= 'yyyy';
			return dateformat(this.reportingDate,formats[this.reportingPeriod.name])
	}
}

/* A Report is a piece of Streamanalysis representing a slice in time, and knows how it should be subdivided. 
It is responsible to report the statistics on a set of transactions for this time period.
It is meant to be narrow in time, but go stream-deep: stats are based on a bottom up calculation of children streams.
*/
class PeriodAnalysis extends Analysis{ 
	constructor(stream,transactions,reportingDate,reportingPeriod,parentStreamAnalysis){
		super(stream,transactions,reportingDate,reportingPeriod,reportingPeriod.subdivision);
		this.parentStreamAnalysis = parentStreamAnalysis;
		this.stats = {
			net: this.getNetAmount(),
			movedToSavings: this.getMovedToSavings(),
			expected: this.getExpected(),
			paexpected: this.getPastAwareExpected(),
			expectedAtMaturity: this.getExpectedAtMaturity(),
			leftover: this.getLeftOver()
		}
	}

	//stats
	getNetAmount(){return this.getAggregateSum(this.transactions,t => t.moneyInForStream(this.stream))}
	getMovedToSavings(){return this.getAggregateSum(this.transactions,t => t.savedForStream(this.stream))}
	getExpected(){return this.stream.getExpectedAmountAtDate(this.reportingDate,this.reportingPeriod.name) }
	getExpectedAtMaturity(){return this.getExpected()}
	getPastAwareExpected(){return utils.round2Decimals(this.getProjectedPeriodicAmountForStream(this.stream)||0)}
	getLeftOver(){
		let expected = (this.stream.isTerminal()||true)?this.getExpected():this.getPastAwareExpected();
		if(this.stream.isInterestIncome){return -utils.round2Decimals(this.getNetAmount()-expected)}
		if(this.isSavings()){return utils.round2Decimals(-this.getMovedToSavings()-expected)}
		else{return utils.round2Decimals(this.getNetAmount()-expected)}
	}

	//helpers
	isProjectable(){return this.hasTransactionsAvailableInAllSubstreams(this.stream)}
	hasTransactionsAvailableInAllSubstreams(s){
		if(!s.children){return this.getTransactionsForStream(s).length>0}
		else{return utils.and(s.children, c => this.hasTransactionsAvailableInAllSubstreams(c))}
	}
	getProjectedPeriodicAmountForStream(s){//calculate expected amount during reporting period of this report
		if(!s.children){//terminal stream. OP = ObservationPeriod aka context of this analysis, RP = Reporting period
			let OP = Period.longestPeriod([this.reportingPeriod,Period[s.getPreferredPeriod()]]);//the OP to use in this projection. If the stream is yearly and the reporting monthly, we want yearly.
			let OPStartDate = this.parentStreamAnalysis.getLastCompleteReportingDateBeforeDate(this.reportingStartDate,OP);
			let remainingRPsInOP = this.getCompletePeriodCountTillDate(OP.nextDate(OPStartDate),this.reportingPeriod)||1; //if no complete period left, the current period is the last one
			let toExpectInOP = s.getExpectedAmountAtDate(this.reportingStartDate,OP.name);//default expectation (no past influence)

			//if the stream's period is longer than the reporting period, we need to take into account transactions outside of the reporting period
			if(OP == Period[s.getPreferredPeriod()]){
				let amountBeforeRP = (s.isSaving()?-1:1)*this.parentStreamAnalysis.getTransactionSumBetweenDatesForStream(OPStartDate,this.reportingStartDate,s);
				toExpectInOP = (s.isIncome()?-1:1)*Math.min((s.isIncome()?-1:1)*(toExpectInOP - amountBeforeRP),0);
			}
			return toExpectInOP / remainingRPsInOP; //if there is $600 left to spend over 4 month, this should return $150
		}else{//compound stream
			return this.getAggregateSum(s.children.map(c => this.getProjectedPeriodicAmountForStream(c)).filter(n => !isNaN(n)))
		}
	}
}



/* A Streamanalysis provides insights regarding a stream over time.
it confronts expectations of that stream with transactions that actually happened. StreamAnalysis isn't directly responsible for depth... 
rather, it is responsible for aggregation over time, and expectations to a horizon. Depth Streamanalysis (slice of time, stream-deep) is achieved via Reports.
*/
class StreamAnalysis extends Analysis{
	constructor(stream,transactions,analysisDate,reportingPeriod,subReportingPeriod){
		super(stream,transactions,analysisDate,reportingPeriod,subReportingPeriod);
		this.streamName = stream.name;//convenience for debugging
		this.periodReports = this.getReportingSchedule().map(date => new PeriodAnalysis(stream,this.transactions,date,this.subReportingPeriod,this));
		this.stats = {
			avgByPeriods: (this.isSavings()?this.getMovedToSavings(true):this.getNetAmount(true))/this.getMaturePeriodReports().length,
			total: this.isSavings()?this.getMovedToSavings(true):this.getNetAmount(true),
			net: this.getNetAmount(),
			expected: this.getExpected(),
			expectedAtMaturity: this.getExpectedAtMaturity(),
			leftover: this.getLeftOver(),
			includedReports: this.getMaturePeriodReports()
		}
	}

	//stats
	getNetAmount(matureOnly){return this.getAggregateSum(matureOnly?this.getMaturePeriodReports():this.periodReports,r => r.getNetAmount())}
	getMovedToSavings(matureOnly){return this.getAggregateSum(matureOnly?this.getMaturePeriodReports():this.periodReports,r => r.getMovedToSavings())}
	getExpected(matureOnly){return this.getAggregateSum(matureOnly?this.getMaturePeriodReports():this.periodReports,r => r.getExpected())}
	getExpectedAtMaturity(){return this.getExpected(true)+this.getIncompleteSubdivisionsCount()*this.periodReports.slice(-1)[0].getExpected()}
	getLeftOver(matureOnly){return this.getAggregateSum(matureOnly?this.getMaturePeriodReports():this.periodReports,r => r.getLeftOver())}
	getFrequencyHistogramAtDate(date){//date should be the reportingDate of the report this histogram is for (not the start date)
		if(!this.bins){
			let period = this.subReportingPeriod;//period being visualized in the display report - the histogram will aggregate data from other periods in the observation period
			let bins = new Array(Math.floor(period.getTimeSubdivisionsCount(period.previousDate(date)))).fill(0);//initiaties an array representing the subdivisions of the current period		
			let reportStartDate = period.previousDate(date);//calculates the subdivision index that corresponds to the beginning of the calendar period (1st of month, 1st day of the week, etc) - this makes the histogram exact even when aggregating data across periods of variable lenghts (ex: months)
			let calendarZero = (period.periodCalendarStart(date)-reportStartDate)/period.subdivision.getTimeIntervalFromDate(reportStartDate);//position of the new [0] (calendar start) in subdivision array

			//calculates the histogram from calendarZero
			this.periodReports.forEach(r => {r.transactions.forEach(t => {
				let bin =  Math.round((t.getDateInDisplayTimezone() - period.periodCalendarStart(t.getDateInDisplayTimezone()))/r.subReportingPeriod.getTimeIntervalFromDate(r.reportingStartDate))
				bins[bin] = (bins[bin]||0)+Math.abs(t.moneyInForStream(this.stream))+Math.abs(t.savedForStream(this.stream))
			})})
			let max = utils.max(bins);
			this.bins = utils.rotateLeft(bins.map(c => c/max),calendarZero); //normalize and rotates back to place calendarZero in its original position
		}
		return this.bins;
	}
	
	//convenience period functions
	getLastCompleteReportingDateBeforeDate(date,period){return [this.reportingStartDate,...this.getReportingSchedule(period)][this.getCompletePeriodCountTillDate(date,period)]}
	getAmountForCompletedPeriods(){return this.stream.isSavings?this.getMovedToSavings(true):this.getNetAmount(true)}
	getRemainingAmountInObservationPeriod(){return (this.stream.isSavings?-1:1)*this.getCurrentPeriodReport().getPastAwareExpected()*this.getIncompleteSubdivisionsCount()}
	getEndOfOPProjection(){return this.getAmountForCompletedPeriods() + this.getRemainingAmountInObservationPeriod()}
 
	//helpers and getters
	getPeriodReports(matureOnly=false){return matureOnly?this.getMaturePeriodReports():this.periodReports}
	getMaturePeriodReports(){return this.periodReports.filter(r => r.isMature())}
	getCurrentPeriodReport(){return this.periodReports[this.periodReports.length-1]}
	getReportingSchedule(period=this.subReportingPeriod,full=false){
		let res = [];
		dateIterator(this.reportingStartDate,full?this.reportingPeriod.nextDate(this.reportingStartDate):Date.now(),period,(d) => res.push(d))
		res.push(period.nextDate(res[res.length-1] || this.reportingStartDate))
		//if(this.stream.name=="Wages Julien"){console.log(res)} 
		return res
	}
	getTransactionSumBetweenDatesForStream(sd,ed,s = this.stream){
		if(this.isSavings()){return this.getAggregateSum(this.getTransactionsBetweenDates(sd,ed),t => t.savedForStream(s))}
		else {return this.getAggregateSum(this.getTransactionsBetweenDates(sd,ed),t => t.moneyInForStream(s)||0)}
	}
}

/*MultiStreamAnalysis is an aggregate StreamAnalysis across a stream Array*/
class MultiStreamAnalysis extends Analysis{
	constructor(streams,transactions,analysisDate,reportingPeriod,subReportingPeriod){
		super(null,transactions,analysisDate,reportingPeriod,subReportingPeriod);
		this.streams = streams;
		this.analyses = streams.map(s => new StreamAnalysis(s,this.getTransactionsForStream(s),analysisDate,reportingPeriod,subReportingPeriod))
	}

	//stats
	getNetAmount(matureOnly){						return this.getAggregateSum(this.analyses, a => a.getNetAmount(matureOnly))}
	getMovedToSavings(matureOnly){					return this.getAggregateSum(this.analyses, a => a.getMovedToSavings(matureOnly))}
	getExpected(matureOnly){						return this.getAggregateSum(this.analyses, a => a.getExpected(matureOnly))}
	getLeftOver(matureOnly){						return this.getAggregateSum(this.analyses, a => a.getLeftOver(matureOnly))}
	getAmountForCompletedPeriods(){					return this.getAggregateSum(this.analyses, a => a.getAmountForCompletedPeriods())}
	getRemainingAmountInObservationPeriod(){		return this.getAggregateSum(this.analyses, a => a.getRemainingAmountInObservationPeriod())}
	getEndOfOPProjection(){							return this.getAggregateSum(this.analyses, a => a.getEndOfOPProjection())}
	getExpectedAmountAtDateForPeriod(d,period){		return this.getAggregateSum(this.analyses, a => a.stream.getExpectedAmountAtDateByPeriod(d,period.name))}
	getPeriodAggregates(matureOnly=true){//PeriodAnalysis are specific to streams so in this situation, we need to create virtual reports instead
		let acc = {netToDate:0,savedToDate:0}
		let res = this.analyses[0]?.getPeriodReports(matureOnly).map((r,i) => {
			acc.netToDate += r.getNetAmount()
			acc.savedToDate += r.getMovedToSavings()
			return {
				streams : [r.stream],
				reportingDate : r.reportingDate,
				reportingPeriod : this.subReportingPeriod,
				reportingStartDate : r.reportingStartDate,
				stats: {
					netAmount: r.getNetAmount(),
					movedToSavings: r.getMovedToSavings(),
					expected: r.getExpected(),
					netToDate: acc.netToDate,
					savedToDate: acc.savedToDate
				},
				transactions: r.transactions
			}
		}) || [];
		for(let i = 1; i<this.analyses.length;i++){
			let add = this.analyses[i].getPeriodReports(matureOnly);
			let acc = {netToDate:0,savedToDate:0}
			res.forEach((r,j) => {
				let ar = add[j];
				acc.netToDate += ar.getNetAmount()
				acc.savedToDate += ar.getMovedToSavings()
				r.streams.push(ar.stream)
				r.stats.netAmount += ar.getNetAmount()
				r.stats.movedToSavings += ar.getMovedToSavings()
				r.stats.expected += ar.getExpected()
				r.stats.netToDate += acc.netToDate;
				r.stats.savedToDate += acc.savedToDate;
				let txnIds = r.transactions.map(t => t.id)
				ar.transactions.forEach(t => {
					if(txnIds.indexOf(t.id)==-1){
						r.transactions.push(t)
						txnIds.push(t.id)
					}
				})
			})
		}
		return res
	}
	
	//convenience and getters
	getFullSchedule(){return this.analyses[0]?.getReportingSchedule(undefined,true) || []}
	isSavings(){return this.analyses[0].isSavings()}
}
//[recurringExpenses.getPeriodReports(), annualExpenses.getPeriodReports()]

//function isSavingAccount(accountId){return Core.isSavingAccount(accountId)}
