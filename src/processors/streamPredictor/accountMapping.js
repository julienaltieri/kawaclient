/* ==================================================================================================
   §1 OF THE STREAM PREDICTION SPEC - MAPPING ACCOUNTS TO STREAMS.

   THIS FILE REACHES ONLY FOR IMPORT-FREE DATA, for the reason BankBalance.js does: the arithmetic
   here has to be checkable, and a module that reaches for model.js or Core can only be run inside a
   browser with a logged-in user. Everything arrives as PLAIN JSON shaped like the captured portfolio
   fixture, never as a model instance, so the whole stage can be driven from a bench under node.

   Bank.js is the one exception, and it imports nothing itself. Account typing is asked and answered
   in exactly one place; a second copy of the rule here would go stale the first time a user changes
   a dropdown.
   ================================================================================================== */

import {AccountTypes, effectiveAccountType} from '../../Bank';

/* WHAT A STREAM'S ACCOUNT MEANS FOR A FORECAST, WHICH IS NOT WHAT THE BANK CALLS IT.

   Money leaving a checking or a savings account has left NOW; money spent on a card leaves later and
   in a lump. That is the only distinction a prediction cares about, so it is the only one named
   here - the checking/savings split is a fact about saving versus spending and belongs to whoever
   asks that question, not to this one. */
export const AccountKind = {realTime: 'realTime', deferred: 'deferred'};

/* EVERY PREDICTION COMES FROM A TERMINAL STREAM, so the walk never hands back a compound.

   A compound's expected amount is DEFINED as the sum of its active children, so asking a parent and
   asking its leaves is the same question and reading both double-counts. It is also the only level
   where an ACCOUNT exists at all: rent on a card and groceries on debit pooled into their parent
   would report a split that neither child has.

   PRE-ORDER, so the returned array is in the order the tree reads on screen and a diff of two runs
   lines up. */
export function terminalStreams(masterStream){
	const out = [];
	const walk = s => {
		if(!s)return;
		const kids = s.children;
		if(kids && kids.length)kids.forEach(walk);
		else out.push(s);
	};
	walk(masterStream);
	return out;
}

/* A STREAM THE USER HAS CLOSED IS NOT DATA. `endDate` is the user saying this stream stopped, and
   the 23 that carry one are overwhelmingly abandoned drafts - `test`, `test3`, `ttest` - with no
   transactions in them at all. They are terminal streams and the walk keeps returning them, because
   dropping them from the walk would quietly change what the predictor is a prediction OF. What they
   are excluded from is REVIEW: an audit page is a list of things a person has to look at, and a
   closed empty draft is not one of them.

   ONE DEFINITION, USED BY THE PREDICTOR AND BY EVERY AUDIT PAGE. Two copies of "what closed means"
   is two answers the first time either side is touched. */
export const isClosedStream = stream => !!(stream && stream.endDate);

/* THE ALLOCATED AMOUNT IS THE STREAM'S AMOUNT, NOT THE TRANSACTION'S.

   A $200 order split $150/$50 across two streams is not evidence that either stream moved $200.
   There is no `streamId` on a transaction - the only link is `streamAllocation` - so ONE LEG PER
   (transaction, allocation) PAIR is the honest flattening: a transaction that touches two streams
   appears in both, carrying its own portion to each.

   TRANSFER LEGS STAY IN. A card repayment moves through two connected accounts and both movements
   are real; recognising the two as one movement seen twice is reconciliation, and it happens
   downstream. Nothing here nets, drops or collapses on `pairedTransferTransactionId`.

   BUILT ONCE FOR THE WHOLE PORTFOLIO. Allocations name their stream directly, so this costs one pass
   over the ledger instead of asking every stream about every transaction. */
export function streamLedger(transactions){
	const out = new Map();
	(transactions || []).forEach(t => {
		(t.streamAllocation || []).forEach(al => {
			if(!al || !al.streamId)return;
			let legs = out.get(al.streamId);
			if(!legs){legs = []; out.set(al.streamId, legs)}
			legs.push({
				transactionId: t.transactionId,
				date: new Date(t.date),
				amount: al.amount,
				accountId: t.userInstitutionAccountId,
				description: t.description
			});
		});
	});
	//ascending, so every consumer downstream reads a stream's history in the order it happened
	out.forEach(legs => legs.sort((a, b) => a.date - b.date));
	return out;
}

/* CREDIT IS DEFERRED; CHECKING AND SAVINGS ARE BOTH REAL TIME.

   The checking/savings answer is Bank.js's, honouring the user's override, because the user's choice
   about how they treat an account beats the aggregator's taxonomy - a card someone parks savings in
   is a savings account to its owner. This function only collapses that three-valued answer onto the
   two values a forecast can act on. */
export function accountKindOf(account, overrides){
	return effectiveAccountType(account, overrides) === AccountTypes.credit
		? AccountKind.deferred : AccountKind.realTime;
}

/* WHICH ACCOUNTS THE STREAM'S MONEY MOVED THROUGH, AND IN WHAT PROPORTION.

   THE ANSWER IS ALWAYS A PARTITION, NEVER A SINGLE ACCOUNT. A stream with one home is a partition of
   one. NO PRIMARY IS NAMED and no threshold collapses a split: choosing one representative account
   is a decision made FROM these weights by whoever needs a single answer, and burying it in a stage
   that has no idea what it is for means every caller that disagrees has to undo it first.

   TWO PERCENTAGES, BECAUSE THEY DISAGREE AND THE DISAGREEMENT IS INFORMATION. A stream can be 98% of
   the money on a card and half the transactions on debit - twenty small purchases against two large
   ones - and which of those matters depends on the question being asked. Collapsing them into one
   number picks an answer on behalf of a caller that has not asked yet. Each sums to 100 across the
   returned array.

   DIRECTION IS NOT TRACKED. The allocation's amount is already signed, so a transfer's two legs are
   counted like any other pair rather than cancelled or flagged; restating direction as its own field
   would be a second copy of a fact that can go stale. `Math.abs` is the only place a sign is touched.

   A LEG ON AN ACCOUNT WE DO NOT HAVE IS STILL REPORTED, with a null type. A missing account means the
   ledger and the account list disagree, and that is a finding worth seeing rather than a row to hide.

   FULL PRECISION, NOT ROUNDED - the caller formats. Rounding here would make the two percentages stop
   summing to 100 and turn a rendering choice into an arithmetic error. */
export function mapAccounts(legs, accountsByHash, overrides){
	const list = legs || [];
	if(!list.length)return [];

	const byAccount = new Map();
	let totalAbs = 0;
	list.forEach(leg => {
		const id = leg.accountId;
		let acc = byAccount.get(id);
		if(!acc){acc = {abs: 0, count: 0}; byAccount.set(id, acc)}
		const abs = Math.abs(leg.amount || 0);
		acc.abs += abs;
		acc.count++;
		totalAbs += abs;
	});

	const out = [];
	byAccount.forEach((acc, id) => {
		const account = (accountsByHash || {})[id];
		out.push({
			accountId: id,
			accountType: account ? accountKindOf(account, overrides) : null,
			/* A PARTITION OF ZERO MONEY IS STILL A PARTITION. Legs that all net to nothing in absolute
			   terms give every account a 0% share rather than a NaN, and the transaction count still
			   says where the activity was. */
			amountPercent: totalAbs ? 100*acc.abs/totalAbs : 0,
			transactionPercent: 100*acc.count/list.length
		});
	});

	//biggest share first, ties broken by id, so two runs of the same portfolio print the same rows
	return out.sort((a, b) => b.amountPercent - a.amountPercent
		|| (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
}
