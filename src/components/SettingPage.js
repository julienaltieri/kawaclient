import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import ApiCaller from '../ApiCaller'
import Core from '../core'
import {ModalTemplates} from '../ModalManager.js'
//import PlaidLinkComponent from './PlaidLink';
import {PlaidLink} from "react-plaid-link";
import utils from '../utils'
import DS from '../DesignSystem'
import PageLoader from './PageLoader'


const PlaidStatuses = {
  ok:'ok',
  error: 'error'
}

const AccountTypes ={
  checking : "checking",
  savings : "savings"
}

export default class SettingPage extends BaseComponent{
	constructor(props) {
		super(props);
		this.state = {
			fetching: true,
      bankAccounts:[]
		}  
	}
  loadData(){
    return Core.loadData().then(() => {
      var ud = Core.getUserData();
      return Promise.all([ApiCaller.getPlaidLinkToken(),ApiCaller.getBankAccountsForUser(),...ud.plaidConnections.map(co => ApiCaller.getPlaidItemStatus(co.itemId))])
      .then(([linkTokenResponse,bas,...rs]) => {
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

  getBankAccountsForItem(itemId){return this.state.bankAccounts.filter(bas => bas.item_id==itemId)[0]?.accounts}
  handleOnSuccess(public_token, metadata){
    //validates the new connection and saves it to user data
    Core.presentModal(ModalTemplates.ModalWithSingleInput("What should we name this connection?")).then(r => r.state.inputValue)
    .then(friendlyName => ApiCaller.exchangePlaidLinkTokenAndSaveConnection(public_token,friendlyName))
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
          <PlaidLink style={{outline: "none",display: "block",background: "none",border: "none",padding: "0",flexGrow: "1",margin: "0",cursor: "pointer",width: "100%"}}
            clientName="React Plaid Setup" env="development" product={["auth", "transactions"]} token={this.state.newConnectionLinkToken}
            onExit={this.handleOnExit} onSuccess={this.handleOnSuccess.bind(this)} className="test"
          ><DS.component.Button.Placeholder iconName="plus"></DS.component.Button.Placeholder></PlaidLink>
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
  }

  componentDidMount(){
    var debug = false;//set to true for debug
    if(this.props.data.status!=PlaidStatuses.ok || debug){//if item is under error status
      ApiCaller.getPlaidLinkTokenUpdateMode(this.props.data.itemId).then(data => {
        this.updateState({updateModeLinkToken:data.link_token})
      })
    }
  }

  handleOnExit(e){console.log("exit link")}
  handleOnSuccess(e){ 
    this.props.parent.updateState({fetching:true})
    //update the item status
    console.log("successfully repaired. updating item...")
    ApiCaller.forceRefreshItemTransactions(this.props.data.itemId).then(r => {
      console.log("item updated with latest transactions. Result:")
      console.log(r)
      this.props.parent.reloadData()
    }).catch(err => console.log(err))
  }
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
            <DS.component.Button.Link onClick={this.onToggleExpand} style={{marginTop:DS.spacing.xxs+"rem",display:"flex",alignItems:"center"}}>
              {this.props.bankAccounts.length} {this.props.bankAccounts.length>1?"accounts":"account"}
              <DS.component.Button.Icon iconName="caretDown" style={{transform:"rotate(-"+(this.state.expanded?0:90)+"deg)",transition: "transform 0.2s"}}/>
            </DS.component.Button.Link>
          </div>
          
          <div style={{textAlign:"right"}}>
            <div style={{marginBottom:DS.spacing.xxs+"rem"}}><Status good={this.props.data.status==PlaidStatuses.ok}>{this.props.data.status==PlaidStatuses.ok?"Connected":"Needs action"}</Status></div>
            <DS.component.Label size="xs">Last updated: {utils.formatDateShort(new Date(this.props.data.lastUpdated))}</DS.component.Label> 
          </div>
        </div>
        <div style={{display: "grid",gridTemplateRows: (this.state.expanded?1:0)+"fr",transition: "grid-template-rows 0.2s"}}>
          <div style={{paddingTop:(this.state.expanded?DS.spacing.xxs:0)+"rem", transition: "all 0.2s",overflow:"hidden"}}>
            {this.props.bankAccounts.map((ba,i) => <DS.component.ListItem key={i} fullBleed noHover>
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

        {this.state.updateModeLinkToken?<Row style={{"marginTop":"1rem",background:"#ffe2e2","padding":"1rem"}}>
          <span style={{"fontSize":"0.8rem"}}>
            {this.props.data.error.error_message}
          </span>
          <span>
            <PlaidLink
              clientName="React Plaid Setup"
              env="development"
              product={["auth", "transactions"]}
              token={this.state.updateModeLinkToken}
              onExit={this.handleOnExit}
              onSuccess={this.handleOnSuccess.bind(this)}
              className="test"
            >
            Resolve
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