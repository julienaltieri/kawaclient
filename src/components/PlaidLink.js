import BaseComponent from './BaseComponent';
import {PlaidLink,usePlaidLink} from "react-plaid-link";
import ApiCaller from '../ApiCaller'

export default class PlaidLinkComponent extends BaseComponent {
  constructor(props) {
    super(props);

    this.state = {
      transactions: []
    };

    this.handleClick = this.handleClick.bind(this);

    
  }

  componentWillMount(){
    ApiCaller.getPlaidLinkToken().then(r => {
      this.updateState({linkToken:r.link_token})
    })
  }

  handleOnSuccess(public_token, metadata) {
    // send token to client server
    console.log(public_token) 
    console.log(metadata)
    //public-development-e55b02ee-85fc-49b9-ba92-a52c72424289
    /*axios.post("/auth/public_token", {
      public_token: public_token
    });*/
  }

  handleOnExit() {
    // handle the case when your user exits Link
    // For the sake of this tutorial, we're not going to be doing anything here.
  }

  handleClick(res) {
    console.log("click")
    ApiCaller.exchangePlaidLinkToken("public-development-81495acd-e626-40aa-9a9a-89d38150dded").then(r => console.log(r))
    /*axios.get("/transactions").then(res => {
      this.setState({ transactions: res.data });
    });*/
  }

  render() {
    return (
      <div> 
        {this.state.linkToken?<PlaidLink
          clientName="React Plaid Setup"
          env="development"
          product={["auth", "transactions"]}
          token={this.state.linkToken}
          onExit={this.handleOnExit}
          onSuccess={this.handleOnSuccess}
          className="test"
        >
          Open Link and connect your bank!
        </PlaidLink>:""}
        <div>
          <button onClick={this.handleClick}>Get Transactions</button>
        </div>
      </div>
    );
  }
}
