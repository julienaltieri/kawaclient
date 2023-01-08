const utils = require('./utils.js')


export const timeIntervals = {
	oneSecond: 1000,
	oneMinute: 1000*60,
	oneHour:   1000*60*60,
	oneDay:    1000*60*60*24,
	oneWeek:   1000*60*60*24*7,
	oneYear:   1000*60*60*24*365
}

export const relativeDates = {
	oneDayAgo: () => new Date(Date.now() - timeIntervals.oneDay),
	oneWeekAgo: () => new Date(Date.now() - timeIntervals.oneWeek),
	fourWeeksAgo: () => new Date(Date.now() - 4*timeIntervals.oneWeek),
	threeMonthsAgo: () => new Date(Date.now() - 93*timeIntervals.oneDay),
	oneYearAgo: () => new Date(Date.now() - timeIntervals.oneYear),
	threeYearsAgo: () => new Date(Date.now() - timeIntervals.oneYear*3),
	now: () => new Date(),
	oneYearInTheFuture: ()=> new Date(Date.now() + timeIntervals.oneYear)
}


export const createDate = function(year=2000,month=0,day=0,hours=0,minutes=0,seconds=0,millis=0){
	var res = new Date();
	res.setFullYear(year);
	res.setMonth(month);
	res.setDate(day);
	res.setHours(hours);
	res.setMinutes(minutes);
	res.setSeconds(seconds);
	res.setMilliseconds(millis);
	return res;
}

//iterates through dates from start to end using "increment" as the hop period, and executes "nextDate => body(nextDate)" after each hop 
export const dateIterator = (start,end,period,body) => {
	var cur = start;
	while(period.nextDate(cur) <= end){
		cur = period.nextDate(cur)
		body(cur);
	}
}


export const getHashFromDate = function(date){
	var m = 1 + date.getUTCMonth();
	m = (m<10)?"0"+m:""+m;
	return date.getUTCFullYear()+"-"+m;
}

export class Period {
	constructor(name,unitName,timeInterval,subdivision,relationships){
		this.name = name;
		this.unitName = unitName;
		this.timeInterval = timeInterval; //when undefined, it should be calculated based on a date
		this.subdivision = subdivision;
		this.relationships = relationships; //can this be a bit more calculated?
	}
	getTimeIntervalFromDate(date){
		if(this.timeInterval)return this.timeInterval //time interval is constant
		else {
			if(!date){throw new Error(`Attempting to get time interval period on a non-constant interval "${this.name}". In such case, a non-null date must be provided`)}
			return this.nextDate(date).getTime() - date.getTime()
		}
	}
	getTimeSubdivisionsCount = (startDate,subdivision = this.subdivision.name) => this.relationships[subdivision] || /*Math.round*/(this.getTimeIntervalFromDate(startDate)/Period[subdivision].getTimeIntervalFromDate(startDate))
	nextDate = (date,backwards = false) => {
		var b = backwards?-1:1;
		if(this.timeInterval){return new Date(date.getTime()+b*this.timeInterval)}
		else {
			switch(this.name){
				case Period.periodName.semimonthly:
					let next = new Date(date); next.setMonth(date.getMonth()+b*1)
					return new Date(date.getTime()+(next.getTime()-date.getTime())/2);
				break	
				case Period.periodName.yearly:
					return new Date(new Date(date).setFullYear(date.getFullYear()+b*1))
				break	
				default: //for monthly, bimonthly, quarterly
					return new Date(new Date(date).setMonth(date.getMonth()+b*this.relationships[Period.periodName.monthly]))
			}
		}
	}
	nextDateFromNow = (startDate) => {
		let res = startDate;
		dateIterator(startDate,new Date(),this,d => res=d);
		return this.nextDate(res)
	}
	previousDate = (date) => this.nextDate(date,true)
	periodCalendarStart = (date) => {
		//find the calendar start of this period
		let a = new Date(date)

		//timestamp to 0h 0m 0s 0ms
		a.setHours(0,0,0,0) //for all
		if(this.name == Period.periodName.daily){return a}

		//cases that affect date
		let firstDayOfTheWeek = date.getDate() - (date.getDay()-1+7)%7 
		if(this.name == Period.periodName.weekly){
			a.setDate(firstDayOfTheWeek)
			return a
		}else if(this.name == Period.periodName.biweekly){
			let firstDayOfYear = new Date(date.getFullYear(),0,1)
			let weekNumber = Math.ceil(Math.floor((date-firstDayOfYear)/timeIntervals.oneDay)/7) // result between 1 and 53
			if(!(weekNumber%2)){//if the week number is even (week 2, 4, etc), the calendar date of the beginning of the period is in the prior week
				a.setDate(firstDayOfTheWeek-7)
			}
			return a
		}else if(this.name == Period.periodName.semimonthly){
			let b = new Date(date)
			b.setDate(1);
			let c = new Date(b);
			c.setMonth(b.getMonth()+1);
			let daysInMonth = Math.round((c-b)/timeIntervals.oneDay);
			if(a.getDate()<=daysInMonth/2){a.setDate(1)}
			else{a.setDate(Math.floor(daysInMonth/2))}
			return a
		} 
		a.setDate(1); //for all else


		//cases that affect months
		if(this.name == Period.periodName.monthly){return a}
		else if(this.name == Period.periodName.bimonthly){
			if(date.getMonth()%2){//month 0 is January, so this condition is true only for February, April, etc
				a.setMonth(date.getMonth()-1)
			}
			return a
		} else if(this.name == Period.periodName.quarterly){
			let m = date.getMonth();
			let q = Math.floor(m/3+1);
			a.setMonth(3*(q-1));
			return a
		}
		a.setMonth(0); //for all else
		return a

	}


	/*Static fields and methods*/
	static periodName = {
		daily: 	 	"daily",
		weekly: 	"weekly",
		biweekly: 	"biweekly",
		semimonthly:"semimonthly",
		monthly: 	"monthly",
		bimonthly: 	"bimonthly",
		quarterly:  "quarterly",
		yearly: 	"yearly",
		biyearly: 	"biyearly"
	}
	static daily = 			new Period(Period.periodName.daily,			"day",  		timeIntervals.oneDay,	Period.daily, 	{"daily":1,"weekly":1/7,"biweekly":1/14})
	static weekly = 		new Period(Period.periodName.weekly,		"week",   		timeIntervals.oneWeek,	Period.daily, 	{"daily":7,"weekly":1,"biweekly":1/2})
	static biweekly = 		new Period(Period.periodName.biweekly,		"2 weeks",  	timeIntervals.oneWeek*2,Period.daily, 	{"daily":14,"weekly":2,"biweekly":1})
	static semimonthly = 	new Period(Period.periodName.semimonthly,	"half-month",	undefined,						Period.daily, 	{"semimonthly":1, "monthly":1/2,"bimonthly":1/4,"quarterly":1/6,"yearly":1/24})
	static monthly = 	 	new Period(Period.periodName.monthly,		"month"	,		undefined,						Period.daily, 	{"semimonthly":2, "monthly":1,  "bimonthly":1/2,"quarterly":1/3,"yearly":1/12})
	static bimonthly = 		new Period(Period.periodName.bimonthly,		"2 months",		undefined,						Period.monthly,{"semimonthly":4, "monthly":2,  "bimonthly":1,  "quarterly":2/3,"yearly":1/6})
	static quarterly = 		new Period(Period.periodName.quarterly,		"quarter",		undefined,						Period.monthly,{"semimonthly":6, "monthly":3,  "bimonthly":3/2,"quarterly":1,	"yearly":1/4})
	static yearly = 	 	new Period(Period.periodName.yearly,		"year"	,		undefined,						Period.monthly,{"semimonthly":24,"monthly":12, "bimonthly":6,  "quarterly":4,	"yearly":1})
	static biyearly = 	 	new Period(Period.periodName.biyearly,		"2 years",		undefined,						Period.monthly,{"semimonthly":48,"monthly":24, "bimonthly":12,  "quarterly":8,	"yearly":2})


	static longestPeriod = arr => arr.sort(utils.sorters.desc(p => p.getTimeIntervalFromDate(new Date())))[0]
	static shortestPeriod = arr => arr.sort(utils.sorters.asc(p => p.getTimeIntervalFromDate(new Date())))[0]
}

