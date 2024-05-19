import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import ApiCaller from '../ApiCaller'
import Core from '../core'
import utils from '../utils'
import DS from '../DesignSystem'
import {BankConnectionStatuses,getBankErrorMessage,AccountTypes} from '../Bank.js'
import {NewBankConnectionFlow, UpdateBankConnectionFlow} from './BankUI.js'

export default class SettingPage extends BaseComponent{
	constructor(props) {
		super(props);
		this.state = {
			fetching: true,
      bankAccounts:[],
      plaidLinkVisible: true
		} 
    
    this.onClickAddBankConnection = this.onClickAddBankConnection.bind(this)
	}

  //data management
  loadData(forcedReload){
    return Core.loadData(forcedReload).then(() => {
      var ud = Core.getUserData();
      return Promise.all([
        ApiCaller.bankGetAccountsForUser().catch(err => console.log(err)),
        ApiCaller.bankGetItemStatuses().catch(err => console.log(err))
      ]).then(([bas,rs]) => {
        this.updateState({
          bankConnections:rs,
          bankAccounts:bas
        })
      })
    })
    .then(() => NewBankConnectionFlow.RestoreFlowIfNeeded().then(() => this.reloadData()))//handles redirect case to finish the bank connection and reload if the flow finishes
    .catch(err => console.log(err)) 
  }
  reloadData(forcedReload){
    return Promise.all([this.updateState({fetching:true}),Core.reloadUserData()])
      .then(() => this.loadData(forcedReload))
      .then(() => this.updateState({fetching: false}))
  }
  getBankAccountsForItem(itemId){return this.state.bankAccounts?.filter(bas => bas.itemId==itemId)[0]?.accounts}
  componentDidMount(){this.reloadData()}
  
  //New bank connection flow
  onClickAddBankConnection(){return NewBankConnectionFlow.Summon().then(() => this.reloadData())}
 
	render(){return(
		this.state.fetching?<DS.component.Loader/>:
    <DS.Layout.PageWithTitle title="Settings" content={
      <div style={{marginTop:"-1rem"}}>{this.state.bankConnections?.map((co,i) => <BCSettingItem bankAccounts={this.getBankAccountsForItem(co.itemId)} parent={this} key={i} data={co} />)}
        <div style={{"flexGrow":1,flexDirection: "column"}}>
          <DS.component.Button.Placeholder iconName="plus" onClick={e => this.onClickAddBankConnection()}></DS.component.Button.Placeholder>
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
    this.presentBankUpdateFlow = this.presentBankUpdateFlow.bind(this)
    this.allowDelete = false; //for debugging only
  }

  presentBankUpdateFlow(e){
    return UpdateBankConnectionFlow.Summon({
      itemId: this.props.data.itemId,
      connectorName: this.props.data.connectorName
    }).then(() => this.props.parent.reloadData())
  }
  onToggleExpand(e){this.updateState({expanded:!this.state.expanded})}
  getAccountTypeString(type){return type}//for future localization
  getTypeForAccount(ba){return (Core.getUserData().savingAccounts.indexOf(ba.hash)!=-1)?AccountTypes.savings:AccountTypes.checking}
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
              {ba.mask?<DS.component.Label size="xs" style={{minWidth:"3rem",textAlign:"right"}}>**{ba.mask}</DS.component.Label>:""}
              <DS.component.Spacer/>
              <div style={{width: "50%",display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
                <DS.component.DropDown inline autoSize noMargin name="acc_type" id="acc_type" defaultValue={this.getTypeForAccount(ba)} onChange={e => this.onChangeAccountType(e,ba)}>
                  {Object.keys(AccountTypes).map((k) => <option key={k} value={k}>{this.getAccountTypeString(AccountTypes[k])}</option>)}
                </DS.component.DropDown>
              </div>
            </DS.component.ListItem>)}
          </div>
        </div>
        {this.allowDelete?<span><DS.component.Button.Action small onClick={e => ApiCaller.bankRemoveItem(this.props.data.itemId).then(() => this.props.parent.reloadData())}>Delete</DS.component.Button.Action></span>:""}
        {this.props.data.error?<Row style={{"marginTop":"1rem","padding":"1rem"}}>
          <DS.component.Label style={{}}>{getBankErrorMessage(this.props.data)}</DS.component.Label>
          <span><DS.component.Button.Action small onClick={this.presentBankUpdateFlow}>Resolve</DS.component.Button.Action></span>
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



