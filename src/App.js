import './App.css'
import BaseComponent from './components/BaseComponent'
import {BrowserRouter as Router, Route, Outlet, Routes} from 'react-router-dom';
import LoginPage from './components/loginPage'
import CategorizationRulesView from './components/CategorizationRulesView'
import ApiCaller from './ApiCaller'
import styled from 'styled-components'
import UserData, { Stream } from './model'
import Core from './core.js'
import MasterStreamView from './components/StreamView'
import {ModalContainer} from './ModalManager.js'
import Navigation, {TopNavigationBar,NavRoutes} from './components/Navigation'
import MissionControl from './components/MissionControl'
import SettingPage from './components/SettingPage'
import PageLoader from './components/PageLoader'
import Sandbox from './components/Sandbox'
import AppConfig from './AppConfig'

export default class App extends BaseComponent{
  constructor(props){   
    super(props);
    this.state={
      userData:Core.getUserData(),
      loggedIn:Core.globalState.loggedIn,
      modalController:undefined,
      refresh: new Date()
    }

    //set callbacks for modal management
    Core.registerApp(this)
    Core.registerModalManagement((modalC) => this.updateState({modalController:modalC}),() => this.updateState({modalController: undefined}))
    this.refresh = this.refresh.bind(this)
  }

  refresh(){
    this.updateState({refresh: new Date()})
  }

  componentDidMount(){
    //populate side navigation bar
    Navigation.addView("Home",NavRoutes.home);
    Navigation.addView("Streams",NavRoutes.streams);
    Navigation.addView("Categorization",NavRoutes.categorization);
    Navigation.addView("Settings",NavRoutes.settings);
    //Sandbox is a workbench, not a feature: only staging registers the menu entry, so production never
    //shows a dead entry and the route below never exists to be guessed at.
    if(AppConfig.staging)Navigation.addView("Sandbox",NavRoutes.sandbox);

  }

  render(){
    Core.refreshTheme()
    return (
    <Router>
        {!!this.state.modalController?<ModalContainer controller={this.state.modalController}/>:""}
        <TopNavigationBar loggedIn={this.state.loggedIn}/>
        <div style={{paddingTop:"3rem",minHeight:"calc(100vh - 3rem)",display:"flex",flexDirection:"column"}}>
          {Core.isUserLoggedIn()?<Routes>
            <Route path={NavRoutes.streams}         element={<MasterStreamView refresh={this.refresh}/>}/>
            <Route path={NavRoutes.categorization}  element={<CategorizationRulesView refresh={this.refresh}/>}/>
            <Route path={NavRoutes.home}            element={<MissionControl refresh={this.refresh}/>}/>
            <Route path={NavRoutes.settings}        element={<SettingPage refresh={this.refresh}/>}/>
            {/*Sandbox: a workbench, not a feature. Only registered in staging (AppConfig.staging) so
               production never exposes the route or the menu entry. Delete this line and the addView
               call above, and the Sandbox import, to remove it entirely.*/}
            {AppConfig.staging?<Route path={NavRoutes.sandbox}     element={<Sandbox refresh={this.refresh}/>}/>:""}
          </Routes>:<Routes>
            <Route path={NavRoutes.login}           element={<LoginPage refresh={this.refresh}/>}/>
            <Route path={"*"}                       element={<PageLoader/>}/>
          </Routes>}
        </div>
    </Router>
  )}
}



