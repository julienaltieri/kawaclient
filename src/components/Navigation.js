import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import Cookies from 'js-cookie'
import Core from '../core.js'
import {withRouter} from 'react-router-dom'
import SideBar from './SideBar'



const Routes = {
	home:'/',
	login: '/login',
	categorization: '/categorization',
	streams: '/streams',
	settings: '/settings'
}
const isValidRoute = (path)=> Object.keys(Routes).map(k => Routes[k]).indexOf(path)>-1

class NavigationController{
	constructor(){
		this.state = {
			currentRoute:window.location.pathname,
			sideBarVisible:false,
			registeredViews: []
		}
		if(!isValidRoute(this.state.currentRoute))this.navigateToRoute(Routes.home)
	}

	getCurrentRoute(){return this.state.currentRoute}
	getCurrentRouteIndex(){
		return this.getHamburgerMenuItems().map(a => a.path).indexOf(this.state.currentRoute)
	}
	addView(name,path){if(this.state.registeredViews.map(a => a.name).indexOf(name)==-1)this.state.registeredViews.push({name:name,path:path})}
	getHamburgerMenuItems(){return this.state.registeredViews}
	registerNavBar(navBar){
		this.state.navBar = navBar;
		this.state.navBar.props.history.push(this.state.currentRoute)
	}
	navigateToRoute(route){
		if(route == this.state.currentRoute)return;
		else{
			this.state.currentRoute=route
			if(this.state.navBar){
				this.state.navBar.props.history.push(route)
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
			leftButton = <HamburgerButton onClick={(e) => this.summonSideBar()}>☰</HamburgerButton>
		}
		return(
			//TODO: while the side bar is visible, have an overlay to capture event and dismiss
		  <StyledNavBar>
		  	<SideBar 	
		  		visible={this.state.sideBarVisible} items={instance.state.registeredViews} 
		  		onClickCloseSideBar={e => this.updateState({sideBarVisible:false})}
		  		activeIndex={this.state.currentRouteIndex}
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
const TopNavigationBarWithRouter = withRouter(TopNavigationBarBase)
export {TopNavigationBarWithRouter as TopNavigationBar, Routes}
export default instance;


const StyledNavBar = styled.div`
	border-bottom: solid 1px #cfcfcf;
    padding: 0.5em;
    height: 3rem;
    width: 100%;
	display: flex;
    align-items: center;
    justify-content: flex-end;
    box-sizing: border-box;
`

const StyledLogOutButton = styled.button`
    color: #0087c5;
    border-radius: 100vw;
    height: 2.4em;
    border: none;
    width: 5rem;
    cursor: pointer;
    margin-right: 1rem;
    font-weight: bold;
}
`


const HamburgerButton = styled.button`
    margin: 0;
    padding: 0.7rem;
    color: inherit;
    margin-left: 0.5rem;
    border: none;
    cursor: pointer;
    background: none;
    font-size: 1rem;
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

`

const Spacer = styled.div`
flex-grow:1
`
