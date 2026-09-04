import React from 'react';
import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DS from '../DesignSystem.js';
import Core from '../core.js';
import {histogramOf, accountRoutingOf, reconstruct, forecast, trough, peak, eventsIn, dayKey}
	from '../processors/BankBalance.js';

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

const PERIODS = [[30, "this month"], [15, "these two weeks"], [7, "this week"]];
const READINGS = [["account", "in the bank"], ["true", "after cards"]];
const wordOf = (list, v) => (list.filter(o => o[0] === v)[0] || list[0])[1];

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
const Head = styled.div`display:flex; align-items:flex-start; justify-content:space-between; gap:${DS.spacing.xxs}rem;`
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
const Subtitle = styled.div`
	font-family:Inter; font-size:${DS.fontSize.body}rem;
	line-height:1.35rem; height:1.35rem; overflow:hidden;
	margin:0.1rem 0 0.45rem; white-space:nowrap; text-overflow:ellipsis;
	color:${props => DS.getStyle().bodyText};
	& b{font-weight:600;}
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

const money = v => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString();
const onDate = d => new Date(d).toLocaleString("en-US", {month:"short", day:"numeric", timeZone:"UTC"});

export default class BalanceChart extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {days:30, mode:"account", at:null, accounts:null, loaded:false}
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

	//the anchor. `account` is the current accounts alone; `true` nets what the cards owe off it.
	//Plaid signs a card's current balance POSITIVE for money owed, which is why this subtracts.
	anchor(){
		const accts = (this.state.accounts||[]).filter(a => a.current !== undefined)
		const dep = accts.filter(a => a.type === "depository").reduce((s,a) => s + a.current, 0)
		if(this.state.mode !== "true")return dep
		const owed = accts.filter(a => a.type === "credit").reduce((s,a) => s + a.current, 0)
		return dep - owed
	}
	hasAnchor(){return (this.state.accounts||[]).some(a => a.current !== undefined)}

	//every transaction that touched the accounts this reading covers, at its raw amount. NOT the
	//per-stream allocation: uncategorised money still moved, and a balance that ignored it would
	//disagree with the bank for a reason the reader cannot see.
	ledger(){
		const keep = this.state.mode === "true"
			? this.depositoryHashes().concat(this.creditHashes())
			: this.depositoryHashes()
		return (this.props.transactions||[])
			.filter(t => keep.indexOf(t.userInstitutionAccountId) > -1)
			.map(t => ({date:t.getDateInDisplayTimezone(), amount:t.amount,
				accountHash:t.userInstitutionAccountId, streamName:null}))
	}

	//one histogram per terminal, from that terminal's own categorised transactions
	shapes(){
		if(this._shapes)return this._shapes
		const terminals = this.terminals()
		const txns = (this.props.transactions||[]).filter(t => t.categorized)
		const byStream = {}
		terminals.forEach(s => {byStream[s.id] = []})
		txns.forEach(t => {
			terminals.forEach(s => {
				if(!t.isAllocatedToStream(s))return
				byStream[s.id].push({date:t.getDateInDisplayTimezone(), amount:t.amount,
					accountHash:t.userInstitutionAccountId})
			})
		})
		const shapes = {}
		terminals.forEach(s => {shapes[s.id] = histogramOf(byStream[s.id])})
		this._routing = accountRoutingOf(byStream, this.creditHashes())
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
			byDay[t.getDateInDisplayTimezone().getUTCDate()] += t.amount
		})
		let best = 0, day = undefined
		byDay.forEach((v,i) => {if(v > best){best = v; day = i}})
		return day
	}

	series(){
		const back = Math.floor(this.state.days/2), fwd = this.state.days - back
		const now = new Date()
		const txns = this.ledger()
		const bal = this.anchor()
		const past = reconstruct(txns, now, bal, new Date(now.getTime() - back*DAY))
		const future = forecast({terminals:this.terminals(), shapes:this.shapes(),
			routing:this.routing(), now:now, balanceNow:bal, days:fwd, mode:this.state.mode,
			periodName:"monthly", settlementDay:this.settlementDay()})
		return {past:past, future:future, txns:txns, now:now}
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

	draw(past, future, now){
		const W = this.W, H = this.H
		const all = past.concat(future)
		if(all.length < 2)return ""
		const xs = all.map(p => p.date.getTime()), ys = all.map(p => p.value)
		const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs)
		const lo = trough(all), hi = peak(all)
		let y0 = Math.min(0, Math.min.apply(null, ys)), y1 = Math.max.apply(null, ys)
		const pad = (y1 - y0)*0.14 || 1; y0 -= pad*0.4; y1 += pad
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
		const lineActual = '<path d="' + stepPath(past) + '" fill="none" stroke="' + paint
			+ '" stroke-width="' + STROKE.actual + '" stroke-linejoin="round" stroke-linecap="round"/>'
		const bridge = past.length && future.length ? [past[past.length-1]].concat(future) : future
		const lineFuture = '<path d="' + stepPath(bridge) + '" fill="none" stroke="' + paint
			+ '" stroke-width="' + STROKE.projected + '" stroke-dasharray="' + STROKE.dash
			+ '" opacity="' + PLANE.projected + '"/>'

		const nowLine = '<line x1="' + X(now.getTime()).toFixed(1) + '" y1="' + PAD.t + '" x2="'
			+ X(now.getTime()).toFixed(1) + '" y2="' + (H - PAD.b) + '" stroke="' + dim
			+ '" stroke-width="0.7" opacity="0.55"/>'

		//the marks. A bead is filled with the line's own colour and ringed in the tile, which keeps it
		//legible without introducing a colour that means nothing.
		const floor = Math.max(50, Math.abs(hi.value - lo.value)/12)
		const evs = eventsIn(all, this.ledger(), floor).slice(0, 14)
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

		let cursor = ""
		this.held = null
		if(this.state.at){
			const k = dayKey(this.state.at)
			const day = all.filter(p => dayKey(p.date) === k)[0]
			if(day){
				this.held = {day:day, event:evs.filter(e => dayKey(e.date) === k)[0] || null}
				cursor = '<line x1="' + X(day.date.getTime()).toFixed(1) + '" y1="' + PAD.t + '" x2="'
					+ X(day.date.getTime()).toFixed(1) + '" y2="' + (H - PAD.b) + '" stroke="' + ink
					+ '" stroke-width="1" opacity="0.7"/>'
					+ '<circle cx="' + X(day.date.getTime()).toFixed(1) + '" cy="'
					+ Y(day.value).toFixed(1) + '" r="' + DOT_FOCAL + '" fill="' + paint
					+ '" stroke="' + tile + '" stroke-width="1.5"/>'
			}
		}

		return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">'
			+ defs + area
			+ guide(hi.value, "high") + guide(lo.value, "low") + zero + nowLine
			+ lineActual + lineFuture + beads + cursor + '</svg>'
	}

	paint(){
		if(!this.host.current || !this.state.loaded || !this.hasAnchor())return
		if(this.animating)return
		const a = this.series()
		this.host.current.innerHTML = this.draw(a.past, a.future, a.now)
		if(!this.settling && this.measure()){
			this.settling = true
			this.host.current.innerHTML = this.draw(a.past, a.future, a.now)
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
	cycle(list, key, ms){
		const i = list.findIndex(o => o[0] === this.state[key])
		const next = list[(i + 1) % list.length][0]
		const before = this.series()
		this.animating = true
		this.setState({[key]:next, at:null}, () => {
			const after = this.series()
			const t0 = performance.now()
			const ease = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2
			const frameOf = a => {const s = a.past.concat(a.future)
				return {x0:s[0].date.getTime(), x1:s[s.length-1].date.getTime()}}
			const f0 = frameOf(before), f1 = frameOf(after)
			//the WIDER window supplies the content: it is the only one that covers the whole journey,
			//and the svg clips to its own viewBox so what is outside the frame is simply not drawn
			const wide = (f0.x1 - f0.x0) >= (f1.x1 - f1.x0) ? before : after
			const content = wide.past.concat(wide.future)
			const step = now => {
				const e = Math.min(1, (now - t0)/ms)
				const k = ease(e)
				const zx0 = f0.x0 + (f1.x0 - f0.x0)*k, zx1 = f0.x1 + (f1.x1 - f0.x1)*k
				this.paintFrame(content, zx0, zx1, after.now)
				if(e < 1){requestAnimationFrame(step)}
				else{this.animating = false; this.paint()}
			}
			requestAnimationFrame(step)
		})
	}

	paintFrame(content, x0, x1, now){
		if(!this.host.current)return
		const W = this.W, H = this.H
		const ys = content.map(p => p.value)
		let y0 = Math.min(0, Math.min.apply(null, ys)), y1 = Math.max.apply(null, ys)
		const pad = (y1 - y0)*0.14 || 1; y0 -= pad*0.4; y1 += pad
		const X = t => PAD.l + (t - x0)/(x1 - x0 || 1)*(W - PAD.l - PAD.r)
		const Y = v => H - PAD.b - (v - y0)/(y1 - y0 || 1)*(H - PAD.t - PAD.b)
		const S = DS.getStyle(), dim = S.bodyTextSecondary, zeroY = Y(0)
		const gid = "bal-ramp", paint = 'url(#' + gid + ')'
		const stepPath = a => {let d = ""
			a.forEach((p,i) => {const x = X(p.date.getTime()).toFixed(1), y = Y(p.value).toFixed(1)
				d += i ? (" H" + x + " V" + y) : ("M" + x + " " + y)})
			return d}
		const past = content.filter(p => p.date <= now), fut = content.filter(p => p.date >= now)
		this.host.current.innerHTML =
			'<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">'
			+ this.rampDefs(Y, gid)
			+ (content.length < 2 ? "" : '<path d="' + stepPath(content)
				+ ' L' + X(content[content.length-1].date.getTime()).toFixed(1) + ' ' + zeroY.toFixed(1)
				+ ' L' + X(content[0].date.getTime()).toFixed(1) + ' ' + zeroY.toFixed(1)
				+ ' Z" fill="' + paint + '" opacity="' + PLANE.planned + '"/>')
			+ '<line x1="' + PAD.l + '" y1="' + zeroY.toFixed(1) + '" x2="' + (W - PAD.r) + '" y2="'
			+ zeroY.toFixed(1) + '" stroke="' + dim + '" stroke-width="0.7" opacity="0.6"/>'
			//today stays put through the whole move, which is what makes it read as a zoom about a
			//fixed point rather than a pan
			+ '<line x1="' + X(now.getTime()).toFixed(1) + '" y1="' + PAD.t + '" x2="'
			+ X(now.getTime()).toFixed(1) + '" y2="' + (H - PAD.b) + '" stroke="' + dim
			+ '" stroke-width="0.7" opacity="0.55"/>'
			+ (past.length < 2 ? "" : '<path d="' + stepPath(past) + '" fill="none" stroke="' + paint
				+ '" stroke-width="' + STROKE.actual + '" stroke-linejoin="round" stroke-linecap="round"/>')
			+ (fut.length < 2 ? "" : '<path d="' + stepPath(fut) + '" fill="none" stroke="' + paint
				+ '" stroke-width="' + STROKE.projected + '" stroke-dasharray="' + STROKE.dash
				+ '" opacity="' + PLANE.projected + '"/>')
			+ '</svg>'
	}

	subtitle(){
		if(!this.state.loaded)return "Reading balances…"
		if(!this.hasAnchor())return "No balance reported by the bank yet"
		//while the cursor is down it is the readout, which is the only thing worth saying then
		if(this.held){
			const d = this.held.day, ev = this.held.event
			return '<b>' + money(d.value) + '</b> on ' + onDate(d.date)
				+ (ev && ev.stream ? ' · ' + ev.stream + ' '
					+ (ev.step < 0 ? 'takes ' : 'adds ') + money(Math.abs(ev.step)) : '')
		}
		const a = this.series()
		const lo = trough(a.future)
		if(lo && lo.value < 0)return '<b class="bad">short on ' + onDate(lo.date) + '</b>'
		if(lo)return 'low of <b>' + money(lo.value) + '</b> on ' + onDate(lo.date)
		return onDate(a.past[0].date) + ' – ' + onDate(a.future[a.future.length-1].date)
	}

	render(){
		//the shapes are memoised on the instance and must be dropped when the transactions change
		if(this._txns !== this.props.transactions){
			this._txns = this.props.transactions; this._shapes = null; this._routing = null
		}
		return <DS.component.ContentTile style={{position:"relative",width:"100%",height:"100%",
				boxSizing:"border-box",margin:0,padding:DS.spacing.xs+"rem"}}>
			<Head>
				<Title $big={!Core.isMobile()}>
					{"Balance "}
					<TitleButton type="button" onClick={() => this.cycle(READINGS,"mode",MORPH_MS)}
					>{wordOf(READINGS, this.state.mode)}</TitleButton>{", "}
					<TitleButton type="button" onClick={() => this.cycle(PERIODS,"days",ZOOM_MS)}
					>{wordOf(PERIODS, this.state.days)}</TitleButton>
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
