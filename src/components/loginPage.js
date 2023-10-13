import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import Cookies from 'js-cookie'
import Core from '../core.js'
import ApiCaller from '../ApiCaller'
import DS from '../DesignSystem'
import PageLoader from './PageLoader'

export default class LoginPage extends BaseComponent{
	constructor(props){
		super(props);
		this.state={loading:false} 
		this.submitCredentials = this.submitCredentials.bind(this);
	}

	render(){
		return(this.state.loading?<PageLoader/>:<TitlePage>
		  <DS.component.Logo style={{width:"10rem"}}/>
		  <LoginForm onSubmit={this.submitCredentials}>
		  	<div style={{padding:"1rem"}}>
		  		<div style={{marginTop:"2rem",marginBottom:"3rem"}} >
				  	<DS.component.InputWithLabel formId={"username"} style={{textAlign:"left"}} label="email"/>
				  	<DS.component.InputWithLabel formId={"password"} style={{textAlign:"left"}} label="password" type="password"/>
			  	</div>
			  	<DS.component.Button.Action type="submit" primary onClick={this.submitCredentials}>Log In</DS.component.Button.Action>
		  	</div>
		  </LoginForm>
		  </TitlePage>
		)
	}

	submitCredentials(e){
		e.preventDefault();
		this.updateState({loading:true});
		let username = document.getElementById("username").value;
		let password = document.getElementById("password").value;
		ApiCaller.authenticate(username,password).then(res => {
			if(res===undefined){
				console.log("error: empty response from /login")
				Core.setLoggedIn(false);
			}else if(res.code!==undefined){
				console.log("error: "+res.message);
				Core.setLoggedIn(false);
			}else{
				Cookies.set("token",res);
				ApiCaller.setToken(res);
				Cookies.set("username",username);
				Core.setLoggedIn(true);
			}
		}).catch(err => {
			console.log("error: "+err);
			Core.setLoggedIn(false);
		})
	}
}


const LoginForm = styled.form` 
    background: transparent;
    margin: auto;
    padding: 0rem 1rem;
    padding-bottom: 1rem;
    max-width: 20rem;
    width: 80vw;
    margin-top: 2rem;
    text-align: center;
`

const TitlePage = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 4rem;
`




const Input = styled.input`
display: block;
margin: auto;
padding: 1rem;
margin-top: 0.5rem;
width: 100%;
border-radius: 5px;
border: 1px solid grey;
box-sizing: border-box;
font-size: 1.2rem;
`

const InputContainer = styled.div`
display: block;
margin: auto;
padding: 1rem;
margin-top: 0rem;
width: 80%;
position: relative;
`
