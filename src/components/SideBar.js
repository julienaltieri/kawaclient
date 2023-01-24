import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DesignSystem from '../DesignSystem';


export default class SideBar extends BaseComponent{
	constructor(props) {
		super(props);
		this.state = {
			items: props.items
		}  
	}

	getActiveItem(){return this.state.items[this.props.activeIndex]}
	onClickItem(i){return this.props.onClickRoute(i.path)}

	render(){
		var count = 0;
		return(
		<SideBarContainer visible={this.props.visible}>
			<CloseButton onClick={e => this.props.onClickCloseSideBar(e)}>{DesignSystem.icon.close}</CloseButton>
			{(this.props.activeIndex>-1)?this.state.items
				.map(i => (<NavItem item={i} key={count++} parentBar={this} active={i.name==this.getActiveItem().name}/>)):""}
		</SideBarContainer>
	)}
}

const CloseButton = styled.div`
    padding-top: 1rem;
    cursor: pointer;
    text-align: left;
    margin-left: 0.4rem;
    margin-bottom: 0.8rem;
`

const SideBarContainer = styled.div`
	position: fixed;
  padding-left: 0.5rem;
  height: 100%;
  width: 15rem;
  z-index: 1;
  top: 0;
  left: 0;
  background-color: ${DesignSystem.getStyle().modalBackground};
  box-shadow: 5px -1px 20px 0px #00000029;
  overflow-x: hidden;
  transition: margin-left 225ms ease-in-out 0s;
  margin-left: ${(props) => props.visible?"0%":"-22rem"};
`



class NavItem extends BaseComponent {
  	constructor(props){
  		super(props)
  		this.state = {
  			parentBar: props.parentBar,
  			item: props.item
  		}
  	}

	handleClick(e){this.props.parentBar.onClickItem(this.props.item)}

  	render() {
	  	return (
	   		<StyledNavItem active={this.props.active}>
				<Link to={this.state.item.path} onClick={e => this.handleClick(e)}>
					{this.state.item.name}
				</Link>
			</StyledNavItem>
	   	)
  	}
}


const StyledNavItem = styled.div`
 	box-sizing: border-box;
    display:flex;
    text-align: left;
	  font-size: 1rem;
    cursor: pointer;
    width: 100%;
    margin-bottom: 0;
    padding: 0 0.7rem;
    padding-right: 1rem;
    height:3rem;
    align-items:center;
    overflow:visible;
    font-weight: ${props => props.active?"bold":"normal"};
    color: ${props => props.active?DesignSystem.getStyle().bodyText:DesignSystem.getStyle().bodyTextSecondary};
    &:hover {
      background: ${DesignSystem.getStyle().UIElementBackground};
    }  

  
`

const Link = styled.a`
    text-decoration: none;
    width:100%;
    padding: 1rem 0 ;
	  border-bottom: 1px solid ${DesignSystem.getStyle().borderColor};


`