import AppConfig from "./AppConfig";
import styled from 'styled-components';
import Core from './core';
import utils from './utils';
import 'material-symbols';
const logo_light = require('./assets/logo_light.svg').default;
const logo_dark = require('./assets/logo_dark.svg').default;
const logo_standalone_light = require('./assets/logo_standalone_light.svg').default;
const logo_standalone_dark = require('./assets/logo_standalone_dark.svg').default;

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
		veryDarkPurple: "#191829",
		darkPurple: "#4b4b7f",
		midPurple: "#19182930",
		lightPurple: "#d6d8fe",
	};
	borderRadius= "0.7rem";
	borderRadiusSmall= "0.3rem";
	barWidthRem=0.5;
	applicationMaxWidth=36;
	backgroundOpacity=0.15;
	inputHeight=3;
	borderThickness = {
		s:0.1,
		m:0.15,
	};
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
			modalPrimaryButton: this.UIColors.darkPurple,
			primaryButtonTextColor: this.UIColors.lightGrey4, 
			modalSecondaryButton: "none",
			secondaryButtonTextColor: this.UIColors.darkPurple, 
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
			pageBackground: this.UIColors.veryDarkPurple,
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
			modalPrimaryButton: this.UIColors.lightPurple,
			primaryButtonTextColor: this.UIColors.darkGrey5, 
			modalSecondaryButton: "none",
			secondaryButtonTextColor: this.UIColors.lightGrey4, 
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
			darkMode: <Logo src={logo_dark} style={{opacity: 0.8}}/>,
			badge: {
				lightMode: <Logo src={logo_standalone_light}/>,
				darkMode: <Logo src={logo_standalone_dark} style={{opacity: 0.8}}/>
			}
		},
	}
	component = {
		Label: (props) => <StyledLabel {...props}>{props.children}</StyledLabel>,
		Header: (props) => <StyledLabel header={true} highlight {...props}>{props.children}</StyledLabel>,
		PageHeader: (props) => <StyledPageHeader {...props}><instance.component.Header>{props.children}</instance.component.Header></StyledPageHeader>,
		ListItem: (props) => <StyledListItemContainer size={props.size} noHover={props.noHover} fullBleed={props.fullBleed}><StyledListItem className="ListItem" {...props}>{props.children}</StyledListItem></StyledListItemContainer>,
		TransactionListItem: (props) => <instance.component.ListItem noHover fullBleed size="xs" {...props}>
			<instance.component.Label style={{minWidth:"3rem"}}>{props.transaction.date.toLocaleDateString("default",{month: "2-digit", day: "2-digit"})}</instance.component.Label>
			<instance.component.Label style={{marginRight:"0.5rem"}}>{props.transaction.description}</instance.component.Label><Spacer/>
			<div>{props.infoSlotComponent}</div>
			<div style={{maxWidth:"3rem",textAlign:"right",marginLeft:"0.5rem",flexShrink:0}}>{utils.formatCurrencyAmount(props.transaction.amount,0,null,null,Core.getPreferredCurrency())}</div>
		</instance.component.ListItem>,
		ScrollableList: (props) => <StyledScrollableList {...props}>{props.children}</StyledScrollableList>,
		ScrollableBottomSheet: (props) => <StyledScrollableBottomSheet {...props}><StyledScrollableList {...props}>{props.children}</StyledScrollableList></StyledScrollableBottomSheet>,
		StreamTag: (props) => <StyledStreamTag {...props}>{props.children}</StyledStreamTag>,
		Input: (props) => <StyledInput type={props.numerical?"number":"text"} id={props.formId} {...props}>{props.children}</StyledInput>,
		InputWithLabel: (props) => <StyledFieldWithLabel><instance.component.Label smallcaps style={{textAlign:"left",margin:instance.spacing.xxs+"rem 0"}}>{props.label}</instance.component.Label><StyledInput id={props.formId} {...props}>{props.children}</StyledInput></StyledFieldWithLabel>,
		DropDown: (props) => <StyledDropDownContainer><StyledDropDown {...props}>{props.children}</StyledDropDown><DownArrow>{instance.icon.caretDown}</DownArrow></StyledDropDownContainer>,
		Row: (props) => <StyledRowContainer {...props}>{props.children}</StyledRowContainer>,
		Tooltip: (props) => <StyledToolTipContainer {...props}><StyledTooltipBackdrop/><StyledArrow showAbove={props.showAbove}/>{props.children}</StyledToolTipContainer>,
		ContentTile:  (props) => <StyledContentTile {...props}>{props.children}</StyledContentTile>,
		Image: (props) => <StyledImage {...props}>{props.children}</StyledImage>,
		Logo: (props) => <instance.component.Image src={!instance.isDarkMode()?logo_standalone_dark:logo_standalone_light} {...props}></instance.component.Image>,
		SentenceWrapper:  (props) => <StyledSentenceWrapper {...props}>{props.children.map(c => (typeof c == 'string')?c.split(" ").map(w => <instance.component.Label style={{margin:"0.4rem 0"}}>{w}&nbsp;</instance.component.Label>):c)}</StyledSentenceWrapper>,
		Button: {
			Icon: (props) => <StyledIcon><StyledButtonWrapper {...props}>{instance.icon[props.iconName]}</StyledButtonWrapper></StyledIcon>,
			Placeholder: (props) => <StyledPlaceholderButton><StyledButtonWrapper {...props}>{instance.icon[props.iconName]}</StyledButtonWrapper></StyledPlaceholderButton>,
			Action: (props) => <StyledButtonWrapper disabled={props.disabled}><StyledButton {...props}  disabled={props.disabled} primary={props.primary}>{props.children}</StyledButton></StyledButtonWrapper>,
		}
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
		title: 	1.2,
		header: 1.4 
	}
}

const instance = new DesignSystem();



const StyledSentenceWrapper = styled.div`
	display: flex;
	flex-wrap: wrap;
    align-items: center;
`

const Spacer = styled.div`
	flex-grow:1;
`

const StyledImage = styled.img``

const StyledFieldWithLabel = styled.div`
	display: flex;
    flex-direction: column;
    align-content: flex-start;
    align-items: flex-start;
    margin-bottom: ${instance.spacing.xs}rem;
`

const StyledPlaceholderButton = styled.div`
	border-radius:  ${props => instance.borderRadius};
	height: 4rem;
	display: flex;
    flex-direction: column;
    align-content: center;
    justify-content: center;
    align-items: center;
    opacity: 0.8;
    border: ${instance.borderThickness.s}rem solid ${instance.getStyle().modalPrimaryButton};
    &:hover{
    	background-color: ${instance.getStyle().UIElementBackground};
    }

`


const StyledButton = styled.div`
	background-color: ${(props) => props.primary?instance.getStyle().modalPrimaryButton:instance.getStyle().modalSecondaryButton};
	color: ${(props) => props.primary?instance.getStyle().primaryButtonTextColor:instance.getStyle().secondaryButtonTextColor};
	border-radius:  ${props => 100}rem;
	border: solid ${instance.borderThickness.s}rem ${(props) =>instance.getStyle().modalPrimaryButton};
	min-height: ${instance.inputHeight}rem;
	font-size:${instance.fontSize.title}rem;
	opacity: ${(props) => props.disabled?0.5:0.9};
	display: flex;
	margin: 0 ${instance.spacing.xxs}rem;
	flex-grow: 1;
    flex-direction: column;
    justify-content: center;
    align-content: center;
    align-items: center;
    padding: 0 ${instance.spacing.xs}rem;
    &:hover {
	    opacity: ${(props) => props.disabled?"0.5":1};
	}
`
const StyledIcon = styled.div`
	width: ${(props) => instance.spacing.s}rem;
`

const StyledButtonWrapper = styled.div`
	cursor: ${(props) => props.disabled?"default":"pointer"};
	color: ${(props) => instance.getStyle().bodyTextSecondary};
	display: flex;
    flex-grow: 1;
    align-items: center;
    min-width: 50%; 
`

const FlexColumn = styled.div`
	position:relative;
    display: flex;
    flex-direction: column;
    align-content: stretch;
    justify-content: flex-start;
    align-items: center;
    height: 100%;
    width:100%;
`
const StyledContentTile = styled(FlexColumn)`
	background: ${props => instance.getStyle().UIElementBackground};
	position:inherit;
    justify-content: space-between;
    flex-grow: 0;
    padding: ${props => instance.spacing.xs/2}rem;
    border-radius: ${props => instance.borderRadius};
    margin: ${props => instance.spacing.xs/2}rem;
`


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
    font-size: ${(props) => props.smallcaps?instance.fontSize.body:props.header?instance.fontSize.header:props.size=="xs"?instance.fontSize.little:"caboose"}rem;
    font-variant: ${(props) => props.smallcaps?"all-petite-caps":""};
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
    width: calc(100% - ${instance.spacing.xs*2+instance.borderThickness.m}rem);
	background-color: ${(props) => props.disabled?"transparent":instance.getStyle().inputFieldBackground};
	color:  ${(props) => props.positive?instance.getStyle().positive:"inherit"};
    padding: 0 ${instance.spacing.xs}rem;
    height: ${instance.inputHeight - 2*instance.borderThickness.m}rem;
    border-radius: ${instance.borderRadiusSmall};
    text-align: ${(props) => props.textAlign || "center"};
    font-size: ${instance.fontSize.body}rem;
    border: ${instance.borderThickness.m}rem solid ${instance.getStyle().borderColor};
    &:-webkit-autofill {
		box-shadow: 0 0 0 100px ${instance.getStyle().inputFieldBackground} inset;
		-webkit-text-fill-color: ${(props) => props.positive?instance.getStyle().positive:instance.getStyle().bodyText};
    }
    
    

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
    border: ${instance.borderThickness.m}rem solid ${instance.getStyle().borderColor};
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
 	border-bottom: ${instance.borderThickness.s}rem solid ${instance.getStyle().borderColor};  
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




