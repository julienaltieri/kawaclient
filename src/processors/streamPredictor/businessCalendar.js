/* ==================================================================================================
   WHICH DAYS A BANK ACTUALLY MOVES MONEY ON, PER COUNTRY.

   A REAL-TIME ACCOUNT ONLY POSTS ON A BUSINESS DAY. A standing payment scheduled for the 1st does
   not move on the 1st when the 1st is a Sunday - it lands on the Friday before or the Monday after,
   depending on the arrangement the payer has. The ledger holds where it LANDED, so a stream that is
   perfectly regular reads as scattered by up to three days, and anything measuring how tightly it
   lands on a day is reading calendar noise as irregularity.

   A DEFERRED ACCOUNT IS DIFFERENT AND MUST NOT BE ADJUSTED. A card charge posts when the merchant
   presents it, which has nothing to do with whether the bank is open. Measured over the captured
   portfolio the difference is the evidence for the whole idea: adjusting real-time accounts tightens
   them by 12.6% on average, adjusting card accounts by 2.4%, and the card figure is what
   best-of-three costs you for free.

   ---- WHY THIS IS PER COUNTRY -----------------------------------------------------------------------

   NONE OF IT IS UNIVERSAL. Which days are a weekend is not - much of the Gulf runs Friday-Saturday -
   and the holidays are not remotely. A holiday list compiled for one country and applied to another
   invents closures on days the banks are open and misses the ones they are not, which is worse than
   having no adjustment at all because it moves dates confidently in the wrong direction.

   ONLY THE UNITED STATES IS FILLED IN, because that is the only country in the captured portfolio. A
   second country is a second entry in CALENDARS with its own weekend days and its own holiday rule,
   and nothing else in the module changes. A country that is not in the table gets NO adjustment
   rather than the American one.

   ---- WHY THE DATES ARE READ IN THE USER'S TIMEZONE --------------------------------------------------

   A BANK DATE IS A DATE, NOT AN INSTANT. It arrives as "2026-01-02" and is stored as UTC midnight.
   Ask that value for its weekday with getDay() on a machine west of Greenwich and it answers
   Thursday for a Friday, because UTC midnight is the previous evening locally. A first pass at this
   file did exactly that and reported Rent landing on Sundays.

   SO THE CALENDAR DAY IS READ THROUGH THE USER'S OWN OFFSET, taken from the account rather than from
   whatever machine happens to be running - a prediction must not change because it was computed on a
   laptop in a different timezone. `offsetHours` is the user's, and zero reproduces the date exactly
   as the bank stated it, which is the right default when the account has not said otherwise.
   ================================================================================================== */

const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

/* THE CALENDAR DATE THE BANK MEANT, as a UTC-midnight instant this module can do arithmetic on.
   Shifting by the user's offset first, then reading the UTC fields, gives the day the user would see
   on their statement whatever machine this runs on. */
export function calendarDay(date, offsetHours){
	const t = new Date(date).getTime() + (offsetHours || 0) * ONE_HOUR;
	const d = new Date(t);
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const key = d => d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();

const nthWeekday = (year, month, weekday, n) => {
	const first = utc(year, month, 1);
	return utc(year, month, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
};

const lastWeekday = (year, month, weekday) => {
	const last = utc(year, month + 1, 0);
	return utc(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
};

/* ---- THE UNITED STATES ---------------------------------------------------------------------------
   THE FEDERAL LIST, COMPUTED RATHER THAN TABULATED, so it keeps working in a year nobody has written
   down yet. A fixed-date holiday falling on a weekend is OBSERVED on the nearest weekday - Saturday
   back to Friday, Sunday forward to Monday - and the observed day is the one the banks close on, so
   it is the one computed here. */
const usObserved = date => {
	if(date.getUTCDay() === 6)return new Date(date.getTime() - ONE_DAY);
	if(date.getUTCDay() === 0)return new Date(date.getTime() + ONE_DAY);
	return date;
};

const usHolidays = year => [
	usObserved(utc(year, 0, 1)),        //New Year's Day
	nthWeekday(year, 0, 1, 3),          //Martin Luther King Jr Day
	nthWeekday(year, 1, 1, 3),          //Presidents Day
	lastWeekday(year, 4, 1),            //Memorial Day
	usObserved(utc(year, 5, 19)),       //Juneteenth
	usObserved(utc(year, 6, 4)),        //Independence Day
	nthWeekday(year, 8, 1, 1),          //Labor Day
	nthWeekday(year, 9, 1, 2),          //Columbus Day
	usObserved(utc(year, 10, 11)),      //Veterans Day
	nthWeekday(year, 10, 4, 4),         //Thanksgiving
	usObserved(utc(year, 11, 25)),      //Christmas Day
	//Jan 1 of the next year is observed on Dec 31 when it falls on a Saturday
	usObserved(utc(year + 1, 0, 1))
];

export const CALENDARS = {
	US: {name: 'United States', weekend: [0, 6], holidays: usHolidays}
};

export const DEFAULT_COUNTRY = 'US';

const cache = {};

const holidaySet = (country, year) => {
	const cal = CALENDARS[country];
	if(!cal)return {};
	const id = country + ':' + year;
	if(!cache[id]){
		const set = {};
		cal.holidays(year).forEach(d => { set[key(d)] = true; });
		cache[id] = set;
	}
	return cache[id];
};

export function isHoliday(date, country){
	const d = new Date(date);
	return !!holidaySet(country || DEFAULT_COUNTRY, d.getUTCFullYear())[key(d)];
}

/* A COUNTRY THIS MODULE DOES NOT KNOW HAS NO CLOSED DAYS, which means no adjustment at all rather
   than somebody else's. */
export function isBusinessDay(date, country){
	const cal = CALENDARS[country || DEFAULT_COUNTRY];
	if(!cal)return true;
	const d = new Date(date);
	if(cal.weekend.indexOf(d.getUTCDay()) >= 0)return false;
	return !isHoliday(d, country || DEFAULT_COUNTRY);
}

/* ---- UNDOING THE BANK'S SHIFT -------------------------------------------------------------------
   THE LEDGER HOLDS WHERE THE MONEY LANDED, NOT WHEN IT WAS DUE, and which of two arrangements the
   payer has is not written down anywhere. So both are computed and the stream is asked which one
   makes it look regular:

     next    the bank posts on the FIRST open day after a closure. A payment observed on a Monday
             may have been due on the Saturday or Sunday before, so it is pulled back to the start
             of that closed run.

     back    the bank posts on the LAST open day before a closure. A payment observed on a Friday
             may have been due on the Saturday, Sunday or Monday after, so it is pushed forward to
             the end of that closed run.

   EACH MAPS TO THE FAR END OF THE CLOSED RUN rather than into the middle. Any day in the run would
   serve - what matters is that every occurrence of the same scheduled day maps to the SAME place,
   which is what collapses the scatter - and an end is unambiguous.

   A DATE NOT NEXT TO A CLOSURE IS LEFT ALONE by both, so a stream that never straddles a weekend
   reads identically under all three and correctly reports no rule. */
export const SNAP = {none: 'none', next: 'next', back: 'back'};

export function snapDate(date, how, country){
	const c = country || DEFAULT_COUNTRY;
	let d = new Date(date);
	if(how === SNAP.none || !CALENDARS[c] || !isBusinessDay(d, c))return d;
	const step = how === SNAP.next ? -ONE_DAY : ONE_DAY;
	let probe = new Date(d.getTime() + step);
	let guard = 0;
	while(!isBusinessDay(probe, c) && ++guard < 30){
		d = probe;
		probe = new Date(d.getTime() + step);
	}
	return d;
}

/* ---- WHERE A PAYMENT DUE ON A SHUT DAY ACTUALLY LANDS -------------------------------------------
   snapDate above runs BACKWARDS, from a date the ledger recorded to the date it was due. This runs
   forwards, from a date that is due to the date the money will move, and the two are not the same
   journey: one undoes a bank, the other predicts it.

   THE RULE BELONGS TO THE RAIL, NOT THE ACCOUNT. A payroll credit arrives EARLY when payday is a
   Saturday - the employer funds it on the Friday. A direct debit is collected LATE, on the next
   business day. A card does not care at all and posts on the Saturday. All three can sit on the same
   account, so the rule is learned per mode and passed in. */
export const RAIL = {early: 'early', late: 'late', ignored: 'ignored'};

export function settleDate(due, rule, country){
	const c = country || DEFAULT_COUNTRY;
	const d = new Date(due);
	if(rule === RAIL.ignored || !rule || !CALENDARS[c])return d;
	if(isBusinessDay(d, c))return d;
	const step = rule === RAIL.early ? -ONE_DAY : ONE_DAY;
	let probe = new Date(d.getTime() + step), guard = 0;
	while(!isBusinessDay(probe, c) && ++guard < 30)probe = new Date(probe.getTime() + step);
	return probe;
}

export default isBusinessDay;
