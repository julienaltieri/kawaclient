/*File to contain all bank definitions*/




const Connectors = {
  plaid : "plaid",
}

export const BankConnectionStatuses = {
  ok:'ok',
  error: 'error'
}

export const AccountTypes ={
  checking : "checking",
  savings : "savings"
}


export const getBankErrorMessage = function(itemData){
  let errorCodeAccessor = {}
  //Add any new connector error mapping here
  errorCodeAccessor[Connectors.plaid] = i => i.error.error_code


  return BankErrorMessages[itemData.connectorName][errorCodeAccessor[itemData.connectorName](itemData) || "_default"]

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
  }
}