import React from 'react';
import BaseComponent from './BaseComponent';
import DS from '../DesignSystem.js';
import Core from '../core';
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
//`bleedRem` is 0. Deck's default bleed reaches back into a MODAL's side padding so a page slides in from
//under the sheet's frame; here there is no frame to slide under, and a negative margin at page level would
//push the track past the column it sits in.
//
//The index lives HERE rather than in the caller. MasterStreamAuditView rebuilds three full analysis trees
//on every render and is not memoised, so paging from its state would recompute the entire portfolio's
//analysis to move a carousel. Holding it one level down means a page change re-renders this component and
//reconciles the same page elements the parent already built.
const pageMinHeightRem = DS.spacing.xxl;

//A page that does not exist yet. It is deliberately mute: it names what will live here and nothing else -
//a placeholder that explains the carousel would be explaining the interface rather than being it.
export const PlaceholderPage = (props) => <DS.component.ContentTile
		style={{position:"relative",width:"calc(100% - 2rem)",margin:0,padding:"1rem",
			minHeight:pageMinHeightRem+"rem",display:"flex",alignItems:"center",justifyContent:"center",
			marginBottom:DS.verticalSpacing[Core.isMobile()?"s":"m"]}}>
	<div style={{fontSize:DS.fontSize.body+"rem",color:DS.getStyle().bodyTextSecondary}}>{props.label}</div>
</DS.component.ContentTile>

export default class ChartCarousel extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {index:0}
	}
	render(){
		return <Deck pageLabel="View" bleedRem={0} pages={this.props.pages||[]}
			index={this.state.index}
			onIndexChange={(i) => this.updateState({index:i})}/>
	}
}
