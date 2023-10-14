import BaseComponent from './BaseComponent';
import styled, { keyframes } from 'styled-components'
import {ModalTemplates} from '../ModalManager.js'
import Core, {amazonConfig} from '../core.js'
import { fadeIn } from 'react-animations'
import {Action, ActionCard, ActionsContainerBox, ActionStyles} from './Action'
import DS from '../DesignSystem.js'
import utils from '../utils'
import TransactionGrouper from '../processors/TransactionGrouper'
import Statistics from '../processors/Statistics';

//const checkmark = require('../assets/checkmark.svg').default;
const getWords = (s) => s.replace(/[^a-zA-Z0-9]/g, " ").replace(/\s\s+/g, ' ').replace(/"|'/g, '').split(" ");

//exist scene animation
const checkmarkGrowAnimation = 500;
const disappearAnimationTime = 300;
const checkmarkAnimationTime = 700;


//Action for categorization card
export default class CategorizeAction extends Action{
	constructor(id,appContext,startOutOfTheWay,transaction,onActionConcluded){
		super(id,appContext,startOutOfTheWay,onActionConcluded);
		this.transaction = transaction;
	}
	getSortValue(){return this.transaction.date.getTime()}
	renderComponent(inFocus){return (<CategorizeActionCard transaction={this.transaction} startsOutOfTheWay={this.startsOutOfTheWay} appContext={this.appContext} inFocus={inFocus} id={this.id} key={this.id} parentAction={this}/>)}
	willEnterInFocus(){return this.actionCard?this.actionCard.willEnterInFocus():Promise.resolve()}
}

//react component for categorization card
class CategorizeActionCard extends ActionCard{
	constructor(props){
		super(props)
		this.state = {...this.state,checkmarkVisible:false,isSaving:false,recStreams:[],selectedItemImage: 1,fetching:true}
		this.props.parentAction.actionCard = this;
	}
	componentDidMount(){super.componentDidMount();this.refreshSuggestedStreams();}
	refreshSuggestedStreams(){//calculate recommended streams
		var recStreams = [], txns = this.props.appContext.getAllAvailableTransactions();

		//suggestions by similar categorization
		var recNeighbors = [];
		var {key,branch} = TransactionGrouper.getRelevantBranchInTree(this.props.transaction,TransactionGrouper.clusterTransactions(txns))
		var sids = Core.getUserData().getAllTerminalStreams().map(s => s.id);
		if(branch.length>0){
			var categorizedTxns = branch.filter(t => t.categorized)
			if(categorizedTxns.length>0){
				recNeighbors = categorizedTxns.reduce((ac,txn)=> {
					txn.streamAllocation.filter(al => utils.isArrayAIncludedInB([al.streamId],sids)).forEach(al => {
						if(ac.map(s => s.id).indexOf(al.streamId)==-1)ac.push(Core.getStreamById(al.streamId))
					});
					return ac
				},[])
			}  
		}

		//suggestions by frequencies
		var frequencies = Statistics.frequencies(txns.filter(t => t.categorized), t => t.streamAllocation[0].streamId).map(o => o.stream = Core.getStreamById(o.key))
		var recFrequent = frequencies.slice(0,5)

		//suggestion by similar amount
		var cattxns = txns.filter(t => t.categorized)
		var streamTransactionMap = utils.pivot(Core.getUserData().getAllTerminalStreams(),cattxns, (a,b) => a.id == b.streamAllocation[0].streamId)
		var amountStats = streamTransactionMap.filter(m => m.matching.length>0).map(o => {
			var r = {average: Statistics.avg(o.matching,t => t.amount), median: Statistics.median(o.matching, t => t.amount), stddev: Statistics.stddev(o.matching, t => t.amount), stream: o.key}
			return {relativeStddev : Math.abs(r.stddev/(r.average||0.0001)),...r} 
		}).filter(a => a.relativeStddev<0.3) //only keep streams that are somewhat stable
		var recSimilarAmounts = amountStats.filter(a => Math.abs(a.median-this.props.transaction.amount)<a.stddev*2).map(m => m.stream)//if amount falls within 2 stddev, propose it as a candidate

		//merge all and update state
		var merged = utils.weightedMerge([recNeighbors,recFrequent,recSimilarAmounts],[2,1,1.5], s => s.id).sort(utils.sorters.desc(r => r.score))
		this.updateState({recStreams:merged.map(a => a.obj).slice(0,4), fetching: false})
	}

	onClickStreamTag(s){
		if(this.state.isSaving)return;//semaphore
		else this.updateState({isSaving:true})

		//prep work
		var amz = this.props.transaction.amazonOrderDetails;
		var amzNeighbors = amz?Core.getTransactionsForOrderNumber(amz.orderNumber):undefined;
		var {key,branch} = TransactionGrouper.getRelevantBranchInTree(this.props.transaction,TransactionGrouper.clusterTransactions(this.props.appContext.getTransactionsInQueue()))
		var categorizeOtherTransactions, createRule, refusedCreateRule;
		var firstMatchingRule = Core.getUserData().getCategorizationRules().filter(r => key.indexOf(r.matchingString)>-1)[0];
		var adequateRuleAlreadyExists = (!!firstMatchingRule && firstMatchingRule.allocations[0].streamId==s.id);

		//if similar transactions exist, ask if should multi categorize
		return ((Array.isArray(branch) && branch.length>1 && key.length>2 //has similar transactions
			&& !this.props.transaction.amazonOrderDetails && !amazonConfig.include.test(this.props.transaction.description) //is not an amazon order
			&& key.toLowerCase() != "the")? //words like "the" are too generic and don't represent a true group typically
			Core.presentModal(ModalTemplates.ModalWithTransactions(
				"What about these?","Are these transactions also in "+s.name+"?",branch,[{name:"No, just the original one"},{name:"Yes, all "+branch.length,primary:true}]))
				.then(({state,buttonIndex})=>categorizeOtherTransactions = (buttonIndex==1))
			:Promise.resolve())
		.then(() => {//ask if we should create a rule
			if(!adequateRuleAlreadyExists && categorizeOtherTransactions && Core.getUserData().categorizationRulesExclusionList.indexOf(key)==-1){
				return Core.presentModal(ModalTemplates.BaseModal("One last question", "Should all future transactions containing "+key+" be categorized as "+s.name+" as well?",[{name:"No, don't automate"},{name:"Yes, automate",primary:true}]))
					.then(({state,buttonIndex}) => {createRule = buttonIndex==1; refusedCreateRule = buttonIndex==0})
			} else {Promise.resolve()}
		}).then(() => {//manage categorization rule creation & finalize
			if(createRule){Core.createCategorizationRule({matchingString:key, allocations:[{streamId:s.id,type:"percent",amount:1.0}]})} 
			else if(categorizeOtherTransactions && refusedCreateRule) {Core.addMatchingStringToCategorizationExclusionList(key)}

			var txnsToCategorize = (categorizeOtherTransactions?branch:(amzNeighbors||[this.props.transaction])).sort(utils.sorters.asc(t => t.date))
			this.props.parentAction.onActionConcluded(this.props.parentAction,txnsToCategorize,[{streamId: s.id,"type":"percent","amount":1.0}]) 
		}).catch(e => {this.updateState({isSaving:false})})
	}

	preExitAnimation(){//card will start exiting after this promise returns
		return new Promise((res,rej)=> {
			this.updateState({checkmarkVisible:true}).then(() => setTimeout(()=>{
				this.updateState({visible:false},() => setTimeout(res,disappearAnimationTime))
			},checkmarkAnimationTime))
		})
	}
	onSplitClicked(){
		Core.presentModal(ModalTemplates.ModalWithStreamAllocationOptions("Split",undefined,undefined,this.props.transaction,this.state.recStreams)).then(({state,buttonIndex}) => {
			if(buttonIndex==1){
				this.props.parentAction.onActionConcluded(this.props.parentAction,[this.props.transaction],state.allocations)
			}
		}).catch(e => {this.updateState({isSaving:false})})
	}
	setMoreStreamPopupVisible(visible,event){
		if(Core.isMobile()){
			Core.presentModal(ModalTemplates.ModalWithListItems("Select",this.getAvailableStreams(),this.getStreamString)).then(({state,buttonIndex}) => {
				this.onClickStreamTag(state.selectedItem);
			}).catch(e => {})
		}else{
			this.updateState({streamListVisible:visible,streamListClickEvent:event})
		}
	}
	isAmazon(){return this.getAmazonData()}
	getAmazonData(){return this.props.transaction.amazonOrderDetails}
	getAmazonNeighbors(){if(this.isAmazon())return Core.getTransactionsForOrderNumber(this.getAmazonData().orderNumber).sort(utils.sorters.asc(t => t.date))}
	getAvailableStreams(){return Core.getMasterStream().getAllTerminalStreams().filter(s => s.isActiveAtDate(this.props.transaction.date) || s.isActiveAtDate(new Date())).sort(utils.sorters.asc(s => s.name.charCodeAt()))}
	getStreamString(s){return s.name+(!s.isActiveNow()?" (old)":"")}
	renderContent(){
		var amz = this.getAmazonData();
		var isCompound = this.isAmazon() && amz.items.length>1;
		var amznghbrs = this.getAmazonNeighbors();
		var totalAmount = amz?utils.sum(amznghbrs,t=> t.amount):this.props.transaction.amount;
		const getAmazonDescription = (description) => getWords(description).slice(0,5).join(" ");

		return (<div>
			<CheckMarkContainer style={{opacity:this.state.checkmarkVisible?1:0,transform:"scale("+(this.state.checkmarkVisible?1:0.5)+")"}}>
				<Checkmark><Check></Check></Checkmark>
			</CheckMarkContainer>
			<TransactionView checkmarkVisible={this.state.checkmarkVisible} transaction={this.props.transaction}/>

			{/*stream suggestions*/}
			{this.state.fetching?<div></div>:
			<FadeInWrap><ActionsContainerBox style={{position:"relative",marginTop:"1rem",opacity:this.state.checkmarkVisible?0:(this.props.inFocus?1:0),pointerEvents:this.props.inFocus?"inherit":"none"}}>
					{(this.state.recStreams.length)?this.state.recStreams
					.filter(s => s.isActiveAtDate(this.props.transaction.date) || s.isActiveAtDate(new Date()))
					.map((a,i) => <DS.component.StreamTag highlight={true} key={i} onClick={(e)=> this.onClickStreamTag(a)}>{a.name}</DS.component.StreamTag>):""}
					<DS.component.StreamTag onClick={(e)=> this.onSplitClicked()}>Split</DS.component.StreamTag>
					<DS.component.StreamTag style={{paddingLeft:"1rem",paddingRight:"1rem", zIndex:100}} highlight={true} key="more" 
							onClick={(e)=> {this.setMoreStreamPopupVisible(!this.state.streamListVisible,e)}}>...</DS.component.StreamTag>
					{this.state.streamListVisible?<div ><FullScreenCapturer onClick={(e) => this.setMoreStreamPopupVisible(false)}></FullScreenCapturer>
							<DS.component.Tooltip style={{paddingLeft:0}} x={this.state.streamListClickEvent.target.offsetLeft+this.state.streamListClickEvent.target.clientWidth/2} y={this.state.streamListClickEvent.target.offsetTop+this.state.streamListClickEvent.target.clientHeight*3/4}>
								<DS.component.ScrollableList style={{maxHeight:"15rem"}}>{
									this.getAvailableStreams().map((a,i) => 
									<DS.component.ListItem size="xs" key={i} onClick={(e)=> this.onClickStreamTag(a)}>{this.getStreamString(a)}</DS.component.ListItem>)}
								</DS.component.ScrollableList>
							</DS.component.Tooltip>
						</div>:""
					}
			</ActionsContainerBox></FadeInWrap>}
		</div>)
		
	}
}

export class TransactionView extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {selectedItemImage:1}
	}
	isAmazon(){return this.getAmazonData()}
	getAmazonData(){return this.props.transaction.amazonOrderDetails}
	getAmazonNeighbors(){if(this.isAmazon())return Core.getTransactionsForOrderNumber(this.getAmazonData().orderNumber).sort(utils.sorters.asc(t => t.date))}
	handleAmzItemArrowClicked(e,right){
		var offSet = (right)?1:-1;
		var amzItemsCnt = this.props.transaction.amazonOrderDetails.items.length;
		if(this.state.selectedItemImage+offSet>amzItemsCnt || this.state.selectedItemImage+offSet<1)return;
		this.updateState({selectedItemImage:this.state.selectedItemImage+offSet})
	}
	render(){
		var amz = this.getAmazonData();
		var isCompound = this.isAmazon() && amz.items.length>1;
		var amznghbrs = this.getAmazonNeighbors();
		var totalAmount = amz?utils.sum(amznghbrs,t=> t.amount):this.props.transaction.amount;
		const getAmazonDescription = (description) => getWords(description).slice(0,5).join(" ");
		return(<DS.component.ContentTile  style={{opacity:this.props.checkmarkVisible?0:1, textAlign: "center", flexDirection: "row", margin:0, boxShadow: "0px 6px 10px #00000023", boxSizing: "border-box",
	padding:"1.5rem", transition: "opacity "+disappearAnimationTime/1000+"s ease", alignItems: "center" }}>
			{this.isAmazon()?(<div style={{marginRight:"1rem"}}>{/*amazon suggestions*/}
				<div style={{position:"relative",display:"flex",maxWidth:"6rem",minWidth:"6rem",overflow:"hidden",borderRadius: DS.borderRadiusSmall}}>
					{amz.items.map((it,i) => 
						<div  key={it.itemDescription}  style={{
							marginLeft:(i==0?-(this.state.selectedItemImage-1)*6+"rem":0),
							transition:"margin-left 0.5s ease",
							filter: "brightness("+(DS.isDarkMode()?0.9:1)+")",
							height:"6rem",minWidth:"6rem",display:"flex",justifyContent:"center",background:"white"}}>
							<img style={{alignSelf: "center"}} src={it.image}></img>
						</div>
					)}
				</div>
				{isCompound?(<div style={{display:"flex",justifyContent: "space-evenly",alignItems:"center",marginTop:"0.5rem"}}>
					<span onClick={(e) => this.handleAmzItemArrowClicked(e)} style={{cursor:"pointer",userSelect: "none",color:this.state.selectedItemImage>1?DS.getStyle().bodyTextSecondary:DS.getStyle().buttonDisabled}}>{DS.icon.leftArrow}</span>
					<span style={{color:DS.getStyle().bodyTextSecondary,fontSize:"0.8rem"}}>{this.state.selectedItemImage}/{amz.items.length}</span>
					<span onClick={(e) => this.handleAmzItemArrowClicked(e,true)} style={{cursor:"pointer",userSelect: "none",color:this.state.selectedItemImage<amz.items.length?DS.getStyle().bodyTextSecondary:DS.getStyle().buttonDisabled}}>{DS.icon.rightArrow}</span>
				</div>):""}
				</div>
			):""}
			<TxInfoContainer>{/*regular transaction*/}
				{this.isAmazon()?(<div style={{fontSize:"0.7rem",color:"grey",marginTop:"0.5rem",marginBottom:"0.5rem"}}><div>Amazon Order</div>
					<div style={{marginTop:"0.2rem"}}>#{this.props.transaction.amazonOrderDetails.orderNumber}</div></div>):""}

				<DS.component.Label highlight style={{textWrap:"wrap",maxWidth:"8rem"}}>{
					this.isAmazon()?getAmazonDescription(amz.items[this.state.selectedItemImage-1].itemDescription):(this.props.transaction.description.indexOf("Amazon")>-1 && this.props.transaction.amount>0 ?"Amazon Refund":this.props.transaction.description)}</DS.component.Label>
				{amz?<div>
					<div style={{marginTop:"0.5rem",fontSize:"0.7rem",color:"grey"}}>{amz?"Ordered on "+utils.formatDateShort(new Date(amz.date)):""}</div>
					<div style={{marginTop:"0.2rem",fontSize:"0.7rem",color:"grey"}}>{amz?"by "+amz.accountName:""}</div></div>
					:<div style={{marginTop:"0.2rem",fontSize:"0.7rem",color:"grey"}}>{utils.formatDateShort(this.props.transaction.date)}</div>
				}
			</TxInfoContainer>
			<Spacer/>
			<div>
				<AmountDiv positive={totalAmount>0}>{utils.formatCurrencyAmount(totalAmount,undefined,undefined,undefined,Core.getPreferredCurrency())}</AmountDiv>
				{amznghbrs?.length>1?<div style={{fontSize:"0.8rem",marginTop:"1rem",textAlign:"left"}}>{amznghbrs.length} Transactions:{amznghbrs.map(n => 
					<div style={{display: "flex", justifyContent: "space-between",color: "grey",marginTop:"0.2rem"}} key={n.getTransactionHash()}>
						<span>{utils.formatDateShort(n.date)}</span>
						<span>{utils.formatCurrencyAmount(n.amount,undefined,undefined,undefined,Core.getPreferredCurrency())}</span>
					</div>)}</div>:""}
			</div>
		</DS.component.ContentTile>
	)}
}

const fadeInAnimation = keyframes`${fadeIn}`;
const FadeInWrap = styled.div`
	animation: 0.5s ${fadeInAnimation};
`

const FullScreenCapturer = styled.div`
	width: 100vw;
    height: 100vh;
    position: fixed;
    top: 0;
    left: 0;
    z-index: 98;
`

const CheckMarkContainer = styled.div`
    width: 7rem;
    position: absolute;
    margin-left: calc(50% - 3rem);
    margin-top: 1.5rem;
    transition: opacity ${disappearAnimationTime/1000}s ease, transform ${checkmarkGrowAnimation/1000}s cubic-bezier(0.49, 1.62, 0.58, 0.93);
    opacity: 0;
`

const Check = styled.div`
	border-top: solid ${DS.borderThickness.m}rem ${DS.getStyle().modalPrimaryButton};
	border-right: solid ${DS.borderThickness.m}rem ${DS.getStyle().modalPrimaryButton};
    width:50%;
    height:30%;
    border-radius: 0px;
    transform: rotate(135deg);
    margin-bottom: 9%;
    margin-right: 2%;
`

const Checkmark = styled.div`
    width: 5rem;
    height: 5rem;
    border: solid ${DS.borderThickness.m}rem ${DS.getStyle().modalPrimaryButton};
    opacity:0.8;
    border-radius: 100rem;
    display: flex;
    align-items: center;
    justify-content: center;

`

/*
const TransactionContainerView = styled.div `
	text-align: center;
	display: flex;
    background: ${props => DS.getStyle().UIElementBackground};
	box-shadow: 0px 6px 10px #00000023;
    box-sizing: border-box;
	padding:1.5rem;
    border-radius: ${props => DS.borderRadius};
    transition: opacity ${disappearAnimationTime/1000}s ease;
    align-items: center;
`
*/

const StreamTag = styled.div`
	background-color: ${props => props.highlight?DS.getStyle().commonTag:DS.getStyle().specialTag};
	padding: 0.2rem 0.4rem ;
	margin:0.2rem;
	border-radius: 100vw;
	opacity:0.8;
	&:hover{
		cursor:pointer;
		opacity:1;
	}
`

const TxInfoContainer = styled.div `
	display:flex;
	flex-direction:column;
	align-items: flex-start;
    text-align: left;
	height: 5rem;
	justify-content: center;
`

const AmountDiv = styled.div `
	font-size: 2rem;
	font-weight: 500;
	justify-content: center;
	font-family: Barlow;
	color: ${props => props.positive?DS.getStyle().positive:DS.getStyle().bodyText}
`

const Spacer = styled.div`
	flex-grow:1;
`
