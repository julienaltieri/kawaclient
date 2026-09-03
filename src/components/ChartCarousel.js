import React from 'react';
import BaseComponent from './BaseComponent';
import DS from '../DesignSystem.js';
import Deck from './Deck';

//The stream view's visualisation carousel: several ways of looking at the same year, one at a time, swiped
//between. The macro graph is the first page; more (a flow breakdown, a balance-to-date and its forecast)
//are meant to follow, which is the whole reason this container exists rather than the graph sitting
//directly in the row.
//
//It reuses Deck rather than carrying its own gesture. Deck knows nothing about what a page holds - `pages`
//is an array of nodes - so a second implementation here would be a second set of spring constants and a
//second set of the three release guards to keep in step with the first (DECISION-PRINCIPLES.md #18).
//
//The index lives HERE rather than in the caller. MasterStreamAuditView rebuilds three full analysis trees
//on every render and is not memoised, so paging from its state would recompute the entire portfolio's
//analysis to move a carousel. Holding it one level down means a page change re-renders this component and
//reconciles the same page elements the parent already built.
//Every visualisation is the same height, and the macro graph is what sets it. `stretchPages` makes the
//track stretch its pages to the tallest, so no page carries a height of its own and none needs to know the
//chart's dimensions - swap the first page for a taller one and the rest follow. A typed height here would
//be a second place to keep in step with a chart that sizes itself from its own viewBox.
//
//The page body holds its content DS.spacing.xs off the screen edge, and a swipe is the one thing that should
//not obey it: a page has to be able to travel all the way out of view. So the deck steps back out of that
//padding and re-applies it itself, which puts the clip at the screen's edge instead of a rem inside it.
//One number again, and everything derived from it:
//
//  edgeInsetRem  what the page body inset its content by, and what a resting page should keep
//  bleedRem      the same, as a negative margin - this is how the deck escapes that padding
//  padRem        the same again, re-applied inside, so a resting page sits where it always did
//  gapRem        twice it: one page's right inset plus the next page's left one
//  fadeEdgesRem  the same again: the mask covers exactly the strip outside a resting page, so nothing is
//                faded at rest and only a page in motion dissolves into the edge
//
//The clip stays. Removing it was tried and is only safe where every page is exactly the container's width;
//the fade is what stops the clip reading as a cut.
const edgeInsetRem = DS.spacing.xs;
const bleedRem = edgeInsetRem;
const padRem = edgeInsetRem;
const gapRem = 2*edgeInsetRem;
const fadeEdgesRem = edgeInsetRem;

//A page that does not exist yet. It is deliberately mute: it names what will live here and nothing else -
//a placeholder that explains the carousel would be explaining the interface rather than being it.
export const PlaceholderPage = (props) => <DS.component.ContentTile
		style={{position:"relative",width:"100%",height:"100%",boxSizing:"border-box",
			margin:0,padding:DS.spacing.xs+"rem",
			display:"flex",alignItems:"center",justifyContent:"center"}}>
	<div style={{fontSize:DS.fontSize.body+"rem",color:DS.getStyle().bodyTextSecondary}}>{props.label}</div>
</DS.component.ContentTile>

export default class ChartCarousel extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {index:0}
	}
	render(){
		return <Deck pageLabel="View" bleedRem={bleedRem} padRem={padRem} gapRem={gapRem}
			fadeEdgesRem={fadeEdgesRem} stretchPages={true} grip={true}
			pagerGapRem={DS.spacing.s/2}
			pages={this.props.pages||[]}
			index={this.state.index}
			onIndexChange={(i) => this.updateState({index:i})}/>
	}
}
