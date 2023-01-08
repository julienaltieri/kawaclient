import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DesignSystem from '../DesignSystem.js'
const utils = require('../utils.js');

export class FrequencyRing extends BaseComponent{
	getScaleFactor(){return 1.0}
	getConicGradient(){
		let n = Math.min(this.props.frequencies.length,this.props.subdivisions);
		let color = DesignSystem.hexToRgb(DesignSystem.getStyle().timePeriod).join(",")
		let points = [...Array(n).fill(0).map((a,i)=>{return {
			angle:i/n+"turn",
			color: "rgba("+color+","+this.props.frequencies[i%n]+")"
		}}).map(({angle,color}) => color+" "+angle),...["rgba("+color+","+this.props.frequencies[0]+")"]].join(",");
		return "conic-gradient(from "+0.5/n+"turn,"+points+")";
	}
	getMask(){
		let transition = 1, radius = 63.5, thickness = 2, fc = "#fff", ft="#fff0";
		let rs = [radius-transition-thickness/2,radius-thickness/2,radius+thickness/2,radius+thickness/2+transition], cs = [ft,fc,fc,ft];
		return "radial-gradient("+rs.map((r,i) => cs[i]+" "+r+"%").join(",")+")"
	}
	render(){
		return(
			<ProgressRingContainer style={{background: this.getConicGradient(),WebkitMask: this.getMask(),borderRadius: "100%"}}>
				<svg width="100%" height="100%" viewBox={"0 0 100 100"}/>
			</ProgressRingContainer>
		)
	}	
}


/*props: [ccw, progress, subdivisions, color, thickness, highlight]*/
export default class ProgressRing extends BaseComponent{
	getScaleFactor(){return 1.2}
	getHighlightThicknessFactor(){return 1.5}
	getSubdivisionGapAngles(){return this.props.subdivGapAngles || 0.005}
	getBackgroundColor(){return DesignSystem.getStyle().UIPlaceholder}
	shouldFlip(){return this.props.ccw}
	getRadius(){return this.props.radius/this.getScaleFactor()}
	getCircumference(){return this.getRadius()*2*Math.PI}
	getDashes(){return `${this.getCircumference()} ${this.getCircumference()}`}
	getDashOffset(x){return this.getCircumference()*(1-(this.props.subdivisions?(1+Math.floor(0.99999*x*this.props.subdivisions))/this.props.subdivisions:x))}
	getHighlightStart(){return (Math.floor(0.99999*this.props.progress*this.props.subdivisions))/this.props.subdivisions}//where the highlight should start
	getClipPath(start=0){//used to draw subdivisions
		if(!this.props.subdivisions)return;
		var angles = [], gap = this.getSubdivisionGapAngles(), r = this.getRadius(), n = this.props.subdivisions;
		var [ox,oy] = [this.props.radius/this.getScaleFactor(),this.props.radius/this.getScaleFactor()]
		const getCoordinatesForPercent = (x,rr) => [ox+rr*Math.cos(2*Math.PI*x), oy+rr*Math.sin(2*Math.PI*x)];

		//computes the positions of the arc points
		angles.push(gap/2); 
		for (var i = 1; i < n; i++) {angles = [...angles, i*1/n - gap/2 , i*1/n + gap/2]}
		angles.push(1-gap/2); 
		var index = utils.searchInsertAsc(angles, start); 
		angles = angles.slice(index,angles.length);
		var pos = angles.map(a => getCoordinatesForPercent(a,2*r)); //outer circle bound
		var lowPos = angles.map(a => getCoordinatesForPercent(a,0.1*r)); //inner circle bound
		const idx = (i,k=0) => (2*i+k)%pos.length; //index mapping function

		//create the path array
		var pathArray =  [`M ${lowPos[0][0]} ${lowPos[0][1]}`];
		for (var i = 0; i < angles.length/2; i++) {
			var xx = angles[i+1]-angles[i] //difference between two arc points
			var [a1x,a1y] = pos[idx(i)], [a2x,a2y] = pos[idx(i,1)]; //arc points
			var [o2x,o2y] = lowPos[idx(i,1)], [o3x,o3y] = lowPos[idx(i,2)]//arc points
			pathArray.push([
				`L ${a1x} ${a1y}`,`A ${2*r} ${2*r} 0 ${xx>.5?1:0} ${1} ${a2x} ${a2y}`,
				`L ${o2x} ${o2y}`,`A ${0.1*r} ${0.1*r} 0 ${xx>.5?1:0} ${1} ${o3x} ${o3y}`,
			].join(' '))
		}
		return pathArray.join(' '); 
	}
	render(){
		return(
			<ProgressRingContainer style={{transform: "scaleX("+(this.shouldFlip()?-1:1)+")"}}>
			<svg width="100%" height="100%" viewBox={"0 0 "+this.getScaleFactor()*100+" "+this.getScaleFactor()*100} preserveAspectRatio="none" style={{"transform":"rotate(-90deg)","overflow":"visible"}}>
				<AnimatedStyledCircle   r={this.getRadius()} cx="50%" cy="50%" thickness={this.props.thickness} color={this.getBackgroundColor()} 	clipPath={this.getClipPath()}/>
				<AnimatedStyledCircle 	r={this.getRadius()} cx="50%" cy="50%" thickness={this.props.thickness} color={this.props.color}			clipPath={this.getClipPath()}
										dashArray={this.getDashes()} dashOffset={this.getDashOffset(this.props.progress)}/>
				{this.props.highlightLastSubdivision?
				<AnimatedStyledCircle 	r={this.getRadius()} cx="50%" cy="50%" thickness={this.props.thickness*this.getHighlightThicknessFactor()} color={this.props.highlighColor} clipPath={this.getClipPath(this.getHighlightStart())}
										dashArray={this.getDashes()} dashOffset={this.getDashOffset(this.props.progress)}/>:""}
			</svg>
		</ProgressRingContainer>)
	}	
}

const AnimatedStyledCircle = styled.circle`
	fill: none;
    stroke: ${props => (props.color)};
    stroke-width: ${props => (props.thickness)}rem;
    stroke-dasharray: ${props => (props.dashArray)};
    stroke-dashoffset: ${props => (props.dashOffset)};
    transition: stroke-dashoffset 1s;
    clip-path: ${props => "path('"+props.clipPath+"')"};
`  
  
   
const ProgressRingContainer = styled.div`
	display: flex;
    align-items: center;
    justify-content: center;
    align-content: center;
    flex-direction:column;
    width:100%;
    height:100%;
    margin-top:-100%;
`   
