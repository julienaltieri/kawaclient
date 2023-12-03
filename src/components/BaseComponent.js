import React from "react"


//default override of react component

export default class App extends React.Component{
	updateState(changes,afterCallback){
		return new Promise((res,rej) => {
			this.setState({...this.state,...changes},() => {res();if(afterCallback)afterCallback.bind(this)()})
		})
	}		
	isWithinBoundOfReactRef = (x,y,reactRef) => {
		if(!reactRef?.current){return false}
		let h = reactRef.current.offsetHeight, w = reactRef.current.offsetWidth, y0 = reactRef.current.offsetTop, x0 = reactRef.current.offsetLeft; 
		return (y-y0)*(y0+h-y) > 0 && (x-x0)*(x0+w-x) > 0 	
	} 
}