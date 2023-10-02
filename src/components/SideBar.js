import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DesignSystem from '../DesignSystem';


export default class SideBar extends BaseComponent{
	constructor(props) {
		super(props);
		this.state = {
			items: props.items,
      visible: false
		}  
	}

	getActiveItem(){return this.state.items[this.props.activeIndex]}
	onClickItem(e,i){return this.props.onClickRoute(e,i.path)}
	render(){
		var count = 0;
		return(
		<SideBarContainer>
      <DesignSystem.component.ScrollableList>
  			<CloseButton onClick={e => this.props.onClickCloseSideBar(e)}>{DesignSystem.icon.close}</CloseButton>
  			{(this.props.activeIndex>-1)?this.state.items
  				.map(i => (<NavItem item={i} key={count++} parentBar={this} active={i.name==this.getActiveItem().name}/>)):""}
		  </DesignSystem.component.ScrollableList>
    </SideBarContainer>
	)}
}

const CloseButton = styled.div`
    padding-top: 1.3rem;
    cursor: pointer;
    text-align: right;
    margin-right: 1.3rem;
    margin-bottom: 0.8rem;
`

const SideBarContainer = styled.div`
	position: fixed;
  height: 100vh;
  width: 100%;
  z-index: 1;
  top: 0;
  left: 0;
  background-color: ${DesignSystem.getStyle().modalBackground};
  box-shadow: 5px -1px 20px 0px #00000029;
  overflow-x: hidden;
`



class NavItem extends BaseComponent {
  	constructor(props){
  		super(props)
  		this.state = {
  			parentBar: props.parentBar,
  			item: props.item
  		}
  	}

	handleClick(e){this.props.parentBar.onClickItem(e,this.props.item)}

  	render() {
	  	return (
	   		<DesignSystem.component.ListItem bolded={this.props.active}>
				<Link to={this.state.item.path} onClick={e => this.handleClick(e)}>
					{this.state.item.name}
				</Link>
			</DesignSystem.component.ListItem>
	   	)
  	}
}

const Link = styled.a`
    text-decoration: none;
    width:100%;
    padding: 1rem 0 ;
	  border-bottom: 1px solid ${DesignSystem.getStyle().borderColor};


`