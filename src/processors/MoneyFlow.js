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
function buildNode(s,sign,tone,ctx){
	if(excluded(s))return null;
	if(s.isTerminal()){
		const m = ctx.measured&&ctx.measured[s.id];
		/* Saving is money leaving the pot, so it points the same way as spending; `savedForStream` is
		   positive when money is put aside, hence the negation. */
		const raw = ctx.basis==="target"
			? (s.getExpectedAmountAtDate(ctx.to,ctx.periodName)||0)
			: (m ? (tone==="savings" ? -m.saved : m.in) : 0);
		const v = Math.max(0,raw*sign);
		if(v<MIN_VISIBLE)return null;                            // §1.4
		return {id:s.id,name:s.name,tone:tone,value:v,children:null};
	}
	const kids = (s.children||[]).map(c => buildNode(c,sign,tone,ctx)).filter(Boolean);
	if(!kids.length)return null;
	/* §1.3  the parent IS the sum of its children. Reading a compound stream's own expected amount
	   here would be a second author for the same quantity, and the two disagree the moment a child is
	   filtered out — which shows as ribbons that overflow their parent's bar. */
	const v = kids.reduce((a,b) => a+b.value,0);
	if(v<MIN_VISIBLE)return null;
	return {id:s.id,name:s.name,tone:tone,value:v,children:kids};
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
	(master.children||[]).forEach(s => {
		const c = sideOf(s,o.to);
		const n = buildNode(s,c.side==="in"?1:-1,c.tone,ctx);
		if(n)(c.side==="in"?ins:outs).push(n);
	});
	/* The hub IS the total money in, so a single top-level income group standing in front of it is a
	   level that says nothing: the picture would read Income -> Income -> Salary. Where the in side is
	   one compound stream, its children become the roots and it lends the hub its name. Where it is
	   several, they are the roots and the hub keeps the caller's name. */
	let hubName = o.hubName||"Income";
	if(ins.length===1&&ins[0].children){hubName=ins[0].name;ins=ins[0].children}

	/* §1.1 §1.2  money in equals money out, and these two are what keep it true. What is left after
	   spending and deliberate saving is unallocated — still savings, just without a stream yet. When
	   the outflow is the larger, the shortfall is not negative saving: it is money that came from
	   somewhere these streams do not describe. */
	const inTot = sum(ins), outTot = sum(outs), res = inTot-outTot;
	/* The leftover carries no label. It is not a stream anyone named or budgeted - it is the width
	   between what came in and what was accounted for - and a caption on it competes for the rail
	   with the streams that were. Money from reserves DOES keep its name: it is the alert colour and
	   the exceptional case, and an unexplained red band would be worse than none. */
	if(res>=MIN_VISIBLE)outs.push({id:"__unallocated",name:"Unallocated",tone:"savings",
		value:res,children:null,label:false});
	else if(res<=-MIN_VISIBLE)ins.push({id:"__reserves",name:"From reserves",tone:"alert",
		value:-res,children:null});
	return {hubName:hubName,in:ins,out:outs,inTotal:Math.max(inTot,outTot)};
}
