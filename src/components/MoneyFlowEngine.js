/* ==================================================================================================
   MONEY FLOW — the visualisation, on its own.

   Where the money came from and where it went, navigated by tapping the streams themselves. This
   file has NO IMPORTS on purpose: it takes a value in, draws into an element, and knows nothing
   about React, the design system, the stream model or the reporting core. That is what makes it
   reusable, and it is also the only way it can be driven by a bench rather than by production
   (documentation/visualisation-carousel.md, "What it cost" — the carousel was converged by eye
   because it had no instrument, and it cost five deploys).

   The rules it implements, and the reasons behind them, are in documentation/money-flow.md. Section
   numbers in the comments below cite that file.

   ------------------------------------------------------------------------------------------------
   USE

     const chart = new MoneyFlowEngine(hostElement, {
       palette:      {income,savings,expenses,alert,bodyText,bodyTextSecondary},
       format:       v => "$1,234",
       fontFamily:   "Inter",          // the names
       numberFamily: "Barlow, Inter",  // the amounts under them
       onFocusChange: path => {}
     })
     chart.setTree(flowTree)      // §1 — animates the values if a tree is already showing
     chart.setPalette(p)          // light/dark switched underneath us
     chart.reset()                // back to the whole picture
     chart.destroy()

   The FlowTree it consumes is the data contract in §1 of the documentation. Nothing else is read.
   ================================================================================================== */

const HUB = "__hub", INC = "__inc";
const SVGNS = "http://www.w3.org/2000/svg";

/* §11 — the settled values, in one place. Every one of them was converged on a bench; none of them
   is a control the product exposes. */
export const TUNE = {
	l1Px:3.5, l2Px:0.5, gapShare:0.35,
	bodyPx:12, smallPx:10,                       // §4.1 §4.4  the separations, and their cap
	bodyWidePx:0, smallWidePx:0, narrowW:360, wideW:640,   // §9.8  the app's own sizes, and where
	nudgeAmp:0.03, nudgeMs:260,                  // §3.10  the answer a dead end gives
	amountK:1, amountWideK:0,                    // §9.8  the amount's size, relative to its name
	railFrac:0.22, padPx:4, neighbourPx:22,              // §5.4 §5.5 §5.3  the frame
	dim:0.20, softFrac:0.40, leftShare:0.70,             // §6.1 §6.3 §6.4  what steps back, and the plume
	fadePx:24, lagMs:200,                                // §6.6 §6.8  the neighbour fade and its clock
	baseOp:0.46, curve:0.50,                             // §6.12 the ribbons
	leadMs:250, driftPx:8, edgePx:5,                     // §7.6 §7.16 §7.21  the labels
	minBandPx:6,                                         // §7.5  thinner than this carries no name
	smooth:0.13, labelEase:0.25,
	otherMin:2,                                          // §1.10  the tail, gathered
	moveMs:620, dataMs:380,                              // §8.1 §8.4  one clock, and the value tween
	ratio:2.25, tail:"push"                              // §9.3
};
const WORLD_W = 1000, BAR = 6, GUTTER = 6, COLPAD = 10;

/* §7.31  Fold a name into k lines at the spaces that leave the longest line shortest. A name with
   fewer words than lines cannot be folded that far and says so. Exact rather than greedy: the words
   are few, and a greedy pass gets "Loki Groceries & Hygiene" wrong in exactly the way that cost the
   name its place. For k=2 minimising the longest line and minimising the difference between the two
   are the same thing, so this is what splitTwo did, said once for any k. */
function splitInto(name,k){
	const w = name.split(" ");
	if(w.length<k)return null;
	let best = null, bestMax = Infinity;
	const walk = (start,left,acc) => {
		if(left===1){
			const lines = acc.concat([w.slice(start).join(" ")]);
			const m = lines.reduce((x,s) => Math.max(x,s.length),0);
			if(m<bestMax){bestMax=m;best=lines}
			return;
		}
		for(let i=start+1;i<=w.length-(left-1);i++)
			walk(i,left-1,acc.concat([w.slice(start,i).join(" ")]));
	};
	walk(0,k,[]);
	return best;
}

const lerp = (a,b,e) => a+(b-a)*e;
const ease = t => t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
const isHubPlace = f => !f.length || (f.length===1 && f[0]===INC);
const clamp01 = v => Math.max(0,Math.min(1,v));

/* ------------------------------------------------------------------------------------------------
   §3.2 §1.2b  THE STACKING ORDER OF A SET OF SIBLINGS.

   Lifted out of the gathering because it is now asked twice: once when the tree is gathered, and once
   per frame while the values are tweening (§8.7). One definition, so the order the picture settles
   into and the order it travels through cannot disagree.

   Biggest first, top to bottom, at every level: the eye reads down the list in the order the money is
   worth reading, and a gathered tail lands at the bottom where it belongs.

   ONE EXCEPTION, at the top of the out side: what is saved sits above what is spent, whatever the two
   are worth. Everywhere else in the app puts them in that order, and a chart that re-ordered them by
   size would say the two conventions disagree about which is which. Size still decides within each of
   the two groups.

   §3.2  An "Other" always sits at the BOTTOM of its set, whatever it comes to. It is not a stream
   competing for position, it is the remainder - "and the rest" reads as the last line of a list, and a
   gathered band that sorted above real ones claimed a standing it does not have.

   §1.2b  AND "UNALLOCATED" ALWAYS SITS AT THE TOP OF THE SAVINGS IT BELONGS TO - the mirror of that
   rule, read the other way. It is not competing on size either: it is what the month did not spend,
   which is the FIRST thing true about the savings side rather than a remainder appended to it. Sorted
   by size it wandered up and down the stack from one window to the next, and a band that moves for no
   reason the reader can see is a band they have to re-find every time.

   `valOf` lets the caller sort on something other than the value currently on the node - which is what
   §8.7 needs, to hold a stream that is only arriving or only leaving in one slot instead of letting it
   travel the stack on its way in or out.
   ------------------------------------------------------------------------------------------------ */
export function stackOrder(list,key,valOf){
	const v = valOf || (n => n.value);
	const rank = key==="__out" ? (n => n.tone==="savings"?0:1) : (() => 0);
	const isO = n => String(n.id).indexOf("other:")===0;
	const isU = n => n.id==="__unallocated";
	return list.slice().sort((x,y) =>
		(rank(x)-rank(y))||((isU(y)?1:0)-(isU(x)?1:0))||((isO(x)?1:0)-(isO(y)?1:0))||(v(y)-v(x)));
}

/* ------------------------------------------------------------------------------------------------
   §1.10  THE TAIL, GATHERED.  A FlowTree in, a FlowTree out.

   A stream with a dozen children spends most of its height on the two or three that matter and the
   rest on a fringe of hairlines - unreadable, unnameable, and in the way of the ones worth reading.
   So wherever a set of children has a tail, the smallest of them whose values together come to no
   more than a tenth of their parent are gathered into one "Other", which is a stream like any other:
   it has a band, a name, an amount, and children, so opening it is how you see what is in it.

   This is a VISUALISATION ARTIFACT, computed here and nowhere else. No such stream exists in the
   portfolio, nothing is categorised into it, and the reporting core has never heard of it. Which is
   why it lives in this file rather than in the adapter: it is a decision about what is worth drawing,
   not about what the money did.

   Two guards. The tail has to be at least two streams, or the group replaces one name with another
   and hides a stream for nothing. And something has to be left outside it - a set that is entirely
   tail is not a tail. An "Other" is never gathered inside another "Other": its members' own children
   are grouped, but its own list is left as it is, because "Other inside Other" says nothing.
   ------------------------------------------------------------------------------------------------ */
export function groupTail(tree,opt){
	/* Floored, not merely read. The options are taken one key at a time and never defaulted, so a
	   caller that omits this does not fail loudly: `tail.length < undefined` is false, the guard
	   below is skipped, and the crash lands ten lines further on in a function that is not at fault.
	   Two is the floor the rule states anyway - a group that replaces one name with another has
	   bought nothing - so the floor cannot change what any caller passing TUNE already gets. */
	const least = Math.max(2, opt.otherMin||2);
	/* §1.10  HOW MUCH TAIL IS DECIDED BY THE DISPLAY, not by a share of the money. The question is
	   "how many of these can be named at once", and it is answerable from the values because §5.3
	   makes the room a constant: whichever stream you open, its children fill the frame less one strip
	   at each end. Every set of siblings therefore gets the SAME height when it is exploded, so this
	   can still be settled once, off-screen, without knowing where the camera is.

	   A label is centred on its band (§7.16), so two neighbours can both be named when the distance
	   between their band centres covers a line of type: half of each band, plus the separation between
	   them. Gathering the smallest few into one band buys room twice over - it removes their labels
	   and it merges their heights into one thicker band - so the tail is grown by one until every
	   surviving neighbour clears that distance, and no further. */
	const cardH = Math.max(1,opt.cssW/opt.ratio);
	const H = Math.max(1,cardH-2*opt.neighbourPx);            // §5.3  the room an exploded set gets
	const GAP = opt.l1Px;                                     // §4.1  its children take the wide one
	/* §7.13  the same line of type the tier reserves: what it inks, plus the lead. Measured by the
	   engine and handed in; the fallback is the ratio Inter happens to have, for a caller that groups
	   before anything has been drawn. */
	/* §9.8  measured on the TALLER of the name and its amount. The gathering asks how many of a set
	   can carry a line of type at once, and once the amount is set larger than the name it is the
	   amount that decides. Sized on the name alone a wide card offered more names than it could then
	   draw, and the sweep dropped the difference - bands with nothing on them, which is the one thing
	   the gathering exists to prevent. */
	const SPAN = opt.smallPx*Math.max(1,opt.amountK||1)*(opt.inkR||1.25) + 2;
	const fits = list => {
		const V = list.reduce((a,b) => a+b.value,0)||1;
		const avail = Math.max(1,H-(list.length-1)*GAP);
		const h = n => n.value/V*avail;
		/* between CONSECUTIVE LABELLED bands, and everything lying between them counts toward the
		   distance. A stream that declines a name (§1.2, the leftover) needs no room for one, and it
		   pushes its labelled neighbours apart rather than crowding them - treating it as another
		   label to place is what made the categories at the root look unnameable. */
		let prev = -1;
		for(let i=0;i<list.length;i++){
			if(list[i].label===false)continue;
			if(prev>=0){
				let d = h(list[prev])/2+h(list[i])/2+GAP*(i-prev);
				for(let j=prev+1;j<i;j++)d += h(list[j]);
				if(d<SPAN)return false;
			}
			prev = i;
		}
		return true;
	};
	const gather = (list,total,key) => {
		if(!list||!list.length)return list;
		/* depth first: a member's own children are gathered before it is considered for the tail */
		const kids = list.map(n => Object.assign({},n,
			{children:n.children ? gather(n.children,n.value,n.id) : null}));
		/* the minimum tail that lets the rest be named: grow it by one until the survivors fit */
		const asc = kids.slice().sort((a,b) => a.value-b.value);
		let tail = [], acc = 0;
		if(!fits(kids.slice().sort((a,b) => b.value-a.value))){
			for(let k=least;k<=asc.length-1;k++){
				const t = asc.slice(0,k), v = t.reduce((x,y) => x+y.value,0);
				const trial = kids.filter(n => t.indexOf(n)<0)
					.concat([{value:v}]).sort((a,b) => b.value-a.value);
				tail = t; acc = v;
				if(fits(trial))break;
			}
		}
		/* §3.2 §1.2b  the stacking order, defined once at the top of this file. An Other made of
		   expenses takes the expense tone and one made of savings takes the savings tone, so a tail
		   lands at the bottom of whichever of the two groups it belongs to. */
		const down = a => stackOrder(a,key);
		/* §1.10  THE MACRO CATEGORIES ARE NEVER GATHERED. They are the spine the whole app is
		   organised around, the type reads its levels off them (§9.6), and "Other" standing where
		   Savings used to be says something false about the portfolio rather than something true about
		   the room. Whatever the arithmetic says, the top of each side keeps its own names. */
		if(key==="__out"||key==="__in")return down(kids);
		if(tail.length<least)return down(kids);
		const inTail = {}; tail.forEach(n => inTail[n.id]=1);
		const rest = kids.filter(n => !inTail[n.id]);
		if(!rest.length)return down(kids);
		/* it takes the colour and the standing of the largest thing in it */
		const head = down(tail)[0];
		/* §1.10  AND ITS OWN MEMBERS ARE GATHERED IN TURN. Opening an Other is a view like any other,
		   so it is subject to the same rule: if its members cannot all be named at that level, the
		   smallest of them gather into a further Other inside it. Leaving the list alone - on the
		   grounds that "Other inside Other" says nothing - meant the one view guaranteed to hold the
		   thinnest streams in the tree was the one view where nothing was gathered, and it showed
		   bands with no name at all. Every band is either named or inside something that is. */
		return down(rest.concat([{id:"other:"+key,name:"Other",tone:head.tone,top:!!head.top,
			value:acc,children:gather(down(tail),acc,"other:"+key)}]));
	};
	const sum = a => (a||[]).reduce((x,y) => x+y.value,0);
	return {hubName:tree.hubName, inTotal:tree.inTotal,
		in:gather(tree.in,sum(tree.in),"__in"), out:gather(tree.out,sum(tree.out),"__out")};
}

/* ------------------------------------------------------------------------------------------------
   §2, §4  LAYOUT.  (tree, focus, opt) -> Scene.  Pure: no DOM, no clock, no instance state.
   ------------------------------------------------------------------------------------------------ */
export function layout(tree,focus,opt){
	const WH = opt.worldH;
	const depth = ns => ns.reduce((d,n) => Math.max(d, n.children&&n.children.length ? 1+depth(n.children) : 1), 0);
	const outD = Math.max(1,depth(tree.out)), incD = Math.max(1,depth(tree.in));
	/* §2.2  the signed axis: column 0 is the hub, +d the d-th out level, -d the d-th in level. Every
	   rule below is written as a side and a depth, which is what makes opening an income stream the
	   same operation as opening a spending one, run the other way. */
	const OFF = incD+1, NC = incD+outD+3, at = c => c+OFF, term = s => s>0 ? outD+1 : -(incD+1);
	const columns = []; for(let i=0;i<NC;i++)columns.push([]);
	const hub = {id:HUB,name:tree.hubName,tone:"income",value:tree.inTotal,children:null};
	columns[at(0)].push(hub);

	const pathOf={}, kidsOf={}, nodeById={}, firstC={}, sideOf={};
	/* §3.9  the in side's root is a PLACE you can stand, not just a path prefix. */
	pathOf[INC]=[INC]; sideOf[INC]=-1; firstC[INC]=0;
	/* §2.6  a branch that bottoms out early is replanted into every remaining column, so its bar and
	   its ribbon carry on to the end of the view. */
	const plant = (ns,c,s,base) => ns.forEach(n => {
		if(n.value<=0)return;                                   // §1.4
		const q = base.concat([n.id]);
		pathOf[n.id]=q; nodeById[n.id]=n; sideOf[n.id]=s;
		if(firstC[n.id]===undefined)firstC[n.id]=c;
		columns[at(c)].push(n);
		const kids = n.children ? n.children.filter(k => k.value>0) : null;
		kidsOf[n.id] = (kids&&kids.length) ? kids : null;
		if(kidsOf[n.id])plant(kids,c+s,s,q);
		else for(let k=c+s; s>0 ? k<=term(1) : k>=term(-1); k+=s)columns[at(k)].push(n);
	});
	plant(tree.out,1,1,[]);
	plant(tree.in,-1,-1,[INC]);

	const nodeAt = path => {
		if(!path||!path.length)return null;
		const inc = path[0]===INC;
		if(inc&&path.length===1)return {id:INC,name:tree.hubName,children:tree.in,value:tree.inTotal};
		let ns = inc?tree.in:tree.out, n = null;
		for(let i=inc?1:0;i<path.length;i++){n=(ns||[]).filter(x => x.id===path[i])[0];if(!n)return null;ns=n.children}
		return n};
	const dep = id => {const q=pathOf[id];return q?(q[0]===INC?q.length-1:q.length):0};
	const FSIDE = focus.length ? (focus[0]===INC?-1:1) : 1;
	const fDep = FSIDE<0 ? focus.length-1 : focus.length;
	const own = id => sideOf[id]===FSIDE;
	const inFocus = id => {const q=pathOf[id];if(!q)return false;
		for(let i=0;i<focus.length;i++)if(q[i]!==focus[i])return false;
		return q.length>=focus.length};

	/* §1.10  An "Other" is a level you open. The view still runs two columns whatever it holds - how
	   deep it reaches must depend on the level and not on the subject, or two subjects side by side
	   stop framing to the same width (§5.6) - but a gathered tail is named ONCE, as itself, and its
	   members are left unnamed until it is opened. Naming them instead is what put five names in the
	   tier where the gathering had just been arranged to put two. */
	const isOther = id => typeof id==="string" && id.indexOf("other:")===0;
	/* §7.33  the node the view is OF: its path is the focus, exactly. */
	const isSubjectId = id => {const q=pathOf[id];
		return !!focus.length && !!q && q.length===focus.length && focus.every((v,i) => q[i]===v)};
	/* §7.2b  ONE LEVEL BELOW THE FOCUS means below THIS focus, not merely at the same distance from
	   the hub. Read as a difference of depths it counted any stream in any branch that happened to sit
	   at that depth - so opening a category put amounts on the leaves of the category beside it, which
	   the reader had not opened and is not reading. The path has to start with the focus's own. */
	const oneBelow = id => {const q=pathOf[id];
		return !!q && q.length===focus.length+1 && focus.every((v,i) => q[i]===v)};
	const opened = id => focus.indexOf(id)>=0;
	const shows = id => {const q=pathOf[id]; if(!q)return false;
		for(let i=focus.length;i<q.length-1;i++)if(isOther(q[i]))return false;
		return true};
	const gathered = id => isOther(id)&&!opened(id)&&shows(id);

	/* §4.8 §4.9  two columns past the focus on the side in focus, capped at that branch's terminal;
	   exactly one on the other side, because it is context rather than subject.

	   §1.10  Note what this means for a gathered tail: from a distance an "Other" is one band in the
	   tier, and opening it is how its members are read. Standing on its own parent, though, the view
	   already reaches two levels and the members are back in the tier - which is right, because that
	   is the level you asked for. Making the view stop short at an unopened Other was tried and
	   reverted: how deep the view runs would then depend on the subject rather than on the level, and
	   two subjects side by side would no longer frame to the same width (§5.6). */
	let endF = (focus.length?firstC[focus[focus.length-1]]:0) + 2*FSIDE;
	Object.keys(firstC).forEach(id => {
		if(!own(id)||!inFocus(id)||dep(id)-fDep>2)return;
		endF = FSIDE>0 ? Math.max(endF,firstC[id]) : Math.min(endF,firstC[id])});
	endF = FSIDE>0 ? Math.min(term(1),endF) : Math.max(term(-1),endF);
	const endO = -FSIDE, endR = FSIDE>0?endF:endO, endL = FSIDE>0?endO:endF;
	const endFor = s => s===FSIDE ? endF : endO;



	/* §4.1  the spacing rule, and it is the whole of it: the gap between two neighbours is decided by
	   where their PATHS diverge, measured from the focus. */
	const divergeAt = (a,b) => {const p=pathOf[a]||[],q=pathOf[b]||[];
		let i=0;while(i<p.length&&i<q.length&&p[i]===q[i])i++;return i};
	const gapBetween = (a,b) => {
		if(sideOf[a.id]!==FSIDE||sideOf[b.id]!==FSIDE)                  // §4.2  the other side is one set
			return opt.l2Px*opt.gapUnit;
		if(!inFocus(a.id)||!inFocus(b.id))return 0;                    // §4.3
		const rel = divergeAt(a.id,b.id)-focus.length;
		/* §4.1  A separation is a number of SCREEN pixels, converted with the scale this view will
		   actually be drawn at. It used to be converted once against the world and then carried through
		   the vertical fit like any other length - so zooming into a small stream multiplied the gaps
		   by the same factor as the streams, and a seven-pixel separation arrived on screen at seventy,
		   eating the room the fit had just been arranged to give the subject. The rules of the picture
		   are fixed; what stretches is the money. */
		return (rel<=0 ? opt.l1Px : (rel===1?opt.l2Px:0)) * opt.gapUnit;
	};
	const colH = WH-COLPAD*2;
	/* §4.5  What is being fitted, and into how much room. Left to itself the whole portfolio fills the
	   card; given a budget it is one stream's subtree filling the frame (§5.3). Either way the value
	   scale is solved for AFTER the gaps are known, so the two together come to exactly the budget. */
	const budgetV = Math.max(1, opt.fit ? opt.fit.v : tree.inTotal);
	const budgetH = opt.fit ? opt.fit.h : colH;
	const inBudget = opt.fit ? (id => own(id)&&inFocus(id)) : (() => true);
	let wantAny = 0, wantBudget = 0;
	columns.forEach((c,i) => {const k=i-OFF;if(k<endL||k>endR)return;
		let all=0, mine=0;
		for(let j=0;j<c.length-1;j++){const g=gapBetween(c[j],c[j+1]);
			all += g;
			if(inBudget(c[j].id)&&inBudget(c[j+1].id))mine += g}
		wantAny = Math.max(wantAny,all); wantBudget = Math.max(wantBudget,mine)});
	const room = budgetH*opt.gapShare;                                 // §4.4
	const gapScale = wantAny>room ? room/wantAny : 1;
	const scale = Math.max(0,budgetH-wantBudget*gapScale)/budgetV;
	const gapAt = (a,b) => gapBetween(a,b)*gapScale;

	/* §4.6  pitch is fixed by the ROOT span — one in column, the hub, two out columns — so that view
	   fills the card and every other view is a camera move over the same grid. */
	const PITCH = (WORLD_W*(1-opt.railFrac)-GUTTER-BAR)/3;
	const xs = []; for(let i=0;i<NC;i++)xs.push(GUTTER+(i-at(-1))*PITCH);
	const pos = columns.map(c => {
		let tot=0; c.forEach((n,i) => {tot += n.value*scale + (i<c.length-1?gapAt(n,c[i+1]):0)});
		let y = COLPAD+(colH-tot)/2; const m = {};
		c.forEach((n,i) => {m[n.id]={y:y,h:n.value*scale}; y += n.value*scale + (i<c.length-1?gapAt(n,c[i+1]):0)});
		return m;
	});

	const flows={}, bars={}, names={}, boxes={};
	/* §2.5  out-side ribbons stack on the SOURCE, in-side ribbons on the DESTINATION — the same shape
	   read backwards. §2.4 consecutive ribbons share an x, and at the hub, where neither side has a
	   bar, the two must land on the same line. */
	for(let c=0;c<=outD;c++){const i=at(c);columns[i].forEach(n => {
		let off = pos[i][n.id].y;
		const kids = c===0 ? tree.out.filter(r => r.value>0) : (kidsOf[n.id]||[n]);
		kids.forEach(kn => {const to=pos[i+1][kn.id];if(!to)return;
			flows[n.id+">"+kn.id+"@"+c] = {x0:xs[i],y0:off,x1:xs[i+1],y1:to.y,th:to.h,
				a:n.tone,b:kn.tone,aId:n.id,bId:kn.id,pass:n.id===kn.id,s:1};
			off += to.h})})}
	for(let c=term(-1);c<=-1;c++){const i=at(c);
		const byDest = {};
		columns[i].forEach(n => {const q=pathOf[n.id];
			const d = (c===-dep(n.id)) ? (q.length>2?nodeAt(q.slice(0,-1)):hub) : n;
			(byDest[d.id]=byDest[d.id]||{d:d,src:[]}).src.push(n)});
		Object.keys(byDest).forEach(k => {const g=byDest[k], to=pos[i+1][g.d.id]; if(!to)return;
			let off = to.y;
			g.src.forEach(n => {const q=pos[i][n.id];
				flows[n.id+">"+g.d.id+"@"+c] = {x0:xs[i]+BAR,y0:q.y,x1:xs[i+1]+(i+1===at(0)?0:BAR),y1:off,th:q.h,
					a:n.tone,b:g.d.tone,aId:n.id,bId:g.d.id,pass:n.id===g.d.id,s:-1};
				off += q.h})})}

	/* the hub's own name, which doubles as the way into the in side (§3.9) */
	/* §7.33  the income side is a place you can stand (§3.9), so standing on it it is the subject and
	   says what it is worth like any other. Not from the root, where it is one half of a picture rather
	   than the thing opened - the same exception the root itself takes. */
	const inSum = (tree.in||[]).reduce((x,y) => x+y.value,0);
	names[INC] = {x:xs[at(0)]+5,y:pos[at(0)][HUB].y,h:pos[at(0)][HUB].h,
		name:tree.hubName,anchor:"start",top:true,id:INC,tap:INC,vis:1,
		val:(focus.length===1&&focus[0]===INC) ? opt.format(inSum) : undefined, below:true};

	const slides = opt.tail!=="grow";
	/* §7.2  HOW THE TIER IS WRITTEN, decided once for the whole view. It fans out - a name against the
	   inside of its bar, its amount beyond - only when nothing stands between the focus and the tier:
	   when the tier IS the focus's children, the run inside each bar is empty and the names can have
	   it. As soon as there is a column of names in between, that run is shared with them, and those
	   two are not strangers - a tier entry's parent IS the name it would meet - so they want the same
	   place as a rule rather than by accident, and whichever entries lose fall back outside the bar
	   without their amounts. That is the mixed spelling this rule exists to prevent: one name against
	   its bar wearing its amount beside a sibling out past the bar with none.

	   "Is anything behind the front" was the first test here and it is not the same question. The
	   income side bottoms out at two levels, so its view can have nothing behind the front AND a
	   column of names in the middle - which is exactly where the mixed spelling came back. */
	const interiorNamed = Object.keys(nodeById).some(id => {
		const n=nodeById[id], s=sideOf[id], c=firstC[id], e=endFor(s);
		/* under the FOCUS, not merely at that depth: a stream in another branch entirely is not
		   standing between this focus and its tier, and letting one veto the fan-out meant the rule
		   was answering a question about the whole tree instead of about the view. */
		if(!own(id)||!inFocus(id)||n.label===false||!shows(id))return false;
		const d = dep(id)-fDep;
		if(d<1||d>2)return false;
		return !(!kidsOf[id] || gathered(id) || (s>0?c>=e:c<=e));
	});
	const fanOut = !interiorNamed;

	Object.keys(nodeById).forEach(id => {
		const n=nodeById[id], s=sideOf[id], e=endFor(s), ie=at(e), c=firstC[id];
		/* A stream may decline a name (§1: `label:false`). Its band is still drawn and still
		   navigable; it simply does not take a slot in the rail. */
		/* §7.30  and the only child does not take a name of its own while its parent is standing in
		   for it. Once the parent is the focus, the child is what you opened, and names itself. */
		const par = (pathOf[id]||[]).length>1 ? pathOf[id][pathOf[id].length-2] : null;
		const standsIn = !!par && !!kidsOf[par] && kidsOf[par].length===1
			&& own(par) && (dep(par)-fDep)>=1;
		const named = n.label!==false && !standsIn;
		const ends = !!(pos[ie]&&pos[ie][id]);
		const qb = pos[ends?ie:at(c)][id];
		/* §6.5  does THIS stream continue past the front? Only a stream whose own column IS the front
		   column and that has children does; one that bottomed out earlier and slid out to the end has
		   nothing behind it however long the view is. Carried per band, because the answer differs
		   between two bands sitting side by side at the same front. */
		/* §6.5  ...or that says so about itself. A stream marked `outside` (§1.2) draws on something
		   the picture does not model, which is what the plume means; without it, the one stream in the
		   view that comes from beyond the portfolio was the one cut hard among neighbours that trail
		   off, and the edge of the picture had a notch in it. */
		/* §7.30  A BAND STANDING UNDER ITS PARENT'S NAME TRAILS OFF LIKE THE PARENT WOULD. Where a
		   parent stands in for its only child, the name on the band is not the band's own - and that
		   name has something inside it. Read from the band alone the plume was absent, so a label the
		   reader can open sat against a bar cut hard: it looked like the end of the branch and answered
		   a tap by opening anyway. The plume says "you can go further here", and here you can. */
		const more = (c===e&&(!!kidsOf[id]||n.outside===true||standsIn)) ? 1 : 0;
		bars["slide:"+id] = {x:xs[ie],y:qb.y,h:qb.h,t:n.tone,id:id,vis:(ends&&slides)?1:0,more:more,sd:s};
		for(let k=c; s>0 ? k<=term(1) : k>=term(-1); k+=s){const q=pos[at(k)]&&pos[at(k)][id];if(!q)continue;
			bars["at:"+id+"@"+k] = {x:xs[at(k)],y:q.y,h:q.h,t:n.tone,id:id,vis:(!slides&&k===e)?1:0,
			                        more:more,sd:s}}
		const q0 = pos[at(c)][id];
		const within = s>0 ? c<=e : c>=e;
		/* §7.1  names on the focused side from the focus's depth to +2; the other side only at the
		   root.  §7.4  only the focused side has a rail. */
		/* §7.1  THE TIER IS A LEVEL, NOT A LEFTOVER. A name belongs in the column its own level
		   occupies; only the level the view ends on is written down the tier. A stream that bottoms
		   out early has its band slid out to the end column like any other (§9.3), and its name used
		   to follow the band there - so a gathered Other, or a category with nothing inside it, was
		   written on the right-hand edge among the leaf names while its own siblings were named a
		   column to the left. It reads as a demotion, and it jumps a whole column when you open it,
		   which is the one moment the eye is following it.

		   The band still slides; only the name stays put, and it is still on its own band, because
		   that band runs the width of the view. When the view ends at the level below the focus - an
		   exploded last level, where there is no column in between - that level IS the tier, and its
		   names are written there with their amounts (§7.2). A macro category is never a tier entry
		   at all: it always has a column of its own. */
		/* §7.2  A STREAM WITH NOTHING INSIDE IT IS A TERMINAL BAND WHEREVER IT SITS. The tier was defined
		   by depth alone - two levels below the focus - which reads the layout as a statement about
		   distance when what it actually says is "this one opens, that one does not": a caption in the
		   band for a stream you can go into, an entry on the rail for one you cannot. A childless stream
		   sitting one level below the focus got the caption, so it looked like a way in and was not, and
		   "Unallocated" - which can never have anything inside it - was the case where that showed every
		   time. Depth is the usual way to be terminal, not the only one. Macro categories keep the
		   caption regardless, by the !n.top below: they are the spine, not entries in a list. */
		/* §7.30  ...but not when it IS the focus: the subject is a caption, and its only child is what
		   you opened it to see. Standing in for the child is a thing a parent does from a distance. */
		const sole = !!kidsOf[id] && kidsOf[id].length===1 && (dep(id)-fDep)>=1;
		const atTier = (dep(id)-fDep)>=2 || fanOut || !kidsOf[id] || sole;
		/* §7.30  A PARENT AND ITS ONLY CHILD ARE ONE BAND. Nothing separates them: the parent's value
		   IS the child's, so they are drawn on the same pixels, and two names cannot sit there. The one
		   that belongs is the PARENT's - it is the way in, and the child is what the way leads to. It
		   takes the tier slot the child would have had, which is also what gets it past the thickness
		   test (§7.16): a rail entry is exempt, a caption is not, and a pass-through band is often thin.
		   Drawn as a caption it was dropped for thinness while the child kept its name on the same
		   band - the end of a road shown, with the road itself hidden and untappable. */
		const leafHere = own(id) && !n.top && atTier
			&& (!kidsOf[id] || sole || gathered(id) || (s>0?c>=e:c<=e));
		const show = own(id) ? (((dep(id)-fDep)>=0 && (dep(id)-fDep)<=2 && within && shows(id))?1:0)
		                     : ((!focus.length&&within)?1:0);
		const railX = xs[ie]+(s>0?BAR+6:-6);                                 // §7.2
		/* §7.3  a name sits on the side its own sub-structure is on — the side the view extends to. */
		const outward = (e-c)*s>0, ic = at(c);
		const nx = s>0 ? (outward?xs[ic]+5:xs[ic]-5) : (outward?xs[ic]+BAR-5:xs[ic]+BAR+5);
		/* The rail entry takes the position of the bar it names — `qb`, at the END of the view — not
		   the stream's own column. For a branch that bottoms out early those are different columns
		   with different stacking, so reading `q0` here put the name beside a band it does not name;
		   §7.16 then saw a name that had drifted off its bar and gave it up altogether. That is why
		   labels went missing on a ragged tree and looked arbitrary about which. */
		if(named)names[id] = leafHere
			/* §7.2  The NAME sits against the inside of the terminal bar and the AMOUNT beyond it. The
			   name belongs to the band, so it goes on the side the band is - it reads as a caption on
			   the thing it names rather than as an entry in a list beside the picture - and the amounts
			   line up in a column of their own out at the edge, where a column of numbers is what the
			   eye wants. It also puts the two on ONE line: the amount used to be a second line beneath
			   the name, which cost the tier more than twice the height per entry and was the first
			   thing given up when it ran short. */
			/* §7.2a  THE AMOUNT GOES ON THE BANDS THE PICTURE ALREADY CALLS DEAD ENDS. A band that has
			   nothing inside it draws no plume (§6.5) and answers a tap with a nudge rather than a move
			   (§3.10): the picture has already said, twice, that this is as far as the branch goes. The
			   amount is the last thing left to say about it, and there is no later view in which to say it.
			   Everything else - the whole view fanning out, the level you happen to be standing on - was a
			   proxy for that, and each proxy broke somewhere: a view-wide test took the amount off a
			   terminal band because a sibling still had children, and a level test took it off a terminal
			   band because it sat one level further down than the one you opened. Neither is a fact about
			   the band. Money from outside (§6.5) is excluded: it trails off, so it is not an end. */
			? (fan => ({x:fan ? (s>0?xs[ie]-6:xs[ie]+BAR+6) : railX, y:qb.y, h:qb.h, name:n.name,
			   val:fan ? opt.format(n.value) : undefined,
			   anchor:fan ? (s>0?"end":"start") : (s>0?"start":"end"),
			   vx:railX, vAnchor:s>0?"start":"end",
			   /* §7.3  Written inside the bar it has HALF the run back to the previous column, because
			      the other half belongs to the name at that column, which runs the other way - and the
			      two are not strangers: a tier entry's parent IS the name it would meet, its own band
			      contains the entry's band, so they arrive on nearly the same row and want the same
			      place as a rule rather than by accident. Written outside it has the rail, which is
			      its own and competes with nothing. */
			   maxW:(PITCH-BAR)/2-14, outer:!fan,
			   id:id,tap:id,vis:show,rail:true,rel:dep(id)-fDep,leaf:!kidsOf[id]}))(!kidsOf[id] && n.outside!==true && oneBelow(id))
			: {x:nx,y:q0.y,h:q0.h,name:n.name,anchor:((s>0)===outward)?"start":"end",
			   /* §9.6  whether this is one of the macro categories, which is what the root bolds. It
			      comes from the DATA and not from the column: the income streams sit one column from
			      the hub exactly as the macro categories do, but they are a level below them - the
			      single income group above them was unwrapped into the hub itself (§2.7). It no longer
			      chooses a FACE; there is one face now, and size says the level (§9.6). */
			   top:!!n.top,
			   /* §9.6  how far below the focus this name sits, and whether the stream ends here. The
			      type is decided from these rather than from the column: the column cannot tell the
			      root apart from a focused view, where the same column means a different level. */
			   rel:dep(id)-fDep, leaf:!kidsOf[id],
			   /* §7.3  A name inside the diagram runs from its own bar toward the next column, so the
			      room it has is one pitch. Zoomed in, a long name is longer than that and reaches into
			      the rail beyond - which is how two names came to be printed in the same place. It
			      folds onto a second line rather than being given up. */
			   maxW:PITCH-20,
			   /* §7.33  THE SUBJECT SAYS WHAT IT IS WORTH, under its own name. Every other amount in the
			      picture belongs to a band you can compare against its neighbours; this one answers "how
			      much is this" for the thing you opened, which is the question opening it asked. Not at
			      the root: there the subject is the whole portfolio and its total is the hub's own, said
			      once already. Under the name rather than beside it - the caption is inside the band with
			      the run to the next column, and an amount put beside it would compete for that run with
			      the tier (§7.32), which is the one place there is no room to spare. */
			   /* THE subject, not merely something at its depth: `dep(id)-fDep` is a difference of
			      absolute depths, so every category at the focus's own level was handed the subject's
			      treatment and wore an amount it had not been asked for. The path has to BE the focus. */
			   val:(isSubjectId(id)&&!isOther(id)) ? opt.format(n.value) : undefined,
			   below:true,
			   id:id,tap:id,vis:show};
	});

	/* boxes: a stream's own bars unioned with its whole subtree — what the camera frames. */
	columns.forEach((cl,i) => {const c=i-OFF;if(c<endL||c>endR)return;cl.forEach(n => {const q=pos[i][n.id];
		const b = boxes[n.id]||(boxes[n.id]={x0:1e9,y0:1e9,x1:-1e9,y1:-1e9});
		b.x0=Math.min(b.x0,xs[i]); b.x1=Math.max(b.x1,xs[i]+BAR);
		b.y0=Math.min(b.y0,q.y);   b.y1=Math.max(b.y1,q.y+q.h)})});
	const roll = ns => ns.forEach(n => {if(n.value<=0)return;
		if(n.children){roll(n.children);const b=boxes[n.id];if(!b)return;
			n.children.filter(c => c.value>0).forEach(c => {const cb=boxes[c.id];if(!cb)return;
				b.x0=Math.min(b.x0,cb.x0); b.y0=Math.min(b.y0,cb.y0);
				b.x1=Math.max(b.x1,cb.x1); b.y1=Math.max(b.y1,cb.y1)})}});
	roll(tree.out); roll(tree.in);
	tree.in.forEach(n => {const cb=boxes[n.id];if(!cb)return;
		const b = boxes[INC]||(boxes[INC]={x0:1e9,y0:1e9,x1:-1e9,y1:-1e9});
		b.x0=Math.min(b.x0,cb.x0); b.y0=Math.min(b.y0,cb.y0);
		b.x1=Math.max(b.x1,cb.x1); b.y1=Math.max(b.y1,cb.y1)});
	/* selfBox is a stream's OWN bar only — what §5.3 reaches toward. */
	const selfBox = {};
	Object.keys(firstC).forEach(id => {const c=firstC[id];if(c<endL||c>endR)return;
		const q = pos[at(c)]&&pos[at(c)][id]; if(!q)return;
		selfBox[id] = {x0:xs[at(c)],y0:q.y,x1:xs[at(c)]+BAR,y1:q.y+q.h}});
	/* §6.5  is there another level behind the front, on each side? A stream trails off past its tail
	   only when there is, and that is a fact about the DATA — not about where the front happens to
	   sit this frame. Carried as a number so a move blends it like everything else. */


	return {flows:flows,bars:bars,names:names,boxes:boxes,selfBox:selfBox,pathOf:pathOf,
		endX:xs[at(endF)]+(FSIDE>0?BAR:0), otherX:xs[at(endO)]+(FSIDE>0?0:BAR),
		side:FSIDE, pitch:PITCH, hubX:xs[at(0)],
		frontOut:xs[at(endR)]+BAR, frontIn:xs[at(endL)],
		inFocus:inFocus, nodeAt:nodeAt, capped:gapScale<1};
}

/* ------------------------------------------------------------------------------------------------
   §5  FRAME.  Pure: it measures and hands back the squeeze for the caller to apply.
   ------------------------------------------------------------------------------------------------ */
export function frame(g,focus,opt){
	const WH = opt.worldH;
	const b0 = focus.length ? g.boxes[focus[focus.length-1]] : null;
	/* A focus naming a stream this geometry does not hold is a stale path, not a view - and it is
	   framed the way the root is, on the whole picture. This used to return early with the shape
	   frame() handed back BEFORE compose() existed, {cam,squeeze}, so its caller read x, w and h off
	   an object that had none of them and the entire scene came out NaN - which draws nothing at all
	   rather than falling back to anything. Treating it as a hub place is the same answer compose()
	   reaches for the value scale, so the two agree. */
	const S = g.side||1, hub = isHubPlace(focus)||(focus.length>0&&!b0);
	/* §5.2  an ordinary subject is framed by its own box out to the view's end; a hub place runs from
	   the far end of the focused side to the far end of the other. */
	const b = hub ? (S>0 ? {x0:g.otherX,y0:0,x1:g.endX,y1:WH}
	                     : {x0:g.endX,y0:0,x1:g.otherX,y1:WH})
	              : (S>0 ? {x0:b0.x0,y0:b0.y0,x1:g.endX,y1:b0.y1}
	                     : {x0:g.endX,y0:b0.y0,x1:b0.x1,y1:b0.y1});
	/* The far side plumes too (§6.3) and needs somewhere to fade; the focused side has the rail. */
	const soft = opt.softFrac*(g.pitch||200);
	if(S>0)b.x0 -= soft*opt.leftShare; else b.x1 += soft;
	let w = (b.x1-b.x0)/(1-opt.railFrac);                                // §5.4
	let x0 = S>0 ? b.x0 : (b.x1-w);
	/* §5.5  padding asked for in screen pixels and solved for, not iterated; the same world amount on
	   every side. */
	const f = Math.min(0.45,opt.padPx/opt.cssW);
	const w2 = w/(1-2*f), pad = f*w2;
	x0 -= pad; w = w2;
	/* §5.6  the height follows the width, so left and right always land at the same x. This function
	   only MEASURES: what the picture is scaled to is settled in the layout (§4.5), which is the only
	   place that can keep the separations a fixed size while the streams stretch. */
	const nh = w/(WORLD_W/WH);
	return {x:x0,w:w,h:nh,pad:pad};
}

/* The whole placement, in the order the numbers actually depend on each other. The frame's WIDTH
   comes from the columns alone, so it - and therefore the height, and therefore the scale the view
   will be drawn at - can be settled before anything vertical is decided. Only then is the layout run
   for real, told how much room the subject has and what a pixel is worth. */
export function compose(tree,focus,opt){
	const measure = layout(tree,focus,Object.assign({},opt,{gapUnit:WORLD_W/opt.cssW}));
	/* A focus naming a stream the tree does not hold is a stale path, not a view - the guard in
	   setTree drops it, and this is the second line of that defence. It cannot be patched over
	   downstream: the placement resolves the path to find where the view begins, and a path that
	   resolves to nothing puts NaN through every column, which draws NOTHING rather than falling back
	   to anything. The root is what the path no longer says. */
	if(focus.length&&!measure.nodeAt(focus))return compose(tree,[],opt);
	const hub = isHubPlace(focus);
	const subject = hub ? null : measure.nodeAt(focus);
	const f = frame(measure,focus,opt);
	const k = f.w/opt.cssW;                                   // world units per screen pixel
	/* §5.3  one strip at each end for a neighbour's name; a hub place has no neighbours (§3.7). */
	const strip = hub ? 0 : opt.neighbourPx*k;
	const fit = hub
		? {v:tree.inTotal, h:Math.min(opt.worldH-COLPAD*2, f.h-2*f.pad)}
		: {v:subject.value, h:Math.max(1,f.h-2*strip)};
	const g = layout(tree,focus,Object.assign({},opt,{gapUnit:k,fit:fit}));
	const b = hub ? {y0:COLPAD,y1:opt.worldH-COLPAD} : g.boxes[focus[focus.length-1]];
	const cy = b ? (b.y0+b.y1)/2 : opt.worldH/2;
	return {g:g, cam:{x:f.x, y:cy-f.h/2, w:f.w, h:f.h}};
}
export function squeezeScene(g,q){
	if(!q)return g;
	const k=q.k, cy=q.cy, f = v => cy+(v-cy)*k;
	Object.keys(g.flows).forEach(i => {const o=g.flows[i];o.y0=f(o.y0);o.y1=f(o.y1);o.th*=k});
	Object.keys(g.bars ).forEach(i => {const o=g.bars[i]; o.y=f(o.y);o.h*=k});
	Object.keys(g.names).forEach(i => {const o=g.names[i];o.y=f(o.y);o.h*=k});
	[g.boxes,g.selfBox].forEach(m => Object.keys(m).forEach(i => {m[i].y0=f(m[i].y0);m[i].y1=f(m[i].y1)}));
	return g;
}
/* §3.5 §3.6 §3.7  who is beside you. Kin come from the tree the path is IN, and a hub place has
   nobody beside it: the other side of the money is not a sibling.

   The camera no longer consults this - it reaches for no one, it fills itself with the subject and
   leaves a strip at each end (§5.3). What navigates is `sibTarget` in the view, which reads the same
   rule off the paths. This is kept because it states that rule in one place and the tests assert
   against it. */
export function siblingIds(tree,path){
	if(!path.length||isHubPlace(path))return [];
	const inc = path[0]===INC, top = inc?tree.in:tree.out, q = inc?path.slice(1):path;
	if(!q.length)return [];
	const walk = w => {let ns=top,n=null;
		for(const id of w){n=(ns||[]).filter(x => x.id===id)[0];if(!n)return null;ns=n.children}return n};
	const parent = q.length>1 ? walk(q.slice(0,-1)) : null;
	const kin = parent ? (parent.children||[]) : top;
	return kin.filter(n => n.value>0 && n.id!==q[q.length-1]).map(n => n.id);
}
/* §3.5 §3.6 §7.23  WHICH names are pinned, and on which side. Decided from one geometry and never
   from a blend: during a move the subject's band starts wherever it sat in the view you came from, so
   "is this neighbour above or below it" is a coin toss on the first frames and the answer flickers -
   which pinned and unpinned a name from frame to frame, and sent it bouncing between the slot and its
   own band. Made once, from where the move is going, it simply holds. */
function pinsFor(G,focus){
	const out = {up:[],down:[]};
	if(!focus.length)return out;
	const fn = G.names[focus[focus.length-1]];
	if(!fn)return out;
	const fMid = fn.y+fn.h/2;
	const mySide = focus[0]===INC?-1:1;
	const sideOfId = id => {const q=G.pathOf[id];return q?(q[0]===INC?-1:1):0};
	const heads = [];
	Object.keys(G.names).forEach(q => {const n=G.names[q], path=G.pathOf[n.id];
		if(!path)return;
		let d=0; while(d<focus.length&&d<path.length&&path[d]===focus[d])d++;
		if(d>=focus.length||path.length!==d+1)return;
		const s = sideOfId(n.id);
		if(s!==0&&s!==mySide)return;                                  // §3.7
		/* the map key, not `_k`: this runs on the destination before any of it has been painted, and
		   `_k` is stamped on during painting. Reading it there gave undefined and pinned nobody. */
		heads.push({n:n,d:d,key:q})});
	const mid = n => n.y+n.h/2;
	const pick = side => {
		for(let d=focus.length-1;d>=0;d--){
			const c = heads.filter(h => h.d===d&&(side<0?mid(h.n)<fMid:mid(h.n)>=fMid));
			if(c.length)return c.sort((a,b) => side<0?mid(b.n)-mid(a.n):mid(a.n)-mid(b.n))
				.slice(0,1).map(h => h.key);
		}
		return []};
	out.up = pick(-1); out.down = pick(1);
	return out;
}


/* §8.2  Numbers interpolate, and everything else takes the destination's value - but some numbers are
   not quantities, they are FACTS with a number for a name, and interpolating one produces a state that
   never existed. `rel` is a name's level relative to the focus: a name moving from one below the focus
   to the focus itself is at level 1 or level 0 and never at 0.4, and the type rule that reads it (§9.6)
   compares it against a level, so a lerped value tests false for the whole move and only becomes true
   on the last frame - which is a snap at the end of a move rather than the change travelling with it.
   The SIZE is what travels; the level is decided by where you are going. */
const DISCRETE = {rel:1, leaf:1, top:1, sd:1, vis:0};

/* §8.2  pair by key — which is why §4.7 insists the key set never depends on the focus. */
export function blend(A,B,e){
	const out = {flows:{},bars:{},names:{},boxes:B.boxes,pathOf:B.pathOf,
		inFocus:B.inFocus,nodeAt:B.nodeAt,capped:B.capped,side:B.side,pitch:B.pitch,hubX:B.hubX,
		frontOut:lerp(A.frontOut,B.frontOut,e), frontIn:lerp(A.frontIn,B.frontIn,e),
		};
	["flows","bars","names"].forEach(kind => {
		const keys={}; Object.keys(A[kind]).forEach(k => keys[k]=1); Object.keys(B[kind]).forEach(k => keys[k]=1);
		Object.keys(keys).forEach(k => {
			const a=A[kind][k], b=B[kind][k];
			if(a&&b){const o={};for(const q in b)
					o[q] = (!DISCRETE[q]&&typeof b[q]==="number"&&typeof a[q]==="number")
						? lerp(a[q],b[q],e) : b[q];
				/* §7.33  A VALUE THAT IS LEAVING KEEPS ITS TEXT WHILE IT FADES. The merge takes the
				   destination's keys, so the subject you are moving AWAY from lost its amount on the very
				   first frame - it blinked out instead of going over the lead, and only the arrival was
				   ever animated. The text is kept; what makes it leave is the fade, not the deletion. */
				if(a.val!==undefined&&o.val===undefined){o.val=a.val;o.below=a.below;o.valOut=true}
				out[kind][k]=o}
			else out[kind][k]=Object.assign({},a||b);
		});
	});
	return out;
}

/* ==================================================================================================
   THE ENGINE
   ================================================================================================== */
export default class MoneyFlowEngine {
	constructor(host,options){
		this.host = host;
		this.opt = Object.assign({},options);
		this.palette = options.palette;
		this.format = options.format || (v => Math.round(v).toLocaleString());
		this.onFocusChange = options.onFocusChange || (() => {});
		this.tune = Object.assign({},TUNE,options.tune||{});
		/* the authored sizes are the NARROW end; retype() reaches for the app's own where the card is
		   wide enough to carry them. */
		this.type0 = {body:this.tune.bodyPx, small:this.tune.smallPx, amount:this.tune.amountK};
		this.worldH = Math.round(WORLD_W/this.tune.ratio);

		this.svg = document.createElementNS(SVGNS,"svg");
		this.svg.setAttribute("role","img");
		this.svg.setAttribute("aria-label","Money flow diagram");
		this.svg.style.display = "block";
		this.svg.style.userSelect = "none";
		this.svg.style.webkitUserSelect = "none";
		host.appendChild(this.svg);

		this.gDefs = this.mk("defs",{});
		this.gHull = this.mk("g",{});
		this.gText = this.mk("g",{});
		this.gFlow = [0,1,2,3].map(() => this.mk("g",{}));
		this.gBars = [0,1,2,3].map(() => this.mk("g",{}));
		this.gFlow.forEach(g => this.gHull.appendChild(g));
		this.gBars.forEach(g => this.gHull.appendChild(g));
		this.svg.appendChild(this.gDefs); this.svg.appendChild(this.gHull); this.svg.appendChild(this.gText);

		/* Something to measure text with before it is placed. The rail's sweep reserves each entry a
		   height, so whether a name folds has to be known before the sweep runs, not while drawing. */
		this.meas = this.mk("text",{opacity:0,"pointer-events":"none"});
		this.svg.appendChild(this.meas);

		this.uid = "mf"+Math.random().toString(36).slice(2,8);   // ids are private to this instance
		this.pool = {grad:new Map(),flow:new Map(),bar:new Map(),text:new Map()};
		this.frameSeq = 0;
		/* label state — the only thing that lives between frames (§7.5 §7.18 §7.19) */
		this.fade={}; this.offY={}; this.offX={}; this.fadeAtStart={};
		this.sY={}; this.sOff={}; this.sPos={}; this.sSeed={};
		this.sSz={}; this.szSeed={};

		this.focus = [];
		this.tree = null; this.shown = null;
		this.G = null; this.cam = {x:0,y:0,w:WORLD_W,h:this.worldH};
		this.dimNow = 1; this.animating = false;
		this.moveStart = 0; this.moveEnds = 0; this.maskFrom = []; this.maskBack = false;
		this.moveTo = null;
		this.clock = 0; this.dataClock = 0; this.fadePump = 0;
		this.nudgeT0 = 0; this.nudgePump = 0;
		this.reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

		this.onResize = () => this.rebuild();
		if(typeof ResizeObserver!=="undefined"){
			this.ro = new ResizeObserver(this.onResize); this.ro.observe(host);
		} else window.addEventListener("resize",this.onResize);
	}

	/* ---- lifecycle ------------------------------------------------------------------------- */
	setPalette(p){
		const same = this.palette && Object.keys(p).every(k => p[k]===this.palette[k]);
		this.palette = p;
		if(!same && this.G)this.paint();
	}
	getFocus(){return this.focus.slice()}
	/* §3.10  A TAP THAT CANNOT GO DEEPER STILL ANSWERS. A stream with nothing inside it carried no
	   handler at all, so the last level of every branch was a place where tapping did nothing - and a
	   control that does nothing reads as broken rather than as the end of the road. The view springs a
	   little toward the reader and settles: enough to say the tap was heard, too little to be taken
	   for a move. Refused mid-move, where it would fight the camera for the same frames, and under
	   reduced motion, where the whole point is that nothing springs. */
	nudge(){
		if(this.reduced||this.animating||!this.G)return;
		this.nudgeT0 = performance.now();
		const step = () => {
			const done = performance.now()-this.nudgeT0 >= this.tune.nudgeMs;
			if(done)this.nudgeT0 = 0;
			this.paint();
			if(!done)this.nudgePump = requestAnimationFrame(step);
		};
		cancelAnimationFrame(this.nudgePump);
		this.nudgePump = requestAnimationFrame(step);
	}
	/* the camera THIS frame is drawn through: the resting one, unless a nudge is in flight. In and
	   back out through neutral once, decaying - a spring, rather than the shake that means refusal. */
	nudged(cam){
		if(!this.nudgeT0)return cam;
		const t = Math.min(1,(performance.now()-this.nudgeT0)/this.tune.nudgeMs);
		const a = this.tune.nudgeAmp*Math.sin(2*Math.PI*t)*(1-t);
		if(!a)return cam;
		const w = cam.w*(1-a), h = cam.h*(1-a);
		return {x:cam.x+(cam.w-w)/2, y:cam.y+(cam.h-h)/2, w:w, h:h};
	}
	reset(){this.go([])}
	destroy(){
		cancelAnimationFrame(this.clock); cancelAnimationFrame(this.dataClock);
		cancelAnimationFrame(this.fadePump);
		if(this.ro)this.ro.disconnect(); else window.removeEventListener("resize",this.onResize);
		if(this.svg.parentNode)this.svg.parentNode.removeChild(this.svg);
	}
	/* §8.4  a new tree tweens the values and re-derives the layout each frame; the focus is dropped
	   if the stream it names has gone. */
	/* `replace` swaps the tree outright instead of tweening to it. The tween pairs streams by id and
	   animates the UNION of the two bases, which is right for the same portfolio on two bases and
	   meaningless between two unrelated trees - there the union is simply both of them at once. */
	setTree(raw,replace){
		/* The same tree is not a change. Opening a stream calls back to the host, which re-renders and
		   hands the tree straight back; without this the value tween starts, and its per-frame rebuild
		   overwrites the geometry and camera that the focus transition is in the middle of animating.
		   The caller memoises, so an unchanged tree arrives as the same reference. Compared on the RAW
		   value, since the gathering below produces a new object every time. */
		if(raw===this.raw)return;
		this.raw = raw;
		/* the full options, not just the tune: the gathering now asks how much room a set of siblings
		   will have on screen (§1.10), and that needs the card's width. */
		this.groupedAt = this.host.clientWidth||0;
		const tree = groupTail(raw,this.opts());                  // §1.10
		if(!this.shown||replace){this.tree=tree;
			this.shown=JSON.parse(JSON.stringify(tree)); return this.rebuild()}
		this.tree = tree;
		if(this.reduced){this.shown=JSON.parse(JSON.stringify(tree)); return this.rebuild()}
		/* §8.5  THE TWO SIDES OF A TWEEN MUST SHARE A SHAPE. It animates the union, pairing by id, and
		   that is only a tree while every stream sits under the same parent on both sides. The
		   gathering is decided from the values (§1.10), so a different window gathers differently -
		   and then a stream is a child of its category on one side and a member of that category's
		   Other on the other. The union holds it in BOTH places, counts its value twice, and what
		   comes out is not a Sankey of anything: ribbons crossing, parents smaller than their
		   children. Switching period back and forth was enough to see it.

		   Refusing to animate was the first answer and it was worse than the fault: the picture jumped
		   on every change of window, which is the one moment the streams are all still there and only
		   their sizes have changed - exactly what an animation is for. So the state it starts FROM is
		   rebuilt on the destination's shape, carrying the values that are on screen now: every id
		   lands under one parent, every parent is the sum of its children, and the tween is a pure
		   change of size from there. What is not animated is a stream moving into or out of an Other,
		   which happens on the first frame - and that is the right frame for it, since nothing has
		   moved yet and it is not a journey the eye could follow anyway. */
		const onto = (dst,src) => {
			const val = {};
			const scan = l => (l||[]).forEach(n => {val[n.id]=n.value; scan(n.children)});
			scan(src.in); scan(src.out);
			/* §8.5  A STREAM THE DESTINATION DOES NOT HOLD STILL HAS TO SHRINK INTO NOTHING. Built from
			   dst's nodes alone, this dropped it outright: it never entered the union, so it could not
			   travel to zero and blinked out on the first frame instead. On a change of window that
			   regroups - which is exactly what an extra band on the in side causes, From reserves being
			   the usual cause of one - that took a fifth of the picture with it in a single frame.

			   Such a stream has no conflict to resolve: dst does not place it at all, so carrying it
			   under the parent it had cannot give an id two parents. It is carried only where dst still
			   has that parent AND that parent is compound there - a stream cannot hang off a leaf without
			   breaking §1.3 on the way in - and only if nothing in its subtree lives on in dst, since
			   that id would then be in the union twice and counted twice. */
			const has = {}; const mark = l => (l||[]).forEach(n => {has[n.id]=n; mark(n.children)});
			mark(dst.in); mark(dst.out);
			const clean = n => !has[n.id] && (n.children||[]).every(clean);
			const stray = {};
			const sweep = (l,p) => {
				let anchor = null;                 // the last sibling that will still be in the built list
				(l||[]).forEach(n => {
					if(has[n.id]){anchor=n.id; return sweep(n.children,n.id)}
					if(!clean(n))return;
					const host = has[p];
					if(!(p==="__in"||p==="__out"||(host&&host.children)))return;
					(stray[p] = stray[p]||[]).push({after:anchor, n:JSON.parse(JSON.stringify(n))});
					anchor = n.id;
				});
			};
			sweep(src.in,"__in"); sweep(src.out,"__out");
			const build = (l,p) => {
				const kids = (l||[]).map(n => {
					const k = n.children ? build(n.children,n.id) : null;
					return Object.assign({},n,{children:k,
						value: k&&k.length ? k.reduce((a,b) => a+b.value,0)
						                   : (val[n.id]===undefined?0:val[n.id])})});
				/* back in the slot it held on screen, not at the end of the list: each anchor is either a
				   stream the destination kept or a stray already put back, so the order survives. */
				(stray[p]||[]).forEach(sy => {
					const at = sy.after ? kids.findIndex(x => x.id===sy.after)+1 : 0;
					kids.splice(at,0,sy.n)});
				return kids;
			};
			const [i,o] = [build(dst.in,"__in"),build(dst.out,"__out")];
			const sum = a => a.reduce((x,y) => x+y.value,0);
			return {hubName:dst.hubName, in:i, out:o, inTotal:Math.max(sum(i),sum(o))};
		};
		const placeOf = t => {const m={};
			const walk = (l,p) => (l||[]).forEach(n => {m[n.id]=p; walk(n.children,n.id)});
			walk(t.in,"__in"); walk(t.out,"__out"); return m};
		const shapes = [placeOf(this.shown),placeOf(tree)];
		const reshaped = Object.keys(shapes[1]).some(id =>
			shapes[0][id]!==undefined&&shapes[0][id]!==shapes[1][id]);
		const from = reshaped ? onto(tree,this.shown) : this.shown;
		if(reshaped)this.shown = JSON.parse(JSON.stringify(from));
		const t0 = performance.now();
		cancelAnimationFrame(this.dataClock);
		/* §1.5  Values are paired by ID, not by position. The two bases do not hold the same streams -
		   one with no transactions this period is absent from the actuals and present in the target -
		   so pairing by position could not match them and the picture snapped from one to the other
		   instead of moving. What animates is the UNION: a stream in both travels between its two
		   values, one in only one of them grows out of, or shrinks into, nothing.

		   §1.3 survives this. Both trees satisfy it for the streams they hold, a missing stream counts
		   as zero on its side, and interpolation is linear - so a parent stays the sum of its children
		   at every step. */
		const union = (fs,ts) => {
			const byId = {}; (fs||[]).forEach(n => byId[n.id]=n);
			const seen = {}, out = [];
			(ts||[]).forEach(t => {seen[t.id]=1; const f=byId[t.id];
				out.push(Object.assign({},t,{children:(t.children||(f&&f.children))
					? union(f&&f.children,t.children) : null}))});
			/* §8.5  AND IT KEEPS ITS PLACE ON THE WAY OUT. Appended to the end, a stream that is leaving
			   jumped a slot on the first frame - From reserves, sitting between two income streams,
			   dropped below both the instant the window changed, and the eye reads that as the band
			   moving when all it is doing is going away. It goes back after the neighbour it followed on
			   screen, and since it ends at nothing, where it sits by then costs nothing. */
			(fs||[]).forEach((f,i) => {if(seen[f.id])return;
				const prev = (fs||[]).slice(0,i).reverse().filter(p => out.some(n => n.id===p.id))[0];
				const at = prev ? out.findIndex(n => n.id===prev.id)+1 : 0;
				seen[f.id]=1;
				out.splice(at,0,Object.assign({},f,{children:f.children?union(f.children,null):null}))});
			return out;
		};
		const values = (ns,m) => {(ns||[]).forEach(n => {m[n.id]=n.value; values(n.children,m)}); return m};
		const vFrom = values(from.in,values(from.out,{}));
		const vTo   = values(tree.in,values(tree.out,{}));
		this.shown = {hubName:tree.hubName, inTotal:from.inTotal,
			in:union(from.in,tree.in), out:union(from.out,tree.out)};
		/* §8.7  THE STACK RE-SORTS AS THE VALUES MOVE. Siblings are stacked biggest first (§3.2), so a
		   change of window that changes two siblings' relative size changes their slots - and the union
		   is built in the DESTINATION's order, so on the first frame every such pair swapped places
		   while still holding the sizes it had before. Measured on the bench: a change of window put 43
		   to 54 nodes of about 150 in a different slot among their siblings, and at a focus that read as
		   four to six bands jumping between 10 and 160 world units of 440 in a single frame while the
		   median band did not move at all. It is the loudest thing about a change of window and it was
		   invisible to every probe that read values or checked §1.3, because nothing is wrong with the
		   numbers - only with where they are drawn.

		   Sorting on the value each frame makes the order a function of the picture rather than of the
		   destination: at the start it IS the order on screen, at the end the destination's, and in
		   between two bands that trade rank cross over as their sizes cross, which is the only reading
		   of "biggest first" that is true at every instant. A pair crosses at most once, because the
		   values between two fixed endpoints are monotonic - so this cannot flicker.

		   A stream on only ONE side of the tween sorts by the value it has where it exists, not by its
		   live one. It is either arriving from nothing or leaving for it, and sorting it on a value
		   sweeping through the whole range would walk it down the stack past every sibling on its way
		   out - which is what §8.5 stopped it doing when it fixed the slot a leaver keeps. It holds one
		   slot and only grows or shrinks in place.

		   WHAT IS LEFT, and why it is left alone. Where the shape also changes (§8.5), the from-state
		   takes the destination's shape in one step, a set that gains or loses a member needs a
		   different height for its stack, and the world is re-scaled per focus (§5.3) - so at a focus
		   the whole picture still breathes by a few percent on the first frame. Holding the camera
		   where it was and easing it in looks like the fix and measurably is not: without it the median
		   band moves 4 screen pixels and the worst 18; holding the camera those become 9 and 12. The
		   camera's re-solve is not a step to be smoothed away, it is what COMPENSATES for the re-scale
		   and keeps the picture still while the world changes size underneath it. Every band moving
		   together by a few pixels is a coherent breath and reads as one; it is bands moving by
		   DIFFERENT amounts that reads as a glitch, and that is what the re-sort above removes. */
		const sortVal = n => vFrom[n.id]===undefined ? (vTo[n.id]||0)
			: (vTo[n.id]===undefined ? vFrom[n.id] : n.value);
		const rec = (cur,key,e) => {
			cur.forEach(n => {
				n.value = lerp(vFrom[n.id]||0, vTo[n.id]||0, e);
				if(n.children)rec(n.children,n.id,e)});
			const o = stackOrder(cur,key,sortVal);
			for(let i=0;i<o.length;i++)cur[i] = o[i];
		};
		const fromTotal = from.inTotal;
		/* Seed the union at where it is coming FROM. Built from the destination's nodes it would
		   otherwise hold the destination's values for one frame - a snap, and an unbalanced one,
		   since the streams carried over from the old tree still hold the old numbers. */
		rec(this.shown.in,"__in",0); rec(this.shown.out,"__out",0);
		const step = now => {
			const e = ease(Math.min(1,(now-t0)/this.tune.dataMs));
			rec(this.shown.in,"__in",e); rec(this.shown.out,"__out",e);
			this.shown.inTotal = lerp(fromTotal,tree.inTotal,e);
			if(this.focus.length&&this.G&&!this.G.nodeAt(this.focus)){this.focus=[];this.onFocusChange([])}
			this.rebuild();
			if(e<1)this.dataClock=requestAnimationFrame(step);
		};
		this.dataClock = requestAnimationFrame(step);
	}

	opts(){
		const cssW = this.host.clientWidth||0;
		return Object.assign({},this.tune,{cssW:cssW||360,worldH:this.worldH,format:this.format,
			inkR:this.inkR});
	}
	place(focus,opt){return compose(this.shown,focus,opt)}
	/* §9.8  TYPE TAKES THE APP'S OWN SIZE WHERE THERE IS ROOM FOR IT. The bands scale with the card and
	   a line of type does not (§1.10), so no single size serves both ends: the 12px that fills a phone
	   card is 3.7% of its width and 1.6% of a desktop one, which is why the wide picture read as
	   under-set beside its own title. The authored sizes are kept at phone width - they are what lets a
	   phone carry twelve names - and the design system's are reached by the width where they cost none.
	   Nothing changes unless a wide size is passed in: the engine has no design system of its own. */
	retype(){
		const t = this.tune, w = this.host.clientWidth||t.narrowW;
		const f = Math.max(0,Math.min(1,(w-t.narrowW)/Math.max(1,t.wideW-t.narrowW)));
		const to = (a,b) => b ? a+(b-a)*f : a;
		const small = to(this.type0.small,t.smallWidePx);
		if(Math.abs(small-t.smallPx)>0.01)this.groupedAt = -1;   // the gathering is measured in type
		t.bodyPx = to(this.type0.body,t.bodyWidePx); t.smallPx = small;
		t.amountK = to(this.type0.amount,t.amountWideK);
	}
	rebuild(){
		if(!this.shown)return;
		if(!this.host.clientWidth)return;              // nothing to measure against yet
		this.retype();
		this.regroup();
		const r = this.place(this.focus,this.opts()); this.G=r.g; this.cam=r.cam; this.paint();
	}
	/* §1.10  THE GATHERING DEPENDS ON THE CARD'S WIDTH, so it cannot be settled once when the tree
	   arrives. How many names a set can carry is a question about physical room: the bands scale with
	   the card, a line of type does not, so a wider card holds more names and gathers less. setTree
	   runs before the host has been measured - on a fresh mount `clientWidth` is still zero - so a
	   grouping made there is made against the fallback width and never revisited, which is how a card
	   326px wide came to show the gathering for one of 360. It is redone whenever the width it was
	   computed for stops being the width on screen, which also covers a rotation or a resize. */
	regroup(){
		const w = this.host.clientWidth||0;
		if(!w||!this.raw||Math.abs(w-(this.groupedAt||0))<1)return;
		this.groupedAt = w;
		const tree = groupTail(this.raw,this.opts());
		this.tree = tree;
		this.shown = JSON.parse(JSON.stringify(tree));
		/* a focus naming a stream the new grouping does not hold is a stale path (§5.3) */
		const holds = path => {let ns = path[0]===INC?this.shown.in:this.shown.out, n=null;
			for(let i=path[0]===INC?1:0;i<path.length;i++){
				n=(ns||[]).filter(x => x.id===path[i])[0]; if(!n)return false; ns=n.children}
			return true};
		if(this.focus.length&&this.focus[0]!==INC&&!holds(this.focus))this.focus = [];
	}
	/* §8.1 §8.2 §8.3  one clock: state interpolates and the geometry is re-derived from it. */
	go(toFocus){
		if(!this.shown||!this.host.clientWidth)return;
		const opt = this.opts(), from = this.focus;
		const A = this.G||this.place(from,opt).g;
		const rB = this.place(toFocus,opt);
		const B = rB.g, camA = Object.assign({},this.cam), camB = rB.cam;
		const dimTo = toFocus.length?opt.dim:1, dimFrom = this.dimNow;
		const litIn = (g,fp) => id => (!fp.length||!id||id===HUB||id===INC) ? 1 : (g.inFocus(id)?1:opt.dim);
		const litA = litIn(A,from), litB = litIn(B,toFocus);
		this.focus = toFocus; this.onFocusChange(toFocus.slice());
		cancelAnimationFrame(this.clock);
		const settle = () => {this.animating=false;this.pinsHeld=null;this.moveTo=null;
			this.G=B;this.cam=camB;this.dimNow=dimTo;this.paint()};
		if(this.reduced)return settle();
		this.animating = true;
		const t0 = performance.now(), D = opt.moveMs;
		this.moveStart = t0; this.moveEnds = t0+D;
		this.fadeAtStart = Object.assign({},this.fade);
		/* §7.23  who is pinned where, settled once from the destination and held for the move */
		this.pinsHeld = pinsFor(B,toFocus);
		/* §7.28  where every name is GOING, so a name can be aimed at its landing place instead of
		   chasing a bar whose screen path the re-scaling bends. */
		this.moveTo = {g:B, cam:camB};
		this.maskFrom = from.slice();
		this.maskBack = toFocus.length<from.length;
		const step = now => {
			const t = Math.min(1,(now-t0)/D), e = ease(t);
			this.G = blend(A,B,e); this.G.lit = id => lerp(litA(id),litB(id),e);
			this.cam = {x:lerp(camA.x,camB.x,e),y:lerp(camA.y,camB.y,e),
			            w:lerp(camA.w,camB.w,e),h:lerp(camA.h,camB.h,e)};
			this.dimNow = lerp(dimFrom,dimTo,e);
			this.paint();
			if(t<1)this.clock=requestAnimationFrame(step); else settle();
		};
		this.clock = requestAnimationFrame(step);
	}

	/* ---- small DOM helpers, with a pool keyed so nothing is rebuilt per frame ---------------- */
	mk(t,a){const n=document.createElementNS(SVGNS,t);for(const k in a)n.setAttribute(k,a[k]);return n}
	set(n,a){for(const k in a){const v=""+a[k];if(n.getAttribute(k)!==v)n.setAttribute(k,v)}}
	reuse(kind,key,make){
		let e = this.pool[kind].get(key);
		if(!e){e=make();this.pool[kind].set(key,e)}
		e.__seen = this.frameSeq; return e;
	}
	sweep(kind){
		this.pool[kind].forEach((e,k) => {if(e.__seen!==this.frameSeq){
			if(e.parentNode)e.parentNode.removeChild(e); this.pool[kind].delete(k)}});
	}
	sweepText(){
		this.pool.text.forEach((r,k) => {if(r.__seen!==this.frameSeq){
			[r.a,r.a2,r.a3,r.a4,r.b].forEach(e => {if(e.parentNode)e.parentNode.removeChild(e)});
			this.pool.text.delete(k)}});
	}
	dropText(key){const r=this.pool.text.get(key);if(!r)return;
		[r.a,r.a2,r.a3,r.a4,r.b].forEach(e => {if(e.parentNode)e.parentNode.removeChild(e)});
		r.__seen = this.frameSeq;
	}
	tone(t){return this.palette[t]||this.palette.bodyTextSecondary}
	/* §9.6  ONE FACE for every name. A second face for the macro categories was a third thing for the
	   type to say on top of the two it already says, and with weight and size both in play as well the
	   tier read as four unrelated treatments rather than one system.

	   So: SIZE says which level a name is at, relative to where you are standing. The level you are on
	   and the one below it are body size; the level below THAT - the leaves of the view, the tier down
	   the right - is small. A branch that bottoms out early takes the small size as soon as it lands in
	   the tier, so leaves are small wherever they appear and their names stack in less height, which is
	   the whole reason the tier runs out of room. At the root you stand on the portfolio, so the macro
	   categories are the level you are on, the streams inside them are body, and their children small.

	   WEIGHT says what is in focus, and nothing else: the stream you are standing in is bold and
	   nothing else is - except at the root, where you stand on the whole portfolio and every category
	   is. Tying weight to the column instead, as it was, meant the stream in focus was bold only when
	   it happened to be a top-level one; open Home and its own name came out lighter than the
	   neighbours around it. Bold no longer changes the size: a name that gains weight on the way into
	   focus should not also change its measure. */
	typeOf(n){
		const f = this.focus, t = this.tune;
		/* §9.6  SIZE is the only thing the type says, and it says one thing: is this the level you are
		   standing on. The level in focus - the subject and the siblings beside it, which are the same
		   level - is body; everything below it, both of the levels the view reaches, is small. That
		   puts the weight of the type on the row you are reading and lets the two levels of detail
		   underneath stack in less height, which is what the tier is always short of.

		   At the ROOT the level you are standing on is the macro categories, and which streams those
		   are is read from the DATA rather than from a count. Depth cannot tell: the income streams
		   stand one column from the hub exactly as the categories do and their depth says the same
		   thing, but they are a level BELOW them - the single income group above them was unwrapped
		   into the hub itself (§2.7) - so counting made Activity Income a category, which is the same
		   mistake the face used to make before it was removed. `top` marks the master's children and
		   nothing else, and it is the only thing that knows. Away from the root there is a real subject
		   to count from, and the depth is right. The hub carries the name of the thing you are standing
		   on at the root, so it is body too.

		   NOTHING IS BOLD. Weight was saying what is in focus while size said what level it was at,
		   and two channels for two facts read as four treatments; the framing already says what is in
		   focus, far louder than a weight can.

		   A pinned neighbour is body whatever level it came from. By §3.6 a stream that is its parent's
		   first child borrows the parent's neighbour, so one of the names in that row can be a level
		   up - but the row is the row you can step sideways into, and setting one member of it smaller
		   than the rest says they are different kinds of thing when they are the same control. */
		const body = !!n.pin || n.id===INC || (f.length ? (n.rel||0)===0 : !!n.top);
		return {bold:false, family:this.opt.fontFamily||"inherit",
			size:body ? t.bodyPx : t.smallPx};
	}

	/* ---- §6 §7  paint ----------------------------------------------------------------------- */
	paint(){
		if(!this.G||!this.host.clientWidth)return;
		this.frameSeq++;
		this.gaveUpVal = {};        // §7.2's fallback, kept for diagnose()
		const opt = this.opts(), cssW = opt.cssW, now = performance.now();
		const G = this.G, cam = this.nudged(this.cam), focus = this.focus, WH = this.worldH;
		const hex = c => {c=(c||"").trim();
			if(c.charAt(0)==="#"){
				if(c.length===4)return [parseInt(c[1]+c[1],16),parseInt(c[2]+c[2],16),parseInt(c[3]+c[3],16)];
				return [parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)]}
			const m=c.match(/\d+/g);return m?[+m[0],+m[1],+m[2]]:[128,128,128]};
		const mixc = (A,B,t) => "rgb("+Math.round(lerp(A[0],B[0],t))+","+Math.round(lerp(A[1],B[1],t))+","
			+Math.round(lerp(A[2],B[2],t))+")";
		const ribbon = (x0,y0,x1,y1,th,c) => {const a=x0+(x1-x0)*c,b=x1-(x1-x0)*c;
			return "M"+x0+","+y0+" C"+a+","+y0+" "+b+","+y1+" "+x1+","+y1
			     +" L"+x1+","+(y1+th)+" C"+b+","+(y1+th)+" "+a+","+(y0+th)+" "+x0+","+(y0+th)+" Z"};

		/* §5.8  the nudge that puts the hub's junction on the device pixel grid belongs to the viewBox
		   and is never written back into the camera. Storing it and subtracting it next frame is
		   equivalent right up until the camera OBJECT is replaced: settling a move swaps in a fresh
		   box while the previous correction is still owed, and the next paint takes a nudge off a
		   camera that never received one. Under a pixel, so nothing looks wrong — but where a view
		   lands stops being a function of the view, which is what §5.6 is protecting. */
		let vx = cam.x;
		if(G.hubX!==undefined&&cam.w>0){
			const per = cssW*(window.devicePixelRatio||1)/cam.w, d = (G.hubX-cam.x)*per;
			vx = cam.x+(d-Math.round(d))/per;
		}
		this.set(this.svg,{viewBox:vx+" "+cam.y+" "+cam.w+" "+cam.h,
			width:cssW,height:cssW*(WH/WORLD_W)});
		const k = cam.w/cssW;
		let more = false;

		/* §6.1 §6.2  income never steps back; everything else outside the focus dims. */
		const lit = G.lit||(id => (!focus.length||!id||id===HUB||id===INC) ? 1
			: (G.inFocus&&G.inFocus(id)?1:this.dimNow));
		/* §3.7  which side of the money a place is on, read off its PATH — during a move G is a blend
		   and carries only what blending knows how to carry. */
		const mySide = focus.length ? (focus[0]===INC?-1:1) : 0;
		const sideOfId = id => {const q=G.pathOf[id];return q?(q[0]===INC?-1:1):0};
		const crosses = id => {const s=sideOfId(id);return mySide!==0&&s!==0&&s!==mySide};
		/* §3.4  anything drawn in a neighbour's band is a way into it. */
		const sibTarget = id => {
			if(!focus.length||!id)return null;
			const q = G.pathOf[id]; if(!q||crosses(id))return null;
			let d=0; while(d<focus.length&&d<q.length&&q[d]===focus[d])d++;
			if(d>=focus.length)return null;
			return q.slice(0,d+1);
		};
		/* Anything that can be opened says so by carrying one class. The listener is attached once
		   per element and reads the current destination off the node, because the elements are reused
		   between frames (see the pool below) and re-binding every frame would leak handlers. */
		/* Bound once per element, on a flag of its own. Keyed off `__go` the listener went on at the
		   first ARM, and disarm sets `__go` to null - so a pooled element disarmed before it was ever
		   armed kept the class and the cursor ever after with nothing listening behind them. */
		const bind = node => {
			if(node.__bound)return;
			node.__bound = true;
			node.addEventListener("click",ev => {
				ev.stopPropagation();
				if(node.__go)this.go(node.__go); else if(node.__end)this.nudge();});
		};
		const arm = (node,path) => {
			node.classList.add("mf-tap"); bind(node); node.__go = path; node.__end = false;
		};
		/* §3.10  the end of a branch is a tap target too - it answers with a nudge, not a move */
		const armEnd = node => {
			node.classList.add("mf-tap"); bind(node); node.__go = null; node.__end = true;
		};
		const disarm = node => {node.classList.remove("mf-tap");node.__go=null;node.__end=false};

		/* ---- §6.3 §6.4 §6.5  across: one gradient carrying both ends -------------------------- */
		const soft = Math.max(1,opt.softFrac*(G.pitch||200));
		const softL = Math.max(1,soft*opt.leftShare);
		const frontOut = G.frontOut===undefined?1e9:G.frontOut;
		const frontIn = G.frontIn===undefined?-1e9:G.frontIn;
		const camR = cam.x+cam.w;
		/* The reveal ramp is scaled by "is there more behind this"; the WINDOW's cut keeps its full
		   run, because "the view stops here" is true whether or not there is more inside. Without the
		   first half of that, moving back a level sweeps the front leftwards across a tier with
		   nothing inside it and draws a plume for the length of the sweep. */

		/* One edge, built twice: a hard cut on both ends, and the same edge softened over `sl` and
		   `sr`. BOTH ends are per band, or the fix is only half made - an income stream with nothing
		   inside it would keep trailing off to the left because a sibling has something. */
		const edge = name => {const gid = this.uid+"-"+name;
			return (sl0,sr0) => {
				/* §6.5  THE WINDOW'S CUT KEEPS ITS FULL RUN whatever the band does. "The view stops
				   here" is true whether or not there is more inside, so only the REVEAL ramp - a
				   stream trailing off past its tail - is the band's own business. Building the
				   hard-cut gradient with no ramp at either end took the window's feather with it, and
				   the picture gained a sheared edge wherever the camera cuts through it, which is
				   most of the time once you are zoomed in. */
				const sl = (cam.x>frontIn+0.01) ? softL : sl0;
				const sr = (camR<frontOut-0.01) ? soft : sr0;
				const Lz = Math.max(cam.x,frontIn-sl);
				const Lop = Lz>frontIn-sl+0.01 ? 1-clamp01((cam.x-frontIn)/Math.max(1,softL)) : 0;
				const Rz = Math.min(camR,frontOut+sr);
				const Rop = Rz<frontOut+sr-0.01 ? 1-clamp01((frontOut-camR)/Math.max(1,soft)) : 0;
				const spanX = Math.max(1,Rz-Lz), atX = x => clamp01((x-Lz)/spanX);
				/* §6.5  THE TWO ENDS ARE INDEPENDENT. Taking the minimum of "where the left ramp ends"
				   and "where the right ramp starts" truncated the LEFT ramp whenever the right one
				   began earlier - and the right ramp is the plume, whose length is the band's own
				   business. So each band's left edge faded over a different distance, which is the
				   banding: horizontal strips of different strength down the cut edge, on bands whose
				   only real difference is what is behind them. They meet only if the two ramps
				   overlap, and then they meet in the middle. */
				let a2 = atX(Lz+sl), b2 = atX(Rz-sr);
				if(a2>b2){const m=(a2+b2)/2; a2=m; b2=m}
				const g = this.reuse("grad",name,() => {const e=this.mk("linearGradient",
						{id:gid,gradientUnits:"userSpaceOnUse",y1:0,y2:0});
					for(let i=0;i<4;i++)e.appendChild(this.mk("stop",{"stop-color":"#fff"}));
					this.gDefs.appendChild(e);return e});
				this.set(g,{x1:Lz,x2:Rz});
				[[0,Lop],[a2,1],[b2,1],[1,Rop]].forEach((p,i) =>
					this.set(g.childNodes[i],{offset:(p[0]*100)+"%","stop-opacity":p[1]}));
				return gid}};
		const cutId = edge("frontC")(0,0);
		const big = {x:cam.x-cam.w,y:cam.y-cam.h,width:cam.w*3,height:cam.h*3};
		const fmId = this.uid+"-frontM";
		const fm = this.reuse("grad","frontM",() => {const e=this.mk("mask",{id:fmId,maskUnits:"userSpaceOnUse"});
			e.appendChild(this.mk("rect",{}));this.gDefs.appendChild(e);return e});
		this.set(fm,big);
		this.set(fm.firstChild,Object.assign({fill:"url(#"+cutId+")"},big));
		/* §6.5  THE PLUME IS PER BAND. Two bands can sit side by side at the same front and disagree -
		   one stream continues inside, its neighbour is terminal - and one horizontal gradient across
		   the whole hull gives them the same edge, so a terminal stream trailed off because a sibling
		   had something behind it. Everything is cut hard, and the softened edge is laid over only the
		   bands that continue. A stream that bottomed out earlier and slid to the end is not one of
		   them: it has nothing behind it however far the view runs. */
		/* §6.5  THE RAMP IS THAT BAND'S OWN NUMBER, not a threshold on it. "Does this stream continue"
		   blends like every other number across a move, so a band losing the level behind it shortens
		   its plume as that level goes away, and one gaining a level grows the plume as it arrives.
		   Testing the number against a half instead made a band jump out of the plumed set at the
		   midpoint - the plume vanished in a single frame rather than animating, which is what a
		   threshold does to a quantity. It also retires the old per-SIDE flag: a band terminal in both
		   states carries a zero in both, so it can never plume at any point of a move, which is the
		   whole of what that flag was protecting.
		   And the band's own VISIBILITY scales the ramp for the same reason rather than gating it. A
		   bar arriving at the front fades in, and admitting it only once it passed half meant the
		   plume appeared at whatever length it had reached by then - a third of the way out, in one
		   frame. Both numbers multiply, so the plume grows with the band it belongs to. */
		const rampOf = b => clamp01(b.vis)*clamp01(b.more||0);
		const conts = Object.keys(G.bars).map(q => G.bars[q])
			.filter(b => rampOf(b)>0.005&&b.h>0);
		/* AND EACH RECT IS CLIPPED TO ITS OWN SIDE. A full-width one covers that band's y across the
		   whole picture, so a stream continuing on the out side also softened the IN edge at that
		   height - and since the two sides stack independently, an income band's rect landed over
		   whatever out-side band happened to share its y and gave that one a plume it had no claim to.
		   On screen it read as the plume breaking into stripes of different strength, and as the
		   leftover band trailing off for no reason. A band's edge is a statement about its own end. */
		const hubX = G.hubX===undefined ? (cam.x+cam.w/2) : G.hubX;
		const bigR = big.x+big.width;
		let nR = 1;
		conts.forEach(b => {
			let r = fm.childNodes[nR];
			if(!r){r=this.mk("rect",{});fm.appendChild(r)}
			/* BEYOND THE FRONT ONLY. A mask paints its shapes over one another, and two semi-transparent
			   whites composite to something brighter than either - so a rect laid over the background
			   across the whole side doubled the mask wherever both were partly open, which is exactly
			   the window's fade. Where the mask was already 1 it saturated and nothing showed; in the
			   fade, at about a fifth, it doubled, and the cut edge gained a brighter strip on every
			   band that had a plume. That is the banding, and the ±0.5 seam guard was not it.

			   There is nothing to lay over anyway until past the front: up to it the two gradients say
			   the same thing, and past it the background is cut to zero, so the plume adds to nothing
			   and lands exactly as drawn. */
			const out = (b.sd||1)>0;
			const x0 = out ? Math.max(hubX,frontOut) : big.x;
			const x1 = out ? bigR : Math.min(hubX,frontIn);
			const m = rampOf(b);
			const gid = edge("frontG:"+b.id)(softL*m,soft*m);
			/* exactly the band, with no bleed. Overlapping the neighbour by half a pixel each side -
			   which is what a seam guard looks like - makes the two fills composite where they meet,
			   and a mask adds coverage: the shared row comes out brighter than either. Where the mask
			   is already 1 that saturates and is invisible; in the fade, where it is a fifth, it
			   doubles, and the cut edge gains a bright line at every band boundary. That is the
			   banding. There is no seam to guard against - the cut gradient underneath covers the
			   whole card, and the two agree everywhere except past the front. */
			this.set(r,{x:x0,width:Math.max(0,x1-x0),y:b.y,height:b.h,fill:"url(#"+gid+")"});
			nR++});
		while(fm.childNodes.length>nR)fm.removeChild(fm.lastChild);
		this.set(this.gHull,{mask:"url(#"+fmId+")"});
		/* §7.29  A NAME THAT RUNS PAST THE EDGE OF THE CARD FADES OUT rather than being chopped. Most
		   names cannot: a name is dropped outright if it leaves the frame sideways (§7.20), and one
		   whose bar approaches the top or bottom fades on its own (§7.5). A PINNED name is exempt from
		   both - it is a control, placed against the edge by the camera rather than by its bar (§7.23)
		   - so a folded one reaches past the bottom of the card and the viewport cut it clean through
		   the second line. Fading over the last few pixels costs nothing to a name that fits and turns
		   a sheared word into one that runs out of room. */
		const tfr = Math.min(0.45,Math.max(1,12*k)/Math.max(1,cam.h));
		const tgId = this.uid+"-textG", tmId = this.uid+"-textM";
		const tg = this.reuse("grad","textG",() => {const e=this.mk("linearGradient",
				{id:tgId,gradientUnits:"userSpaceOnUse",x1:0,x2:0});
			for(let i=0;i<4;i++)e.appendChild(this.mk("stop",{"stop-color":"#fff"}));
			this.gDefs.appendChild(e);return e});
		this.set(tg,{y1:cam.y,y2:cam.y+cam.h});
		[[0,0],[tfr,1],[1-tfr,1],[1,0]].forEach((p,i) =>
			this.set(tg.childNodes[i],{offset:(p[0]*100)+"%","stop-opacity":p[1]}));
		const tm = this.reuse("grad","textM",() => {const e=this.mk("mask",{id:tmId,maskUnits:"userSpaceOnUse"});
			e.appendChild(this.mk("rect",{}));this.gDefs.appendChild(e);return e});
		this.set(tm,big);
		this.set(tm.firstChild,Object.assign({fill:"url(#"+tgId+")"},big));
		this.set(this.gText,{mask:"url(#"+tmId+")"});

		/* ---- §6.6 §6.7 §6.8  down: only what is out of focus, on its own lagged clock ---------- */
		const DUR = Math.max(1,this.moveEnds-this.moveStart);
		const mT = this.maskBack ? ((now-this.moveStart)/Math.max(1,DUR-opt.lagMs))
		                         : ((now-this.moveStart-opt.lagMs)/DUR);
		const masking = this.moveStart>0&&mT<1;
		const mE = masking?ease(clamp01(mT)):1;
		if(masking)more = true;
		const fv = Math.min(0.49,Math.max(1,opt.fadePx*k)/Math.max(1,cam.h));
		const vmask = (name,st) => {
			if(st<=0.004)return null;
			const gid = this.uid+"-"+name+"G", mid2 = this.uid+"-"+name;
			const vg = this.reuse("grad",name+"G",() => {const e=this.mk("linearGradient",
					{id:gid,gradientUnits:"userSpaceOnUse",x1:0,x2:0});
				for(let i=0;i<4;i++)e.appendChild(this.mk("stop",{"stop-color":"#fff"}));
				this.gDefs.appendChild(e);return e});
			this.set(vg,{y1:cam.y,y2:cam.y+cam.h});
			[[0,1-st],[fv,1],[1-fv,1],[1,1-st]].forEach((p,i) =>
				this.set(vg.childNodes[i],{offset:(p[0]*100)+"%","stop-opacity":p[1]}));
			const vm = this.reuse("grad",name,() => {const e=this.mk("mask",{id:mid2,maskUnits:"userSpaceOnUse"});
				e.appendChild(this.mk("rect",{fill:"url(#"+gid+")"}));this.gDefs.appendChild(e);return e});
			this.set(vm,big); this.set(vm.firstChild,big);
			return "url(#"+mid2+")";
		};
		const inViewFor = (fp,id) => {
			/* §6.6  A hub place frames the whole height, so nothing in it is ever cut and nothing needs
			   the fade that exists to prevent cutting. Fading the far side there did to the junction
			   exactly what §6.2 says dimming income does: the two sides meet at the hub, one faded and
			   one not, and the step between them is a hard vertical seam. The root never showed it
			   because an empty focus already took this branch. */
			if(isHubPlace(fp)||!id||id===HUB||id===INC)return true;
			const q = G.pathOf[id]; if(!q)return false;
			for(let i=0;i<fp.length;i++)if(q[i]!==fp[i])return false;
			return q.length>=fp.length};
		/* was & is | was & is not | was not & is | neither */
		[0,mE,1-mE,1].forEach((st,i) => {const m=vmask("vm"+i,st);
			if(m){this.set(this.gFlow[i],{mask:m});this.set(this.gBars[i],{mask:m})}
			else {this.gFlow[i].removeAttribute("mask");this.gBars[i].removeAttribute("mask")}});
		const bandOf = id => {const was=inViewFor(this.maskFrom,id), is=inViewFor(focus,id);
			return was?(is?0:1):(is?2:3)};

		/* ---- ribbons (§6.5 §6.10 §6.11) ------------------------------------------------------- */
		const RAMP = [0,0.25,0.5,0.75,1], ss = t => t*t*(3-2*t);
		const vis = e => e.vis===undefined?1:e.vis;
		Object.keys(G.flows).forEach(key => {const f=G.flows[key];
			if(f.th<=0.05)return;
			if(f.s>0 ? f.x0>=frontOut+soft : f.x1<=frontIn-softL)return;
			/* §6.5  a true leaf stops dead at the front; only a stream with more behind it plumes - and
			   whether it does is the BAND's answer, not a question about where the stub starts. Tested by
			   position alone this also threw away the stub of a band that plumes, and that stub is the only
			   mass a terminal band has past the front: the plume is a fade of the picture's own ink, so
			   §7.30's stand-in opened its window onto bare background and drew nothing at all. Everything
			   about it looked right - the flag, the rect, the gradient - because the fault was that there
			   was nothing underneath to reveal. */
			const plumes = id => {const b = G.bars["slide:"+id]; return !!(b&&(b.more||0)>0.005&&vis(b)>0.02)};
			if(f.pass&&!plumes(f.aId)&&(f.s>0 ? f.x0>=frontOut-BAR-0.5 : f.x1<=frontIn+0.5))return;
			/* §6.11  each end takes the strength of the stream AT it — the in side runs child to
			   parent, the opposite way round, and reading it off "source" and "destination" instead
			   put a hard step in colour exactly at the hub. */
			const o0 = lit(f.aId), o1 = lit(f.bId), ca = hex(this.tone(f.a)), cb = hex(this.tone(f.b));
			const gid = this.uid+"-fl"+key.replace(/[^a-zA-Z0-9]/g,"_");
			const lg = this.reuse("grad","fl:"+key,() => {const e=this.mk("linearGradient",
					{id:gid,gradientUnits:"userSpaceOnUse",y1:0,y2:0});
				RAMP.forEach(() => e.appendChild(this.mk("stop",{})));this.gDefs.appendChild(e);return e});
			this.set(lg,{x1:f.x0,x2:f.x1});
			RAMP.forEach((t,i) => {const e=ss(t);
				this.set(lg.childNodes[i],{offset:(t*100)+"%","stop-color":mixc(ca,cb,e),
					"stop-opacity":opt.baseOp*lerp(o0,o1,e)})});
			const rib = this.reuse("flow",key,() => this.mk("path",{fill:"url(#"+gid+")"}));
			this.set(rib,{d:ribbon(f.x0,f.y0,f.x1,f.y1,f.th,opt.curve)});
			/* the end AWAY from the hub is the stream this ribbon belongs to */
			const st = sibTarget(f.s>0?f.bId:f.aId);
			st?arm(rib,st):disarm(rib);
			const band = this.gFlow[Math.max(bandOf(f.aId),bandOf(f.bId))];
			if(rib.parentNode!==band)band.appendChild(rib);
		});
		this.sweep("flow");
		Object.keys(G.bars).forEach(key => {const b=G.bars[key];const v=vis(b);if(v<=0.02)return;
			const bar = this.reuse("bar",key,() => this.mk("rect",{width:BAR,rx:BAR/2}));
			this.set(bar,{x:b.x,y:b.y,height:Math.max(0.6,b.h),fill:this.tone(b.t),opacity:lit(b.id)*v});
			const st = sibTarget(b.id); st?arm(bar,st):disarm(bar);
			const band = this.gBars[bandOf(b.id)];
			if(bar.parentNode!==band)band.appendChild(bar);
		});
		this.sweep("bar");

		/* ---- §7  labels ------------------------------------------------------------------------ */
		const inset = 6*k, top = cam.y+inset, bot = cam.y+cam.h-inset;
		Object.keys(G.names).forEach(q => {G.names[q]._k=q;G.names[q].pin=0});
		const pinned = {};
		/* §7.23 §3.5 §3.6  neighbours pinned just outside the focused band, so a move sideways is a
		   tap on something already in front of you. */
		const pins = (this.animating&&this.pinsHeld) ? this.pinsHeld : pinsFor(G,focus);
		if(focus.length&&G.names[focus[focus.length-1]]){
			const fn = G.names[focus[focus.length-1]];
			/* §7.23  The strips are the camera's, not the geometry's. By §5.3 the subject lands filling
			   the frame less one strip at each end, so at rest these are the same two lines - but
			   DURING a move the geometry is a blend, and the subject's band starts wherever it sat in
			   the view you came from and grows into place. Anchoring the pins to it made their target
			   sweep the height of the card and the names chased it. Anchored to the camera the slots
			   barely move, so a name that changes place crosses a short distance and can simply be
			   watched doing it. */
			const strip = opt.neighbourPx*k;
			const fTop = cam.y+strip, fBot = cam.y+cam.h-strip;
			const INSET = 13*k, STEP = 17*k, MARGIN = inset+4*k;
			const place2 = (ids,sign,edge) => {
				if(!ids.length)return;
				const lim = sign<0 ? cam.y+MARGIN : cam.y+cam.h-MARGIN;
				const far = edge+sign*(INSET+(ids.length-1)*STEP);
				const shift = (sign<0?far<lim:far>lim) ? lim-far : 0;      // the group slides as one
				ids.forEach((id,i) => {const n=G.names[id];if(!n)return;
					pinned[n._k]=edge+sign*(INSET+i*STEP)+shift;
					/* §7.23  and the pin takes the focused name's ANCHOR as well as its x. A pin is placed
					   in a slot of the camera's, in a column shared with the subject - but it keeps
					   whatever form its own name had, and a name that was a tier entry is anchored at
					   its END. Given the subject's x and its own anchor it drew right-aligned to that
					   x, hanging off the left of the column while its neighbour ran to the right of
					   it. Same slot, same edge. */
					n.pin=1;n.rail=false;n.x=fn.x;n.anchor=fn.anchor});
			};
			place2(pins.up,-1,fTop); place2(pins.down,1,fBot);
		}
		/* §7.5 §7.21 §7.22  The last few pixels only, and a pinned control is exempt - and so is the
		   subject's own name, on both tests. Its band always fills the frame at rest, so neither test
		   can fire except mid-move, on the way IN, while the band is still the small one it was in the
		   view you came from and still sitting against the edge. The name of the stream you are moving
		   to would fade out and back in on its way to the middle, which is exactly the loss of contact
		   this is all trying to avoid. */
		const subjectId = focus.length ? focus[focus.length-1] : null;
		const EDGE = opt.edgePx*k;
		const frameAt = (c,n) => {if(n.pin||n.id===subjectId)return 1;const ext=n.rail?0:10*k;
			return clamp01(Math.min((c-ext)-cam.y,(cam.y+cam.h)-(c+ext))/EDGE)};
		const frameF = n => frameAt(n.y+n.h/2,n);
		/* §7.5  A name is either readable or absent. Ramping it over a range of band heights put a
		   name that was perfectly in focus at a quarter opacity - which is the same channel the diagram
		   uses to say "not what you are looking at", so a thin stream's name read as dimmed, or as
		   missing, and there was no telling which. The test is a step now and the ease below smooths
		   it; what stops two names sharing a spot is the overlap test, which is unambiguous about who
		   wins - the thicker stream. */
		const thickF = n => (n.rail||n.pin||n.id===subjectId||n.h/k>=opt.minBandPx) ? 1 : 0;
		const shown = Object.keys(G.names).map(q => G.names[q]).filter(n => vis(n)>0.02||n.pin);
		/* §7.3  How much room a name has, and whether it needs two lines for it. Inside the diagram
		   that is one pitch; in the rail it is whatever is left to the edge of the frame. A rail name
		   too long for the rail used to be dropped outright by the window test below - a thick stream
		   with a long name simply went unnamed, which is the other half of why labels went missing. */
		/* A name written INSIDE the picture runs back toward the previous column and measures against
		   that run. A tier name written outside the bar has the rail instead, and how wide the rail is
		   is only known here, against the camera - which is why it cannot be settled in the layout.

		   §7.17  A PINNED name measures against the same run it will have when it is the subject, not
		   against the whole card. It is the same name in the same place a moment later, so letting it
		   go unfolded while pinned and fold on arrival made it change shape at the moment it came into
		   focus - a jump at exactly the point the eye is following it. */
		/* §7.32  THE RUN INSIDE THE BAR IS SHARED BY WHAT THE TWO NAMES TAKE, not half each. A fanned
		   tier name runs back toward the previous column and meets the caption there - which is its own
		   parent (§7.3) - so half the pitch was the safe division to make without measuring. Measured,
		   the halves are rarely fair: "Loki" wants a fifth of it and "Loki Groceries & Hygiene" wanted
		   two, so the long name folded to four lines with an ampersand alone on the third while most of
		   the other half went unused. The tier name now has the run up to where its parent's caption
		   actually ends. Where that parent is not on screen there is nothing to measure against and the
		   half stands, which is what it was for. */
		const capEnd = {};
		shown.forEach(n => {
			if(n.rail||n.pin)return;                      // captions only: the rail has its own room
			const ty = this.typeOf(n);
			this.set(this.meas,{"font-size":ty.size*k,"font-family":ty.family,
				"font-weight":ty.bold?600:500});
			this.meas.textContent = n.name;
			const w = this.meas.getComputedTextLength();
			capEnd[n.id] = n.anchor==="start" ? n.x+w : n.x-w;
		});
		const parentEnd = n => {const q = G.pathOf[n.id];
			if(!q||q.length<2)return undefined;
			return capEnd[q[q.length-2]]};
		const roomFor = n => {
			if(n.rail&&n.outer)
				return n.anchor==="start" ? (cam.x+cam.w-n.x-4*k) : (n.x-cam.x-4*k);
			const half = n.maxW||1e9;
			if(!n.rail)return half;
			const edge = parentEnd(n);
			if(edge===undefined)return half;
			/* and never wider than the window, or §7.20 drops it for running off the card - which would
			   trade a folded name for no name at all. */
			const win = n.anchor==="end" ? (n.x-cam.x-4*k) : (cam.x+cam.w-n.x-4*k);
			return Math.max(half,Math.min(Math.abs(n.x-edge)-8,win));
		};
		shown.forEach(n => {
			const ty = this.typeOf(n);
			this.set(this.meas,{"font-size":ty.size*k,"font-family":ty.family,
				"font-weight":ty.bold?600:500});
			this.meas.textContent = n.name;
			const room = roomFor(n);
			if(this.meas.getComputedTextLength()<=room){n._fold = null; return}
			/* §7.31  AS MANY LINES AS THE ROOM NEEDS, up to four. Folded in two and no further, a name
			   whose longer half still overran the rail was dropped outright by the window test in §7.20 -
			   so the widest band of a set could be the one that went unnamed, because its name happened
			   to be the longest. Fewest lines that fit, and four is the cap: past that a label is a
			   paragraph, and the band it names has not grown to hold it. */
			let pick = null;
			for(let lines=2;lines<=4;lines++){
				const cut = splitInto(n.name,lines);
				if(!cut)break;
				pick = cut;
				const widest = cut.reduce((m,part) => {this.meas.textContent = part;
					return Math.max(m,this.meas.getComputedTextLength())},0);
				if(widest<=room)break;
			}
			n._fold = pick;
		});
		/* §7.24  membership by where the move is GOING, not by how lit a name is right now. */
		const kin = id => !!(G.inFocus&&G.inFocus(id));
		const rails = shown.filter(n => n.rail&&vis(n)>=0.5&&frameF(n)>0.05&&kin(n.id))
			.sort((a,b) => (a.y+a.h/2)-(b.y+b.h/2));
		/* §7.13 §7.14 §7.17  measured extents, and the amount is the first thing given up. */
		/* §7.14  The amount is beside its name, not beneath it, so it costs no height at all and is
		   never the thing given up when the tier runs short. What it costs is width in the rail, which
		   is what the rail is now for. */
		/* §7.33  a tier entry wears its amount beside it; the subject wears it underneath. */
		const showVal = n => (!!n.rail||!!n.below)&&n.val!==undefined;
		/* §7.13  WHAT A NAME RESERVES IS WHAT IT MEASURES, plus a lead. The constants here were
		   calibrated when the amount was stacked under the name, and they reserved half again what a
		   line of type actually occupies: at ten pixels a tier name inks twelve and was given
		   sixteen and a half. The tier then pushed names off bands they would have fitted on, and the
		   gathering (§1.10) asked for more room than it needed and gathered streams that could have
		   kept their names. One measurement replaces the guess; the split between above and below the
		   baseline is kept, because the baseline does not sit in the middle of the ink. */
		this.set(this.meas,{"font-size":100*k,"font-family":opt.fontFamily||"inherit","font-weight":500});
		this.meas.textContent = "Agy";
		const inkR = Math.max(0.8,Math.min(2,this.meas.getBBox().height/(100*k)));
		this.inkR = inkR;
		/* §9.8  the row must clear the TALLER of the name and its amount. Reserving on the name alone
		   was right while they were the same size; once the amount is set larger, two rail entries in a
		   row reserved less than their amounts take and the numbers closed on each other. */
		const amK = n => (n.vx!==undefined?Math.max(1,this.tune.amountK):1);
		const ink = n => this.typeOf(n).size*amK(n)*inkR*k, unit = n => ink(n)/18;
		/* §7.31  a third and fourth line are reserved either side of the baseline. The two-line case
		   keeps the measured asymmetry it was calibrated with (§7.13); only what is beyond it is
		   split evenly, because the block of lines is centred on the row. */
		const over = n => Math.max(0,((n._fold||[]).length)-2);
		const upOf = n => 8*unit(n) + (n._fold?ink(n):0) + over(n)*ink(n)/2;
		const downOf = n => 10*unit(n) + over(n)*ink(n)/2;
		const LEAD = 2*k;
		const spanOf = n => upOf(n)+downOf(n)+LEAD;
		const room = bot-top;
		/* §7.15  what gets dropped is decided by focus first, size second. */
		const expendable = n => (kin(n.id)?1:0)*1e6+n.h;
		while(rails.length>1&&rails.reduce((t,n) => t+spanOf(n),0)>room){
			let worst = 0; for(let i=1;i<rails.length;i++)
				if(expendable(rails[i])<expendable(rails[worst]))worst = i;
			rails.splice(worst,1);
		}
		/* §7.10 §7.11 §7.12  the rail is relaxed as a SET: neighbours push each other apart, weighted
		   so the faded ends absorb a crowded tier, and whichever end escapes is pinned. */
		const railY = {};
		/* §7.11  What a name gives up when the rail is crowded is the inverse of what it has to say.
		   Weighting every focused name alike let four hairlines shove the one thick stream's name off
		   its own band - and that band is the point of the view. A thick band barely yields, a thin
		   one absorbs the push, and anything out of focus yields first of all. */
		const yields = n => kin(n.id) ? 1/(1+n.h/k) : 1;
		const relax = () => {
			Object.keys(railY).forEach(q => delete railY[q]);
			rails.forEach(n => {railY[n.id]=n.y+n.h/2});
			for(let pass=0;pass<32;pass++){
				let moved = false;
				for(let i=0;i<rails.length-1;i++){
					const a=rails[i], b=rails[i+1];
					const need = downOf(a)+upOf(b)+LEAD, have = railY[b.id]-railY[a.id];
					if(have>=need)continue;
					const wa=yields(a), wb=yields(b), tot=wa+wb;
					railY[a.id] -= (need-have)*wa/tot; railY[b.id] += (need-have)*wb/tot; moved = true;
				}
				if(rails.length){
					const f=rails[0], l=rails[rails.length-1];
					if(railY[f.id]-upOf(f)<top)railY[f.id]=top+upOf(f);
					if(railY[l.id]+downOf(l)>bot)railY[l.id]=bot-downOf(l);
				}
				if(!moved)break;
			}
		};
		relax();
		/* §7.16  a name off its own bar has stopped naming it: the label says which stream this is, and
		   a label floating between two bands says it about the wrong one. Alignment is the inviolable
		   half and MEMBERSHIP is what gives - a name that cannot sit on its bar is not shown at all.
		   Settled once, on arrival, so the set does not change under a moving camera.

		   The out-of-focus pass below used to be the whole rule, and it could not fire: `rails` is
		   filtered by kin() when it is built, so nothing in it is ever out of focus, the search found
		   nobody, and the loop broke on its first turn. The rule was dead in exactly the case it was
		   written for - a subject whose own children crowd their own rail, which is the ordinary case
		   for anything with five or more streams in it. Falling back to the smallest band gives up the
		   name that has least to say, and never the subject's own, which is the point of the view. */
		/* §7.16  How far is too far depends on the BAND. A flat tolerance says nothing about whether the
		   name still points at anything: eight pixels is comfortably inside a fat band and completely
		   outside a seven-pixel one, and that is exactly where it was landing - a name floating clear
		   of the hairline it named, beside the one above it. A name's centre has to stay on its own
		   band, so the tolerance is half the band, and never more than driftPx however fat it gets. */
		const DRIFT = opt.driftPx*k;
		const tolOf = n => Math.min(DRIFT,Math.max(1,n.h/2));
		const worstDrift = () => {let m=0;
			rails.forEach(n => {if(kin(n.id))
				m=Math.max(m,Math.abs(railY[n.id]-(n.y+n.h/2))-tolOf(n)+DRIFT)});
			return m};
		/* §7.16  This runs DURING a move as well as at rest. Held back until the camera stopped, every
		   name that could not keep its bar was given up in the single frame after it landed, and the
		   survivors shifted two or three pixels as the tier re-solved around the gap - a shuffle that
		   happens exactly when the eye has settled and is reading. Run continuously, a name that is
		   losing its bar fades out over the move instead, on the ease every other name uses (§7.5),
		   and nothing changes at the moment of arrival. The jitter this guard was protecting against
		   does not appear: the set only shrinks as the geometry blends toward a view that holds fewer
		   names, so it moves one way. */
		while(rails.length>1&&worstDrift()>DRIFT){
			let give = -1;
			for(let i=0;i<rails.length;i++)
				if(!kin(rails[i].id)&&(give<0||rails[i].h<rails[give].h))give = i;
			if(give<0)for(let i=0;i<rails.length;i++)
				if(rails[i].id!==subjectId&&(give<0||rails[i].h<rails[give].h))give = i;
			if(give<0)break;
			rails.splice(give,1); relax();
		}
		/* §7.6 §7.7 §7.8  the tier's clock: it leaves and lands with the camera, in every direction,
		   and a name already being read is never pulled down. */
		const remain = this.animating?Math.max(0,this.moveEnds-now):0;
		const elapsed = this.animating?Math.max(0,now-this.moveStart):0;
		/* §7.28  the move's own eased progress - the SAME clock the geometry is blended on, so a name
		   and the bar it names arrive together. */
		const mv = this.animating
			? ease(clamp01((now-this.moveStart)/Math.max(1,this.moveEnds-this.moveStart))) : 1;
		const goneF = (!this.animating||opt.leadMs<=0) ? 0 : clamp01(1-elapsed/opt.leadMs);
		const gate = !this.animating ? 1 : (opt.leadMs<=0?0:clamp01((opt.leadMs-remain)/opt.leadMs));

		/* §7.25  A name that changes place STAYS VISIBLE while it moves. Fading it out and back in was
		   tried: it keeps the motion short, but the eye loses the word entirely for a moment and with
		   it any sense that the thing it names is the thing that just moved. What makes that affordable
		   is §7.23 - the slots a name moves between barely move themselves - so the journey is short
		   enough to simply watch. */
		const placed = [];
		shown.sort((a,b) => b.h-a.h).forEach(n => {
			const key = n._k;
			/* §7.18  A caption is attached to a bar: the bar is followed exactly and only the
			   displacement from it is smoothed, so the name never lags the thing it names.

			   §7.26  A PINNED name is attached to the frame instead (§7.23), and smoothing a
			   displacement from a bar it is not on made it inherit that bar's motion. Leaving focus,
			   a stream's own band swings from filling the frame to far outside it; the name rode that
			   swing with a lagging correction on top, overshot its slot and came back - 256px of
			   travel with two reversals. What is smoothed for a pinned name is therefore its ABSOLUTE
			   position, straight toward a slot that barely moves. Either store seeds itself from where
			   the name was last drawn, so switching between the two is continuous. */
			/* §7.27  ALL OF THIS IS IN SCREEN PIXELS. The world is not a fixed scale: opening a stream
			   re-scales it so the subject fills the frame (§5.3), by a factor that can be ten. Smoothing
			   a world coordinate toward a world target while the world itself is being re-scaled leaves
			   a name apparently still in a space that is moving underneath it - which is most of what
			   the flying was. In screen pixels, where the reader's eye is, "barely moved" means what it
			   says. */
			const band = n.y+n.h/2, bandS = (band-cam.y)/k;
			const isPin = pinned[key]!==undefined;
			const raw = isPin ? pinned[key]-band
				: ((n.rail&&railY[n.id]!==undefined)?railY[n.id]-band:0);
			const tS = isPin ? (pinned[key]-cam.y)/k : bandS+raw/k;
			let cyS;
			if(this.animating){
				/* §7.28  ACROSS A MOVE THE NAME TRAVELS ON THE MOVE'S OWN CLOCK, not on a per-frame
				   fraction. The two stores below close a gap by a constant share of it each frame, which
				   is right at rest - the gap is small and its cause is jitter - and wrong on a move,
				   where the gap can be the height of the card and the BAND is travelling too, on the
				   camera's eased clock over moveMs. At 13% a frame the displacement is all but gone in
				   150ms while the band still has 470ms to run, so the name lands on its bar early and
				   then rides it the rest of the way.

				   That is invisible while the name was already near its bar, and glaring in the one case
				   it matters: a pinned neighbour tapped into focus. A pin sits in a camera slot, on
				   screen by construction (§7.23), while the band it names is the one just off the top of
				   the frame - so the name would jump to the off-screen band within a few frames and
				   sail back down into place, which reads as arriving from off screen rather than as
				   moving from where it was. Decayed on the move's clock instead, it leaves where it was
				   drawn and reaches its bar exactly as the bar reaches its place: a straight short path.

				   The seed is taken once, at whatever progress the name first appears, and the remaining
				   travel is what is left of the move - so a name that appears midway is not asked to
				   cover the whole distance in the time that is left. */
				if(this.sSeed[key]===undefined){
					const prev = this.sPos[key];
					this.sSeed[key] = {p0:(prev===undefined?null:prev), e:mv};
				}
				const sd = this.sSeed[key];
				/* Aimed at where it LANDS, not at where its bar is this instant. A pin's slot belongs to
				   the camera (§7.23) so its target is already still; everything else is read from the
				   destination geometry. Decaying a displacement on the clock instead - which is what
				   this did first - only looks right while the bar's SCREEN path is close to linear in
				   the clock, and re-scaling bends it badly: opening a small stream leaves its sibling's
				   bar 656px above a 145px card, and that bar covers most of its journey in the second
				   half of the move. The offset meanwhile fell at a constant rate, so in the first half
				   the name lost 324px of offset against 135px of bar and sailed off the top of the card
				   before coming back - the very thing this section exists to prevent, in the one case
				   the arithmetic happened to be extreme. Interpolating between the two ENDS cannot do
				   that: it is monotone by construction and exact at both. */
				let pF = tS;
				if(!isPin&&this.moveTo){
					const nb = this.moveTo.g.names[key];
					/* §7.16  plus the displacement the tier has pushed it to. The landing place is the
					   destination's bar PLUS whatever the relaxation owes it there - aiming at the bare
					   bar meant the name arrived a couple of pixels off its resting place and then
					   eased the rest of the way once the camera had stopped, which is a shuffle at the
					   one moment the eye has settled. The relaxation is solved on the blend and
					   converges to the destination's as the move completes, so by the time it matters
					   it is the right number. */
					if(nb){const kB = this.moveTo.cam.w/opt.cssW;
						pF = ((nb.y+nb.h/2)-this.moveTo.cam.y)/kB + raw/k}
				}
				if(sd.p0===null)cyS = pF;
				else{const span = 1-sd.e, u = span>1e-3 ? clamp01((mv-sd.e)/span) : 1;
					cyS = sd.p0+(pF-sd.p0)*u}
				/* both stores are kept current so the at-rest smoother picks up where this leaves off */
				if(isPin){this.sY[key] = cyS; delete this.sOff[key]}
				else{this.sOff[key] = cyS-bandS; delete this.sY[key]}
			}else if(isPin){
				/* §7.18 §7.26  a pinned name is attached to the frame, not to a bar, so what is smoothed
				   is where it IS - straight toward a slot that hardly moves. */
				delete this.sSeed[key];
				let pS = this.sY[key];
				if(pS===undefined)pS = this.sPos[key]!==undefined ? this.sPos[key] : tS;
				cyS = pS+(tS-pS)*opt.smooth;
				this.sY[key] = cyS; delete this.sOff[key];
				if(Math.abs(tS-cyS)>0.3)more = true;
			}else{
				/* §7.18  a caption is attached to its bar: the bar is followed exactly and only the
				   displacement from it is smoothed. This is why the at-rest rule cannot simply smooth
				   the absolute position the way the move above does: bars move at rest too - a change of
				   basis tweens them over dataMs with no move running - and a name smoothing its absolute
				   position would lag the very bar it is naming. */
				delete this.sSeed[key];
				const rawS = raw/k;
				let pOff = this.sOff[key];
				if(pOff===undefined)pOff = this.sPos[key]!==undefined ? this.sPos[key]-bandS : rawS;
				const offS = pOff+(rawS-pOff)*opt.smooth;
				this.sOff[key] = offS; delete this.sY[key];
				cyS = bandS+offS;
				if(Math.abs(rawS-offS)>0.3)more = true;
			}
			this.sPos[key] = cyS;
			const cy = cam.y+cyS*k;
			let want = (n.pin?1:vis(n))*frameAt(cy,n)*thickF(n);            // §7.5
			/* §7.6  ANYTHING that arrives lands with the camera, not before it. A name already being
			   read is never pulled down (§7.8), so this only gates the ones that were not there. It
			   used to apply to the tier alone, and a neighbour's name coming into a view therefore
			   ramped up on its own ease - about 135ms - and sat there at full strength while the camera
			   was still travelling, which reads as appearing from nowhere rather than arriving. */
			const held = this.animating ? (this.fadeAtStart[key]||0) : 0;   // §7.8
			if(n.rail){
				want *= railY[n.id]===undefined ? (this.animating?held*goneF:0)
				                                : (this.animating?Math.max(gate,held):1);
			}else if(this.animating)want *= Math.max(gate,held);
			const was = this.fade[key]===undefined?0:this.fade[key];
			if(want<=0.02&&was<=0.02){this.fade[key]=0;delete this.offX[key];
				delete this.sY[key];delete this.sOff[key];delete this.sPos[key];delete this.sSeed[key];
				delete this.sSz[key];delete this.szSeed[key];
				this.dropText(key);return}
			/* §9.6  A NAME CHANGES SIZE BY GROWING, on the move's own clock (§7.28). The size says which
			   level you are standing on, so it changes the instant the focus does - and a name that is
			   also travelling across the card, at full opacity, snapping between two sizes on its way
			   is the same loss of visual contact §7.25 is about. What is measured from stays the
			   SETTLED size: whether a name folds, and the room it reserves in the sweep (§7.13), are
			   decided once for the view being moved to, or a name would fold and unfold mid-flight and
			   the tier would re-solve under it every frame. */
			const szTo = this.typeOf(n).size;
			let szNow = this.sSz[key];
			if(szNow===undefined)szNow = szTo;
			else if(this.animating){
				if(this.szSeed[key]===undefined)this.szSeed[key] = {from:szNow, e:mv};
				const zd = this.szSeed[key], zs = 1-zd.e;
				szNow = zd.from+(szTo-zd.from)*(zs>1e-3?clamp01((mv-zd.e)/zs):1);
			}else{delete this.szSeed[key];szNow = szTo}
			this.sSz[key] = szNow;
			if(Math.abs(szTo-szNow)>0.05)more = true;
			let two = !n.pin&&showVal(n);
			let g = this.text(key,n,cy,two,k,szNow);
			let x0,y0,x1,y1;
			const extent = () => {x0=1e9;y0=1e9;x1=-1e9;y1=-1e9;
				g.forEach(e => {const b=e.getBBox();
					x0=Math.min(x0,b.x);y0=Math.min(y0,b.y);
					x1=Math.max(x1,b.x+b.width);y1=Math.max(y1,b.y+b.height)})};
			extent();
			/* §7.2  A tier name sits against the inside of its bar, which is one pitch shared with the
			   name at the previous column - and those two are not strangers: a tier entry's parent IS
			   that name, its band contains the entry's, so they arrive on nearly the same row. When
			   both want it there is not room for both: "Spending" alone is over half the pitch, and a
			   single word cannot be folded to fit. So the tier name tries the inside first and falls
			   back to the OUTSIDE of the bar, where the rail has room of its own and nothing to
			   compete with, giving up its amount for the place the amount was in. Without the fallback
			   the root lost every name in its tier to the three category names. */
			if(n.rail&&n.vx!==undefined&&two
				&&placed.some(p => !p.rail&&x0<p.x1&&p.x0<x1&&y0<p.y1&&p.y0<y1)){
				two = false; this.gaveUpVal[n.id] = 1;
				g = this.text(key,n,cy,false,k,szNow,true);
				extent();
			}
			/* §7.19  the drawn LEFT EDGE is smoothed, so an anchor flip slides instead of hopping by
			   the name's own width. */
			/* §7.27  in screen pixels, for the same reason the vertical is */
			const tgt = (x0-cam.x)/k;
			const px = this.offX[key];
			const sx = px===undefined ? tgt : px+(tgt-px)*opt.smooth;
			this.offX[key] = sx;
			if(Math.abs(tgt-sx)>0.3)more = true;
			const dx = (sx-tgt)*k;
			if(Math.abs(dx)>0.01){g.forEach(e => this.set(e,{x:(+e.getAttribute("x"))+dx}));x0+=dx;x1+=dx}
			/* §7.20  Two names may not overlap, and the one on the bigger band wins - which is what the
			   sort above already arranges, placing them thickest first. Only rail-against-rail is
			   exempt: that order was settled by the sweep, which reserved each entry its room.
			   Exempting the rail from the test ENTIRELY, as this did, let a rail name print straight
			   through an interior one - two words in the same place and neither of them readable. */
			const blocked = placed.some(p => !(p.rail&&n.rail) && x0<p.x1&&p.x0<x1&&y0<p.y1&&p.y0<y1)
				||x0<cam.x||x1>cam.x+cam.w;
			if(blocked)want = 0;
			/* §7.7 §7.9  across a move the tier follows its clock exactly; everywhere else it eases,
			   from whatever it was and never from full. */
			const a = (n.rail&&this.animating) ? want : was+(want-was)*opt.labelEase;
			this.fade[key] = a;
			if(Math.abs(want-a)>0.005)more = true;
			if(a<=0.02){this.dropText(key);this.offX[key]=tgt;delete this.sSeed[key];
				if(isPin)this.sY[key]=(pinned[key]-cam.y)/k; else this.sOff[key]=raw/k;
				return}
			/* §7.33  THE SUBJECT'S AMOUNT ARRIVES WITH THE LANDING, and leaves before the move. It is an
			   answer about the thing you opened, and during a move nothing is opened yet - carried across,
			   it reads as a number belonging to whatever the camera is passing over, and it changes value
			   mid-flight as the tween runs. So it goes out over the lead as the move begins and comes back
			   over the lead once the camera has settled, which is the same shape either way round.
			   The name itself does NOT do this: a name that vanishes when you move is a name you cannot
			   follow (§7.25), and it is the amount alone that has nothing true to say in transit. */
			const lead = Math.max(1,opt.leadMs);
			/* the one being left behind goes out on the move's own clock; the one arriving is simply not
			   there until the camera has landed. Ramping BOTH by the move made the destination's amount
			   flash at full for a frame and then fade out before fading back in. */
			const settle = n.valOut ? clamp01(1-(now-this.moveStart)/lead)
				: (this.animating ? 0 : clamp01((now-this.moveEnds)/lead));
			if(n.below&&two&&settle>0.001&&settle<0.999)more = true;   // §8.6 keep the clock running
			g.forEach((e,i) => this.set(e,{opacity:(n.pin?1:lit(n.id))*a
				*((n.below&&two&&i===g.length-1) ? settle : 1)}));    // §7.22
			if(blocked)return;
			placed.push({x0:x0,y0:y0,x1:x1,y1:y1,rail:!!n.rail});
			/* §3.1 §3.2  a name goes one level down, except the subject's own, which goes back up. */
			if(n.tap&&G.pathOf[n.tap]){
				const q = G.pathOf[n.tap];
				const isFocus = q.length===focus.length&&q.every((v,i) => v===focus[i]);
				const full = G.nodeAt(q);
				const opens = !crosses(n.tap)&&full&&full.children&&full.children.length;
				const dest = isFocus ? (focus.length?q.slice(0,-1):null) : (opens?q:null);
				/* §3.10  a stream on this side with nothing inside it is the end of its branch, and answers
				   the tap rather than ignoring it. Anything across the hub is not an end but somewhere the
				   picture declines to go (§3.7), and stays silent. */
				const ends = !dest && !isFocus && !opens && !!full && !crosses(n.tap);
				/* §3.11  A DEAD END DEEPER THAN THE LEVEL YOU OPENED TAKES YOU TO ITS PARENT. It cannot be
				   opened - there is nothing inside it - so §3.10 answered with a nudge, which is right for a
				   band at the level you are on and wrong for one further down: the reader is not asking to go
				   INTO it, they are asking to see it properly, and one level up is exactly where it is named
				   with its amount beside it (§7.2b). Tapping any of a set of leaves on the rail brings the
				   whole set forward, which is what was wanted and what the nudge refused. */
				const lift = ends && q.length>focus.length+1 ? q.slice(0,-1) : null;
				g.forEach(e => (dest||lift)?arm(e,dest||lift):(ends?armEnd(e):disarm(e)));
			}
		});
		this.sweepText();
		/* §8.6  once a move has settled nothing else drives the clock, so a fade still in flight asks
		   for the next frame itself. */
		if(more&&!this.animating&&!this.reduced){
			cancelAnimationFrame(this.fadePump);
			this.fadePump = requestAnimationFrame(() => this.paint());
		}
	}
	/* A label is one or two lines of name, plus the amount under a rail entry. */
	text(key,n,cy,two,k,size,outboard){
		const rec = this.reuse("text",key,() => ({a:this.mk("text",{}),a2:this.mk("text",{}),
			a3:this.mk("text",{}),a4:this.mk("text",{}),b:this.mk("text",{})}));
		/* the stream each element names, on the element. Several streams are called "Other", so
		   matching a drawn label back to its band by TEXT is guesswork - which cost several
		   measurements that looked like faults and were not. */
		[rec.a,rec.a2,rec.a3,rec.a4,rec.b].forEach(e => {
			if(e.getAttribute("data-k")!==key)e.setAttribute("data-k",key)});
		const ty = this.typeOf(n);
		const px = size===undefined ? ty.size : size;
		const one = (e,dy,txt,amount) => {
			if(e.textContent!==txt)e.textContent = txt;
			const useV = (amount||outboard)&&n.vx!==undefined;
			this.set(e,{x:useV?n.vx:n.x, y:cy+dy,
				"text-anchor":(useV&&n.vAnchor)?n.vAnchor:n.anchor,
				/* a pinned neighbour is a control rather than a caption (§7.22), which is what the
				   quieter colour says; the amount under a name is the other thing set in the numeric
				   face, whatever the name above it is set in. */
				fill:(amount||n.pin)?this.palette.bodyTextSecondary:this.palette.bodyText,
				"font-family":amount?(this.opt.numberFamily||"inherit"):ty.family,
				"font-size":(amount?px*this.tune.amountK:px)*k,
				"font-weight":amount?500:(ty.bold?600:500)});
			if(e.parentNode!==this.gText)this.gText.appendChild(e);
			return e};
		/* The baselines were measured at bodyPx too, so they travel with the size rather than leaving a
		   small name sitting where a body-sized one would have been. */
		const sc = px/this.tune.bodyPx;
		/* Whether it folds, and into how many lines, was settled before the rail was swept - so the
		   room reserved for it and the room it takes are the same decision. The lines are centred on
		   the row: at two, that is the -3 and +12 this was calibrated with. */
		const folded = n._fold, rows = folded ? folded.length : 1;
		const slot = [rec.a,rec.a2,rec.a3,rec.a4];
		const dyOf = i => (4.5 + (i-(rows-1)/2)*15)*sc*k;
		const out = (folded||[n.name]).map((part,i) => one(slot[i],dyOf(i),part,false));
		for(let i=rows;i<slot.length;i++)
			if(slot[i].parentNode)slot[i].parentNode.removeChild(slot[i]);
		/* §7.2  the amount shares the name's baseline, on the other side of the bar - it is beside it,
		   not beneath it, so a folded name does not push it anywhere either. */
		/* §7.33  under the last line of the name for the subject, on its own baseline for a tier
		   entry - which is the same row, the amount being on the far side of the bar there. */
		if(two)out.push(one(rec.b, n.below ? dyOf(rows) : 4.5*sc*k, n.val, true));
		else if(rec.b.parentNode)rec.b.parentNode.removeChild(rec.b);
		return out;
	}

	/* A DUMP OF WHAT THIS VIEW IS MADE OF, for a bug report that arrives as a photograph. Three
	   trees - as the adapter built it, as the gathering left it, and what is on screen - plus, per
	   name, the handful of facts that decide how it is written: whether it is a tier entry, which
	   side of its bar it sits on, whether it carries an amount, and whether it HAD one and gave it
	   up to the fallback in §7.2. That last cannot be read back from the geometry, which is why the
	   paint records it. Reachable only from the staging build. */
	diagnose(){
		const G = this.G, focus = this.focus.slice();
		const at = (tree,path,loose) => {
			if(!tree)return null;
			let here = {children:(tree.in||[]).concat(tree.out||[])};
			const missed = [];
			path.forEach(id => {
				const kid = ((here&&here.children)||[]).filter(n => n.id===id)[0];
				if(kid)here = kid; else if(loose)missed.push(id); else here = null;
			});
			return here ? {node:here, notFound:missed} : null;
		};
		const prune = n => n && {id:n.id, name:n.name, tone:n.tone, value:n.value,
			top:n.top, outside:n.outside, label:n.label,
			children:n.children ? n.children.map(prune) : null};
		const treeAt = (t,loose) => {const r = at(t,focus,loose); if(!r)return null;
			return {notFound:r.notFound, tree:r.node.id ? prune(r.node)
				: {id:"(root)", children:(r.node.children||[]).map(prune)}}};
		const names = [];
		Object.keys((G&&G.names)||{}).forEach(k => {const n = G.names[k];
			if((n.vis===undefined?1:n.vis)<=0.02&&!n.pin)return;   // only what is on screen
			names.push({id:n.id, name:n.name, path:((G.pathOf||{})[n.id]||null),
				rel:n.rel, leaf:n.leaf, top:n.top, rail:!!n.rail, outer:!!n.outer,
				anchor:n.anchor, amount:(n.val===undefined?null:n.val),
				gaveUpAmount:!!this.gaveUpVal[n.id], folded:!!n._fold,
				vis:Math.round((n.vis===undefined?1:n.vis)*100)/100,
				x:Math.round(n.x), y:Math.round(n.y), h:Math.round(n.h)})});
		const bands = [];
		Object.keys((G&&G.bars)||{}).forEach(k => {const b = G.bars[k];
			if(k.indexOf("slide:")!==0||b.vis<=0.02)return;
			bands.push({id:b.id, side:(b.sd||1)>0?"out":"in", plume:b.more||0,
				y:Math.round(b.y), h:Math.round(b.h), vis:Math.round(b.vis*100)/100})});
		const drawn = [].map.call(this.gText.querySelectorAll("text"),
			e => ({k:e.getAttribute("data-k"), text:e.textContent}));
		return {focus:focus, hubName:(this.shown||{}).hubName,
			card:{cssW:this.host.clientWidth, worldH:this.worldH, dpr:window.devicePixelRatio||1},
			type:{bodyPx:this.tune.bodyPx, smallPx:this.tune.smallPx,
				amountK:this.tune.amountK, inkR:this.inkR},
			check:this.check(),
			raw:treeAt(this.raw,true), grouped:treeAt(this.tree,false), shown:treeAt(this.shown,false),
			names:names, bands:bands, drawn:drawn};
	}
	/* ---- §10  the invariants, checked where they are produced ------------------------------- */
	check(){
		const G = this.G; if(!G)return ["no geometry"];
		const out = [], EPS = 0.8;
		const into=[], outOf=[];
		let inEnd=-1e9, outStart=1e9;
		Object.keys(G.flows).forEach(q => {const f=G.flows[q];
			if(f.s<0&&f.bId===HUB){into.push({y:f.y1,h:f.th});inEnd=Math.max(inEnd,f.x1)}
			else if(f.s>0&&f.aId===HUB){outOf.push({y:f.y0,h:f.th});outStart=Math.min(outStart,f.x0)}});
		if(inEnd>-1e9&&outStart<1e9&&Math.abs(outStart-inEnd)>0.01)                 // I1
			out.push("hub seam: "+Math.round((outStart-inEnd)*10)/10+" wide");
		const span = a => {if(!a.length)return null;a.sort((p,q) => p.y-q.y);
			let holes=0;for(let i=1;i<a.length;i++)if(Math.abs(a[i].y-(a[i-1].y+a[i-1].h))>EPS)holes++;
			return {y0:a[0].y,y1:a[a.length-1].y+a[a.length-1].h,holes:holes}};
		const si = span(into), so = span(outOf);
		if(si&&so){                                                                 // I2, I3
			if(si.holes)out.push("hub inflow has "+si.holes+" gap(s)");
			if(so.holes)out.push("hub outflow has "+so.holes+" gap(s)");
			if(Math.abs(si.y0-so.y0)>EPS)out.push("hub top mismatch "+Math.round((so.y0-si.y0)*10)/10);
			if(Math.abs(si.y1-so.y1)>EPS)out.push("hub bottom mismatch "+Math.round((so.y1-si.y1)*10)/10);
		}
		const byCol = {}; Object.keys(G.bars).forEach(q => {const b=G.bars[q];
			if(b.vis!==undefined&&b.vis<=0.02)return;
			(byCol[Math.round(b.x)]=byCol[Math.round(b.x)]||[]).push(b)});
		Object.keys(byCol).forEach(x => {const a=byCol[x].sort((p,q) => p.y-q.y);
			for(let i=1;i<a.length;i++)if(a[i].y<a[i-1].y+a[i-1].h-EPS)out.push("overlap at x="+x)});
		return out;
	}
}
