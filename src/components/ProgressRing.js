import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DesignSystem from '../DesignSystem.js'
import utils from '../utils'

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


/*props: [ccw, progress, subdivisions, color, thickness, highlight, highlightColor]*/
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

	getDashedCircle(start = 0, end = 1, radius = 50, thickness = 10, color = "black") {
	  
		// With subdivisions
		const n = this.props.subdivisions;
		const gap = this.getSubdivisionGapAngles(); // fraction of circle per gap
		const cx = 50 * this.getScaleFactor();
		const cy = 50 * this.getScaleFactor();
		const circumference = 2 * Math.PI * radius;
	  
		const circles = [];
	  
		for (let i = 0; i < n; i++) {
		  let subStart = i / n + gap / 2;
		  let subEnd = (i + 1) / n - gap / 2;
	  
		  // skip if outside requested range
		  if (subEnd <= start || subStart >= end) continue;
	  
		  // clamp subdivision to [start, end]
		  subStart = Math.max(subStart, start);
		  subEnd = Math.min(subEnd, end);
	  
		  const arcLength = (subEnd - subStart) * circumference;
		  const dashArray = `${arcLength} ${circumference - arcLength}`;
		  const dashOffset = -subStart * circumference;
	  
		  circles.push(
			<circle
			  key={`${i}-${color}`}
			  cx={cx}
			  cy={cy}
			  r={radius}
			  fill="none"
			  stroke={color}
			  strokeWidth={thickness}
			  strokeDasharray={dashArray}
			  strokeDashoffset={dashOffset}
			  pathLength={circumference}
			  shapeRendering="geometricPrecision"
			/>
		  );
		}
	  
		return circles;
	  }

	render(){
		return(
			<ProgressRingContainer style={{transform: "scaleX("+(this.shouldFlip()?-1:1)+")"}}>
			<svg shapeRendering="geometricPrecision" width="100%" height="100%" viewBox={"0 0 "+this.getScaleFactor()*100+" "+this.getScaleFactor()*100} preserveAspectRatio="none" style={{"transform":"rotate(-90deg)","overflow":"visible"}}>
				{!this.props.subdivisions?<g>
					<AnimatedStyledCircle   r={this.getRadius()} cx="50%" cy="50%" thickness={this.props.thickness} color={this.getBackgroundColor()}/>
					<AnimatedStyledCircle 	r={this.getRadius()} cx="50%" cy="50%" thickness={this.props.thickness} color={this.props.color} dashArray={this.getDashes()} dashOffset={this.getDashOffset(this.props.progress)}/>
 				</g>:<g>
					{this.getDashedCircle(0,1,this.getRadius(),this.props.thickness*DesignSystem.remToPx,this.getBackgroundColor())}
					{this.getDashedCircle(0,this.props.progress,this.getRadius(),this.props.thickness*DesignSystem.remToPx,this.props.color)}
					{this.props.highlightLastSubdivision?this.getDashedCircle(this.getHighlightStart(),Math.max(this.props.progress,1/this.props.subdivisions),this.getRadius(),this.props.thickness*this.getHighlightThicknessFactor()*DesignSystem.remToPx,this.props.highlightColor):""}
				}</g>}
			
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
