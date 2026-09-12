/* ==================================================================================================
   THE STREAM PREDICTOR. Given a captured portfolio, it says what each terminal stream will do next.

   IT IS CONSTRUCTED FROM PLAIN JSON, NOT FROM MODEL INSTANCES, and that is a hard constraint rather
   than a convenience: model.js and core.js pull in Core and AppConfig, which need a browser and a
   logged-in user, and a prediction algorithm that cannot be run under node cannot be checked. So the
   whole module reads the captured shape directly - `masterStream`, `transactions`, `accounts`,
   `accountTypes` - exactly as the bench fixture holds it.

   THE OBJECT EXISTS TO HOLD WHAT IS WALKED ONCE. The tree walk and the ledger flattening are shared
   by all 87 terminal streams and by every stage below; recomputing them per stream is the difference
   between one pass over 1,214 transactions and eighty-seven.
   ================================================================================================== */

import {streamLedger, terminalStreams, mapAccounts, isClosedStream} from './accountMapping';

/* THE TWO PERIODS THE SPEC DEFERS. A yearly declaration states an amount per year and no rhythm,
   so it is the one case where the ledger has to be asked rather than read. */
const YEARLY_PERIODS = {yearly: true, biyearly: true};
import {createDate} from '../../Time';
import {reportingConfig} from '../../reportingConfig';

export class StreamPredictor {
	/* THE PORTFOLIO IS THE ONLY INPUT, because everything the prediction takes as given is already in
	   it: the account list with its types, the user's type overrides, the ledger, and the master
	   stream with its declared amounts. A second argument would be a second source of truth for a
	   fact the capture already states. */
	constructor(portfolio){
		this.portfolio = portfolio || {};
		this.accountsByHash = {};
		(this.portfolio.accounts || []).forEach(a => {if(a && a.hash)this.accountsByHash[a.hash] = a});
		//the user's overrides, in exactly the shape effectiveAccountType expects as its second argument
		this.accountTypeOverrides = this.portfolio.accountTypes || {};
		this._terminals = null;
		this._ledger = null;
		this._anchor = null;
	}

	/* ---- THE ONE SEAM EVERY CYCLE WALK IS PHASED ON ------------------------------------------------
	   THE ANALYSIS ROOT DATE, AND IT IS NOT A NEW IDEA - it is the date the app has always started an
	   analysis on, chosen because almost no transaction falls on it. A bucket lattice phased on it has
	   seams the calendar decides; a lattice phased on a stream's own newest leg has seams the data
	   decides, and one new transaction on a different day of the month then moves every boundary in
	   the stream's history.

	   THE CONFIG IS READ FROM src/reportingConfig.js, NOT COPIED. ReportingCore.js computes the same
	   date from the same object, and the predictor cannot import ReportingCore because that file pulls
	   in core.js, which needs a browser - so the config was split out rather than duplicated.

	   THE YEAR IS LAST YEAR, matching getAnalysisRootDate, and it is read from `portfolio.today` when
	   the capture carries one. Reading the wall clock instead would make the predictor a function of
	   when it was run rather than of the instant that was captured, and the test would change answer
	   at midnight on new year's eve. `createDate` is the same helper ReportingCore uses, so the
	   time-of-day normalisation is identical on both sides. */
	analysisAnchor(){
		if(!this._anchor){
			const captured = this.portfolio.today ? new Date(this.portfolio.today) : new Date();
			const prefs = this.portfolio.userPreferences || {};
			this._anchor = createDate(captured.getFullYear() - 1, reportingConfig.startingMonth - 1,
				prefs.reportingStartingDay || reportingConfig.startingDay);
		}
		return this._anchor;
	}

	/* MEMOISED, because the walk is the same walk for every stage and every stream. */
	terminalStreams(){
		if(!this._terminals)this._terminals = terminalStreams(this.portfolio.masterStream);
		return this._terminals;
	}

	/* MEMOISED, for the same reason and more strongly: this is the pass over the whole ledger. */
	ledger(){
		if(!this._ledger)this._ledger = streamLedger(this.portfolio.transactions);
		return this._ledger;
	}

	/* A STREAM WITH NO TRANSACTIONS GETS AN EMPTY ARRAY, NOT UNDEFINED. A newly declared stream is a
	   normal state of the portfolio, and making every caller guard against a missing key turns a
	   fact about the data into a crash. */
	legsOf(streamId){
		return this.ledger().get(streamId) || [];
	}

	/* §1 for one stream. */
	partitionOf(streamId){
		return mapAccounts(this.legsOf(streamId), this.accountsByHash, this.accountTypeOverrides);
	}

	/* EVERY TERMINAL STREAM, INCLUDING THE ONES WITH NOTHING IN THEM. A stream that has never moved
	   money returns an empty partition, and that is a real answer: it is precisely the row an audit
	   needs to see, and dropping it makes an absence look like an oversight. */
	mapAllAccounts(){
		return this.terminalStreams().map(stream => {
			const legs = this.legsOf(stream.id);
			return {stream: stream, legs: legs, partition: this.partitionOf(stream.id)};
		});
	}

	/* WHAT A PERSON IS ASKED TO REVIEW, which is not the same set as what the predictor predicts.
	   A closed stream is the user saying this one stopped; 23 carry an endDate and 21 of those have
	   no transactions and names like `test`, `test3`, `ttest`. The walk keeps returning them - taking
	   them out of `terminalStreams` would change what the module is a prediction OF - but no audit
	   page should spend a row on one. */
	reviewable(){
		return this.terminalStreams().filter(s => !isClosedStream(s));
	}

	/* THE GROUND TRUTH FOR THE CYCLE DETECTOR. Open, non-yearly, and carrying transactions: the
	   declaration on these has been validated by hand, so a detector that disagrees with one of them
	   is wrong about a known answer. The yearly streams are excluded precisely BECAUSE the spec says
	   their rhythm must be inferred - there is nothing to check an inference against there. */
	fitCohort(){
		return this.reviewable().filter(s =>
			!YEARLY_PERIODS[s.period] && this.legsOf(s.id).length > 0);
	}

	mapFitCohort(){
		return this.fitCohort().map(stream =>
			({stream: stream, legs: this.legsOf(stream.id)}));
	}

	/* THE POPULATION THE DETECTOR WAS BUILT FOR, and the one there is no ground truth for. Open,
	   declared yearly or biyearly, and carrying transactions: 35 of the 38 open yearly streams. The
	   declaration here states an amount per year and says nothing about rhythm, so agreement with it
	   is not a score - the reader is judging plausibility by eye, which is exactly why these get
	   their own tab instead of being folded into the validated cohort. */
	yearlyCohort(){
		return this.reviewable().filter(s =>
			YEARLY_PERIODS[s.period] && this.legsOf(s.id).length > 0);
	}

	mapYearlyCohort(){
		return this.yearlyCohort().map(stream =>
			({stream: stream, legs: this.legsOf(stream.id)}));
	}

	/* ---- STAGES 2-4 ATTACH HERE -------------------------------------------------------------------
	   §2 cycle determination, §3 shape determination and §4 amount prediction live in their own files
	   (cycleDetermination.js, shapeDetermination.js, amountPrediction.js) and are composed from this
	   object: each takes a stream's legs, its declaration and this object's `analysisAnchor()`, and
	   hands back a decision. Nothing above this line knows they exist, which is what keeps §1
	   checkable on its own. */
}

export default StreamPredictor;
