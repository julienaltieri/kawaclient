import './App.css'
import BaseComponent from './components/BaseComponent'
import {BrowserRouter as Router, Route, Switch} from 'react-router-dom';
import LoginPage from './components/loginPage'
import CategorizationRulesView from './components/CategorizationRulesView'
import ApiCaller from './ApiCaller'
import styled from 'styled-components'
import UserData, { Stream } from './model'
import Core from './core.js'
import MasterStreamView from './components/StreamView'
import {ModalContainer} from './ModalManager.js'
import Navigation, {TopNavigationBar,Routes} from './components/Navigation'
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
    Navigation.addView("Home",Routes.home);
    Navigation.addView("Streams",Routes.streams);
    Navigation.addView("Categorization",Routes.categorization);
    Navigation.addView("Settings",Routes.settings);

  }

  render(){
    Core.refreshTheme()
    return (
    <Router>
        {!!this.state.modalController?<ModalContainer controller={this.state.modalController}/>:""}
        <TopNavigationBar loggedIn={this.state.loggedIn}/>
        <div style={{paddingTop:"3rem"}}>
          <Switch>
            <Route path={Routes.streams} component={MasterStreamView} exact/>
            <Route path={Routes.categorization} component={CategorizationRulesView} exact/>
            <Route path={Routes.home} component={MissionControl} exact/>
            <Route path={Routes.login} component={LoginPage}/>
            <Route path={Routes.settings} component={SettingPage}/>
            
          </Switch>

        </div>
    </Router>
  )}
}



