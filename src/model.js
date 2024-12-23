import {Period,timeIntervals} from './Time'
import getEvaluator from './TransactionEvaluator'
import Core from './core'
import AppConfig from './AppConfig'
import utils from './utils'

export const currencies = {
  USD: "USD",
  EUR: "EUR"
}

export default class UserData {
  constructor(json){
    this.categorizationRules = json.categorizationRules || [];
    this.categorizationRulesExclusionList = json.categorizationRulesExclusionList || [];
   // this.observedAccounts = json.observedAccounts;
    //this.observedUserInstitutionIds = json.observedUserInstitutionIds;
    this.masterStream = new CompoundStream(json.masterStream);
    this.userId = json.userId;
    this.timeZoneOffset = json.timeZoneOffset;
    this.amazonOrderHistory = json.amazonOrderHistory;
    this.bankConnections = json.bankConnections;
    this.savingAccounts = json.savingAccounts;
    this.preferredCurrency = json.preferredCurrency || currencies.USD;
    this.userPreferences = json.userPreferences || {}
  }

  //convenience
  prettyPrintAtDate(date){console.log(this.masterStream.toStringAtDate(date))}
  prettyPrint(){this.prettyPrintAtDate(new Date())}

  //stream getters and iterators
  forAllStreams(f){return f?this.getAllStreams().forEach(f):undefined}
  getAllStreams(){return this.masterStream.getAllStreams()}
  getAllTerminalStreams(){return this.masterStream.getAllTerminalStreams()}
  
  //other getters
 // getCategorizationRules(){return this.categorizationRules}
  getNetByPeriod(period){return this.masterStream.getExpectedAmountAtDateByPeriod(new Date(),period)}
  getTerminalStreamById(id){return this.getAllTerminalStreams().filter(s => s.id == id)[0]}
  getCategorizationRules(){
    var sids = this.getAllTerminalStreams().map(s => s.id);
    this.categorizationRules.forEach(r => r.allocations = r.allocations.filter(al => utils.isArrayAIncludedInB([al.streamId],sids)))
    return this.categorizationRules.filter(r => r.allocations.length>0)
  }
}



class Stream{
  constructor(json){
    this.name = json.name;
    this.id = json.id;
    this.period = json.period;//string
    this.endDate = (!isNaN(new Date(json.endDate)))?new Date(json.endDate):undefined;
    this.isSavings = json.isSavings;
    this.isInterestIncome = json.isInterestIncome;
    this.annotations = json.annotations || [];
    //this.terminalStreams = [this]
  }
  //main getters
  getExpectedAmountAtDate(date,period){return this.getExpectedAmountAtDateByPeriod(date,period)}
  isActiveAtDate(date){
    var n = this.getExpectedAmountAtDate(date);
    if(n==0){
      return true
    }
    else return !!n
  }
  isActiveNow(){return this.isActiveAtDate(new Date()) || this.isFactory}
  /*[abstract]*/getExpectedAmountAtDateByPeriod(date,period){throw new Error(utils.errors.abstractMethodCalled)}
  
  //other getters
  getPreferredPeriod(){return this.period}
  getMillis(d = new Date()){return Period[this.period].getTimeIntervalFromDate(d)}
  getCurrentExpectedAmount(){return this.getExpectedAmountAtDateByPeriod(new Date())} 
  getCurrentExpectedAmountByPeriod(period){return this.getExpectedAmountAtDateByPeriod(new Date(),period)}
  getAllStreams(){return [this]}
  getAllTerminalStreams(){return [this]}
  getDepth(){return !this.children?0:1+utils.max(this.children,c => c.getDepth())}
  getNumberOfSubdivisionInPreferredPeriod(subdiv,date){return Period[this.period].getTimeSubdivisionsCount(date,subdiv)}
  isSaving(){return this.isSavings}
  isInterestIncomeStream(){return this.isInterestIncome}
  isIncome(){return this.getCurrentExpectedAmount()>0}
  isTerminal(){return true}

  //annotations
  getAnnotations(){//external facing: this should return all annotations for stream and children stream
   // console.log("get annotations for stream "+this.name,this.annotations)
    return [...this.annotations,...utils.flatten(this.children?.map(c => c.getAnnotations()||[])||[])]
  }
  getAnnotationsAtDate(date){
    if(!(date instanceof Date)){date = new Date(date)}
    return this.getAnnotations().filter(an => {
      let a = new Date(an.date), d = new Date(date), period = this.getReportingPeriod();
      let p = (a.getTime() <= d.getTime()) //is the annotation before the date?
      let q = (a.getTime() > period.previousDate(d).getTime()) //is the annotation after the last period date?
      return p && q
    })
  }
  getPreferredReportingPeriod(){return Period[this.getPreferredPeriod()]}
  getReportingPeriod(){return Period.shortestPeriod([Period[this.getPreferredPeriod()],Period.monthly])}//this is usually what we like a stream to be subdivided in for reporting
  getAnnotationsForReport(r){return this.getAnnotationsAtDate(r.reportingDate)}
  saveAnnotation(date,body){
    if(!(date instanceof Date)){date = new Date(date)}
    let existing = this.annotations.filter(a => new Date(a.date).getTime() == date.getTime());
    if(existing?.length>0){
      existing[0].body = body
      if(body==""){this.annotations = this.annotations.filter(a => new Date(a.date).getTime() != date.getTime())}
    }
    else{this.annotations = [...this.annotations,...[{date:date,streamId:this.id,body:body}]]}
    return Core.saveStreams()
  }


  //convenience
  convertAmountInAmountForPeriod(amount,period,date){return amount/this.getNumberOfSubdivisionInPreferredPeriod(period,date)}
  formatedString(name,period,amount){return (amount!=undefined)?`${name} (${period}): ${utils.formatCurrencyAmount(amount,null,null,null,Core.getPreferredCurrency())} `:""}
  toString(prefix){return this.toStringAtDate(new Date(),prefix)}
  /*[abstract]*/toStringAtDate(date,prefix){throw new Error(utils.errors.abstractMethodCalled)}
  
  validate(){//to be called by subclasses after the constructor
    return(!!this.name && !!this.id)
  }

  getChildLevelIn(s){
    if(!s.children){//terminal stream
      if(s.id!=this.id)return -1 //if this stream isn't the requested one, return -1
      else return 0 //a stream is a 0 distance child level of itself
    }else{
      if(s.id==this.id)return 0 //a stream is at a 0 distance child level of itself
      else {
        var childDistance = Math.max(...(s.children).map(c => this.getChildLevelIn(c)))
        if (childDistance ==-1)return -1 //this stream is not a child of s
        else return childDistance+1
      } 
    }
  }

  moveFromParentToParentAtIndex(oldParent,newParent,index){
    index = index||0;
    if(newParent.children){
      oldParent.removeChild(this);
      if(oldParent.children.length==0){Core.getParentOfStream(oldParent).removeChild(oldParent)}
      newParent.insertChildAt(this,index);
      Core.pruneMasterStream();
    }
    oldParent.refreshValues()
    newParent.refreshValues()
  }

  getAncestors(){
    if(this.isRoot){return []}
    else{
      let a = Core.getParentOfStream(this)
      return [...a.getAncestors(),a]
    }
  }
}

let TerminalStreamMap = {}
let TerminalStreamMapActive = {}

export const invalidateStreamMap = () => {
  let TerminalStreamMap = {}
  let TerminalStreamMapActive = {}
}

//an aggregate stream - their value come from their children
export class CompoundStream extends Stream{
  constructor(json){
    super(json);
    this.children = (json.children?json.children.filter(c => !c.children || c.children.length>0).map(c => c.children ? new CompoundStream(c): new TerminalStream(c)):[]);
    this.period = (json.period || Period.longestPeriod(this.children.map(c => c.period)));
    this.setPeriod = json.period;
    this.isRoot = json.isRoot;
    if(!this.validate())throw new Error("Attempting to instanciate a CompoundStream Object from an invalid Json: "+JSON.stringify(json))
  }

  //iterators and children tools
  getAllStreams(){return this.children.map(c => (c instanceof CompoundStream)?c.getAllStreams():[c]).reduce(utils.reducers.concat(),[this])}
  forEachStream(f){return this.getAllStreams().forEach(f)}
  forEachTerminalStream(f){return this.getAllTerminalStreams().forEach(f)}
  getActiveTerminalStreamsAtDate(date){return this.getAllTerminalStreams().filter(s => s.isActiveAtDate(date))}
  getChildStreamById(id){return this.getAllStreams().filter(s => s.id==id)[0]}
  getAllTerminalStreams(active = false){
    if(!TerminalStreamMap[this.id]){
      TerminalStreamMap[this.id] = this.children.map(c => c instanceof CompoundStream?c.getAllTerminalStreams():[c]).reduce(utils.reducers.concat(),[])
      TerminalStreamMapActive[this.id] = TerminalStreamMap[this.id].filter(s => s.isActiveNow())
    }
    return active?TerminalStreamMapActive[this.id]:TerminalStreamMap[this.id]
  }
  isTerminal(){return false}
  pruneChildren(){//delete compound streams that don't have terminal children
    this.children = this.children.filter(c => c.getAllTerminalStreams().length>0)
    this.children.filter(c => !c.isTerminal()).forEach(c => c.pruneChildren())
  }

  //operations
  refreshValues(){
    if(!!this.setPeriod){this.period = this.setPeriod}//the stream has a period (most likely terminal)
    else if(this.children && this.children.length>0){this.period = Period.longestPeriod(this.children.map(c => Period[c.period])).name} //this stream has children
    else {this.period = Period.monthly.name}//default
  }
  insertChildAt(child,index){this.children.splice(index||0,0,child)}
  removeChild(stream){
    var index = this.children.map(c => c.id).indexOf(stream.id);
    if (index > -1) this.children.splice(index, 1);
  }

  //implementations & overrides
  toStringAtDate(date,prefix){
    if(!prefix){prefix=""};prefix+="  ";console.log(1);
    var res =  prefix+">--"+this.formatedString(this.name,this.getPreferredPeriod(),this.getExpectedAmountAtDate(date))+this.children.filter(c => c.isActiveAtDate(date)).map(c => prefix+ c.toStringAtDate(date,prefix)).reduce((ac,va) => ac +'\n'+va,"")
    return res;
  }
  getExpectedAmountAtDateByPeriod(date,period){
    if(!period)period = this.getPreferredPeriod();
    if(!date.getMonth){
      console.log(this)
    }
    var res = this.children
      .filter(c => !(!c.isTerminal() && c.isInterestIncome) || AppConfig.featureFlags.includeInterestInBudgeting) // unless the feature of including interest income in budgetting is on, we exclude compound streams that are interest income from the general math
      .filter(c => c.isActiveAtDate(date)).reduce(utils.reducers.sum(o => o.getExpectedAmountAtDateByPeriod(date,period) || 0),0);
    return res;
  }
  isActiveAtDate(date){
    return utils.or(this.children, c => c.isActiveAtDate(date))
  }
  validate(){
    return super.validate() && 
    !!this.children &&
    Array.isArray(this.children) &&
    (this.children.length==0 || !utils.or(this.children.map(c => !c.validate())))
  }
  hasTerminalChild(sId){
    return this.getAllTerminalStreams().map(s => s.id).indexOf(sId)>-1;
  }
}




//a stream containing hard data
export class TerminalStream extends Stream{
  constructor(json){
    super(json);
    this.isSavings = json.isSavings;
    if(json.expAmountHistory){
      this.expAmountHistory = json.expAmountHistory;
      this.expAmountHistory.forEach(o => (!isNaN(new Date(o.startDate)))?o.startDate = new Date(o.startDate):o.startDate = new Date())//parse dates
      this.expAmountHistory = this.expAmountHistory.sort(utils.sorters.asc(t => t.startDate))//sort chronologically
      this.expAmountHistory = utils.dedup(this.expAmountHistory,undefined,(x,y)=> Math.abs(x.startDate-y.startDate)<24*60*60*1000)//dedup based on dates
     // this.expAmountHistory = utils.dedup(this.expAmountHistory,x => x.amount) //dedup based on consecutive same amounts
    }else throw new Error(utils.errors.terminalStreamMissingMendatoryAmountHistory);
  }

  //amount updates management
  updateExpAmount(newAmount,startDate){
    if(this.expAmountHistory[this.expAmountHistory.length-1].amount == newAmount)return console.log("amount same, changed ignored"); //don't do anything if there is no change
    var o = this.expAmountHistory.filter(c => Math.abs(c.startDate - startDate) < 24*60*60*1000)[0];
    if(o){this.updateExistingExpChange(o.startDate,undefined,newAmount)}  //if less than 1d interval, don't create a new one but update the previous one
    else this.expAmountHistory.push({startDate:startDate,amount:newAmount})
  }
  updateExistingExpChange(expChangeDate,newDate,newAmount){
    let existing = this.expAmountHistory.filter(ex => ex.startDate.getTime() == expChangeDate.getTime())[0]
    if(!existing){throw new Error("attempting to update an expectation change at a date that doesn't exist for stream: "+this.name)}
    if(!!newDate){existing.startDate = newDate}
    if(newAmount!=undefined){
      let idx = this.expAmountHistory.map(ex => ex.startDate).indexOf(existing.startDate)
      if(idx > 0 && this.expAmountHistory[idx-1].amount==newAmount){
        this.expAmountHistory.splice(idx,1)//delete the newest entry if equal to the latest one
        console.log("Expectation change delete because new amount is the same as latest amount")
      }else {existing.amount = newAmount}
    }
  }
  removeExpChange(date){
    this.expAmountHistory = this.expAmountHistory.filter(e => e.startDate.getTime()!=date.getTime())
  }
  getLatestActiveExpAmount(){
    var can = this.expAmountHistory.filter(o => o.startDate < new Date());
    if(can.length == 0)throw new Error("Trying to access getLatestActiveExpAmount in Stream that only has future dates or none")
    return can.sort(utils.sorters.desc(a => a.startDate))[0]
  }
  expAmountUpdateAtDate(date){
    if(this.endDate && date > this.endDate)return; //if the date falls outside of the lifespan of this stream, return undefined
    //else, we just need to find the latest amount at the specified date
    var can = this.expAmountHistory.filter(o => o.startDate <= date).sort(utils.sorters.desc(o => o.startDate));
    if(can.length>0)return can[0]; //if the stream was alive, pick the latest avaiable amount at that date
  }
  getLatestUpdateDateAtDate(date){var r = this.expAmountUpdateAtDate(date);if(r)return r.startDate}
  getOldestDate(){return this.expAmountHistory.map(a => a.startDate).sort(utils.sorters.asc())[0]}
  getMostRecentDate(){return this.endDate || new Date()}
  isActiveNow(){return !this.endDate}

  //implementations
  toStringAtDate(date,prefix){if(!prefix){prefix=""};prefix+="  ";return prefix+"o--"+this.formatedString(this.name,this.getPreferredPeriod(),this.getExpectedAmountAtDate(date))+" [since "+this.getLatestUpdateDateAtDate(date).toLocaleDateString()+"]";}
  getExpectedAmountAtDateByPeriod(date,period){
    if(!period){period = this.getPreferredPeriod()}
    var r = this.expAmountUpdateAtDate(date);
    if(r)return this.convertAmountInAmountForPeriod(r.amount,period,date)
  }
  validate(){
    return super.validate() && 
    !!this.expAmountHistory &&
    !!this.period &&
    !!Period[this.period] &&
    Array.isArray(this.expAmountHistory)
  }
}


export class GenericTransaction{
  amount;
  date; 
  description;
  categorized;
  streamAllocation;
  authDate;
  transactionId;
  userInstitutionAccountId;
  pairedTransferTransactionId;
  disambiguationId;
  userDefinedTransactionType;
  evaluator;

  constructor(dateString,amount,description,streamAllocation,userInstitutionAccountId,amazonOrderDetails,authDate,id,transactionId,pairedTransferTransactionId,disambiguationId,userDefinedTransactionType,connectorName,institutionId){
    this.amount = amount
    this.date = new Date(dateString)
    this.description = description
    this.streamAllocation = streamAllocation
    this.categorized = !!streamAllocation
    this.authDate = !!authDate?new Date(authDate):null
    this.id = id
    this.transactionId = transactionId
    this.userInstitutionAccountId = userInstitutionAccountId
    this.pairedTransferTransactionId = pairedTransferTransactionId
    if(amazonOrderDetails)this.amazonOrderDetails = amazonOrderDetails
    this.disambiguationId = disambiguationId
    this.connectorName = connectorName
    this.institutionId = institutionId
    if(this.categorized)this.evaluator = getEvaluator(this)

    this.UncategorizedEvaluationError = new Error("Trying to call an evaluation function on an uncategorized transaction.")
  }


  //evaluation functions
  moneyInForStream(s){              if(this.categorized){return this.evaluator.moneyInForStreamAndTransactionId(s,this.transactionId)} else {throw this.UncategorizedEvaluationError}}
  savedForStream(s){                if(this.categorized){return this.evaluator.savedForStreamAndTransactionId(s,this.transactionId)} else {throw this.UncategorizedEvaluationError}}
  transferedNeutrallyForStream(s){  if(this.categorized){return this.evaluator.transferedNeutrallyForStreamAndTransactionId(s,this.transactionId)} else {throw this.UncategorizedEvaluationError}}
  moneyOutForStream(s){             return -this.moneyInForStream(s)}
  unsavedForStream(s){              return -this.savedForStream(s)}

  //convenience
  toString(){return `[${this.date.toDateString()}] ${utils.formatCurrencyAmount(this.amount,null,null,null,Core.getPreferredCurrency())} [${this.categorized?this.streamAllocation[0].streamName:"---------"}] ${this.description.substring(0,40)}...`}
  isAllocatedToStream(s){
    if(!s.children){return !!this.evaluator.getAllocationForStream(s)?.amount}
    else {return (utils.or(s.getAllTerminalStreams(),ss => this.isAllocatedToStream(ss)))}
  }
  isUnderInterestIncomeCompoundStream(){
    let as = Core.getStreamById(this.streamAllocation[0]?.streamId).getAncestors()
    return utils.or(as, s => s.isInterestIncomeStream() && !s.isTerminal())
  }
  getTransactionHash(){
    return this.description.replace(/\s\s+/g, ' ').split(" ").slice(0,3).reduce(utils.reducers.stringConcat(undefined," "),"")+"::"+
        this.amount+"::"+
        this.id+"::"+//this field should be removed
        this.userInstitutionAccountId+"::"+//use the account hash instead of this 
        this.date.toUTCString()
  }
  getTransactionType(){
    if(!this.categorized){return};
    return this.streamAllocation[0]?.transactionType?.name
  }
  getTransactionTypeMask(){
    if(!this.categorized){return};
    return this.streamAllocation[0]?.transactionType?.mask
  }
  getTransactionMaskString(){
    let m = this.getTransactionTypeMask();
    if(!m){return};
    return "Money in: " + m[0] + ", Saved: "+m[1]+", Transfered: "+m[2];
  }
  /*
  Transactions from bank APIs come with a date (not a timestamp). 
  When converting the date into actual timestamps for easy manipulation, they will use the GMT time.
  so the adjusted date in the current timezone will be incorrect. (they will appear as the previous day West of GMT)
  This function rectifies that and takes the date part of the GTM timestamp and converts it to its equivalent in the client's timezone   
  */
  getDateInDisplayTimezone(){return new Date(this.date.getTime() + this.date.getTimezoneOffset()*timeIntervals.oneMinute)}


  //static constructors
  static MakeGTFromCategorizedTransaction(cat){
    var t = new GenericTransaction(
      cat.date,
      cat.transactionAmount,
      cat.transactionDescription,
      cat.streamAllocation,
      cat.userInstitutionAccountId,
      cat.amazonOrderDetails,
      cat.transactionDate,
      cat.id,cat.transactionId,
      cat.pairedTransferTransactionId,
      cat.disambiguationId,
      cat.userDefinedTransactionType,
      cat.connectorName,
      cat.institutionId
    )
    t.streamAllocation.forEach(a => a.type = a.type || "value")
    return t
  }

  static MakeGTFromUncategorizedTransaction(txn){
    return new GenericTransaction(
      txn.date,
      txn.amount,
      txn.description,
      undefined,
      txn.userInstitutionAccountId,
      undefined,
      txn.transactionDate,
      txn.id,
      txn.id,
      undefined,
      txn.disambiguationId,
      undefined,
      txn.connectorName,
      txn.institutionId
    )
  }
}