import React from 'react';
import styled from 'styled-components'
import BaseComponent from './BaseComponent';
import Core from '../core.js'
import DS from '../DesignSystem.js'

//A horizontal deck of pages you flick between, one page in view at a time.
//
//A paged, swipeable container: N pages laid end to end, one visible, dragged between with a spring and a
//pager underneath. It knows nothing about what a page contains - `pages` is an array of nodes - and is
//used both for the charges of one Amazon order and for the stream view's visualisation carousel.
//
//It was written for the charges of one Amazon order: an order billed as several charges produces several bank
//transactions that are identical on screen, and listing them under the tile only ever said that they
//existed. Here they ARE the pages, so moving between them is the same gesture as moving through the
//action queue and nothing has to be closed and reopened to do it.
//
//The deck is deliberately dumb about what a page contains. It owns the track's position, the gesture, the
//spring and its own height; the caller owns everything inside a page.

//Tuned on a device against a live prototype rather than picked. Read them together: `projection` is how far
//ahead of the release the throw is aimed, `flickVel` the speed above which a flick commits whatever the
//distance, `commitFrac` how far across a slow drag has to be to count, `maxFlick` the most pages one throw
//may cross, `rubber` how much of the finger the track follows past either end.
export const deckPhysics = {
	projection: 0.16,   //seconds of travel projected from the release velocity
	flickVel: 0.30,     //px/ms, above which a release commits on its own
	commitFrac: 0.22,   //fraction of a page a slow drag must cover
	maxFlick: 2,        //pages, per throw
	stiffness: 180,
	damping: 26,
	rubber: 0.8
};
const dragLockPx = 6;          //below this the gesture has not declared itself yet
//The drag track contains real inputs and selects for the allocation rows, so only the drag surface itself
//should reject text selection - inline style can't express that as a descendant rule, hence
//styled-components here though the rest of this component is inline.
const Track = styled.div`
	-webkit-user-select: none;
	user-select: none;

	input, select, textarea {
		-webkit-user-select: text;
		user-select: text;
	}
`
//cursor + tap highlight for the padded target around each pager dot, matching tappableStyle in
//CategorizeAction.js so the mobile blue flash is gone here too
const dotTargetStyle = {cursor:"pointer",userSelect:"none",WebkitTapHighlightColor:"transparent"};
//The modal's own side padding, which the deck reaches back into so a page slides all the way to the edge
//of the sheet instead of stopping at the text column. Read from the same values BaseModalWrapper uses
//rather than guessed: clipping a page short of the sheet edge makes the neighbour appear out of nowhere
//instead of sliding in from under the frame.
//Default bleed: the MODAL's own side padding, which the deck reaches back into so a page slides all the
//way to the sheet edge instead of stopping at the text column. A caller outside a modal has no such padding
//to reach into and passes bleedRem:0 - hence a prop rather than a constant.
const bleed = () => (Core.isMobile()?DS.spacing.s:DS.spacing.l);
//Transparent for the first and last `f` rem, opaque between: the clip's own edges stop being a line.
const fadeMask = (f) => "linear-gradient(90deg, transparent 0rem, black "+f+"rem, black calc(100% - "+f+"rem), transparent 100%)";
const heightAnimation = 300;   //ms; matches the item name's open/close so the two never fight
//Read by BOTH the inline style in render() and the restore in fit(), so they can never drift apart again:
//fit() used to restore an empty string after an instant fit, which REMOVED the inline transition outright
//(React never re-applies it without a re-render) instead of putting this back - so the deck's height
//stopped animating after the very first paint.
const heightTransitionValue = "height "+heightAnimation/1000+"s ease";
const dotLimit = 7;            //beyond this, dots stop being countable and become a count
//half the smallest type on the tile: big enough to see, small enough that a row of them stays a marker
//rather than becoming a control
const dotSize = DS.fontSize.little/2+"rem";

export default class Deck extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {}
		this.deckRef = React.createRef();
		this.trackRef = React.createRef();
		this.x = 0;             //the track's current offset, in px. Not state: it changes every frame.
		this.raf = undefined;
		this.drag = undefined;
		this.clickSwallow = undefined; //the one-shot listener currently armed on window, or undefined
		this.swallowTimer = undefined;
		this.onPointerDown = this.onPointerDown.bind(this);
		this.onPointerMove = this.onPointerMove.bind(this);
		this.onPointerUp = this.onPointerUp.bind(this);
	}
	componentDidMount(){
		super.componentDidMount?.();
		this.onResize = () => {this.place(this.pageX(this.props.index));this.fit(true)};
		window.addEventListener('resize',this.onResize);
		//after a frame, not now: this mounts inside a modal that is still animating open, and a track
		//placed against a width of zero starts on the wrong page whenever the deck opens on anything but
		//the first charge.
		requestAnimationFrame(() => {
			if(!this.trackRef.current)return
			this.place(this.pageX(this.props.index));
			this.fit(true);
		});
	}
	componentDidUpdate(prev){
		//A move this deck started is already being sprung; re-entering here on the parent's re-render would
		//restart it from a standstill and eat the flick. Only a move the CALLER made is followed.
		if(prev.index!==this.props.index && this.props.index!==this.movingTo)this.go(this.props.index,0);
		else this.fit();
	}
	componentWillUnmount(){
		super.componentWillUnmount?.();
		window.removeEventListener('resize',this.onResize);
		cancelAnimationFrame(this.raf);
		this.disarmClickSwallow();
	}
	reducedMotion(){return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches}
	count(){return (this.props.pages||[]).length}
	//Measured off the DOM rather than computed from a width this component thinks it has: the page is a
	//flex child of a track inside a modal that sizes itself.
	pitch(){
		var track = this.trackRef.current, page = track?.children[0];
		if(!page)return 0
		var gap = parseFloat(window.getComputedStyle(track).columnGap)||0;
		return page.getBoundingClientRect().width+gap
	}
	pageX(i){return -i*this.pitch()}
	place(x){
		this.x = x;
		if(this.trackRef.current)this.trackRef.current.style.transform = "translate3d("+x+"px,0,0)"
	}
	//The deck is as tall as the page you are on and eases between them. `now` skips the animation for a
	//fresh mount, where there is no previous height worth travelling from.
	fit(now){
		var deck = this.deckRef.current, page = this.trackRef.current?.children[this.movingTo!==undefined?this.movingTo:this.props.index];
		if(!deck || !page)return
		//Under stretchPages a page's height comes FROM the deck, so measuring a page to size the deck is
		//circular: the deck fixes a height, every page adopts it, and content taller than that guess is then
		//clipped by the overflow:hidden above - which cost the tile three of its rounded corners. There is
		//nothing to animate in that mode anyway, since all pages are already the same height, so the deck
		//takes the track's natural height and the tallest page decides it.
		if(this.props.stretchPages){deck.style.height = "auto";return}
		if(now || this.reducedMotion())deck.style.transition = "none";
		deck.style.height = page.offsetHeight+"px";
		if(now || this.reducedMotion())requestAnimationFrame(() => {if(this.deckRef.current)this.deckRef.current.style.transition = heightTransitionValue});
	}
	//A spring rather than an easing curve, because the thing being continued is a throw that already has a
	//speed: handing that speed to the spring is what makes the release feel like one movement instead of a
	//drag followed by an animation.
	settle(target,v0){
		cancelAnimationFrame(this.raf);
		var v = v0*1000, last = performance.now();//v0 arrives in px/ms
		var step = (now) => {
			var dt = Math.min((now-last)/1000,1/30); last = now;
			var a = -deckPhysics.stiffness*(this.x-target)-deckPhysics.damping*v;
			v += a*dt;
			this.place(this.x+v*dt);
			if(Math.abs(this.x-target)<0.5 && Math.abs(v)<10)return this.place(target)
			this.raf = requestAnimationFrame(step);
		};
		this.raf = requestAnimationFrame(step);
	}
	go(i,v0){
		var to = Math.max(0,Math.min(this.count()-1,i));
		this.movingTo = to;
		if(to!==this.props.index)this.props.onIndexChange?.(to);
		//height first, so the box is already travelling while the track slides across it
		requestAnimationFrame(() => this.fit());
		if(this.reducedMotion())return this.place(this.pageX(to))
		this.settle(this.pageX(to),v0||0);
	}
	//Arms a single capture-phase click swallower on window. Installed only after a drag that MOVED, because
	//when the press started inside the modal and the release lands outside it, the browser fires the
	//resulting click on the common ancestor of the two points - the modal wrapper, which carries
	//data-dismiss - so the drag's own release click is the one thing that closes the dialog. Capture phase
	//so this runs before the click can reach React's delegated handler on the root container.
	armClickSwallow(){
		this.disarmClickSwallow();
		var swallow = (e) => {e.stopPropagation();this.disarmClickSwallow()};
		this.clickSwallow = swallow;
		window.addEventListener('click',swallow,true);
		//safety net: a release over a region that never fires a click at all (empty backdrop, outside the
		//window) would otherwise leave this armed to catch the NEXT, unrelated click instead
		this.swallowTimer = setTimeout(() => this.disarmClickSwallow(),500);
	}
	disarmClickSwallow(){
		if(this.clickSwallow){window.removeEventListener('click',this.clickSwallow,true);this.clickSwallow = undefined}
		if(this.swallowTimer){clearTimeout(this.swallowTimer);this.swallowTimer = undefined}
	}
	onPointerDown(e){
		//a fresh gesture must never inherit a swallower armed by the one before it
		this.disarmClickSwallow();
		if(this.count()<2)return
		//anything that answers a tap of its own keeps it: the item carousel's arrows, the name that opens,
		//a stream field. The deck only claims what nothing else wanted.
		if(e.target.closest && e.target.closest('[data-no-drag]'))return
		cancelAnimationFrame(this.raf);
		this.drag = {x0:e.clientX,y0:e.clientY,x:this.x,moved:false,samples:[[performance.now(),this.x]],pointerId:e.pointerId};
	}
	onPointerMove(e){
		if(!this.drag)return
		var dx = e.clientX-this.drag.x0;
		if(!this.drag.moved){
			if(Math.abs(dx)<dragLockPx)return
			if(Math.abs(dx)<Math.abs(e.clientY-this.drag.y0)){this.drag = undefined;return}//it is a scroll
			this.drag.moved = true;
			//CAPTURED ONLY ONCE THE DRAG IS REAL. Capture keeps pointermove/up coming wherever the cursor
			//goes - without it, moving the pointer past the container's edge stops delivering events and the
			//throw freezes there - but taken on pointerdown it also retargets the CLICK to this element, so a
			//press and release on a button inside never reached that button. Mouse only: a touch tap
			//synthesises its click after the capture is released, which is why it only showed on desktop.
			try{e.currentTarget.setPointerCapture(this.drag.pointerId)}catch(err){}
		}
		var lo = this.pageX(this.count()-1), want = this.drag.x+dx;
		if(want>0)want = want*deckPhysics.rubber;
		if(want<lo)want = lo+(want-lo)*deckPhysics.rubber;
		//sampled from the TRACK, not the finger: past either end the track follows only `rubber` of the
		//hand, and measuring the hand there hands the spring a speed the deck never had - which came out
		//as a snap-back far faster than anything the reader had done.
		this.drag.samples.push([performance.now(),want]);
		if(this.drag.samples.length>6)this.drag.samples.shift();
		this.place(want);
	}
	onPointerUp(e){
		//Released first and unconditionally, from the EVENT's pointer id rather than the drag's: a gesture
		//judged to be a vertical scroll clears `this.drag` mid-move, and releasing only through that object
		//would leave the capture held by a drag that no longer exists. The browser releases implicitly on
		//pointerup, but relying on that means the one path that matters is the one never exercised here.
		try{e.currentTarget.releasePointerCapture(e.pointerId)}catch(err){}
		if(!this.drag)return
		var d = this.drag; this.drag = undefined;
		if(!d.moved)return
		var s = d.samples, first = s[0], last = s[s.length-1];
		var v = (last[0]-first[0])>0?(last[1]-first[1])/(last[0]-first[0]):0;//px/ms of track, + is rightward
		var w = this.pitch()||1;
		var target = Math.round(-(this.x+v*deckPhysics.projection*1000)/w);
		target = Math.max(this.props.index-deckPhysics.maxFlick,Math.min(this.props.index+deckPhysics.maxFlick,target));
		if(Math.abs(v)>deckPhysics.flickVel)target = this.props.index+(v<0?1:-1);
		else if(Math.abs(this.x-this.pageX(this.props.index))<w*deckPhysics.commitFrac)target = this.props.index;
		this.go(target,v);
		this.armClickSwallow();
	}
	//Position and nothing else. A dot that also said whether its charge had posted or been categorized was
	//asking a half-rem circle to carry three meanings, and the tile says all of them already.
	renderPager(){
		var n = this.count();
		if(n<2)return ""
		var style = {fontSize:DS.fontSize.little+"rem",color:DS.getStyle().bodyTextSecondary};
		//The dots are the primary way to move between pages on a desktop, where there is no swipe, so each
		//gets a padded target around it rather than relying on the dot's own tiny circle: horizontal padding
		//is half of what used to be the row's gap, and the gap itself moves to 0, so adjacent targets meet
		//with no dead space between them while the dots stay spaced exactly as before.
		var dotGap = DS.spacing.xxs;
		//Distance from the page above. A prop because the two callers sit in different rooms: inside a modal
		//sheet the pager needs the full DS.spacing.s to clear the content, and on the page the same gap read
		//as a hole. Derived from the token either way rather than typed.
		var pagerGap = this.props.pagerGapRem!==undefined?this.props.pagerGapRem:DS.spacing.s;
		return <div data-no-drag style={{display:"flex",justifyContent:"center",alignItems:"center",gap:0,
				margin:pagerGap+"rem 0 0 0"}}>
			{n>dotLimit
				?<span style={{...style,fontVariantNumeric:"tabular-nums"}}>{(this.props.index+1)+" / "+n}</span>
				:this.props.pages.map((p,i) => <span key={i} onClick={() => this.go(i,0)}
					aria-label={(this.props.pageLabel||"Page")+" "+(i+1)+" of "+n}
					style={{...dotTargetStyle,display:"flex",alignItems:"center",justifyContent:"center",
						padding:DS.spacing.xxs+"rem "+dotGap/2+"rem"}}>
					<span style={{width:dotSize,height:dotSize,borderRadius:"50%",flexShrink:0,
						border:"1.5px solid "+(i===this.props.index?DS.getStyle().bodyText:DS.getStyle().bodyTextSecondary),
						background:i===this.props.index?DS.getStyle().bodyText:"transparent",
						transform:"scale("+(i===this.props.index?1.4:1)+")",
						transition:"transform 0.2s ease"}}/>
				</span>)}
		</div>
	}
	render(){
		var pages = this.props.pages||[];
		var b = this.props.bleedRem!==undefined?this.props.bleedRem:bleed();
		//Bleed and gutter were the same number, which is only right when a page fills its own box. When the
		//page holds an inset tile, the tile's own margins already separate one page from the next, and adding
		//the bleed on top of them double-counts. Defaults to the bleed so the modal is unchanged.
		var gap = this.props.gapRem!==undefined?this.props.gapRem:b;
		//Padding and bleed were welded together as one number, which is what made the page geometry so hard
		//to reason about: the padding is what holds a page off the container's edge, and the negative margin
		//is what lets a page slide PAST that edge before it clips. A modal needs both, because the sheet's
		//own padding is outside this component. A caller that is already full width needs only the padding -
		//it has no frame to reach back into, and a negative margin there just pushes the track out of its
		//column. Defaults to the bleed, so the modal is unchanged.
		var pad = this.props.padRem!==undefined?this.props.padRem:b;
		var fade = this.props.fadeEdgesRem||0;
		//The gesture sits on the WHOLE component rather than on the track, so the band between the last page
		//and the pager is grabbable too - it is the obvious place to put a thumb and it used to be dead. The
		//pager itself opts out: its dots are tap targets, and a drag starting on one should move the deck
		//only by way of that dot's own click.
		return <div onPointerDown={this.onPointerDown} onPointerMove={this.onPointerMove}
				onPointerUp={this.onPointerUp} onPointerCancel={this.onPointerUp}>
			{/*The deck reaches back into the sheet's padding and clips there, so a page slides under the frame
			   rather than stopping short of it. `contain: inline-size` is what keeps the track's width - which
			   is every page laid end to end - from being what the modal sizes itself to: the desktop sheet is
			   width:auto between 30 and 40rem, and without this a two-charge order pushed it straight to the
			   cap.*/}
			{/*`fadeEdgesRem` softens the clip instead of removing it. Dropping overflow:hidden was tried and
			   only works where every page is exactly the container's width - a modal's sheet is narrower than
			   its track and would have the neighbouring page painted across it. A mask keeps the clip and
			   stops it reading as a cut: a page dissolves at the edge rather than meeting a hard line.
			   The fade is exactly the bleed, so it covers precisely the strip outside a resting page - which
			   means at rest nothing visible is faded at all, and only a page in motion crosses it.*/}
			<div ref={this.deckRef} style={{position:"relative",overflow:"hidden",contain:"inline-size",
					...(fade?{maskImage:fadeMask(fade),WebkitMaskImage:fadeMask(fade)}:{}),
					margin:"0 "+(-b)+"rem",padding:"0 "+pad+"rem",
					transition:heightTransitionValue}}>
				<Track ref={this.trackRef}
					style={{display:"flex",alignItems:this.props.stretchPages?"stretch":"flex-start",gap:gap+"rem",
						touchAction:"pan-y",willChange:"transform"}}>
					{pages.map((p,i) => <div key={i} style={{flex:"0 0 100%",minWidth:0,
							opacity:i===this.props.index?1:0.45,transition:"opacity 0.25s ease"}}>{p}</div>)}
				</Track>
			</div>
			{this.renderPager()}
		</div>
	}
}
