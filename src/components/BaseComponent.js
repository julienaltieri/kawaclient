import React from "react"


//default override of react component

export default class App extends React.Component{
	updateState(changes,afterCallback){
		return new Promise((res,rej) => {
			this.setState({...this.state,...changes},() => {res();if(afterCallback)afterCallback.bind(this)()})
		})
	}		

}