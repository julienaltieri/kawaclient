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

/* WHO SEES THE WORKBENCH.
   Staging always. In production, the account that owns the app - so the balance bench is readable from
   a phone, away from the dev machine, without putting a developer tool in front of anyone else.

   This is a CONVENIENCE GATE, not a security boundary: it hides a menu entry and a route in a bundle
   every visitor downloads, and anyone reading the source can see the address. That is acceptable
   because the page shows only the reader's OWN data - it calls the same authenticated endpoints every
   other page calls, and the server decides what those return. Nothing here grants access to anything;
   it only decides whether a link is worth showing. */
const SANDBOX_OWNER = "julioo.altieri@gmail.com";
const sandboxVisible = () => AppConfig.staging
	|| (Core.getUserData() || {}).userId === SANDBOX_OWNER;

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
    //Sandbox is a workbench, not a feature. Staging always has it; in production it is registered for
    //the OWNER only, so the balance bench can be read from a phone away from the dev machine without
    //the entry appearing for anyone else.
    if(sandboxVisible())Navigation.addView("Sandbox",NavRoutes.sandbox);

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
            {/*Sandbox: a workbench, not a feature. Staging, or the owner in production - see
               sandboxVisible. Delete that helper, this line, the addView call above and the Sandbox
               import to remove it entirely.*/}
            {sandboxVisible()?<Route path={NavRoutes.sandbox}     element={<Sandbox refresh={this.refresh}/>}/>:""}
          </Routes>:<Routes>
            <Route path={NavRoutes.login}           element={<LoginPage refresh={this.refresh}/>}/>
            <Route path={"*"}                       element={<PageLoader/>}/>
          </Routes>}
        </div>
    </Router>
  )}
}



