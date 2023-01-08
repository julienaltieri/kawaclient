import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import ApiCaller from '../ApiCaller'
import Core from '../core'
import {ModalTemplates} from '../ModalManager.js'
//import PlaidLinkComponent from './PlaidLink';
import {PlaidLink} from "react-plaid-link";
const utils = require('../utils.js')

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
      {this.state.fetching?<div style={{textAlign:"center",marginTop:"5rem"}}>loading...</div>:
      <div>
        <Title style={{display: "flex", justifyContent: "space-between", alignItems: "flex-end"}}>
          <div>Bank Connections</div>
          <PlusButton><div style={{"flexGrow":1,flexDirection: "column"}}><PlaidLink style={{outline: "none",display: "block",background: "none",border: "none",padding: "0",width: "100%",flexGrow: "1",margin: "0",cursor: "pointer",fontSize: "1.2rem"}}
              clientName="React Plaid Setup"
              env="development"
              product={["auth", "transactions"]}
              token={this.state.newConnectionLinkToken}
              onExit={this.handleOnExit}
              onSuccess={this.handleOnSuccess.bind(this)}
              className="test"
            >+</PlaidLink></div></PlusButton>
        </Title>
        <List>{this.state.bankConnections.map((co,i) => <BCSettingItem parent={this} key={i} data={co} />)}
        </List>
      </div>
    }
    </PageContainer>
	)}
}




const Title = styled.div`
    font-size: 2rem;
    border-bottom: solid 1px #cccccc;
    padding-bottom: 1rem;
    font-weight: 500;
    color: #333333;
    margin-bottom: 1rem;
`

const PageContainer = styled.div`
  max-width: 600px;
    margin: auto;
    margin-top: 6vh;
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

const BCListItem = styled.li`
  background: #fafafa;
    padding: 1rem;
    margin-bottom: 1rem;
    min-height: 3rem;
    border: 1px solid #dfdfdf;
    border-radius: 3px;
    display: flex;
    justify-content: center;
    flex-direction: column;
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
    return <BCListItem>
      <Row>
        <LeftColumn>
          <div style={{"fontSize":"1.2rem","fontWeight":"bold"}}>{this.props.data.name}</div>
          <Subtitle>{this.props.data.itemId}</Subtitle>
        </LeftColumn>
        <div>
          <div><span>Status:</span> <Status good={this.props.data.status==PlaidStatuses.ok}>{this.props.data.status}</Status></div>
          <Subtitle>Last updated: {utils.formatDateShort(new Date(this.props.data.lastUpdated))}</Subtitle> 
        </div>
        
        </Row>
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
    </BCListItem>
  }
}


const Subtitle = styled.div`
    color: #999999;
    font-size: 0.8rem;
    margin-top: 0.5rem;
`
const LeftColumn = styled.div`
    margin-right: 2rem;
`
const Status = styled.span`
    font-weight: bold;
    color: ${props => props.good ? "#1acb1a" : "#f40000"};
    font-size: 0.8rem;
    text-transform: uppercase;
`

const Row = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
`