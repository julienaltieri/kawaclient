import AppConfig from '../AppConfig'

/* ==================================================================================================
   MONEY FLOW — the data seam.

   The visualisation (components/MoneyFlowEngine.js) consumes one immutable value and reads nothing
   else. This file is the only place that knows about streams, transactions and the reporting
   calendar, and it produces that value:

     buildFlowTree(master, transactions, {from, to, periodName, basis, hubName}) -> FlowTree

   The contract it satisfies is §1 of documentation/money-flow.md. The two rules that make the
   picture possible at all are §1.1 (money in equals money out, kept true by the two synthetic
   streams) and §1.3 (a parent is exactly the sum of its children, so ribbons stack edge to edge
   against the parent's thickness).
   ================================================================================================== */

/* Below a unit of currency a stream is noise: it cannot be seen, its name cannot be read, and it
   still costs a slot in the rail that a stream worth reading needs. Dropping it does not unbalance
   anything - a parent is the sum of what SURVIVED (§1.3), and the difference lands in the residual
   the two synthetic streams already carry (§1.2). */
const MIN_VISIBLE = 1;

/* Which of the three a top-level stream is. Decided by the stream's DEFINITION rather than by what
   happened, so a month in which an income stream saw no money still sits on the income side instead
   of vanishing. This is the same three-way split MasterStreamAuditView already makes when it builds
   the macro graph's analyses — one classification, one place. */
function sideOf(s,at){
	if(s.isSavings)return {side:"out",tone:"savings"};
	return (s.getExpectedAmountAtDate(at)>0) ? {side:"in",tone:"income"} : {side:"out",tone:"expenses"};
}

/* §6.2 of the reporting math, not of the chart: a compound stream that is interest income is left out
   of budgeting unless the flag is on, and CompoundStream.getExpectedAmountAtDateByPeriod already
   drops it. The flow has to drop it in the same place or the two disagree about the total. */
const excluded = s => !s.isTerminal() && s.isInterestIncome && !AppConfig.featureFlags.includeInterestInBudgeting;

/* What each terminal stream saw in the window, as the two quantities the transaction types actually
   distinguish: money in, and money put aside. Which of the two a stream is read by is decided later,
   from the SIDE it was classified on rather than from a flag on the terminal itself — the app only
   depends on `isSavings` being set at the top level (it is what splits the macro graph's three
   analyses), and a savings tree whose leaves did not repeat the flag would otherwise read as zero,
   because money moved to savings carries no "money in" at all. */
function measure(master,transactions,from,to){
	const byId = {};
	master.getAllTerminalStreams().forEach(s => {byId[s.id]={s:s,in:0,saved:0}});
	transactions.forEach(t => {
		if(!t.categorized||!t.streamAllocation)return;
		const d = t.getDisplayDate().getTime();
		if(!(from.getTime()<d&&d<=to.getTime()))return;
		/* only the streams this transaction actually names — the alternative is every stream against
		   every transaction, which is the whole portfolio squared on every render. */
		t.streamAllocation.forEach(al => {
			const e = byId[al.streamId]; if(!e)return;
			e.in += t.moneyInForStream(e.s);
			e.saved += t.savedForStream(e.s);
		});
	});
	return byId;
}

/* Build one side's forest. `sign` is +1 for the in side and -1 for the out side: a stream's signed
   amount is multiplied by it, so what remains is a magnitude, and a stream pointing the wrong way
   (an income stream that net-refunded, say) lands on zero rather than as a blob on the wrong side. */
function buildNode(s,sign,tone,ctx,top,sink){
	if(excluded(s))return null;
	if(s.isTerminal()){
		const m = ctx.measured&&ctx.measured[s.id];
		/* Saving is money leaving the pot, so it points the same way as spending; `savedForStream` is
		   positive when money is put aside, hence the negation. */
		const raw = ctx.basis==="target"
			? (s.getExpectedAmountAtDate(ctx.to,ctx.periodName)||0)
			: (m ? (tone==="savings" ? -m.saved : m.in) : 0);
		const v = raw*sign;
		/* §1.12  A NEGATIVE INFLOW IS AN OUTFLOW. It used to be clamped to zero here and then dropped
		   for being under a unit, which is not a small loss: money that left the account stopped being
		   anywhere in the picture, and since the leftover is computed as in minus out (§1.2), an
		   understated out side made the leftover too big by exactly that much - so the money was not
		   merely missing, it was sitting inside "Unallocated" under someone else's name. On a real
		   portfolio that was four streams and about a fifth of the leftover.

		   A Sankey has no negative flows; it has flows the other way (DECISION-PRINCIPLES.md #26 — the
		   case was already sayable, so nothing new had to be invented to say it). So the stream crosses to the out
		   side keeping its own name and its own amount, and the picture states what it always meant.
		   Only from the IN side: `sink` is passed there and nowhere else, so a negative on the out side
		   still lands on zero as before - money coming back out of savings already has a shape (§1.2's
		   "From reserves") and giving it a second one would say the same thing twice. */
		if(sink&&v<=-MIN_VISIBLE){
			sink.push({id:s.id,name:s.name,tone:"expenses",value:-v,children:null});
			return null;
		}
		if(v<MIN_VISIBLE)return null;                            // §1.4
		return {id:s.id,name:s.name,tone:tone,value:v,children:null,top:top};
	}
	const kids = (s.children||[]).map(c => buildNode(c,sign,tone,ctx,false,sink)).filter(Boolean);
	if(!kids.length)return null;
	/* §1.3  the parent IS the sum of its children. Reading a compound stream's own expected amount
	   here would be a second author for the same quantity, and the two disagree the moment a child is
	   filtered out — which shows as ribbons that overflow their parent's bar. */
	const v = kids.reduce((a,b) => a+b.value,0);
	if(v<MIN_VISIBLE)return null;
	return {id:s.id,name:s.name,tone:tone,value:v,children:kids,top:top};
}

/* ------------------------------------------------------------------------------------------------
   THE SOURCE, COPIED WHOLE.

   Everything the picture is made of comes from two things: the master stream, which says what the
   portfolio IS, and what each terminal saw in the window, which says what happened. Copying the
   engine's trees instead was copying a conclusion - by then this file has already dropped whatever
   it dropped, and the copy cannot answer the one question worth asking when a stream is missing.

   So the export carries the source and nothing derived. The master goes out as the JSON its own
   constructor reads, so it round-trips: `new CompoundStream(snapshot)` is the portfolio again. And
   the measurements go with it, because they are the half the master cannot tell you - unclamped and
   unsigned, exactly as the transactions added up, so a stream that came out NEGATIVE is visible here
   and nowhere else. Two numbers per terminal, and terminals that saw nothing are left out, which
   keeps the whole thing small enough to paste.

   What this replaces is worth naming: a snapshot of names and bands answers the one question it was
   taken for, and the source answers any question, because the bench can rebuild the picture from it
   and then be asked directly. That is the whole trade.
   ------------------------------------------------------------------------------------------------ */
export function masterSnapshot(s){
	if(!s)return null;
	const o = {id:s.id, name:s.name};
	/* a compound derives its period from its children where it was not given one, and `setPeriod`
	   is the one it was actually given - emitting the derived value would invent a fact */
	const p = (s.setPeriod!==undefined&&!s.isTerminal()) ? s.setPeriod : s.period;
	if(p)o.period = p;
	if(s.endDate)o.endDate = new Date(s.endDate).toISOString();
	["isSavings","isInterestIncome","isZeroSumStream","isRoot"].forEach(k => {if(s[k])o[k]=s[k]});
	if(s.isTerminal&&s.isTerminal()){
		o.expAmountHistory = (s.expAmountHistory||[]).map(h =>
			({startDate:new Date(h.startDate).toISOString(), amount:h.amount}));
	}else o.children = (s.children||[]).map(masterSnapshot);
	return o;
}

/* What each terminal actually saw, as the two quantities measure() distinguishes: [moneyIn, saved].
   Rounded to cents, and anything that saw neither is omitted. NOT clamped and NOT signed - which is
   the point, since the sign is what the picture cannot currently draw. */
export function measuredAmounts(master,transactions,from,to){
	const m = measure(master,transactions,from,to), out = {};
	const r2 = v => Math.round(v*100)/100;
	Object.keys(m).forEach(id => {const e = m[id];
		if(r2(e.in)===0&&r2(e.saved)===0)return;
		out[id] = [r2(e.in), r2(e.saved)]});
	return out;
}

/* ------------------------------------------------------------------------------------------------
   WHAT NEVER REACHED THE PICTURE.

   The diagnostics export carries three trees and calls the first of them `raw`, but raw is relative
   to the ENGINE, not to the portfolio: it is what this file HANDED the engine, by which point four
   separate rules have already removed streams. So the one question the export could not answer is
   the one worth asking when a stream is missing - where did it go? - and reading the absence as "the
   picture is hiding it" sends you looking in the layout for something the adapter dropped.

   This walks the same streams the same way and reports only what did NOT survive, with the reason.
   Only the losers, because the export has to fit in a paste: a full audit of a real portfolio runs
   to tens of thousands of characters and gets truncated exactly where the interesting part is.

   Four ways a stream disappears, all of them here:
     - it is a compound interest-income stream and the flag is off (`excluded`);
     - its signed amount is NEGATIVE and it is on the OUT side, where the clamp still applies (§1.12
       moved the in side's negatives to Income Expenses instead, and those are reported under `moved`
       rather than here, because they are drawn);
     - it is worth less than one unit of currency (§1.4);
     - it is compound and nothing under it survived, so it has nothing to be the sum of.
   ------------------------------------------------------------------------------------------------ */
export function flowAudit(master,transactions,o){
	const ctx = {to:o.to,periodName:o.periodName,basis:o.basis,
		measured:o.basis==="target" ? null : measure(master,transactions,o.from,o.to)};
	const r2 = v => Math.round(v*100)/100;
	const dropped = [], moved = [];
	let kept = 0;
	/* returns whether anything under `s` survived, so a compound can report the same verdict the
	   builder reaches without the two going out of step */
	const walk = (s,sign,tone,parent) => {
		const note = (why,signed) => {dropped.push({id:s.id, name:s.name, parent:parent,
			side:sign>0?"in":"out", tone:tone, terminal:s.isTerminal(),
			amount:signed===undefined?null:r2(signed), why:why})};
		if(excluded(s)){note("compound interest income, and the flag is off"); return false}
		if(s.isTerminal()){
			const m = ctx.measured&&ctx.measured[s.id];
			const raw = ctx.basis==="target"
				? (s.getExpectedAmountAtDate(ctx.to,ctx.periodName)||0)
				: (m ? (tone==="savings" ? -m.saved : m.in) : 0);
			const signed = raw*sign;
			/* §1.12  an in-side negative is not lost any more, it crosses to Income Expenses - but it
			   does not keep its parent alive on the in side, so this returns false exactly as the
			   builder drops it from that branch. Reported apart from the losers, because it IS drawn. */
			if(signed<0&&sign>0){moved.push({id:s.id, name:s.name, parent:parent,
				amount:r2(-signed), to:"Income Expenses"}); return false}
			if(signed<0){note("negative on the out side — clamped to zero (§1.12 covers the in side only)",signed); return false}
			if(signed<MIN_VISIBLE){note("under one unit of currency",signed); return false}
			kept++; return true;
		}
		/* every child is walked before the parent is judged, so the list reads top-down and a whole
		   dead branch reports each of its members rather than only its root */
		const alive = (s.children||[]).map(c => walk(c,sign,tone,s.name)).filter(Boolean).length;
		if(!alive){note("nothing under it survived"); return false}
		kept++; return true;
	};
	(master.children||[]).forEach(s => {const c = sideOf(s,o.to);
		walk(s, c.side==="in"?1:-1, c.tone, "(portfolio)")});
	return {kept:kept, dropped:dropped, moved:moved};
}

const sum = a => a.reduce((x,y) => x+y.value,0);

/**
 * @param {CompoundStream} master   the portfolio root
 * @param {GenericTransaction[]} transactions  categorized transactions; filtered to the window here
 * @param {Object} o  {from, to, periodName:"yearly"|"monthly", basis:"actual"|"target", hubName}
 * @returns {{hubName:string, in:Array, out:Array, inTotal:number}}
 */
export function buildFlowTree(master,transactions,o){
	const ctx = {to:o.to,periodName:o.periodName,basis:o.basis,
		measured:o.basis==="target" ? null : measure(master,transactions,o.from,o.to)};
	let ins = [], outs = [];
	/* §1.12  where the in side's negatives are gathered as they are found */
	const costs = [];
	(master.children||[]).forEach(s => {
		const c = sideOf(s,o.to);
		/* §9.6  the master's children are the macro categories, and the type says so. Nothing below
		   them is one - including the income streams that step up a level when the single income group
		   is unwrapped just below. */
		const n = buildNode(s,c.side==="in"?1:-1,c.tone,ctx,true,c.side==="in"?costs:null);
		if(n)(c.side==="in"?ins:outs).push(n);
	});
	/* The hub IS the total money in, so a single top-level income group standing in front of it is a
	   level that says nothing: the picture would read Income -> Income -> Salary. Where the in side is
	   one compound stream, its children become the roots and it lends the hub its name. Where it is
	   several, they are the roots and the hub keeps the caller's name. */
	let hubName = o.hubName||"Income";
	if(ins.length===1&&ins[0].children){hubName=ins[0].name;
		ins=ins[0].children.map(n => Object.assign({},n,{top:false}))}

	/* §1.12  AND THEY ARRIVE AS ONE CATEGORY OF THEIR OWN. Sent back to the parents they came from,
	   an income group would appear on both sides at once - "Activity Income" as a thing earned and as
	   a thing spent - which reads as a contradiction rather than as a cost. Gathered instead into one
	   macro category beside the others, the statement is the plain one: this is what earning the money
	   cost. They keep their own names inside it, so the tax that belongs to a gig and the outlay that
	   belongs to a venture are still told apart. Biggest first, like every other set (§3.2). */
	if(costs.length)outs.push({id:"__incomeCosts", name:"Income Expenses", tone:"expenses", top:true,
		value:sum(costs), children:costs.slice().sort((a,b) => b.value-a.value)});

	/* §1.1 §1.2  money in equals money out, and these two are what keep it true. What is left after
	   spending and deliberate saving is unallocated — still savings, just without a stream yet. When
	   the outflow is the larger, the shortfall is not negative saving: it is money that came from
	   somewhere these streams do not describe. */
	const inTot = sum(ins), outTot = sum(outs), res = inTot-outTot;
	/* §1.2  BOTH LEFTOVERS ARE NAMED. The unallocated band went unlabelled at first, on the reasoning
	   that it is not a stream anyone named or budgeted and a caption on it competes for the rail with
	   the streams that were. But an unexplained band is a worse trade than a crowded rail: money that
	   came in and went nowhere is one of the more useful things the picture can say, and saying it
	   with a blank was leaving the reader to work out what the gap meant. Money from reserves was
	   named from the start, for the same reason read the other way round. */
	if(res>=MIN_VISIBLE){
		const u = {id:"__unallocated",name:"Unallocated",tone:"savings",value:res,children:null};
		/* §1.2  AND IT GOES INSIDE SAVINGS. At the top level it was a leaf standing where every one of
		   its neighbours is a category, so the picture read it as one: named inside its own band, and
		   without the amount that every end of a branch carries. Teaching the layout to make an
		   exception of it meant a rule in the geometry for a single band. As a child of the thing it
		   already belongs to - it IS savings, just without a stream yet - it is an ordinary terminal
		   stream, and takes its place in the tier, its amount and its tap from simply being one.
		   Only where that category HAS children: nested under a leaf, the parent would stop being the
		   sum of its children (§1.3), so there it stays at the top level as before. */
		const sav = outs.filter(n => n.tone==="savings"&&n.children&&n.children.length)[0];
		if(sav){sav.children = sav.children.concat([u]); sav.value += res}
		else outs.push(u);
	}
	/* §6.5  `outside` says there is more behind this stream than the picture models. From reserves is
	   money drawn from savings the flow does not show, so it TRAILS OFF like a stream with children
	   rather than stopping dead - it has no children, and cut hard among neighbours that do have them
	   it left a notch in the edge of the picture exactly where it sat. */
	else if(res<=-MIN_VISIBLE)ins.push({id:"__reserves",name:"From reserves",tone:"alert",
		value:-res,children:null,outside:true});
	return {hubName:hubName,in:ins,out:outs,inTotal:Math.max(inTot,outTot)};
}
