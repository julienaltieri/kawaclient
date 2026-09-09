/**
 * portfolioFixture.js — the real portfolio, held still.
 *
 * WHY A FILE AND NOT A HAND-BUILT FIXTURE. Every algorithm change so far has been argued from a row
 * pasted into a chat: one stream, one month, and no way to re-run it after the next change. The model
 * is a pure function of five things — the master stream, the transactions, the accounts, the stored
 * balances and the as-of date — so a file holding those five can be replayed against any future
 * version, and the difference between two runs IS the change.
 *
 * Hand-built fixtures stay necessary and are not replaced by this. They isolate one mechanism and say
 * what it must do; this says what eighty-seven real streams actually do, which is the thing that keeps
 * surprising us. A rule that passes its own test and loses four points on the real portfolio has been
 * caught by exactly one of the two.
 *
 * HOW TO CAPTURE ONE. Open the bench, press "Save fixture", and drop the file in `src/tests/fixtures/`
 * as `portfolio.json`. It is gitignored by default — it is your ledger, and it does not belong in a
 * repository — so every test that reads it must SKIP when it is absent rather than fail. A suite that
 * goes red on a machine without the file is a suite nobody else can run.
 */

let cached;

//the fixture as captured, or null where nobody has saved one
export function loadPortfolio(){
	if(cached !== undefined)return cached;
	try{
		//eslint-disable-next-line global-require
		cached = require('./fixtures/portfolio.json');
	}catch(e){
		cached = null;
	}
	return cached;
}

export const hasPortfolio = () => !!loadPortfolio();

/* Dates arrive as ISO strings and every consumer expects Date objects. Rehydrated here rather than in
   each test, so a test reads the same shape the app holds. */
export function portfolioInputs(overrides){
	const f = loadPortfolio();
	if(!f)return null;
	const txns = (f.transactions || []).map(t => Object.assign({}, t, {
		date: new Date(t.date),
		frontendDate: t.frontendDate ? new Date(t.frontendDate) : undefined
	}));
	const asOf = new Date(f.today);
	return Object.assign({
		transactions: txns,
		accounts: f.accounts || [],
		remembered: f.remembered || [],
		masterStreamJson: f.masterStream,
		userPreferences: f.userPreferences || {},
		accountTypes: f.accountTypes || {},
		settlementDay: f.settlementDay,
		asOf: asOf
	}, overrides || {});
}

/* `describe` that runs only where a fixture exists. Named so a skipped run says WHY in the output
   rather than looking like a suite somebody disabled. */
export const describeWithPortfolio = (name, fn) =>
	(hasPortfolio() ? describe : describe.skip)(name + " [needs src/tests/fixtures/portfolio.json]", fn);
