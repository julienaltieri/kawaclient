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
//The whole page geometry comes from ONE number. Everything else is derived from it, because the previous
//two attempts each set the inset in one place and the gutter in another and the two disagreed.
//
//  pageInsetRem   how far a resting page sits from its container's edge
//  padRem         the deck's own padding, which IS that inset - so the page needs no margin of its own
//  gapRem         twice the inset: a page's right inset plus the next page's left inset, made explicit
//  bleedRem       0 - this caller already spans its container, so there is no frame to reach back into;
//                 the deck clips at the container edge, which is where a swiped page should disappear
//
//The tiles fill their page rather than carrying an inset of their own. An inset tile inside an inset page
//counts the same space twice, which is what left the pages reading as overlapped, and a tile wider than the
//deck's clip is what cut the corners off it.
const pageInsetRem = DS.spacing.xs;
const padRem = pageInsetRem;
const gapRem = 2*pageInsetRem;
const bleedRem = 0;

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
		return <Deck pageLabel="View" bleedRem={bleedRem} padRem={padRem} gapRem={gapRem} stretchPages={true}
			pagerGapRem={DS.spacing.s/2}
			pages={this.props.pages||[]}
			index={this.state.index}
			onIndexChange={(i) => this.updateState({index:i})}/>
	}
}
