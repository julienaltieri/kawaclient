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

import {streamLedger, terminalStreams, mapAccounts} from './accountMapping';

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

	/* ---- STAGES 2-4 ATTACH HERE -------------------------------------------------------------------
	   §2 cycle determination, §3 shape determination and §4 amount prediction live in their own files
	   (cycleDetermination.js, shapeDetermination.js, amountPrediction.js) and are composed from this
	   object: each takes a stream's legs and its declaration and hands back a decision. Nothing above
	   this line knows they exist, which is what keeps §1 checkable on its own. */
}

export default StreamPredictor;
