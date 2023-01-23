import AppConfig from "./AppConfig";
import styled from 'styled-components';
import 'material-symbols';


const Icon = styled.span`
	font-size: 1.3rem;
	vertical-align: sub;
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
		lightGrey4: "#dddddd",
		lightGrey5: "#bababa",
		midGrey: "#999999",
		darkGrey1: "#727272",
		darkGrey2: "#525252",
		darkGrey2Trans: "#52525233",
		darkGrey3: "#333339",
		darkGrey4: "#1f2223",
		black: "#000000",
		white: "#ffffff",
	};
	borderRadius= "0.7rem";
	borderRadiusSmall= "0.3rem";
	barWidthRem=0.5;
	styles = {
		lightMode: {
			bodyText: this.UIColors.darkGrey4,
			bodyTextSecondary: this.UIColors.darkGrey2,
			buttonDisabled: this.UIColors.lightGrey5,
			pageBackground: this.UIColors.lightGrey1,
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
			expenses: this.UIColors.redVivid,
			ultimateBackground: this.UIColors.lightGrey2,
		}, 
		darkMode: {
			bodyText: this.UIColors.lightGrey4,
			bodyTextSecondary: this.UIColors.midGrey,
			buttonDisabled: this.UIColors.darkGrey2,
			pageBackground: this.UIColors.darkGrey4,
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
			expenses: this.UIColors.redSoft,
			ultimateBackground: this.UIColors.black,
		}
	}
	isDarkMode(){return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)}
	getStyle(){return this.styles[this.isDarkMode()?"darkMode":"lightMode"]}
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
	}

}

const instance = new DesignSystem();

export default instance




