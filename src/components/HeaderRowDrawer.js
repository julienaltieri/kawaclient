import React from 'react';
import BaseComponent from './BaseComponent';
import Core from '../core.js';
import DS from '../DesignSystem.js';

//The compound-stream header row's drawer interaction: on mobile, a right-drag reveals the progress ring
//from behind the row; on desktop the row renders exactly as it always has, no gesture. Built once here
//because more than one screen needs the identical interaction (DECISION-PRINCIPLES.md #18) - a second copy
//is a second place for the spring, the guards or the shield to drift out of step.

//The ring's own box, read off the header row rather than retyped: that row gives the ring div width:"3rem"
//and marginLeft:"1rem", which are exactly DS.spacing.l and DS.spacing.xs on the scale.
const ringWidthRem = DS.spacing.l;
const ringMarginRem = DS.spacing.xs;
//The drawer draws the ring smaller than the row does. The value sits BESIDE it rather than under it, so
//the ring is one of two things sharing the panel's width rather than the thing the panel is built around.
//A SEPARATE constant rather than a change to ringWidthRem because the row's ring must not move: desktop
//renders the row exactly as it always did, which is the one thing this feature must not redesign.
//Converged on the bench at 85%, which is 2.55rem and not on the scale; this is the token composition
//nearest that intent, one pixel away, and a hard 2.55rem is the magic number principle 17 prevents.
const drawerRingWidthRem = DS.spacing.m+DS.spacing.xxs;
//Between the ring and the value beside it.
const drawerRingGapRem = DS.spacing.xxs;
//The drawer is sized from its CONTENT, not from the ring. It used to be ring + gap + gap, which made the
//caption's width a hostage of the ring's: the caption lives inside the ring's box, so every attempt to give
//it room by widening the drawer bought padding instead of text width. Widening the gap from 2rem to 3rem
//moved the caption's box by exactly zero pixels, measured.
//6.5rem is what the longest real caption needs to stop wrapping mid-phrase; the ring keeps its own 3rem and
//centres itself inside that. Note this makes the open drawer NARROWER than it was (7.5rem against 9rem)
//while the caption's box more than doubles - the room was there all along, spent on padding.
const drawerContentWidthRem = DS.spacing.xl+DS.spacing.xs;
//Breathing room either side of that content.
const drawerPadRem = DS.spacing.xs;
//How far the panel must travel to reveal it: the content's box plus that padding either side.
const openWidthRem = drawerContentWidthRem+drawerPadRem+drawerPadRem;
const openWidth = openWidthRem*DS.remToPx; //px - the drag/spring math below works in px, like ChargeDeck's

//Physics tuned per spec rather than picked: critically damped (damping is derived, not typed) so the panel
//never oscillates on its own, only the guards in settle() below stop it from crossing the target.
const stiffness = 320;
const damping = 2*Math.sqrt(stiffness);
const rubber = 0.3;      //fraction of the finger the panel follows past either end
const flickVel = 0.30;   //px/ms, above which a release commits regardless of distance
const commitFrac = 0.22; //fraction of the open travel a slow drag must cross to commit
const dragLockPx = 6;    //below this the gesture hasn't declared itself yet - matches ChargeDeck's own lock

//DS.backgroundOpacity is the token this codebase already uses as an alpha channel (StreamView.js); 0.45 is
//the exact opacity ChargeDeck gives a page that isn't the current gesture's focus - the same "quiet"
//treatment, reused here for the chart while the drawer is out.
const quietOpacityFloor = 0.45;

//Rows cannot coordinate through props - each mounts independently in a plain list - so which row is open
//lives in a module-level registry instead.
const openDrawerRegistry = {current:undefined};

//The row's own style, common to every caller regardless of platform (flexDirection, justifyContent, width,
//margin all matched to the header row - DECISION-PRINCIPLES.md #17, no magic numbers, precedent's tokens).
//marginBottom and cursor vary by caller (collapse state, clickability) so they arrive through props.style
//and are merged on top.
const tileStyle = {
	flexDirection:"row",
	justifyContent:"space-between",
	width:"calc(100% - "+DS.spacing.xs+"rem)",
	margin:0
};

//The ring's own box, and in the drawer also the caption's. Its WIDTH is what the caption wraps in, so the
//two placements need different widths: in the row it is the ring and nothing else, so it is the ring's 3rem;
//in the drawer the caption sits under the ring and wraps at this width, so it is the drawer's content width
//with the ring centring itself inside it. Binding both to ringWidthRem is what confined the caption to 48px.
//marginLeft applies only in the row, where the ring is a flex item among others; the drawer places it by
//centring, and giving it both pushed the ring off-centre toward the drawer's right edge.
//This box sizes TEXT, not the ring - the ring carries its own ringWidthRem box inside it (see
//renderRingBox). Letting the ring inherit this width drew it at 6.5rem across the whole row.
//In the drawer the ring and the value sit side by side; in the row the ring is alone, so the direction
//there is moot and stays as it was. Beside the ring, the value reads left-aligned rather than centred -
//centred text under a ring and centred text beside one are different things.
const ringBoxStyle = (inRow) => ({width:(inRow?ringWidthRem:drawerContentWidthRem)+"rem",flexShrink:0,
	display:"flex",flexDirection:inRow?"column":"row",alignItems:"center",
	...(inRow?{marginLeft:ringMarginRem+"rem"}:{gap:drawerRingGapRem+"rem"})});

//One compound-stream header row's drawer. Desktop renders exactly what the row rendered before this existed
//- ring in place, no drawer, no gesture. Mobile moves the ring into a drawer that sits outside the window at
//rest and slides in on a right-drag - not a panel that covers it, see the render() comment below for why
//that distinction is the whole fix.
export default class HeaderRowDrawer extends BaseComponent{
	constructor(props){
		super(props);
		//the drawer holds the ring and lives outside the window's clip at rest; the content holds the row's
		//children and carries the gesture. Two refs, not one, because the fix is that these never overlap:
		//the drawer's right edge and the content's left edge are always both at exactly `x` (see place()).
		this.drawerRef = React.createRef();
		this.contentRef = React.createRef();
		this.graphRef = React.createRef();
		this.ruleRef = React.createRef();
		this.shieldRef = React.createRef();
		this.x = 0;              //panel offset in px: 0 closed, openWidth fully open. Not state - changes every frame.
		this.isOpen = false;
		this.raf = undefined;
		this.drag = undefined;
		this.clickSwallow = undefined;
		this.swallowTimer = undefined;
		this.onPointerDown = this.onPointerDown.bind(this);
		this.onPointerMove = this.onPointerMove.bind(this);
		this.onPointerUp = this.onPointerUp.bind(this);
	}
	componentDidMount(){
		super.componentDidMount?.();
		if(Core.isMobile())this.place(0);
	}
	componentWillUnmount(){
		super.componentWillUnmount?.();
		cancelAnimationFrame(this.raf);
		this.disarmClickSwallow();
		if(openDrawerRegistry.current===this)openDrawerRegistry.current = undefined;
	}
	//Position plus its cosmetic side effects (separator, chart dimming), all driven off the same offset so
	//they never drift relative to each other or to a mid-drag frame.
	place(x){
		this.x = x;
		var progress = Math.max(0,Math.min(1,x/openWidth)); //clamped ONLY for these cosmetic ramps - x itself never is, see settle()
		if(this.drawerRef.current){
			//the drawer's own box sits flush with the window's left edge (left:0) and is translated the
			//rest of the way off-window by -openWidth, so at x=0 it is entirely outside the clip - hidden
			//because it is clipped, not because anything is painted over it. Its right edge is always at x.
			this.drawerRef.current.style.transform = "translate3d("+(x-openWidth)+"px,0,0)";
		}
		if(this.contentRef.current){
			//the content's left edge is also always at x, so drawer and content never overlap at any point
			//in the gesture - which is what makes all three defects impossible rather than merely fixed:
			//nothing is ever stacked, so there is nothing for a background to hide.
			this.contentRef.current.style.transform = "translate3d("+x+"px,0,0)";
		}
		if(this.shieldRef.current)this.shieldRef.current.style.display = progress>0?"block":"none";
		if(this.ruleRef.current){
			this.ruleRef.current.style.transform = "translate3d("+x+"px,0,0)";
			this.ruleRef.current.style.opacity = progress;
		}
		if(this.graphRef.current){
			this.graphRef.current.style.opacity = 1-progress*(1-quietOpacityFloor);
		}
	}
	//A spring rather than an easing curve, so a release already carrying a throw's speed continues it instead
	//of restarting from a standstill - same reasoning as ChargeDeck's settle().
	settle(target,v0){
		cancelAnimationFrame(this.raf);
		var v = v0*1000; //v0 arrives in px/ms
		//guard: a release velocity pointing away from the target would first travel further from it before
		//turning back, so it is dropped instead of handed to the spring
		if((target>this.x && v<0)||(target<this.x && v>0))v = 0;
		var last = performance.now(), dir = Math.sign(target-this.x);
		var step = (now) => {
			var dt = Math.min((now-last)/1000,1/30); last = now;
			var a = -stiffness*(this.x-target)-damping*v;
			v += a*dt;
			var nx = this.x+v*dt;
			//guard: stop the instant the step reaches or passes the target (monotonic). Deliberately not a
			//clamp into [0,openWidth] - that was tried and made a release beyond the stop snap back in one
			//frame, a jump rather than a settle, because it fires on every frame rather than only at crossing.
			if(dir!==0 && Math.sign(target-nx)!==dir)return this.place(target);
			this.place(nx);
			//guard: also stop once within 0.5px at low velocity - a critically damped spring only approaches
			//asymptotically and would otherwise keep animating for seconds on floating-point crumbs
			if(Math.abs(this.x-target)<0.5 && Math.abs(v)<10)return this.place(target);
			this.raf = requestAnimationFrame(step);
		};
		this.raf = requestAnimationFrame(step);
	}
	go(open,v0){
		this.isOpen = open;
		if(open){
			//one row open at a time
			if(openDrawerRegistry.current && openDrawerRegistry.current!==this)openDrawerRegistry.current.go(false,0);
			openDrawerRegistry.current = this;
		}else if(openDrawerRegistry.current===this){
			openDrawerRegistry.current = undefined;
		}
		this.settle(open?openWidth:0,v0||0);
	}
	//Arms a single capture-phase click swallower on window, only after a drag that MOVED - mirrors ChargeDeck's
	//guard so a release that lands on the row's own content doesn't also fire that content's click.
	armClickSwallow(){
		this.disarmClickSwallow();
		var swallow = (e) => {e.stopPropagation();this.disarmClickSwallow()};
		this.clickSwallow = swallow;
		window.addEventListener('click',swallow,true);
		this.swallowTimer = setTimeout(() => this.disarmClickSwallow(),500);
	}
	disarmClickSwallow(){
		if(this.clickSwallow){window.removeEventListener('click',this.clickSwallow,true);this.clickSwallow = undefined}
		if(this.swallowTimer){clearTimeout(this.swallowTimer);this.swallowTimer = undefined}
	}
	onPointerDown(e){
		this.disarmClickSwallow();
		//the chart has its own drag (Victory's voronoi hover) - the two must never fight over the same gesture
		if(e.target.closest && e.target.closest('[data-no-drag]'))return
		cancelAnimationFrame(this.raf);
		try{e.currentTarget.setPointerCapture(e.pointerId)}catch(err){}
		this.drag = {x0:e.clientX,y0:e.clientY,x:this.x,moved:false,samples:[[performance.now(),this.x]],pointerId:e.pointerId};
	}
	onPointerMove(e){
		if(!this.drag)return
		var dx = e.clientX-this.drag.x0;
		if(!this.drag.moved){
			if(Math.abs(dx)<dragLockPx)return
			if(Math.abs(dx)<Math.abs(e.clientY-this.drag.y0)){this.drag = undefined;return}//it's a scroll
			this.drag.moved = true;
		}
		var want = this.drag.x+dx;
		if(want>openWidth)want = openWidth+(want-openWidth)*rubber;
		if(want<0)want = want*rubber;
		this.drag.samples.push([performance.now(),want]);
		if(this.drag.samples.length>6)this.drag.samples.shift();
		this.place(want);
	}
	onPointerUp(e){
		try{e.currentTarget.releasePointerCapture(e.pointerId)}catch(err){}
		if(!this.drag)return
		var d = this.drag; this.drag = undefined;
		if(!d.moved)return
		var s = d.samples, first = s[0], last = s[s.length-1];
		var v = (last[0]-first[0])>0?(last[1]-first[1])/(last[0]-first[0]):0;//px/ms, + is rightward/opening
		var target = this.isOpen;
		if(Math.abs(v)>flickVel)target = v>0;
		//mirrored: measured from whichever end is currently settled, so the same fraction governs opening and closing
		else if(Math.abs(this.x-(this.isOpen?openWidth:0))>=openWidth*commitFrac)target = !this.isOpen;
		this.go(target,v);
		this.armClickSwallow();
	}
	//The ring's box: same column layout wherever it renders - what differs is its width and whether it
	//carries its own marginLeft (see ringBoxStyle above).
	//
	//`drawerCaption` renders ONLY on mobile, and that is not an inconsistency between screens - it is the
	//caption belonging to the drawer, which only mobile has. It exists because a drawer gives the ring
	//vertical room the row never had, and because a ring pushed out of sight should say the number it was
	//always comparing. Desktop keeps the ring in the row exactly as it has always been; adding a caption
	//there would be a redesign of a row that has no bug, which is the one thing this change must not do.
	//The ring gets its OWN box inside the caption's. TimeAndMoneyProgressView draws itself at 100% of
	//whatever contains it, so the enclosing box was silently doing two jobs: the width the caption wraps at,
	//and the diameter of the ring. Widening it for the caption drew a 6.5rem ring that overflowed the row.
	//Two boxes, one job each - the outer one sizes text, the inner one sizes the ring - which is also what
	//lets the drawer draw a smaller ring than the row without touching the width the caption wraps at.
	renderRingBox(inRow){
		return <div style={ringBoxStyle(inRow)}>
			<div style={{width:(inRow?ringWidthRem:drawerRingWidthRem)+"rem",flexShrink:0}}>{this.props.drawer}</div>
			{/*The caption's BOX is the drawer's business, its content the caller's. Callers used to carry
			   the marginTop and textAlign that placed it under the ring, which meant every caller had to be
			   edited to move it beside the ring instead - the arrangement is one decision and belongs in one
			   place. minWidth:0 so it may wrap rather than force the flex row wider than the panel.*/}
			{Core.isMobile()?<div style={{flex:"1 1 auto",minWidth:0,textAlign:"left"}}>
				{this.props.drawerCaption}</div>:null}
		</div>
	}
	//The chart's own shield and dimming, wherever the row renders it: a shield rather than pointer-events:none
	//because Victory's voronoi container sets pointer-events:all on its own capture layer, and an explicit
	//value on a descendant beats an inherited one - so quieting the wrapper never actually stopped the chart
	//answering. Covering it does, and because the shield sits outside the data-no-drag box the drag it
	//swallows becomes the drawer's.
	renderChartSlot(){
		return <div style={{position:"relative",flexShrink:0}}>
			<div ref={this.graphRef} data-no-drag>{this.props.chart}</div>
			<div ref={this.shieldRef} style={{position:"absolute",inset:0,display:"none"}}/>
		</div>
	}
	render(){
		if(!Core.isMobile()){
			//desktop: exactly the row as it always rendered - the ring in place, no drawer, no gesture
			return <DS.component.ContentTile onClick={this.props.onClick} style={{...tileStyle,...this.props.style}}>
				{this.renderRingBox(true)}
				{this.props.children}
				{this.renderChartSlot()}
			</DS.component.ContentTile>
		}
		//mobile: the window is the row's own ContentTile - same background, same padding, painted once. The
		//ring is not covered, it lives outside the window in its own absolutely-positioned drawer and is
		//clipped by the window's overflow:hidden at rest, not hidden under a second layer. The content has no
		//background and no reserved space of its own, so at rest it sits exactly where the plain row's
		//content sits.
		{/*The handlers sit on the WINDOW, not on the sliding content: with the drawer out, the ring's side of
		   the row is exactly where a thumb lands to push it back, and hanging the gesture off the content
		   alone made that whole area dead. Anything inside [data-no-drag] still keeps its own drag.*/}
		return <DS.component.ContentTile
					style={{...tileStyle,...this.props.style,position:"relative",overflow:"hidden",touchAction:"pan-y"}}
					onClick={this.props.onClick}
					onPointerDown={this.onPointerDown} onPointerMove={this.onPointerMove}
					onPointerUp={this.onPointerUp} onPointerCancel={this.onPointerUp}>
			{/*the drawer: the ring's own box, flush with the window's left edge and translated a further
			   -openWidth. At x=0 its whole box sits left of the clip and is invisible; as x grows its right
			   edge tracks x exactly, which is the other half of why it can never meet the content below*/}
			{/*Centred with justifyContent rather than padded. This codebase sets box-sizing per component and
			   has no global border-box rule, so a padded box here is a content-box one: width + padding, and
			   the padding would push the content past the width the spring translates by. The previous
			   paddingLeft only looked centred because a 3rem pad and a 9rem content-box width happened to
			   leave 3rem either side of a 3rem ring - an arithmetic coincidence that broke the moment the box
			   inside stopped being exactly the ring's width. Centring cannot drift.*/}
			<div ref={this.drawerRef} style={{position:"absolute",top:0,bottom:0,left:0,
					width:openWidthRem+"rem",display:"flex",alignItems:"center",
					justifyContent:"center",pointerEvents:"none"}}>
				{this.renderRingBox(false)}
			</div>
			{/*The separator, standing where a box-shadow could not: a box-shadow on the content would paint
			   on all four sides, drawing a rectangle inside the row when only the left edge - where the
			   content is the layer sliding over the ring - should shade. This is 1px of DS.getStyle().borderColor
			   instead, the same rule the hamburger menu draws between its links (SideBar.js). It rides on the
			   content's leading edge and fades in with the drawer, so at rest there is still nothing to see -
			   a permanent line would be a cue that a drawer exists, which this row deliberately does not give.
			   Half the row's height, centred: 25% in from top and bottom of the tile it is positioned against,
			   so it stays centred and proportional whatever a wrapping name does to the height.*/}
			<div ref={this.ruleRef} style={{position:"absolute",left:0,top:"25%",bottom:"25%",
					width:"1px",background:DS.getStyle().borderColor,opacity:0,pointerEvents:"none"}}/>
			<div ref={this.contentRef}
					style={{position:"relative",display:"flex",flexDirection:"row",alignItems:"center",
						justifyContent:"space-between",flexGrow:1,alignSelf:"stretch",
						willChange:"transform"}}>
				{this.props.children}
				{this.renderChartSlot()}
			</div>
		</DS.component.ContentTile>
	}
}
