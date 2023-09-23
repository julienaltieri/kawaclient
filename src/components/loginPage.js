import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import Cookies from 'js-cookie'
import Core from '../core.js'
import ApiCaller from '../ApiCaller'

export default class LoginPage extends BaseComponent{

	constructor(props){
		super(props);
		this.state={username:{value:"julioo.altieri@gmail.com"},password:{value:"az12AZ!!"}}
		this.submitCredentials = this.submitCredentials.bind(this);
	}

	render(){
	return(
	  <LoginForm onSubmit={this.submitCredentials}><Title>Sign In</Title>
	  	<InputFieldWithLabel label="email" data={this.state.username}/>
	  	<InputFieldWithLabel label="password" data={this.state.password} isPassword="true"/>
	  	<Button onClick={this.submitCredentials} text="Log in"/>
	  </LoginForm>
	);
	}

	submitCredentials(e){
		e.preventDefault();
		ApiCaller.authenticate(this.state.username.value,this.state.password.value).then(res => {
			if(res===undefined){
				console.log("error: empty response from /login")
				Core.setLoggedIn(false);
			}else if(res.code!==undefined){
				console.log("error: "+res.message);
				Core.setLoggedIn(false);
			}else{
				Cookies.set("token",res);
				ApiCaller.setToken(res);
				Cookies.set("username",this.state.username.value);
				Core.setLoggedIn(true);
			}
		}).catch(err => {
			console.log("error: "+err);
			Core.setLoggedIn(false);
		})
	}
}

class Button extends BaseComponent{
	render(){
		return(
			<StyledButton type="submit" onClick={this.props.onClick}>{this.props.text}</StyledButton>
		)
	}
}

class InputFieldWithLabel extends BaseComponent{
	constructor(props){
		super(props);
		this.inputValue = this.props.data
		this.handleChange = this.handleChange.bind(this);
	}
	handleChange(event){
		this.inputValue.value=event.target.value;
	}
	render(){
		return(
			<InputContainer>
				<Label>{this.props.label}</Label>
				<Input autocomplete={this.props.label} onChange={this.handleChange} type={this.props.isPassword?"password":""}/>
			</InputContainer>
		)
	}
}


const LoginForm = styled.form`
    background: transparent;
    border-radius: 7px;
    border: 1px solid #00afff;
    margin: auto;
    padding: 3em 1em;
    max-width: 20rem;
    margin-top: calc(50vh - 18rem);
    text-align: center;
`

const Title = styled.div`
margin-bottom: 2rem;
font-weight: bold;
`



const StyledButton = styled.button`
display: block;
margin: auto;
padding: 1rem;
margin-top: 2rem;
width: 80%;
border-radius: 5px;
border: none;
color: white;
background: #00afff;
cursor: pointer;
font-weight: bold;
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

const Label = styled.div`
    text-align: left;
    font-variant: all-petite-caps;
    color: grey;
`