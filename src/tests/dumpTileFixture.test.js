/* ==================================================================================================
   WRITES THE MODULE'S OWN OUTPUT TO A FIXTURE.

   THIS IS THE CONTRACT THE TILE CONSUMES, not a picture of it. `accountLedgers` hands back one entry
   per account - the anchor it is pinned to, the ledger of what happened and what is expected, and the
   balance at every date it changes - and everything a tile draws is a slice of that. A fixture taken
   from the drawn series instead would freeze one component's reading of the contract, and a UI built
   on it could only ever reproduce that component.

   SO THE RENDERER STAYS DUMB. Whatever reads this file does no forecasting, no modelling and no
   arithmetic beyond picking a window: if a number is not in here, the module did not say it.

   IT CARRIES REAL NAMES AND AMOUNTS, so it lands in src/tests/fixtures/, which .gitignore excludes by
   name for that reason.

   RUN IT when the fixture is stale:  npx react-scripts test --testPathPattern dumpTileFixture
   ================================================================================================== */
import fs from 'fs';
import path from 'path';
import {accountLedgers} from '../processors/balancePrediction/accountLedger';
import {calibrate} from '../processors/balancePrediction/calibration';
import {withLoop} from '../processors/balancePrediction/inCycle';
import {StreamPredictor} from '../processors/streamPredictor';

const IN = path.join(__dirname, 'fixtures', 'portfolio.json');
const OUT = path.join(__dirname, 'fixtures', 'balance.json');
const DAY = 24 * 60 * 60 * 1000;

//how much history the fixture carries. The tile shows a month; a few months lets a lab scroll back.
const DAYS_BACK = 200;

const has = fs.existsSync(IN);
(has ? test : test.skip)('writes balance.json — the module output, verbatim', () => {
	const portfolio = JSON.parse(fs.readFileSync(IN, 'utf8'));
	const predictor = new StreamPredictor(portfolio);
	const asOf = new Date(predictor.analysisNow());
	const seamDay = new Date(predictor.analysisAnchor()).getDate();
	const until = new Date(asOf.getTime() + 95 * DAY);

	//the same two passes the module runs anywhere: measure the correction, then build with it
	const plain = accountLedgers(portfolio, until, {predictor: predictor});
	const calibration = withLoop(plain, calibrate(plain, {seamDay: seamDay}), {seamDay: seamDay});
	const built = accountLedgers(portfolio, until,
		{predictor: predictor, calibration: calibration});

	const floor = asOf.getTime() - DAYS_BACK * DAY;
	const n = v => (v === undefined || v === null) ? null : Math.round(v * 100) / 100;
	const entry = e => {
		const out = {t: e.date.getTime(), a: n(e.amount), src: e.source};
		if(e.label)out.w = e.label;
		if(e.streamName)out.s = e.streamName;
		if(e.streamId)out.id = e.streamId;
		if(e.kind)out.k = e.kind;
		if(e.covered !== undefined)out.c = e.covered ? 1 : 0;
		if(e.repayment)out.rp = 1;
		if(e.refused)out.no = e.refused;
		if(e.silence)out.why = e.silence;
		if(e.uncalibrated !== undefined)out.raw = n(e.uncalibrated);
		if(e.closes)out.closes = e.closes.getTime();
		if(e.confidence)out.conf = n(e.confidence);
		return out;
	};

	const out = {
		builtAt: new Date().toISOString(),
		asOf: built.asOf.getTime(),
		until: built.until.getTime(),
		daysBack: DAYS_BACK,
		streams: built.streams,
		reviewable: built.reviewable,
		events: built.events,
		links: built.links,
		calibration: Object.keys(calibration).reduce((m, id) => {
			const k = calibration[id];
			m[id] = {a: n(k.multiplier), b: n(k.loop ? k.loop.factor : 1), cut: n(k.cut),
				cycles: k.cycles || null, reason: k.reason || null,
				elapsed: n(k.loop ? k.loop.elapsed : null)};
			return m;
		}, {}),
		settlements: Object.keys(built.settlements).reduce((m, card) => {
			const p = built.settlements[card];
			m[card] = {fundedFrom: p.fundedFrom, offset: p.offset, fitError: n(p.fitError),
				pending: n(p.pending),
				settlements: p.settlements.map(x => ({t: x.date.getTime(),
					closes: x.close.getTime(), a: n(x.amount)}))};
			return m;
		}, {}),
		accounts: built.accounts.map(a => ({
			id: a.accountId,
			name: a.name,
			mask: a.mask,
			kind: a.accountType,
			reported: a.reported ? n(a.reported.current) : null,
			anchor: a.anchor ? {balance: n(a.anchor.balance), at: a.anchor.at.getTime(),
				flipped: !!a.anchor.flipped, source: a.anchor.source} : null,
			opening: n(a.opening),
			closing: n(a.closing),
			sameDay: a.sameDay || 0,
			points: a.points.filter(p => p.date.getTime() >= floor)
				.map(p => ({t: p.date.getTime(), v: n(p.balance)})),
			ledger: a.ledger.filter(e => e.date.getTime() >= floor).map(entry),
			setAside: a.setAside.map(entry)
		}))
	};

	fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');
	const kb = Math.round(fs.statSync(OUT).size / 1024);
	console.log('F balance.json ' + kb + ' KB   asOf ' + new Date(out.asOf).toISOString().slice(0, 10)
		+ ' -> ' + new Date(out.until).toISOString().slice(0, 10));
	out.accounts.forEach(a => console.log('F   ' + (a.name || a.id).slice(0, 26).padEnd(27)
		+ a.kind.padEnd(10) + String(a.points.length).padStart(4) + ' points  '
		+ String(a.ledger.length).padStart(4) + ' entries  anchor '
		+ (a.anchor ? a.anchor.balance : '-')));
	expect(out.accounts.length).toBeGreaterThan(1);
}, 600000);
