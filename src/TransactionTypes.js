class TransactionType{
	constructor(code,name,mask,description,shortDescription){
		this.code = code
		this.name = name
		this.description = description
		this.mask = mask //multipliers for MoneyIn, Saved, Transfered
		this.shortDescription = shortDescription
	}
}

const TransactionTypes = {
	ambiguous: 									new TransactionType(0, 	"ambiguous", 								[0,0,0], 	"Ambiguous transaction that needs further information to be counted"),							//ex: transfer from Tellus to Savings (initially)
	income: 									new TransactionType(1,	"income",									[1,0,0],	"Money incoming to a linked checking account from outside"),									//ex: wages
	expense: 									new TransactionType(2,	"expense",									[-1,0,0],	"Money exiting a linked checking account"), 													//ex: groceries
	internalTransferChecking: 					new TransactionType(3,	"internalTransferChecking",					[0,0,1],	"Money transfered from a linked checking account to another linked checking account"),	//ex: Zelle transfer from Julien to Fanny
	transferToDisconnectedChecking: 			new TransactionType(4,	"transferToDisconnectedChecking",			[-1,0,0],	"Money transfered from a linked checking account to an external checking account"),		//(ex: Transfer to Venmo to pay a friend)
	transferFromDisconnectedChecking: 			new TransactionType(5,	"transferFromDisconnectedChecking",			[1,0,0],	"Money transfered from a diconnected checking account to a linked checking account"),		//(ex: Transfer from Venmo from a friend paying us)
	movedToSavings: 							new TransactionType(6,	"movedToSavings",							[0,1,0],	"Money moved from a linked checking account to a linked savings account"),				//ex: monthly Ally transfer
	movedFromSavings: 							new TransactionType(7,	"movedFromSavings",							[0,-1,0],	"Money moved from a linked savings account to a linked checking account"),				//ex: pull from savings to finance a large expense
	internalTransferSavings: 					new TransactionType(8,	"internalTransferSavings",					[0,0,0.5],	"Money moved from a linked savings account to a linked savings account"),					//ex: transfer from Chase Savings to Ally
	transferToDisconnectedSavings: 				new TransactionType(9,	"transferToDisconnectedSavings",			[0,0,1],	"Money moved from a linked savings account to an external savings account"),				//ex: from Ally to Tellus
	transferFromDisconnectedSavings: 			new TransactionType(10,	"transferFromDisconnectedSavings",			[0,0,1],	"Money moved from an external savings account to a linked savings account", "Money moved from an external saving account"),				//ex: from Tellus to Ally
	movedFromSavingsToDisconnectedChecking: 	new TransactionType(11,	"movedFromSavingsToDisconnectedChecking",	[0,-1,0],	"Money moved from a linked savings account to an external checking account"),				//(ex: from Ally directly to Venmo)
	movedFromDisconnectedCheckingToSavings: 	new TransactionType(12,	"movedFromDisconnectedCheckingToSavings",	[1,1,0],	"Money moved from an external checking account to a linked savings account","Money moved from an external checking account"),				//ex: from from Venmo directly to Ally
	movedToDisconnectedSavingAccount: 			new TransactionType(13,	"movedToDisconnectedSavingAccount",			[0,1,0],	"Money moved from a linked checking account to an external savings account"),				//ex: monthly transfer from Chase checking to Tellus
	movedFromDisconnectedSavingAccount: 		new TransactionType(14,	"movedFromDisconnectedSavingAccount",		[0,-1,0],	"Money moved from an external savings account to a linked checking account"),				//ex: from Tellus to Chase checking
	expenseFromSavings: 						new TransactionType(15,	"expenseFromSavings",						[-1,-1,0],	"Money exiting a linked savings account"), 													//(ex: pay something directly from a saving account)
	incomeToSavings: 							new TransactionType(16,	"incomeToSavings",							[1,1,0],	"Money incoming to a linked savings account", "Interest or income"),												//ex: interest income, or DD to savings
	systemTransaction: 							new TransactionType(17,	"systemTransaction",						[0,0,0],	"Transaction use by bank system for internal reconciliation. Cash neutral.", "System transaction")		
}

export default TransactionTypes