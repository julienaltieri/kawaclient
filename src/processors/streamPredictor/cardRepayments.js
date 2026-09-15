/* ==================================================================================================
   WHICH CARDS ARE PAID FROM WHICH ACCOUNT, AND WHICH MOVEMENTS ARE THE REPAYMENTS.

   ONE PASS, ONE ANSWER. Every credit on a card is offered to every real-time account: if that account
   shows a debit of the same size within a few days, the two are one movement. That single match
   answers all three questions at once - the card is linked to that account, both legs are repayment
   legs rather than spending, and the stream they were filed under is the one that does the repaying.

   THIS REPLACED THREE OVERLAPPING RULES. A recorded `pairedTransferTransactionId`, a reconstruction
   from dates and amounts with its own minimum, and a memory of which stream had paid before, each
   answering a slightly different question and disagreeing at the edges. They are one rule now because
   they were always one fact.

   THE RECORDED PAIRING IS STILL HONOURED where it exists - it is the aggregator telling us directly -
   but it cannot be relied on: the captured portfolio carries eighteen paired transactions and not one
   of them is a card repayment.

   A REFUND IS A CREDIT ON A CARD TOO, and it is told apart by having no debit to answer for it. The
   Robinhood card carries 78 credits; 46 pair with a payment out of checking and the rest are refunds.

   THE STREAM MATTERS BECAUSE A FORECAST HAS NO TRANSACTION IDS. A predicted repayment can only be
   recognised by which stream and which account it lands on, and the ledger is what says which stream
   that is. */

import {accountKindOf, AccountKind} from './accountMapping';

const ONE_DAY = 24 * 60 * 60 * 1000;

/* HOW FAR APART THE TWO LEGS MAY SIT. A repayment leaves one account and arrives at the other when
   each bank gets round to it; five days covers a weekend either side. Measured on the captured
   portfolio: at three days five repayments totalling $12,661 were missed, every one of them exactly
   four days apart. */
export const MATCH_DAYS = 5;

const streamOf = t => {
	const alloc = (t.streamAllocation || [])[0];
	return alloc && alloc.streamId ? alloc.streamId : null;
};

export function cardRepayments(portfolio, overrides){
	const accounts = portfolio.accounts || [];
	const kind = {};
	accounts.forEach(a => {
		if(a && a.hash)kind[a.hash] = accountKindOf(a, overrides || portfolio.accountTypes || {});
	});

	const byAccount = {};
	const byId = {};
	(portfolio.transactions || []).forEach(t => {
		byId[t.transactionId] = t;
		(byAccount[t.userInstitutionAccountId] = byAccount[t.userInstitutionAccountId] || [])
			.push(t);
	});

	const cash = Object.keys(kind).filter(h => kind[h] === AccountKind.realTime);
	const cards = Object.keys(kind).filter(h => kind[h] === AccountKind.deferred);

	const links = {}, legs = {}, streams = {}, counts = {};
	cards.forEach(card => {
		streams[card] = {};
		(byAccount[card] || []).filter(t => t.amount > 0).forEach(credit => {
			const at = new Date(credit.date).getTime();

			/* THE AGGREGATOR'S OWN PAIRING FIRST, then the match by size and date. Both answer the
			   same question and the first is simply better evidence when it is there. */
			let mate = null;
			const told = credit.pairedTransferTransactionId
				? byId[credit.pairedTransferTransactionId] : null;
			if(told && kind[told.userInstitutionAccountId] === AccountKind.realTime)mate = told;
			else for(let i = 0; i < cash.length && !mate; i++)
				mate = (byAccount[cash[i]] || []).find(t => Math.abs(t.amount + credit.amount) < 0.01
					&& Math.abs(new Date(t.date).getTime() - at) <= MATCH_DAYS * ONE_DAY) || null;
			if(!mate)return;

			const funder = mate.userInstitutionAccountId;
			counts[card + '|' + funder] = (counts[card + '|' + funder] || 0) + 1;
			legs[credit.transactionId] = true;
			legs[mate.transactionId] = true;
			const sid = streamOf(credit) || streamOf(mate);
			if(sid)streams[card][sid] = true;
		});
	});

	/* THE ACCOUNT THAT PAID MOST OFTEN IS THE ONE THAT FUNDS THE CARD. A single coincidental match of
	   the same size on the same week is not a funding relationship. */
	Object.keys(counts).forEach(k => {
		const card = k.split('|')[0], funder = k.split('|')[1];
		const best = links[card];
		if(!best || counts[card + '|' + best] < counts[k])links[card] = funder;
	});

	return {links: links, legs: legs, streams: streams, kind: kind};
}

export default cardRepayments;
