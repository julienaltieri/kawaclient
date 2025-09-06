import BaseComponent from './BaseComponent';
import styled from 'styled-components';
import DesignSystem from '../DesignSystem.js'
import Core from '../core'
import {format,GenericChartView, AnnotationTooltip} from './AnalysisView';
import {timeIntervals,Period} from '../Time';
import dateformat from "dateformat";
import * as V from 'victory';
import utils from '../utils'
 
export default class MiniGraph extends GenericChartView{
	constructor(props){
		super(props);

		//data prep and projection display condition
		this.n = this.props.analysis.getPeriodReports().length-1;
		this.projectionLine = this.shouldDisplayProjection();
		
		//styling
		this.style = {...this.style,
			chartHeight: 100, 
			chartWidth: 280,
			chartPadding: {top:30,bottom:30,left:0,right:60},
			colorTransition: 0,
			fontSizeBody:15,
			axisVerticalPadding:8,
			chartStrokeWidth:4.5
		}
	} 

	//data
	getPeriodReports(){
		if(!!this._periodReports){return this._periodReports}
		else{
			this._periodReports = this.props.analysis.getPeriodReports().map(r => r).sort(utils.sorters.asc(r => r.reportingDate))
			return this.getPeriodReports()
		}
	}
	getAccruedPlottedValue(r){return ((this.props.stream.isSavings||this.props.stream.isInterestIncome)?-1:1)*(r.getLeftOver()||0)}
	dateToTickDate(d){return (this.props.analysis.subReportingPeriod.name==Period.monthly.name)?(new Date(d)).setDate(1):d.getTime()}
	getData(includeProjection=false){
		if(!!this.data){return includeProjection?this.data:this.data.slice(0,this.data.length-1)}
		this.data = []
		let delta = 0;
		let a = this.props.analysis.getPeriodReports().map(r => r).sort(utils.sorters.asc(r => r.reportingDate))
		a.forEach((r,i) => {
			delta += this.getAccruedPlottedValue(r)
			this.data.push({x:this.dateToTickDate(r.reportingDate),y:delta})
		})
		return this.getData(includeProjection)
	}
	shouldDisplayProjection(){
		let numberOfDayInCycle = Math.floor((new Date() - this.getPeriodReports()[this.n].reportingStartDate)/timeIntervals.oneDay)//where we are in the cycle
		let cumsum = 0;
		let cumulativeFrequency = this.props.analysis.getFrequencyHistogramAtDate(this.props.analysis.reportingDate).map(h => {cumsum+=h; return cumsum}).map(h => h/cumsum) //cumulative frequency throughout the cycle
		return cumulativeFrequency[numberOfDayInCycle]>0.9 												//either 90%+ of the expected amount has arrived
			|| ((this.getPeriodReports()[this.n].reportingDate-new Date())<timeIntervals.oneDay*2) 		//either we're less then 2 days way from the end of the cycle
			|| this.props.stream.isTerminal() && this.getPeriodReports()[this.n].transactions.length>0 	//either we already have transactions and the stream is terminal
	}

	//domain definition 
	getReportSchedule(){return this.props.analysis.getPeriodReports().sort(utils.sorters.asc(r => r.reportingDate)).map(r => r.reportingDate)}
	getDomainBounds(){
		let dY = Math.max(1,Math.max(Math.abs(this.getMinY()),Math.abs(this.getMaxY())));
		return {...super.getDomainBounds(),my:-dY,My:dY}
	}
	getMinY(ignoreProjection){return utils.min(this.getData(!ignoreProjection && this.projectionLine).map(p => p.y))}
	getMaxY(ignoreProjection){return utils.max(this.getData(!ignoreProjection && this.projectionLine).map(p => p.y))}
	getMidY(ignoreProjection){return 100*this.getMaxY(ignoreProjection)/(this.getMaxY(ignoreProjection)-this.getMinY(ignoreProjection))}
	getMidX(){return this.getDomainBounds().mx+0.5*(this.getDomainBounds().Mx-this.getDomainBounds().mx)}

	//rendering functions
	getTickFormat(t,friendly){
		let p = this.props.analysis.subReportingPeriod.name, f=friendly?"mmm ddS":"mm/dd";
		if(p == Period.quarterly.name){return "Q"+Math.ceil((new Date(t).getUTCMonth()+1)/3)}
		else if([Period.monthly.name,Period.bimonthly.name].indexOf(p)>-1){f= friendly?"mmmm":"mmm"}
		else if(p==Period.yearly.name){f= "yyyy"}
		return friendly?dateformat(t,f):dateformat(t,f).toUpperCase()
	}
	getTickEveryK(){
		let b = this.getDomainBounds()
		let l = this.getTickFormat(new Date()).length //length of the tick string
		let w = this.style.chartWidth-this.style.chartPadding.left-this.style.chartPadding.right
		let m = w/((l+2)*this.style.fontSizeBody*0.8) //number of ticks that can fit in the drawable space + 2 characters
		return Math.floor(this.getPeriodReports().length/m) //show a tick every k report
	}
	getTitle(){return this.getPeriodReports()[0].reportingDate.getUTCFullYear() + " target"}
	getFillValue(y){return y<0?DesignSystem.getStyle().alert:DesignSystem.getStyle().positive}
	render(){
		let m = this.getMidY(true)
		this.data = undefined;// forces to recalculate data when refreshing
		let k = this.getTickEveryK()
		let ddd = new Date(new Date().getTime()-timeIntervals.oneDay*30).getTime()
		let domainAxisVerticalPadding = this.svgToDomain(0,this.style.axisVerticalPadding).dy-this.svgToDomain(0,0).dy
		return (<div style={{position:"relative",cursor:"default"}}>
		<svg style={{position:"absolute",width:0}}><defs>
	        <linearGradient id={"linear"+m} x1="0%" y1="0%" x2="0%" y2={Math.max(m,100)+"%"}>
	            <stop offset={(m-this.style.colorTransition)+"%"} stopColor={this.getFillValue(1)}/>
	            <stop offset={(m+this.style.colorTransition)+"%"} stopColor={this.getFillValue(-1)}/>
	        </linearGradient>
	        <radialGradient id="alertHighlight">
	            <stop offset="30%" stopColor={DesignSystem.UIColors.white}/>
	            <stop offset="70%" stopColor={DesignSystem.getStyle().alert}/>
	        </radialGradient>
	        <radialGradient id="positiveHighlight">
	            <stop offset="30%" stopColor={DesignSystem.UIColors.white}/>
	            <stop offset="70%" stopColor={DesignSystem.getStyle().positive}/>
	        </radialGradient>
		</defs></svg>
	    <MiniGraphContainer>
	    <V.VictoryChart scale={{ x: "time", y:"linear" }} domain={this.getDomain()} height={this.style.chartHeight} width={this.style.chartWidth} padding={this.style.chartPadding}
	    				containerComponent={<V.VictoryVoronoiContainer onActivated={this.onFlyOver} onDeactivated={this.onFlyOut} 
	    				events={{onClick:(d) => this.state.hovering?this.handleClick(this.hoverData):""}}
	    				style={{touchAction:"auto"}} voronoiBlacklist={[...(this.props.stream.expAmountHistory||[]).map((h,i) => "lineChart-1-"+i),"lineChart-2","lineChart-3"]}
	    				activateData={true} voronoiDimension="x" labels={(d) => " "} labelComponent={<MiniToolTip hoverData={this.hoverData}/>} />} >
			<V.VictoryAxis style={{axis:{opacity:1,stroke:DesignSystem.getStyle().bodyTextSecondary}}}
				tickValues={this.getReportSchedule().map(t => this.dateToTickDate(t)).filter((t,i)=> (this.n-i-1)%k==0)}
				tickFormat={(t) => (t>this.getDomainBounds().Mx)?"":`${this.getTickFormat(t)}`} 
	          	tickCount={this.getPeriodReports().length}  style={{
	          		ticks: {stroke: DesignSystem.getStyle().bodyTextSecondary, size: 0, strokeWidth:0, strokeLinecap:"round"},
	          		tickLabels: {padding:this.style.axisVerticalPadding,fill:DesignSystem.getStyle().bodyTextSecondary,fontSize: this.style.fontSizeBody,fontFamily:"Inter",fontWeight:500},
	          		axis:{"stroke":DesignSystem.getStyle().bodyTextSecondary,strokeWidth:1}
	          	}}
			 />
			{this.props.stream.expAmountHistory?.map((h,i) => <V.VictoryLine key={1000+i} name={"lineChart-1-"+i} data={[{x:h.startDate.getTime(),y:-0.7*domainAxisVerticalPadding},{x:h.startDate.getTime(),y:0.7*domainAxisVerticalPadding}]} style={{data: {stroke:DesignSystem.getStyle().bodyTextSecondary,strokeWidth:1}}}/>) }
			<V.VictoryLabel dy={-this.style.axisVerticalPadding} datum={{x:this.getMidX(),y:0}} textAnchor={"middle"} verticalAnchor={"end"} standalone={false} text={this.getTitle().toUpperCase()} style={{fill:DesignSystem.getStyle().bodyTextSecondary, fontSize: 15,fontFamily:"Inter",fontWeight:500}}/>
       		<V.VictoryLine name="lineChart-2" style={{data: {stroke: "url(#linear"+m+")",strokeWidth:this.style.chartStrokeWidth}}} data={this.getData()} />
       		{this.projectionLine?<V.VictoryLine name="lineChart-3" style={{data: {stroke: this.getFillValue(this.getData(true).slice(-1)[0].y),strokeWidth:this.style.chartStrokeWidth,strokeDasharray: "4, 2"}}} data={this.getData(true).slice(-2)}/>:null}
			{this.projectionLine?<V.VictoryScatter size={this.style.chartStrokeWidth+1} style={{data: {fill: ({datum})=>this.getAnnotationsAtDate(datum.x).length?"url(#"+(datum.y<0?"alertHighlight":"positiveHighlight")+")":"transparent",strokeWidth:3,stroke: ({datum})=>this.getFillValue(datum.y)}}} data={this.getData(true).slice(-1)}/>:null}
       		<V.VictoryScatter size={({datum})=>this.style.chartStrokeWidth+1} style={{data: {fill: ({datum})=>this.getAnnotationsAtDate(datum.x).length?"url(#"+(datum.y<0?"alertHighlight":"positiveHighlight")+")":this.getFillValue(datum.y)}}} data={this.getData()} />
     		{this.state.hovering?null:<MiniToolTip scale={{ x: "time", y:"linear" }} datum={this.getData(true).slice(this.projectionLine?-1:-2)[0]}/>}
     	</V.VictoryChart>
     	</MiniGraphContainer>
     	{(!Core.isMobile() && this.state.hovering && this.hoverData[0]?.x && this.getAnnotationsAtDate(this.hoverData[0]?.x).length)?
     		<AnnotationTooltip	shouldOverrideOverflow={this.props.shouldOverrideOverflow}
     							showAbove={this.hoverData[0].y>0} containerSVGWidth={this.svgClientSize.width} containerSVGHeight={this.svgClientSize.height}
     							scale={{x: u => u/this.style.chartWidth,y: u=> u/this.style.chartHeight}} 
     							reportDate={this.getTickFormat(new Date(this.hoverData[0].x),true)} 
     							datum={this.domainToSvg(this.hoverData[0].x,this.hoverData[0].y)} 
     							content={this.getAnnotationsAtDate(this.hoverData[0].x)}/>:undefined}
	</div>)}
}


export class CompactMiniGraph extends MiniGraph{
	constructor(props){
		super(props)
		this.style.chartPadding = {top:30,bottom:30,left:30,right:70}
	}
}

const MiniToolTip = (props) => {
	let text = utils.formatCurrencyAmount(props.datum.y,0,false,false,Core.getPreferredCurrency())
	return (<g>
		<defs>
			<filter id="shadow" x="0" y="0" width="100%" height="100%">
				<feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={DesignSystem.isDarkMode()?"#0008":"#0003"}/>
			</filter>
		</defs>
		<V.VictoryLabel backgroundPadding={{ left: 10, right: 15,bottom:7,top:7 }}
      backgroundStyle={{fill:DesignSystem.getStyle()[props.datum.y>=0?"positive":"expenses"], opacity: 1,rx:15 }} 
      			scale={props.scale} textAnchor="middle" verticalAnchor="middle" 
				style={{filter: "url(#shadow)",fill:DesignSystem.getStyle().bodyTextLight, fontSize: 22,fontFamily:"Inter",fontWeight:500}}
				datum={{x:props.datum.x,y:props.datum.y}}
				dy={-7+(props.datum.y>0?1:-1)*28}
				text={text}/></g>)
}

const GraphTitle = styled.div`
	position: absolute;
    font-variant: all-petite-caps;
    opacity: 0.8;
    height: 1rem;
    top: 1.3rem;
    left: 1.8rem;
    font-size: 0.9rem;
`

const MiniGraphContainer = styled.div`
	width: 10.5rem;
	height: 3.8rem;
	display: flex;
	align-content: center;
    justify-content: center;
    align-items: center;
    mask-image: linear-gradient(90deg, transparent 0%, white 40%);

`
const LabelBox = styled.div`
	background-color: ${props => props.color};
	color: white;
	height:1.5rem;
	width: fit-content;
    padding: 0 0.4rem;
	border-radius: 1rem;
	display: flex;
	font-size: 1rem;
	align-content: center;
    justify-content: center;
    align-items: center;
    text-shadow: 0 0 4px black;
`