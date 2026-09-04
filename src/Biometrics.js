/*Local biometric unlock, built on WebAuthn with a platform authenticator.

  What this is, and what it is not: the fingerprint never leaves the device and never reaches Kawa or
  Cognito. A successful assertion is the device reporting that it verified its owner; Kawa then allows
  the stored refresh token to be spent. Nothing server-side verifies the assertion, so this stops
  someone holding an unlocked phone from opening Kawa. It is not protection against script injection or
  against someone with devtools and physical access.

  See client/documentation/authentication.md for the trade and the two ways out of it.*/

const CREDENTIAL_KEY = "kawa.biometricCredential"

function toB64url(buf){
	return btoa(String.fromCharCode.apply(null,new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")
}
function fromB64url(s){
	const p = s.replace(/-/g,"+").replace(/_/g,"/")
	const bin = atob(p + "=".repeat((4 - p.length%4)%4))
	return Uint8Array.from(bin, c => c.charCodeAt(0))
}
function challenge(){return window.crypto.getRandomValues(new Uint8Array(32))}

const Biometrics = {
	/*Capability, not device class. "Is this a phone" and "can this device sign a WebAuthn challenge
	  after verifying its owner" are different questions, and only the second predicts whether the
	  affordance works when tapped. It also picks up Touch ID on a laptop for free.*/
	isAvailable(){
		if(!window.PublicKeyCredential || !window.isSecureContext || !navigator.credentials){return Promise.resolve(false)}
		return window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)
	},
	getCredentialId(){try{return window.localStorage.getItem(CREDENTIAL_KEY)}catch(e){return null}},
	isEnrolled(){return !!this.getCredentialId()},

	/*The prf extension is requested even though nothing reads it yet. Asking now costs nothing, and
	  without it, encrypting the refresh token at rest later would mean re-enrolling the credential.*/
	enroll(username){
		return navigator.credentials.create({publicKey:{
			challenge: challenge(),
			rp: {name:"Kawa", id: window.location.hostname},
			user: {id: new TextEncoder().encode(username), name: username, displayName: username},
			pubKeyCredParams: [{type:"public-key",alg:-7},{type:"public-key",alg:-257}],
			authenticatorSelection: {authenticatorAttachment:"platform",userVerification:"required",residentKey:"preferred"},
			extensions: {prf:{}},
			timeout: 60000
		}}).then(cred => {
			window.localStorage.setItem(CREDENTIAL_KEY,toB64url(cred.rawId))
			return true
		}).catch(e => {
			/*A refusal stores nothing, so no credential exists, so the gate stays off and the session
			  restores as it did before Phase 2. Declining costs the user nothing but the prompt.*/
			console.log("biometric enrolment not completed: "+e)
			return false
		})
	},

	unlock(){
		const id = this.getCredentialId()
		if(!id){return Promise.reject(new Error("no biometric credential"))}
		return navigator.credentials.get({publicKey:{
			challenge: challenge(),
			allowCredentials: [{type:"public-key",id:fromB64url(id)}],
			userVerification: "required",
			timeout: 60000
		}}).then(assertion => {
			if(!assertion){throw new Error("biometric unlock failed")}
			return true
		})
	},

	forget(){
		try{window.localStorage.removeItem(CREDENTIAL_KEY)}catch(e){console.log(e)}
	}
}

export default Biometrics
