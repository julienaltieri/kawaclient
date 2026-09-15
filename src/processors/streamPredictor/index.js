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

import {createDate} from '../../Time';
import {determineCycle, cycleOf as cycleFrom} from './cycleDetermination';
import {determineShape, explainShape} from './shapeDetermination';
import {legsInWindow} from './cycleFit';
import {streamSchedule} from './streamSchedule';
import {cardRepayments} from './cardRepayments';
import {DEFAULT_COUNTRY} from './businessCalendar';
import {AccountKind} from './accountMapping';
import {reportingConfig} from '../../reportingConfig';

/* THE TWO PERIODS THE SPEC DEFERS. A yearly declaration states an amount per year and no rhythm,
   so it is the one case where the ledger has to be asked rather than read. */
const YEARLY_PERIODS = {yearly: true, biyearly: true};

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
		this._repayments = null;
		/* ---- WHAT IS ASKED ONCE PER STREAM AND ANSWERED MANY TIMES -------------------------------
		   THE PORTFOLIO DOES NOT CHANGE UNDER AN INSTANCE. It is handed in at construction and
		   nothing here writes to it, so a stream's partition, cycle and shape are functions of the
		   stream id alone and the same answer every time they are asked.

		   THEY WERE BEING RECOMPUTED ON EVERY CALL, and the call chain asks repeatedly: a schedule
		   asks for the shape, the amount stage asks for it again alongside the working reading, and
		   the labeller asks a third time. Reading all 64 streams' shapes cost 356ms and cost the
		   same 356ms again immediately afterwards. This is the same reason the tree walk and the
		   ledger flattening are held here - one pass, not eighty-seven. */
		this._byId = null;
		this._partitions = {};
		this._cycles = {};
		this._shapes = {};
		this._explained = {};
	}

	/* THE STREAM WITH THIS ID, from a map rather than a scan. Every stage below starts by resolving
	   an id, and a linear search over eighty-seven streams per call is the kind of cost that only
	   shows up once something calls it thousands of times. */
	streamById(streamId){
		if(!this._byId){
			this._byId = {};
			this.terminalStreams().forEach(s => {if(s && s.id)this._byId[s.id] = s});
		}
		return this._byId[streamId];
	}

	/* A CALLER MAY HAND IN A NODE, and if it is not the one this id resolves to then the answer is
	   about something else and must not be cached under that id. Every internal caller passes the
	   stream it just looked up, so this is the ordinary path rather than the exception. */
	cacheable(streamId, stream){
		return !stream || stream === this.streamById(streamId);
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

	/* THE INSTANT THE PORTFOLIO WAS TAKEN, which is what "now" means to every stage here. Reading the
	   wall clock instead would make a question like "how long has this stream been quiet?" answer
	   differently tomorrow against the same capture, and the test would drift a day at a time. */
	analysisNow(){
		return this.portfolio.today ? new Date(this.portfolio.today) : new Date();
	}

	/* ---- WHOSE CALENDAR AND WHOSE CLOCK -----------------------------------------------------------
	   BOTH COME FROM THE ACCOUNT, NEVER FROM THE MACHINE. A prediction that changes because it was
	   computed on a laptop in a different timezone is not a prediction, and a holiday list is a fact
	   about where the user banks rather than about where this code is running.

	   THE OFFSET DEFAULTS TO ZERO because a bank date arrives as a date and is stored as UTC
	   midnight: read at zero it gives back exactly the day the bank stated. It is the capture that
	   should carry the user's own offset, and until it does, zero is the honest reading rather than a
	   guess dressed up as one.

	   THE COUNTRY DEFAULTS TO THE ONE CALENDAR THAT IS FILLED IN. A country the calendar does not
	   know gets no weekend adjustment at all, which is the safe direction: no adjustment leaves the
	   dates as the bank recorded them, the wrong country's holidays move them confidently to the
	   wrong place. */
	userTimezoneOffset(){
		const prefs = this.portfolio.userPreferences || {};
		const v = prefs.timeZoneOffset !== undefined ? prefs.timeZoneOffset
			: this.portfolio.timeZoneOffset;
		return typeof v === 'number' ? v : 0;
	}

	userCountry(){
		const prefs = this.portfolio.userPreferences || {};
		return prefs.country || this.portfolio.country || DEFAULT_COUNTRY;
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
		if(this._partitions[streamId] === undefined)
			this._partitions[streamId] = mapAccounts(this.legsOf(streamId), this.accountsByHash,
				this.accountTypeOverrides);
		return this._partitions[streamId];
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

	/* ---- THE MODULE'S OWN ENTRY POINTS ------------------------------------------------------------
	   THE SEAM AND THE WINDOW ARE SETTLED HERE, ONCE, AND NO CALLER CHOOSES THEM. Every stage needs
	   the same analysis anchor and the same slice of history; handing those to a stage as arguments
	   would let one caller give §3 a different seam from the one §2 used, and the two would disagree
	   about where a cycle begins while both looking correct. These methods are how a consumer asks,
	   and the free functions in each stage exist so the arithmetic can be tested in isolation.

	   THE EVIDENCE IS THIS REPORTING YEAR, for §3 exactly as for §2. An arrangement is a thing its
	   owner changes between years, and a shape read across a change describes neither side of it. */
	evidenceFor(streamId){
		return {legs: this.legsOf(streamId), anchor: this.analysisAnchor(), now: this.analysisNow()};
	}

	cycleOf(streamId, stream){
		const node = stream || this.streamById(streamId);
		if(!this.cacheable(streamId, stream))return determineCycle(node, this.evidenceFor(streamId));
		if(this._cycles[streamId] === undefined)
			this._cycles[streamId] = determineCycle(node, this.evidenceFor(streamId));
		return this._cycles[streamId];
	}

	/* ---- WHICH CARDS ARE PAID FROM WHERE ------------------------------------------------------
	   READ ONCE FOR THE PORTFOLIO. A credit on a card that has a debit of the same size on a
	   real-time account within a few days is one movement seen twice, and that single match names
	   the funding account, the repayment legs and the stream that does the repaying. */
	repaymentLinks(){
		if(!this._repayments)
			this._repayments = cardRepayments(this.portfolio, this.accountTypeOverrides);
		return this._repayments;
	}

	/* A REPAYMENT IS TWO MODES AND ONE MOVEMENT, and only the ledger knows they are the same.
	   §3 splits a stream by payee, account and direction, so a transfer always becomes two modes
	   with two independently estimated amounts - which is right by its own rules and leaves nobody
	   holding the fact that the card leg and the current-account leg answer for each other.

	   THE LABEL IS WHAT A BALANCE NEEDS. A card's repayment is not worth the median of its own
	   history: it is whatever the card owes on the day. A caller that cannot tell which mode is the
	   repayment has to guess, and the guess it would make - trust the amount - is the wrong one. */
	labelRepayments(answer, streamId){
		const found = this.repaymentLinks();

		/* THE CARD LEG FIRST, because it names the card unambiguously: money arriving on a deferred
		   account this stream is known to repay. */
		const cards = [];
		answer.modes.forEach(m => {
			if(m.accountType !== AccountKind.deferred || m.direction !== 'in')return;
			if(!found.links[m.accountId] || !(found.streams[m.accountId] || {})[streamId])return;
			m.repayment = {side: 'card', card: m.accountId, fundedFrom: found.links[m.accountId]};
			cards.push(m.repayment);
		});

		/* THEN ITS OTHER HALF, matched to a card leg of THIS stream rather than to any card the
		   account happens to fund. Three cards in the captured portfolio are paid from the same
		   current account, so "money out of a funding account" names none of them on its own. */
		answer.modes.forEach(m => {
			if(m.repayment || m.direction !== 'out')return;
			const mate = cards.filter(c => c.fundedFrom === m.accountId)[0];
			if(mate)m.repayment = {side: 'funding', card: mate.card, fundedFrom: m.accountId};
		});
		return answer;
	}

	/* §3 CONSUMES §2's ANSWER, never the declaration directly. A stream that declared yearly and was
	   read as monthly is shaped monthly, and one still yearly after §2 is not shaped at all. */
	/* ---- THE ANSWER --------------------------------------------------------------------------
	   A STREAM IS A LIST OF MODES, each one promise about one pile of money. The cycle travels with
	   it because a day means nothing without the rhythm it is a day of. */
	shapeOf(streamId, stream){
		const node = stream || this.streamById(streamId);
		const read = () => {
			const cycle = cycleFrom(this.cycleOf(streamId, node));
			const window = legsInWindow(this.legsOf(streamId), this.analysisAnchor());
			return this.labelRepayments(determineShape(window, this.partitionOf(streamId), cycle,
				this.analysisAnchor(),
				{country: this.userCountry(), offsetHours: this.userTimezoneOffset(),
					now: this.analysisNow()}), streamId);
		};
		if(!this.cacheable(streamId, stream))return read();
		if(this._shapes[streamId] === undefined)this._shapes[streamId] = read();
		return this._shapes[streamId];
	}

	/* ---- THE ANSWER THE REST OF THE APP ASKS FOR ---------------------------------------------
	   EVERY MONEY EVENT THIS STREAM IS EXPECTED TO PRODUCE BETWEEN ITS NEXT CYCLE AND `until`, as a
	   flat list ordered by the date the money actually moves. This is the module's last function:
	   §1 found the accounts, §2 the rhythm, §3 the shape, §4 the amount, and this places them on a
	   calendar for as far ahead as the caller asks.

	   THE HORIZON IS THE CALLER'S QUESTION, not this module's. A balance projection to the end of
	   the month and one to the end of the year are the same call with a different date. */
	scheduleOf(streamId, until, stream, opts, cfg){
		const node = stream || this.terminalStreams().find(s => s.id === streamId);
		/* THE CAPTURE'S DATE IS THE DEFAULT asOf, never the wall clock: a ledger stops on the day it
		   was taken, and reading it against today invents a gap of unphotographed transactions. */
		return streamSchedule(this, streamId, node, until,
			Object.assign({country: this.userCountry(), asOf: this.analysisNow()}, opts || {}), cfg);
	}

	/* EVERY STREAM'S EVENTS, MERGED AND ORDERED. A balance moves for reasons spread across many
	   streams, and re-sorting them is the caller's first act every time; doing it here means the
	   ordering rule lives in one place. */
	scheduleAll(until, opts, cfg){
		const out = [];
		this.reviewable().forEach(s => {
			const one = this.scheduleOf(s.id, until, s, opts, cfg);
			one.events.forEach(e => out.push(Object.assign({streamId: s.id,
				streamName: s.name}, e)));
		});
		return out.sort((a, b) => a.date - b.date
			|| (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
	}

	/* ---- THE WORKING ------------------------------------------------------------------------
	   THE SAME READING WITH EVERYTHING IT LOOKED AT STILL ATTACHED, which is what the bench page is
	   drawn from. Nothing downstream of this module should read it.

	   THE TAPER IS AN ARGUMENT HERE AND NOWHERE ELSE, because the bench asks the same stream the same
	   question at several half-lives and lays the answers side by side. Left out, the configured
	   setting applies - the same rule the anchor follows. */
	explainShapeOf(streamId, stream, taper){
		const node = stream || this.streamById(streamId);
		const read = () => {
			const cycle = cycleFrom(this.cycleOf(streamId, node));
			const window = legsInWindow(this.legsOf(streamId), this.analysisAnchor());
			return Object.assign({cycle: cycle},
				explainShape(window, this.partitionOf(streamId), cycle, this.analysisAnchor(),
					{country: this.userCountry(), offsetHours: this.userTimezoneOffset(),
						now: this.analysisNow(), taper: taper}));
		};
		//the taper is part of the question, and the bench asks the same stream at several half-lives
		if(taper !== undefined || !this.cacheable(streamId, stream))return read();
		if(this._explained[streamId] === undefined)this._explained[streamId] = read();
		return this._explained[streamId];
	}

	/* ---- STAGES 2-4 ATTACH HERE -------------------------------------------------------------------
	   §2 cycle determination, §3 shape determination and §4 amount prediction live in their own files
	   (cycleDetermination.js, shapeDetermination.js, modeAmounts.js) and are composed from this
	   object: each takes a stream's legs, its declaration and this object's `analysisAnchor()`, and
	   hands back a decision. Nothing above this line knows they exist, which is what keeps §1
	   checkable on its own. */
}

export default StreamPredictor;
