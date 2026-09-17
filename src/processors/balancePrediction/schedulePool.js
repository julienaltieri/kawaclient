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

let pool = null;         //[{worker, warmKey, seq}], built once, lazily, on the first real call
let building = null;     //the in-flight build, so two calls that race to be first share one pool

/* THE DYNAMIC IMPORT IS THE GUARD. See workerFactory.js's own header - `typeof Worker ===
   'undefined'` is checked and returned on BEFORE the `import()` line ever runs, so Jest (which has
   no global `Worker`) never has to load, parse or transpile a file containing `import.meta`. */
function ensurePool(){
	if(pool)return Promise.resolve(pool);
	if(building)return building;
	if(typeof Worker === 'undefined')return Promise.resolve(null);
	building = import('./workerFactory').then(mod => {
		const make = mod.makeScheduleWorker || mod.default;
		const n = poolSize();
		const built = [];
		for(let i = 0; i < n; i++)built.push({worker: make(), warmKey: null, seq: 0});
		pool = built;
		return pool;
	}).catch(() => {
		//a browser that cannot construct a module worker (or blocks it, e.g. some sandboxed test
		//runners) gets the same fallback as one with no Worker at all
		pool = null;
		return null;
	}).finally(() => {building = null;});
	return building;
}

/* EVERY STREAM'S SCHEDULE, MERGED. `key` names the portfolio capture and the `asOf` the answers are
   good for - see the header on scheduleWorker.js for why a worker only needs the portfolio resent
   when this changes. Resolves `null` (never rejects) when no pool could be built, so the caller's own
   fallback decides what happens next; a single worker's own failure DOES reject, because that failure
   is about the data, not about workers being unavailable. */
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
			const onMessage = e => {
				if(!e.data || e.data.reqId !== reqId)return;
				entry.worker.removeEventListener('message', onMessage);
				entry.worker.removeEventListener('error', onError);
				if(e.data.error)reject(new Error(e.data.error));
				else resolve(e.data.results || {});
			};
			const onError = err => {
				entry.worker.removeEventListener('message', onMessage);
				entry.worker.removeEventListener('error', onError);
				reject(err);
			};
			entry.worker.addEventListener('message', onMessage);
			entry.worker.addEventListener('error', onError);
			entry.worker.postMessage({
				reqId: reqId, streamIds: ids, until: untilMs, asOf: asOfMs, opts: opts || {}, key: key,
				portfolio: needsPortfolio ? portfolio : null
			});
		});
	});

	const parts = await Promise.all(calls);
	return Object.assign({}, ...parts);
}

//test-only: drop the pool so a suite that stubs `Worker` differently starts clean
export function _resetPoolForTests(){pool = null;}

export default scheduleParallel;
