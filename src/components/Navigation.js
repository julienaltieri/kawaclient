import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import {useNavigate} from 'react-router-dom'
import SideBar from './SideBar'
import DS from '../DesignSystem'
import React from 'react'
import {ModalTemplates} from '../ModalManager.js'
import Core from '../core.js'



 
const NavRoutes = {
	home: 			'/',
	login:  		'/login',
	categorization: '/categorization',
	streams: 		'/streams',
	settings: 		'/settings'
}
const isValidRoute = (path)=> Object.keys(NavRoutes).map(k => NavRoutes[k]).indexOf(path)>-1

class NavigationController{
	constructor(){
		this.state = {
			sideBarVisible:false,
			registeredViews: []
		}
		if(!isValidRoute(this.getCurrentRoute()))this.navigateToRoute(NavRoutes.home)
	}

	getCurrentRoute(){return window.location.pathname}
	getCurrentQueryParameters(){return new URLSearchParams(window.location.search)}
	getCurrentRouteIndex(){return this.getHamburgerMenuItems().map(a => a.path).indexOf(this.getCurrentRoute())}
	getCurrentView(){return this.state.registeredViews[this.getCurrentRouteIndex()]?.ref.current}
	addView(name,path){if(this.state.registeredViews.map(a => a.name).indexOf(name)==-1)this.state.registeredViews.push({name:name,path:path})}
	getHamburgerMenuItems(){return this.state.registeredViews}
	registerNavBar(navBar){
		this.state.navBar = navBar;
		this.state.navBar.props.navigate(this.getCurrentRoute())
	}
	getPortalSlot(){return this.portalRef.current}
	navigateToRoute(route){
		if(route == this.getCurrentRoute())return;
		else{
			if(this.state.navBar){
				this.state.navBar.props.navigate(route)
				this.state.navBar.refreshSideBarState()
			}
		}
	}
}

let logo = DS.icon.logo[DS.getMode()]

class TopNavigationBarBase extends BaseComponent{
	constructor(props){
		super(props);
		this.state = {
			sideBarVisible:false,
			currentRouteIndex:Math.max(instance.getCurrentRouteIndex(),0)
		}
		instance.registerNavBar(this)
		instance.portalRef = React.createRef()
	}

	refreshSideBarState(){this.updateState({currentRouteIndex:instance.getCurrentRouteIndex()})}

	summonSideBar(){
		Core.presentModal(ModalTemplates.SideNavigation(),{fromSide:true}).then((o) => {
			let route = o.buttonIndex
			instance.navigateToRoute(route);
  			this.updateState({sideBarVisible:false,currentRouteIndex:instance.state.registeredViews.map(v => v.path).indexOf(route)})
		}).catch(e => {return})
	}

	render(){
		let leftButton = <HamburgerButton onClick={(e) => {if(this.props.loggedIn)this.summonSideBar()}}>{logo}</HamburgerButton>
		return(
		  <StyledNavBar loggedIn={this.props.loggedIn}>
		  	{leftButton}
		  	<Spacer/>
		  	<div style={{marginRight:(DS.spacing.s-0.5)+"rem"}} ref={instance.portalRef}></div>
		  </StyledNavBar>
		);
	}
}

const instance = new NavigationController();
const TopNavigationBar = (props) => { 
	const navigate = useNavigate() 
	return <TopNavigationBarBase loggedIn={props.loggedIn} navigate={navigate}/>
}
export {TopNavigationBar, NavRoutes}
export default instance;


const StyledNavBar = styled.div`
	opacity: ${(props) => props.loggedIn?1:0};
	border-bottom: solid ${DS.borderThickness.s}rem ${DS.getStyle().borderColor};
    padding: 0.5em;
    height: 3rem;
    width: 100%;
	display: flex;
    align-items: center;
    justify-content: flex-end;
    box-sizing: border-box;
    position:fixed;
    z-index:100;
    background-color: ${DS.getStyle().pageBackground+"60"};
    backdrop-filter: blur(1rem);
    transition: all 0.5s ease-in;
`

const HamburgerButton = styled.button`
    margin: 0;
    color: inherit;
    border: none;
    cursor: pointer;
    background: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    -webkit-align-self: baseline;
    -ms-flex-item-align: baseline;
    align-self: center;
    &:focus{
    	outline:0;
    }
}
`



const Spacer = styled.div`
flex-grow:1
`
