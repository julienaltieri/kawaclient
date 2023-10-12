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


export default class SettingPage extends BaseComponent{
	constructor(props) {
		super(props);
		this.state = {
			fetching: true
		}  
	}
  loadData(){
    var ud = Core.getUserData();
    return Promise.all([ApiCaller.getPlaidLinkToken(),...ud.plaidConnections.map(co => ApiCaller.getPlaidItemStatus(co.itemId))])
      .then(([linkTokenResponse,...rs]) => {
        this.updateState({
          bankConnections:rs,
          newConnectionLinkToken:linkTokenResponse.link_token,
          newConnectionLinkTokenExpiration: linkTokenResponse.expiration
        })
      })
      .catch(err => console.log(err))     
  }
  reloadData(){this.updateState({fetching: true},() => this.loadData().then(() => this.updateState({fetching: false})))}
  componentDidMount(){this.reloadData()}


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
		<PageContainer>
      <DS.component.PageHeader>Bank connections</DS.component.PageHeader>
      {this.state.fetching?<div style={{textAlign:"center",marginTop:"-6rem"}}><PageLoader/></div>:
      <div style={{margin:DS.spacing.s+"rem", marginTop:"-1rem"}}>{this.state.bankConnections.map((co,i) => <BCSettingItem parent={this} key={i} data={co} />)}
        <div style={{"flexGrow":1,flexDirection: "column"}}>
          <PlaidLink style={{outline: "none",display: "block",background: "none",border: "none",padding: "0",flexGrow: "1",margin: "0",cursor: "pointer",width: "100%"}}
            clientName="React Plaid Setup" env="development" product={["auth", "transactions"]} token={this.state.newConnectionLinkToken}
            onExit={this.handleOnExit} onSuccess={this.handleOnSuccess.bind(this)} className="test"
          ><DS.component.Button.Placeholder iconName="plus"></DS.component.Button.Placeholder></PlaidLink>
        </div>
      </div>
    }
    </PageContainer>
	)}
}




const Title = styled.div`
    font-size: 2rem;
    border-bottom: solid 1px ${DS.getStyle().borderColor};
    padding-bottom: 1rem;
    font-weight: 500;
    color: #333333;
    margin-bottom: 1rem;
`

const PageContainer = styled.div`
  max-width: 600px;
    margin: auto;
`
const List = styled.ul`
  
`

const PlusButton = styled.div`
    border-radius: 1.5rem;
    border: solid black 1px;
    height: 1.5rem;
    width: 1.5rem;
    text-align: center;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    cursor: pointer;
    font-weight: 100;

    &:hover {
      background-color: #eee;
      color: white;
    }
`


class BCSettingItem extends BaseComponent{
  constructor(props) {
    super(props);
    this.state = {}  
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

  render(){
    return <DS.component.ContentTile style={{margin:DS.spacing.xs+"rem 0",padding:DS.spacing.xs+"rem",width:"auto",flexDirection:"row",justifyContent: "space-between"}}>
        <DS.component.Label highlight>{this.props.data.name}</DS.component.Label>
        <div style={{textAlign:"right"}}>
          <div style={{marginBottom:DS.spacing.xxs+"rem"}}><Status good={this.props.data.status==PlaidStatuses.ok}>{this.props.data.status==PlaidStatuses.ok?"Connected":"Needs action"}</Status></div>
          <DS.component.Label size="xs">Last updated: {utils.formatDateShort(new Date(this.props.data.lastUpdated))}</DS.component.Label> 
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