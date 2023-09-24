import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import Cookies from 'js-cookie'
import Core from '../core.js'
import {useNavigate} from 'react-router-dom'
import SideBar from './SideBar'
import DesignSystem from '../DesignSystem'
import {ModalTemplates} from '../ModalManager.js'



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
	getCurrentRouteIndex(){return this.getHamburgerMenuItems().map(a => a.path).indexOf(this.getCurrentRoute())}
	addView(name,path){if(this.state.registeredViews.map(a => a.name).indexOf(name)==-1)this.state.registeredViews.push({name:name,path:path})}
	getHamburgerMenuItems(){return this.state.registeredViews}
	registerNavBar(navBar){
		this.state.navBar = navBar;
		this.state.navBar.props.navigate(this.getCurrentRoute())
	}
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



class TopNavigationBarBase extends BaseComponent{
	constructor(props){
		super(props);
		this.logout = this.logout.bind(this)
		this.state = {
			sideBarVisible:false,
			currentRouteIndex:Math.max(instance.getCurrentRouteIndex(),0)
		}
		instance.registerNavBar(this)
	}

	logout(e){
		Cookies.set("token","");
		Core.setLoggedIn(false);
		this.updateState({sideBarVisible:false})
	}

	refreshSideBarState(){this.updateState({currentRouteIndex:instance.getCurrentRouteIndex()})}

	summonSideBar(){
		Core.presentModal(ModalTemplates.SideNavigation(),true).then((o) => {
			let route = o.buttonIndex
			instance.navigateToRoute(route);
  			this.updateState({sideBarVisible:false,currentRouteIndex:instance.state.registeredViews.map(v => v.path).indexOf(route)})
		}).catch(e => {return})
	}

	render(){
		var leftButton,rightButton;
		leftButton = <HamburgerButton onClick={(e) => {if(this.props.loggedIn)this.summonSideBar()}}>{DesignSystem.icon.logo[DesignSystem.getMode()]}</HamburgerButton>
		if(this.props.loggedIn){
			rightButton = <StyledLogOutButton onClick={this.logout}>Log Out</StyledLogOutButton> 
		}
		return(
		  <StyledNavBar>
		  	{leftButton}
		  	<Spacer/>
		  	<Spacer/>
		  	{rightButton}
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
	border-bottom: solid 1px ${DesignSystem.getStyle().borderColor};
    padding: 0.5em;
    height: 3rem;
    width: 100%;
	display: flex;
    align-items: center;
    justify-content: flex-end;
    box-sizing: border-box;
    position:fixed;
    z-index:100;
    background-color: ${DesignSystem.getStyle().pageBackground+"60"};
    backdrop-filter: blur(1rem);
`

const StyledLogOutButton = styled.button`
    background: ${DesignSystem.getStyle().UIElementBackground};
    color: ${DesignSystem.getStyle().bodyTextSecondary};
    margin-right:0.5rem;
    border-radius: 100vw;
    height: 2.4em;
    border: none;
    width: 5rem;
    cursor: pointer;
    font-weight: bold;
}
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
