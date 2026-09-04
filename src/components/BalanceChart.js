import React from 'react';
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DS from '../DesignSystem.js';
import Core from '../core.js';
import {histogramOf, accountRoutingOf, reconstruct, forecast, trough, peak, eventsIn, dayKey,
	monthlyExpectationAt} from '../processors/BankBalance.js';

/* ==================================================================================================
   PAGE THREE: THE BANK BALANCE, backwards from today and forwards from the master stream.

   Two questions, one picture (documentation/bank-balance.md):
     1. when is my current account at its lowest - can I buy the plane tickets?
     2. what do I actually have, once the credit card is netted off?
   The same reconstruction, summed two ways, with the reading picked from the title.

   THE VISUAL GRAMMAR IS PAGE ONE'S, not a language of its own. An AREA at backgroundOpacity 0.15, a
   SOLID line at full colour and strokeWidth 3 for what happened, a DASHED lighter line for what is
   projected, dots on the data points, and a cursor that follows the finger. Two channels carrying two
   facts: the area says where this sits against zero, the line says record or projection.
   ================================================================================================== */

const DAY = 86400000;
const RATIO = 2.25;                    //the tile is wider than it is tall, as page one is
const PAD = {l: 10, r: 10, t: 18, b: 15};
const PLANE = {planned: 0.15, projected: 0.5, actual: 1};
const STROKE = {actual: 3, projected: 2, dash: "3,2.5"};

/* A DOT IS A RADIUS. Page one sets scatterDotSize 4 on a phone against strokeWidth 3, and Victory
   reads that size as a radius - so its dots are 8 across on a 3-wide line, a diameter of about 2.7x
   the stroke. Read as a diameter, which is what the number looks like, the dots come out 4 across on
   the same line: 1.3x, a bump in the line rather than a mark on it, and invisible against a dashed
   one. Taken as the radius it is, the beads read against the projection too. */
const DOT_R = 4;
const DOT_FOCAL = DOT_R * 1.25;        //the trough and the cursor, which must win against the beads

/* THE RUNWAY IS ANCHORED TO MONEY, NOT TO THE FRAME. Anchored to the frame instead, a comfortable
   month and a desperate one both ran green at the top and red at the bottom, which is a colour that
   says only "this is the top of the picture".

   THREE BANDS. Red below LOW_AT, green through the working range, blue above HIGH_AT. The third band
   because "more than enough" is a DIFFERENT FACT from "enough", not a stronger version of it: a
   balance above the ceiling is money in checking that belongs in savings, and blue is already the
   savings identity everywhere else in the app. Two bands could only say that as "very green", which
   reads as better rather than as misplaced.

   THE FLOOR IS SET BY VISIBILITY. At 100 the red band was correct and unreadable - the frame scales
   to the whole window, so the strip between 0 and 100 was a couple of pixels and the warning only
   arrived once the balance was already negative, which is too late to be a warning. At 1000 the band
   has room to be seen while there is still a decision to make.

   BLEND is how many dollars a crossing takes: 0 gives three named states with hard edges, wide gives
   a continuous temperature. 3000 is the full span between the anchors, which puts the crossings as
   soft as three bands can hold - the balance reads as a temperature, and the anchors are where the
   midpoints sit rather than where anything switches. */
const LOW_AT = 1000, HIGH_AT = 4000;
const BLEND = HIGH_AT - LOW_AT;

/* A MONTH, AND THE CHOICE IS WHICH ONE.

   The list has been wrong in both directions and both errors are worth keeping. A YEAR was offered
   first: at 365 days every recurring stream repeats until the line is a texture and the trough is a
   pixel, and "can I cover what is coming" is not a question anyone asks twelve months out. A WEEK and
   a FORTNIGHT replaced it, on the tidy reasoning that every window should be one turn of a period the
   streams run on - and almost nothing recurring falls inside seven days, so the line was flat and the
   low point was whatever today happened to be. A QUARTER survived a while and earned nothing: the
   decisions this tile is for are all inside a month.

   So the scale is fixed and the axis of choice moved: THIS month, centred on today and half forecast,
   or LAST month, which is entirely settled. Last month is not a smaller version of the same question -
   it is a different one. This month asks "can I cover what is coming"; last month asks "what actually
   happened", and every point in it is a record rather than a projection, which is why it draws as one
   solid line with no dashes anywhere. */
const WHENS = [["this", "this month"], ["last", "last month"]];
const wordOf = (list, v) => (list.filter(o => o[0] === v)[0] || list[0])[1];

/* THE TWO READINGS. Not a list of accounts: enumerating every connected one made the control a file
   browser for a question that has two answers. The spending account is where the money that pays for
   things sits; the only other thing worth asking is what is left once the cards are actualised. A
   savings balance is neither - folded in it hides the trough goal 1 is about, and on its own it is
   not a runway. */
const SPENDING = "__spending__", NETTED = "__netted__";

/* A BADGE MARKS A TRANSACTION WORTH NOTICING, and that is an AMOUNT, not a proportion. The floor was
   a fraction of the window range, so a quiet month promoted its own noise to a badge and a busy one
   hid a four-figure payment. A fixed floor says the same thing in every window. */
const BADGE_FLOOR = 1000;

const MORPH_MS = 380;                  //page one's dataMs: a change of amounts
const ZOOM_MS = 620;                   //page one's moveMs: a change of frame

/* ---- the icons ------------------------------------------------------------------------------------
   DRAWN, NOT A FONT. Material Symbols renders through ligatures - the text node says "home" and the
   font substitutes a glyph. That works where the webfont arrives and fails silently where it does
   not, printing the literal names at a size chosen for a glyph. These are paths in a 24x24 box and
   cannot fail to substitute because there is nothing to substitute.
   Each shape has a different SILHOUETTE, which is the only channel left at eleven pixels. */
const ICONS = {
	house: 'M12 3 3 10.5h2.2V20h4.3v-5.6h4.9V20h4.3v-9.5H21z',
	child: 'M12 3a2.4 2.4 0 1 1 0 4.8A2.4 2.4 0 0 1 12 3zM7.5 9.5h9c.8 0 1.3.6 1.3 1.4V16h-2.4v5H8.6v-5H6.2v-5.1c0-.8.5-1.4 1.3-1.4z',
	cross: 'M9.6 3h4.8v6.6H21v4.8h-6.6V21H9.6v-6.6H3V9.6h6.6z',
	note:  'M2 5.5h20v13H2zm10 2.6a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8z',
	case:  'M9.4 3h5.2c.9 0 1.6.7 1.6 1.6V7H21v13H3V7h4.8V4.6C7.8 3.7 8.5 3 9.4 3zm.4 4h4.4V5.2H9.8z',
	bank:  'M12 2.6 22 8v2H2V8zM4.6 11.6h2.6v6.2H4.6zm4.8 0H12v6.2H9.4zm4.8 0h2.6v6.2h-2.6zM2.6 19.4h18.8V22H2.6z',
	card:  'M2 4.8h20v3.6H2zm0 5.8h20v8.6H2zm2.6 5.2h5v2h-5z',
	save:  'M12 2.6v7.6l2.9-2.9 1.9 1.9-6.2 6.2-6.2-6.2 1.9-1.9 2.9 2.9V2.6zM3 17.4h18V22H3z',
	up:    'M3 18.6 9.6 12l3.6 3.6L19.2 9.6H15V7h8.4v8.4H21v-4.2l-7.8 7.8-3.6-3.6-4.8 4.8z',
	car:   'M6.4 10.4 8 5.6h8l1.6 4.8H21v7.2h-3v-2.4H6v2.4H3v-7.2zM7.2 11.6a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zm9.6 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z',
	cart:  'M2 3.4h3.4l1 3.6H22l-2.4 8.4H8.2L7.6 18h12.6v2.4H5.4L2.6 5.8H2zM9.6 20a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zm8.4 0a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z',
	food:  'M5 2.6h2.2v6.6h1.4V2.6h2.2v6.6h1.4V2.6H15v7.2c0 1.6-1.1 2.8-2.6 3v9.2H8.6v-9.2C7.1 12.6 6 11.4 6 9.8V2.6zm12.6 0H21V22h-2.6v-8.4h-2.8V7c0-2.4.9-4.4 2-4.4z',
	plane: 'M2.6 13.4 21.4 4 12 22.8l-2.6-6.6z',
	gift:  'M3 9.6h18v3.2H3zm1.6 4.8h16.8v6.4H4.6zM12 3c1.6 0 2.8 1.2 2.8 2.6 0 .6-.2 1.2-.6 1.6h3.4v2.4H6.4V7.2h3.4a2.4 2.4 0 0 1-.6-1.6C9.2 4.2 10.4 3 12 3z',
	tool:  'M16.6 2.6a5.6 5.6 0 0 0-5 8l-8.8 8.8 2.8 2.8 8.8-8.8a5.6 5.6 0 0 0 7-6.8l-3 3-2.8-.7-.7-2.8 3-3a5.6 5.6 0 0 0-1.3-.5z',
	dot:   'M12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z'
};
/* Most specific FIRST, and two orderings here were paid for: "care" contains "car", so childcare must
   precede the car rule, and a gift addressed to a child is still a gift. */
const ICON_FOR = [
	[/tax|gembah/i, "bank"],
	[/credit card/i, "card"],
	[/wage|salary|payroll|paycheck/i, "note"],
	[/side gig|freelance|contract/i, "case"],
	[/unit sales|royalt|interest income|dividend/i, "up"],
	[/saving|investment|option exercise|equity|transfer/i, "save"],
	[/cadeau|dons|donation|gift|shopping/i, "gift"],
	[/day care|child|nursery/i, "child"],
	[/medical|hsa|health|dental/i, "cross"],
	[/insurance/i, "house"],
	[/rent|mortgage|housing|laundry|utilit|internet|phone/i, "house"],
	[/gas|fuel|petrol|toll|parking|dmv|car/i, "car"],
	[/grocer|hygiene|supermarket/i, "cart"],
	[/social|date|gourmand|restaurant|food|dining|sortie/i, "food"],
	[/voyage|flight|travel|holiday/i, "plane"],
	[/equipment|repair|replacement|maintenance|exceptional/i, "tool"],
	[/sport|fitness|gym|book|hobby|jardinage|garden|fun/i, "gift"]
];
const iconFor = name => {
	for(let i = 0; i < ICON_FOR.length; i++){if(ICON_FOR[i][0].test(name || ""))return ICON_FOR[i][1]}
	//the fallback is deliberately BLAND: a wrong glyph is read as a fact, a neutral one as
	//"something happened here"
	return "dot";
};

/* ---- type -----------------------------------------------------------------------------------------
   The title is set like page one's and page two's, and the SUBTITLE takes page one's treatment
   exactly: Inter at body size in the BODY colour, not a monospace face and not the secondary colour.
   Page one puts the year at title size and the date range directly under it at body size, both in
   bodyText, with the lower-emphasis figures below in bodyTextSecondary - so a subtitle set quieter
   than that reads as a caption on the picture rather than as the thing the reader is being told.

   Its height is RESERVED, so going from empty to full moves nothing under it. The readout was in the
   title to begin with, which is HTML: a longer sentence rewrapped the heading, the chart moved down,
   and pointing at a day made the picture flinch under the finger. */
/* ContentTile is a FlexColumn and FlexColumn sets `align-items:center`, so any child that does not
   stretch is centred. Page two's header opts out with these same three properties; this one had not,
   and inherited the centring silently - which is why the title and its caption sat in the middle
   while every other heading in the app starts at the left margin. */
const Head = styled.div`
	display:flex; align-items:flex-start; justify-content:space-between;
	width:100%; align-self:stretch; text-align:left;
	gap:${DS.spacing.xxs}rem;
`
const Title = styled.h2`
	margin:0; line-height:1.15;
	font-size:${props => (props.$big ? DS.fontSize.display : DS.fontSize.title)}rem; font-weight:400;
	color:${props => DS.getStyle().bodyText};
`
const TitleButton = styled.button`
	appearance:none; border:0; background:none; padding:0 0 1px; cursor:pointer; font:inherit;
	color:${props => DS.getStyle().bodyText};
	border-bottom:1px dashed ${props => DS.getStyle().borderColor};
	&:hover{border-bottom-color:${props => DS.getStyle().bodyText};}
	&:focus-visible{outline:2px solid ${props => DS.getStyle().savings}; outline-offset:2px;}
`
/* ONE FACT, and small. It carried three at body size - the balance, the date and the stream - which
   made it a second heading competing with the title rather than a caption under it, and a sentence
   long enough to be read instead of glanced at. At rest it says the only thing the tile exists to
   report: the low point. Under the cursor it says what moved the line, which is the only thing worth
   knowing about a day you are pointing at.

   The height stays RESERVED so going from one to the other moves nothing below it. */
const Subtitle = styled.div`
	width:100%; align-self:stretch; text-align:left;
	font-family:Inter; font-size:${DS.fontSize.little}rem;
	line-height:1.1rem; height:1.1rem; overflow:hidden;
	margin:0.05rem 0 0.4rem; white-space:nowrap; text-overflow:ellipsis;
	color:${props => DS.getStyle().bodyTextSecondary};
	& b{font-weight:600; color:${props => DS.getStyle().bodyText};}
	& b.bad{color:${props => DS.getStyle().alert};}
`
const ChartArea = styled.div`position:relative; width:100%; align-self:stretch;`
const ChartHost = styled.div`
	overflow:hidden; -webkit-tap-highlight-color:transparent;
	& svg{ display:block; -webkit-user-select:none; user-select:none; }
`
const Empty = styled.div`
	position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
	text-align:center; padding:${DS.spacing.xs}rem;
	font-size:${DS.fontSize.body}rem; color:${props => DS.getStyle().bodyTextSecondary};
`

const LT = String.fromCharCode(60);
const HALF = 15;                       //days either side of the window's centre

/* one calendar month earlier, clamped: "the 31st" of a thirty-day month is its last day, not the 1st
   of the month after - a shift that silently lands in the wrong month is worse than one that rounds */
const monthBefore = d => {
	const y = d.getUTCFullYear(), m = d.getUTCMonth()
	const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
	return new Date(Date.UTC(y, m - 1, Math.min(d.getUTCDate(), lastDay)))
};

const money = v => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString();
//a stream name is user-typed and goes into innerHTML
const esc = t => String(t == null ? "" : t).replace(/[&<>"]/g,
	c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
const onDate = d => new Date(d).toLocaleString("en-US", {month:"short", day:"numeric", timeZone:"UTC"});

export default class BalanceChart extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {when:"this", source:null, at:null, accounts:null, loaded:false}
		this.host = React.createRef()
		this.drag = {down:false, x0:0, x1:0}
		this.W = 334; this.H = Math.round(334/RATIO)
	}

	componentDidMount(){
		//the LIVE balance is the anchor the reconstruction hangs from, so the picture cannot be drawn
		//until it arrives. Until then the tile says so rather than drawing a plausible wrong line.
		Core.getAccountsWithBalances().then(accounts =>
			this.updateState({accounts:accounts||[], loaded:true}, () => this.paint()))
			.catch(() => this.updateState({accounts:[], loaded:true}))
		this.wireOnce()
		if(typeof ResizeObserver !== "undefined"){
			this.ro = new ResizeObserver(() => {if(this.measure())this.paint()})
			if(this.host.current)this.ro.observe(this.host.current)
		}
	}
	componentWillUnmount(){if(this.ro)this.ro.disconnect()}
	componentDidUpdate(){this.paint()}

	//measured AFTER it exists: a measurement taken before the thing is on screen is a guess about it
	measure(){
		const el = this.host.current
		const w = el && el.getBoundingClientRect().width
		if(!w || Math.abs(w - this.W) < 1)return false
		this.W = Math.round(w); this.H = Math.round(this.W/RATIO); return true
	}

	/* ---- the data ------------------------------------------------------------------------------- */
	creditHashes(){return (this.state.accounts||[]).filter(a => a.type === "credit").map(a => a.hash)}
	depositoryHashes(){return (this.state.accounts||[]).filter(a => a.type === "depository").map(a => a.hash)}
	spendable(){return (this.state.accounts||[]).filter(a => a.type === "depository"
		&& a.current !== undefined)}

	/* THE SPENDING ACCOUNT: the depository accounts whose subtype says they are for spending. Savings
	   is excluded on purpose - it is not a runway, and sitting behind a checking balance it hides the
	   trough. Where no subtype names one, every depository account counts, so a reader with a single
	   account never gets an empty chart over a taxonomy detail. */
	spendingHashes(){
		const dep = this.spendable()
		const chk = dep.filter(a => (a.subtype || "").toLowerCase().indexOf("check") > -1)
		return (chk.length ? chk : dep).map(a => a.hash)
	}
	//one control, one question, two answers. The second appears only where there is a card to
	//actualise - a reader with no credit account is not offered a reading that cannot differ.
	sources(){
		const out = [[SPENDING, "spending"]]
		if(this.creditHashes().length)out.push([NETTED, "spending net of cards"])
		return out
	}
	source(){
		const list = this.sources().map(o => o[0])
		return (this.state.source && list.indexOf(this.state.source) > -1)
			? this.state.source : list[0]
	}
	//the account hashes this reading is made of
	covered(){
		const spend = this.spendingHashes()
		return this.source() === NETTED ? spend.concat(this.creditHashes()) : spend
	}

	//the anchor. Plaid signs a card's current balance POSITIVE for money owed, which is why the
	//netted reading subtracts rather than adds.
	anchor(){
		const accts = (this.state.accounts||[]).filter(a => a.current !== undefined)
		const spend = this.spendingHashes()
		const base = accts.filter(a => spend.indexOf(a.hash) > -1).reduce((s,a) => s + a.current, 0)
		if(this.source() !== NETTED)return base
		return base - accts.filter(a => a.type === "credit").reduce((s,a) => s + a.current, 0)
	}
	hasAnchor(){return (this.state.accounts||[]).some(a => a.current !== undefined)}

	//streamId -> name, so a transaction can say what moved without a lookup per render
	streamNames(){
		if(this._names)return this._names
		this._names = {}
		this.terminals().forEach(s => {this._names[s.id] = s.name})
		return this._names
	}

	/* every transaction that touched the accounts this reading covers, at its RAW amount. Not the
	   per-stream allocation: uncategorised money still moved, and a balance that ignored it would
	   disagree with the bank for a reason the reader cannot see.

	   Each one carries the name of its LARGEST allocation, which is what lets the cursor say what
	   moved the line. A transaction split across streams has one dominant one and that is the honest
	   answer to "what was this"; an uncategorised transaction has none, and says so. */
	ledger(){
		const keep = this.covered()
		const names = this.streamNames()
		return (this.props.transactions||[])
			.filter(t => keep.indexOf(t.userInstitutionAccountId) > -1)
			.map(t => {
				let who = null, big = 0
				;(t.streamAllocation || []).forEach(al => {
					if(Math.abs(al.amount) >= Math.abs(big)){big = al.amount
						who = names[al.streamId] || al.streamName || null}
				})
				return {date:t.date, amount:t.amount,
					accountHash:t.userInstitutionAccountId, streamName:who}
			})
	}

	//each terminal's own categorised transactions, grouped once so a histogram can be rebuilt over
	//any slice of them without walking the ledger again
	streamTxns(){
		if(this._byStream)return this._byStream
		const terminals = this.terminals()
		const byStream = {}
		terminals.forEach(s => {byStream[s.id] = []})
		;(this.props.transactions||[]).filter(t => t.categorized).forEach(t => {
			terminals.forEach(s => {
				if(!t.isAllocatedToStream(s))return
				byStream[s.id].push({date:t.date, amount:t.amount,
					accountHash:t.userInstitutionAccountId})
			})
		})
		this._byStream = byStream
		return byStream
	}

	/* THE SHAPES AS THEY WOULD HAVE LOOKED ON A GIVEN DAY - nothing after `cutoff` is allowed in.
	   This is what makes the backtest worth drawing: a forecast fitted to the period it is predicting
	   has already seen the answer, and the agreement it then shows is its own reflection. */
	shapesAsOf(cutoff){
		const byStream = this.streamTxns(), out = {}, dir = {}
		const terminals = this.terminals()
		terminals.forEach(s => {
			const before = cutoff ? byStream[s.id].filter(t => t.date < cutoff) : byStream[s.id]
			out[s.id] = histogramOf(before)
			const a = monthlyExpectationAt(s, cutoff || this.ledgerToday(), "monthly")
			dir[s.id] = a < 0 ? -1 : (a > 0 ? 1 : 0)
		})
		const sliced = {}
		terminals.forEach(s => {sliced[s.id] = cutoff
			? byStream[s.id].filter(t => t.date < cutoff) : byStream[s.id]})
		return {shapes: out, routing: accountRoutingOf(sliced, id => dir[id])}
	}

	//one histogram per terminal, from that terminal's own categorised transactions
	shapes(){
		if(this._shapes)return this._shapes
		const terminals = this.terminals()
		const byStream = this.streamTxns()
		const shapes = {}
		const now = this.ledgerToday()
		terminals.forEach(s => {shapes[s.id] = histogramOf(byStream[s.id])})
		/* the DIRECTION each stream moves money, so a transfer is routed by the leg that leaves rather
		   than the leg that arrives - the two legs of a pair are equal in magnitude and would otherwise
		   tie (see accountRoutingOf) */
		const dir = {}
		terminals.forEach(s => {
			const a = monthlyExpectationAt(s, now, "monthly")
			dir[s.id] = a < 0 ? -1 : (a > 0 ? 1 : 0)
		})
		this._routing = accountRoutingOf(byStream, id => dir[id])
		this._shapes = shapes
		return shapes
	}
	routing(){this.shapes(); return this._routing || {}}
	terminals(){
		const master = this.props.stream || Core.getMasterStream()
		return master ? master.getAllTerminalStreams() : []
	}

	//the day the card settles, MEASURED from the largest recurring payment out of the current account
	//to a card. Undefined when there are no cards, in which case no lump is added at all.
	settlementDay(){
		const cards = this.creditHashes()
		if(!cards.length)return undefined
		const byDay = new Array(32).fill(0)
		;(this.props.transactions||[]).forEach(t => {
			if(cards.indexOf(t.userInstitutionAccountId) < 0)return
			if(t.amount <= 0)return                       //a payment INTO the card reduces what is owed
			byDay[t.date.getUTCDate()] += t.amount
		})
		let best = 0, day = undefined
		byDay.forEach((v,i) => {if(v > best){best = v; day = i}})
		return day
	}

	/* TODAY, IN THE FRAME THE LEDGER USES.
	   A transaction reports its date through getDateInDisplayTimezone(), which offsets the instant
	   before anything asks which day it was. The series was walking back from a raw `new Date()`
	   instead, so the two sides keyed the same calendar day differently and the whole reconstruction
	   sat one day off: the step for a payment landed on the following day, and the cursor named the
	   stream from the day before. It is invisible for part of the day and wrong for the rest, which is
	   the worst kind of date bug.
	   The frame that is RIGHT here is the raw UTC day, and that is not obvious. getDateInDisplayTimezone
	   offsets an instant so that LOCAL getters read back the raw UTC day - it converts a UTC day into
	   something local accessors can print. Read with toISOString(), which is what a day key does, the
	   offset is applied a second time and an afternoon transaction moves to tomorrow. So the app's
	   notion of "which day" IS the raw timestamp's UTC day, and both sides use it directly. */
	ledgerToday(){
		const n = new Date()
		return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()))
	}

	/* LAST MONTH IS THIS WINDOW, MOVED BACK EXACTLY ONE MONTH.

	   It was the previous CALENDAR month first, on the reasoning that the question is about a month
	   with a name. That reasoning ignored the gesture: the reader is looking at a window centred on
	   today, and asking for last month is asking to see the same window a month ago. A calendar month
	   is a different width AND a different offset, so the picture jumped to a stretch of time with no
	   fixed relationship to the one being left - it landed, as reported, somewhere in the middle.

	   Moved by exactly a month, the two windows are the same width and the motion is a pure
	   translation: every mark travels the same distance in the same direction, which is what makes a
	   pan readable as "the same thing, earlier" rather than as a new picture. */
	window(now, when){
		const from = t => new Date(t.getTime() - HALF*DAY);
		if(when === "last"){
			const c = monthBefore(now)
			//the whole window is behind us, so nothing in it is projected
			return {from: from(c), to: new Date(c.getTime() + HALF*DAY), fwd: 0}
		}
		return {from: from(now), to: null, fwd: HALF}
	}

	/* BOTH MONTHS ARE BUILT AT ONCE, and the toggle only chooses between them.

	   Every switch used to rebuild a month from scratch: walk the whole ledger backwards, then run
	   fifty-odd terminals across thirty days. That work landed on the first frame of the animation,
	   which is precisely where a stall is most visible - the picture holds still for a moment and then
	   catches up, so a motion designed to make the change legible instead makes it look broken.

	   The cost of having both is one extra walk of a ledger that is already in memory, and last month
	   forecasts nothing at all, so it is cheaper than the month it sits beside. The cache is keyed on
	   the three things a series depends on - the reading, the transactions, the accounts - so it is
	   dropped exactly when it is wrong and never merely because the component re-rendered.

	   It also removes a double computation that was there from the start: the caption and the picture
	   each asked for the series independently on every render, including on every day the cursor
	   passed over. */
	allSeries(){
		const src = this.source(), txns = this.props.transactions, acc = this.state.accounts
		const k = this._seriesKey
		if(this._series && k && k.src === src && k.txns === txns && k.acc === acc)return this._series
		const out = {}
		WHENS.forEach(o => {out[o[0]] = this.computeSeries(o[0])})
		this._series = out
		this._seriesKey = {src: src, txns: txns, acc: acc}
		return out
	}
	series(when){return this.allSeries()[when || this.state.when]}

	computeSeries(when){
		const now = this.ledgerToday()
		const win = this.window(now, when)
		const txns = this.ledger()
		const bal = this.anchor()
		const keep = this.covered(), cards = this.creditHashes()
		const fallback = this.spendingHashes()[0]
		/* a stream with no history has no home account. It is treated as landing on the DEFAULT
		   account - the safer error, since it then arrives on its own day rather than a fortnight
		   later inside a settlement lump. */
		const covers = h => keep.indexOf(h || fallback) > -1
		//the settlement is added only where the card sits OUTSIDE the reading: inside it, the
		//spending is already counted on its own dates and the payment moves nothing
		const netted = this.source() === NETTED
		const settles = netted ? null : (h => cards.indexOf(h) > -1)
		/* the reconstruction always runs back from TODAY, whatever is on screen - it is anchored to
		   the one balance that is actually known (see the drift note), so a past window is a slice of
		   that walk rather than a separate calculation from a guessed opening figure. */
		let past = reconstruct(txns, now, bal, win.from)
		if(win.to)past = past.filter(p => p.date <= win.to)
		const future = win.fwd ? forecast({terminals:this.terminals(), shapes:this.shapes(),
			routing:this.routing(), now:now, balanceNow:bal, days:win.fwd,
			covers:covers, settles:settles,
			periodName:"monthly", settlementDay:this.settlementDay()}) : []
		/* THE BENCHMARK: the same forecast, run forward from the START of what is on screen, over the
		   days that have since actually happened. Where it parts company with the reconstruction is a
		   discrepancy worth chasing - a stream mis-timed, an amount out of date, or money moving that
		   the master does not know about.

		   It must be run OUT OF SAMPLE or it is not a benchmark. The shapes and the routing are built
		   only from transactions before the window opens, so the forecast is making the prediction it
		   would have made on the day, with what it knew on the day. Fitted to the period it predicts,
		   it would reproduce that period rather than test it.

		   The expected AMOUNTS still come from the master's own step function evaluated at each date,
		   which is right: that is the plan as it stood then, not the outcome. */
		let backtest = []
		if(past.length > 1){
			const opened = past[0].date
			const asOf = this.shapesAsOf(opened)
			backtest = forecast({terminals:this.terminals(), shapes:asOf.shapes,
				routing:asOf.routing, now:opened, balanceNow:past[0].value,
				days:Math.round((past[past.length-1].date - opened)/DAY),
				covers:covers, settles:settles,
				periodName:"monthly", settlementDay:this.settlementDay()})
			backtest = [{date:opened, value:past[0].value, bench:true}]
				.concat(backtest.map(p => ({date:p.date, value:p.value, bench:true})))
		}
		return {past:past, future:future, backtest:backtest, txns:txns, now:now}
	}

	//the days that earn a badge, by the same rule the picture uses - one definition, so a test asserts
	//the rule rather than parsing the markup for it
	badgeDays(){
		const a = this.series()
		return eventsIn(a.past.concat(a.future), this.ledger(), BADGE_FLOOR)
			.map(e => dayKey(e.date))
	}

	/* WHAT MOVED THE LINE ON THIS DAY. The curve is a step function, so the step at a day is exactly
	   that day's movement, and the contributors are exactly that day's transactions - or, in the
	   forecast, the expectations the forecast already attributed. Reading it off the drawn series
	   rather than off a filtered event list is the point: the event list is thresholded and capped, so
	   most days were not in it and the cursor had nothing to say about them. */
	movementAt(series, i, txns){
		if(i <= 0)return null
		const p = series[i], step = p.value - series[i-1].value
		if(Math.abs(step) < 0.005)return {step:0, stream:null, value:p.value}
		if(!p.actual)return {step:step, stream:p.top || null, value:p.value}
		const k = dayKey(p.date)
		let who = null, big = 0
		txns.forEach(t => {if(dayKey(t.date) !== k)return
			if(Math.abs(t.amount) > Math.abs(big)){big = t.amount; who = t.streamName}})
		return {step:step, stream:who, value:p.value}
	}

	/* ---- the picture ------------------------------------------------------------------------------ */
	rampDefs(Y, gid){
		const b = BLEND/2, top = HIGH_AT + b, bot = LOW_AT - b
		const hue = n => DS.getStyle()[n]
		//a stop is placed by the AMOUNT it means, converted to a fraction of the anchored span, so the
		//two crossings stay centred on their anchors whatever the blend
		const at = v => ((top - v)/(top - bot || 1)*100).toFixed(2)
		return '<defs><linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse"'
			+ ' x1="0" y1="' + Y(top).toFixed(1) + '" x2="0" y2="' + Y(bot).toFixed(1) + '">'
			//spreadMethod pad is the default and is what makes it flat blue above and flat red below:
			//the ramp only exists between the two anchors
			+ '<stop offset="0%" stop-color="' + hue("savings") + '"/>'
			+ '<stop offset="' + at(HIGH_AT - b) + '%" stop-color="' + hue("positive") + '"/>'
			+ '<stop offset="' + at(LOW_AT + b) + '%" stop-color="' + hue("positive") + '"/>'
			+ '<stop offset="100%" stop-color="' + hue("alert") + '"/></linearGradient></defs>'
	}

	/* THE FRAME a series is drawn in, so it can be interpolated rather than recomputed. */
	frameOf(a){
		const all = a.past.concat(a.future)
		const xs = all.map(p => p.date.getTime())
		//the benchmark is included in the VERTICAL range but not the horizontal one: a divergence
		//that runs off the top is not a divergence anyone can see, and it covers no new days
		const ys = all.map(p => p.value).concat((a.backtest||[]).map(p => p.value))
		let y0 = Math.min(0, Math.min.apply(null, ys)), y1 = Math.max.apply(null, ys)
		const pad = (y1 - y0)*0.14 || 1
		const lo = trough(all), hi = peak(all)
		return {x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
			y0: y0 - pad*0.4, y1: y1 + pad, lo: lo ? lo.value : 0, hi: hi ? hi.value : 0}
	}

	/* ONE DRAWING ROUTINE, and an animation is that routine with a moving frame.

	   The animations used to have a painter of their own that drew a subset - the area and the two
	   lines, and none of the beads, guides or labels. Everything it left out therefore APPEARED at the
	   moment the motion stopped, which is what "the graph appears abruptly after the travel" is: the
	   travel was real, and then the picture arrived.

	   Passing the frame in instead means the last frame of an animation is, by construction, identical
	   to the resting frame that replaces it. There is nothing left to pop, and no second painter to
	   keep in step with this one. */
	draw(past, future, now, frame, backtest){
		const W = this.W, H = this.H
		const all = past.concat(future)
		if(all.length < 2)return ""
		const f = frame || this.frameOf({past: past, future: future})
		const x0 = f.x0, x1 = f.x1, y0 = f.y0, y1 = f.y1
		const lo = {value: f.lo}, hi = {value: f.hi}
		const X = t => PAD.l + (t - x0)/(x1 - x0 || 1)*(W - PAD.l - PAD.r)
		const Y = v => H - PAD.b - (v - y0)/(y1 - y0 || 1)*(H - PAD.t - PAD.b)
		const S = DS.getStyle()
		const ink = S.bodyText, dim = S.bodyTextSecondary
		const zeroY = Y(0)
		this.drag.x0 = x0; this.drag.x1 = x1

		/* A STAIRCASE, because the money is transactions. A straight segment between two days says the
		   balance slid gradually from one to the other, which never happened - it sat still and then
		   moved. Hold the value to the next date, then step. */
		const stepPath = a => {let d = ""
			a.forEach((p,i) => {const x = X(p.date.getTime()).toFixed(1), y = Y(p.value).toFixed(1)
				d += i ? (" H" + x + " V" + y) : ("M" + x + " " + y)})
			return d}

		const gid = "bal-ramp"
		const defs = this.rampDefs(Y, gid)
		const paint = 'url(#' + gid + ')'

		const area = '<path d="' + stepPath(all)
			+ ' L' + X(all[all.length-1].date.getTime()).toFixed(1) + ' ' + zeroY.toFixed(1)
			+ ' L' + X(all[0].date.getTime()).toFixed(1) + ' ' + zeroY.toFixed(1)
			+ ' Z" fill="' + paint + '" opacity="' + PLANE.planned + '"/>'

		//the high and low of the window, at lower emphasis than the line itself
		const guide = (v, label) => '<line x1="' + PAD.l + '" y1="' + Y(v).toFixed(1) + '" x2="'
			+ (W - PAD.r) + '" y2="' + Y(v).toFixed(1) + '" stroke="' + dim
			+ '" stroke-width="0.7" stroke-dasharray="2,3" opacity="0.55"/>'
			+ '<text x="' + (W - PAD.r) + '" y="' + (Y(v) - 2.5).toFixed(1) + '" text-anchor="end"'
			+ ' font-family="Inter" font-size="8" fill="' + dim + '" opacity="0.85">'
			+ label + ' ' + money(v) + '</text>'

		const zero = '<line x1="' + PAD.l + '" y1="' + zeroY.toFixed(1) + '" x2="' + (W - PAD.r)
			+ '" y2="' + zeroY.toFixed(1) + '" stroke="' + dim + '" stroke-width="0.7" opacity="0.6"/>'

		//the line takes the same ramp at full opacity - the silver lining affirmed. A stroke carries a
		//gradient exactly as a fill does, and because the ramp is pinned to the value axis the line
		//reddens as it descends without anything having to decide where the boundary is.
		/* THE BENCHMARK, under everything else. Same ramp colour, because it is a balance and that
		   colour means what it always means - but DOTTED rather than dashed, so it cannot be mistaken
		   for the forecast, and quiet enough that the actual line reads as the truth and this as the
		   reference it is measured against. Drawn first, so where they touch, the record is on top. */
		const benchLine = (backtest && backtest.length > 1)
			? '<path d="' + stepPath(backtest) + '" fill="none" stroke="' + paint
				+ '" stroke-width="1.4" stroke-dasharray="0.5,3" stroke-linecap="round"'
				+ ' opacity="0.75"/>'
			: ""

		const lineActual = '<path d="' + stepPath(past) + '" fill="none" stroke="' + paint
			+ '" stroke-width="' + STROKE.actual + '" stroke-linejoin="round" stroke-linecap="round"/>'
		const bridge = past.length && future.length ? [past[past.length-1]].concat(future) : future
		const lineFuture = bridge.length < 2 ? ""
			: '<path d="' + stepPath(bridge) + '" fill="none" stroke="' + paint
				+ '" stroke-width="' + STROKE.projected + '" stroke-dasharray="' + STROKE.dash
				+ '" opacity="' + PLANE.projected + '"/>'

		/* PERMANENT DATE MARKS on the 1st and the 15th. A step chart with no axis is a shape with no
		   scale: the reader can see that something happened and not when, and the cursor's own date
		   only helps once they are already pointing at something. The 1st and the 15th are the days
		   the money itself uses - rent, and the mid-month paycheck - so they are anchors rather than
		   an arbitrary grid.

		   Each carries its MONTH, because a thirty-day window straddles two of them and a bare "15"
		   would be ambiguous exactly where the window is most useful. */
		const ticks = []
		const firstMonth = new Date(Date.UTC(new Date(x0).getUTCFullYear(),
			new Date(x0).getUTCMonth(), 1))
		for(let m = firstMonth; m.getTime() <= x1; m = new Date(Date.UTC(m.getUTCFullYear(),
				m.getUTCMonth() + 1, 1))){
			[1, 15].forEach(dayNum => {
				const t = Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), dayNum)
				if(t < x0 || t > x1)return
				ticks.push({t: t, label: onDate(new Date(t))})
			})
		}
		//a tick label under the cursor's own date would print on top of it
		const cursorX = this.state.at ? X(new Date(this.state.at).getTime()) : null
		const axis = ticks.map(tk => {
			const tx = X(tk.t)
			if(cursorX !== null && Math.abs(tx - cursorX) < 34)return ""
			return '<line x1="' + tx.toFixed(1) + '" y1="' + (H - PAD.b) + '" x2="' + tx.toFixed(1)
				+ '" y2="' + (H - PAD.b + 3) + '" stroke="' + dim + '" stroke-width="0.7"'
				+ ' opacity="0.6"/>'
				+ '<text x="' + tx.toFixed(1) + '" y="' + (H - 4).toFixed(1) + '" text-anchor="middle"'
				+ ' font-family="Inter" font-size="9" fill="' + dim + '">' + tk.label + '</text>'
		}).join("")

		//a settled month does not contain today, and a line marking it at the frame edge would be a
		//mark that means nothing
		const nowLine = (now.getTime() >= x0 && now.getTime() <= x1)
			? '<line x1="' + X(now.getTime()).toFixed(1) + '" y1="' + PAD.t + '" x2="'
				+ X(now.getTime()).toFixed(1) + '" y2="' + (H - PAD.b) + '" stroke="' + dim
				+ '" stroke-width="0.7" opacity="0.55"/>'
			: ""

		//the marks. A bead is filled with the line's own colour and ringed in the tile, which keeps it
		//legible without introducing a colour that means nothing.
		const evs = eventsIn(all, this.ledger(), BADGE_FLOOR)
		this.events = evs
		const tile = S.pageBackground
		const beads = evs.map(e => {
			const x = X(e.date.getTime()), y = Y(e.value), r = DOT_R + 3
			const s = (r*1.55)/24
			return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r
				+ '" fill="' + tile + '" stroke="' + ink + '" stroke-width="1" opacity="'
				+ (e.date <= now ? 1 : 0.8) + '"/>'
				+ '<path d="' + (ICONS[iconFor(e.stream)] || ICONS.dot) + '" fill="' + ink
				+ '" opacity="' + (e.date <= now ? 1 : 0.8) + '" transform="translate('
				+ (x - 12*s).toFixed(2) + ' ' + (y - 12*s).toFixed(2) + ') scale(' + s.toFixed(3) + ')"/>'
		}).join("")

		let cursor = "", badgeLabel = ""
		this.held = null
		if(this.state.at){
			const k = dayKey(this.state.at)
			let idx = -1
			all.forEach((p,i) => {if(dayKey(p.date) === k)idx = i})
			const day = idx > -1 ? all[idx] : null
			if(day){
				//read off the DRAWN series, not the thresholded event list - that list has a floor, so
				//most days are not in it and the cursor would have nothing to say about them
				this.held = {day:day, move:this.movementAt(all, idx, this.ledger())}
				/* THE NAME BELONGS TO THE BADGE, NOT TO THE PAGE. A stream name shown whenever the
				   cursor moves is a caption that changes on every day and mostly says nothing. Shown
				   beside the mark it explains, it answers the question the mark provokes - "what is
				   that one" - so it appears only when the cursor is on a badge, and it appears THERE.
				   Painted with paint-order:stroke so the tile colour haloes the letters and they stay
				   legible over the line and the area beneath them. */
				const onBadge = evs.filter(e => dayKey(e.date) === k)[0]
				if(onBadge && onBadge.stream){
					/* TOP-ALIGNED WITH THE CURSOR LINE, not floated beside the bead. Beside the bead
					   it moved vertically with whatever it named, so reading two badges in a row meant
					   hunting for the caption each time; and low on the frame it collided with the
					   curve it was explaining. Pinned to the top of the cursor line it is always in
					   the same place relative to the gesture - the line is the thing the finger
					   controls - and it is above everything it could overlap. */
					const cx = X(onBadge.date.getTime())
					const right = (W - PAD.r - cx) > 74
					badgeLabel = '<text x="' + (right ? cx + 5 : cx - 5).toFixed(1)
						+ '" y="' + (PAD.t + 7).toFixed(1) + '" text-anchor="'
						+ (right ? "start" : "end") + '" font-family="Inter" font-size="9" fill="'
						+ ink + '" paint-order="stroke" stroke="' + tile
						+ '" stroke-width="2.5" stroke-linejoin="round">'
						+ esc(onBadge.stream) + '</text>'
				}
				/* WHICH DAY, under the axis. The cursor line says "here" and the caption says how
				   much, and neither says WHEN - which on a step chart with no x labels leaves the
				   reader counting squares from the today line. It sits in the bottom padding, below
				   the plot, so it never overlaps the picture, and it is clamped inside the frame so
				   the first and last days do not print half off the edge. */
				const cx = X(day.date.getTime())
				const dayLabel = onDate(day.date)
				const half = dayLabel.length * 2.6
				const lx = Math.max(PAD.l + half, Math.min(W - PAD.r - half, cx))
				cursor = '<line x1="' + cx.toFixed(1) + '" y1="' + PAD.t + '" x2="'
					+ cx.toFixed(1) + '" y2="' + (H - PAD.b) + '" stroke="' + ink
					+ '" stroke-width="1" opacity="0.7"/>'
					+ '<circle cx="' + cx.toFixed(1) + '" cy="'
					+ Y(day.value).toFixed(1) + '" r="' + DOT_FOCAL + '" fill="' + paint
					+ '" stroke="' + tile + '" stroke-width="1.5"/>'
					+ '<text x="' + lx.toFixed(1) + '" y="' + (H - 4).toFixed(1)
					+ '" text-anchor="middle" font-family="Inter" font-size="9" fill="' + ink
					+ '">' + dayLabel + '</text>'
			}
		}

		return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">'
			+ defs + area
			+ guide(hi.value, "high") + guide(lo.value, "low") + zero + nowLine + axis
			+ benchLine + lineActual + lineFuture + beads + cursor + badgeLabel + '</svg>'
	}

	paint(){
		if(!this.host.current || !this.state.loaded || !this.hasAnchor())return
		if(this.animating)return
		const a = this.series()
		this.host.current.innerHTML = this.draw(a.past, a.future, a.now, null, a.backtest)
		if(!this.settling && this.measure()){
			this.settling = true
			this.host.current.innerHTML = this.draw(a.past, a.future, a.now, null, a.backtest)
			this.settling = false
		}
	}

	/* ---- interaction -----------------------------------------------------------------------------
	   THE DRAG STATE CANNOT LIVE ON THE THING BEING REDRAWN. Every paint replaces the host's inner
	   HTML, so the svg the finger went down on is destroyed by the first move it causes, taking its
	   pointer capture with it; the next move lands on a new element whose flag is false and is
	   ignored, which reads as "it only snaps on a fresh tap". So the listeners are attached ONCE to
	   the host, which is never replaced, and the date range is published by draw() rather than
	   captured in a closure that goes stale. */
	wireOnce(){
		const host = this.host.current
		if(!host)return
		const dateAt = e => {
			const r = host.getBoundingClientRect()
			const f = Math.max(0, Math.min(1, (e.clientX - r.left)/r.width))
			const t = this.drag.x0 + f*(this.drag.x1 - this.drag.x0)
			return new Date(Math.round(t/DAY)*DAY)
		}
		const to = e => {const d = dateAt(e)
			if(!this.state.at || dayKey(d) !== dayKey(this.state.at))this.updateState({at:d})}
		host.addEventListener("pointerdown", e => {
			this.drag.down = true
			try{host.setPointerCapture(e.pointerId)}catch(err){}
			to(e)})
		host.addEventListener("pointermove", e => {if(this.drag.down)to(e)})
		const end = () => {if(!this.drag.down)return; this.drag.down = false; this.updateState({at:null})}
		host.addEventListener("pointerup", end)
		host.addEventListener("pointercancel", end)
		host.addEventListener("pointerleave", end)
	}

	/* A change of EXTENT zooms; a change of amounts morphs. Two different things happened, so they are
	   shown as two different motions - resampling both windows to a common span and morphing between
	   them makes a week and a month the same width and then deforms one into the other, so the reader
	   watches the picture change shape when nothing about the money moved. */
	next(list, key){
		//`source` falls back to a default rather than being seeded in the constructor, because the
		//accounts have not arrived yet then - so resolve the CURRENT value the same way before
		//stepping, or the first tap would always land on the second entry
		const cur = key === "source" ? this.source() : this.state[key]
		const i = list.findIndex(o => o[0] === cur)
		return list[(i + 1) % list.length][0]
	}

	//one clock, and the picture is re-derived from it every frame
	run(ms, frame){
		const t0 = performance.now()
		const ease = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2
		const step = now => {
			const e = Math.min(1, (now - t0)/ms)
			frame(ease(e))
			if(e < 1){requestAnimationFrame(step)}
			else{this.animating = false; this.paint()}
		}
		requestAnimationFrame(step)
	}

	/* A CHANGE OF EXTENT IS A ZOOM. Resampling both windows to a common span and morphing one into the
	   other would make a week and a month the same width and then deform one curve into the other, so
	   the reader watches the picture change shape when nothing about the money moved at all. What
	   actually happened is that the frame got wider, so the DOMAIN is what interpolates. */
	zoomTo(){
		//both are already built, so the frame the animation starts on is ready before the tap lands
		const cached = this.allSeries()
		const before = cached[this.state.when]
		this.animating = true
		this.setState({when:this.next(WHENS,"when"), at:null}, () => {
			const after = this.allSeries()[this.state.when]
			const f0 = this.frameOf(before), f1 = this.frameOf(after)
			/* THE CONTENT IS THE UNION OF BOTH WINDOWS, not the wider of the two.
			   Two months that merely OVERLAP are not a zoom, they are a pan, and the wider window does
			   not cover the journey: travelling from this month to last, this month's data stops
			   fifteen days ago, so the left of the frame swept across empty space and the curve only
			   arrived when the real picture replaced it at the end.
			   Where the two agree - the days both months contain - a record wins over a projection. */
			const merged = this.union(before, after)
			const mergedBench = this.unionBench(before, after)
			this.run(ZOOM_MS, k => {
				const f = this.lerpFrame(f0, f1, k)
				this.paintFrame(merged, after.now, f, mergedBench)
			})
		})
	}

	//every day either window covers, once, in order
	union(a, b){
		const byDay = {}
		const put = p => {const k = dayKey(p.date)
			if(!byDay[k] || (p.actual && !byDay[k].actual))byDay[k] = p}
		a.past.forEach(put); a.future.forEach(put)
		b.past.forEach(put); b.future.forEach(put)
		return Object.keys(byDay).sort().map(k => byDay[k])
	}
	/* the benchmark is merged SEPARATELY, because it shares its days with the record - one point per
	   day per LAYER, not per day. Merged into the same map, each would delete the other. */
	unionBench(a, b){
		const byDay = {}
		;(a.backtest||[]).concat(b.backtest||[]).forEach(p => {byDay[dayKey(p.date)] = p})
		return Object.keys(byDay).sort().map(k => byDay[k])
	}
	lerpFrame(a, b, k){
		/* p*(1-k) + q*k, NOT p + (q-p)*k. The two are equal in arithmetic and not in floating point:
		   the second leaves a residue at k=1, so the last frame of a motion is very slightly not the
		   frame that replaces it. Invisible here at 1e-14 of a pixel, and still worth not having -
		   "the animation lands exactly on its destination" is a property worth being able to assert
		   rather than approximately believe. */
		const l = (p, q) => p*(1 - k) + q*k
		return {x0:l(a.x0,b.x0), x1:l(a.x1,b.x1), y0:l(a.y0,b.y0), y1:l(a.y1,b.y1),
			lo:l(a.lo,b.lo), hi:l(a.hi,b.hi)}
	}

	/* A CHANGE OF AMOUNTS IS A MORPH, and it must not go through the zoom path: two sources cover
	   exactly the same dates, so interpolating the domain interpolates nothing, and the frame would sit
	   on the OLD curve for the whole duration and then snap to the new one. A stall and a jump, which
	   is the one thing an animation here exists to prevent.
	   The dates are identical, so the VALUES pair by index and lerp directly. */
	morphTo(){
		const before = this.series()
		this.animating = true
		this.setState({source:this.next(this.sources(),"source"), at:null}, () => {
			const after = this.series()
			const a = before.past.concat(before.future), b = after.past.concat(after.future)
			const n = Math.min(a.length, b.length)
			if(!n){this.animating = false; this.paint(); return}
			const f0 = this.frameOf(before), f1 = this.frameOf(after)
			this.run(MORPH_MS, k => {
				const blend = []
				for(let i = 0; i < n; i++){
					blend.push({date: b[i].date, actual: b[i].actual, top: b[i].top,
						value: a[i].value*(1 - k) + b[i].value*k})
				}
				//the benchmark morphs with everything else: it is a balance too, and a reading that
				//changes changes it
				const ab = before.backtest||[], bb = after.backtest||[]
				const bn = Math.min(ab.length, bb.length)
				const bench = []
				for(let i = 0; i < bn; i++){
					bench.push({date: bb[i].date, value: ab[i].value*(1 - k) + bb[i].value*k})
				}
				this.paintFrame(blend, after.now, this.lerpFrame(f0, f1, k), bench)
			})
		})
	}

	//one flat list plus a frame, split back into record and projection for the drawing routine
	paintFrame(content, now, frame, backtest){
		if(!this.host.current)return
		this.host.current.innerHTML = this.draw(
			content.filter(p => p.actual !== false), content.filter(p => p.actual === false),
			now, frame, backtest)
	}

	subtitle(){
		if(!this.state.loaded)return "reading balances\u2026"
		if(!this.hasAnchor())return ""
		/* under the cursor: THE BALANCE THAT DAY, and nothing else. It reported what MOVED instead,
		   which puts two different kinds of fact through one line - a position and a change - and the
		   name of a stream belongs beside the mark that provokes the question, which is where the
		   badge label now puts it. One line, one fact, and the fact the reader is pointing at. */
		if(this.held)return '<b>' + money(this.held.day.value) + '</b>'
		//at rest: the low point, which is the whole question. In a settled month there is no forecast,
		//so the low is the one that actually happened.
		const a = this.series()
		const lo = trough(a.future.length ? a.future : a.past)
		if(!lo)return ""
		if(lo.value < 0)return '<b class="bad">short ' + money(lo.value) + '</b> on ' + onDate(lo.date)
		return 'low <b>' + money(lo.value) + '</b> on ' + onDate(lo.date)
	}

	render(){
		//the shapes are memoised on the instance and must be dropped when the transactions change
		if(this._txns !== this.props.transactions){
			this._txns = this.props.transactions; this._shapes = null; this._routing = null
			this._names = null; this._byStream = null
		}
		return <DS.component.ContentTile style={{position:"relative",width:"100%",height:"100%",
				boxSizing:"border-box",margin:0,padding:DS.spacing.xs+"rem"}}>
			<Head>
				<Title $big={!Core.isMobile()}>
					{"Balance "}
					<TitleButton type="button" onClick={() => this.morphTo()}
					>{wordOf(this.sources(), this.source())}</TitleButton>{", "}
					<TitleButton type="button" onClick={() => this.zoomTo()}
					>{wordOf(WHENS, this.state.when)}</TitleButton>
				</Title>
			</Head>
			<Subtitle dangerouslySetInnerHTML={{__html:this.subtitle()}}/>
			{/* the chart answers its own pointer gestures, so a drag starting on it belongs to it and
			    not to the carousel - see documentation/visualisation-carousel.md */}
			<ChartArea>
				<ChartHost data-no-drag ref={this.host}/>
				{this.state.loaded && !this.hasAnchor()
					? <Empty>Connect an account to see your balance</Empty> : null}
			</ChartArea>
		</DS.component.ContentTile>
	}
}
