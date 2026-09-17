import React from 'react';
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DS from '../DesignSystem.js';
import Core from '../core.js';
import ApiCaller from '../ApiCaller.js';
import {AccountTypes} from '../Bank.js';
import {reconstruct, dayKey} from '../processors/BankBalance.js';
import {calendarDay} from '../processors/streamPredictor/businessCalendar.js';

/* ==================================================================================================
   THE BALANCE READOUT - what the tile thinks the balance is, and what it walked over to get there.

   WHY THIS EXISTS. "The bank balances went rogue" is the recurring report, and answering it has meant
   dumping a fixture, reading it in a terminal, and reasoning about a capture that is already days old
   by the time anyone looks. Every one of those answers has been about the wrong day. This is the same
   arithmetic against LIVE data, on the page, so the question can be asked the moment it is noticed.

   IT IS NOT A SECOND MODEL, and that is the whole discipline of it. Every number here comes from the
   function the tile itself uses - `Core.accountTypeOf` for what counts as spending, `reconstruct` for
   the walk, the same UTC day boundary - so a disagreement between this panel and the tile is a bug in
   one of them, not two readings of the same fact. The moment it re-derives something, it stops being
   able to answer the question it was built for.

   WHAT IT ANSWERS, in the order the question is actually asked:
     1. the balance TODAY                - the anchor, which is the one figure the bank states outright
     2. the balance at the LAST CLOSED DAY - that figure less whatever has posted today
     3. ON WHAT TRANSACTIONS             - the postings that bridge the two, named and dated

   AND THEN THE PART THAT CATCHES THE ROGUE ONE. A stored snapshot is a reading taken at an INSTANT and
   never revised; the walk is derived from postings. Where they disagree about the same day, one of
   them is wrong, and which one is the whole argument. The table at the bottom puts them side by side
   for every day the bank has reported, so the disagreement is a number rather than an impression.
   ================================================================================================== */

const Panel = styled.div`
	font-family:Inter; font-size:${DS.fontSize.little}rem; text-align:left;
	color:${props => DS.getStyle().bodyText};
`
const Head = styled.div`
	color:${props => DS.getStyle().bodyTextSecondary};
	margin-bottom:${DS.spacing.xs}rem;
`
const Table = styled.table`
	border-collapse:collapse; width:100%; margin-bottom:${DS.spacing.s}rem;
	& th{
		text-align:left; font-weight:600; padding:0.15rem 0.6rem 0.15rem 0;
		color:${props => DS.getStyle().bodyTextSecondary}; white-space:nowrap;
	}
	& td{
		padding:0.15rem 0.6rem 0.15rem 0; vertical-align:top;
		border-top:1px solid ${props => DS.getStyle().borderColor};
	}
	& td.n{text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap;}
	& td.q{color:${props => DS.getStyle().bodyTextSecondary};}
`
const Answer = styled.div`
	display:flex; justify-content:space-between; align-items:baseline;
	padding:0.2rem 0; gap:1rem;
	& b{font-weight:600; font-variant-numeric:tabular-nums;}
	&.big b{font-size:${DS.fontSize.body}rem;}
`
const Note = styled.div`
	color:${props => DS.getStyle().bodyTextSecondary}; margin:${DS.spacing.xs}rem 0;
`
const Flag = styled.span`
	color:${props => DS.getStyle().alert}; font-weight:600;
`
const Pre = styled.pre`
	font-family:monospace; font-size:0.85em; white-space:pre-wrap; word-break:break-word;
	max-height:16rem; overflow:auto; margin:0 0 ${DS.spacing.s}rem;
	padding:${DS.spacing.xs}rem; border-radius:4px;
	background:${props => DS.getStyle().UIElementBackground};
`

const DAY = 86400000
const money = v => (v === undefined || v === null || isNaN(v)) ? "—"
	: (v < 0 ? "-" : "") + "$" + Math.abs(v).toLocaleString(undefined,
		{minimumFractionDigits: 2, maximumFractionDigits: 2})
/* THE TILE'S OWN DAY BOUNDARY, so a day here and a day there are the same day - see BalanceChart.js's
   ledgerToday() for why this reads the ACCOUNT's own timezone rather than the true UTC calendar day:
   read as pure UTC, "today" runs a full day ahead of anyone west of Greenwich for several hours every
   evening, which is exactly the discrepancy this panel was built to catch, not to itself commit. */
const utcMidnight = () => {
	const ud = Core.getUserData()
	const offset = (ud && typeof ud.timeZoneOffset === 'number') ? ud.timeZoneOffset : 0
	return calendarDay(new Date(), offset)
}

export default class BalanceReadout extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {accounts: null, snaps: null, raw: null, err: null}
	}
	componentDidMount(){
		super.componentDidMount?.()
		Core.getAccountsWithBalances()
			.then(a => this.updateState({accounts: a || []}))
			.catch(e => this.updateState({accounts: [], err: String(e)}))
		/* THE STORED SERIES, WHICH THE TILE NO LONGER READS. It stopped anchoring the past to these
		   (see bank-balance.md - a snapshot is never revised, so it goes stale exactly when a
		   transaction posts late), but the gap between them and the walk is still the thing worth
		   measuring, and this is now the only place it is shown. */
		const back = new Date(Date.now() - 21*DAY)
		ApiCaller.getBalanceHistory(back.toISOString(), new Date().toISOString())
			.then(r => this.updateState({snaps: (r && (r.balances || r)) || []}))
			.catch(() => this.updateState({snaps: []}))
		/* THE AGGREGATOR'S OWN RESPONSE, UNTRANSLATED - see BalanceChart... no, see the server's own
		   comment on Connector.getRawAccounts. For Plaid this is TWO calls: `cached` is the endpoint
		   every other balance in this app is built from, served from Plaid's own cache and, by their
		   own docs, possibly minutes to hours old; `fresh` forces a real call to the institution. If
		   the two disagree, the cached one is what the tile and the rest of this panel have been
		   reading all along. */
		ApiCaller.bankGetRawAccountsForUser()
			.then(r => this.updateState({raw: r || []}))
			.catch(e => this.updateState({raw: [], err: String(e)}))
	}

	typeOf(a){return Core.accountTypeOf(a)}
	spending(){
		return (this.state.accounts || []).filter(a =>
			this.typeOf(a) === AccountTypes.checking && a.current !== undefined)
	}
	cards(){
		return (this.state.accounts || []).filter(a => this.typeOf(a) === AccountTypes.credit)
	}
	//the tile's ledger: the covered accounts' transactions, nothing else
	ledger(){
		const keep = this.spending().map(a => a.hash)
		return (this.props.transactions || [])
			.filter(t => keep.indexOf(t.userInstitutionAccountId) > -1)
	}
	anchor(){return this.spending().reduce((s, a) => s + a.current, 0)}

	//what the bank said each day was worth, by day, counted only where EVERY spending account reported
	observedByDay(){
		const snaps = this.state.snaps || []
		const want = this.spending().map(a => a.hash)
		if(!want.length || !snaps.length)return {}
		const seen = {}
		snaps.forEach(x => {
			if(want.indexOf(x.accountHash) < 0 || isNaN(x.current))return
			const k = dayKey(new Date(x.date))
			if(!seen[k])seen[k] = {}
			seen[k][x.accountHash] = {v: x.current, at: x.date}
		})
		const out = {}
		Object.keys(seen).forEach(k => {
			const got = Object.keys(seen[k])
			if(got.length !== want.length)return           //a partial day is a different quantity
			out[k] = {value: got.reduce((s, h) => s + seen[k][h].v, 0), at: seen[k][got[0]].at}
		})
		return out
	}

	/* EVERY STORED SNAPSHOT, ONE ROW EACH, UNSUMMED. `observedByDay()` sums across every spending
	   account for a day, and a sum hides which ONE account a gap actually lives on - a $2,000 offset
	   that never closes, day after day, is what ONE stuck or misreported account looks like once the
	   sum is taken apart. `current` and `available` are shown side by side because they can be read
	   for one another by mistake, and the two only agree when nothing is pending. */
	rawSnapshots(){
		const byHash = {}
		;(this.state.accounts || []).forEach(a => {byHash[a.hash] = a})
		return (this.state.snaps || [])
			.slice()
			.sort((a, b) => (a.date < b.date ? 1 : -1))
			.map(x => ({
				hash: x.accountHash, name: (byHash[x.accountHash] || {}).name || x.accountHash,
				day: dayKey(new Date(x.date)), at: x.date,
				current: x.current, available: x.available, limit: x.limit
			}))
	}

	render(){
		const S = DS.getStyle()
		if(!this.state.accounts)return <Panel><Head>reading balances…</Head></Panel>
		const today = utcMidnight(), closed = new Date(today.getTime() - DAY)
		const kToday = dayKey(today), kClosed = dayKey(closed)
		const txns = this.ledger()
		const anchor = this.anchor()
		const on = k => txns.filter(t => dayKey(t.date) === k)
			.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
		const sum = xs => xs.reduce((s, t) => s + t.amount, 0)
		const tToday = on(kToday), tClosed = on(kClosed)
		const postedToday = sum(tToday)
		const cardsTotal = this.cards().reduce((s, a) => s + (a.current || 0), 0)

		//a posting the reader would date differently from the walk - see model.js getDisplayDate()
		const dateFlag = t => {
			const bits = []
			if(t.frontendDate && dayKey(t.frontendDate) !== dayKey(t.date))
				bits.push("shown " + dayKey(t.frontendDate))
			if(t.authDate && dayKey(t.authDate) !== dayKey(t.date))
				bits.push("auth " + dayKey(t.authDate))
			return bits.join(", ")
		}
		const rows = list => list.map((t, i) => <tr key={i}>
			<td className="q">{dayKey(t.date)}</td>
			<td className="n">{money(t.amount)}</td>
			<td>{t.description}{dateFlag(t) ? <Flag>{"  " + dateFlag(t)}</Flag> : null}</td>
		</tr>)

		/* THE WALK, FROM THE ANCHOR BACK, exactly as the tile draws it - so the comparison below is
		   against the line on screen and not against a second opinion about it. */
		const walk = {}
		reconstruct(txns, today, anchor, new Date(today.getTime() - 21*DAY))
			.forEach(p => {walk[dayKey(p.date)] = p.value})
		const observed = this.observedByDay()
		const days = Object.keys(observed).sort().reverse()

		return <Panel>
			<Head>
				{"read " + new Date().toISOString() + " · today " + kToday
					+ " · last closed " + kClosed}
				{this.state.err ? <Flag>{" · " + this.state.err}</Flag> : null}
			</Head>

			<Table>
				<thead><tr><th>type</th><th>account</th><th>mask</th>
					<th style={{textAlign:"right"}}>current</th>
					<th style={{textAlign:"right"}}>available</th>
					<th>counted in anchor as</th></tr></thead>
				<tbody>{(this.state.accounts || []).map(a => {
					const t = this.typeOf(a)
					/* WHICH ACCOUNTS ARE ACTUALLY BEING SUMMED - stated plainly rather than left to be
					   inferred from a type column, because "anchor is wrong" is very often "an account
					   the reader wasn't thinking about is typed checking too" and not a bad number. */
					const role = t === AccountTypes.checking ? "+ spending"
						: (t === AccountTypes.credit ? "- netted only" : "excluded (" + t + ")")
					return <tr key={a.hash}>
						<td className="q">{t}</td>
						<td>{a.name}</td>
						<td className="q">{a.mask}</td>
						<td className="n">{money(a.current)}</td>
						<td className="n">{money(a.available)}</td>
						<td className={t === AccountTypes.checking ? "" : "q"}>{role}</td>
					</tr>
				})}</tbody>
			</Table>
			<Note>{"anchor = sum of every row marked \"+ spending\" above (" + this.spending().length
				+ " account" + (this.spending().length === 1 ? "" : "s") + "): " + money(anchor)
				+ ". Not a subtraction — a SUM. If it looks wrong, the question is whether every row"
				+ " marked \"+ spending\" belongs there, not what was taken off it."}</Note>

			{/* THE EXACT RESPONSE FROM PLAID, TWO WAYS - the thing under suspicion, before anything in
			    this app has touched it. `cached` is /accounts/get, the endpoint every balance in this
			    app (this panel's own table above included) is built from; Plaid serves it from its own
			    cache and says so in their docs. `fresh` is /accounts/balance/get, which forces Plaid
			    to call the institution again before answering. If the two disagree, the cached one is
			    what has been on screen the whole time. */}
			<div style={titleish(S)}>Plaid's own response — cached vs a forced fresh read</div>
			{this.state.raw === null ? <Note>reading Plaid…</Note>
				: (this.state.raw.length ? this.state.raw.map(conn => <div key={conn.itemId}>
					<Note>{conn.institutionId + " (" + conn.connector + ", item " + conn.itemId + ")"}</Note>
					{conn.error ? <Flag>{conn.error}</Flag> : (conn.raw && conn.raw.unsupported
						? <Note>{"not a Plaid connection (" + conn.raw.connector + ") — no raw response to show"}</Note>
						: rawCompare(conn.raw))}
				</div>) : <Note>no bank connections.</Note>)}

			{/* 1, 2 and 3 - the three figures the question is actually about */}
			<Answer className="big"><span>balance today ({kToday}), spending</span>
				<b>{money(anchor)}</b></Answer>
			<Answer><span>{"postings today (" + tToday.length + ")"}</span>
				<b>{money(postedToday)}</b></Answer>
			<Answer className="big"><span>balance at last closed day ({kClosed})</span>
				<b>{money(anchor - postedToday)}</b></Answer>
			<Answer><span>netted, today (spending less cards)</span>
				<b>{money(anchor - cardsTotal)}</b></Answer>

			<Note>{tToday.length ? "what has posted today:" : "nothing has posted today — the two figures above are the same number."}</Note>
			{tToday.length ? <Table><tbody>{rows(tToday)}</tbody></Table> : null}

			<Note>{"what moved on the closed day itself (" + kClosed + "), reaching " + money(anchor - postedToday) + ":"}</Note>
			{tClosed.length
				? <Table><tbody>{rows(tClosed)}</tbody></Table>
				: <Note>{"nothing posted on " + kClosed + "."}</Note>}

			{/* EVERY STORED SNAPSHOT ON ITS OWN, current beside available, before anything sums them.
			    A gap that never closes across many days is what ONE misbehaving account looks like
			    once the total below is taken apart - this is where to find which one. */}
			<div style={titleish(S)}>stored snapshots — current vs available, per account</div>
			{this.state.snaps === null ? <Note>reading the stored series…</Note>
				: (this.rawSnapshots().length ? <Table>
					<thead><tr><th>day</th><th>account</th>
						<th style={{textAlign:"right"}}>current</th>
						<th style={{textAlign:"right"}}>available</th>
						<th style={{textAlign:"right"}}>current − available</th>
						<th style={{textAlign:"right"}}>limit</th></tr></thead>
					<tbody>{this.rawSnapshots().map((r, i) => {
						const held = (r.current !== undefined && r.available !== undefined)
							? r.current - r.available : null
						return <tr key={i}>
							<td className="q">{r.day}</td>
							<td>{r.name}</td>
							<td className="n">{money(r.current)}</td>
							<td className="n">{money(r.available)}</td>
							<td className="n">{held === null ? "—"
								: (Math.abs(held) < 0.005 ? money(0) : <Flag>{money(held)}</Flag>)}</td>
							<td className="n">{money(r.limit)}</td>
						</tr>
					})}</tbody>
				</Table> : <Note>no stored snapshots.</Note>)}

			{/* AND THE ROGUE DETECTOR: the bank's own reading of a day against the walk over it. */}
			<div style={titleish(S)}>stored snapshot vs the walk</div>
			<Note>
				A snapshot is a reading taken at an instant and never revised; the walk is derived from
				postings. A non-zero gap means they disagree about that day — which is the whole
				argument, every time.
			</Note>
			{days.length ? <Table>
				<thead><tr><th>day</th><th>snapshot taken</th>
					<th style={{textAlign:"right"}}>bank said</th>
					<th style={{textAlign:"right"}}>walk says</th>
					<th style={{textAlign:"right"}}>gap</th></tr></thead>
				<tbody>{days.map(k => {
					const w = walk[k], o = observed[k].value
					const gap = (w === undefined) ? null : o - w
					return <tr key={k}>
						<td className="q">{k}</td>
						<td className="q">{observed[k].at}</td>
						<td className="n">{money(o)}</td>
						<td className="n">{money(w)}</td>
						<td className="n">{gap === null ? "—"
							: (Math.abs(gap) < 0.005 ? money(0) : <Flag>{money(gap)}</Flag>)}</td>
					</tr>
				})}</tbody>
			</Table> : <Note>no stored snapshots in the last three weeks.</Note>}
		</Panel>
	}
}

const titleish = S => ({marginTop: DS.spacing.s + "rem", marginBottom: DS.spacing.xxs + "rem",
	fontWeight: "bold", color: S.bodyText})

//cached vs fresh, per account_id - matched on Plaid's own id, not our hash, since this is upstream
//of the mapping step that computes the hash at all
const rawCompare = raw => {
	const cached = (raw && raw.cached && raw.cached.accounts) || []
	const fresh = (raw && raw.fresh && raw.fresh.accounts) || []
	const freshById = {}
	fresh.forEach(a => {freshById[a.account_id] = a})
	return <React.Fragment>
		{(raw.cached && raw.cached.error_code) || (raw.fresh && raw.fresh.error_code)
			? <Flag>{"cached: " + ((raw.cached && raw.cached.error_message) || "ok")
				+ " · fresh: " + ((raw.fresh && raw.fresh.error_message) || "ok")}</Flag> : null}
		{cached.length ? <Table>
			<thead><tr><th>account</th><th>mask</th>
				<th style={{textAlign:"right"}}>cached current</th>
				<th style={{textAlign:"right"}}>fresh current</th>
				<th style={{textAlign:"right"}}>gap</th></tr></thead>
			<tbody>{cached.map(c => {
				const f = freshById[c.account_id]
				const gap = f ? (c.balances.current - f.balances.current) : null
				return <tr key={c.account_id}>
					<td>{c.name}</td>
					<td className="q">{c.mask}</td>
					<td className="n">{money(c.balances && c.balances.current)}</td>
					<td className="n">{f ? money(f.balances && f.balances.current) : "—"}</td>
					<td className="n">{gap === null ? "—"
						: (Math.abs(gap) < 0.005 ? money(0) : <Flag>{money(gap)}</Flag>)}</td>
				</tr>
			})}</tbody>
		</Table> : null}
		<Note>raw — cached (/accounts/get)</Note>
		<Pre>{JSON.stringify(raw.cached, null, 1)}</Pre>
		<Note>raw — fresh (/accounts/balance/get)</Note>
		<Pre>{JSON.stringify(raw.fresh, null, 1)}</Pre>
	</React.Fragment>
}
