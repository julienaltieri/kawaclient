import styled from 'styled-components'
import DesignSystem from '../DesignSystem.js'
import BaseComponent from './BaseComponent'
//TO DEPRECATE IN FAVOR OF THE DS LOADER
export default class PageLoader extends BaseComponent{
	render(){
		return <LoaderContainer>
			<Loader>
				<div className={DesignSystem.isDarkMode()?"lds-ripple":"lds-ripple-bright"}>
					<div></div><div></div>
				</div>
			</Loader>
		</LoaderContainer>
	}
}



const Loader = styled.div`
  width: 5rem;
    height: 5rem;
    display: flex;
    margin-top:  calc(50vh - 6rem);;
    flex-direction: column;
    justify-content: center;
    align-items: center;

`

const LoaderContainer = styled.div `
  width:calc(100% - 2rem);
  padding: 1rem;
  text-align: center; 
    display: flex;
    flex-direction: column;
    align-items: center;
` 