import BaseComponent from './BaseComponent';
import styled from 'styled-components'
import Core from '../core.js'
import ApiCaller from '../ApiCaller'
import Biometrics from '../Biometrics'
import DS from '../DesignSystem'
import PageLoader from './PageLoader'

export default class LoginPage extends BaseComponent{
	constructor(props){
		super(props);
		this.state={loading:false,canUnlock:false}
		this.submitCredentials = this.submitCredentials.bind(this);
		this.unlock = this.unlock.bind(this);
	}

	/*The fingerprint affordance appears only when all three of its preconditions hold: the device can
	  verify its owner, a credential is enrolled, and there is a session for it to release. Anything
	  less and there is no glyph, rather than a glyph that fails when tapped.
	  The unlock is also attempted immediately, so the common case is one biometric prompt and no tap.
	  Where a browser refuses that without a user gesture, the glyph is already on screen to retry.*/
	componentDidMount(){
		if(!(Biometrics.isEnrolled() && ApiCaller.hasStoredSession())){return}
		Biometrics.isAvailable().then(available => {
			if(!available){return}
			this.updateState({canUnlock:true})
			this.unlock()
		})
	}

	unlock(){
		Core.unlockWithBiometrics().catch(err => console.log("biometric unlock not completed: "+err))
	}

	/*Enrolment has no Kawa-authored UI. The platform's own prompt is what asks, and it explains itself
	  better than a screen of ours could.
	  Whatever was stored is discarded first. Reaching the password means the fingerprint path was
	  either never set up or did not work — a credential goes stale if the device's biometrics are
	  reset — and the gate in Core fires on enrolment alone, so a dead credential would otherwise lock
	  you into typing the password at every launch. Replacing it here makes that self-healing. Password
	  logins are rare enough that always re-offering costs nothing.*/
	offerBiometricEnrolment(username){
		Biometrics.forget()
		Biometrics.isAvailable().then(available => {if(available){Biometrics.enroll(username)}})
	}

	render(){
		return(this.state.loading?<PageLoader/>:<TitlePage>
		  <DS.component.Logo style={{width:"10rem"}}/>
		  <LoginForm onSubmit={this.submitCredentials}>
		  	<div style={{padding:"1rem"}}>
		  		<div style={{marginTop:"2rem",marginBottom:"3rem"}} >
				  	<DS.component.InputWithLabel formId={"username"} style={{textAlign:"left"}} label="email"/>
				  	<DS.component.InputWithLabel formId={"password"} style={{textAlign:"left"}} label="password" type="password"
				  		rightIcon={this.state.canUnlock?"fingerprint":undefined} onTapRightIcon={this.unlock}/>
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
				//username is stored because Cognito needs it to rebuild the user when spending the refresh token
				ApiCaller.setSession({username:username,accessToken:res.accessToken,refreshToken:res.refreshToken});
				this.offerBiometricEnrolment(username);
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
