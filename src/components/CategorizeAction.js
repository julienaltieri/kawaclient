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

//Beyond this the inversion below stops being worth running; an order that resists it this hard is one whose
//items were almost certainly not what the split was made from.
const maxStepsForAllocationInversion = 50000;

//Reading an item-wise split back out of the allocations it produced.
//
//streamAllocation records stream and amount and nothing about items, so the model cannot say which item
//went where. But if the split was MADE item by item then every allocation is exactly the sum of some subset
//of this charge's item prices, and that assignment can be recovered by inverting the sum. Nothing is stored
//and nothing is asked of the backend: this is inference over what is already there.
//
//Unique or refuse, the same rule the order resolution follows and for the same reason - two items priced
//alike on two different streams have two equally good readings, and a wrong one looks exactly like a right
//one once it is a picture with a stream name beside it. The caller falls back to the amount-based rows,
//which know less and say so.
//
//Returns a streamId per item, aligned with `prices`, or undefined.
export const mapAllocationsToItems = (prices,allocations,transactionAmount) => {
	if(!prices?.length || !allocations?.length)return undefined
	if(!allocations.every(al => !!al.streamId))return undefined
	//one allocation covers everything there is, so there is nothing to infer and nothing to be wrong about.
	//This is the common case - a charge categorized from a stream chip carries a single percent allocation -
	//and it is handled before any arithmetic so a rounding cent cannot cost it the item view.
	if(allocations.length===1)return prices.map(() => allocations[0].streamId)
	if(!prices.every(pr => pr>0))return undefined

	//percent allocations are relative to the charge; value allocations already carry its sign
	var caps = allocations.map(al => Math.abs(al.type==="percent"?(al.amount||0)*(transactionAmount||0):(al.amount||0)));
	if(!caps.every(c => c>0))return undefined
	var cents = prices.map(pr => Math.round(pr*100)), left = caps.map(c => Math.round(c*100));
	if(utils.sum(cents,c => c)!==utils.sum(left,c => c))return undefined

	//biggest item first: it is the one with the fewest places to go, so a dead end is reached sooner
	var order = cents.map((c,i) => i).sort((a,b) => cents[b]-cents[a]);
	var assign = new Array(cents.length), found, steps = 0, ambiguous = false;
	var walk = (k) => {
		if(ambiguous)return
		if(++steps>maxStepsForAllocationInversion){ambiguous = true;return}//out of budget is not the same as
		if(k===order.length){                                             //no answer, so it declines too
			if(found)return void (ambiguous = true)
			found = [...assign];
			return
		}
		var i = order[k];
		for(var a=0;a<left.length && !ambiguous;a++){
			if(left[a]<cents[i])continue
			left[a] -= cents[i]; assign[i] = a;
			walk(k+1);
			left[a] += cents[i]; assign[i] = undefined;
		}
	}
	walk(0);
	return (ambiguous || !found)?undefined:found.map(a => allocations[a].streamId)
}

//This charge's items, their prices, and - when the existing split can be read back - the stream each item
//is on. `streamIds` is undefined when there is no split yet or when it could not be inverted; the caller
//shows empty rows in the first case and the amount-based view in the second.
export const getAmazonItemSplit = (transaction) => {
	var charge = getAmazonChargeItems(transaction);
	if(!charge)return undefined
	var existing = transaction?.streamAllocation;
	return {...charge, streamIds: existing?.length
		?mapAllocationsToItems(charge.prices,existing,transaction.amount)
		:undefined}
}

//The order's charges Amazon's ledger says exist but no posted bank debit accounts for yet, as positive
//amounts - restricted to the ones that are actually a SHIPMENT still coming, not a payment artifact.
//Without the ledger there is no way to know what is missing at all - a bank posting slower than usual
//would look identical to an order that was only ever billed once - and inventing a pending charge in that
//case would be worse than omitting one, so an order with no ledger simply shows none.
export const getAmazonUnpostedCharges = (transaction) => {
	var amz = getAmazonOrderData(transaction);
	if(!amz)return []
	var ledger = (amz.transactions||[]).filter(t => t.amount>0).map(t => utils.round2Decimals(t.amount));
	if(!ledger.length)return []
	var posted = (Core.getTransactionsForOrderNumber(amz.orderNumber)||[])
		.filter(t => t.amount<0).map(t => utils.round2Decimals(-t.amount));
	//multiset difference: each posted debit cancels exactly one matching ledger entry, so two ledger
	//entries of the same amount with only one posted correctly leave the other as unposted
	var remaining = ledger.slice();
	posted.forEach(p => {
		var at = remaining.findIndex(c => Math.abs(c-p)<0.005);
		if(at>-1)remaining.splice(at,1);
	});
	//A pending PAGE is a shipment that hasn't arrived, and a shipment is defined by the items waiting on
	//it - not by the arithmetic that produced its amount. A gift card or a discount also leaves an amount
	//the posted debits don't cover, but that amount is how the order was paid, not something still coming,
	//and the difference above can't tell the two apart on its own. Asking the order's own item resolution
	//is what can: a leftover that resolves to real items is a shipment; one that resolves to none is a
	//payment artifact and gets no page.
	return remaining.filter(amount => {
		var stub = {amount:-amount, amazonOrderDetails:transaction.amazonOrderDetails};
		return getAmazonChargeItems(stub)?.items?.length>0
	})
}

//Whether a refund has arrived is a fact about the ORDER, not the one charge on screen: a charge's own
//`reconciliation` used to answer this, but that property is stamped onto exactly one transaction object -
//whichever one the reader clicked in the analysis view (AnalysisView.js:199) - so every sibling charge in
//the same order never had it, and the queue's dialog deliberately clears it (see openDialog below), which
//meant nothing shown there could ever go green. The order's own credits (same orderNumber as the charge
//they refund) are visible from every context, so reading those instead works everywhere the amber dot does.
//
//Resolved once per order rather than per charge, for the reason 6 and 7 in DECISION-PRINCIPLES.md are both
//about: an item's refund state is a property of the item, and must come out the same regardless of which
//charge you happened to open to ask about it.
//
//Memoised, because a charge deck renders every charge of an order in one pass and each asks this same
//question - without the cache, an order's debits would be walked (and each re-split item by item) once
//per charge shown instead of once.
var orderRefundMemo = {signature:undefined,expecting:undefined};
const getOrderRefundAttribution = (orderNumber) => {
	if(!orderNumber)return undefined
	var order = Core.getTransactionsForOrderNumber(orderNumber)||[];
	if(!order.length)return undefined
	//cheap enough to recompute every render, but not free - a signature over what the order actually
	//holds lets an unchanged order answer from the last pass instead
	var signature = orderNumber+"|"+order.map(t => (t.getTransactionHash?.()||"")+":"+t.amount).join(",");
	if(orderRefundMemo.signature===signature)return orderRefundMemo.expecting

	//every item of the order sitting on a zero-sum stream, wherever its own charge lives among the order's
	//several bank charges - the same split the item-wise view already computes, just walked across all of
	//them instead of the one on screen
	var expecting = [];
	order.filter(t => t.amount<0).forEach(t => {
		var split = getAmazonItemSplit(t);
		var streamIds = split?.streamIds;
		if(!streamIds?.length)return
		streamIds.forEach((id,i) => {
			if(id && Core.getStreamById(id)?.isZeroSumStream)
				expecting.push({hash:t.getTransactionHash?.(),itemIndex:i,price:split.prices[i],state:"await",date:undefined});
		});
	});

	var credits = order.filter(t => t.amount>0);
	if(credits.length){
		//credits get consumed by object reference as each pass below places them, so a later pass sees
		//only what the earlier ones left over - once a credit is spent on an answer it cannot also fund
		//the honest-fallback verdict at the bottom.
		var consumed = new Set();

		//one item expected across the whole order and at least one credit: there is nothing to confuse it
		//with, so the amounts need not agree - a credit often carries shipping or tax the item's own share
		//never carried.
		if(expecting.length===1){
			expecting[0].state = "back"; expecting[0].date = credits[0].date; consumed.add(credits[0])
		//several candidates: what a credit actually pays for is a SUBSET of what's still awaiting, not one
		//item's price - two socks refunded by a single credit are a subset of size two, and comparing the
		//credit to one price at a time is the narrowing that missed them. Unique subset or refuse is the
		//same rule as the single-item case above: two items priced alike make more than one subset add up,
		//and naming either puts "refunded" under a picture of something still owned.
		//
		//Cents, not dollars, so floating point dust never decides a match. Largest credit first, so a big
		//credit that resolves several items settles before a small, ambiguous one could pre-empt it. Above
		//maxItemsForChargeInference candidates the walk is exponential and not worth running, the same
		//guard the charge-assignment search above already uses.
		}else{
			var awaiting = expecting.filter(e => e.state==="await");
			//Several matching subsets are not always several readings. Principles 9 and 10 in
			//DECISION-PRINCIPLES.md are why: 9 refuses when a wrong pick would be indistinguishable from a
			//right one, but 10 is its counterweight and overrides 9 here - when EVERY matching subset settles
			//the identical sorted list of prices, there is no wrong pick left to protect against, only a
			//refund that has in fact arrived and that refusing would hide. Whichever physical item the credit
			//actually paid for, the same prices end up marked back, so the first (lowest bitmask, i.e. the
			//earliest items) is taken exactly as a unique match would be. The gate is equality of what is
			//SETTLED, nothing looser - a $20 item and a $10+$10 pair both summing to $20 settle different
			//lists and still refuse.
			var settledPriceKey = entries => entries.map(e => Math.round(e.price*100)).sort((a,b) => a-b).join(",");
			//Set the moment a credit refuses on genuine ambiguity - matches that settle DIFFERENT price lists,
			//not just several of them. The honest-fallback below reads this to tell that shape apart from a
			//credit that simply matched no subset at all, which is a different fact and must not collapse into
			//the same label (see the comment on the fallback for why).
			var ambiguousSubsetSeen = false;
			if(awaiting.length && awaiting.length<=maxItemsForChargeInference){
				credits.slice().sort((a,b) => Math.abs(b.amount)-Math.abs(a.amount)).forEach(credit => {
					var live = expecting.filter(e => e.state==="await");
					var target = Math.round(Math.abs(credit.amount)*100);
					var full = (1<<live.length)-1, matches = [];
					for(var mask=1;mask<=full;mask++){
						var sum = 0;
						for(var i=0;i<live.length;i++){if(mask&(1<<i))sum += Math.round(live[i].price*100)}
						if(sum===target)matches.push(mask)
					}
					//matches is built walking mask upward from 1, so matches[0] is already the lowest bitmask -
					//"first" deterministically, never dependent on iteration order elsewhere.
					if(matches.length){
						var maskEntries = mask => live.filter((e,i) => mask&(1<<i));
						var firstKey = settledPriceKey(maskEntries(matches[0]));
						if(matches.every(m => settledPriceKey(maskEntries(m))===firstKey)){
							consumed.add(credit);
							live.forEach((e,i) => {if(matches[0]&(1<<i)){e.state = "back"; e.date = credit.date}})
						}else{
							ambiguousSubsetSeen = true
						}
					}
				});
			}
		}

		//A credit consumed by nothing above is still money that arrived, but "unplaceable" is not one fact -
		//it is two, and DECISION-PRINCIPLES.md 11 (degrade honestly) means telling them apart rather than
		//collapsing both into the same label.
		//
		//A credit that matched several subsets settling DIFFERENT prices (ambiguousSubsetSeen) demonstrably
		//arrived and still cannot be placed - that really is "unknown", and the charge falls back to its
		//charge-level strip, which can say only what this case supports.
		//
		//A credit that matched no subset at all is a different shape entirely - a fee, a partial adjustment,
		//a bad match on the wrong order. A third pass used to walk every still-unplaced charge and accept
		//one whose OWN total happened to add up to what was left over; it has been deleted, because it
		//read that coincidence as evidence the charge's items themselves came back. It never was: two credits
		//summing to a charge's total by chance is not the same fact as a credit that resolves to an item, and
		//resolving it silently hid exactly the shape worth a second look - a fee, a partial adjustment, or a
		//credit matched to the wrong order. So this shape now stays "await" - amber, deliberately left as a
		//flag for the reader to look at rather than a silent resolution. Nothing legitimate is lost: two
		//same-priced items, or two same-priced charges, refunded by one credit are both several subsets
		//settling the same amounts, and the pass 2 tie-break above already catches both on its own.
		if(credits.some(c => !consumed.has(c)) && ambiguousSubsetSeen){
			expecting.forEach(e => {if(e.state==="await")e.state = "unknown"})
		}
	}

	orderRefundMemo = {signature,expecting};
	return expecting
}

//Where each of this charge's items has got to on a refund stream: "await", "back", or nothing.
//
//An item allocated to a zero-sum stream with no credit against it yet IS the awaiting state - nothing else
//records it, and no extra data is needed to say so, which is why this half works everywhere including the
//queue's dialog. Whether a credit has ARRIVED is answered by getOrderRefundAttribution above; a missing
//order, an order with no charges on file, or this charge not turning up in it all fall back to leaving
//every item awaiting, which is less than the truth rather than different from it.
export const getAmazonItemRefundStates = (transaction,split) => {
	var streamIds = split?.streamIds;
	if(!streamIds?.length)return undefined
	var states = streamIds.map(id => (id && Core.getStreamById(id)?.isZeroSumStream)?{state:"await"}:undefined);
	if(!states.some(st => !!st))return undefined
	var expecting = getOrderRefundAttribution(getAmazonOrderData(transaction)?.orderNumber);
	if(!expecting?.length)return states
	var hash = transaction?.getTransactionHash?.();
	//a credit arrived for this charge but couldn't be pinned to one of its items ("unknown", not "await") -
	//per-item dots would still claim nothing came back, which is false, so the whole charge is handed back
	//to the caller's existing "no item story here" fallback: the charge-level refund strip, which is able
	//to say only what this case actually supports.
	if(expecting.some(e => e.hash===hash && e.state==="unknown"))return undefined
	return states.map((st,i) => {
		if(!st)return st
		var entry = expecting.find(e => e.hash===hash && e.itemIndex===i);
		return entry?.state==="back"?{state:"back",date:entry.date}:st
	})
}

//True when this transaction can be split item by item: we know which items it paid for. One item is enough -
//the row is still where its stream and its refund state are said, and a single-item charge that dropped to
//the amount-based view would be the one charge in an order whose rows looked different from its siblings'.
//Unpriced orders (amazon fresh, digital) and charges whose item subset can't be pinned down fall back to
//the amount-based split.
export const canSplitAmazonByItem = (transaction) => {
	var charge = getAmazonChargeItems(transaction);
	return !!charge && charge.items.length>0
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
		{props.price>0?<ItemPriceLabel>
			{/*the dot rides inside the chip rather than sitting loose on the picture: product shots are
			   pale and a small mark on top of one gets lost, while the chip is dark in both themes. The
			   rule goes through the price alone - across the whole chip it would strike the dot too.*/}
			{props.refund?<span style={{width:"0.4rem",height:"0.4rem",borderRadius:"50%",flexShrink:0,
				background:props.refund.state==="back"?DS.getStyle().positive:DS.getStyle().warning}}/>:""}
			<span style={{textDecoration:props.refund?.state==="back"?"line-through":"none"}}>
				{utils.formatCurrencyAmount(props.price,2,true,true,Core.getPreferredCurrency())}</span>
		</ItemPriceLabel>:""}
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
	//The refund strip is a statement about one zero-sum stream's analysis, and the queue has no stream in
	//view, so there is none to show here. Clearing it is what stops a strip left on the transaction by a
	//previous visit to the analysis view from turning up in the queue's dialog.
	openDialog(title,transaction,streamRecs,options){
		transaction.reconciliation = undefined;
		return Core.presentModal(ModalTemplates.ModalWithStreamAllocationOptions(title,undefined,undefined,transaction,streamRecs,options))
	}
	//What a dialog answered with, in the one shape both kinds return: a charge and the allocations for it.
	//An order opened as a deck answers for every charge it holds; anything else answers for the one it was
	//given. Charges the reader never touched come back with nothing and are dropped here rather than being
	//written as an empty categorization.
	answeredCharges(state,fallback){
		var charges = state?.charges||[fallback], allocations = state?.allocationsByCharge||[state?.allocations];
		var out = {charges:[],allocations:[]};
		charges.forEach((t,i) => {
			if(!t || !allocations[i]?.length)return
			out.charges.push(t); out.allocations.push(allocations[i]);
		});
		return out
	}
	onEditClicked(transaction){
		var target = transaction||this.props.transaction;
		return this.openDialog("Edit",target,[]).then(({state,buttonIndex}) => {
			if(buttonIndex!=1)return
			var answered = this.answeredCharges(state,target);
			if(answered.charges.length)this.props.appContext.onCategorizationUpdate(answered.charges,answered.allocations)
		}).catch(e => {})
	}
	//An Amazon order billed as several charges puts several cards in this queue, and the split dialog holds
	//all of them at once - so one confirmation answers the lot. Concluding the action with every charge it
	//covered is what takes their queue cards with it: categorizeTransactions consumes the queue action of
	//each transaction it categorizes, which is the same path a stream chip already takes for an order.
	//Charges already categorized are in that list too, and need no special handling here - the commit rail
	//keys each one on transactionId or id depending on whether it was categorized already.
	onSplitClicked(transaction){
		var target = transaction||this.props.transaction;
		//requireAll: every charge of this order is queued work, and leaving one behind recreates the
		//half-answered order the deck exists to prevent
		return this.openDialog("Split",target,this.state.recStreams,{requireAll:true}).then(({state,buttonIndex}) => {
			if(buttonIndex!=1)return
			var answered = this.answeredCharges(state,target);
			if(!answered.charges.length)return
			//this card's own transaction has to be among them for the card to conclude; if the reader
			//answered only siblings, they are saved and the card stays where it is
			if(answered.charges.indexOf(this.props.transaction)>-1)
				this.props.parentAction.onActionConcluded(this.props.parentAction,answered.charges,answered.allocations)
			else this.props.appContext.onCategorizationUpdate(answered.charges,answered.allocations)
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
			<TransactionView animationIconVisible={this.state.animationIconVisible} transaction={this.props.transaction}/>

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
	//A plain element rather than DS.component.Label, so the box, the clamp, the animated height and the tap
	//target are one thing whose size nothing else gets a say in. The Label sets text-wrap:nowrap,
	//overflow-x:clip and a font size that resolves to nothing - all of which had to be overridden here
	//anyway - and leaving the size to be inherited made the two-line height below a guess: get it wrong and
	//the box is shorter than the text it is showing, which is a tap target that ends before the words do.
	//It takes its colour and size from the same tokens the Label would have given it.
	renderItemName(text){
		var open = this.state.nameOpen;
		var collapsed = nameCollapsedLines*nameLineHeight*DS.fontSize.body+"rem";
		return <div title={open?undefined:text}
			onClick={(e) => {e.stopPropagation();this.toggleName(e.currentTarget)}}
			onTransitionEnd={() => {if(!this.state.nameOpen && !this.state.nameClamped)this.updateState({nameClamped:true})}}
			style={{...tappableStyle,width:"100%",boxSizing:"border-box",overflow:"hidden",
				color:DS.getStyle().bodyText,fontSize:DS.fontSize.body+"rem",lineHeight:nameLineHeight,
				maxHeight:(open && this.state.nameHeight)?this.state.nameHeight+"px":collapsed,
				transition:"max-height "+nameOpenAnimationTime/1000+"s ease",
				...(this.state.nameClamped?{display:"-webkit-box",WebkitBoxOrient:"vertical",WebkitLineClamp:nameCollapsedLines}:{})}}>{text}</div>
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
	//aligned with it so the two read as one column of money.
	//
	//Inert, always. These lines appear only on a queue card now, where you are answering one charge at a
	//time and jumping to a sibling mid-flow is what creates the states nothing downstream handles - one
	//charge split and the other not. Inside a dialog the charges are pages of a deck instead, so there is
	//nothing left for a tappable line to do. Nothing is underlined, because nothing opens: the cue and the
	//behaviour cannot disagree if there is only one of them.
	renderSiblingLine(n){
		return <div key={n.getTransactionHash()}
			style={{...this.secondaryTextStyle(),marginTop:DS.spacing.xxs+"rem",cursor:"default"}}>
			and {utils.formatCurrencyAmount(n.amount,undefined,undefined,undefined,Core.getPreferredCurrency())} on {utils.formatDateShort(n.getDisplayDate())}
		</div>
	}
	//The product picture, with the carousel under it when this charge covers more than one item.
	//Two rules, kept independent of each other on purpose:
	//  the carousel appears only when this charge covers more than one item;
	//  the per-item price tags appear only when the carousel does.
	//A charge covering one item has that item's price on display already - it is the transaction amount
	//beside the picture - so a tag would only repeat it. Tying the tag to the carousel rather than to
	//whether a price happens to be known is what stops the two from drifting apart.
	//The carousel prices its items only where a per-item price could change what you do next - which means
	//inside a dialog, and only there. On a queue card you are answering the whole charge, so no decision
	//turns on what one item cost and the tag is decoration on top of a picture. Inside the deck it earns
	//its place only when the rows below are NOT already item-wise: where they are, `pricedBelow` is set and
	//the tag would say the same number twice; where they fell back to amounts, it is the only place an
	//item's own price appears.
	renderAmazonPicture(shownItems,prices,showCarousel){
		var priced = showCarousel && !!this.props.inDeck && !this.props.pricedBelow;
		return <div style={{marginRight:DS.spacing.xs+"rem",flexShrink:0}}>
			<div style={{position:"relative",display:"flex",width:DS.spacing.xl+"rem",overflow:"hidden",borderRadius:DS.borderRadiusSmall}}>
				{shownItems.map((it,i) =>
					<AmazonItemImage key={i} item={it} price={priced?prices[i]:undefined} size={DS.spacing.xl} style={{
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
		var split = getAmazonItemSplit(this.props.transaction);
		var shownItems = split?split.items:(amz?.items||[]);
		var prices = split?split.prices:getAmazonItemPrices(amz,amz?.orderAmount);
		var showCarousel = shownItems.length>1;
		//Inside a deck the order is named once above it and the siblings ARE the other pages, so neither
		//belongs on the tile; on a queue card there is no deck, and both are how you tell one charge of an
		//order from another.
		var inDeck = !!this.props.inDeck;
		var siblings = inDeck?[]:(this.getAmazonNeighbors()||[]).filter(n => !this.isCurrentTransaction(n));
		//always the transaction being shown, never the order's net. Summing the order's transactions was
		//defensible while they were all charges, but a refund carries the same orderNumber, so the sum
		//silently became "what the order cost after returns" - a number matching neither the allocations
		//below it nor any real transaction. The sibling lines give the context instead.
		var amount = this.props.transaction.amount;
		//The rows below only show refund state per item when this prop is set - so only then is the
		//headline allowed to net an item's price back out, and only then is doing so honest: elsewhere
		//(a queue card) nothing on screen explains why the amount reads smaller than the transaction, so
		//it would just look wrong.
		if(this.props.refundShownOnItems){
			var refundStates = getAmazonItemRefundStates(this.props.transaction,split);
			var refundedTotal = utils.sum((refundStates||[]).map((st,i) => st?.state==="back"?prices[i]:0));
			if(refundedTotal)amount = utils.round2Decimals(amount+refundedTotal);
		}
		return(<React.Fragment>
			{inDeck?"":this.renderAmazonIdentity(amz)}
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
					{/*a pending charge has no date to show, but the slot keeps its height with a non-breaking
					   space rather than collapsing, so the tile holds the same shape as a posted one*/}
					<div style={{...this.secondaryTextStyle(),marginTop:DS.spacing.xxs+"rem"}}>{this.props.pending?" ":utils.formatDateShort(this.props.transaction.getDisplayDate())}</div>
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
			{/*a pending charge is outlined instead of filled so it reads as less certain than the posted
			   charges around it - an outline on top of the fill would read as MORE important, backwards
			   for something that hasn't happened yet. The two opacities multiply rather than one replacing
			   the other, so a pending tile that is also animating out still fades.*/}
			<DS.component.ContentTile style={{opacity:(this.props.animationIconVisible?0:1)*(this.props.pending?0.5:1), margin:0, boxSizing:"border-box",
					boxShadow:"0px 6px 10px #00000023", padding:DS.spacing.s+"rem",
					transition:"opacity "+disappearAnimationTime/1000+"s ease",
					...(this.isAmazon()
						?{flexDirection:"column",alignItems:"stretch",textAlign:"left",gap:DS.spacing.xs+"rem"}
						:{flexDirection:"row",alignItems:"center",textAlign:"center"}),
					...(this.props.pending
						?{background:"transparent",border:"1px solid "+DS.getStyle().bodyTextSecondary,boxShadow:"none"}
						:{})}}>
				{this.isAmazon()?this.renderAmazonTile():this.renderRegularTile()}
			</DS.component.ContentTile>
			{/*the strip is the charge-level way of saying what the item rows now say per item, so where those
			   rows are carrying it this would be the same statement twice - and the vaguer of the two*/}
			{(this.props.transaction.reconciliation && !this.props.refundShownOnItems)?<div>{this.renderReconciliation()}</div>:""}
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
	display: flex;
	align-items: center;
	gap: 0.2rem;
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


//The checkmark played over the card as it leaves. It is decoration and nothing in it is ever aimed at, but
//it is absolutely positioned over the card and only ever hidden by opacity - which stops it being seen and
//not being hit. A 5rem circle sat over the middle of the tile the whole time, so a tap that landed inside it
//went to the checkmark instead of whatever it looked like it was on: taps on the item name worked or did not
//depending on which part of the words the finger found.
const AnimationSymbolContainer = styled.div`
    width: calc(100% - ${ActionStyles.cardRemSpacing}rem);
    position: absolute;
    margin-top: 1.5rem;
    transition: opacity ${disappearAnimationTime/1000}s ease, transform ${checkmarkGrowAnimation/1000}s cubic-bezier(0.49, 1.62, 0.58, 0.93);
    opacity: 0;
    pointer-events: none;
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
