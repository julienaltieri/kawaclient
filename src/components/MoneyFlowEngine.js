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
	l1Px:7, l2Px:2, gapShare:0.35,                       // §4.1 §4.4  the separations, and their cap
	railFrac:0.28, padPx:4, neighbourPx:22,              // §5.4 §5.5 §5.3  the frame
	dim:0.20, softFrac:0.40, leftShare:0.70,             // §6.1 §6.3 §6.4  what steps back, and the plume
	fadePx:24, lagMs:200,                                // §6.6 §6.8  the neighbour fade and its clock
	baseOp:0.46, curve:0.50,                             // §6.12 the ribbons
	leadMs:250, driftPx:8, edgePx:5,                     // §7.6 §7.16 §7.21  the labels
	minBandPx:6,                                         // §7.5  thinner than this carries no name
	smooth:0.13, labelEase:0.25,
	moveMs:620, dataMs:380,                              // §8.1 §8.4  one clock, and the value tween
	ratio:2.25, tail:"push"                              // §9.3
};
const WORLD_W = 1000, BAR = 6, GUTTER = 6, COLPAD = 10;

/* Fold a name in two at the space that leaves the halves most even. A name with no space cannot be
   folded and is left to the overlap rule. */
function splitTwo(name){
	const parts = name.split(" ");
	if(parts.length<2)return null;
	let best = 1, bestGap = Infinity;
	for(let i=1;i<parts.length;i++){
		const a = parts.slice(0,i).join(" ").length, b = parts.slice(i).join(" ").length;
		if(Math.abs(a-b)<bestGap){bestGap=Math.abs(a-b);best=i}
	}
	return [parts.slice(0,best).join(" "), parts.slice(best).join(" ")];
}

const lerp = (a,b,e) => a+(b-a)*e;
const ease = t => t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
const isHubPlace = f => !f.length || (f.length===1 && f[0]===INC);
const clamp01 = v => Math.max(0,Math.min(1,v));

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

	/* §4.8 §4.9  two columns past the focus on the side in focus, capped at that branch's terminal;
	   exactly one on the other side, because it is context rather than subject. */
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
	names[INC] = {x:xs[at(0)]+5,y:pos[at(0)][HUB].y,h:pos[at(0)][HUB].h,
		name:tree.hubName,anchor:"start",strong:true,id:INC,tap:INC,vis:1};

	const slides = opt.tail!=="grow";
	Object.keys(nodeById).forEach(id => {
		const n=nodeById[id], s=sideOf[id], e=endFor(s), ie=at(e), c=firstC[id];
		/* A stream may decline a name (§1: `label:false`). Its band is still drawn and still
		   navigable; it simply does not take a slot in the rail. */
		const named = n.label!==false;
		const ends = !!(pos[ie]&&pos[ie][id]);
		const qb = pos[ends?ie:at(c)][id];
		bars["slide:"+id] = {x:xs[ie],y:qb.y,h:qb.h,t:n.tone,id:id,vis:(ends&&slides)?1:0};
		for(let k=c; s>0 ? k<=term(1) : k>=term(-1); k+=s){const q=pos[at(k)]&&pos[at(k)][id];if(!q)continue;
			bars["at:"+id+"@"+k] = {x:xs[at(k)],y:q.y,h:q.h,t:n.tone,id:id,vis:(!slides&&k===e)?1:0}}
		const q0 = pos[at(c)][id];
		const within = s>0 ? c<=e : c>=e;
		/* §7.1  names on the focused side from the focus's depth to +2; the other side only at the
		   root.  §7.4  only the focused side has a rail. */
		const leafHere = own(id) && (!kidsOf[id] || (s>0?c>=e:c<=e));
		const show = own(id) ? (((dep(id)-fDep)>=0 && (dep(id)-fDep)<=2 && within)?1:0)
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
			? {x:railX,y:qb.y,h:qb.h,name:n.name,val:opt.format(n.value),anchor:s>0?"start":"end",
			   id:id,tap:id,vis:show,rail:true}
			: {x:nx,y:q0.y,h:q0.h,name:n.name,anchor:((s>0)===outward)?"start":"end",
			   /* §7.3  A name inside the diagram runs from its own bar toward the next column, so the
			      room it has is one pitch. Zoomed in, a long name is longer than that and reaches into
			      the rail beyond - which is how two names came to be printed in the same place. It
			      folds onto a second line rather than being given up. */
			   maxW:PITCH-20,
			   strong:Math.abs(c)===1,id:id,tap:id,vis:show};
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
	const beyond = s => {const e=endFor(s);
		for(const id in firstC)if(sideOf[id]===s&&firstC[id]===e&&kidsOf[id])return 1;
		return 0};

	return {flows:flows,bars:bars,names:names,boxes:boxes,selfBox:selfBox,pathOf:pathOf,
		endX:xs[at(endF)]+(FSIDE>0?BAR:0), otherX:xs[at(endO)]+(FSIDE>0?0:BAR),
		side:FSIDE, pitch:PITCH, hubX:xs[at(0)],
		frontOut:xs[at(endR)]+BAR, frontIn:xs[at(endL)],
		plumeOut:beyond(1), plumeIn:beyond(-1),
		inFocus:inFocus, nodeAt:nodeAt, capped:gapScale<1};
}

/* ------------------------------------------------------------------------------------------------
   §5  FRAME.  Pure: it measures and hands back the squeeze for the caller to apply.
   ------------------------------------------------------------------------------------------------ */
export function frame(g,focus,opt){
	const WH = opt.worldH;
	const b0 = focus.length ? g.boxes[focus[focus.length-1]] : null;
	if(focus.length&&!b0)return {cam:{x:0,y:0,w:WORLD_W,h:WH},squeeze:null};
	const S = g.side||1, hub = isHubPlace(focus);
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
	const hub = isHubPlace(focus);
	const measure = layout(tree,focus,Object.assign({},opt,{gapUnit:WORLD_W/opt.cssW}));
	const f = frame(measure,focus,opt);
	const k = f.w/opt.cssW;                                   // world units per screen pixel
	/* §5.3  one strip at each end for a neighbour's name; a hub place has no neighbours (§3.7). */
	const strip = hub ? 0 : opt.neighbourPx*k;
	const subject = hub ? null : measure.nodeAt(focus);
	const fit = hub
		? {v:tree.inTotal, h:Math.min(opt.worldH-COLPAD*2, f.h-2*f.pad)}
		: {v:(subject?subject.value:tree.inTotal), h:Math.max(1,f.h-2*strip)};
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
/* §8.2  pair by key — which is why §4.7 insists the key set never depends on the focus. */
export function blend(A,B,e){
	const out = {flows:{},bars:{},names:{},boxes:B.boxes,pathOf:B.pathOf,
		inFocus:B.inFocus,nodeAt:B.nodeAt,capped:B.capped,side:B.side,pitch:B.pitch,hubX:B.hubX,
		frontOut:lerp(A.frontOut,B.frontOut,e), frontIn:lerp(A.frontIn,B.frontIn,e),
		plumeOut:lerp(A.plumeOut,B.plumeOut,e), plumeIn:lerp(A.plumeIn,B.plumeIn,e)};
	["flows","bars","names"].forEach(kind => {
		const keys={}; Object.keys(A[kind]).forEach(k => keys[k]=1); Object.keys(B[kind]).forEach(k => keys[k]=1);
		Object.keys(keys).forEach(k => {
			const a=A[kind][k], b=B[kind][k];
			if(a&&b){const o={};for(const q in b)
					o[q] = (typeof b[q]==="number"&&typeof a[q]==="number") ? lerp(a[q],b[q],e) : b[q];
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

		this.focus = [];
		this.tree = null; this.shown = null;
		this.G = null; this.cam = {x:0,y:0,w:WORLD_W,h:this.worldH};
		this.dimNow = 1; this.animating = false;
		this.moveStart = 0; this.moveEnds = 0; this.maskFrom = []; this.maskBack = false;
		this.clock = 0; this.dataClock = 0; this.fadePump = 0;
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
	reset(){this.go([])}
	destroy(){
		cancelAnimationFrame(this.clock); cancelAnimationFrame(this.dataClock);
		cancelAnimationFrame(this.fadePump);
		if(this.ro)this.ro.disconnect(); else window.removeEventListener("resize",this.onResize);
		if(this.svg.parentNode)this.svg.parentNode.removeChild(this.svg);
	}
	/* §8.4  a new tree tweens the values and re-derives the layout each frame; the focus is dropped
	   if the stream it names has gone. */
	setTree(tree){
		/* The same tree is not a change. Opening a stream calls back to the host, which re-renders and
		   hands the tree straight back; without this the value tween starts, and its per-frame rebuild
		   overwrites the geometry and camera that the focus transition is in the middle of animating.
		   The caller memoises, so an unchanged tree arrives as the same reference. */
		if(tree===this.tree)return;
		if(!this.shown){this.tree=tree; this.shown=JSON.parse(JSON.stringify(tree)); return this.rebuild()}
		this.tree = tree;
		if(this.reduced){this.shown=JSON.parse(JSON.stringify(tree)); return this.rebuild()}
		const from = this.shown, t0 = performance.now();
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
			(fs||[]).forEach(f => {if(seen[f.id])return;
				out.push(Object.assign({},f,{children:f.children?union(f.children,null):null}))});
			return out;
		};
		const values = (ns,m) => {(ns||[]).forEach(n => {m[n.id]=n.value; values(n.children,m)}); return m};
		const vFrom = values(from.in,values(from.out,{}));
		const vTo   = values(tree.in,values(tree.out,{}));
		this.shown = {hubName:tree.hubName, inTotal:from.inTotal,
			in:union(from.in,tree.in), out:union(from.out,tree.out)};
		const rec = (cur,e) => cur.forEach(n => {
			n.value = lerp(vFrom[n.id]||0, vTo[n.id]||0, e);
			if(n.children)rec(n.children,e)});
		const fromTotal = from.inTotal;
		/* Seed the union at where it is coming FROM. Built from the destination's nodes it would
		   otherwise hold the destination's values for one frame - a snap, and an unbalanced one,
		   since the streams carried over from the old tree still hold the old numbers. */
		rec(this.shown.in,0); rec(this.shown.out,0);
		const step = now => {
			const e = ease(Math.min(1,(now-t0)/this.tune.dataMs));
			rec(this.shown.in,e); rec(this.shown.out,e);
			this.shown.inTotal = lerp(fromTotal,tree.inTotal,e);
			if(this.focus.length&&this.G&&!this.G.nodeAt(this.focus)){this.focus=[];this.onFocusChange([])}
			this.rebuild();
			if(e<1)this.dataClock=requestAnimationFrame(step);
		};
		this.dataClock = requestAnimationFrame(step);
	}

	opts(){
		const cssW = this.host.clientWidth||0;
		return Object.assign({},this.tune,{cssW:cssW||360,worldH:this.worldH,format:this.format});
	}
	place(focus,opt){return compose(this.shown,focus,opt)}
	rebuild(){
		if(!this.shown)return;
		if(!this.host.clientWidth)return;              // nothing to measure against yet
		const r = this.place(this.focus,this.opts()); this.G=r.g; this.cam=r.cam; this.paint();
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
		const settle = () => {this.animating=false;this.G=B;this.cam=camB;this.dimNow=dimTo;this.paint()};
		if(this.reduced)return settle();
		this.animating = true;
		const t0 = performance.now(), D = opt.moveMs;
		this.moveStart = t0; this.moveEnds = t0+D;
		this.fadeAtStart = Object.assign({},this.fade);
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
			[r.a,r.a2,r.b].forEach(e => {if(e.parentNode)e.parentNode.removeChild(e)});
			this.pool.text.delete(k)}});
	}
	dropText(key){const r=this.pool.text.get(key);if(!r)return;
		[r.a,r.a2,r.b].forEach(e => {if(e.parentNode)e.parentNode.removeChild(e)});
		r.__seen = this.frameSeq;
	}
	tone(t){return this.palette[t]||this.palette.bodyTextSecondary}

	/* ---- §6 §7  paint ----------------------------------------------------------------------- */
	paint(){
		if(!this.G||!this.host.clientWidth)return;
		this.frameSeq++;
		const opt = this.opts(), cssW = opt.cssW, now = performance.now();
		const G = this.G, cam = this.cam, focus = this.focus, WH = this.worldH;
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
		const arm = (node,path) => {
			node.classList.add("mf-tap");
			if(node.__go===undefined)node.addEventListener("click",ev => {
				ev.stopPropagation(); if(node.__go)this.go(node.__go)});
			node.__go = path;
		};
		const disarm = node => {node.classList.remove("mf-tap");node.__go=null};

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
		const pOut = G.plumeOut===undefined?1:G.plumeOut, pIn = G.plumeIn===undefined?1:G.plumeIn;
		const softR = soft*pOut, softLe = softL*pIn;
		const Lz = Math.max(cam.x,frontIn-softLe), Rz = Math.min(camR,frontOut+softR);
		const Lop = Lz>frontIn-softLe+0.01 ? 1-clamp01((cam.x-frontIn)/Math.max(1,softL)) : 0;
		const Rop = Rz<frontOut+softR-0.01 ? 1-clamp01((frontOut-camR)/Math.max(1,soft)) : 0;
		const spanX = Math.max(1,Rz-Lz), atX = x => clamp01((x-Lz)/spanX);
		const mid = Math.min(atX(Lz+softLe),atX(Rz-softR));
		const fgId = this.uid+"-frontG", fmId = this.uid+"-frontM";
		const fg = this.reuse("grad","frontG",() => {const e=this.mk("linearGradient",
				{id:fgId,gradientUnits:"userSpaceOnUse",y1:0,y2:0});
			for(let i=0;i<4;i++)e.appendChild(this.mk("stop",{"stop-color":"#fff"}));
			this.gDefs.appendChild(e);return e});
		this.set(fg,{x1:Lz,x2:Rz});
		[[0,Lop],[mid,1],[Math.max(mid,atX(Rz-softR)),1],[1,Rop]].forEach((p,i) =>
			this.set(fg.childNodes[i],{offset:(p[0]*100)+"%","stop-opacity":p[1]}));
		const big = {x:cam.x-cam.w,y:cam.y-cam.h,width:cam.w*3,height:cam.h*3};
		const fm = this.reuse("grad","frontM",() => {const e=this.mk("mask",{id:fmId,maskUnits:"userSpaceOnUse"});
			e.appendChild(this.mk("rect",{fill:"url(#"+fgId+")"}));this.gDefs.appendChild(e);return e});
		this.set(fm,big); this.set(fm.firstChild,big);
		this.set(this.gHull,{mask:"url(#"+fmId+")"});

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
			/* §6.5  a true leaf stops dead at the front; only a stream with more behind it plumes. */
			if(f.pass&&(f.s>0 ? f.x0>=frontOut-BAR-0.5 : f.x1<=frontIn+0.5))return;
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
		if(focus.length&&G.names[focus[focus.length-1]]){
			const fn = G.names[focus[focus.length-1]];
			const fTop = fn.y, fBot = fn.y+fn.h, fMid = fn.y+fn.h/2;
			const heads = [];
			Object.keys(G.names).forEach(q => {const n=G.names[q], path=G.pathOf[n.id];
				if(!path)return;
				let d=0; while(d<focus.length&&d<path.length&&path[d]===focus[d])d++;
				if(d>=focus.length||path.length!==d+1)return;
				if(crosses(n.id))return;                                     // §3.7
				heads.push({n:n,d:d})});
			const pick = side => {const mid2 = n => n.y+n.h/2;
				for(let d=focus.length-1;d>=0;d--){
					const c = heads.filter(h => h.d===d&&(side<0?mid2(h.n)<fMid:mid2(h.n)>=fMid));
					/* §3.5  One each side, not two. Two of them cost a second strip of the frame's height
					   at both ends, and that height is the subject's - which is the whole point of the
					   view. The way to the rest is to move to one of these and look from there. */
					if(c.length)return c.sort((a,b) => side<0?mid2(b.n)-mid2(a.n):mid2(a.n)-mid2(b.n))
						.slice(0,1).map(h => h.n);
				}
				return []};
			const INSET = 13*k, STEP = 17*k, MARGIN = inset+4*k;
			const place2 = (list,sign,edge) => {
				if(!list.length)return;
				const lim = sign<0 ? cam.y+MARGIN : cam.y+cam.h-MARGIN;
				const far = edge+sign*(INSET+(list.length-1)*STEP);
				const shift = (sign<0?far<lim:far>lim) ? lim-far : 0;      // the group slides as one
				list.forEach((n,i) => {pinned[n._k]=edge+sign*(INSET+i*STEP)+shift;
					n.pin=1;n.rail=false;n.x=fn.x});
			};
			place2(pick(-1),-1,fTop); place2(pick(1),1,fBot);
		}
		/* §7.21 §7.22  the last few pixels only, and a pinned control is exempt. */
		const EDGE = opt.edgePx*k;
		const frameAt = (c,n) => {if(n.pin)return 1;const ext=n.rail?0:10*k;
			return clamp01(Math.min((c-ext)-cam.y,(cam.y+cam.h)-(c+ext))/EDGE)};
		const frameF = n => frameAt(n.y+n.h/2,n);
		/* §7.5  A name is either readable or absent. Ramping it over a range of band heights put a
		   name that was perfectly in focus at a quarter opacity - which is the same channel the diagram
		   uses to say "not what you are looking at", so a thin stream's name read as dimmed, or as
		   missing, and there was no telling which. The test is a step now and the ease below smooths
		   it; what stops two names sharing a spot is the overlap test, which is unambiguous about who
		   wins - the thicker stream. */
		const thickF = n => (n.rail||n.pin||n.h/k>=opt.minBandPx) ? 1 : 0;
		const shown = Object.keys(G.names).map(q => G.names[q]).filter(n => vis(n)>0.02||n.pin);
		/* §7.3  How much room a name has, and whether it needs two lines for it. Inside the diagram
		   that is one pitch; in the rail it is whatever is left to the edge of the frame. A rail name
		   too long for the rail used to be dropped outright by the window test below - a thick stream
		   with a long name simply went unnamed, which is the other half of why labels went missing. */
		const roomFor = n => n.pin ? 1e9
			: n.rail ? (n.anchor==="start" ? (cam.x+cam.w-n.x-4*k) : (n.x-cam.x-4*k))
			: (n.maxW||1e9);
		shown.forEach(n => {
			this.set(this.meas,{"font-size":((n.strong&&!n.pin)?13:12)*k,
				"font-family":this.opt.fontFamily||"inherit","font-weight":(n.strong&&!n.pin)?600:500});
			this.meas.textContent = n.name;
			n._fold = this.meas.getComputedTextLength()>roomFor(n) ? splitTwo(n.name) : null;
		});
		/* §7.24  membership by where the move is GOING, not by how lit a name is right now. */
		const kin = id => !!(G.inFocus&&G.inFocus(id));
		const rails = shown.filter(n => n.rail&&vis(n)>=0.5&&frameF(n)>0.05&&kin(n.id))
			.sort((a,b) => (a.y+a.h/2)-(b.y+b.h/2));
		/* §7.13 §7.14 §7.17  measured extents, and the amount is the first thing given up. */
		let twoLine = true;
		const eligible = n => n.h/k>=26&&n.val!==undefined;
		/* A folded name is already two lines; the amount under it would be a third, and §7.14 gives the
		   amount up before anything else anyway. */
		const isTwo = n => twoLine&&eligible(n)&&!n._fold;
		const upOf = n => (n._fold?15:8)*k;
		const downOf = n => (n._fold?17:(isTwo(n)?24:10))*k;
		const LEAD = 2*k;
		const spanOf = n => upOf(n)+downOf(n)+LEAD;
		const room = bot-top;
		if(rails.reduce((t,n) => t+spanOf(n),0)>room)twoLine = false;
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
		/* §7.16  a name off its own bar has stopped naming it. Settled once, on arrival. */
		const DRIFT = opt.driftPx*k;
		const worstDrift = () => {let m=0;
			rails.forEach(n => {if(kin(n.id))m=Math.max(m,Math.abs(railY[n.id]-(n.y+n.h/2)))});return m};
		while(!this.animating&&worstDrift()>DRIFT){
			let give = -1;
			for(let i=0;i<rails.length;i++)
				if(!kin(rails[i].id)&&(give<0||rails[i].h<rails[give].h))give = i;
			if(give<0)break;
			rails.splice(give,1); relax();
		}
		/* §7.6 §7.7 §7.8  the tier's clock: it leaves and lands with the camera, in every direction,
		   and a name already being read is never pulled down. */
		const remain = this.animating?Math.max(0,this.moveEnds-now):0;
		const elapsed = this.animating?Math.max(0,now-this.moveStart):0;
		const goneF = (!this.animating||opt.leadMs<=0) ? 0 : clamp01(1-elapsed/opt.leadMs);
		const gate = !this.animating ? 1 : (opt.leadMs<=0?0:clamp01((opt.leadMs-remain)/opt.leadMs));

		const placed = [];
		shown.sort((a,b) => b.h-a.h).forEach(n => {
			const key = n._k;
			/* §7.18  the bar is followed exactly; the displacement from it is smoothed. */
			const band = n.y+n.h/2;
			const raw = pinned[key]!==undefined ? pinned[key]-band
				: ((n.rail&&railY[n.id]!==undefined)?railY[n.id]-band:0);
			const prev = this.offY[key];
			const off = prev===undefined ? raw : prev+(raw-prev)*opt.smooth;
			this.offY[key] = off;
			const cy = band+off;
			if(Math.abs(raw-off)>0.4)more = true;
			let want = (n.pin?1:vis(n))*frameAt(cy,n)*thickF(n);            // §7.5
			if(n.rail){
				const held = this.animating?(this.fadeAtStart[key]||0):0;   // §7.8
				want *= railY[n.id]===undefined ? (this.animating?held*goneF:0)
				                                : (this.animating?Math.max(gate,held):1);
			}
			const was = this.fade[key]===undefined?0:this.fade[key];
			if(want<=0.02&&was<=0.02){this.fade[key]=0;delete this.offY[key];delete this.offX[key];
				this.dropText(key);return}
			const two = n.pin ? false : (n.rail?isTwo(n):eligible(n));
			const g = this.text(key,n,cy,two,k);
			let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
			g.forEach(e => {const b=e.getBBox();
				x0=Math.min(x0,b.x);y0=Math.min(y0,b.y);x1=Math.max(x1,b.x+b.width);y1=Math.max(y1,b.y+b.height)});
			/* §7.19  the drawn LEFT EDGE is smoothed, so an anchor flip slides instead of hopping by
			   the name's own width. */
			const px = this.offX[key], tgt = x0;
			const sx = px===undefined ? tgt : px+(tgt-px)*opt.smooth;
			this.offX[key] = sx;
			if(Math.abs(tgt-sx)>0.4)more = true;
			const dx = sx-tgt;
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
			if(a<=0.02){this.dropText(key);this.offY[key]=raw;this.offX[key]=tgt;return}
			g.forEach(e => this.set(e,{opacity:(n.pin?1:lit(n.id))*a}));    // §7.22
			if(blocked)return;
			placed.push({x0:x0,y0:y0,x1:x1,y1:y1,rail:!!n.rail});
			/* §3.1 §3.2  a name goes one level down, except the subject's own, which goes back up. */
			if(n.tap&&G.pathOf[n.tap]){
				const q = G.pathOf[n.tap];
				const isFocus = q.length===focus.length&&q.every((v,i) => v===focus[i]);
				const full = G.nodeAt(q);
				const dest = isFocus ? (focus.length?q.slice(0,-1):null)
					: ((!crosses(n.tap)&&full&&full.children&&full.children.length)?q:null);
				g.forEach(e => dest?arm(e,dest):disarm(e));
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
	text(key,n,cy,two,k){
		const rec = this.reuse("text",key,() => ({a:this.mk("text",{}),a2:this.mk("text",{}),
			b:this.mk("text",{})}));
		const one = (e,dy,txt,strong,sec) => {
			if(e.textContent!==txt)e.textContent = txt;
			this.set(e,{x:n.x,y:cy+dy,"text-anchor":n.anchor,
				fill:sec?this.palette.bodyTextSecondary:this.palette.bodyText,
				"font-family":(sec?this.opt.numberFamily:this.opt.fontFamily)||"inherit",
				"font-size":(strong?13:12)*k,"font-weight":strong?600:500});
			if(e.parentNode!==this.gText)this.gText.appendChild(e);
			return e};
		const strong = n.strong&&!n.pin, sec = !!n.pin;
		const out = [one(rec.a,4.5*k,n.name,strong,sec)];
		/* Whether it folds was settled before the rail was swept, so the room reserved for it and the
		   room it takes are the same decision. */
		const folded = n._fold;
		if(folded){
			one(rec.a,-3*k,folded[0],strong,sec);
			out.push(one(rec.a2,12*k,folded[1],strong,sec));
		}else if(rec.a2.parentNode)rec.a2.parentNode.removeChild(rec.a2);
		if(two)out.push(one(rec.b,19.5*k,n.val,false,true));
		else if(rec.b.parentNode)rec.b.parentNode.removeChild(rec.b);
		return out;
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
