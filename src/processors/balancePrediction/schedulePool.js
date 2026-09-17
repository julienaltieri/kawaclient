/* ==================================================================================================
   THE POOL: a small, long-lived set of `scheduleWorker`s that split one window's streams between
   them and stay alive for the rest of the page, so only the FIRST forecast pays a worker's own
   startup cost.

   NO WORKER, NO PROBLEM. `Worker` does not exist under Jest/node, and may not exist in every browser
   this runs in either. `scheduleParallel()` returns `null` rather than throwing when a pool cannot be
   built, and every caller (`accountLedgersAsync`) is written to fall back to the ordinary synchronous
   loop on that signal - so this file is additive: nothing downstream breaks if it never runs.

   THE SAME STREAM ALWAYS GOES TO THE SAME WORKER, by `id` rather than by array position - a stream
   list built in a different order (a different `inScope()` filter, a different window) still lands
   on the worker that already has its §2/§3 answers warm. */

/* RAISED FROM 4 TO 16. Sixty-odd streams over sixteen workers is under four each - past the point
   where more threads shorten the slowest worker's own queue by much - so this is not a change that
   pays for itself on the stream count measured so far; it only matters on a machine with enough real
   cores AND a portfolio with enough streams that four each was still the bottleneck. Left high
   because `poolSize()` never asks for more than `hardwareConcurrency - 1` anyway - a caller on a
   4-core laptop still gets 3 workers, same as before; this only changes what a 16+ core machine is
   allowed to use. */
/* ---- THE POOL IS OFF, AND THIS IS THE WHOLE SWITCH ----------------------------------------------
   TURN IT BACK ON ONLY WITH A MEASUREMENT IN HAND. It was built to move ~600ms of schedule work off
   the main thread and it never earned its place:

     IT IS BROKEN IN DEVELOPMENT, structurally. `react-scripts start` injects the react-refresh
     runtime into every chunk, including this worker's, and a worker cannot importScripts it:
       "Failed to execute 'importScripts' on 'WorkerGlobalScope': the script at
        .../vendors-node_modules_pmmmwh_react-refresh-webpack-plugin_...chunk.js failed to load"
     Silencing that needs FAST_REFRESH=false for the whole app, or a webpack config CRA does not
     expose without ejecting. So the environment the app is actually worked in cannot run it.

     NO TEST CAN EXERCISE IT. jsdom has no `Worker`, so every test in the suite takes the fallback
     path below. The pool has never been executed by anything except a browser, by hand.

     IT BOUGHT NOTHING MEASURABLE. Reported from the device it was built for: "on my phone it didn't
     change much" - a phone has few cores and mobile browsers throttle workers regardless.

     AND IT COST THE ONE THING THAT MATTERS. With no timeout, a worker that never answered left
     `Promise.all` pending for ever, so the module's forecast never arrived and the tile drew the
     LEGACY model in silence for the rest of the session - swapping a forecast measured at +30.5% on
     the card for one measured at -530.7%, with no error anywhere. See documentation/bank-balance.md.

   WHAT IS NOT LOST BY TURNING IT OFF: the tile still paints immediately instead of blocking, because
   that came from making the forecast ASYNCHRONOUS, not from where it runs - `accountLedgersAsync`
   computes on this thread whenever there is no pool, which is exactly this path. The timeouts below
   stay, because they are what makes any future attempt survivable. */
const POOL_ENABLED = false;

const MAX_WORKERS = 16;

const poolSize = () => {
	const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || MAX_WORKERS;
	return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
};

//a simple, stable string hash - not for security, only so a stream id spreads evenly over the pool
const bucketOf = (id, n) => {
	let h = 0;
	const s = String(id);
	for(let i = 0; i < s.length; i++)h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h) % n;
};

/* HOW LONG A WORKER MAY TAKE BEFORE IT IS PRESUMED LOST. The whole point of the pool is to beat
   ~600ms of main-thread work, so anything past a few seconds has already failed at its job; what
   matters is that it fails LOUDLY and hands the work back rather than leaving a promise pending.

   A SILENT HANG IS THE WORST OUTCOME THIS FILE CAN PRODUCE, and it is the one it produced. A worker
   that never answered - never resolving, never firing `error` - left `Promise.all` waiting for ever,
   so `benchForecastAsync` never settled, so `moduleRun`'s cache entry stayed null, so the tile drew
   the LEGACY line (measured at -530.7% on the card against the module's 30.5%) indefinitely, with
   nothing anywhere saying why. It looked like a wrong number in the forecast; it was a forecast that
   never arrived. */
/* BOTH WAITS ARE BOUNDED, because either can hang. A healthy worker is built in tens of
   milliseconds and answers its share of sixty streams in a couple of hundred; anything past these is
   already slower than doing the work here, and the only thing that matters then is that it hands the
   work BACK. The main-thread fallback costs about 600ms - so waiting seconds for a worker to maybe
   answer is the worse trade, which is why these are tight rather than generous. */
const ANSWER_TIMEOUT = 2500;
const POOL_TIMEOUT = 1500;

/* A PROMISE THAT CANNOT OUTLIVE ITS DEADLINE. `fallback` is what the caller gets if the clock wins -
   never a rejection, because every caller here treats "no pool" as "do it yourself". */
const within = (p, ms, fallback, note) => new Promise(resolve => {
	let done = false;
	const finish = v => {if(!done){done = true; resolve(v)}};
	const timer = setTimeout(() => {
		if(typeof console !== "undefined" && console.warn)console.warn("schedulePool: " + note);
		finish(fallback);
	}, ms);
	p.then(v => {clearTimeout(timer); finish(v)}, () => {clearTimeout(timer); finish(fallback)});
});

let pool = null;         //[{worker, warmKey, seq}], built once, lazily, on the first real call
let building = null;     //the in-flight build, so two calls that race to be first share one pool
let retired = false;     //once the pool has let us down, stop asking it - see retirePool()

/* A POOL THAT HAS FAILED ONCE IS NOT ASKED AGAIN. Every later call would pay the same timeout before
   falling back, turning one lost worker into a permanent tax on every forecast. */
function retirePool(why){
	retired = true;
	(pool || []).forEach(e => {try{e.worker.terminate()}catch(err){}});
	pool = null;
	if(typeof console !== "undefined" && console.warn)
		console.warn("schedulePool: falling back to the main thread for the rest of this session -",
			why);
}

/* THE DYNAMIC IMPORT IS THE GUARD. See workerFactory.js's own header - `typeof Worker ===
   'undefined'` is checked and returned on BEFORE the `import()` line ever runs, so Jest (which has
   no global `Worker`) never has to load, parse or transpile a file containing `import.meta`. */
function ensurePool(){
	if(!POOL_ENABLED)return Promise.resolve(null);     //see the switch's own header, above
	if(retired)return Promise.resolve(null);
	if(pool)return Promise.resolve(pool);
	if(building)return building;
	if(typeof Worker === 'undefined')return Promise.resolve(null);
	/* THE CHUNK FETCH IS A NETWORK REQUEST and can hang as easily as a worker can. Bounded, so a
	   stalled chunk costs POOL_TIMEOUT once rather than wedging every forecast for the session. */
	building = within(import('./workerFactory').then(mod => {
		const make = mod.makeScheduleWorker || mod.default;
		const n = poolSize();
		const built = [];
		for(let i = 0; i < n; i++)built.push({worker: make(), warmKey: null, seq: 0});
		pool = built;
		return pool;
	}), POOL_TIMEOUT, null, "the worker chunk did not load in " + POOL_TIMEOUT + "ms")
		.then(p => {
			//a browser that cannot construct a module worker (or blocks it, or never answers) gets
			//the same fallback as one with no Worker at all - and is not asked twice
			if(!p)retirePool("the pool could not be built");
			building = null;
			return p;
		});
	return building;
}

/* EVERY STREAM'S SCHEDULE, MERGED. `key` names the portfolio capture and the `asOf` the answers are
   good for - see the header on scheduleWorker.js for why a worker only needs the portfolio resent
   when this changes.

   IT RESOLVES `null` AND NEVER REJECTS. No pool, a worker that errored, a worker that never answered,
   a portfolio the structured clone refused - all of them mean the same thing to the caller: compute
   the schedules on this thread instead. Rejecting would take the whole forecast down with the pool,
   and a forecast that never arrives is how the tile ended up drawing the legacy model in silence. */
export async function scheduleParallel(portfolio, streamIds, until, asOf, opts, key){
	const workers = await ensurePool();
	if(!workers || !streamIds || !streamIds.length)return null;

	const n = workers.length;
	const buckets = Array.from({length: n}, () => []);
	streamIds.forEach(id => buckets[bucketOf(id, n)].push(id));

	const untilMs = new Date(until).getTime(), asOfMs = new Date(asOf).getTime();
	const calls = workers.map((entry, i) => {
		const ids = buckets[i];
		if(!ids.length)return Promise.resolve({});
		const needsPortfolio = entry.warmKey !== key;
		entry.warmKey = key;
		const reqId = ++entry.seq;
		return new Promise((resolve, reject) => {
			/* THE TIMEOUT IS THE ONLY THING THAT MAKES A LOST WORKER SURVIVABLE. A worker that fails
			   to load, or is killed by the browser, or simply never gets to our message, fires no
			   `error` anyone can hear - see ANSWER_TIMEOUT. Without it this promise never settles and
			   neither does anything waiting on it.

			   ONE SETTLE, WHICHEVER ARRIVES FIRST: the answer, an error, or the clock. `settled`
			   guards it because all three can still fire after the first one has. */
			let settled = false;
			const finish = (fn, v) => {
				if(settled)return;
				settled = true;
				clearTimeout(timer);
				entry.worker.removeEventListener('message', onMessage);
				entry.worker.removeEventListener('error', onError);
				fn(v);
			};
			const onMessage = e => {
				if(!e.data || e.data.reqId !== reqId)return;
				if(e.data.error)finish(reject, new Error(e.data.error));
				else finish(resolve, e.data.results || {});
			};
			const onError = err => finish(reject, err);
			const timer = setTimeout(() => {
				entry.warmKey = null;                 //it may not hold what we think it holds
				onError(new Error("worker " + i + " did not answer in " + ANSWER_TIMEOUT + "ms"));
			}, ANSWER_TIMEOUT);
			entry.worker.addEventListener('message', onMessage);
			entry.worker.addEventListener('error', onError);
			try{
				entry.worker.postMessage({
					reqId: reqId, streamIds: ids, until: untilMs, asOf: asOfMs, opts: opts || {},
					key: key, portfolio: needsPortfolio ? portfolio : null
				});
			}catch(err){
				//a portfolio the structured clone refuses is a failure of this pool, not of the data
				entry.warmKey = null;
				onError(err);
			}
		});
	});

	/* ANY FAILURE HERE IS A FALLBACK, NEVER A REJECTION. `null` tells the caller to compute the
	   schedules on this thread instead - slower, and correct. Rejecting would take the forecast down
	   with the pool, which is the outcome this whole file exists to avoid. */
	try{
		const parts = await Promise.all(calls);
		return Object.assign({}, ...parts);
	}catch(err){
		retirePool((err && err.message) || String(err));
		return null;
	}
}

//test-only: drop the pool so a suite that stubs `Worker` differently starts clean
export function _resetPoolForTests(){pool = null;}

export default scheduleParallel;
