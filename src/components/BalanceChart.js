import React from 'react';
import BaseComponent from './BaseComponent';
import styled, {keyframes} from 'styled-components';
import DS from '../DesignSystem.js';
import Core from '../core.js';
import {reportingConfig} from '../processors/ReportingCore.js';
import AppConfig from '../AppConfig';
import {AccountTypes} from '../Bank';
import {capturePortfolio} from '../processors/capturePortfolio.js';
import {benchForecastAsync} from '../processors/balancePrediction/benchForecast.js';
import {reconstruct, forecast, trough, peak, eventsIn, dayKey, buildModel,
	monthlyExpectationAt, classifyAll, CLASSES, groupByStream, explainOn}
	from '../processors/BankBalance.js';
import {calendarDay} from '../processors/streamPredictor/businessCalendar.js';

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

/* WHICH DAY SOMETHING FALLS ON, AS A NUMBER. Identical to `dayKey` in what it separates - both cut
   at UTC midnight - but a division instead of building an ISO string, which is what the hot paths
   were spending their frame on. Keys that are shown to a reader stay strings; keys that only ever
   index a bucket are these. */
const dayIdx = d => Math.floor(d.getTime()/DAY)

//the root's own current pixel size - what `rem` means right now, read fresh rather than assumed.
//Matches MoneyFlowChart.js's own rootPx() exactly, for the same reason it exists there.
const remPx = () => (typeof document !== "undefined"
	&& parseFloat(getComputedStyle(document.documentElement).fontSize)) || 16
const RATIO = 2.25;                    //the tile is wider than it is tall, as page one is
/* EVERY SIZE IN THE DRAWING, IN THE ACCOUNT'S OWN REM - NEVER A BARE PIXEL. Fonts, badge radii,
   line thickness and the padding sized to fit them are all multiples of the CURRENT root size, read
   fresh on every call rather than cached, so a reader who changes their own browser text size gets a
   chart that follows it - the same thing `rem` already means everywhere else in this app. It is a
   MODULE FUNCTION, not a class method, so a test can ask for the numbers a resting 16px root produces
   without mounting anything.

   THE RIGHT PADDING IS A GUTTER, NOT A MARGIN. The high and low guides carry their own values, and
   those used to be printed INSIDE the plot at its right edge, sitting on top of whatever the line was
   doing there - a label over the picture it is annotating. Given a column of their own they read as
   what they are: the scale, beside the drawing rather than on it. Wide enough for "high $36,347" at
   the small font.

   A DOT IS A RADIUS. Page one sets scatterDotSize 4 on a phone against strokeWidth 3, and Victory
   reads that size as a radius - so its dots are 8 across on a 3-wide line, a diameter of about 2.7x
   the stroke. Read as a diameter, which is what the number looks like, the dots come out 4 across on
   the same line: 1.3x, a bump in the line rather than a mark on it, and invisible against a dashed
   one. Taken as the radius it is, the beads read against the projection too.

   THREE QUARTERS OF THE RESTING SIZE THAT RATIO GIVES A BADGE. A badge used to have to be big enough
   to be READ at rest; now that holding one grows it (see GROW_HELD), the resting size only has to be
   FOUND, and the growth carries the rest. Half was too far - at 3.5px-equivalent the icon inside had
   no silhouette left - so it sits at the midpoint between what it was and what half made it.

   At the app's own default root (16px) every number below is exactly the bare pixel constant it
   replaced - nothing about the resting picture changes until a reader's own text size does. */
/* THE BADGE'S OWN DESKTOP BOOST - reusing the ratio already established, not a guessed one. Reported:
   held at arm's length a phone puts the tile roughly 20cm from the eye; a desktop screen is three
   times that or more, so for the badge's APPARENT (angular) size to hold steady it has to grow with
   the distance, roughly in proportion. `remPx()` cannot see that on its own - the root font-size is
   a TYPOGRAPHY reference (it tracks a reader's own text-size setting, on either device) and is 16px
   on both a phone and a desktop by this app's own App.css; nothing about viewing distance reaches it.
   Rather than invent a new multiplier, this reuses the one the app already chose for exactly this
   reason: BalanceChart's own title (and MoneyFlowChart's, the same pattern) already reads bigger on
   desktop than on mobile - `$big={!Core.isMobile()}`, `DS.fontSize.display` (2rem) against
   `DS.fontSize.title` (1.2rem) - and `display`'s own comment says why: "a chart that fills a card
   carries its title at the size a reader takes in from across the desk". That is a viewing-distance
   correction already made by feel, on this same tile, for a font. This is the identical ratio,
   carried to the one other element distance actually changes the legibility of: a badge, which has
   to resolve as a SHAPE rather than merely be readable the way running text can survive being a
   little small. (A larger flat multiplier may still be warranted for a shape specifically - a mark
   than has to resolve as an icon, not merely be legible as a letterform - and is a design call for
   whoever is looking at it, not one to bury silently in the same number that already serves fonts.)

   NEITHER SIGNAL IS BROWSER TEXT-ZOOM, and that is deliberate: a reader who has turned their own
   text size up gets it through `r` (rootPx/16) on EVERY field here, mobile or desktop alike, exactly
   as before - this boost only ever multiplies on top of that, gated on device class, never confused
   with it. Applied only to the badge itself and what has to stay proportioned to it (its own outline
   stroke, and the gap that keeps two of them from colliding) - never to fonts, line strokes or
   padding, which the reader did not report a problem with and which this file's own rem-purity
   already treats consistently across devices. */
const DESKTOP_BADGE_BOOST = DS.fontSize.display / DS.fontSize.title     // 2 / 1.2 = 5/3 ≈ 1.667

/* THE FONT'S OWN TREATMENT, LIFTED FROM MoneyFlowChart.js RATHER THAN INVENTED A SECOND TIME. Its
   own §9.8 already solved this: "the 12px that fills a phone card is 3.7% of its width and 1.6% of
   a desktop one" - a font sized only in rem tracks a reader's TEXT setting but not the ROOM the chart
   actually has, and the two are different questions. Its answer is not a device check at all - a
   binary mobile/desktop switch answers "which kind of screen" where the real question is "how wide
   IS the chart right now" - so it interpolates smoothly by the chart's own measured width instead:
   authored (phone-fitting) sizes below `NARROW_W`, the design system's own rem size by `WIDE_W`,
   linear between. A resized desktop window or a tablet in between gets a font in between, exactly as
   MoneyFlowEngine's own `retype()` does; nothing here is a fork of that logic, only its numbers
   carried to this tile's own two font roles. `NARROW_W`/`WIDE_W` are its own `TUNE.narrowW`/`wideW`
   verbatim, so the two tiles widen their own type at the same physical point in the carousel. */
const NARROW_W = 360, WIDE_W = 640
const wideFontPx = rootPx => DS.fontSize.body * rootPx     //"the design system's own size" - §9.8

export function scaleAt(rootPx, desktop, widthPx){
	const rp = rootPx || 16
	const r = rp/16
	//the badge's own scale: `r` alone on mobile (or when the caller does not say), boosted on desktop
	const badge = desktop ? r * DESKTOP_BADGE_BOOST : r
	//how much of the widening this chart has actually earned, by its own measured width - 0 at or
	//below NARROW_W (a phone), 1 at or above WIDE_W (comfortably desktop), between the two between
	const f = Math.max(0, Math.min(1, ((widthPx || NARROW_W) - NARROW_W)/(WIDE_W - NARROW_W)))
	const wide = wideFontPx(rp)
	const lerp = narrow => narrow + (wide - narrow)*f
	const fontSmall = lerp(8*r), fontNormal = lerp(9*r)
	return {
		r: r,
		/* THE RIGHT GUTTER, SIZED TO THE TEXT THAT ACTUALLY FILLS IT. Every label drawn inside it -
		   the "Balance" heading, the high/low guides, the cursor's own value - is set at `fontSmall`,
		   and the gutter was originally sized to fit them at exactly one ratio to it: 48px at
		   font-size 8 is 6:1. That ratio held by construction as long as fontSmall was always `8*r` -
		   it stopped holding the moment fontSmall started widening with the chart's own width (see
		   NARROW_W/WIDE_W above) while the gutter itself stayed fixed, and the words it holds started
		   clipping on a wide chart. `6*fontSmall` keeps the same ratio at every width instead of only
		   at the narrow one - it reduces to exactly `48*r` wherever fontSmall still does. */
		pad: {l: 10*r, r: 6*fontSmall, t: 18*r, b: 15*r},
		fontSmall: fontSmall, fontNormal: fontNormal,
		strokeActual: 3*r, strokeProjected: 2*r, strokeThin: 0.7*r,
		strokeCursor: 1*r, strokeOverhang: 2*r,
		//THE BADGE, AND ONLY WHAT STAYS PROPORTIONED TO IT
		strokeBadgeBase: 1*badge, dotR: (4*badge + 3*badge)*0.75, intersectR: 2.2*badge,
		badgeGap: 2*badge, labelGap: 11*r
	}
}
//`planned` is the fill under the RECORD; `projected` is the DASHED LINE's own opacity, unrelated to
//either fill. `projectedFill` is the fill under the FORECAST, semitransparent relative to the
//record's - a fraction of `planned` rather than a second number to keep in step with it by hand.
const PLANE = {planned: 0.15, projectedFill: 0.15*0.55, projected: 0.4};

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

/* WHICH STREAMS THE FORECAST IS ALLOWED TO USE.

   The accuracy of this picture cannot be perfect, so the useful question is not "how wrong is it" but
   "which half of it is wrong". A regular payment drawn on the wrong day is a modelling fault worth
   fixing; a genuinely erratic one is not a fault at all, and averaging the two together hides both.

   `regular` forecasts only the streams whose timing and size are both measurably repeatable. Against
   the benchmark line it answers the question directly: if the benchmark tracks the record closely with
   only the regular streams, then what remains to be fixed is noise rather than model. */
const BASES = [["all", "all streams"], ["regular", "regular only"]];
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

/* HOLDING A BADGE GROWS IT, INSTEAD OF DRAWING A SEPARATE MARKER ON TOP OF IT. A focal dot on the
   curve used to mark the cursor's day, and it sat under the finger and covered the very step it was
   pointing at - the badge is already where the movement is, so it becomes the highlight rather than
   being covered by one. GROW_HELD is the scale at rest under the finger; GROW_EASE is how much of
   the remaining distance each frame closes, so taking hold is a movement and letting go is the same
   movement backwards, never a switch. */
//how many movements the cursor's caption names before it stops and counts the rest
const CAPTION_LINES = 2

/* THE CURSOR ARRIVES AND LEAVES, rather than blinking on and off. Everything it draws - the line, the
   caption, the day under the axis, its own value in the gutter - shares one opacity, eased by the
   same loop that grows a badge and moves that value. A SEPARATE, FASTER RATE than GROW_EASE: a
   cursor that took as long to appear as a badge takes to grow felt like a lag between the tap and
   the answer, and the answer is the thing being waited for. */
const CURSOR_EASE = 0.45

//the resting opacity of a guide's own value, before anything asks it to make room - see drawLive()
const GUIDE_OPACITY = 0.85

/* THE FOUR NODES A PAINT WRITES INTO - see paintInto(). */
const MASK_DEFS = "bal-mask-defs"   //the fade mask: set by the size and the window, not by the frame
const RAMP_DEFS = "bal-ramp-defs"   //the value ramp: pinned to the value axis, so it moves with it
const BODY_G = "bal-body"           //the drawing, masked
const LIVE_G = "bal-live"           //everything that answers the cursor

//the edge fade that says the record runs on past the frame - see draw()
const FADE_ID = "bal-fade"
const FADE_W = 26

const GROW_HELD = 1.35
const GROW_EASE = 0.3

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
	//specific on purpose: a CAR repayment is not a card one, and it keeps its own icon below
	[/card repayment/i, "card"],
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
/* ONE NAME FOR ONE FACT. A card repayment that already posted is named by whatever stream the reader
   allocated it to - "Credit Card Payments" - and the projected one was named by the module's internal
   label, "repayment", which matched no icon rule and drew the bland fallback dot. They are the same
   event either side of today, so they are given the same name here, at the point where the tile names
   things. The module keeps its own label; this is what a reader is shown. */
const CARD_REPAYMENT = "Card repayment"
const REPAYMENT = /^repayment$|credit card payment/i
export const nameOf = who => REPAYMENT.test(who || "") ? CARD_REPAYMENT : who

export const iconFor = name => {
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
/* THE SAME FADE, ON EVERY PIECE THAT HAS TO ARRIVE TOGETHER. `$ready` gates Head, ChartHost and
   Empty identically - same opacity, same REVEAL_TRANSITION - so the title and the picture it names
   appear as one motion rather than the title landing first and the graph catching up under it a
   beat later. See the Shimmer this crossfades against, just below. */
const REVEAL_TRANSITION = "opacity 320ms ease"
const Head = styled.div`
	display:flex; align-items:flex-start; justify-content:space-between;
	width:100%; align-self:stretch; text-align:left;
	gap:${DS.spacing.xxs}rem;
	opacity:${props => (props.$ready ? 1 : 0)};
	transition:${REVEAL_TRANSITION};
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
/* STAGING ONLY. A question about accuracy is a question about fifty streams at once, and no picture
   answers it - the numbers have to be readable somewhere. This is gated on AppConfig.staging, which is
   false in the built app, so it never reaches a reader who did not go looking for it. */
const ToolButton = styled.button`
	appearance:none; cursor:pointer; font:inherit;
	font-size:${DS.fontSize.little}rem;
	background:none; color:${props => DS.getStyle().bodyTextSecondary};
	border:1px dashed ${props => DS.getStyle().borderColor};
	padding:0.15rem 0.5rem; border-radius:${DS.borderRadiusSmall}; white-space:nowrap;
	&:hover{color:${props => DS.getStyle().bodyText};}
`
/* RESERVED BEFORE ANYTHING IS DRAWN. ChartHost has no height of its own until paintAll() writes an
   svg into it - before that, an empty div has none, and the shimmer meant to cover the very first
   frame would have no area to appear in. `aspect-ratio` gives the area the same shape the real chart
   will have (the svg itself keeps RATIO via its own viewBox, width:100%;height:auto) without waiting
   on a single measurement, so there is something to show, and nothing to reflow into, the instant
   the tile mounts. */
const ChartArea = styled.div`position:relative; width:100%; align-self:stretch; aspect-ratio:${RATIO};`
/* touch-action:none IS THE DRAG, not an optimisation of it. Without it a touch that moves is a
   candidate gesture the browser is free to read as ITS OWN pan/scroll before wireOnce's pointermove
   ever sees it - the sequence gets cut short with a pointercancel partway through, which reads as
   "the cursor moved once and then stopped following the finger": a tap works because it never moves
   far enough to trigger the browser's own gesture, and a drag never survives long enough to scrub. */
const ChartHost = styled.div`
	overflow:hidden; -webkit-tap-highlight-color:transparent; touch-action:none;
	& svg{ display:block; -webkit-user-select:none; user-select:none; touch-action:none; }
	opacity:${props => (props.$ready ? 1 : 0)};
	transition:${REVEAL_TRANSITION};
`
const Empty = styled.div`
	position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
	text-align:center; padding:${DS.spacing.xs}rem;
	font-size:${DS.fontSize.body}rem; color:${props => DS.getStyle().bodyTextSecondary};
	opacity:${props => (props.$ready ? 1 : 0)};
	transition:${REVEAL_TRANSITION};
`

/* ---- THE SHIMMER --------------------------------------------------------------------------------
   UP FRONT, NOT AFTER A DELAY. The tile used to show nothing at all until the live balance arrived -
   a blank rectangle that then, without warning, became a title and a graph at once. This paints a
   placeholder from the very first frame instead, so there is always something on screen, and it
   crossfades against the real content (`$ready`, above) rather than being swapped for it.

   ONE SWEEP, NOT A SKELETON OF SEPARATE SHAPES. The tile's own layout (title, then graph) is not
   fixed enough across account states - the empty-state message is centred text, not a chart-shaped
   block - to be worth mimicking piece by piece; a single soft sweep over the whole tile reads as
   "loading" without asserting a shape the real content might not match. */
const shimmerSweep = keyframes`
	from{ background-position:160% 0; }
	to{ background-position:-60% 0; }
`
//the shimmer's OWN entrance - it mounts at the same instant as the rest of the tile, popping in with
//nothing to soften it otherwise, since $ready is still false on that very first render and a CSS
//transition never fires on a property's initial value, only on a later CHANGE to it. Runs once (no
//`infinite`) and, with no fill-mode, hands opacity straight back to the `$ready`-driven value below
//the instant it ends - so this never fights the ready/shimmer crossfade, only precedes it.
const shimmerFadeIn = keyframes`
	from{ opacity:0; }
	to{ opacity:1; }
`
/* THE WAVE IS THE TILE'S OWN HUE, A FIXED DISTANCE LIGHTER OR DARKER - never a foreign color, and
   never all the way to pure white or black, which would read as a different palette rather than a
   variant of this one. Alpha is read off and dropped: `UIElementBackground` is meant to sit as a
   translucent tint over whatever is under it, and the shimmer wants one SOLID tone, not a second
   translucency layered on the tile's own.

   LIGHTNESS, NOT A RAW RGB BLEND TOWARD 255/0. `UIElementBackground` in light mode is already close
   to white (`#f7f7f78f` reads as roughly 97% lightness) - nudging its raw RGB channels toward 255
   moves them by almost nothing, since there is almost no channel left to move. HSL lightness is
   shifted by a fixed PERCENTAGE-POINT amount instead, clamped short of the extremes (6%-94%), so the
   wave stays visibly distinct from the base in every theme regardless of how little headroom the
   base color itself has - light mode brightens, dark mode darkens, same hue and saturation as the
   tile either way. */
const hexToHsl = hex => {
	const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.replace("#", "").slice(i, i + 2), 16)/255)
	const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min)/2
	if(max === min)return [0, 0, l]
	const d = max - min
	const s = l > 0.5 ? d/(2 - max - min) : d/(max + min)
	let h
	if(max === r)h = (g - b)/d + (g < b ? 6 : 0)
	else if(max === g)h = (b - r)/d + 2
	else h = (r - g)/d + 4
	return [h/6, s, l]
}
const hslToHex = (h, s, l) => {
	const hue2rgb = (p, q, t) => {
		if(t < 0)t += 1
		if(t > 1)t -= 1
		if(t < 1/6)return p + (q - p)*6*t
		if(t < 1/2)return q
		if(t < 2/3)return p + (q - p)*(2/3 - t)*6
		return p
	}
	let r, g, b
	if(s === 0){r = g = b = l}
	else{
		const q = l < 0.5 ? l*(1 + s) : l + s - l*s, p = 2*l - q
		r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3)
	}
	const hex2 = v => Math.round(v*255).toString(16).padStart(2, "0")
	return "#" + hex2(r) + hex2(g) + hex2(b)
}
/* A CLAMP THAT MOVES PART-WAY TOWARD THE CEILING/FLOOR, never a fixed offset then clamped - light
   mode's `UIElementBackground` is already ~97% lightness (`#f7f7f78f`), so a flat "+16 points, capped
   at 94%" lands BELOW the base and darkens exactly the mode meant to brighten. Moving a fixed SHARE
   of whatever headroom is actually left is correct by construction: always the right direction,
   never past the ceiling/floor, and it uses what little room a near-white or near-black base has
   left instead of overshooting past it. */
const shimmerWave = base => {
	const [h, s, l] = hexToHsl(base)
	const ceiling = 0.985, floor = 0.015, share = 0.6
	const target = DS.isDarkMode() ? l - (l - floor)*share : l + (ceiling - l)*share
	return hslToHex(h, s, target)
}
/* THE BASE IS THE TILE'S OWN DESTINATION BACKGROUND - `UIElementBackground`, exactly what
   `StyledContentTile` itself paints - so at rest (`$ready`, before the sweep reaches a point, or
   after it has passed) the shimmer is indistinguishable from the tile already being there, rather
   than a foreign block sitting on top of it. Only the sweep departs from it, and only by the shift
   above. */
const Shimmer = styled.div`
	position:absolute; inset:0; border-radius:${DS.borderRadiusSmall};
	background-color:${props => DS.getStyle().UIElementBackground};
	background-image:linear-gradient(90deg, transparent 0%,
		${props => shimmerWave(DS.getStyle().UIElementBackground)} 50%,
		transparent 100%);
	background-size:60% 100%; background-repeat:no-repeat;
	//eases in gently, then accelerates through the rest of the sweep - a snap at the end reads as
	//more alive than a sweep that arrives at the same speed it left - alongside its own one-shot
	//entrance, so the tile's very first frame is a fade rather than a hard cut to "loading"
	animation:${shimmerSweep} 0.9s ease-in infinite, ${shimmerFadeIn} 220ms ease-out;
	opacity:${props => (props.$ready ? 0 : 1)};
	transition:${REVEAL_TRANSITION};
	pointer-events:none;
	@media (prefers-reduced-motion: reduce){ animation:${shimmerFadeIn} 220ms ease-out; }
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

export const money = v => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString();
/* FOR A MOVEMENT, NEVER FOR A BALANCE. $4,000 sitting in an account is just what is there; +$4,000
   landing in it is money that arrived, and the two are different facts even though money() renders
   them the same. Used only on the cursor's caption, where every figure is a day's movement - never
   on a balance (the guides, the subtitle, the anchor), which keeps its plain reading. */
const signed = v => (v > 0 ? "+" : "") + money(v);
//a stream name is user-typed and goes into innerHTML
const esc = t => String(t == null ? "" : t).replace(/[&<>"]/g,
	c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
export const onDate = d => new Date(d).toLocaleString("en-US", {month:"short", day:"numeric", timeZone:"UTC"});

/* A MOVEMENT READS IN THE DS'S OWN SEMANTIC COLOUR where it is one of the two things that colour
   means elsewhere in the app: money going to savings (blue, the same token the runway itself turns
   above the ceiling, and the same rule the "save" badge icon already uses to spot a savings,
   investment or transfer stream by name), or plain income (green, the runway's own positive band).
   An ordinary expense stays the ink colour - most days are ordinary expenses, and colouring all of
   them would colour nothing. */
const isSavingsName = name => iconFor(name) === "save"
const colourFor = (S, name, amount) => {
	if(isSavingsName(name))return S.savings
	if(amount > 0)return S.positive
	return null
}

export default class BalanceChart extends BaseComponent{
	constructor(props){
		super(props)
		//the bench opens on the month it is auditing; the app opens on the one being lived in
		this.state = {when:props.defaultWhen || "this", source:null, basis:"all", at:null,
			accounts:null, loaded:false, copied:null,
			//true from the first paint that actually drew something (or the first answer of "there is
			//nothing to draw") - see paint(). Gates the title/graph's fade-in against the shimmer.
			ready:false}
		this.host = React.createRef()
		this.drag = {down:false, x0:0, x1:0}
		this.W = 334; this.H = Math.round(334/RATIO)
		//one scale per day, eased toward its target every frame - see startGrow()
		this.grow = {}
		this._growing = false
		this._auditKey = null
		//the cursor's own balance and the two guide labels it can collide with - all eased the same
		//way as a badge's grow, and by the same loop - see drawLive() and startGrow()
		this._curVal = null
		this._cursorFade = 0
		this._lastDay = null       //held through the fade-out, so there is something to fade
		this._hiFade = GUIDE_OPACITY
		this._loFade = GUIDE_OPACITY
	}

	componentDidMount(){
		//the LIVE balance is the anchor the reconstruction hangs from, so the picture cannot be drawn
		//until it arrives. Until then the tile says so rather than drawing a plausible wrong line.
		Core.getAccountsWithBalances().then(accounts =>
			this.updateState({accounts:accounts||[], loaded:true}, () => this.paint()))
			.catch(() => this.updateState({accounts:[], loaded:true}))
		/* THE STORED PER-DAY BALANCES ARE NOT FETCHED HERE ANY MORE. The tile drew each observed day
		   at its own snapshot and walked only the gaps; it now walks the whole window back from the
		   one live anchor - see computeSeries() for why. Nothing on the tile reads the stored series,
		   so asking for four hundred days of it on every mount was a request whose answer was thrown
		   away. The bench still fetches it, and is still where the gap between the two is measured. */
		this.wireOnce()
		if(typeof ResizeObserver !== "undefined"){
			/* DEFERRED A FRAME, because measuring and then painting inside the callback resizes the
			   thing being observed. The browser sees a second resize it has no frame left to deliver
			   and raises "ResizeObserver loop completed with undelivered notifications" - benign in
			   itself, and CRA's overlay puts it over the whole app.

			   A frame is enough: the paint lands in the NEXT one, so the observation that follows is
			   a fresh delivery rather than a re-entrant one. Coalesced too, so a burst of resizes
			   paints once. */
			this.ro = new ResizeObserver(() => {
				if(this.roFrame)return
				this.roFrame = requestAnimationFrame(() => {
					this.roFrame = 0
					if(this.measure())this.paint()
				})
			})
			if(this.host.current)this.ro.observe(this.host.current)
		}
	}
	componentWillUnmount(){
		if(this.roFrame)cancelAnimationFrame(this.roFrame)
		this.roFrame = 0
		if(this.ro)this.ro.disconnect()
		if(this._growFrame)cancelAnimationFrame(this._growFrame)
		this._growing = false
		//so a forecast that resolves after the tile is gone (a carousel page left, a fast navigation
		//away) updates its own cache quietly instead of calling setState on an unmounted component
		this._unmounted = true
	}
	componentDidUpdate(){
		this.paint()
		//the held day grows toward GROW_HELD; every other tracked day eases back to 1 and is dropped
		if(this.state.at){
			const k = dayKey(this.state.at)
			if(this.grow[k] === undefined)this.grow[k] = 1
		}
		this.startGrow()
	}

	/* THE EASING LOOP. One scale per day is nudged a share of the remaining distance to its target
	   each frame; the loop keeps running while anything is still moving and stops itself the moment
	   everything is at rest, so an idle tile is not repainting sixty times a second. A day back at
	   rest (scale 1, not the one currently held) is dropped from the map rather than kept at 1
	   forever. */
	/* THE SAME LOOP EASES THREE THINGS: a badge's own grow, the cursor's balance climbing or falling
	   to its new day, and the two guide labels fading out of its way. All three are triggered by the
	   same event - the cursor landing on a new day - and none of them may finish before the others
	   without looking like three separate mechanisms, so one RAF loop drives all three and stops only
	   once none of them has anywhere left to go.

	   `_liveMoving` IS SET INSIDE drawLive(), which paint() calls once every time this step reaches
	   it - see paint(). It is not read until after paint() returns, so it always reflects the work
	   drawLive() just did this frame, not the frame before. */
	startGrow(){
		if(this._growing)return
		this._growing = true
		const heldKey = () => this.state.at ? dayKey(this.state.at) : null
		const step = () => {
			let moving = false
			const k0 = heldKey()
			Object.keys(this.grow).forEach(k => {
				const g = this.grow[k], target = k === k0 ? GROW_HELD : 1
				if(Math.abs(target - g) < 0.004){
					this.grow[k] = target
					if(target === 1 && k !== k0)delete this.grow[k]
					return
				}
				this.grow[k] = g + (target - g)*GROW_EASE
				moving = true
			})
			this._liveMoving = false
			this.paint()
			if(moving || this._liveMoving)this._growFrame = requestAnimationFrame(step)
			else this._growing = false
		}
		this._growFrame = requestAnimationFrame(step)
	}

	dayAudit(point){
		const k = dayKey(point.date)
		const actual = (this.ledgerByDay()[dayIdx(point.date)] || [])
			.map(t => ({name: t.streamName || "(uncategorised)", amount: t.amount}))
			.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
		const a = this.series()
		/* ONLY A PROJECTED POINT HAS A PREDICTION BEHIND IT. A past day is a fact: what moved is in
		   the ledger, and there is no claim to hold it against because the tile no longer draws one. */
		const run = point.actual === false ? a.liveRun : null
		if(run)return (function(){
			const predicted = (run.rows[k] || []).map(r =>
				({name: nameOf(r.name), amount: r.amount, refused: r.refused}))
			const sum = xs => xs.reduce((x, y) => x + y.amount, 0)
			return {date: k, balance: point.value, actual: actual, predicted: predicted,
				silent: [], actualTotal: sum(actual), predictedTotal: sum(predicted),
				projected: point.actual === false}
		})()
		const opts = point.actual === false ? a.live : null
		const ex = opts ? explainOn(new Date(point.date), opts) : {rows: [], silent: []}
		/* WHILE THE MODULE'S OWN FORECAST IS STILL LOADING, this branch is a STAND-IN, not a
		   deliberate choice - `run` above is only falsy here because `a.liveRun` has not resolved yet
		   (see moduleRun()), or because `algo="legacy"` was asked for outright. The legacy model's own
		   per-card repayment naming ("Card repayment " + middot + " **1234", from buildModel() in
		   BankBalance.js) is real and earns its keep there - the bench's own ablation wants to tell
		   two live cards apart - but it is not this app's convention: the module never disambiguates
		   by card, ever. Shown only for as long as the real forecast takes to land, it would read as
		   a card number appearing and then vanishing for no reason a reader could see - reported
		   exactly that way. So it is stripped here, and ONLY when the module is the one actually in
		   charge (`usingModule()`) - a caller who explicitly asked for the legacy model still sees its
		   own labeling intact, unstripped; only the transient stand-in gets normalised to match what
		   is about to replace it. */
		const stripStandInDisambiguation = name => this.usingModule()
			? String(name == null ? "" : name).replace(/^(Card repayment)\s*·.*$/, "$1")
			: name
		const predicted = ex.rows.map(r =>
			Object.assign({}, r, {name: nameOf(stripStandInDisambiguation(r.name))}))
		const sum = xs => xs.reduce((a, b) => a + b.amount, 0)
		return {date: k, balance: point.value, actual: actual, predicted: predicted,
			silent: ex.silent,
			actualTotal: sum(actual), predictedTotal: sum(predicted),
			projected: point.actual === false}
	}

	//measured AFTER it exists: a measurement taken before the thing is on screen is a guess about it
	measure(){
		const el = this.host.current
		const w = el && el.getBoundingClientRect().width
		if(!w || Math.abs(w - this.W) < 1)return false
		this.W = Math.round(w); this.H = Math.round(this.W/RATIO); return true
	}

	/* ---- the data ------------------------------------------------------------------------------- */
	/* THE USER'S ANSWER, NOT THE BANK'S. These three read the effective type - what the aggregator
	   reported unless the user has said otherwise - so a card someone parks savings in is excluded
	   from the runway like any other savings account, and a depository account someone treats as a
	   card is modelled as one. See effectiveAccountType in Bank.js.

	   This is the only feature that needs the third value. Everywhere else a card behaves as a
	   current account, because the only question the rest of the app asks of a type is whether money
	   went into savings. */
	typeOf(a){return Core.accountTypeOf(a)}
	creditHashes(){
		return (this.state.accounts||[]).filter(a => this.typeOf(a) === AccountTypes.credit)
			.map(a => a.hash)
	}
	depositoryHashes(){return (this.state.accounts||[]).filter(a => a.type === "depository").map(a => a.hash)}
	spendable(){
		return (this.state.accounts||[]).filter(a => this.typeOf(a) !== AccountTypes.credit
			&& a.current !== undefined)
	}

	/* THE SPENDING ACCOUNT: the ones the user calls checking. Savings is excluded on purpose - it is
	   not a runway, and sitting behind a checking balance it hides the trough.

	   This used to be a substring match on the aggregator's subtype - nullable, worded differently by
	   every institution, and impossible for the user to correct. It is now their own answer,
	   defaulted from the bank's.

	   AND THERE IS NO LONGER A FALLBACK, because there is nothing left for one to protect against.
	   The old one existed because the old rule needed the subtype to CONTAIN "check", so an account
	   with no subtype matched nothing and the chart came out empty; inferAccountType now defaults
	   anything that is not credit and not savings to checking, so that case cannot arise. Keeping the
	   fallback would have made it overrule the user instead: someone who marks their only current
	   account as savings was handed it back as the runway anyway, which is worse than an empty chart
	   because it contradicts what they just said. */
	spendingHashes(){
		return this.spendable().filter(a => this.typeOf(a) === AccountTypes.checking)
			.map(a => a.hash)
	}
	//one control, one question, two answers. The second appears only where there is a card to
	//actualise - a reader with no credit account is not offered a reading that cannot differ.
	//named for the title sentence itself - "{word} balance {when}" - not as a generic label, so the
	//word leads with the account it reads rather than with the word "spending"
	sources(){
		const out = [[SPENDING, "Checking"]]
		//"After-cards" not "Checking+ cards" - the reading SUBTRACTS what the cards owe, and the old
		//wording's "+" read as addition to anyone who had not seen anchor() do the opposite. Hyphenated
		//because it modifies "balance" in the title sentence ("After-cards balance this month") -
		//unhyphenated it misreads as "After, cards balance this month".
		if(this.creditHashes().length)out.push([NETTED, "After-cards"])
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
		return base - accts.filter(a => this.typeOf(a) === AccountTypes.credit)
			.reduce((s,a) => s + a.current, 0)
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
	/* MEMOISED, AND INDEXED BY DAY IN THE SAME PASS. This walks every transaction the reader has and
	   allocates a row per transaction; it was called twice on every frame of the cursor's grow
	   animation, which is sixty rebuilds a second of a list that only changes when the reader
	   switches account or new transactions arrive. Both are in the key, so neither can go stale.

	   THE INDEX IS THE POINT. `dayKey` is `toISOString().slice(0,10)` - 1.2ms per sweep of a real
	   ledger, and three different callers each swept it. A day bucket is `floor(ms/DAY)`, which is
	   the same UTC calendar day by construction and costs a division. */
	ledger(){
		const keep = this.covered()
		const key = keep.join("|")
		if(this._ledger && this._ledgerTxns === this.props.transactions && this._ledgerKey === key)
			return this._ledger
		const names = this.streamNames()
		const rows = (this.props.transactions||[])
			.filter(t => keep.indexOf(t.userInstitutionAccountId) > -1)
			.map(t => {
				let who = null, big = 0
				;(t.streamAllocation || []).forEach(al => {
					if(Math.abs(al.amount) >= Math.abs(big)){big = al.amount
						who = nameOf(names[al.streamId] || al.streamName || null)}
				})
				return {date:t.date, amount:t.amount,
					accountHash:t.userInstitutionAccountId, streamName:who}
			})
		const byDay = {}
		rows.forEach(r => {const b = dayIdx(r.date); (byDay[b] = byDay[b] || []).push(r)})
		this._ledger = rows; this._ledgerByDay = byDay
		this._ledgerTxns = this.props.transactions; this._ledgerKey = key
		return rows
	}

	//the same rows, bucketed by day - see ledger()
	ledgerByDay(){this.ledger(); return this._ledgerByDay}

	//each terminal's own categorised transactions, grouped once so a histogram can be rebuilt over
	//any slice of them without walking the ledger again
	streamTxns(){
		if(this._byStream)return this._byStream
		const now = this.ledgerToday()
		const dir = {}
		this.terminals().forEach(s => {
			const a = monthlyExpectationAt(s, now, "monthly")
			dir[s.id] = a < 0 ? -1 : (a > 0 ? 1 : 0)
		})
		this._byStream = groupByStream(this.props.transactions, this.terminals().map(s => s.id),
			id => dir[id])
		return this._byStream
	}

	/* THE LEGACY MODEL, kept for the ablation `algo="legacy"` selects and for nothing else. Nothing
	   is assembled locally - see buildModel. */
	model(asOf, until){
		const prefs = (Core.getUserData() || {}).userPreferences || {}
		const key = this.source() + "|" + this.state.basis + "|"
			+ asOf.getTime() + "|" + until.getTime()
		this._models = this._models || {}
		if(this._models[key])return this._models[key]
		this._models[key] = buildModel({
			transactions: this.props.transactions,
			terminals: this.terminalsFor(this.state.basis),
			accounts: this.state.accounts || [],
			covered: this.covered(), cards: this.creditHashes(),
			fallback: this.spendingHashes()[0],
			netted: this.source() === NETTED,
			asOf: asOf, until: until,
			settlementDay: this.settlementDay(),
			startingMonth: reportingConfig.startingMonth,
			startingDay: prefs.reportingStartingDay || reportingConfig.startingDay})
		return this._models[key]
	}

	/* ---- THE FORECASTER ----------------------------------------------------------------------------
	   SAME TWO CALLS AS `model()`, SAME TWO DATES. The chart draws a live forecast from today and a
	   benchmark from the left edge of the window; both are one as-of date handed to a forecaster, so
	   the picture is assembled identically either way.

	   THE MODULE IS THE DEFAULT, measured over the captured year at 30.5% on the card against the
	   legacy model's -530.7%, and 21.2% on checking against -6.1%. `algo="legacy"` still selects the
	   older one, which is how the bench runs an ablation - it is not a user-facing choice.

	   THE MODULE TAKES PLAIN JSON, so the portfolio is captured once per transaction set. Its own
	   rewind at the as-of date is what keeps the benchmark out of sample - the same guarantee
	   `buildModel` gives by refusing to read past its as-of. */
	usingModule(){return this.props.algo !== "legacy"}
	portfolio(){
		if(!this._portfolio)this._portfolio = capturePortfolio(this.props.transactions,
			this.state.accounts || [], {today: this.ledgerToday(),
				cards: this.creditHashes(), settlementDay: this.settlementDay()})
		return this._portfolio
	}
	/* THE FORECAST, OFF THE MAIN THREAD - see documentation/bank-balance.md for the cost this is
	   answering. `benchForecastAsync` spreads its ~60-stream schedule loop across a small worker
	   pool (schedulePool.js) instead of running it in a loop on this thread; every existing caller
	   of THIS method still gets a value back the same tick, because nothing here can actually wait -
	   a render is synchronous. What changes is what that value is WHILE the real one is still being
	   computed: `null`, exactly what a slow/failed forecast already returned before this - and
	   `computeSeries()` already treats a null `liveRun` as "fall back to the legacy model's line for
	   now", not as "draw nothing", so the tile paints immediately either way. The moment the async
	   answer lands, it is cached under the same key a synchronous call would have used and one more
	   `updateState` repaints with it - upgrading a tile that already had something to look at rather
	   than a tile that was blank. A tile closed before that arrives (`_unmounted`) just lets the
	   answer sit uncollected; nothing calls setState on it. */
	moduleRun(asOf, until){
		if(!this.usingModule() || !(this.state.accounts || []).length)return null
		const key = asOf.getTime() + "|" + until.getTime() + "|" + this.source()
		this._runs = this._runs || {}
		this._runPromises = this._runPromises || {}
		if(this._runs[key] === undefined){
			//marks the request as already in flight, so a render before the promise settles does not
			//start a second one - the same role `undefined` played for the old synchronous call
			this._runs[key] = null
			this._runPromises[key] = benchForecastAsync(this.portfolio(), asOf, until, this.covered(), {})
				.then(run => {
					this._runs[key] = run
					/* allSeries() MEMOISES computeSeries()'S OWN RESULT, keyed on the inputs a series
					   depends on (src/txns/accounts/basis/algo/day) - moduleRun resolving later is
					   not one of them, so the series built while this was still in flight (liveRun
					   null) would sit cached forever otherwise, and the repaint below would draw the
					   exact same picture it already drew. Dropping the memo makes the NEXT allSeries()
					   call rebuild every window fresh - cheap, since every forecast this triggers is
					   itself already resolved and cached right here. */
					this._series = null
					if(!this._unmounted)this.updateState({})
					return run
				})
				/* A FAILED RUN DRAWS NO FORECAST RATHER THAN TAKING THE PAGE DOWN - same fallback the
				   synchronous call's try/catch gave it. BUT IT SAYS SO NOW. Swallowing this without
				   a trace means the tile quietly draws the LEGACY line instead - a different model,
				   measured at -530.7% on the card against the module's 30.5% - and looks no
				   different while doing it. The reason is kept on the instance for the sandbox's
				   probe to read; nothing on the shipped tile renders it. */
				.catch(err => {
					this._runs[key] = null
					this._runFailed = this._runFailed || {}
					this._runFailed[key] = (err && (err.message || err.type)) || String(err)
					return null
				})
		}
		return this._runs[key]
	}
	/* TEST-FACING ONLY: every forecast currently in flight, so a test can await the real answer
	   instead of guessing how many microtask ticks a worker-pool promise chain needs. Never read by
	   the render path - `moduleRun()` above never waits on this, by design (a render is synchronous
	   and cannot). */
	pendingForecasts(){
		return Promise.all(Object.values(this._runPromises || {}))
	}

	/* every terminal, scored. Memoised with the grouped ledger it is derived from. */
	classification(){
		if(this._classes)return this._classes
		const now = this.ledgerToday()
		this._classes = classifyAll(this.terminals(), this.streamTxns(),
			s => monthlyExpectationAt(s, now, "monthly"))
		return this._classes
	}
	//the streams a given basis is allowed to forecast from
	terminalsFor(basis){
		if(basis !== "regular")return this.terminals()
		const ok = {}
		this.classification().forEach(r => {if(r.klass === CLASSES.predictable)ok[r.id] = true})
		return this.terminals().filter(s => ok[s.id])
	}

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
	   notion of "which day" IS the raw timestamp's UTC day, and both sides use it directly.

	   "TODAY" ITSELF IS READ IN THE ACCOUNT'S OWN TIMEZONE, NEVER THE MACHINE'S. The transaction dates
	   above are already fixed UTC-midnight facts and this does not touch them - it decides which of
	   those fixed days the CURRENT INSTANT falls into, which is a question with a different answer in
	   every timezone at once. Read as the true UTC calendar day (what this did before), the answer is
	   a full day ahead of anyone west of Greenwich for several hours every evening - from 5pm local
	   onward at UTC-7, UTC has already crossed into tomorrow while the reader's own day has not. The
	   tile then anchored "the last CLOSED day" to that not-yet-closed day, which is the bug this
	   fixes: reported live, the anchor was pinned to the reader's own still-open evening.

	   THE OFFSET COMES FROM THE ACCOUNT, never the browser - see businessCalendar.js's own header for
	   why: a reading must not change because it was computed on a machine in a different timezone.
	   Unset, it defaults to 0 (pure UTC), which is the same fallback calendarDay's other caller uses
	   and preserves every existing reading until an account states its own offset. */
	userTimezoneOffset(){
		const ud = Core.getUserData()
		const v = ud && ud.timeZoneOffset
		return typeof v === 'number' ? v : 0
	}
	ledgerToday(){
		return calendarDay(new Date(), this.userTimezoneOffset())
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
		const basis = this.state.basis
		//the forecaster is an input like any other, so a change of it invalidates the drawn series
		const algo = this.props.algo || "module"
		/* AND SO IS THE DAY. Nothing else in this key is time-sensitive, so a tile left mounted across
		   a calendar-day change - in the account's OWN timezone, see ledgerToday() - kept the series
		   it built on the day before forever: transactions, accounts, basis and algo can all sit
		   unchanged for a tile that is simply left open, and nothing else here ever told it to
		   recompute. A short-lived route (a fresh mount) never showed this, because its series was
		   always built fresh; a tile left open on the home screen did, and stayed one day behind until
		   something else happened to bust the cache. */
		const day = dayKey(this.ledgerToday())
		const k = this._seriesKey
		const same = this._series && k && k.src === src && k.txns === txns && k.acc === acc
			&& k.basis === basis && k.algo === algo && k.day === day
		if(!same){
			this._series = {}
			this._seriesKey = {src: src, txns: txns, acc: acc, basis: basis, algo: algo, day: day}
		}
		/* BOTH WINDOWS, UP FRONT. The zoom animation interpolates between two frames and has to have
		   both before the tap lands; building the destination inside the gesture is the stall the
		   prerender exists to remove. Under the module that costs three forecasts rather than two -
		   this month's live line, and a benchmark from each window's own start. */
		WHENS.forEach(o => {
			if(!this._series[o[0]])this._series[o[0]] = this.computeSeries(o[0])
		})
		return this._series
	}
	series(when){
		const all = this.allSeries()
		const w = when || this.state.when
		if(!all[w])all[w] = this.computeSeries(w)
		return all[w]
	}

	computeSeries(when){
		const now = this.ledgerToday()
		const win = this.window(now, when)
		const txns = this.ledger()
		const bal = this.anchor()
		/* ONE ANCHOR, AND THE POSTING DATES. The walk runs back from TODAY's live balance, whatever
		   window is on screen, so a past window is a slice of that one walk rather than a separate
		   calculation from a guessed opening figure.

		   THE STORED PER-DAY SNAPSHOTS ARE NOT USED, and that is the point. They were: each day the
		   bank had reported was pinned to its own reading, and the walk only filled the gaps between
		   them. The reasoning was that a reading is a fact and a derivation is not - but a reading is
		   a fact about THE INSTANT IT WAS TAKEN, and it is written once and never revised. The bank
		   restates a past day as late postings land on it; our copy of that day does not. So a day
		   whose snapshot was taken before a cheque cleared stayed frozen at the pre-cheque figure
		   forever, and the step the cheque made appeared a day late - a riser on a day nothing
		   happened, with the real transaction's own day drawn flat beside it.

		   Walked from one anchor, that cannot happen. TODAY is exactly the live balance, because it
		   IS the live balance; every earlier day is that figure minus what posted since, by posting
		   date. The curve agrees with the transaction dates by construction, and the freshest part of
		   it - the part actually read - is right by definition.

		   WHAT IS GIVEN UP, PLAINLY: a transaction the bank has taken and our store has not received
		   displaces every point before it by that amount. That is a real failure and it is the reason
		   the snapshots were introduced. It is the better failure of the two: it is uniform rather
		   than local, so it reads as a level rather than as an event that never happened; it heals
		   itself the moment the transaction arrives; and it never contradicts a date the reader can
		   check against their bank. The size of that gap is still measured, per account, by
		   driftVsRemembered() in the bench - which is where it can be argued about with numbers.

		   THE ANCHOR IS THE LAST CLOSED DAY, NOT TODAY. Today is still being written: an authorisation
		   settles, a pending charge posts or is dropped, and the live figure moves under a reader who
		   has not spent anything. Yesterday is finished - whatever the bank says about it now is what
		   it will say about it tomorrow - so that is the day the picture is pinned to, and today is
		   derived FORWARD from it by adding back what has posted today.

		   With `current` as the only balance we hold, that walk is arithmetically what it always was:
		   yesterday is the live figure minus today's postings either way. What changes is which day is
		   the FACT and which is the derivation, and that is the seam every future decision about
		   today's volatility hangs on - whether today is drawn as settled at all, whether a pending
		   figure is admitted, whether the record line should stop at the close. Written down here so
		   that decision has somewhere to live other than an implicit assumption. */
		const closed = new Date(now.getTime() - DAY)
		const postedToday = txns.reduce((sum, t) =>
			sum + (dayIdx(t.date) === dayIdx(now) ? t.amount : 0), 0)
		const anchorValue = bal - postedToday
		let past = reconstruct(txns, closed, anchorValue, win.from)
		//today, derived forward from the close: the anchor plus what has posted since it
		past = past.concat([{date: new Date(now), value: anchorValue + postedToday, actual: true}])
		if(win.to)past = past.filter(p => p.date <= win.to)

		const liveUntil = win.fwd ? new Date(now.getTime() + win.fwd*DAY) : null
		const live = win.fwd ? this.model(now, liveUntil) : null
		const liveRun = win.fwd ? this.moduleRun(now, liveUntil) : null
		/* A PROJECTED POINT SAYS SO ON ITSELF. The legacy forecast marks its own points; the module
		   hands back a plain series, and everything downstream that has to tell a record from a
		   claim - the travel's painter, the union, the day table - reads that flag rather than the
		   array a point arrived in. Unmarked, the forecast drew solid the moment it went through
		   paintFrame, which is every frame of a travel.

		   `top` is the stream that moved the balance that day, for the badge beside the bead. */
		/* ONE POINT PER DAY, NOT ONE PER MOVEMENT. `seriesFrom` hands back the days the balance
		   CHANGES, which is all a step path needs to be drawn - and it is why the cursor could not be
		   read on every day of the forecast: on a quiet day there was no point to read, so the cursor
		   snapped to the nearest movement and reported someone else's date. A day the balance did not
		   move is still a day with a balance, so the walk fills them in at the value they hold. */
		const future = liveRun
			? (function(){
				const out = []
				const start = now.getTime() + DAY, end = liveUntil.getTime()
				let v = bal
				//flow dated before the window opens still moved the balance that the window starts at
				Object.keys(liveRun.flow).sort().forEach(k => {
					if(new Date(k + "T00:00:00.000Z").getTime() < start)v += liveRun.flow[k]
				})
				for(let t = start; t <= end; t += DAY){
					const d = new Date(t), k = dayKey(d)
					v += (liveRun.flow[k] || 0)
					const rows = liveRun.rows[k] || []
					out.push({date: d, value: v, actual: false,
						top: rows.length ? nameOf(rows[0].name) : null})
				}
				return out
			})()
			: (live ? forecast(Object.assign({now: now, balanceNow: bal, days: win.fwd}, live)) : [])

		/* THE RETROSPECTIVE FORECAST IS GONE. A third line ran the same model over days that had
		   already happened, so a reader could see where it parted company with reality. That is a
		   BENCH question - it is measured there, over ten months, against both forecasters - and on
		   the tile it was a claim about the past drawn on top of the past itself.

		   It also halves what the tile costs: the benchmark was a second forecast at a second as-of
		   date per window, and a window entirely behind us paid for one to draw a line nobody acts
		   on. */
		/* the model behind the drawn line travels ON the series it drew. An instance field was
		   overwritten by whichever window allSeries() computed last, and a hovered day was then
		   explained with another month's model. */
		return {past: past, future: future, txns: txns, now: now,
			live: live, liveRun: liveRun}
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
	/* `txns` is still accepted so a caller can ask about a ledger that is not the tile's own - the
	   tests do - but the tile passes nothing and gets the day index, which turns a full sweep per
	   frame into one bucket lookup. */
	movementAt(series, i, txns){
		if(i <= 0)return null
		const p = series[i], step = p.value - series[i-1].value
		if(Math.abs(step) < 0.005)return {step:0, stream:null, value:p.value}
		if(!p.actual)return {step:step, stream:p.top || null, value:p.value}
		const b = dayIdx(p.date)
		const on = txns ? txns.filter(t => dayIdx(t.date) === b) : (this.ledgerByDay()[b] || [])
		let who = null, big = 0
		on.forEach(t => {if(Math.abs(t.amount) > Math.abs(big)){big = t.amount; who = t.streamName}})
		return {step:step, stream:who, value:p.value}
	}

	/* ---- the picture ------------------------------------------------------------------------------ */
	rampDefs(Y, gid){
		const b = BLEND/2, top = HIGH_AT + b, bot = LOW_AT - b
		const hue = n => DS.getStyle()[n]
		//a stop is placed by the AMOUNT it means, converted to a fraction of the anchored span, so the
		//two crossings stay centred on their anchors whatever the blend
		const at = v => ((top - v)/(top - bot || 1)*100).toFixed(2)
		//the <defs> that carries this is written by draw(), so there is ONE element per paint to
		//rewrite rather than a <defs> nested inside a <defs> - see paintInto()
		return '<linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse"'
			+ ' x1="0" y1="' + Y(top).toFixed(1) + '" x2="0" y2="' + Y(bot).toFixed(1) + '">'
			//spreadMethod pad is the default and is what makes it flat blue above and flat red below:
			//the ramp only exists between the two anchors
			+ '<stop offset="0%" stop-color="' + hue("savings") + '"/>'
			+ '<stop offset="' + at(HIGH_AT - b) + '%" stop-color="' + hue("positive") + '"/>'
			+ '<stop offset="' + at(LOW_AT + b) + '%" stop-color="' + hue("positive") + '"/>'
			+ '<stop offset="100%" stop-color="' + hue("alert") + '"/></linearGradient>'
	}

	/* THE BADGE LIST DOES NOT DEPEND ON THE CURSOR, so it is not rebuilt while the cursor moves. It
	   was: `eventsIn` sweeps the whole ledger to index it and then walks the series, 1.4ms on a real
	   one, and it ran on every frame of the grow animation to produce a list identical to the last.
	   Keyed on the two series arrays, which `series()` already memoises, so a new window or new
	   transactions invalidate it and nothing else can. */
	badges(past, future, all){
		if(this._badgePast === past && this._badgeFuture === future)return this.events
		this._badgePast = past; this._badgeFuture = future
		this.events = eventsIn(all, this.ledger(), BADGE_FLOOR)
		return this.events
	}

	/* THE FRAME a series is drawn in, so it can be interpolated rather than recomputed. */
	frameOf(a){
		const all = a.past.concat(a.future)
		const xs = all.map(p => p.date.getTime())
		const ys = all.map(p => p.value)
		let y0 = Math.min(0, Math.min.apply(null, ys)), y1 = Math.max.apply(null, ys)
		const pad = (y1 - y0)*0.14 || 1
		const lo = trough(all), hi = peak(all)
		return {x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
			y0: y0 - pad*0.4, y1: y1 + pad, lo: lo ? lo.value : 0, hi: hi ? hi.value : 0}
	}

	/* EVERYTHING THAT ANSWERS THE CURSOR, and nothing that does not - see paint(). The geometry is
	   re-derived from the frame rather than passed in, because it is four divisions and that keeps
	   this callable on its own, which is the whole point of splitting it out. */
	drawLive(past, future, now, frame){
		const W = this.W, H = this.H
		const all = past.concat(future)
		if(all.length < 2)return ""
		const f = frame || this.frameOf({past: past, future: future})
		const P = scaleAt(remPx(), !Core.isMobile(), this.W)
		const X = t => P.pad.l + (t - f.x0)/(f.x1 - f.x0 || 1)*(W - P.pad.l - P.pad.r)
		const Y = v => H - P.pad.b - (v - f.y0)/(f.y1 - f.y0 || 1)*(H - P.pad.t - P.pad.b)
		const S = DS.getStyle()
		const ink = S.bodyText, dim = S.bodyTextSecondary
		const x0 = f.x0, x1 = f.x1
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
		/* THE HIGH AND LOW VALUES. Their own dashed guide lines are gone - the two horizontal dashes
		   used to say "here is where this reading sits" for a fact the reader can already see from
		   the shape of the curve; the number alone says it. Opacity here is EASED, not toggled: when
		   another reading is about to sit on top of one of these, it fades out of the way rather
		   than snapping, and fades back the moment they are no longer fighting for the same line of
		   the gutter. The target is decided further down, once that other reading's position for
		   this frame is known; what is drawn here reads whatever the last step of the easing loop
		   left in `_hiFade`/`_loFade`. */
		if(this._hiFade === undefined)this._hiFade = GUIDE_OPACITY
		if(this._loFade === undefined)this._loFade = GUIDE_OPACITY
		//JUST THE NUMBER. "high"/"low" named what the reader can already see - the higher figure is
		//higher up the gutter, on the guide it belongs to - and spent half the label on saying it.
		const guideLabel = (v, fade) => '<text x="' + (W - P.pad.r + 4*P.r) + '" y="'
			+ (Y(v) + 2.9*P.r).toFixed(1) + '" text-anchor="start" font-family="Inter" font-size="'
			+ P.fontSmall.toFixed(2) + '" fill="' + dim + '" opacity="' + fade.toFixed(3) + '">'
			+ money(v) + '</text>'
		//the gutter's own heading, once, unconditional - it never depends on the cursor
		const railLabel = '<text x="' + (W - P.pad.r + 4*P.r) + '" y="' + (P.pad.t - 3*P.r).toFixed(1)
			+ '" text-anchor="start" font-family="Inter" font-size="' + P.fontSmall.toFixed(2)
			+ '" fill="' + dim + '" opacity="0.85">Balance</text>'
		/* THE MARKS. A bead is filled with modalBackground - DesignSystem's own opaque token for
		   something sitting ON TOP of content, which a badge is - and ringed in the ink. Filling it
		   with the page's own colour instead (as this used to) reads as a hole back through the tile
		   to the app behind it rather than a control resting on the chart.

		   ON THE RISER, NOT ON THE LANDING. A step chart's vertical segment IS the movement, and the
		   badge is about the movement - at the top of it the icon only ever marked where the balance
		   ended up, which the curve already says on its own. Halfway up the riser it sits inside the
		   jump it names, and a big step stops crowding the flat run beside it.

		   HOLDING ONE GROWS IT, rather than drawing a separate focal dot on top - see GROW_HELD. The
		   held badge is drawn LAST, so it sits above its neighbours instead of under them.

		   ONE MARK PER MOVEMENT, AS MANY AS THE RISER WILL HOLD. A day with two large payments used to
		   show the larger one and say nothing about the other, so the reader saw a step twice the size
		   of the thing named on it. The riser is the room available: stack the day's movements along
		   it while they fit end to end, and when they do not, drop the smallest until they do. The
		   count is therefore set by the SIZE OF THE STEP, which is the right constraint - a big jump
		   has the height to explain itself in pieces, and a small one is one mark and a caption. */
		const evs = this.badges(past, future, all)
		/* NO HALO BEHIND THE TEXT. Every label used to be stroked in a background colour under
		   paint-order:stroke, so it could be read wherever it landed. On a translucent tile that
		   stroke is not invisible - it is a fattened, slightly-wrong-coloured slab around each glyph,
		   which is the "weird backdrop". The labels sit in the gutter or in the top padding, clear of
		   the drawing, so they did not need it. */
		const badgeBg = S.modalBackground
		const heldKey = this.state.at ? dayKey(this.state.at) : null
		const bead = e => {
			const from = e.value - e.step
			const x = X(e.date.getTime()), y0 = Y(from), y1 = Y(e.value)
			const g = this.grow[dayKey(e.date)] || 1
			const lift = (g - 1)/(GROW_HELD - 1)
			const r = P.dotR*g, s = (r*1.55)/24
			const op = (e.date <= now ? 1 : 0.8) + (e.date <= now ? 0 : 0.2*lift)
			//how many of the day's movements the riser can carry, at the size the badges are RIGHT NOW
			//- so growing the held day never pushes its own badges out through each other
			const len = Math.abs(y1 - y0), pitch = 2*r + P.badgeGap
			let n = Math.max(1, Math.min((e.parts || []).length || 1,
				Math.floor((len + P.badgeGap)/pitch)))
			const parts = (e.parts || [{amount: e.step, stream: e.stream}]).slice(0, n)
			//centred on the riser, walking in the direction the balance moved
			const mid = (y0 + y1)/2, dir = y1 >= y0 ? 1 : -1
			const first = mid - dir*((n - 1)*pitch)/2
			return parts.map((part, i) => {
				const y = first + dir*i*pitch
				return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(2)
					+ '" fill="' + badgeBg + '" stroke="' + ink + '" stroke-width="'
					+ (P.strokeBadgeBase*(1 + 0.6*lift)).toFixed(2) + '" opacity="' + op + '"/>'
					+ '<path d="' + (ICONS[iconFor(part.stream)] || ICONS.dot) + '" fill="' + ink
					+ '" opacity="' + op + '" transform="translate('
					+ (x - 12*s).toFixed(2) + ' ' + (y - 12*s).toFixed(2) + ') scale('
					+ s.toFixed(3) + ')"/>'
			}).join("")
		}
		//the badge the cursor is actively ON is drawn separately, and LATER - see its own use below.
		//A held badge used to sit above its own siblings but still under the cursor's own vertical
		//line and caption, since ALL badges painted before either of those in the svg's own order;
		//pulling it out is what puts it in front of the cursor instead of behind it.
		const beads = evs.filter(e => dayKey(e.date) !== heldKey).map(bead).join("")
		const beadsHeld = evs.filter(e => dayKey(e.date) === heldKey).map(bead).join("")

		let cursorLine = "", badgeLabel = "", intersect = "", valueText = "", dateLabel = ""
		let hiTarget = GUIDE_OPACITY, loTarget = GUIDE_OPACITY
		this.held = null
		/* THE CURSOR OUTLIVES THE FINGER BY THE LENGTH OF ITS OWN FADE. `state.at` going null is the
		   release, not the disappearance: the day it was on is kept in `_lastDay` and keeps being
		   drawn, at a falling opacity, until there is nothing left to draw. Without that there is
		   nothing to fade - the thing being faded is gone from the first frame of the fade. */
		if(this.state.at === null && this._cursorFade < 0.02){
			this._cursorFade = 0; this._lastDay = null; this._curVal = null
		}
		/* WHICH DAY THE GUTTER ANSWERS FOR. Interactive - held, or fading out via `_lastDay` - wins
		   when there is one; AT REST, with nothing ever touched, it defaults to TODAY's own point
		   rather than showing nothing. The value, the dashed line to it and the date under the axis
		   are therefore near-always on screen once today is in the window at all - only the vertical
		   cursor line and the movement caption are truly interactive-only, and only those two fade
		   with the finger; see `passive` / `shown` below. */
		//WHICH x TO KEEP AN AXIS LABEL CLEAR OF - a date label sits there whether the day is held,
		//fading, or the resting default, so the same suppression that used to key only off the finger
		//has to key off whichever one is actually on screen.
		let day = null, idx = -1, interactive = false, dateX = null
		if(this.state.at || this._lastDay){
			interactive = true
			/* THE NEAREST DAY WINS, not an exact key match. A cursor that vanishes whenever the
			   pointer lands between two drawn days reads as broken - the reader is over a day either
			   way, and the picture has to say which one. The x scale is built from the point times,
			   so the nearest point IS the day under the finger; where the series has a gap or the
			   pointer runs past its ends, the nearest point is still the honest answer. */
			let best = Infinity
			const on = this.state.at || this._lastDay.date
			const want = on.getTime(), b = dayIdx(on)
			all.forEach((p,i) => {
				if(dayIdx(p.date) === b){idx = i; best = -1; return}     //the day itself, if it is drawn
				if(best < 0)return
				const gap = Math.abs(p.date.getTime() - want)
				if(gap < best){best = gap; idx = i}})
			day = idx > -1 ? all[idx] : (this.state.at ? null : this._lastDay)
		} else if(!this.animating){
			/* AT REST: today's own point, if today is actually inside the window being drawn - but
			   NOT while a travel is running. `all` during a travel is the UNION of two windows and
			   `X()` is built from a FRAME that is itself being interpolated frame to frame; today's
			   own x under that moving frame is not a fixed point the way it is at rest, so the dotted
			   line and its dot visibly slid and snapped as the frame moved under them - reported as
			   the reading "catching" the animation. Nothing resting-default draws answers a question
			   worth asking mid-motion anyway: the reader is watching the CURVE travel, not pointing at
			   a day. It reappears, settled, the moment `this.animating` clears and a resting paint
			   runs again. */
			const b = dayIdx(now)
			all.forEach((p,i) => {if(dayIdx(p.date) === b)idx = i})
			if(idx > -1)day = all[idx]
		}
		if(day){
			const cx = X(day.date.getTime())
			dateX = cx
			//read off the DRAWN series, not the thresholded event list - that list has a floor, so
			//most days are not in it and the cursor would have nothing to say about them
			if(interactive && this.state.at){
				this.held = {day:day, move:this.movementAt(all, idx, null)}
				this._lastDay = day
			}
			if(interactive){
				/* EVERYTHING THAT MOVED THAT DAY, not only whichever badge happened to clear the
				   floor. dayAudit() is already the one place that answers "what moved, and what was
				   expected" for a day - the same call the parent's audit table runs - reused here
				   rather than re-derived, and memoised because draw() runs on every frame of the
				   grow animation and dayAudit filters the whole ledger. */
				const k = dayKey(day.date)
				if(this._auditKey !== k){this._auditKey = k; this._audit = this.dayAudit(day)}
				const audit = this._audit
				const rows = (audit.projected ? audit.predicted : audit.actual)
					.filter(r => Math.abs(r.amount) > 0.005)

				//grouped by name and summed - two legs of one stream on one day are one line, whose
				//value is the day's true total for it, not whichever leg happened to sort first
				const byName = {}, order = []
				rows.forEach(r => {
					const nm = r.name || "(uncategorised)"
					if(!(nm in byName)){byName[nm] = 0; order.push(nm)}
					byName[nm] += r.amount
				})
				const names = order.slice().sort((x, y) => Math.abs(byName[y]) - Math.abs(byName[x]))

								/* THE CAPTION WRAPS - ONE MOVEMENT PER LINE, ALWAYS, never packed onto one line just
				   because two names happened to fit: two movements read as one caption then, and the
				   reader had to notice a middle dot to learn there were two things to know. SVG text
				   does not wrap on its own, so the lines are laid out as tspans - three at most,
				   because a caption taller than that covers the picture it is explaining, and
				   whatever is left over is counted rather than silently dropped. The VALUE is never
				   the part that gets cut; the name gives up its own room first, because a badge
				   nobody can attach a name to still names its size - and it is bold, and reads in the
				   DS's own colour for savings or income, so the number that answers "how much" is
				   the one thing on the line that cannot be missed.

				   TWO MOVEMENTS, THEN A COUNT. The overflow used to ride on the end of the last named
				   line as a bare "+2", where it read as part of that movement's own figure. It is a
				   different kind of fact - how much is NOT shown - so it gets its own line, says
				   "more" in words, and takes the secondary ink: nothing on it is a value, so nothing
				   on it should carry a value's weight or a value's colour. */
				if(names.length){
					const roomR = W - P.pad.r - cx - 6*P.r, roomL = cx - P.pad.l - 6*P.r
					const right = roomR >= roomL, room = right ? roomR : roomL
					const per = Math.max(8, Math.floor(room/2.35))
					const shownNames = names.slice(0, CAPTION_LINES)
					const dropped = names.length - shownNames.length
					const lines = shownNames.map(nm => {
						const value = signed(byName[nm])
						const budget = Math.max(3, per - value.length - 1)
						const label = nm.length > budget
							? nm.slice(0, Math.max(3, budget - 1)) + "…" : nm
						return {text: label + " " + value, valueLen: value.length,
							colour: colourFor(S, nm, byName[nm])}
					})
					if(dropped)lines.push({text: "+" + dropped + " more", valueLen: 0,
						colour: null, quiet: true})
					const tx = (right ? cx + 5*P.r : cx - 5*P.r).toFixed(1)
					badgeLabel = '<text x="' + tx + '" y="' + (P.pad.t + 7*P.r).toFixed(1) + '" text-anchor="'
						+ (right ? "start" : "end") + '" font-family="Inter" font-size="' + P.fontNormal.toFixed(2)
						+ '" fill="' + ink + '">'
						+ lines.map((l, i) => {
							//the name in ink at normal weight, the value bold and in its own colour if any
							const cut = l.text.length - l.valueLen
							const head = esc(l.text.slice(0, cut)), tail = esc(l.text.slice(cut))
							/* "10" IS A LINE-HEIGHT CALIBRATED AT fontNormal=9 (a ~1.11 ratio), the
							   same constant this file keeps re-deriving wherever a font-size and a
							   pixel gap were written down together before either could move
							   independently of the other. Left bare, a wide chart's bigger fontNormal
							   (see NARROW_W/WIDE_W) kept the OLD, smaller line-height under it, and
							   the cursor's own movement list packed its lines on top of each other -
							   reported as "mobile-dimensioned" spacing on a desktop-sized font. */
							return '<tspan x="' + tx + '" dy="'
								+ (i ? (10*(P.fontNormal/9)).toFixed(2) : 0) + '"'
								+ (l.quiet ? ' fill="' + dim + '"' : "") + '>' + head
								+ '<tspan font-weight="600"' + (l.colour ? ' fill="' + l.colour + '"' : "")
								+ '>' + tail + '</tspan></tspan>'
						}).join("") + '</text>'
				}
			}

			/* WHICH DAY, under the axis - shown whether the day is held, fading out, or the resting
			   default. It sits in the bottom padding, below the plot, so it never overlaps the
			   picture, and is clamped inside the frame so the first and last days do not print half
			   off the edge.

			   "TODAY" WHENEVER THE DAY BEING ANSWERED FOR IS TODAY - held, fading, or resting alike,
			   not only at rest. It is a fact about which DAY this is, not about why it is being
			   shown, so dragging onto today reads exactly the way resting on it already does; dragged
			   somewhere else it is dropped just as honestly, because that day is not today either way. */
			const dayLabel = dayIdx(day.date) === dayIdx(now)
				? ("Today (" + onDate(day.date) + ")") : onDate(day.date)
			/* "2.6" IS CALIBRATED AT fontNormal=9 - an average character's own width in px at that
			   size - so it has to scale WITH fontNormal, not with `P.r` alone, now that fontNormal
			   itself can be bigger than `9*P.r` on a wide chart (see NARROW_W/WIDE_W). Before that
			   existed the two were always equal and this line could not tell the difference; now it
			   has to, or the estimate undershoots the label's real width exactly where the chart has
			   grown its type the most. */
			const half = dayLabel.length * 2.6 * (P.fontNormal/9)
			const lx = Math.max(P.pad.l + half, Math.min(W - P.pad.r - half, cx))
			dateLabel = '<text x="' + lx.toFixed(1) + '" y="' + (H - 4*P.r).toFixed(1)
				+ '" text-anchor="middle" font-family="Inter" font-size="' + P.fontNormal.toFixed(2)
				+ '" fill="' + ink + '">' + dayLabel + '</text>'

			/* THE THIRD VALUE IN THE GUTTER: the balance on the day being answered for, beside the
			   high and the low it sits between. The other two are fixed facts about the window and
			   are drawn quiet; this one TRAVELS - the reader watches it climb and fall through the
			   two guides as they drag, which is the runway question asked and answered in one
			   gesture - and it is on screen by default, at today's own value, whenever today is in
			   the window at all, not only while the finger is down.

			   THE NUMBER NEVER JUMPS. `_curVal` is the eased position, one step of the same loop
			   that grows a badge - see startGrow(). A day's worth of change on a real account can
			   move it by a wide margin, and printing that at the day's own height every frame read
			   as a value that snapped from one place to another each time the finger crossed a
			   day; eased, it climbs and falls the way the guides themselves are fixed points to
			   climb and fall THROUGH. The first time a value appears there is nothing to ease
			   FROM, so it starts exactly on its target rather than sliding in from nowhere. */
			const target = day.value
			if(this._curVal === null || this._curVal === undefined){
				this._curVal = target
			} else if(Math.abs(target - this._curVal) > 0.5){
				this._curVal += (target - this._curVal)*GROW_EASE
				this._liveMoving = true
			} else {
				this._curVal = target
			}
			const vy = Y(this._curVal)
			//a guide label this close to the reading gives way to it, and comes back the moment the
			//two are no longer fighting for the same line of the gutter - whether the reading is held
			//or only the resting default, the collision is the same collision
			hiTarget = Math.abs(vy - Y(f.hi)) < P.labelGap ? 0 : GUIDE_OPACITY
			loTarget = Math.abs(vy - Y(f.lo)) < P.labelGap ? 0 : GUIDE_OPACITY

			/* A DYNAMIC DOTTED LINE TO THE READING, AND A MARK WHERE IT MEETS THE CURVE. The number
			   alone once seemed enough; put back because a reader following the line down from the
			   gutter needs somewhere to land, and the small dot is that landing spot - it sits at the
			   same eased height as the number beside it, so the two settle onto the curve together
			   rather than one snapping ahead of the other. */
			intersect = '<line x1="' + cx.toFixed(1) + '" y1="' + vy.toFixed(1) + '" x2="'
				+ (W - P.pad.r) + '" y2="' + vy.toFixed(1) + '" stroke="' + ink
				+ '" stroke-width="' + P.strokeThin.toFixed(2)
				+ '" stroke-dasharray="2,3" opacity="0.55"/>'
				+ '<circle cx="' + cx.toFixed(1) + '" cy="' + vy.toFixed(1) + '" r="'
				+ P.intersectR.toFixed(2) + '" fill="' + ink + '"/>'
			valueText = '<text x="' + (W - P.pad.r + 4*P.r) + '" y="' + (vy + 2.9*P.r).toFixed(1)
				+ '" text-anchor="start" font-family="Inter" font-size="' + P.fontSmall.toFixed(2)
				+ '" font-weight="600" fill="' + ink + '">' + money(this._curVal) + '</text>'

			//the vertical line marking WHERE on the curve, only while actually interactive - the
			//now-line already marks today's own x at rest, so a second line there would be redundant
			if(interactive){
				cursorLine = '<line x1="' + cx.toFixed(1) + '" y1="' + P.pad.t + '" x2="'
					+ cx.toFixed(1) + '" y2="' + (H - P.pad.b) + '" stroke="' + ink
					+ '" stroke-width="' + P.strokeCursor.toFixed(2) + '" opacity="0.7"/>'
			}
		}
		//eased toward whatever this pass decided - the collision test above if the cursor is down,
		//the plain default otherwise - and mutated only here, once per frame, by this same loop
		const ease1 = (cur, tgt) => {
			if(Math.abs(tgt - cur) < 0.01)return tgt
			this._liveMoving = true
			return cur + (tgt - cur)*GROW_EASE
		}
		this._hiFade = ease1(this._hiFade, hiTarget)
		this._loFade = ease1(this._loFade, loTarget)
		//and the cursor's own arrival and departure, at its own rate - see CURSOR_EASE
		const want = this.state.at ? 1 : 0
		if(Math.abs(want - this._cursorFade) < 0.01){this._cursorFade = want}
		else{this._cursorFade += (want - this._cursorFade)*CURSOR_EASE; this._liveMoving = true}
		//the passive readout - value, its dashed line and dot, the date - is on or off with the DAY
		//it answers for, never with the finger; only the vertical line and the caption are truly
		//interactive and fade with `_cursorFade`
		const passive = intersect + valueText + dateLabel
		const shown = (cursorLine || badgeLabel)
			? '<g opacity="' + this._cursorFade.toFixed(3) + '">' + cursorLine + badgeLabel + '</g>' : ""
		/* THE BEADS ARE PART OF THE RECORD, so they take the record's mask - which clips them to the
		   plot and fades them at its edges, exactly as the line they sit on. Unmasked they stayed
		   fully opaque over a line fading out from under them, and a travel could strand one off the
		   left edge, since the union carries days the frame does not reach.
		   NOT the rest of this layer: the gutter values are the scale and live outside the plot, and
		   the axis labels sit below it, so a mask drawn to the plot would erase them both. */
		//built here, not up with `ticks`, so it can give way to whichever date label is actually
		//showing - held, fading, or the resting default alike, not only an active touch
		const axis = ticks.map(tk => {
			const tx = X(tk.t)
			/* "34" WAS CALIBRATED AT fontNormal=9, THE SAME AS "2.6" ABOVE, and for the same reason
			   has to scale with it: a tick sitting exactly 34px from the date label used to be a safe
			   clearance because the label was never bigger than font-size 9 - once the chart's own
			   width lets fontNormal grow past that (see NARROW_W/WIDE_W), the label is visibly wider
			   than the gap this was still calling "clear", and the tick prints straight through it.
			   Reported as "Today (date) overlaps the date at rest". */
			if(dateX !== null && Math.abs(tx - dateX) < 34 * (P.fontNormal/9))return ""
			return '<line x1="' + tx.toFixed(1) + '" y1="' + (H - P.pad.b) + '" x2="' + tx.toFixed(1)
				+ '" y2="' + (H - P.pad.b + 3*P.r) + '" stroke="' + dim + '" stroke-width="'
				+ P.strokeThin.toFixed(2) + '" opacity="0.6"/>'
				+ '<text x="' + tx.toFixed(1) + '" y="' + (H - 4*P.r).toFixed(1) + '" text-anchor="middle"'
				+ ' font-family="Inter" font-size="' + P.fontNormal.toFixed(2)
				+ '" fill="' + dim + '">' + tk.label + '</text>'
		}).join("")
		//the active badge paints LAST of all - after the cursor's own line and caption - so holding
		//one puts it in front of the cursor rather than leaving the cursor drawn over it
		return railLabel + axis + '<g mask="url(#' + FADE_ID + ')">' + beads + '</g>'
			+ guideLabel(f.hi, this._hiFade)
			+ guideLabel(f.lo, this._loFade) + passive + shown
			+ (beadsHeld ? '<g mask="url(#' + FADE_ID + ')">' + beadsHeld + '</g>' : "")
	}

	/* ONE DRAWING ROUTINE, and an animation is that routine with a moving frame.

	   The animations used to have a painter of their own that drew a subset - the area and the two
	   lines, and none of the beads, guides or labels. Everything it left out therefore APPEARED at the
	   moment the motion stopped, which is what "the graph appears abruptly after the travel" is: the
	   travel was real, and then the picture arrived.

	   Passing the frame in instead means the last frame of an animation is, by construction, identical
	   to the resting frame that replaces it. There is nothing left to pop, and no second painter to
	   keep in step with this one. */
	draw(past, future, now, frame){
		const W = this.W, H = this.H
		const all = past.concat(future)
		if(all.length < 2)return ""
		const f = frame || this.frameOf({past: past, future: future})
		const x0 = f.x0, x1 = f.x1, y0 = f.y0, y1 = f.y1
		const P = scaleAt(remPx(), !Core.isMobile(), this.W)
		const X = t => P.pad.l + (t - x0)/(x1 - x0 || 1)*(W - P.pad.l - P.pad.r)
		const Y = v => H - P.pad.b - (v - y0)/(y1 - y0 || 1)*(H - P.pad.t - P.pad.b)
		const S = DS.getStyle()
		const dim = S.bodyTextSecondary   //the ink itself is only used by the live layer now
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
		/* MORE THAN THIS IS LOADED. The window is a slice of a longer record, and a line that simply
		   stops at the frame edge says the money stopped there. Fading the DRAWING out at the edge
		   says the opposite - it carries on, this is where the view ends - which is the one thing the
		   picture could not say on its own.

		   A MASK, NOT A WASH OVER THE TOP. Painting a background-coloured gradient over the edge only
		   works if the tile's own background is opaque, and it is not: it is a translucent pane over
		   the page, so the wash would fade the line into the app behind it rather than into the tile.
		   Masking the content fades what is drawn, whatever is behind it.

		   THE GUTTER IS OUTSIDE IT. The high, low and cursor values are the scale, not the record, and
		   a scale that faded would be unreadable exactly where it matters. The mask is white from the
		   right edge of the plot onwards, so nothing in the gutter is touched. A past window fades on
		   the right too, because it has a future beyond it that the reader can travel to.

		   THE RECT REACHES PAST THE PLOT EDGE BY THE STROKE'S OWN OVERHANG. A stroke is centred on its
		   path, so a line ending exactly at the plot edge still paints P.strokeOverhang rem-scaled px beyond it.
		   A fade rect that stopped exactly at the edge left that sliver outside the mask entirely -
		   not faded, not covered, just the base rect's plain white (fully visible) - which is a small
		   bright fragment of line sitting just past the point the fade had already gone fully
		   transparent. Extending the rect's OUTER edge (the one nearer full transparency) by that same
		   margin brings the overhang inside the gradient instead of past it; the inner edge, where the
		   gradient reaches full opacity, is untouched.

		   THE MASK ELEMENT OUTLIVES THE FRAME. It depends on the size and on which window is
		   shown, not on the interpolated frame, so it goes in a <defs> of its own that a paint
		   never rewrites - see paintInto(). Replacing it every frame is what made the fade
		   disappear during a travel: a <g mask="url(#...)"> resolves its reference when it is
		   inserted, and throwing the mask and the group away together sixty times a second asks
		   the renderer to re-resolve it sixty times a second. It stops trying, and the picture
		   goes flatly opaque for the length of the motion. */
		/* BOTH EDGES ALWAYS FADE. The right one was conditional - on the window, then on whether a
		   travel was running - and every version of that condition was wrong in its own way, because
		   the question it was trying to answer is not about the window at all. A record runs off the
		   left of any window because the past is longer than the frame. It runs off the RIGHT because
		   THE FUTURE IS YET TO BE WRITTEN: the forecast does not stop at the horizon this tile draws,
		   it is simply not claimed past it. Fading says exactly that, and it says it in every window,
		   at rest and mid-travel alike.

		   It also makes the mask constant for a given size: it is written once and then never again,
		   which is one fewer thing that can flicker. */
		//the ramp IS pinned to the value axis, so it moves with the frame and is rewritten per paint
		const ramp = this.rampDefs(Y, gid)
		const maskDefs = '<defs id="' + MASK_DEFS + '">'
			+ '<linearGradient id="' + FADE_ID + '-g" x1="0" x2="1">'
			+ '<stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="#fff"/>'
			+ '</linearGradient><linearGradient id="' + FADE_ID + '-h" x1="1" x2="0">'
			+ '<stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="#fff"/>'
			/* THE MASK IS ALSO THE CLIP, and it has to be: its white base used to span the whole
			   viewBox, so anything drawn OUTSIDE the plot was not merely unfaded, it was fully opaque.
			   Nothing clipped the left at all - only the right was ever held back, and by filtering
			   data (`clipTo`), which is a different job. During a travel the content is the UNION of
			   both windows while the frame interpolates between them, so union days earlier than the
			   frame's own x0 map to negative x, get clipped by the svg viewport at x=0 rather than by
			   the plot at P.pad.l, and surface as a bright stub of line pinned to the left edge.

			   Basing the white on the PLOT RECT instead means outside it is black, which is hidden.
			   The fade bands then sit inside that, and one element does both jobs - a drawing cannot
			   be visible where it has no business being drawn. Both edges carry the stroke overhang,
			   for the same reason the fade bands do: a stroke is centred on its path. */
			+ '</linearGradient><mask id="' + FADE_ID + '">'
			+ '<rect x="' + (P.pad.l - P.strokeOverhang) + '" y="0" width="'
			+ (W - P.pad.r - P.pad.l + 2*P.strokeOverhang) + '" height="' + H + '" fill="#fff"/>'
			+ '<rect x="' + (P.pad.l - P.strokeOverhang) + '" y="0" width="'
			+ (FADE_W + P.strokeOverhang) + '" height="' + H + '" fill="url(#' + FADE_ID + '-g)"/>'
			+ '<rect x="' + (W - P.pad.r - FADE_W) + '" y="0" width="'
			+ (FADE_W + P.strokeOverhang) + '" height="' + H + '" fill="url(#' + FADE_ID + '-h)"/>' 
			+ '</mask></defs>'
		const paint = 'url(#' + gid + ')'

		//closed to zero on both ends, so two adjoining areas share one seam pixel rather than either
		//gapping or doubling up there
		const areaUnder = a => '<path d="' + stepPath(a)
			+ ' L' + X(a[a.length-1].date.getTime()).toFixed(1) + ' ' + zeroY.toFixed(1)
			+ ' L' + X(a[0].date.getTime()).toFixed(1) + ' ' + zeroY.toFixed(1) + ' Z"'
		const bridge = past.length && future.length ? [past[past.length-1]].concat(future) : future
		/* THE FORECAST IS FILLED TOO, NOW - AND READS AS ONE SHEET LIGHTER. It used to be ONE fill
		   under the whole curve, record and claim treated alike; a reader could not tell where the
		   known ends and the guess begins without finding the dashed line first. Two fills, split at
		   the same seam the line already splits at, say it without making the reader look for the
		   line at all - the record's own fill stays where it was, and the claim's is a fraction of it,
		   which is what PLANE.projectedFill is defined as rather than a second number to keep in step
		   with it by hand. */
		const areaActual = past.length < 2 ? ""
			: areaUnder(past) + ' fill="' + paint + '" opacity="' + PLANE.planned + '"/>'
		const areaFuture = bridge.length < 2 ? ""
			: areaUnder(bridge) + ' fill="' + paint + '" opacity="' + PLANE.projectedFill + '"/>'

		const zero = '<line x1="' + P.pad.l + '" y1="' + zeroY.toFixed(1) + '" x2="' + (W - P.pad.r)
			+ '" y2="' + zeroY.toFixed(1) + '" stroke="' + dim + '" stroke-width="'
			+ P.strokeThin.toFixed(2) + '" opacity="0.6"/>'

		//the line takes the same ramp at full opacity - the silver lining affirmed. A stroke carries a
		//gradient exactly as a fill does, and because the ramp is pinned to the value axis the line
		//reddens as it descends without anything having to decide where the boundary is.
		const lineActual = '<path d="' + stepPath(past) + '" fill="none" stroke="' + paint
			+ '" stroke-width="' + P.strokeActual.toFixed(2)
			+ '" stroke-linejoin="round" stroke-linecap="round"/>'
		//SOLID, NOT DASHED - a dashed stroke was the one thing still telling record from claim apart,
		//which put the whole job back on the reader to notice it. The fill split (areaActual against
		//areaFuture, above) and this stroke's own lower opacity already say "this part is a claim,
		//not yet a fact" - a second, different-looking device for the same one fact was redundant,
		//and thinner besides (P.strokeProjected against P.strokeActual), so it still reads as the
		//lighter of the two lines without needing a dash to do it.
		const lineFuture = bridge.length < 2 ? ""
			: '<path d="' + stepPath(bridge) + '" fill="none" stroke="' + paint
				+ '" stroke-width="' + P.strokeProjected.toFixed(2)
				+ '" stroke-linejoin="round" stroke-linecap="round"'
				+ ' opacity="' + PLANE.projected + '"/>'


		//a settled month does not contain today, and a line marking it at the frame edge would be a
		//mark that means nothing
		const nowLine = (now.getTime() >= x0 && now.getTime() <= x1)
			? '<line x1="' + X(now.getTime()).toFixed(1) + '" y1="' + P.pad.t + '" x2="'
				+ X(now.getTime()).toFixed(1) + '" y2="' + (H - P.pad.b) + '" stroke="' + dim
				+ '" stroke-width="' + P.strokeThin.toFixed(2) + '" opacity="0.55"/>'
			: ""

		const live = this.drawLive(past, future, now, f)

		this._frame = f
		/* THE THREE WRITABLE PARTS, kept so paintInto() can rewrite them in place instead of
		   replacing the svg around them. `_maskSig` is what makes that safe: the mask defs are NOT
		   one of them, so a paint may only reuse the nodes already on screen while the mask it
		   would have written is the mask already there. */
		this._parts = {ramp: ramp, live: live,
			body: areaActual + areaFuture + zero + nowLine + lineActual + lineFuture}
		this._maskSig = this.maskSig()
		return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">'
			+ '<defs id="' + RAMP_DEFS + '">' + ramp + '</defs>' + maskDefs
			+ '<g id="' + BODY_G + '" mask="url(#' + FADE_ID + ')">' + this._parts.body + '</g>'
			+ '<g id="' + LIVE_G + '">' + live + '</g></svg>'
	}

	/* ONE WAY INTO THE HOST, for a resting paint and for an animation frame alike.

	   It reuses the svg already on screen whenever the mask it would write is the mask already
	   there, rewriting only the ramp, the drawing and the live layer. The mask element and the
	   group that references it are never touched, so that reference is resolved once - when the
	   picture is first built - and stays resolved through a whole travel. */
	paintInto(past, future, now, frame){
		const host = this.host.current
		if(!host)return
		const html = this.draw(past, future, now, frame)   //also fills _parts and _maskSig
		if(!html){host.innerHTML = ""; this._nodes = null; return}
		const n = this._nodes
		if(n && n.host === host && n.sig === this._maskSig && n.body.isConnected){
			n.ramp.innerHTML = this._parts.ramp
			n.body.innerHTML = this._parts.body
			n.live.innerHTML = this._parts.live
			return
		}
		host.innerHTML = html
		this._nodes = {host: host, sig: this._maskSig,
			ramp: host.querySelector("#" + RAMP_DEFS),
			body: host.querySelector("#" + BODY_G),
			live: host.querySelector("#" + LIVE_G)}
	}

	/* TWO LAYERS, BECAUSE ONLY ONE OF THEM MOVES.

	   Under the cursor the picture is unchanged: same area, same lines, same guides, same axis. Only
	   the badges, the cursor line and its caption answer the finger - so those live in their own <g>,
	   and a repaint that changes nothing underneath rewrites that group instead of replacing the
	   whole svg. A full replace re-parses every path in the drawing and throws away the browser's
	   layout of it, sixty times a second, to move one vertical line.

	   THE STATIC LAYER IS KEYED ON WHAT IT DRAWS: the two series arrays (which series() memoises, so
	   identity is a real answer) and the measured size. Anything else that changes the picture -
	   a window, a source, new transactions - changes one of those by construction. */
	/* WHAT THE MASK WOULD BE IF IT WERE WRITTEN NOW. One expression, read by draw() when it builds the
	   mask and by staticStale() when it decides whether the one on screen is still the right one. */
	maskSig(){return this.W + "x" + this.H}
	staticStale(a){
		const k = this._static
		if(!k || k[0] !== a.past || k[1] !== a.future || k[2] !== this.W || k[3] !== this.H)return true
		/* THE MASK IS PART OF THE STATIC LAYER, so a change to IT is a stale static layer even when
		   the series and the size are untouched. It only varies by size now that both edges always
		   fade, so this is rarely the answer - but it is the correct seam, and it was not free to
		   learn: a mask that varied by WINDOW survived the paint that ended a travel without it. */
		return !this._nodes || this._nodes.sig !== this.maskSig()
	}
	paintAll(a){
		this.paintInto(a.past, a.future, a.now, null)
		this._static = [a.past, a.future, this.W, this.H]
	}
	paint(){
		if(!this.host.current || !this.state.loaded)return
		/* NO ACCOUNT TO DRAW IS STILL AN ANSWER - the Empty message, not the shimmer forever. Reveals
		   on the SAME flag the graph does, so a reader who never connects an account is not left
		   staring at a sweep that has nothing left to wait for. */
		if(!this.hasAnchor()){
			if(!this.state.ready)this.updateState({ready:true})
			return
		}
		if(this.animating)return
		const a = this.series()
		//the live layer alone, while the drawing under it is the one already on screen
		const n = this._nodes
		if(!this.staticStale(a) && n && n.live && n.live.isConnected){
			n.live.innerHTML = this.drawLive(a.past, a.future, a.now, this._frame)
			return
		}
		this.paintAll(a)
		if(!this.settling && this.measure()){
			this.settling = true
			this.paintAll(a)
			this.settling = false
		}
		/* THE FIRST REAL PAINT IS THE REVEAL. Not "accounts loaded" (a moment earlier, before there is
		   anything on screen to look at) and not "the forecast landed" (moduleRun() may still be
		   mid-flight on the worker pool - waiting for it here would put the shimmer back in front of
		   exactly the delay this was built to hide). The past line and whatever forecast IS already
		   available (the legacy model's, synchronously, while the module's own is still in flight -
		   see moduleRun()) are already drawn by the paintAll() calls above, so this is the earliest
		   point the tile has something worth showing. */
		if(!this.state.ready)this.updateState({ready:true})
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
			//a pointer event without coordinates - or before the chart has a width - yields NaN, and
			//a NaN date throws the moment anything asks for its ISO form. Nothing to point at is a
			//legitimate answer; a crash is not.
			if(!isFinite(e.clientX) || !r.width)return null
			/* THE PLOT DOES NOT FILL THE HOST. P.pad.l and P.pad.r inset it from the svg's own edges - the
			   right inset is the gutter the high/low/cursor values live in, X() maps a date into
			   [P.pad.l, W-P.pad.r], never into [0, W]. Reading the pointer as a fraction of the whole host
			   box instead treated the gutter as more of the timeline: the rightmost DAY was drawn at
			   85% of the width (P.pad.r=48 of W=334 at 16px root) but only counted as "reached" at 100% of the
			   finger's travel, so pulling the last day onto the cursor meant dragging into the gutter
			   itself - past where the line actually ends. The fraction is taken over the same inset
			   the drawing uses, so a screen pixel and the date drawn under it agree. */
			const px = (e.clientX - r.left)/r.width*this.W
			const P = scaleAt(remPx(), !Core.isMobile(), this.W)
			const f = Math.max(0, Math.min(1, (px - P.pad.l)/(this.W - P.pad.l - P.pad.r)))
			const t = this.drag.x0 + f*(this.drag.x1 - this.drag.x0)
			if(!isFinite(t))return null
			return new Date(Math.round(t/DAY)*DAY)
		}
		const to = e => {const d = dateAt(e)
			if(!d)return
			if(!this.state.at || dayKey(d) !== dayKey(this.state.at))this.updateState({at:d})}
		host.addEventListener("pointerdown", e => {
			this.drag.down = true
			try{host.setPointerCapture(e.pointerId)}catch(err){}
			/* STICKY: tapping the day already selected clears it, so there is a way back to the
			   resting state without a second control. */
			const here = dateAt(e)
			if(this.props.sticky && this.state.at && here
				&& dayKey(here) === dayKey(this.state.at)){
				this.drag.cleared = true
				this.updateState({at:null})
				return
			}
			this.drag.cleared = false
			to(e)})
		/* DESKTOP ONLY DIFFERS BY THE INTERACTION MODE: a touch has to be down to mean anything - a
		   finger resting on glass with nothing pressed is not a signal - but a mouse's own position
		   already is the signal, the way it is for any other hover. So a mouse pointermove updates
		   the cursor continuously, the way an ACTIVE touch-drag does, without needing a button held;
		   touch and pen still require drag.down, exactly as before. */
		host.addEventListener("pointermove", e => {
			if(e.pointerType === "mouse"){
				if(!this.drag.cleared)to(e)
			} else if(this.drag.down && !this.drag.cleared){
				to(e)
			}
		})
		/* THE CURSOR CAN OUTLIVE THE FINGER, and on a touch screen it has to. Reading the day's
		   breakdown means lifting the finger and reaching for a button, and a cursor that clears on
		   pointerup destroys the thing being read before it can be read - the table appeared and
		   vanished with the gesture, so it could be looked at but never copied.

		   Opt-in, because the shipped tile wants the opposite: its resting subtitle carries the low
		   point, which is the headline the whole view exists for, and a cursor that stuck would hide
		   it behind whatever was last touched. The bench sets it; the app does not.

		   A MOUSE'S HOVER HAS NO "LIFT THE FINGER, KEEP LOOKING" MOMENT - the pointer leaving the
		   chart IS walking away from it, there is no button that was ever down to distinguish a
		   release from a lift. So a mouse always clears on pointerleave, sticky or not; sticky still
		   holds a touch's cursor after the finger lifts, and still holds a mouse's cursor after a
		   click (pointerup fires with drag.down true, so it takes the branch below unchanged). */
		const end = e => {
			const hoverEnd = e && e.pointerType === "mouse" && !this.drag.down
			if(!this.drag.down && !hoverEnd)return
			this.drag.down = false
			if(!this.props.sticky || hoverEnd)this.updateState({at:null})
		}
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
		//built through series(), which under the module builds the window being asked for rather than
		//assuming both are already in hand
		const before = this.series(this.state.when)
		this.animating = true
		this.setState({when:this.next(WHENS,"when"), at:null}, () => {
			const after = this.series(this.state.when)
			const f0 = this.frameOf(before), f1 = this.frameOf(after)
			/* THE CONTENT IS THE UNION OF BOTH WINDOWS, not the wider of the two.
			   Two months that merely OVERLAP are not a zoom, they are a pan, and the wider window does
			   not cover the journey: travelling from this month to last, this month's data stops
			   fifteen days ago, so the left of the frame swept across empty space and the curve only
			   arrived when the real picture replaced it at the end.
			   Where the two agree - the days both months contain - a record wins over a projection. */
			const merged = this.union(before, after)
			/* AND THE CONTENT APPEARS TO END WHERE THE TRAVELLING WINDOW ENDS, though nothing is ever
			   removed from `merged` to make that true. TODAY does not move, and neither does the line
			   between what happened and what is claimed. What moves is the right-hand EDGE - `f.x1`,
			   smoothly interpolated below - and the mask that is always anchored to it (see draw())
			   does the rest: travelling back, the forecast retracts into today tip first as the edge
			   sweeps back across it; travelling forward it is uncovered again. At k=1 the edge is the
			   destination's own, so the last frame of the motion is the frame that replaces it. */
			this.run(ZOOM_MS, k => {
				this.paintFrame(merged, after.now, this.lerpFrame(f0, f1, k))
			})
		})
	}

	/* THE LAST DAY A WINDOW DRAWS ON ITS OWN. Not read by zoomTo() any more - `frameOf(a).x1` is the
	   same number by construction, since both are the max date over the same array - but kept as a
	   named thing a caller can ask for without re-deriving it, and it is how the tests build the same
	   (f0, f1, k) a real travel runs on. */
	edgeOf(a){
		const last = a.future.length ? a.future[a.future.length - 1]
			: a.past[a.past.length - 1];
		return last ? last.date.getTime() : 0
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
	//a different set of streams is a different set of AMOUNTS over the same days, so it morphs
	morphBasis(){this.morphWith({basis: this.next(BASES, "basis")})}
	morphTo(){this.morphWith({source: this.next(this.sources(), "source")})}

	morphWith(change){
		const before = this.series()
		this.animating = true
		this.setState(Object.assign({at:null}, change), () => {
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
				this.paintFrame(blend, after.now, this.lerpFrame(f0, f1, k))
			})
		})
	}

	/* ONE FLAT LIST, ALWAYS WHOLE, split back into record and projection for the drawing routine.

	   THE CONTENT IS NEVER TRIMMED FOR A TRAVEL. Two things were tried and both were wrong. Filtering
	   points past a travelling edge left a gap: the series is one point per DAY, so the last point
	   surviving a `date <= clipTo` filter is rounded down to a whole day, almost always short of
	   `clipTo` itself - and X() maps the FRAME's edge to the plot's true right pixel whatever that
	   frame's edge is, so the curve fell short of it for the length of every travel. Then snapping the
	   frame's own edge to match whatever survived the filter closed the gap but made the picture RESIZE
	   in visible steps, once per day boundary crossed, because the survivor is discrete and the frame
	   had been smoothly interpolated until then.

	   NEITHER WAS NECESSARY. `lerpFrame`'s own x1 and the travelling edge time are the SAME formula
	   over the SAME two numbers - `e0*(1-k) + e1*k` - so the frame's edge already equals the true,
	   continuous travelling time at every k, with nothing to compute here. And a day chart is a STEP
	   chart: `stepPath` draws each point's horizontal run out to the NEXT point's own x before it
	   turns - so as long as the point just past the edge is still IN the array, that run already
	   overshoots past the frame's edge on its own, carrying the last real value right up to it. The
	   unconditional mask (see draw()) then crops that overshoot at the exact pixel the frame's edge
	   maps to - continuously, because neither the frame nor the content took a discrete step to get
	   there. Removing the point removes the very thing that was making the edge meet the mask. */
	paintFrame(content, now, frame){
		if(!this.host.current)return
		this.paintInto(content.filter(p => p.actual !== false),
			content.filter(p => p.actual === false), now, frame)
	}

	/* The classification, as text. Sorted by how much money each stream carries, because a stream that
	   is erratic and tiny is not a problem and a stream that is erratic and large is the only thing
	   worth looking at. */
	report(){
		const rows = this.classification()
		const money0 = v => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString()
		const groups = [[CLASSES.predictable, "PREDICTABLE"], [CLASSES.erratic, "ERRATIC"],
			[CLASSES.thin, "NOT ENOUGH DATA"]]
		const totalFlow = rows.reduce((a, r) => a + Math.abs(r.monthly), 0) || 1
		const out = ["balance forecast \u2014 stream classification",
			"taken " + new Date().toISOString(),
			this.terminals().length + " terminal streams, "
				+ money0(totalFlow) + "/month of gross flow", ""]
		groups.forEach(g => {
			const mine = rows.filter(r => r.klass === g[0])
			const flow = mine.reduce((a, r) => a + Math.abs(r.monthly), 0)
			out.push(g[1] + "  \u2014  " + mine.length + " streams, "
				+ Math.round(100*flow/totalFlow) + "% of the money")
			out.push("  " + "name".padEnd(28) + "cycle".padEnd(10) + "monthly".padStart(10)
				+ "  timing  steady  turns  txns")
			mine.forEach(r => out.push("  " + String(r.name).slice(0, 27).padEnd(28)
				+ r.cycle.padEnd(10) + money0(r.monthly).padStart(10)
				+ "   " + r.timing.toFixed(2) + "    " + r.steadiness.toFixed(2)
				+ "   " + String(r.turns).padStart(4) + "  " + String(r.k).padStart(4)))
			out.push("")
		})
		return out.join("\n")
	}
	copyReport(){
		const text = this.report()
		const done = ok => this.updateState({copied: ok ? "Copied" : "Copy failed"},
			() => setTimeout(() => this.updateState({copied: null}), 1600))
		try{
			if(navigator.clipboard && navigator.clipboard.writeText)
				return navigator.clipboard.writeText(text).then(() => done(true), () => done(false))
			const ta = document.createElement("textarea")
			ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"
			document.body.appendChild(ta); ta.select()
			const ok = document.execCommand("copy")
			document.body.removeChild(ta); done(ok)
		}catch(e){done(false)}
	}

	/* THE TOP AREA IS THE TITLE, AND NOTHING ELSE. A second line used to sit under it carrying the
	   window's low point. That was the headline while the chart could not be interrogated - now the
	   cursor names every movement of any day with its amount, at the mark, and the low point is a
	   guide line on the picture with its own value printed on it. Saying it again in prose above the
	   chart spent a line of the tile restating what the drawing already shows. */

	render(){
		//the shapes are memoised on the instance and must be dropped when the transactions change
		if(this._txns !== this.props.transactions){
			this._txns = this.props.transactions; this._models = null
			this._portfolio = null; this._runs = null
			this._names = null; this._byStream = null; this._classes = null
		}
		const ready = this.state.ready
		return <DS.component.ContentTile style={{position:"relative",width:"100%",height:"100%",
				boxSizing:"border-box",margin:0,padding:DS.spacing.xs+"rem"}}>
			<Head $ready={ready}>
				<Title $big={!Core.isMobile()}>
					<TitleButton type="button" onClick={() => this.morphTo()}
					>{wordOf(this.sources(), this.source())}</TitleButton>{" balance "}
					<TitleButton type="button" onClick={() => this.zoomTo()}
					>{wordOf(WHENS, this.state.when)}</TitleButton>
				</Title>
				{AppConfig.staging ? <ToolButton type="button" data-no-drag
					onClick={() => this.copyReport()}
					title="Copy the predictable/erratic classification of every stream">
					{this.state.copied || "Classify"}</ToolButton> : null}
			</Head>
			{/* the chart answers its own pointer gestures, so a drag starting on it belongs to it and
			    not to the carousel - see documentation/visualisation-carousel.md */}
			<ChartArea>
				<ChartHost $ready={ready} data-no-drag ref={this.host}/>
				{this.state.loaded && !this.hasAnchor()
					? <Empty $ready={ready}>Connect an account to see your balance</Empty> : null}
			</ChartArea>
			{/* PAINTED FROM THE FIRST FRAME, crossfading against Head/ChartHost/Empty above as `ready`
			    flips - see the Shimmer definition for why this is one sweep rather than a skeleton
			    shaped like the title and the chart separately. */}
			<Shimmer $ready={ready}/>
		</DS.component.ContentTile>
	}
}
