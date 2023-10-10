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
		lightGrey2: "#dfdfeb",
		lightGrey2Trans: "#f7f7f78f",
		lightGrey3: "#eeeeee",
		lightGrey4: "#dddded",
		lightGrey5: "#babaca",
		midGrey: "#9999a9",
		darkGrey1: "#727272",
		darkGrey2: "#424252",
		darkGrey2Trans: "#52527233",
		darkGrey3: "#333343",
		darkGrey4: "#29293a",
		darkGrey5: "#1f2223",
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
	backgroundOpacity=0.15;
	inputHeight=3;
	borderThickness = 0.15;
	verticalSpacing={
		s:"1rem",
		m:"2rem",
		l:"3rem"
	}
	styles = {
		lightMode: {
			bodyText: this.UIColors.darkGrey5,
			bodyTextSecondary: this.UIColors.darkGrey2,
			buttonDisabled: this.UIColors.lightGrey5,
			borderColor: this.UIColors.midPurple,
			borderColorHighlight: this.UIColors.midGrey,
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
			inputFieldBackground: this.UIColors.lightGrey2Trans,
			modalPrimaryButton: this.UIColors.brightBlue,
			modalSecondaryButton: this.UIColors.lightGrey2Trans,
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
			borderColorHighlight: this.UIColors.midGrey,
			timePeriod:this.UIColors.blue,
			timePeriodHighlight:this.UIColors.veryLightBlue,
			alert: this.UIColors.redSoft,
			positive: this.UIColors.green,
			warning: this.UIColors.yellow,
			UIPlaceholder: this.UIColors.darkGrey1,
			UIElementBackground: this.UIColors.darkGrey2Trans,
			commonTag: this.UIColors.deepPurple,
			specialTag: this.UIColors.teal,
			inputFieldBackground: this.UIColors.darkGrey4,
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
		Label: (props) => <StyledLabel {...props}>{props.children}</StyledLabel>,
		Header: (props) => <StyledLabel header={true} highlight {...props}>{props.children}</StyledLabel>,
		PageHeader: (props) => <StyledPageHeader {...props}><instance.component.Header>{props.children}</instance.component.Header></StyledPageHeader>,
		ListItem: (props) => <StyledListItemContainer size={props.size} noHover={props.noHover} fullBleed={props.fullBleed}><StyledListItem className="ListItem" {...props}>{props.children}</StyledListItem></StyledListItemContainer>,
		ScrollableList: (props) => <StyledScrollableList {...props}>{props.children}</StyledScrollableList>,
		ScrollableBottomSheet: (props) => <StyledScrollableBottomSheet {...props}><StyledScrollableList {...props}>{props.children}</StyledScrollableList></StyledScrollableBottomSheet>,
		StreamTag: (props) => <StyledStreamTag {...props}>{props.children}</StyledStreamTag>,
		Input: (props) => <StyledInput {...props}>{props.children}</StyledInput>,
		DropDown: (props) => <StyledDropDownContainer><StyledDropDown {...props}>{props.children}</StyledDropDown><DownArrow>{instance.icon.caretDown}</DownArrow></StyledDropDownContainer>,
		Row: (props) => <StyledRowContainer {...props}>{props.children}</StyledRowContainer>,
		Tooltip: (props) => <StyledToolTipContainer {...props}><StyledTooltipBackdrop/><StyledArrow showAbove={props.showAbove}/>{props.children}</StyledToolTipContainer>
	}
	spacing = {
		xxs:0.5,
		xs:1,
		s:1.5,
		m:2,
		l:3
	}
	fontSize = {
		little: 0.8,
		body: 	1,
		header: 1.4 
	}
}

const instance = new DesignSystem();


const StyledArrow = styled.div`
	position: absolute;
	width:0rem;
	height:0rem;
	top: ${props =>  props.showAbove?"auto":"-1rem"};
	bottom: ${props =>  !props.showAbove?"auto":"-1rem"};
	left: 50%;
	transform:translate(-50%);
	border-left: 0.5rem solid transparent;
 	border-right: 0.5rem solid transparent;
  	border-bottom: 0.5rem solid ${props => !props.showAbove?instance.getStyle().ultimateBackground+"60":"transparent"};
  	border-top: 0.5rem solid ${props => props.showAbove?instance.getStyle().ultimateBackground+"60":"transparent"};
  	z-index:100;
 	pointer-events: none;
`

const StyledTooltipBackdrop = styled.div`
	background: ${props => instance.getStyle().ultimateBackground+"60"};
    border-radius: ${props => instance.borderRadius};
    box-shadow: 0 0 0.5rem #00000030;
    backdrop-filter: blur(1rem);
    position:absolute;
    z-index: -1;
    left: 0rem;
    width:100%;
    height:100%;
    pointer-events: none;

`

//shouldOverrideOverflow should be used for situations where the tooltip is contained in an element that needs to be overflow hidden/scroll/clip (terminalStreamCard)
const StyledToolTipContainer = styled.div`
	position: ${props => props.shouldOverrideOverflow?"fixed":"absolute"}; 
    display: flex;
    width: max-content;
    padding: ${instance.spacing.xs}rem;
    min-width: 6rem;
    max-width: 12rem;
    left: ${props => (props.shouldOverrideOverflow?-16*(1.25+0.5*instance.barWidthRem):0) + props.x||0}px;
    top: ${props => props.y||0}px;
    transform:translate(-50% , ${props => props.showAbove?"-100%":0}) translateY(${props => (props.showAbove?-1:1)*1.25}rem);
    border-radius: ${props => instance.borderRadius};
    text-align: center;
    justify-content: center;
    flex-direction: column;
    align-items: flex-start;
    align-content: flex-start;
    z-index:99;
    font-size:${instance.fontSize.little}rem;
`


const StyledPageHeader = styled.div`
	height: 5rem;
	display: flex;
    flex-direction: row;
    align-content: center;
    justify-content: center;
    align-items: center;
`

const DownArrow = styled.div`
    position: absolute;
    right: 0.7rem;
    top: calc(50% - 0.55rem);
    cursor: pointer;
    pointer-events: none;
`

const StyledLabel = styled.div`
	text-overflow: ellipsis;
    text-wrap: nowrap;
    overflow-x: clip;
    color: ${(props) => props.highlight?instance.getStyle().bodyText:instance.getStyle().bodyTextSecondary};
    font-size: ${(props) => props.header?instance.fontSize.header:props.size=="xs"?instance.fontSize.little:"caboose"}rem;
`

const StyledRowContainer = styled.div`
	display: flex;
    flex-direction: row;
    align-items: center;
    margin-bottom: ${instance.spacing.xxs}rem;
    width:100%;
`

const StyledScrollableBottomSheet = styled.div`
	max-height: calc(100vh - ${23}rem);
	overflow-y: auto;
	width: 100vw;
    margin-left: -1.5rem;
`

const StyledScrollableList = styled.div`
	overflow-y: auto;
	overflow-x: hidden;
	::-webkit-scrollbar {
    	width: ${props => (instance.barWidthRem+"rem")}
    }
	::-webkit-scrollbar-track {
		box-shadow: inset 0 0 0.5rem rgba(0, 0, 0, 0.3);
		border-radius: 1rem;
	}
	::-webkit-scrollbar-thumb {
	  	background-color: ${props => instance.getStyle().bodyTextSecondary};
	 	outline: none;
 		border-radius: 1rem;
	}
	::-webkit-scrollbar-corner {background: rgba(0,0,0,0.5)}
`

const StyledInput = styled.input`
    width: calc(100% - ${instance.spacing.xs*2+instance.borderThickness}rem);
	background-color: ${(props) => props.disabled?"transparent":instance.getStyle().inputFieldBackground};
	color:  ${(props) => props.positive?instance.getStyle().positive:"inherit"};
    padding: 0 ${instance.spacing.xs}rem;
    height: ${instance.inputHeight - 2*instance.borderThickness}rem;
    border-radius: ${instance.borderRadiusSmall};
    text-align: ${(props) => props.textAlign || "center"};
    font-size: ${instance.fontSize.body}rem;
    border: ${instance.borderThickness}rem solid ${instance.getStyle().borderColor};
`

const StyledDropDown= styled.select`
	width: 100%;
	background-color: ${instance.getStyle().inputFieldBackground};
	color: ${instance.getStyle().bodyTextSecondary};
    padding: 0 ${instance.spacing.xs}rem;
    padding-right: 2rem;
    height: ${instance.inputHeight}rem;
    border-radius: ${instance.borderRadiusSmall};
    text-align: left;
    font-size: ${instance.fontSize.body}rem;
    border: ${instance.borderThickness}rem solid ${instance.getStyle().borderColor};
    cursor: pointer;
    appearance: none;
    text-overflow: ellipsis;
    white-space: nowrap;
`
const StyledDropDownContainer = styled.div`
	position: relative;
	flex-grow: 1;
`


const StyledListItem = styled.div`
 	box-sizing: border-box;
    display:flex;
    text-align: left;
	font-size: ${(props) => props.size=="xs"?instance.fontSize.little:instance.fontSize.body}rem;
    cursor: ${(props) => props.noHover?"default":"pointer"};
    width: 100%;
    margin-bottom: 0;
    height:${(props) => props.size=="xs"?(instance.spacing.xxs*2+instance.fontSize.little):(instance.spacing.xs*2+instance.fontSize.body)}rem;
    align-items:center;
    overflow:visible;
    font-weight: ${props => props.bolded?600:"normal"};
    color: ${props => props.bolded?instance.getStyle().bodyText:instance.getStyle().bodyTextSecondary};
 	border-bottom: 1px solid ${instance.getStyle().borderColor};  
`

const StyledListItemContainer = styled.div`
	width: calc(100% - ${(props) => props.fullBleed?0:2*(props.size=="xs"?instance.spacing.xs:instance.spacing.s)}rem);
	padding: 0 ${(props) => props.fullBleed?0:props.size=="xs"?instance.spacing.xs:instance.spacing.s}rem;
    &:hover {
      background: ${(props) => props.noHover?"":instance.getStyle().UIElementBackground};
    }  
`

const StyledStreamTag = styled.div`
	background-color: ${props => props.highlight?instance.getStyle().commonTag:instance.getStyle().specialTag};
	padding: 0.2rem 0.4rem ;
	margin:0.2rem;
	border-radius: 100vw;
	opacity:0.8;
	&:hover{
		cursor: ${(props) => props.noHover?"default":"pointer"};
		opacity: ${(props) => props.noHover?0.8:1};
	};
	text-overflow: ellipsis;
    text-wrap: nowrap;
    overflow-x: clip;
    flex-shrink: 0;
`


export default instance




