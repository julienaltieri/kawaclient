/*File to contain all bank definitions*/




export const Connectors = {
  plaid : "plaid",
  powens: "powens",
}

export const BankConnectionStatuses = {
  ok:'ok',
  error: 'error'
}

export const AccountTypes ={
  checking : "checking",
  savings : "savings",
  credit : "credit"
}

/* WHAT KIND OF ACCOUNT IS THIS - asked and answered in exactly one place.

   There are two notions of account type and they are not the same thing: what the aggregator reports,
   which is a fact about the account, and what the user has chosen, which is a fact about how they
   treat it. The second overrides the first, because the choice is about treatment rather than
   taxonomy - a credit card someone parks savings in is a savings account to its owner, whatever
   Plaid calls it.

   The aggregator's answer is the DEFAULT, not a constraint. It is what the Settings dropdown is
   pre-populated with, so the common case needs no decision from anyone.

   CREDIT BEHAVES AS CHECKING EVERYWHERE EXCEPT THE BALANCE FORECAST. The saving-versus-spending
   distinction - which is what the rest of the app reads this for - only asks whether money went into
   savings. A card is not savings, so it is spending, exactly like a current account. Only the
   balance forecast needs the third value, because only it has to know that money spent on a card
   leaves the current account later and in a lump. */
export const inferAccountType = function(account){
  if(!account)return AccountTypes.checking
  if(account.type === "credit")return AccountTypes.credit
  const sub = (account.subtype || "").toLowerCase()
  if(sub.indexOf("saving") > -1 || sub.indexOf("money market") > -1)return AccountTypes.savings
  return AccountTypes.checking
}

//the aggregator's answer unless the user has overridden it for that account
export const effectiveAccountType = function(account, overrides){
  const set = (overrides || {})[account && account.hash]
  return AccountTypes[set] || inferAccountType(account)
}

//the only question the rest of the app asks: did this money go into savings?
export const isSavingsType = function(type){return type === AccountTypes.savings}


export const getBankErrorMessage = function(itemData){
  let errorCodeAccessor = {}
  //Add any new connector error mapping here
  errorCodeAccessor[Connectors.plaid] = i => i.error?.error_code
  errorCodeAccessor[Connectors.powens] = i => i.error?.error_code

  return BankErrorMessages[itemData.connectorName][errorCodeAccessor[itemData.connectorName](itemData) || "_default"]||itemData.error?.error_message;

}


const BankErrorMessages = {
  plaid:{
    ITEM_LOGIN_REQUIRED: "Your bank needs you to reauthenticate.",
    INVALID_CREDENTIALS: "The credentials you provided were incorrect: Check that your credentials are the same that you use for this institution.",
    INSUFFICIENT_CREDENTIALS: "The authorization flow did not complete. Please try again",
    INVALID_MFA: "The provided multi-factor authentication responses were not correct. Please try again",
    INVALID_UPDATED_USERNAME: "Try entering your bank account username again. If you recently changed it, you may need to un-link your account and then re-link.",
    ITEM_LOCKED: "Too many attempts: Your account is locked for security reasons. Reset your bank username and password, and then try again.",
    _default: "Plaid error."
  },
  powens:{
    SCARequired: "",
    webauthRequired: "A periodic re-authentication is required to meet bank data security standards. This is normal and only takes a minute.",
    additionalInformationNeeded: "",
    actionNeeded: "",
    passwordExpired: "",
    wrongpass: "",
    _default: "Powens error."
  }
}