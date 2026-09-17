/* ==================================================================================================
   THE CARD REPAYMENT, SHOWING ITS WORKING - on THIS portfolio, today.

   WHY A PAGE AND NOT A TEST. The forecast said $4,645 for the next repayment and the issuer's own
   app said $4,378.03. No fixture contains that: a fixture is a photograph of a day that has already
   passed, and the disagreement is about today. So the instrument goes where the real transactions
   already are - the sandbox - and puts the model's own windows, charge by charge, next to a number
   the reader can read off their bank.

   IT ASKS THE READER FOR THE TRUTH rather than guessing it. Type what the bank actually says the
   next repayment will be, and the gap stops being a mystery and becomes a search: which single
   charge, or which pair, is exactly that size. The instrument never decides a charge is wrong - it
   narrows the question to the two or three a person can then check against their statement.

   EVERY NUMBER HERE IS THE MODEL'S OWN. See repaymentProbe.js: the windows come from
   settlement.js's own `settlementsFor`, and each window's members are read back through the same
   predicate its sum used. `check` is printed beside `amount` for exactly that reason - if the
   listing and the arithmetic ever disagree, this says so instead of being believed.
   ================================================================================================== */

import React from 'react';
import BaseComponent from './BaseComponent';
import Core from '../core.js';
import DS from '../DesignSystem.js';
import {AccountTypes} from '../Bank';
import {capturePortfolio} from '../processors/capturePortfolio.js';
import {accountLedgers} from '../processors/balancePrediction/accountLedger';
import {benchForecast} from '../processors/balancePrediction/benchForecast';
import {repaymentProbe, reconcile} from '../processors/balancePrediction/repaymentProbe';
import {calendarDay} from '../processors/streamPredictor/businessCalendar.js';

const DAY = 24*60*60*1000;
const money = v => (v < 0 ? "-" : "") + "$" + Math.abs(v).toLocaleString(undefined,
	{minimumFractionDigits: 2, maximumFractionDigits: 2});
const day = d => d ? new Date(d).toISOString().slice(0, 10) : "-";

const mono = {fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
	fontSize: DS.fontSize.little + "rem"};

export default class CardRepaymentProbe extends BaseComponent{
	constructor(props){
		super(props);
		//`truth` is what the reader reads off their bank, per card - see the header
		this.state = {accounts: null, error: null, truth: {}, showAll: {}};
	}
	componentDidMount(){
		Core.getAccountsWithBalances()
			.then(a => this.updateState({accounts: a || []}))
			.catch(e => this.updateState({accounts: [], error: String(e && e.message || e)}));
	}

	/* THE SAME THREE INPUTS THE TILE BUILDS ITS PORTFOLIO FROM - see BalanceChart's own
	   `ledgerToday`, `creditHashes` and `settlementDay`. Not similar ones: `capturePortfolio`
	   memoises on exactly these, so matching them means this reads the very object the tile read,
	   and a discrepancy found here is a discrepancy in what the tile drew rather than in a
	   near-miss rebuilt beside it. */
	timezoneOffset(){
		const ud = Core.getUserData();
		const v = ud && ud.timeZoneOffset;
		return typeof v === 'number' ? v : 0;
	}
	today(){return calendarDay(new Date(), this.timezoneOffset())}
	creditHashes(){
		return (this.state.accounts || [])
			.filter(a => Core.accountTypeOf(a) === AccountTypes.credit).map(a => a.hash);
	}
	//the tile's own `spendingHashes()`: what the default "Checking balance" reading actually covers
	checkingHashes(){
		return (this.state.accounts || [])
			.filter(a => Core.accountTypeOf(a) !== AccountTypes.credit && a.current !== undefined)
			.filter(a => Core.accountTypeOf(a) === AccountTypes.checking)
			.map(a => a.hash);
	}
	settlementDay(){
		const cards = this.creditHashes();
		if(!cards.length)return undefined;
		const byDay = new Array(32).fill(0);
		(this.props.transactions || []).forEach(t => {
			if(cards.indexOf(t.userInstitutionAccountId) < 0)return;
			if(t.amount <= 0)return;
			byDay[t.date.getUTCDate()] += t.amount;
		});
		let best = 0, d;
		byDay.forEach((v, i) => {if(v > best){best = v; d = i}});
		return d;
	}

	/* ONE BUILD, CACHED ON THE INPUTS. The ledger build is the expensive half (see accountLedger.js)
	   and a re-render - typing a number into the truth box, opening a window - must not pay for it
	   again. */
	probe(){
		const accounts = this.state.accounts;
		if(!accounts)return null;
		const key = (this.props.transactions || []).length + "|" + accounts.length;
		if(this._probeKey === key)return this._probe;
		try{
			const today = this.today();
			const portfolio = capturePortfolio(this.props.transactions, accounts,
				{today: today, cards: this.creditHashes(), settlementDay: this.settlementDay()});
			//far enough ahead to hold the next couple of repayments, whatever their cadence
			const built = accountLedgers(portfolio, new Date(today.getTime() + 60*DAY),
				{asOf: today});
			this._portfolio = portfolio;
			this._probe = repaymentProbe(portfolio, built, {asOf: today});
		}catch(e){
			this._probe = {failed: (e && e.message) || String(e), stack: e && e.stack};
		}
		this._probeKey = key;
		return this._probe;
	}

	/* ---- AND WHAT THE TILE ITSELF WILL DRAW THAT DAY -----------------------------------------------
	   THE SETTLEMENT IS NOT THE ONLY THING THAT LANDS ON A DAY. `cardSettlements()` answers one
	   question - what the card is owed - and the tile draws another: everything that moves the
	   CHECKING balance on that date, of which the repayment is one row. A day carrying the repayment
	   AND an ordinary predicted outflow steps by their sum, and the caption names that step after its
	   biggest contributor - so a step of $4,645 can read as "Card repayment" while the repayment
	   inside it is $4,378.03 and perfectly correct.

	   This runs the tile's OWN call - benchForecast, same asOf, same horizon, same covered set as
	   BalanceChart's moduleRun() - and lists what it puts on that date, row by row. If the repayment
	   row here matches the settlement above, the arithmetic was never the problem and the difference
	   is the company it keeps. */
	tileDay(card){
		if(!card.future.length || !this._portfolio)return null;
		const key = card.card + "|" + card.future[0].date.getTime();
		this._tile = this._tile || {};
		if(this._tile[key] !== undefined)return this._tile[key];
		try{
			const today = this.today();
			//HALF = 15 days either side of the window's centre, exactly as BalanceChart computes it
			const until = new Date(today.getTime() + 15*DAY);
			const checking = this.checkingHashes();
			const run = benchForecast(this._portfolio, today, until, checking, {});
			const k = new Date(card.future[0].date).toISOString().slice(0, 10);
			this._tile[key] = {
				day: k,
				covered: checking,
				flow: run.flow[k],
				rows: (run.rows[k] || []).slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
			};
		}catch(e){
			this._tile[key] = {failed: (e && e.message) || String(e)};
		}
		return this._tile[key];
	}

	/* ---- rendering ------------------------------------------------------------------------------ */
	renderMembers(members, highlight){
		const S = DS.getStyle();
		return <table style={{...mono, width: "100%", borderCollapse: "collapse"}}>
			<tbody>
				{members.map((m, i) => {
					const hit = highlight && highlight.indexOf(m) > -1;
					return <tr key={i} style={{
							color: hit ? S.alert : (m.predicted ? S.bodyTextSecondary : S.bodyText),
							fontWeight: hit ? 600 : 400}}>
						<td style={{padding: "1px 6px 1px 0", whiteSpace: "nowrap"}}>{day(m.date)}</td>
						<td style={{padding: "1px 6px", textAlign: "right", whiteSpace: "nowrap"}}>
							{money(m.amount)}</td>
						<td style={{padding: "1px 6px", whiteSpace: "nowrap"}}>
							{m.predicted ? "predicted" : "posted"}</td>
						<td style={{padding: "1px 0", wordBreak: "break-word"}}>
							{m.label}{m.streamName ? " · " + m.streamName : ""}
							{hit ? "   <= exactly the gap" : ""}</td>
					</tr>;
				})}
				{members.length ? null : <tr><td style={{color: S.bodyTextSecondary}}>
					(no charges in this window)</td></tr>}
			</tbody>
		</table>;
	}

	renderPast(card){
		const S = DS.getStyle();
		const rows = card.past.slice().reverse();          //newest first, as the bank lists them
		const open = this.state.showAll[card.card + ":past"];
		const shown = open ? rows : rows.slice(0, 6);
		return <div>
			<div style={{...mono, color: S.bodyTextSecondary, marginBottom: "0.3rem"}}>
				every repayment that actually happened, against what the rule reproduces for it
			</div>
			<table style={{...mono, width: "100%", borderCollapse: "collapse"}}>
				<tbody>
					<tr style={{color: S.bodyTextSecondary}}>
						<td>paid on</td><td style={{textAlign: "right"}}>actual</td>
						<td style={{textAlign: "right"}}>modelled</td>
						<td style={{textAlign: "right"}}>error</td>
						<td style={{paddingLeft: "0.6rem"}}>window (close-exclusive .. close]</td>
						<td style={{textAlign: "right"}}>n</td><td/>
					</tr>
					{shown.map((p, i) => {
						const bad = Math.abs(p.error) > 0.005;
						const id = card.card + ":w:" + p.to.getTime();
						return <React.Fragment key={i}>
							<tr style={{color: bad ? S.alert : S.bodyText}}>
								<td style={{whiteSpace: "nowrap"}}>{day(p.date)}</td>
								<td style={{textAlign: "right", padding: "0 6px"}}>{money(p.actual)}</td>
								<td style={{textAlign: "right", padding: "0 6px"}}>{money(p.modelled)}</td>
								<td style={{textAlign: "right", padding: "0 6px"}}>{money(p.error)}</td>
								<td style={{paddingLeft: "0.6rem", whiteSpace: "nowrap"}}>
									{day(p.from)} .. {day(p.to)}</td>
								<td style={{textAlign: "right", padding: "0 6px"}}>{p.members.length}</td>
								<td><button type="button" style={{...mono, cursor: "pointer",
										background: "none", color: S.bodyTextSecondary,
										border: "1px dashed " + S.borderColor}}
									onClick={() => this.updateState({showAll: Object.assign({},
										this.state.showAll, {[id]: !this.state.showAll[id]})})}>
									{this.state.showAll[id] ? "hide" : "charges"}</button></td>
							</tr>
							{this.state.showAll[id] ? <tr><td colSpan={7}
								style={{padding: "0.2rem 0 0.6rem 1rem"}}>
								{this.renderMembers(p.members)}</td></tr> : null}
						</React.Fragment>;
					})}
				</tbody>
			</table>
			{rows.length > 6 ? <button type="button" style={{...mono, marginTop: "0.3rem",
					cursor: "pointer", background: "none", color: S.bodyTextSecondary,
					border: "1px dashed " + S.borderColor}}
				onClick={() => this.updateState({showAll: Object.assign({}, this.state.showAll,
					{[card.card + ":past"]: !open})})}>
				{open ? "show fewer" : "show all " + rows.length}</button> : null}
		</div>;
	}

	renderNext(card){
		const S = DS.getStyle();
		const next = card.future[0];
		if(!next)return <div style={{...mono, color: S.bodyTextSecondary}}>
			nothing scheduled ahead - the repaying stream predicted no further dates</div>;
		const typed = this.state.truth[card.card];
		const truth = parseFloat(String(typed || "").replace(/[^0-9.\-]/g, ""));
		const rec = isFinite(truth) ? reconcile(next.members, next.amount, truth) : null;
		const hits = rec ? rec.singles : [];
		return <div>
			<div style={{...mono, marginBottom: "0.4rem"}}>
				<b>next repayment {day(next.date)}</b> - the model says <b>{money(next.amount)}</b>
				{" "}over {next.members.length} charges in {day(next.from)} .. {day(next.to)}
				{Math.abs(next.amount - next.check) > 0.005
					? <span style={{color: S.alert}}> (LISTING DISAGREES WITH THE SUM:
						{" "}{money(next.check)} - this instrument is not to be trusted here)</span>
					: null}
			</div>
			<div style={{...mono, marginBottom: "0.5rem"}}>
				<span style={{color: S.bodyTextSecondary}}>what does your bank say it will be? </span>
				<input value={typed || ""} placeholder="4378.03"
					onChange={e => this.updateState({truth: Object.assign({}, this.state.truth,
						{[card.card]: e.target.value})})}
					style={{...mono, width: "8rem", padding: "0.15rem 0.4rem",
						background: S.inputFieldBackground, color: S.bodyText,
						border: "1px solid " + S.borderColor, borderRadius: DS.borderRadiusSmall}}/>
				{rec ? <span> gap <b style={{color: S.alert}}>{money(rec.gap)}</b>
					{rec.singles.length
						? <span> - <b>{rec.singles.length}</b> charge{rec.singles.length > 1 ? "s" : ""}
							{" "}of exactly that size, marked below</span>
						: rec.pairs.length
							? <span> - no single charge matches; {rec.pairs.length} PAIR(s) do:
								{" "}{rec.pairs.slice(0, 3).map((p, i) =>
									<span key={i}> [{day(p[0].date)} {money(p[0].amount)} +
									{" "}{day(p[1].date)} {money(p[1].amount)}]</span>)}</span>
							: <span> - no single charge and no pair matches it exactly</span>}
				</span> : null}
			</div>
			{this.renderMembers(next.members, hits)}
			{this.renderActualTile(card, next)}
			{this.renderTileDay(card, next)}
			{this.renderScan(card, isFinite(truth) ? truth : null)}
			{this.renderEdges(card)}
		</div>;
	}

	/* ---- THE TILE ITSELF, NOT A REBUILD OF IT -----------------------------------------------------
	   EVERY RECONSTRUCTION AGREED WITH THE BANK WHILE THE TILE DID NOT, which leaves one place the
	   difference can live: the instance actually drawing. So this reads it - its own series, its own
	   forecaster, its own day table - through the ref the sandbox hands over.

	   THE FIRST QUESTION IS WHICH FORECASTER IT USED. `moduleRun()` answers asynchronously now, and
	   `computeSeries()` falls back to the LEGACY model's line for as long as it has no answer - a
	   different calculation entirely, which reaches a card repayment through `cardRepaymentForecast`
	   and `extraFlow` rather than through §3. A tile still showing the legacy number is not a §3 bug
	   at all, and `a.liveRun` being null says so in one word. */
	renderActualTile(card, next){
		const S = DS.getStyle();
		const tile = this.props.tileRef && this.props.tileRef.current;
		if(!tile)return <div style={{...mono, color: S.bodyTextSecondary, marginTop: "0.7rem"}}>
			(no tile on the page to read)</div>;
		let a, err = null;
		try{a = tile.series()}catch(e){err = (e && e.message) || String(e)}
		if(err)return <div style={{...mono, color: S.alert, marginTop: "0.7rem"}}>
			reading the tile threw: {err}</div>;
		const k = new Date(next.date).toISOString().slice(0, 10);
		const idx = (a.future || []).map(p => new Date(p.date).toISOString().slice(0, 10)).indexOf(k);
		const pt = idx > -1 ? a.future[idx] : null;
		//the first future day steps from the last day of the RECORD, not from a future day before it
		const before = idx > 0 ? a.future[idx - 1]
			: (idx === 0 ? (a.past || [])[(a.past || []).length - 1] : null);
		const step = (pt && before) ? pt.value - before.value : null;
		const usingModule = !!a.liveRun;
		//exactly what the cursor shows when a finger lands on that day
		let audit = null;
		try{if(pt)audit = tile.dayAudit({date: pt.date, value: pt.value, actual: false})}catch(e){}
		return <div style={{marginTop: "0.8rem", paddingTop: "0.6rem",
				borderTop: "2px solid " + S.borderColor}}>
			<div style={{...mono, marginBottom: "0.3rem"}}>
				<b>THE TILE ON THIS PAGE, read from its own instance</b></div>
			<div style={{...mono, marginBottom: "0.4rem"}}>
				forecaster in use: <b style={{color: usingModule ? S.positive : S.alert}}>
					{usingModule ? "the module (a.liveRun present)"
						: "THE LEGACY MODEL - a.liveRun is null, so §3 is not what you are looking at"}</b>
				{/* WHY it is null, if the module was asked and threw - see moduleRun()'s catch */}
				{Object.keys(tile._runFailed || {}).length
					? <div style={{color: S.alert}}>the module's own run FAILED, which is why:
						{Object.keys(tile._runFailed).map(k =>
							<div key={k} style={{paddingLeft: "1rem"}}>{k}: {tile._runFailed[k]}</div>)}
					</div>
					: null}
				{!usingModule && !Object.keys(tile._runFailed || {}).length
					? <div style={{color: S.bodyTextSecondary}}>no failure recorded - so it is still in
						flight, or was never asked ({Object.keys(tile._runs || {}).length} run key(s),
						{" "}{Object.keys(tile._runPromises || {}).length} promise(s))</div>
					: null}
				<br/>
				reading <b>{tile.state.source || "(default)"}</b>, window <b>{tile.state.when}</b>
				{" "}· its step on {k} is <b style={{color: step !== null
						&& Math.abs(-step - next.amount) > 0.005 ? S.alert : S.bodyText}}>
					{step === null ? "(that day is not in its window)" : money(-step)}</b>
				{" "}· §3 says {money(next.amount)}
			</div>
			{usingModule && a.liveRun.rows
				? <div style={{...mono, marginBottom: "0.4rem", color: S.bodyTextSecondary}}>
					its own liveRun.flow[{k}] = {a.liveRun.flow[k] === undefined
						? "(nothing)" : money(-a.liveRun.flow[k])}
					{" "}over {(a.liveRun.rows[k] || []).length} row(s)</div>
				: null}
			{!usingModule && a.live && a.live.extraFlow
				? <div style={{marginBottom: "0.4rem"}}>
					<div style={{...mono, color: S.alert}}>the legacy model's own card repayment for
						that day (extraFlow) - THIS is what is on screen:</div>
					{(() => {
						const ex = a.live.extraFlow[k];
						if(!ex)return <div style={{...mono, color: S.bodyTextSecondary}}>
							(the legacy model puts no repayment on {k})</div>;
						return <div style={mono}>
							<div>total {money(-ex.amount)} - "{ex.name}"</div>
							{(ex.parts || []).map((p, i) => <div key={i} style={{paddingLeft: "1rem"}}>
								{money(-p.amount)} · {p.name}
								{p.posted !== undefined ? " · posted " + money(-p.posted) : ""}
								{p.projected !== undefined ? " · projected " + money(-p.projected) : ""}
							</div>)}
						</div>;
					})()}
				</div>
				: null}
			{audit ? <div style={{...mono}}>
				<div style={{color: S.bodyTextSecondary}}>what its cursor would show on {k}
					{" "}(dayAudit) - predicted total {money(-audit.predictedTotal)}:</div>
				{audit.predicted.map((r, i) => <div key={i} style={{paddingLeft: "1rem"}}>
					{money(r.amount)} · {r.name}</div>)}
				{audit.predicted.length ? null : <div style={{paddingLeft: "1rem"}}>(no rows)</div>}
			</div> : null}
		</div>;
	}

	/* WHAT THE TILE PUTS ON THAT DATE - see tileDay(). The repayment is one row among however many
	   the day carries, and the step the chart draws is their SUM. */
	renderTileDay(card, next){
		const S = DS.getStyle();
		const t = this.tileDay(card);
		if(!t)return null;
		if(t.failed)return <div style={{...mono, color: S.alert, marginTop: "0.7rem"}}>
			the tile's own forecast threw: {t.failed}</div>;
		const total = t.flow === undefined ? null : -t.flow;
		const repay = t.rows.filter(r => Math.abs(Math.abs(r.amount) - Math.abs(next.amount)) < 0.005)[0];
		const others = t.rows.filter(r => r !== repay);
		const rest = others.reduce((s, r) => s + r.amount, 0);
		return <div style={{marginTop: "0.8rem", paddingTop: "0.6rem",
				borderTop: "1px dashed " + S.borderColor}}>
			<div style={{...mono, marginBottom: "0.3rem"}}>
				<b>what the TILE draws on {t.day}</b>
				<span style={{color: S.bodyTextSecondary}}> - benchForecast, same asOf and horizon
					and covered set the tile uses ({t.covered.length} checking account
					{t.covered.length === 1 ? "" : "s"})</span>
			</div>
			<div style={{...mono, marginBottom: "0.4rem"}}>
				the day's whole step is <b style={{color: total !== null
						&& Math.abs(total - next.amount) > 0.005 ? S.alert : S.bodyText}}>
					{total === null ? "(nothing)" : money(total)}</b>
				{" "}over {t.rows.length} row{t.rows.length === 1 ? "" : "s"}
				{repay ? <span> - of which the repayment is {money(-repay.amount)}</span> : null}
				{others.length ? <span> and everything else is
					{" "}<b style={{color: S.alert}}>{money(-rest)}</b></span> : null}
				{total !== null && Math.abs(total - next.amount) > 0.005
					? <span style={{color: S.alert}}> <b>&lt;= this is what the chart shows, and it is
						NOT the repayment</b></span>
					: null}
			</div>
			<table style={{...mono, width: "100%", borderCollapse: "collapse"}}>
				<tbody>
					{t.rows.map((r, i) => <tr key={i}
							style={{color: r === repay ? S.bodyTextSecondary : S.alert,
								fontWeight: r === repay ? 400 : 600}}>
						<td style={{padding: "1px 6px 1px 0", textAlign: "right", whiteSpace: "nowrap"}}>
							{money(r.amount)}</td>
						<td style={{padding: "1px 6px", whiteSpace: "nowrap"}}>{r.source}</td>
						<td style={{padding: "1px 6px", whiteSpace: "nowrap"}}>{r.kind || ""}</td>
						<td style={{padding: "1px 0"}}>{r.name}
							{r === repay ? "   (the repayment - correct)" : "   <= rides along"}</td>
					</tr>)}
					{t.rows.length ? null : <tr><td style={{color: S.bodyTextSecondary}}>
						(the tile puts nothing on this day)</td></tr>}
				</tbody>
			</table>
		</div>;
	}

	/* THE CUTOFF, TRIED EVERY WAY. See offsetScan: if one row lands on the bank's own number, the
	   fitted offset is the fault and this says which offset is not. */
	renderScan(card, truth){
		const S = DS.getStyle();
		if(!card.scan)return null;
		const best = truth == null ? null : card.scan.reduce((b, r) =>
			(!b || Math.abs(r.amount - truth) < Math.abs(b.amount - truth)) ? r : b, null);
		return <div style={{marginTop: "0.7rem"}}>
			<div style={{...mono, color: S.bodyTextSecondary}}>
				the same repayment at every cutoff - fitted is {card.offset}d
				{truth == null ? "" : ", closest to your bank's number is marked"}
			</div>
			<table style={{...mono, borderCollapse: "collapse"}}>
				<tbody>
					{card.scan.map(r => {
						const isFit = r.offset === card.offset;
						const isBest = best && r.offset === best.offset;
						return <tr key={r.offset} style={{
								color: isBest ? S.positive : (isFit ? S.bodyText : S.bodyTextSecondary),
								fontWeight: (isBest || isFit) ? 600 : 400}}>
							<td style={{padding: "1px 8px 1px 0"}}>{r.offset}d</td>
							<td style={{padding: "1px 8px", whiteSpace: "nowrap"}}>
								{day(r.from)} .. {day(r.to)}</td>
							<td style={{padding: "1px 8px", textAlign: "right"}}>{money(r.amount)}</td>
							<td style={{padding: "1px 8px", textAlign: "right"}}>{r.count}</td>
							<td style={{padding: "1px 8px", textAlign: "right"}}>
								{truth == null ? "" : money(r.amount - truth)}</td>
							<td style={{padding: "1px 8px"}}>
								{isFit ? "<= fitted" : ""}{isBest && !isFit ? "<= closest to bank" : ""}
								{isBest && isFit ? " (and closest)" : ""}</td>
						</tr>;
					})}
				</tbody>
			</table>
		</div>;
	}

	/* THE BOUNDARIES THEMSELVES. A cutoff fault is a charge on the wrong side of an edge, so the
	   charges within three days of either edge are worth reading whether or not they are in the
	   window - the one that should have been on the other side is in this list by construction. */
	renderEdges(card){
		const S = DS.getStyle();
		if(!card.edges)return null;
		const block = (title, rows) => <div style={{marginTop: "0.5rem"}}>
			<div style={{...mono, color: S.bodyTextSecondary}}>{title}</div>
			<table style={{...mono, width: "100%", borderCollapse: "collapse"}}>
				<tbody>{rows.map((r, i) => <tr key={i}
						style={{color: r.inWindow ? S.bodyText : S.bodyTextSecondary}}>
					<td style={{padding: "1px 6px 1px 0", whiteSpace: "nowrap"}}>{day(r.date)}</td>
					<td style={{padding: "1px 6px", textAlign: "right"}}>{money(r.amount)}</td>
					<td style={{padding: "1px 6px", whiteSpace: "nowrap"}}>
						{r.offDays > 0 ? "+" : ""}{r.offDays.toFixed(2)}d</td>
					<td style={{padding: "1px 6px", fontWeight: 600}}>
						{r.inWindow ? "IN" : "out"}</td>
					<td style={{padding: "1px 0"}}>{r.label}</td>
				</tr>)}
				{rows.length ? null : <tr><td style={{color: S.bodyTextSecondary}}>
					(nothing within three days)</td></tr>}</tbody>
			</table>
		</div>;
		return <div style={{marginTop: "0.6rem"}}>
			{block("within 3 days of the window OPENING (" + day(card.lastClose)
				+ ", the close of the last repayment that actually happened)", card.edges.opening)}
			{block("within 3 days of the window CLOSING (" + day(card.future[0].to) + ")",
				card.edges.closing)}
		</div>;
	}

	renderCard(card){
		const S = DS.getStyle();
		return <div key={card.card} style={{marginBottom: DS.spacing.m + "rem",
				padding: DS.spacing.xs + "rem", background: S.UIElementBackground,
				borderRadius: DS.borderRadius}}>
			<div style={{fontWeight: "bold", marginBottom: "0.2rem"}}>
				{card.name || card.card}{card.mask ? " **" + card.mask : ""}</div>
			<div style={{...mono, color: S.bodyTextSecondary, marginBottom: "0.8rem"}}>
				fitted offset <b style={{color: S.bodyText}}>{card.offset}d</b>
				{" "}· mean fit error {card.fitError == null ? "n/a" : money(card.fitError)}
				{" "}over {card.fitTested} past repayments
				{" "}· {card.chargeCount} charges, {card.historyCount} repayments seen
				<br/>
				today {day(card.asOf)} · last repayment {day(card.lastRepaymentAt)}
				{" "}· its close {day(card.lastClose)} · posted since then (pending)
				{" "}<b style={{color: S.bodyText}}>{money(card.pending)}</b>
			</div>
			{this.renderNext(card)}
			<div style={{height: "1px", background: S.borderColor,
				margin: DS.spacing.s + "rem 0"}}/>
			{this.renderPast(card)}
		</div>;
	}

	render(){
		const S = DS.getStyle();
		if(!this.state.accounts)return <div style={mono}>loading accounts...</div>;
		const probe = this.probe();
		if(probe && probe.failed)return <div style={{...mono, color: S.alert}}>
			the probe threw: {probe.failed}<pre style={{whiteSpace: "pre-wrap"}}>{probe.stack}</pre>
		</div>;
		if(!probe || !probe.length)return <div style={{...mono, color: S.bodyTextSecondary}}>
			no card with a reconstructed repayment link - nothing to show</div>;
		return <div>{probe.map(c => this.renderCard(c))}</div>;
	}
}
