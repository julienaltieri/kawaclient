import React from "react";
import ReactDOM from 'react-dom';
import App from './App';
import Core from './core'
import TestRoutine from './clientTestRoutine'
import AppConfig from "./AppConfig";


function start(){
	Core.init().then(() => {
		ReactDOM.render(<App/>,document.getElementById('root'));
		TestRoutine.start();
	}).catch(e => console.error(e));
}


start();