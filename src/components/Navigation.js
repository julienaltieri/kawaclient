import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import Cookies from 'js-cookie'
import Core from '../core.js'
import {useNavigate} from 'react-router-dom'
import SideBar from './SideBar'
import DesignSystem from '../DesignSystem'



const NavRoutes = {
	home:'/',
	login: '/login',
	categorization: '/categorization',
	streams: '/streams',
	settings: '/settings'
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
		if(this.state.sideBarVisible)return;//don't do anything if the side bar is already up
		this.refreshSideBarState()
		this.updateState({sideBarVisible:true})
	}

	render(){
		var leftButton,rightButton;
		if(this.props.loggedIn){
			rightButton = <StyledLogOutButton onClick={this.logout}>Log Out</StyledLogOutButton> 
			leftButton = <HamburgerButton onClick={(e) => this.summonSideBar()}>{DesignSystem.icon.menu}</HamburgerButton>
		}
		return(
			//TODO: while the side bar is visible, have an overlay to capture event and dismiss
		  <StyledNavBar>
		  	<SideBar 	
		  		visible={this.state.sideBarVisible} items={instance.state.registeredViews} 
		  		onClickCloseSideBar={e => this.updateState({sideBarVisible:false})}
		  		activeIndex={instance.getCurrentRouteIndex()}
		  		onClickRoute={(route) => {
		  			instance.navigateToRoute(route);
		  			this.updateState({sideBarVisible:false,currentRouteIndex:instance.state.registeredViews.map(v => v.path).indexOf(route)})
		  		}}
		  	/>
		  	{leftButton}
		  	<Spacer/>
		  	<Logo>KAWA</Logo>
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

const Logo = styled.div`
	left: 0;
    position: absolute;
    z-index: -1;
    width:100%;
    text-align: center;
    color:${DesignSystem.getStyle().bodyText}
`

const Spacer = styled.div`
flex-grow:1
`
