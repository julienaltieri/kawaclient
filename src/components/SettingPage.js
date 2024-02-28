import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import ApiCaller from '../ApiCaller'
import Core from '../core'
import {ModalTemplates} from '../ModalManager.js'
import {PlaidLink,PlaidLinkOnEvent} from "react-plaid-link";
import utils from '../utils'
import DS from '../DesignSystem'
import PageLoader from './PageLoader'
import {BankConnectionStatuses,getBankErrorMessage,AccountTypes} from '../Bank.js'


export default class SettingPage extends BaseComponent{
	constructor(props) {
		super(props);
		this.state = {
			fetching: true,
      bankAccounts:[],
      plaidLinkVisible: true
		} 
    this.handleOnSuccess = this.handleOnSuccess.bind(this)
    this.handleOnExit = this.handleOnExit.bind(this)
    this.handleOnEvent = this.handleOnEvent.bind(this) 
	}
  loadData(){
    return Core.loadData().then(() => {
      var ud = Core.getUserData();
      return Promise.all([ApiCaller.bankInitiateConnection().catch(err => console.log(err)),ApiCaller.bankGetAccountsForUser().catch(err => console.log(err)),ApiCaller.bankGetItemStatuses().catch(err => console.log(err))])
      .then(([linkTokenResponse,bas,rs]) => {
        this.updateState({
          bankConnections:rs,
          newConnectionLinkToken:linkTokenResponse.link_token,
          newConnectionLinkTokenExpiration: linkTokenResponse.expiration,
          bankAccounts:bas
        })
      })
      .catch(err => console.log(err))    
    })
  }
  reloadData(){this.updateState({fetching: true},() => this.loadData().then(() => this.updateState({fetching: false})))}
  componentDidMount(){this.reloadData()}
  getBankAccountsForItem(itemId){return this.state.bankAccounts?.filter(bas => bas.itemId==itemId)[0]?.accounts}
  handleOnEvent(e,m){
    console.log(e,m)
    if(e=="SELECT_INSTITUTION" && m.institution_id == "ins_79"){
      this.updateState({plaidLinkVisible:false}).then(() => this.updateState({plaidLinkVisible:true}))
    }
  }
  handleOnSuccess(public_token, metadata){
    //validates the new connection and saves it to user data
    Core.presentModal(ModalTemplates.ModalWithSingleInput("What should we name this connection?")).then(r => r.state.inputValue)
    .then(friendlyName => ApiCaller.bankExchangeTokenAndSaveConnection(public_token,friendlyName))
    .then(() => Core.reloadUserData())
    .then(() => this.reloadData())
    .then(r => console.log("new connection successfully created"))
    .catch(err => console.log(err))
  }
  handleOnExit(){console.log("New connection canceled")}
	render(){
		return(
		this.state.fetching?<div style={{textAlign:"center",marginTop:"-6rem"}}><PageLoader/></div>:
    <DS.Layout.PageWithTitle title="Settings" content={
      <div style={{marginTop:"-1rem"}}>{this.state.bankConnections.map((co,i) => <BCSettingItem bankAccounts={this.getBankAccountsForItem(co.itemId)} parent={this} key={i} data={co} />)}
        <div style={{"flexGrow":1,flexDirection: "column"}}>
          {this.state.plaidLinkVisible?<PlaidLink style={{outline: "none",display: "block",background: "none",border: "none",padding: "0",flexGrow: "1",margin: "0",cursor: "pointer",width: "100%"}}
            clientName="React Plaid Setup" env="development" product={["auth", "transactions"]} token={this.state.newConnectionLinkToken}
            onExit={this.handleOnExit} onSuccess={this.handleOnSuccess} onEvent={this.handleOnEvent} className="test"
          ><DS.component.Button.Placeholder iconName="plus"></DS.component.Button.Placeholder></PlaidLink>:""}
        </div>
      </div>
    }/>
	)}
}


class BCSettingItem extends BaseComponent{
  constructor(props) {
    super(props);
    this.state = {
      expanded:false
    }  
    this.onToggleExpand=this.onToggleExpand.bind(this)
    this.onChangeAccountType=this.onChangeAccountType.bind(this)
    this.handleOnSuccess = this.handleOnSuccess.bind(this)
    this.handleOnExit = this.handleOnExit.bind(this)
    this.handleOnEvent = this.handleOnEvent.bind(this)
  }

  componentDidMount(){
    var debug = false;//set to true for debug
    if(this.props.data.status!=BankConnectionStatuses.ok || debug){//if item is under error status
      ApiCaller.bankInitiateUpdate(this.props.data.itemId).then(data => {
        this.updateState({updateModeLinkToken:data.link_token})
      })
    }
  }

  handleOnExit(e){console.log("exit link")}
  handleOnSuccess(e){ 
    this.props.parent.updateState({fetching:true})
    //update the item status
    console.log("successfully repaired. updating item...")
    ApiCaller.bankForceRefreshItemTransactions(this.props.data.itemId).then(r => {
      console.log("item updated with latest transactions. Result:")
      console.log(r)
      this.props.parent.reloadData()
    }).catch(err => console.log(err))
  }
  handleOnEvent(e,m){console.log(e,m)}
  onToggleExpand(e){
    this.updateState({expanded:!this.state.expanded})
  }
  getAccountTypeString(type){return type}//for future localization
  getTypeForAccount(ba){
    return (Core.getUserData().savingAccounts.indexOf(ba.hash)!=-1)?AccountTypes.savings:AccountTypes.checking
  }
  onChangeAccountType(e,ba){
    if(this.getTypeForAccount(ba)!=AccountTypes[e.target.value]){//if changed (should be all the time)
      let isSavings = AccountTypes[e.target.value]==AccountTypes.savings
      if(isSavings){Core.getUserData().savingAccounts.push(ba.hash)}
      else{
        let idx = Core.getUserData().savingAccounts.indexOf(ba.hash)
        Core.getUserData().savingAccounts.splice(idx,1)
      }
      Core.saveBankAccountSettings().then(r => console.log("Profile saved")).catch(e => console.log(e)) 
    }
  }

  render(){
    return <DS.component.ContentTile style={{
          margin:DS.spacing.xs+"rem 0",padding:DS.spacing.xs+"rem",
          width:"auto",display:"flex",flexDirection:"column",justifyContent: "space-between",alignItems: 'stretch'}}>
        <div style={{display:"flex",flexDirection:"row",justifyContent: "space-between"}}>
          <div style={{display: "flex",flexDirection: "column",alignItems: "flex-start"}}>
            <DS.component.Label highlight>{this.props.data.name}</DS.component.Label>
            {this.props.bankAccounts?<DS.component.Button.Link onClick={this.onToggleExpand} style={{marginTop:DS.spacing.xxs+"rem",display:"flex",alignItems:"center"}}>
              {this.props.bankAccounts.length} {this.props.bankAccounts.length>1?"accounts":"account"}
              <DS.component.Button.Icon iconName="caretDown" style={{transform:"rotate(-"+(this.state.expanded?0:90)+"deg)",transition: "transform 0.2s"}}/>
            </DS.component.Button.Link>:""}
          </div>
          
          <div style={{textAlign:"right"}}>
            <div style={{marginBottom:DS.spacing.xxs+"rem"}}><Status good={this.props.data.status==BankConnectionStatuses.ok}>{this.props.data.status==BankConnectionStatuses.ok?"Connected":"Action needed"}</Status></div>
            <DS.component.Label size="xs">Last updated: {utils.formatDateShort(new Date(this.props.data.lastUpdated))}</DS.component.Label> 
          </div>
        </div>
        <div style={{display: "grid",gridTemplateRows: (this.state.expanded?1:0)+"fr",transition: "grid-template-rows 0.2s"}}>
          <div style={{paddingTop:(this.state.expanded?DS.spacing.xxs:0)+"rem", transition: "all 0.2s",overflow:"hidden"}}>
            {this.props.bankAccounts?.map((ba,i) => <DS.component.ListItem key={i} fullBleed noHover>
              <DS.component.Label size="xs">{ba.name}</DS.component.Label>
              <DS.component.Label size="xs" style={{minWidth:"3rem",textAlign:"right"}}>**{ba.mask}</DS.component.Label>
              <DS.component.Spacer/>
              <div style={{width: "50%",display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
                <DS.component.DropDown inline autoSize noMargin name="acc_type" id="acc_type" defaultValue={this.getTypeForAccount(ba)} onChange={e => this.onChangeAccountType(e,ba)}>
                  {Object.keys(AccountTypes).map((k) => <option key={k} value={k}>{this.getAccountTypeString(AccountTypes[k])}</option>)}
                </DS.component.DropDown>
              </div>
            </DS.component.ListItem>)}
          </div>
        </div>

        {this.state.updateModeLinkToken?<Row style={{"marginTop":"1rem","padding":"1rem"}}>
          <DS.component.Label style={{}}>
            {getBankErrorMessage(this.props.data)}
          </DS.component.Label>
          <span>
            <PlaidLink
              style={{background: "none",decoration:"none",border:"none"}}
              clientName="React Plaid Setup"
              env="development"
              product={["auth", "transactions"]}
              token={this.state.updateModeLinkToken}
              onExit={this.handleOnExit}
              onSuccess={this.handleOnSuccess}
              onEvent={this.handleOnEvent}
              className="test"
            >
            <DS.component.Button.Action small>Resolve</DS.component.Button.Action>
            </PlaidLink></span>
        </Row>:""}
    </DS.component.ContentTile>
  }
}



const Status = styled.span`
    font-weight: bold;
    color: ${props => props.good ? DS.getStyle().positive : DS.getStyle().alert};
`

const Row = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
`



