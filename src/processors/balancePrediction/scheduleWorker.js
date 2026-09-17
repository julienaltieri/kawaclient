/* ==================================================================================================
   ONE STREAM'S SCHEDULE, OFF THE MAIN THREAD.

   THE ONLY THING THIS FILE DOES is `predictor.scheduleOf()` for a batch of stream ids - the loop in
   `accountLedgers()` that costs ~9.5ms/stream cold (cycle detection, shape detection, amount staging,
   all real work - see the analysis in documentation/bank-balance.md). Every stream's schedule depends
   only on the portfolio and its own id, never on another stream's answer, so splitting the batch
   across workers is exact, not approximate: the merged result is identical to running every id on one
   thread, just sooner.

   A WARM PREDICTOR, KEPT BETWEEN MESSAGES. The main thread runs the SAME window's schedule twice per
   forecast - once to measure the calibration, once to apply it (see cachedBuild() in
   benchForecast.js) - and rebuilding a `StreamPredictor` for the second call would throw away the
   §2/§3 memoisation the whole point of the pool is to keep. `key` names the portfolio capture and the
   `asOf` this worker last built for; a caller only pays to resend the (large) portfolio JSON when
   that identity changes, and can otherwise send just the ids and dates. */

import {StreamPredictor} from '../streamPredictor';

let warm = {key: null, predictor: null};

// eslint-disable-next-line no-restricted-globals
const ctx = self;

ctx.onmessage = e => {
	const msg = e.data || {};
	const reqId = msg.reqId;
	try{
		if(msg.portfolio)warm = {key: msg.key, predictor: new StreamPredictor(msg.portfolio)};
		if(!warm.predictor || warm.key !== msg.key){
			throw new Error('scheduleWorker: no portfolio cached for this key yet - '
				+ 'the caller must send it once per identity');
		}
		const predictor = warm.predictor;
		const until = new Date(msg.until);
		const asOf = new Date(msg.asOf);
		const opts = Object.assign({}, msg.opts || {}, {asOf: asOf});
		const results = {};
		(msg.streamIds || []).forEach(id => {
			const node = predictor.streamById(id);
			results[id] = predictor.scheduleOf(id, until, node, opts);
		});
		ctx.postMessage({reqId: reqId, results: results});
	}catch(err){
		ctx.postMessage({reqId: reqId, error: (err && err.message) || String(err)});
	}
};
