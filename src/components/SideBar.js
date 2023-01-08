import BaseComponent from './BaseComponent';
import styled from 'styled-components'


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
			<CloseButton onClick={e => this.props.onClickCloseSideBar(e)}>✕</CloseButton>
			{(this.props.activeIndex>-1)?this.state.items
				.map(i => (<NavItem item={i} key={count++} parentBar={this} active={i.name==this.getActiveItem().name}/>)):""}
		</SideBarContainer>
	)}
}

const CloseButton = styled.div`
    font-size: 1.3rem;
    padding: 0.7rem;
    cursor: pointer;
    text-align: left;
    margin-left: 0.5rem;
    margin-bottom: 1rem;
`

const SideBarContainer = styled.div`
	position: fixed;
    height: 100%;
    width: 20rem;
    z-index: 1;
    top: 0;
    left: 0;
    background-color: #fff;
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
    font-weight: bold;
    cursor: pointer;
    width: 100%;
    margin-bottom: 0;
    padding: 0 1.2rem;
    height:3rem;
    align-items:center;
    overflow:visible;
    color: ${props => props.active?"#0095ff":"black"};
    &:hover {
      background: #eeeeee;
    }  

  
`

const Link = styled.a`
    text-decoration: none;
    width:100%;
    padding: 1rem 0 ;
	border-bottom: 1px solid #dddddd;


`