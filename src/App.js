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
  }



  componentDidMount(){
    //populate side navigation bar
    Navigation.addView("Home",NavRoutes.home);
    Navigation.addView("Streams",NavRoutes.streams);
    Navigation.addView("Categorization",NavRoutes.categorization);
    Navigation.addView("Settings",NavRoutes.settings);

  }

  render(){
    Core.refreshTheme()
    return (
    <Router>
        {!!this.state.modalController?<ModalContainer controller={this.state.modalController}/>:""}
        <TopNavigationBar loggedIn={this.state.loggedIn}/>
        <div style={{paddingTop:"3rem"}}>
          <Routes>
            <Route path={NavRoutes.streams} element={<MasterStreamView/>} exact/>
            <Route path={NavRoutes.categorization} element={<CategorizationRulesView/>} exact/>
            <Route path={NavRoutes.home} element={<MissionControl/>} exact/>
            <Route path={NavRoutes.login} element={<LoginPage/>}/>
            <Route path={NavRoutes.settings} element={<SettingPage/>}/>
          </Routes>
        </div>
    </Router>
  )}
}



