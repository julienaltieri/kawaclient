import AppConfig from "./AppConfig";
import styled from 'styled-components';
import 'material-symbols';
const logo_light = require('./assets/logo_light.svg').default;
const logo_dark = require('./assets/logo_dark.svg').default;

const Icon = styled.span`
	font-size: 1.3rem;
	vertical-align: sub;
`
const Logo = styled.img`
    width:6rem;
`
class DesignSystem{
	UIColors = {
		green:"#27AE60",
		lightGreenTrans: "#c3fbe294",
		vividGreen: "#27ae60",
		redVivid: "#cc0000",
		redSoft: "#ca4949",
		yellow: "#d0a100",
		teal: "#00585d",
		veryLightBlue: "#d1dcff",
		lightBlue: "#59c2ff",
		blue: "#89a1f0",
		brightBlue: "#2f80ed",
		vividBlue: "#577bf2",
		lightPurple: "#e0d6ff",
		deepPurple: "#463e60",
		lightGrey1: "#fefefe",
		lightGrey2: "#f3f3f7",
		lightGrey2Trans: "#f7f7f78f",
		lightGrey3: "#eeeeee",
		lightGrey4: "#dddded",
		lightGrey5: "#babaca",
		midGrey: "#9999a9",
		darkGrey1: "#727272",
		darkGrey2: "#424252",
		darkGrey2Trans: "#52525233",
		darkGrey3: "#333343",
		darkGrey4: "#1f2223",
		black: "#000000",
		white: "#ffffff",
		darkPurple: "#191829",
		midPurple: "#19182930",
		lightPurple: "#d6e5fe"
	};
	borderRadius= "0.7rem";
	borderRadiusSmall= "0.3rem";
	barWidthRem=0.5;
	applicationMaxWidth=36;
	verticalSpacing={
		s:"1rem",
		m:"2rem",
		l:"3rem"
	}
	styles = {
		lightMode: {
			bodyText: this.UIColors.darkGrey4,
			bodyTextSecondary: this.UIColors.darkGrey2,
			buttonDisabled: this.UIColors.lightGrey5,
			borderColor: this.UIColors.midPurple,
			pageBackground: this.UIColors.lightPurple,
			timePeriod:this.UIColors.blue,
			timePeriodHighlight:this.UIColors.vividBlue,
			alert: this.UIColors.redVivid,
			positive: this.UIColors.vividGreen,
			warning: this.UIColors.yellow,
			UIPlaceholder: this.UIColors.lightGrey5,
			UIElementBackground: this.UIColors.lightGrey2Trans,
			commonTag: this.UIColors.lightGrey2Trans,
			specialTag: this.UIColors.lightGreenTrans,
			inputFieldBackground: this.UIColors.pageBackground,
			modalPrimaryButton: this.UIColors.brightBlue,
			modalSecondaryButton: this.UIColors.lightGrey1,
			modalBackground: this.UIColors.lightGrey2,
			savings: this.UIColors.vividBlue,
			income: this.UIColors.vividGreen,
			expenses: this.UIColors.redVivid,
			ultimateBackground: this.UIColors.lightGrey2,
		}, 
		darkMode: {
			bodyText: this.UIColors.lightGrey4,
			bodyTextSecondary: this.UIColors.midGrey,
			buttonDisabled: this.UIColors.darkGrey2,
			pageBackground: this.UIColors.darkPurple,
			borderColor: this.UIColors.darkGrey2,
			timePeriod:this.UIColors.blue,
			timePeriodHighlight:this.UIColors.veryLightBlue,
			alert: this.UIColors.redSoft,
			positive: this.UIColors.green,
			warning: this.UIColors.yellow,
			UIPlaceholder: this.UIColors.darkGrey1,
			UIElementBackground: this.UIColors.darkGrey2Trans,
			commonTag: this.UIColors.deepPurple,
			specialTag: this.UIColors.teal,
			inputFieldBackground: this.UIColors.darkGrey3,
			modalPrimaryButton: this.UIColors.blue,
			modalSecondaryButton: this.UIColors.darkGrey1,
			modalBackground: this.UIColors.darkGrey3,
			savings: this.UIColors.blue,
			income: this.UIColors.green,
			expenses: this.UIColors.redSoft,
			ultimateBackground: this.UIColors.black,
		}
	}
	isDarkMode(){return true && (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)}
	getMode(){return this.isDarkMode()?"darkMode":"lightMode"}
	getStyle(){return this.styles[this.getMode()]}
	rgbToHex(red, green, blue) {
	  	const rgb = (red << 16) | (green << 8) | (blue << 0);
	  	return '#' + (0x1000000 + rgb).toString(16).slice(1);
	}
	hexToRgb(hex) {
		const normal = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
		if (normal) return normal.slice(1).map(e => parseInt(e, 16));

		const shorthand = hex.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
		if (shorthand) return shorthand.slice(1).map(e => 0x11 * parseInt(e, 16));

	  	return null;
	}
	icon = {
		leftArrow:  	<Icon className="material-symbols-rounded">arrow_back</Icon>,
		rightArrow: 	<Icon className="material-symbols-rounded">arrow_forward</Icon>,
		done: 			<Icon className="material-symbols-rounded">done</Icon>,
		plus: 			<Icon className="material-symbols-rounded">add</Icon>,
		close: 			<Icon className="material-symbols-rounded">close</Icon>,
		caretDown: 		<Icon className="material-symbols-rounded">expand_more</Icon>,
		menu: 			<Icon className="material-symbols-rounded">menu</Icon>,
		undo: 			<Icon className="material-symbols-rounded">undo</Icon>,
		logo: {
			lightMode: <Logo src={logo_light}/>,
			darkMode: <Logo src={logo_dark} style={{opacity: 0.8}}/>
		}
	}
	component = {
		ListItem: (props) => <StyledListItemContainer><StyledListItem className="ListItem" {...props}>{props.children}</StyledListItem></StyledListItemContainer>,
		ScrollableList: (props) => <StyledScrollableList {...props}>{props.children}</StyledScrollableList>,
		ScrollableBottomSheet: (props) => <StyledScrollableBottomSheet {...props}><StyledScrollableList {...props}>{props.children}</StyledScrollableList></StyledScrollableBottomSheet>,
		StreamTag: (props) => <StyledStreamTag {...props}>{props.children}</StyledStreamTag>,	
	}
	spacing = {
		xs:1,
		s:1.5,
		m:2,
		l:3
	}
	fontSize = {
		body: 	1,
		header: 1.4 
	}
}

const instance = new DesignSystem();

const StyledScrollableBottomSheet = styled.div`
	max-height: calc(100vh - ${23}rem);
	overflow-y: auto;
	width: 100vw;
    margin-left: -1.5rem;
`

const StyledScrollableList = styled.div`
	
`

const StyledListItem = styled.div`
 	box-sizing: border-box;
    display:flex;
    text-align: left;
	font-size: {instance.fontSize.body}rem;
    cursor: pointer;
    width: 100%;
    margin-bottom: 0;
    height:${instance.spacing.xs*2+instance.fontSize.body}rem;
    align-items:center;
    overflow:visible;
    color: ${props => props.bolded?instance.getStyle().bodyText:instance.getStyle().bodyTextSecondary};
 	border-bottom: 1px solid ${instance.getStyle().borderColor};  
`

const StyledListItemContainer = styled.div`
	width: calc(100% - ${2*instance.spacing.s}rem);
	padding: 0 ${instance.spacing.s}rem;
    &:hover {
      background: ${instance.getStyle().UIElementBackground};
    }  
`

const StyledStreamTag = styled.div`
	background-color: ${props => props.highlight?instance.getStyle().commonTag:instance.getStyle().specialTag};
	padding: 0.2rem 0.4rem ;
	margin:0.2rem;
	border-radius: 100vw;
	opacity:0.8;
	&:hover{
		cursor:pointer;
		opacity:1;
	};
	text-overflow: ellipsis;
    text-wrap: nowrap;
    overflow-x: clip;
`


export default instance




