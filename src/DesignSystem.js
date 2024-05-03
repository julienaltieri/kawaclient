import AppConfig from "./AppConfig";
import styled from 'styled-components';
import Core from './core';
import utils from './utils';
import BaseComponent from './components/BaseComponent';
import React from "react";
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
	applicationMaxWidth=50;
	backgroundOpacity=0.15;
	inputHeight=3;
	inputHeightInline=2;
	remToPx=16;//make sure this matches the px definition in the App.css html tag font-size
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
			bodyTextLight: this.UIColors.lightGrey4,
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
			bodyTextLight: this.UIColors.lightGrey4,
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
	isDarkMode(){
		if(AppConfig.featureFlags.forceDesignMode != ""){return AppConfig.featureFlags.forceDesignMode == "darkMode"}
		return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
	}
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
		placeholder: 	<Icon></Icon>,
		leftArrow:  	<Icon className="material-symbols-rounded">arrow_back</Icon>,
		rightArrow: 	<Icon className="material-symbols-rounded">arrow_forward</Icon>,
		done: 			<Icon className="material-symbols-rounded">done</Icon>,
		plus: 			<Icon className="material-symbols-rounded">add</Icon>,
		close: 			<Icon className="material-symbols-rounded">close</Icon>,
		caretDown: 		<Icon className="material-symbols-rounded">expand_more</Icon>,
		search: 		<Icon className="material-symbols-rounded">search</Icon>,
		menu: 			<Icon className="material-symbols-rounded">menu</Icon>,
		undo: 			<Icon className="material-symbols-rounded">undo</Icon>,
		edit: 			<Icon className="material-symbols-rounded">edit</Icon>,
		more: 			<Icon className="material-symbols-rounded">more_horiz</Icon>,
		bank: 			<Icon className="material-symbols-rounded">account_balance</Icon>,
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
		Label: (props) => <StyledLabel {...props} level={props.level}>{props.children}</StyledLabel>,
		Header: (props) => <StyledLabel header={true} highlight {...props}>{props.children}</StyledLabel>,
		PageHeader: (props) => <StyledPageHeader {...props}><instance.component.Header>{props.children}</instance.component.Header></StyledPageHeader>,
		ListItem: (props) => <StyledListItemContainer disabled={props.disabled} size={props.size} noHover={props.noHover} fullBleed={props.fullBleed}><StyledListItem className="ListItem" {...props}>{props.children}</StyledListItem></StyledListItemContainer>,
		GridItem: (props) => <StyledGridItem {...props} noHover={props.noHover}>{props.children}</StyledGridItem>,
		TransactionListItem: (props) => <instance.component.ListItem noHover fullBleed size="xs" {...props}>
			<instance.component.Label style={{minWidth:"3rem"}}>{props.transaction.date.toLocaleDateString("default",{month: "2-digit", day: "2-digit"})}</instance.component.Label>
			<instance.component.Label style={{marginRight:"0.5rem"}}>{props.transaction.description}</instance.component.Label><StyledSpacer/>
			<div>{props.infoSlotComponent}</div>
			<div style={{textAlign:"right",marginLeft:"0.5rem",flexShrink:0}}>{utils.formatCurrencyAmount(props.transaction.amount,2,null,null,Core.getPreferredCurrency())}</div>
		</instance.component.ListItem>,
		Spacer: (props) => <StyledSpacer {...props}/>,
		ScrollableList: (props) => <StyledScrollableList {...props}>{props.children}</StyledScrollableList>,
		ScrollableGrid: (props) => <StyledScrollableGrid {...props}>{props.children}</StyledScrollableGrid>,
		ScrollableBottomSheet: (props) => <StyledScrollableBottomSheet {...props}><StyledScrollableList {...props}>{props.children}</StyledScrollableList></StyledScrollableBottomSheet>,
		StreamTag: (props) => <StyledStreamTag {...props}>{props.children}</StyledStreamTag>,
		Input: (props) => <DSInput {...props}/>,
		SearchBar: (props) => <DSSearchBar {...props}/>,
		InputWithLabel: (props) => <StyledFieldWithLabel><instance.component.Label smallcaps style={{textAlign:"left",margin:instance.spacing.xxs+"rem 0"}}>{props.label}</instance.component.Label><StyledInput id={props.formId} {...props}>{props.children}</StyledInput></StyledFieldWithLabel>,
		DropDown: (props) => <DSDropDown {...props}/>,
		Row: (props) => <StyledRowContainer {...props}>{props.children}</StyledRowContainer>,
		Tooltip: (props) => <StyledToolTipContainer {...props}><StyledTooltipBackdrop/><StyledArrow showAbove={props.showAbove}/>{props.children}</StyledToolTipContainer>,
		ContentTile:  (props) => <StyledContentTile {...props}>{props.children}</StyledContentTile>,
		Image: (props) => <StyledImage {...props}>{props.children}</StyledImage>,
		Avatar: (props) =>  <StyledAvatarContainer><StyledImage {...props}>{props.children}</StyledImage></StyledAvatarContainer>,
		AvatarIcon: (props) =>  <StyledAvatarContainer><StyledIcon {...props}>{instance.icon[props.iconName]}</StyledIcon></StyledAvatarContainer>,
		Loader: (props) => <StyledLoaderSuperContainer><StyledLoaderContainer><StyledLoaderWidget><div className={instance.isDarkMode()?"lds-ripple":"lds-ripple-bright"}><div></div><div></div></div></StyledLoaderWidget></StyledLoaderContainer></StyledLoaderSuperContainer>,
		Logo: (props) => <instance.component.Image src={!instance.isDarkMode()?logo_standalone_dark:logo_standalone_light} {...props}></instance.component.Image>,
		ModalTitle: (props) => <StyledModalTitle {...props}>{props.children}</StyledModalTitle>,
		SentenceWrapper:  (props) => <StyledSentenceWrapper {...props}>{
			props.children.map((c,i) => (typeof c == 'string')?c.split(" ").map((w,j) => <instance.component.Label key={i*1000+j} {...props} style={{margin:"0.4rem 0"}}>{w}&nbsp;</instance.component.Label>):c)}</StyledSentenceWrapper>,
		Button: {
			Icon: (props) => <StyledIcon {...props}><StyledButtonWrapper disabled={props.disabled}>{instance.icon[props.iconName]}</StyledButtonWrapper></StyledIcon>,
			Placeholder: (props) => <StyledPlaceholderButton><StyledButtonWrapper {...props}>{instance.icon[props.iconName]}</StyledButtonWrapper></StyledPlaceholderButton>,
			Action: (props) => <StyledButtonWrapper disabled={props.disabled}><StyledButton {...props} small={props.small} disabled={props.disabled} primary={props.primary} tertiary={props.tertiary}>{props.children[0].toUpperCase()+props.children.slice(1)}</StyledButton></StyledButtonWrapper>,
			Link: (props) => <StyledButtonWrapper><instance.component.Label  {...props} size={"xs"} >{props.children}</instance.component.Label></StyledButtonWrapper>,
		},
		ButtonGroup: (props) => <StyledButtonGroup>{props.children}</StyledButtonGroup>,
	}
	Layout = {
		PageContent: (props) => <StyledPageContent {...props}>{props.children}</StyledPageContent>,
		PageWithTitle: (props) => <instance.Layout.PageContent><instance.component.PageHeader>{props.title}</instance.component.PageHeader>{props.content?<div style={{margin:"0 "+instance.spacing.s+"rem"}}>{props.content}</div>:props.children}</instance.Layout.PageContent>
	}
	spacing = {
		xxs:0.5,
		xs:1,
		s:1.5,
		m:2,
		l:3,
		xl: 6,
		xxl: 9,
	}
	fontSize = {
		little: 0.8,
		body: 	1,
		title: 	1.2,
		header: 1.4 
	}
}

const instance = new DesignSystem();

const StyledButtonGroup = styled.div`
	width: 100%;
    align-self: flex-end;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: ${props => Core.isMobile()?"space-around":"center"};
    margin-top: ${instance.spacing.s}rem;
    flex-direction: row;
    flex-wrap: wrap-reverse;
 
`

const StyledLoaderWidget = styled.div`
  	width: 5rem;
    height: 5rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;

`

const StyledLoaderContainer = styled.div `
	width:calc(100% - 2rem);
	padding: 1rem;
	text-align: center; 
	display: flex;
	flex-direction: column;
	align-items: center;
` 

const StyledLoaderSuperContainer = styled.div `
	text-align: center; 
	display: flex;
	flex-direction: row;
	align-items: center;
    height:100%;
    flex-grow:1;
` 

const StyledAvatarContainer = styled.div`
	display: flex;
    margin-right: ${instance.spacing.xs}rem;
    aspect-ratio: 1;
    height: 80%;
    border-radius: 100%;
    overflow: hidden;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
`

const StyledPageContent = styled.div`
	width: 100%;
	max-width: ${instance.applicationMaxWidth}rem;
	display: flex;
    flex-direction: column;
    margin: auto;
    margin-top:0;
`


const StyledSentenceWrapper = styled.div`
	display: flex;
	flex-wrap: wrap;
    align-items: baseline;
`

const StyledSpacer = styled.div`
	flex-grow: ${props => props.size?0:1};
	height: ${props => props.size?instance.spacing[props.size]:"unset"}rem;
`

const StyledImage = styled.img`
	width: 100%;
	align-self: center;
`

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
	background-color: ${(props) => props.tertiary?instance.getStyle().UIElementBackground:props.primary?instance.getStyle().modalPrimaryButton:instance.getStyle().modalSecondaryButton};
	color: ${(props) => props.primary?instance.getStyle().primaryButtonTextColor:instance.getStyle().secondaryButtonTextColor};
	border-radius:  ${props => 100}rem;
	border: solid ${props => props.tertiary?0:instance.borderThickness.s}rem ${(props) =>instance.getStyle().modalPrimaryButton};
	min-height: ${props => props.small?instance.inputHeightInline:instance.inputHeight}rem;
	font-size:${props => props.small?instance.fontSize.little:instance.fontSize.title}rem;
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
	-webkit-tap-highlight-color: transparent;
	cursor: ${(props) => props.disabled?"default":"pointer"};
	color: ${(props) => instance.getStyle().bodyTextSecondary};
	display: flex;
    flex-grow: 1;
    align-items: center;
    min-width: 50%; 
    justify-content: center;
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
	height: ${props => Core.isMobile()?5:10}rem;
	display: flex;
    flex-direction: row;
    align-content: center;
    justify-content: center;
    align-items: center;
`

const DownArrow = styled.div`
    position: absolute;
    right: ${props => props.inline?0.3:0.7}rem;
    top: calc(50% - 0.55rem);
    cursor: pointer;
    pointer-events: none;
`

const StyledModalTitle = styled.div`
	flex-grow:1;
	font-size: ${instance.fontSize.header}rem;
	text-align: ${props => !props.mobileCentered && Core.isMobile()?"left":"center"};
	color: ${instance.getStyle().bodyText};
`

const StyledLabel = styled.div`
	text-overflow: ellipsis;
    text-wrap: nowrap;
    overflow-x: clip;
    color: ${(props) => {
    	if(props.level=="positive"){return instance.getStyle().positive}
    	else if(props.level=="warning"){return instance.getStyle().warning}
    	else if(props.level=="alert"){return instance.getStyle().alert}
    	else return props.highlight?instance.getStyle().bodyText:instance.getStyle().bodyTextSecondary
    }};
    font-size: ${(props) => props.smallcaps?instance.fontSize.body:props.header?instance.fontSize.header:props.size=="xs"?instance.fontSize.little:"caboose"}rem;
    font-variant: ${(props) => props.smallcaps?"all-petite-caps":""};
`

const StyledRowContainer = styled.div`
	display: flex;
    flex-direction: row;
    align-items: baseline;
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

const StyledScrollableGrid = styled.div`
	overflow-y: auto;
	overflow-x: hidden;
	display: grid;
	grid-template-columns: calc(50% - ${instance.spacing.xxs/2}rem) calc(50% - ${instance.spacing.xxs/2}rem);
	gap: ${instance.spacing.xxs}rem;

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

class DSInput extends BaseComponent {
	constructor(props){
		super(props)
		this.valueDidChange = this.valueDidChange.bind(this);
		this.inputRef = React.createRef();
	}
	componentDidMount(){this.valueDidChange()}
	valueDidChange(){
		//autosizes
		if(!this.props.autoSize){return}
		let s = this.inputRef.current.value;
		if(s.length==0){s=this.inputRef.current.placeholderValue}
		const tempSpan = document.createElement("span");
		tempSpan.style.visibility = "hidden";
		tempSpan.style.whiteSpace = "nowrap";
		tempSpan.style.position = "absolute";
		tempSpan.innerText = s;
		document.body.appendChild(tempSpan);
		this.inputRef.current.style.width = tempSpan.clientWidth+'px';
		tempSpan.parentNode.removeChild(tempSpan);
	}

	render(){return(
		<StyledInputContainer noMargin={this.props.noMargin}>
			{this.props.placeholderIcon?<instance.component.Button.Icon disabled iconName={this.props.placeholderIcon} style={{left:instance.spacing.xxs*1.5+"rem",marginTop:"0.1rem",position:"absolute"}}/>:""}
			<StyledInput leftSlot={this.props.placeholderIcon} inline={this.props.inline} highlight={this.props.highlight} type={this.props.numerical?"number":"text"} ref={this.inputRef} id={this.props.formId} {...this.props} onChange={(e) => {this.valueDidChange(e);if(this.props.onChange){this.props.onChange(e)}}}>{this.props.children}</StyledInput>
		</StyledInputContainer>
	)}
}

class DSSearchBar extends DSInput {
	constructor(props){
		super(props)
		this.state = {isEmpty:true}
		this.onTapClearCutton = this.onTapClearCutton.bind(this)
	}
	componentDidMount(){}
	onTapClearCutton(e){
		let input = this.inputRef.current
		var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		nativeInputValueSetter.call(input, '');

		var inputEvent = new Event('input', { bubbles: true});
		input.dispatchEvent(inputEvent);
	}
	valueDidChange(e){
		this.updateState({isEmpty:this.inputRef.current.value?.length==0});
	}
	render(){return(
		<StyledInputContainer noMargin={true}>
			<instance.component.Button.Icon disabled iconName={"search"} style={{left:instance.spacing.xxs*1.5+"rem",marginTop:"0.1rem",position:"absolute"}}/>
			<StyledInput leftSlot={true} rightSlot={true} ref={this.inputRef} id={this.props.formId} {...this.props} onChange={(e) => {
				this.valueDidChange(e);
				if(this.props.onChange){this.props.onChange(e)}
			}}/>
			{this.state.isEmpty?"":<instance.component.Button.Icon onClick={this.onTapClearCutton} iconName={"close"} style={{right:instance.spacing.xxs*1.5+"rem",marginTop:"0.1rem",position:"absolute"}}/>}
		</StyledInputContainer>
	)}
}

const StyledInputContainer = styled.div`
	display: flex;
    flex-direction: row;
    position: relative;
    align-items: center;
    margin-bottom: ${props => props.noMargin?0:instance.spacing.xxs}rem;
`

const StyledInput = styled.input`
    width: calc(100% - ${2*instance.spacing.xs + 2*instance.borderThickness.m}rem);
	background-color: ${(props) => (props.disabled)?"transparent":instance.getStyle().inputFieldBackground};
	color:  ${(props) => props.positive?instance.getStyle().positive:props.highlight?instance.getStyle().bodyText:instance.getStyle().bodyTextSecondary};
    padding: 0 ${(props) => props.inline?instance.spacing.xxs:instance.spacing.xs}rem; /*used for inline version*/
    padding-left: ${(props) => props.leftSlot?(instance.spacing.s+instance.spacing.xs)+"rem":"auto"}; /*used for placeholder icon*/
    padding-right: ${(props) => props.rightSlot?(instance.spacing.s+instance.spacing.xs)+"rem":"auto"}; /*used for placeholder icon*/
    height: ${(props) => (props.inline?instance.inputHeightInline:instance.inputHeight) - 2*instance.borderThickness.m}rem;
    border-radius: ${(props) => instance.borderRadiusSmall};
    text-align: ${(props) => props.textAlign || "center"};
    font-size: ${instance.fontSize.body}rem;
    border: ${(props) => instance.borderThickness.m+"rem solid "+instance.getStyle().borderColor};
    outline:none;
    &:-webkit-autofill {
		box-shadow: 0 0 0 100px ${instance.getStyle().inputFieldBackground} inset;
		-webkit-text-fill-color: ${(props) => props.positive?instance.getStyle().positive:instance.getStyle().bodyText};
    }
    ::-webkit-inner-spin-button{
        -webkit-appearance: none; 
        margin: 0; 
    }
    ::-webkit-outer-spin-button{
        -webkit-appearance: none; 
        margin: 0; 
    }
    &:focus,focus-visible{
    	border: ${(props) => instance.borderThickness.m+"rem solid "+instance.getStyle().modalPrimaryButton};
    }   
`


class DSDropDown extends BaseComponent {
	constructor(props){
		super(props)
		this.autoSize = this.autoSize.bind(this);
		this.selectRef = React.createRef();
		this.containerRef = React.createRef();
	}
	componentDidMount(){this.autoSize()}
	autoSize(){
		if(!this.props.autoSize){return}
		let s = this.selectRef.current.value;
		const tempSpan = document.createElement("span");
		tempSpan.style.visibility = "hidden";
		tempSpan.style.whiteSpace = "nowrap";
		tempSpan.style.position = "absolute";
		tempSpan.innerText = s;
		document.body.appendChild(tempSpan);
		this.containerRef.current.style.width = tempSpan.clientWidth+(instance.spacing.xs+this.props.inline?2.3:3.7)*instance.remToPx+'px';
		tempSpan.parentNode.removeChild(tempSpan);
	}

	render(){return(
		<StyledDropDownContainer ref={this.containerRef} noMargin={this.props.noMargin} autoSize={this.props.autoSize} highlight={this.props.highlight} inline={this.props.inline}>
			<StyledDropDown ref={this.selectRef} {...this.props} onChange={(e) => {this.autoSize(e);if(this.props.onChange){this.props.onChange(e)}}}>
				{this.props.children}
			</StyledDropDown>
			<DownArrow inline={this.props.inline}>{instance.icon.caretDown}
			</DownArrow>
		</StyledDropDownContainer>
	)}
}


const StyledDropDown= styled.select`
	width: 100%;
	background-color: ${instance.getStyle().inputFieldBackground};
	color: ${instance.getStyle().bodyTextSecondary};
    padding: 0 ${(props) => props.inline?instance.spacing.xxs:instance.spacing.xs}rem;
    padding-right: ${(props) => props.inline?1:2}rem;
    height: ${(props) => props.inline?instance.inputHeightInline:instance.inputHeight}rem;
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
	flex-grow: ${(props) => props.autoSize?0:1};
	margin-bottom: ${props => props.noMargin?0:instance.spacing.xxs}rem;
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

const StyledGridItem = styled.div`
 	box-sizing: border-box;
    display:flex;
    text-align: left;
	font-size: ${(props) => props.size=="xs"?instance.fontSize.little:instance.fontSize.body}rem;
    cursor: ${(props) => props.noHover?"default":"pointer"};
    width: 100%;
    margin-bottom: 0;
    background-color: ${instance.getStyle().UIElementBackground};
    height:${(props) => props.size=="xs"?(instance.spacing.xxs*2+instance.fontSize.little):(instance.spacing.s*2+instance.fontSize.body)}rem;
    align-items:center;
    overflow:visible;
    font-weight: ${props => props.bolded?600:"normal"};
    color: ${props => props.bolded?instance.getStyle().bodyText:instance.getStyle().bodyTextSecondary};
 	border: ${instance.borderThickness.s}rem solid ${instance.getStyle().borderColor};
 	border-radius: ${instance.borderRadiusSmall};
 	padding: ${instance.spacing.xxs}rem;
 	&:hover {
      background: ${(props) => props.noHover?"":instance.getStyle().UIElementBackground};
    }    
`


const StyledListItemContainer = styled.div`
	width: calc(100% - ${(props) => props.fullBleed?0:2*(props.size=="xs"?instance.spacing.xs:instance.spacing.s)}rem);
	padding: 0 ${(props) => props.fullBleed?0:props.size=="xs"?instance.spacing.xs:instance.spacing.s}rem;
	opacity: ${props => props.disabled?0.2:1};
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




