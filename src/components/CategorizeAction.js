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
import React from 'react';

//const checkmark = require('../assets/checkmark.svg').default;

//Post-tax price of each item of an amazon order, aligned with amz.items, spread so the set sums to `total`
//exactly. The scraper stores nominal (pre-tax) itemPrice plus its own postTaxPrice estimate, but those are
//rounded independently and drift, so when the whole order is priced we re-spread tax+shipping here.
//`total` is the order total for the carousel labels, and the transaction amount when splitting - an order
//can be billed as several charges, so the two aren't always the same number.
//Entries are undefined when the order-details page hasn't been scraped yet, so callers show nothing rather
//than something wrong.
export const getAmazonItemPrices = (amz,total) => {
	var items = amz?.items || [];
	var nominalPrices = items.map(it => it.itemPrice);
	if(items.length && total>0 && nominalPrices.every(pr => pr>0))return utils.allocateProportionally(nominalPrices,total)
	return items.map(it => it.postTaxPrice || it.itemPrice) //partially priced order: show what the scraper had, item by item
}

//The order behind a transaction, preferring the live copy over the one frozen onto it.
//amazonOrderDetails is persisted with the categorization and never re-attached once set
//(getUnmatchedAmazonTransactions skips transactions that already have it), so every transaction keeps
//the order as it looked when IT was first matched. The scraper backfills item prices afterwards, so two
//charges of one order can disagree about whether their items have prices at all - which surfaces as one
//charge showing a single item and its sibling showing the whole carousel with no price tags. Reading the
//live order makes every transaction of an order render the same thing. The stored copy stays underneath
//because it carries the match metadata (algo, matchedTxnDate, matchedTxnLast4) the order itself lacks,
//and because an order older than the fetched window won't be in the live history at all.
export const getAmazonOrderData = (transaction) => {
	var stored = transaction?.amazonOrderDetails;
	if(!stored)return stored
	var live = Core.getAmazonOrder(stored.orderNumber);
	return live?{...stored,...live}:stored
}

//Beyond these the subset search below stops being worth running - and orders that large are also the least
//likely to resolve cleanly anyway.
const maxItemsForChargeInference = 14;
const maxChargesForOrderResolution = 6;
const maxStepsForOrderResolution = 200000;

//The charges of an order as positive amounts, with whether that list is known to be the whole of them.
//
//Completeness is the part that matters. Amazon's own payments page (order.transactions[], positive for a
//charge and negative for a refund - see documentation/amazon-transaction.md) lists every charge whether or
//not the bank has posted it yet, and only that list can be trusted to be exhaustive. Falling back to what
//the bank posted misses anything still in transit, so an item left over may well belong to a charge we
//simply cannot see - not to a discount. The inferences that would read a leftover as a discount are
//switched off in that case rather than guessing.
const getAmazonOrderCharges = (amz, alsoConsider) => {
	var ledger = (amz?.transactions||[]).filter(t => t.amount>0).map(t => utils.round2Decimals(t.amount));
	if(ledger.length)return {charges:ledger, complete:true}
	var posted = (Core.getTransactionsForOrderNumber(amz?.orderNumber)||[])
		.filter(t => t.amount<0).map(t => utils.round2Decimals(-t.amount));
	//the transaction being looked at is a charge of this order by construction, so it belongs in the
	//inventory even when the bank hasn't posted it (or when it is the credit that refunded it)
	if(alsoConsider>0 && !posted.some(c => Math.abs(c-alsoConsider)<0.005))posted = posted.concat([alsoConsider]);
	return {charges:posted, complete:false}
}

//Every way of handing disjoint item subsets to charges, keeping those that account for the most charges.
//Returns {assign,count} - assign[i] is a bitmask of the items on charge i, 0 when that charge went unmatched.
//Several assignments tying at the best count means the mapping is not knowable, and none is claimed: the
//consequence of picking one would be a real product picture wearing another item's price.
//
//An order of interchangeable items - fourteen identical refills billed as six shipments - has combinatorially
//many equally good readings, and enumerating them to discover that is hopeless. The walk is given a step
//budget and running out is treated the same as ambiguity, because that is what it means: too many ways to
//slice the order to call any of them the answer.
const bestAssignment = (prices, charges) => {
	var n = prices.length, full = (1<<n)-1;
	//subset sums in one pass: a mask sums to itself-without-its-lowest-item, plus that item
	var subsetSum = new Float64Array(full+1);
	for(var mask=1;mask<=full;mask++){
		var low = mask & -mask;
		subsetSum[mask] = subsetSum[mask^low] + prices[31-Math.clz32(low)];
	}
	var candidates = charges.map(amount => {
		var out = [];
		for(var m=1;m<=full;m++){if(Math.abs(subsetSum[m]-amount)<0.005)out.push(m)}
		return out
	});
	//the most constrained charge is placed first, so `best` climbs on the very first branch and the bound
	//below prunes deep instead of shallow
	var order = charges.map((c,i) => i).sort((x,y) => candidates[x].length-candidates[y].length);

	//only two solutions are ever kept: one is the answer, two is already ambiguous and a third adds nothing
	var best = -1, solutions = [], budget = maxStepsForOrderResolution;
	(function walk(k,used,picked,matched){
		if(budget-- < 0)return
		if(matched+(order.length-k)<best)return                  //this branch can no longer beat what we have
		if(k===order.length){
			if(matched>best){best = matched;solutions.length = 0}
			if(matched===best && solutions.length<2)solutions.push(picked.slice())
			return
		}
		candidates[order[k]].forEach(mask => {
			if(mask & used)return                                //an item cannot be on two charges
			picked.push(mask);walk(k+1,used|mask,picked,matched+1);picked.pop()
		});
		picked.push(0);walk(k+1,used,picked,matched);picked.pop() //leave this charge unmatched
	})(0,0,[],0);

	var assign = charges.map(() => 0);
	if(budget<0 || best<1 || solutions.length!==1)return {assign:assign, count:0}
	order.forEach((i,k) => {assign[i] = solutions[0][k]});
	return {assign:assign, count:best}
}

//Turns an assignment into the two answers the UI needs: which items each charge paid for, and what each item
//costs. Matched items keep the price they matched at. When the charge list is known to be complete, whatever
//is left unclaimed absorbs the gap between the order and the bill - that is where a gift card or a single
//shipment's discount lands - and a lone leftover charge owns it. Without that guarantee nothing is absorbed
//and unmatched charges simply stay unresolved.
const settleAmazonOrder = (items, prices, charges, assign, absorb) => {
	var claimed = assign.reduce((a,m) => a|m, 0);
	var leftItems = items.map((it,i) => i).filter(i => !(claimed & (1<<i)));
	var leftCharges = charges.filter((c,i) => !assign[i]);
	var price = prices.slice();
	if(absorb && leftItems.length && leftCharges.length){
		var spread = utils.allocateProportionally(leftItems.map(i => prices[i]),utils.round2Decimals(utils.sum(leftCharges)));
		leftItems.forEach((i,k) => {price[i] = spread[k]})
	}
	var map = charges.map((c,i) => {
		if(assign[i])return items.map((it,k) => k).filter(k => assign[i] & (1<<k))
		if(absorb && leftCharges.length===1 && leftItems.length)return leftItems
		return undefined
	});
	return {charges:charges, map:map, price:price}
}

//Which items each charge of the order paid for, and what each item costs.
//
//Both answers belong to the ORDER, never to one charge on its own. Amazon bills per shipment, so an order
//can arrive as several bank charges while every one of them carries the whole order's item list, and nothing
//in the payload says which shipment an item went in. Resolving charges one at a time produces two faults:
//one charge scopes to its items while its sibling cannot, so moving between them changes the picture count
//for no visible reason; and the same item gets a different price depending on which charge is open, which
//means the price was never a property of the item at all.
//
//So it is resolved once per order, in two passes:
//  A. at full price - charges matching a subset exactly are settled as if no discount existed, and whatever
//     is left over absorbs it. A gift card taken off one shipment lands here: that slice is re-priced and
//     every other item keeps the price it really had.
//  B. rescaled - if A cannot account for every charge, re-price every item against what was actually billed
//     and match again. A discount spread across all the shipments lands here.
//Whichever pass accounts for every charge wins, A first; failing that A's partial result stands; failing
//that B's; failing that nothing is scoped. Pass B and the absorption both need the charge list to be
//complete, so with only posted charges to go on the resolution stops at A's exact matches.
const resolveAmazonOrder = (amz, alsoConsider) => {
	var items = amz?.items || [];
	if(!items.length || !(amz.orderAmount>0) || items.length>maxItemsForChargeInference)return undefined
	var orderPrices = getAmazonItemPrices(amz,amz.orderAmount);
	if(!utils.and(orderPrices,pr => pr>0))return undefined

	var inventory = getAmazonOrderCharges(amz,alsoConsider), charges = inventory.charges;
	if(!charges.length || charges.length>maxChargesForOrderResolution)return undefined

	var a = bestAssignment(orderPrices,charges);
	if(!inventory.complete)return settleAmazonOrder(items,orderPrices,charges,a.assign,false)
	if(a.count===charges.length)return settleAmazonOrder(items,orderPrices,charges,a.assign,true)

	var scaled = getAmazonItemPrices(amz,utils.round2Decimals(utils.sum(charges)));
	var b = bestAssignment(scaled,charges);
	if(b.count===charges.length)return settleAmazonOrder(items,scaled,charges,b.assign,true)
	if(a.count)return settleAmazonOrder(items,orderPrices,charges,a.assign,true)
	if(b.count)return settleAmazonOrder(items,scaled,charges,b.assign,true)
	return settleAmazonOrder(items,scaled,charges,charges.map(() => 0),true)
}

//The resolution is read on every render of the tile, the carousel and each row of the item-wise split, and
//the subset search behind it is exponential, so it is kept until something it depends on changes. The key
//carries every input, which means the scraper backfilling prices invalidates it on its own.
const orderResolutions = new Map();
const getAmazonOrderResolution = (amz, alsoConsider) => {
	var key = [amz.orderNumber,amz.orderAmount,alsoConsider,
		(amz.items||[]).map(it => it.itemPrice+"/"+it.postTaxPrice).join(","),
		(amz.transactions||[]).map(t => t.amount).join(",")].join("|");
	if(!orderResolutions.has(key))orderResolutions.set(key,resolveAmazonOrder(amz,alsoConsider));
	return orderResolutions.get(key)
}

//Which of the order's items THIS charge paid for, as {items,prices,indices} - or undefined when we can't
//tell. Reads the order-level resolution above and picks this transaction's charge out of it by amount;
//charges sharing an amount would have made the assignment ambiguous and been refused there already.
export const getAmazonChargeItems = (transaction) => {
	var amz = getAmazonOrderData(transaction), target = Math.abs(transaction?.amount||0);
	if(!amz || !(target>0))return undefined
	var resolved = getAmazonOrderResolution(amz,target);
	if(!resolved)return undefined
	var at = resolved.charges.findIndex(c => Math.abs(c-target)<0.005);
	var indices = at>-1?resolved.map[at]:undefined;
	if(!indices || !indices.length)return undefined
	return {items:indices.map(i => amz.items[i]),prices:indices.map(i => resolved.price[i]),indices:indices}
}

//True when this transaction can be split item by item: we know which items it paid for, and there is more
//than one of them to divide between streams. Unpriced orders (amazon fresh, digital) and charges whose item
//subset can't be pinned down fall back to the amount-based split.
export const canSplitAmazonByItem = (transaction) => {
	var charge = getAmazonChargeItems(transaction);
	return !!charge && charge.items.length>1
}

//The white product tile: item picture with its post-tax price in the bottom-right corner. Shared by the
//carousel on the transaction view and the rows of the item-wise split, which is why the caller owns the
//outer styling (the carousel slides its first cell, the split rows clip theirs).
export const AmazonItemImage = (props) => (
	//the tile is an explicit square and never flexes: without a width its flex base comes from the
	//picture's intrinsic size, which stretches the tile and eats the room the stream field wants.
	//product shots are square, so the picture is contained rather than cropped to fill.
	<div style={{
			position:"relative",display:"flex",justifyContent:"center",background:"white",
			height:props.size+"rem",width:props.size+"rem",minWidth:props.size+"rem",flexShrink:0,
			filter: "brightness("+(DS.isDarkMode()?0.9:1)+")",
			...props.style}}>
		<DS.component.Image src={props.item.image} style={{width:"100%",height:"100%",objectFit:"contain"}}/>
		{props.price>0?<ItemPriceLabel>{utils.formatCurrencyAmount(props.price,2,true,true,Core.getPreferredCurrency())}</ItemPriceLabel>:""}
	</div>
)

//The item name is capped at two lines and opens on tap, so its collapsed height has to be an exact
//number rather than whatever the text happens to occupy. The app's reset sets line-height:1, which sets
//wrapped lines solid and crops their descenders once the box is clipped, so the name declares its own
//leading and the collapsed height is derived from it.
const nameLineHeight = 1.25; //multiples of the font size
const nameCollapsedLines = 2;
const nameOpenAnimationTime = 300;

//Everything in the tile that responds to a tap. Android paints a blue-grey box over a tapped element by
//default, which reads as a button press on things that are text, and a tap that lands slightly long
//starts selecting the words instead of doing what it was for.
const tappableStyle = {cursor:"pointer",userSelect:"none",WebkitTapHighlightColor:"transparent"};

//exist scene animation
const checkmarkGrowAnimation = 500;
const disappearAnimationTime = 300;
const animationIconTime = 700;


//Action for categorization card
export default class CategorizeAction extends Action{
	constructor(id,appContext,startOutOfTheWay,transaction,onActionConcluded){
		super(id,appContext,startOutOfTheWay,onActionConcluded);
		this.transaction = transaction;
	}
	getSortValue(){return this.transaction.getDisplayDate().getTime()}
	renderComponent(inFocus){return (<CategorizeActionCard transaction={this.transaction} startsOutOfTheWay={this.startsOutOfTheWay} appContext={this.appContext} inFocus={inFocus} id={this.id} key={this.id} parentAction={this}/>)}
	willEnterInFocus(){return this.actionCard?this.actionCard.willEnterInFocus():Promise.resolve()}
}

//react component for categorization card
class CategorizeActionCard extends ActionCard{
	constructor(props){
		super(props)
		this.state = {...this.state,animationIconVisible:false,isSaving:false,recStreams:[],selectedItemImage: 1,fetching:true,useSkipIcon:false}
		this.props.parentAction.actionCard = this;
		this.onChangeRuleMatchingString = this.onChangeRuleMatchingString.bind(this); 
		this.moreButtonRef = React.createRef();
		this.showMoreStreamContextualMenu = this.showMoreStreamContextualMenu.bind(this);
	}
	componentDidMount(){super.componentDidMount();this.refreshSuggestedStreams();}
	refreshSuggestedStreams(){//calculate recommended streams
		var txns = this.props.appContext.getAllAvailableTransactions();

		//suggestions by similar categorization
		var recNeighbors = [];
		var {branch} = TransactionGrouper.getRelevantBranchInTree(this.props.transaction,TransactionGrouper.clusterTransactions(txns))
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
				"Let's make it easier",<DS.component.SentenceWrapper>Categorize all of these as<DS.component.StreamTag highlight noHover>{s.name}</DS.component.StreamTag>?</DS.component.SentenceWrapper>
				,branch,[{name:"No, first only"},{name:"Yes, all",primary:true}]))
				.then(({state,buttonIndex})=>categorizeOtherTransactions = (buttonIndex==1))
			:Promise.resolve())
		.then(() => {//ask if we should create a rule
			if(!adequateRuleAlreadyExists && categorizeOtherTransactions && Core.getUserData().categorizationRulesExclusionList.indexOf(key)==-1){
				return Core.presentModal(ModalTemplates.BaseModal("One last question", 
					<div>
						<DS.component.SentenceWrapper>Should transactions like
							<DS.component.Input type="text" textAlign="left" formId="matchingString" autoSize inline onChange={this.onChangeRuleMatchingString} defaultValue={key} style={{width:key.length+"ch",marginRight:"0.3rem"}}/>
							always be categorized as<DS.component.StreamTag highlight noHover>{s.name}</DS.component.StreamTag>?
						</DS.component.SentenceWrapper>
					</div>,[{name:"No, don't automate"},{name:"Yes, automate",primary:true}]))
					.then(({state,buttonIndex}) => {createRule = buttonIndex==1; refusedCreateRule = buttonIndex==0})
			} else {return Promise.resolve()}
		}).then(() => {//manage categorization rule creation & finalize
			if(createRule){Core.createCategorizationRule({matchingString:this.inputMatchingString||key, allocations:[{streamId:s.id,type:"percent",amount:1.0}]})} 
			else if(categorizeOtherTransactions && refusedCreateRule) {Core.addMatchingStringToCategorizationExclusionList(key)}

			var txnsToCategorize = (categorizeOtherTransactions?branch:(amzNeighbors||[this.props.transaction])).sort(utils.sorters.asc(t => t.getDisplayDate()))
			this.props.parentAction.onActionConcluded(this.props.parentAction,txnsToCategorize,[{streamId: s.id,"type":"percent","amount":1.0}]) 
		}).catch(e => {this.updateState({isSaving:false})})
	}
	onChangeRuleMatchingString(e){	
		let s = document.getElementById("matchingString").value;
		this.inputMatchingString = s;
	}

	preExitAnimation(skip){//card will start exiting after this promise returns
		return new Promise((res,rej)=> {
			this.updateState({animationIconVisible:true,useSkipIcon:skip}).then(() => setTimeout(()=>{
				this.updateState({visible:false},() => setTimeout(res,disappearAnimationTime))
			},animationIconTime))
		})
	}
	resetAnimationState(){return this.updateState({animationIconVisible:false,visible:true,isSaving:false,moveOutOfTheWay:this.props.startsOutOfTheWay,useSkipIcon:false})}
	//In the queue you are categorizing one transaction at a time, so the order's other charges are shown
	//but inert: jumping to a sibling mid-categorization is what creates the awkward states - one charge
	//split and the other not, one categorized while its sibling is still in the queue. The exception is a
	//sibling that has ALREADY been categorized: there is nothing in progress to disturb, so it opens. Once
	//you are inside a dialog the restriction lifts, because by then you are looking at one charge rather
	//than working through a queue.
	getNavigation(insideDialog){
		return {
			canNavigate: (other) => insideDialog || !!other.categorized,
			onNavigate: (other) => Promise.resolve(Core.dismissModal()).then(() => this.openCharge(other))
		}
	}
	//Where tapping a sibling lands follows the target, not where you came from: an already categorized
	//charge opens its own dialog, an uncategorized one opens the split view. That is what lets you go back
	//and forth between the two.
	openCharge(transaction){
		return transaction.categorized?this.onEditClicked(transaction):this.onSplitClicked(transaction)
	}
	//The refund strip is a statement about one zero-sum stream's analysis, and the queue has no stream in
	//view, so there is none to show here. Clearing it is what stops a strip left on the transaction by a
	//previous visit to the analysis view from turning up in the queue's dialog.
	openDialog(title,transaction,streamRecs){
		transaction.reconciliation = undefined;
		return Core.presentModal(ModalTemplates.ModalWithStreamAllocationOptions(title,undefined,undefined,transaction,streamRecs,this.getNavigation(true)))
	}
	onEditClicked(transaction){
		return this.openDialog("Edit",transaction,[]).then(({state,buttonIndex}) => {
			if(buttonIndex==1)this.props.appContext.onCategorizationUpdate([transaction],[state.allocations])
		}).catch(e => {})
	}
	//The dialog can be navigated onto another charge of the same order, so what gets written has to be the
	//transaction it ended up on rather than the one this card was built for. Only a split of THIS card's
	//transaction concludes the card's action; a sibling is saved on its own and the card stays where it is.
	onSplitClicked(transaction){
		var target = transaction || this.props.transaction;
		return this.openDialog("Split",target,this.state.recStreams).then(({state,buttonIndex}) => {
			if(buttonIndex!=1)return
			if(target===this.props.transaction)this.props.parentAction.onActionConcluded(this.props.parentAction,[target],state.allocations)
			else this.props.appContext.onCategorizationUpdate([target],[state.allocations])
		}).catch(e => {this.updateState({isSaving:false})})
	}
	showMoreStreamContextualMenu(event){
		Core.presentContextualMenu(this.getAvailableStreams(),this.getStreamString,this.moreButtonRef.current).then(({state,buttonIndex}) => {
			this.onClickStreamTag(this.getAvailableStreams()[buttonIndex])
		}).catch(e => {})
	}
	isAmazon(){return this.getAmazonData()}
	getAmazonData(){return getAmazonOrderData(this.props.transaction)}
	getAmazonNeighbors(){if(this.isAmazon())return Core.getTransactionsForOrderNumber(this.getAmazonData().orderNumber).sort(utils.sorters.asc(t => t.getDisplayDate()))}
	getAvailableStreams(){return Core.getMasterStream().getAllTerminalStreams().filter(s => s.isActiveAtDate(this.props.transaction.getDisplayDate()) || s.isActiveAtDate(new Date())).sort(utils.sorters.asc(s => s.name.charCodeAt()))}
	getStreamString(s){return s.name+(!s.isActiveNow()?" (old)":"")}
	renderContent(){

		return (<div>
			<AnimationSymbolContainer style={{opacity:this.state.animationIconVisible?1:0,transform:"scale("+(this.state.animationIconVisible?1:0.5)+")"}}>
				<AnimationSymbol>{this.state.useSkipIcon?<Chevron/>:<Check/>}</AnimationSymbol>
			</AnimationSymbolContainer>
			<TransactionView animationIconVisible={this.state.animationIconVisible} transaction={this.props.transaction} navigation={this.getNavigation(false)}/>

			{/*stream suggestions. ActionsContainerBox carries `margin: 5rem auto` and every caller
			   overrides only the top of it; the 5rem underneath went unnoticed while the action zone was
			   pinned to a fixed height and simply overflowed it. Now that the zone takes its height from
			   the card, that margin is real space and has to be a number somebody chose.*/}
			{this.state.fetching?<div></div>:
			<FadeInWrap><ActionsContainerBox style={{position:"relative",marginTop:"1rem",marginBottom:DS.verticalSpacing.m,opacity:this.state.animationIconVisible?0:(this.props.inFocus?1:0),pointerEvents:this.props.inFocus?"inherit":"none"}}>
					{(this.state.recStreams.length)?this.state.recStreams
					.filter(s => s.isActiveAtDate(this.props.transaction.getDisplayDate()) || s.isActiveAtDate(new Date()))
					.map((a,i) => <DS.component.StreamTag highlight={true} key={i} onClick={(e)=> this.onClickStreamTag(a)}>{a.name}</DS.component.StreamTag>):""}
					<DS.component.StreamTag onClick={(e)=> this.onSplitClicked()}>Split</DS.component.StreamTag>
					<div ref={this.moreButtonRef}><DS.component.StreamTag style={{paddingLeft:"1rem",paddingRight:"1rem"}} highlight={true} key="more" 
							onClick={(e)=> {this.showMoreStreamContextualMenu(e)}}>...</DS.component.StreamTag></div>
			</ActionsContainerBox></FadeInWrap>}
		</div>)
		
	}
}
const StyledWord = styled.div`
	margin-right: 1rem;
	text-align: left;
	flex-shrink: 0;
	flex-grow: 0;
	color: ${DS.getStyle().bodyText};
`
export class TransactionView extends BaseComponent{
	constructor(props){
		super(props)
		this.state = {selectedItemImage:1,nameOpen:false,nameClamped:true}
	}
	isAmazon(){return this.getAmazonData()}
	getAmazonData(){return getAmazonOrderData(this.props.transaction)}
	getAmazonNeighbors(){if(this.isAmazon())return Core.getTransactionsForOrderNumber(this.getAmazonData().orderNumber).sort(utils.sorters.asc(t => t.getDisplayDate()))}
	handleAmzItemArrowClicked(e,right){
		var offSet = (right)?1:-1;
		var amzItemsCnt = (getAmazonChargeItems(this.props.transaction)?.items || getAmazonOrderData(this.props.transaction).items).length;
		if(this.state.selectedItemImage+offSet>amzItemsCnt || this.state.selectedItemImage+offSet<1)return;
		//the next item is a different name of a different length, so it starts closed rather than
		//inheriting the height the last one was opened to
		this.updateState({selectedItemImage:this.state.selectedItemImage+offSet,nameOpen:false,nameClamped:true,nameHeight:undefined})
	}
	//The height it opens to is the name's real height, not a cap: everything under the name moves with it,
	//so a cap the text does not reach would keep pushing the amount down after the words had stopped. That
	//height can only be measured with the clamp off, which is why opening takes two steps - unclamp, then
	//animate to what the element turned out to be.
	//
	//The clamp is tracked separately from the open/closed height because the two cannot change together in
	//both directions. Closing has to keep the clamp OFF for the length of the animation: reapplying it at
	//the same moment would shrink the text to two lines in a single frame, leaving the height transition
	//with nothing left to hide and making the close look instant. It goes back on when the transition
	//actually ends, which is also why there is no duration duplicated here to drift out of step.
	//`el` is the name itself, read out of the event rather than through a ref: the clamped box and the tap
	//target are one element, so the thing that was tapped is also the thing to measure.
	toggleName(el){
		if(this.state.nameOpen)return this.updateState({nameOpen:false})
		return this.updateState({nameClamped:false,nameOpen:true,nameHeight:undefined})
			.then(() => this.updateState({nameHeight:el.scrollHeight}))
	}
	//Two lines, cut where the line ends with an ellipsis to say there is more, and tapping opens it.
	//The ellipsis is the affordance: it appears only when something is actually hidden.
	//
	//The clamp, the animated height and the tap handler all sit on the one element, so whatever is visible
	//is by definition inside the thing that responds to a tap. Wrapping the name in a separate box for the
	//height left the two able to disagree about where the name was, and only the last line of it answered.
	renderItemName(text){
		var collapsed = nameCollapsedLines*nameLineHeight*DS.fontSize.body+"rem";
		return <DS.component.Label highlight title={this.state.nameOpen?undefined:text}
			onClick={(e) => {e.stopPropagation();this.toggleName(e.currentTarget)}}
			onTransitionEnd={() => {if(!this.state.nameOpen && !this.state.nameClamped)this.updateState({nameClamped:true})}}
			style={{...tappableStyle,textWrap:"wrap",lineHeight:nameLineHeight,overflow:"hidden",
				maxHeight:(this.state.nameOpen && this.state.nameHeight)?this.state.nameHeight+"px":collapsed,
				transition:"max-height "+nameOpenAnimationTime/1000+"s ease",
				...(this.state.nameClamped?{display:"-webkit-box",WebkitBoxOrient:"vertical",WebkitLineClamp:nameCollapsedLines}:{})}}>{text}</DS.component.Label>
	}
	//Dates, order identity and sibling charges are all supporting text: one size, one colour.
	secondaryTextStyle(){return {fontSize:DS.fontSize.little+"rem",color:DS.getStyle().bodyTextSecondary}}
	//True when a row of the order's transactions is the one being shown.
	isCurrentTransaction(n){
		return n===this.props.transaction || (!!n.transactionId && n.transactionId===this.props.transaction.transactionId)
	}
	//One line naming the order, kept to a single row because it is the only thing on the tile that is about
	//the whole order rather than this one charge. It has to earn that row against a phone's width, so both
	//halves are cut to what actually distinguishes one order from another: the last three digits of the
	//order number - enough to tell two orders apart, and the leading digits repeat across an account
	//anyway - and a month and day without the year. The whole order number stays on the title attribute for
	//when it has to be looked up somewhere else.
	renderAmazonIdentity(amz){
		var ordered = amz.date?new Date(amz.date):undefined;
		return <div key="identity" title={"Amazon order #"+amz.orderNumber} style={{...this.secondaryTextStyle(),
				whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
			{(amz.accountName?amz.accountName+"'s ":"")+"Amazon order #"+(amz.orderNumber+"").slice(-3)
				+(ordered?" from "+utils.formatDateMonthDay(ordered):"")}
		</div>
	}
	//Another charge of the same order: "and $12.06 on 7/23/26", sitting under this charge's own amount and
	//aligned with it so the two read as one column of money. Tappable is signalled by underlining the amount
	//and nothing else, and the cue comes off the same flag as the handler - a row can never look openable
	//while being inert. `navigation` is what decides: in the queue only an already categorized charge opens,
	//inside a dialog any of them does, and a caller can veto individual rows on top of that.
	renderSiblingLine(n){
		var nav = this.props.navigation;
		var canNavigate = !!nav?.onNavigate && (nav.canNavigate?nav.canNavigate(n):true);
		return <div key={n.getTransactionHash()} title={canNavigate?"Open this charge":undefined}
			onClick={canNavigate?((e) => {e.stopPropagation();nav.onNavigate(n)}):undefined}
			style={{...this.secondaryTextStyle(),marginTop:DS.spacing.xxs+"rem",
				...(canNavigate?tappableStyle:{cursor:"default"})}}>
			and <span style={{textDecoration:canNavigate?"underline":"none"}}>{utils.formatCurrencyAmount(n.amount,undefined,undefined,undefined,Core.getPreferredCurrency())}</span> on {utils.formatDateShort(n.getDisplayDate())}
		</div>
	}
	//The product picture, with the carousel under it when this charge covers more than one item.
	//Two rules, kept independent of each other on purpose:
	//  the carousel appears only when this charge covers more than one item;
	//  the per-item price tags appear only when the carousel does.
	//A charge covering one item has that item's price on display already - it is the transaction amount
	//beside the picture - so a tag would only repeat it. Tying the tag to the carousel rather than to
	//whether a price happens to be known is what stops the two from drifting apart.
	renderAmazonPicture(shownItems,prices,showCarousel){
		return <div style={{marginRight:DS.spacing.xs+"rem",flexShrink:0}}>
			<div style={{position:"relative",display:"flex",width:DS.spacing.xl+"rem",overflow:"hidden",borderRadius:DS.borderRadiusSmall}}>
				{shownItems.map((it,i) =>
					<AmazonItemImage key={i} item={it} price={showCarousel?prices[i]:undefined} size={DS.spacing.xl} style={{
						marginLeft:(i==0?-(this.state.selectedItemImage-1)*DS.spacing.xl+"rem":0),
						transition:"margin-left 0.5s ease"}}/>
				)}
			</div>
			{showCarousel?(<div style={{display:"flex",justifyContent:"space-evenly",alignItems:"center",marginTop:DS.spacing.xxs+"rem"}}>
				<span onClick={(e) => this.handleAmzItemArrowClicked(e)} style={{...tappableStyle,color:this.state.selectedItemImage>1?DS.getStyle().bodyTextSecondary:DS.getStyle().buttonDisabled}}>{DS.icon.leftArrow}</span>
				<span style={{...this.secondaryTextStyle()}}>{this.state.selectedItemImage}/{shownItems.length}</span>
				<span onClick={(e) => this.handleAmzItemArrowClicked(e,true)} style={{...tappableStyle,color:this.state.selectedItemImage<shownItems.length?DS.getStyle().bodyTextSecondary:DS.getStyle().buttonDisabled}}>{DS.icon.rightArrow}</span>
			</div>):""}
		</div>
	}
	//An amazon charge reads as a column: the order named once across the top, then the picture beside
	//everything that belongs to this particular charge - its item, its date, its amount, and the order's
	//other charges. Laying it out this way is what gave the description and the amount room on a phone;
	//the fixed 5rem info column and the 8rem name clamp that used to hold the row together are what made
	//it cramped, and neither is needed once the tile is a column.
	renderAmazonTile(){
		var amz = this.getAmazonData();
		//the items this charge actually paid for when we can tell them apart; otherwise the whole order
		var charge = getAmazonChargeItems(this.props.transaction);
		var shownItems = charge?charge.items:(amz?.items||[]);
		var prices = charge?charge.prices:getAmazonItemPrices(amz,amz?.orderAmount);
		var showCarousel = shownItems.length>1;
		var siblings = (this.getAmazonNeighbors()||[]).filter(n => !this.isCurrentTransaction(n));
		//always the transaction being shown, never the order's net. Summing the order's transactions was
		//defensible while they were all charges, but a refund carries the same orderNumber, so the sum
		//silently became "what the order cost after returns" - a number matching neither the allocations
		//below it nor any real transaction. The sibling lines give the context instead.
		var amount = this.props.transaction.amount;
		return(<React.Fragment>
			{this.renderAmazonIdentity(amz)}
			<div style={{display:"flex",flexDirection:"row",alignItems:"flex-start"}}>
				{this.renderAmazonPicture(shownItems,prices,showCarousel)}
				<div style={{display:"flex",flexDirection:"column",flexGrow:1,minWidth:0}}>
					{/*two lines and no more until it is asked for: item names vary in length, and letting one
					   run to a third line moved the amount and the sibling charges down as the carousel was
					   stepped through, so the tile jumped under the reader's thumb between one item and the
					   next. The description used to be cut to its first five words instead, which truncated
					   by a count that knows nothing about the width it has - it dropped words that would
					   have fitted, and still ran to three lines when they were long.*/}
					{this.renderItemName(shownItems[this.state.selectedItemImage-1]?.itemDescription||"")}
					<div style={{...this.secondaryTextStyle(),marginTop:DS.spacing.xxs+"rem"}}>{utils.formatDateShort(this.props.transaction.getDisplayDate())}</div>
					<AmountDiv positive={amount>0} style={{marginTop:DS.spacing.xxs+"rem",textAlign:"right"}}>{utils.formatCurrencyAmount(amount,undefined,undefined,undefined,Core.getPreferredCurrency())}</AmountDiv>
					{siblings.length?<div style={{display:"flex",flexDirection:"column",alignItems:"flex-end"}}>{siblings.map(n => this.renderSiblingLine(n))}</div>:""}
				</div>
			</div>
		</React.Fragment>)
	}
	//Everything that is not an amazon order: a description, a date and an amount, in the row they have
	//always been in.
	renderRegularTile(){
		var txn = this.props.transaction;
		return(<React.Fragment>
			<TxInfoContainer>
				<DS.component.Label highlight style={{textWrap:"wrap",maxWidth:"8rem"}}>{
					txn.description.indexOf("Amazon")>-1 && txn.amount>0?"Amazon Refund":txn.description}</DS.component.Label>
				<div style={{...this.secondaryTextStyle(),marginTop:DS.spacing.xxs+"rem"}}>{utils.formatDateShort(txn.getDisplayDate())}</div>
			</TxInfoContainer>
			<Spacer/>
			<AmountDiv positive={txn.amount>0}>{utils.formatCurrencyAmount(txn.amount,undefined,undefined,undefined,Core.getPreferredCurrency())}</AmountDiv>
		</React.Fragment>)
	}
	render(){
		return(<div>
			<DS.component.ContentTile style={{opacity:this.props.animationIconVisible?0:1, margin:0, boxSizing:"border-box",
					boxShadow:"0px 6px 10px #00000023", padding:DS.spacing.s+"rem",
					transition:"opacity "+disappearAnimationTime/1000+"s ease",
					...(this.isAmazon()
						?{flexDirection:"column",alignItems:"stretch",textAlign:"left",gap:DS.spacing.xs+"rem"}
						:{flexDirection:"row",alignItems:"center",textAlign:"center"})}}>
				{this.isAmazon()?this.renderAmazonTile():this.renderRegularTile()}
			</DS.component.ContentTile>
			{this.props.transaction.reconciliation?<div>{this.renderReconciliation()}</div>:""}
		</div>
	)}
	renderReconciliation(){
		return(<div >
			{this.props.transaction.reconciliation[0]?this.props.transaction.reconciliation[0].credit.map((t,i) => <DS.component.ListItem key={3000+i} noHover size="xs" style={{justifyContent: "space-between"}}>
				<span style={{flexShrink: 1,flexBasis: "auto",textOverflow: "ellipsis",textWrap: "nowrap",overflow: "hidden",paddingRight:"0.5rem"}}><span style={{color: DS.getStyle().positive}}>●</span> Refunded on {utils.formatDateShort(t.date)} · {t.description}</span>
				<span style={{flexShrink: 0,flexBasis: "auto"}}>{utils.formatCurrencyAmount(t.amount,undefined,undefined,false,Core.getPreferredCurrency())}</span>
			</DS.component.ListItem>):<DS.component.ListItem key={0} noHover size="xs" style={{justifyContent: "space-between"}}>
				<span><span style={{color: this.props.transaction.amount>0?DS.getStyle().bodyTextSecondary:DS.getStyle().warning}}>● </span> {this.props.transaction.amount>0?"Missing matching debit":"Awaiting refund"}</span>
				<span></span>
			</DS.component.ListItem>}
		</div>)
	}
}

//price tag sitting in the bottom-right corner of an amazon item picture (see AmazonItemImage). The picture
//tile is always white in both themes, so the chip is dark in both.
const ItemPriceLabel = styled.div`
	position: absolute;
	bottom: 0;
	right: 0;
	background: rgba(0, 0, 0, 0.65);
	color: white;
	font-size: 0.6rem;
	font-weight: 600;
	line-height: 1;
	padding: 0.2rem 0.25rem;
	border-radius: ${DS.borderRadiusSmall} 0 0 0;
`

const fadeInAnimation = keyframes`${fadeIn}`;
const FadeInWrap = styled.div`
	animation: 0.5s ${fadeInAnimation};
`


const AnimationSymbolContainer = styled.div`
    width: calc(100% - ${ActionStyles.cardRemSpacing}rem);
    position: absolute;
    margin-top: 1.5rem;
    transition: opacity ${disappearAnimationTime/1000}s ease, transform ${checkmarkGrowAnimation/1000}s cubic-bezier(0.49, 1.62, 0.58, 0.93);
    opacity: 0;
    display: flex;
    justify-content: center;
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

const Chevron = styled.div`
	border-top: solid ${DS.borderThickness.m}rem ${DS.getStyle().modalPrimaryButton};
	border-right: solid ${DS.borderThickness.m}rem ${DS.getStyle().modalPrimaryButton};
    width:40%;
    height:40%;
    border-radius: 0px;
    transform: rotate(45deg);
    margin-bottom: 0%;
    margin-right: 15%;
`

const AnimationSymbol = styled.div`
    width: 5rem;
    height: 5rem;
    border: solid ${DS.borderThickness.m}rem ${DS.getStyle().modalPrimaryButton};
    opacity:0.8;
    border-radius: 100rem;
    display: flex;
    align-items: center;
    justify-content: center;

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
