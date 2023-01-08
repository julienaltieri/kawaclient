const {v4:uuidv4}  = require('uuid');
const currency = require('currency.js');

exports.errors = {
	abstractMethodCalled : "Trying to call an abstract method. It must be overriden from a subsclass",
	terminalStreamMissingMendatoryAmountHistory : "Trying to instanciate a terminal stream that is missing a expected amount history. This isn't allowed."
}

exports.createDate = function(year=2000,month=0,day=0,hours=0,minutes=0,seconds=0,millis=0){
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

//chunch array into chunks of n elements
exports.chunk = (a,n)=>[...Array(Math.ceil(a.length/n))].map((_,i)=>a.slice(n*i,n+n*i));

//pretty-print a transaction
exports.printTransaction = function(t){console.log(`${(new Date(t.date)).toDateString()} ${t.Amount} : ${t.Description}`)}

//reducers
exports.reducers = {
	sum : f => (acc,va)=> Math.round(1000*(acc+(f?f(va):va)))/1000, //ex: [].reduce(sum(a => a.amount))
	max : f => (acc,va)=> Math.max(acc,(f?f(va):va)),
	min : f => (acc,va)=> Math.min(acc,(f?f(va):va)),
	concat : f => (acc,va)=> acc.concat(f?f(va):va),
	stringConcat : (f,d)=> (acc,va)=> acc + (f?f(va):va)+(d?d:""),
	or: f => (acc,va)=> acc || (f?f(va):va),
	and: f => (acc,va)=> acc && (f?f(va):va),
	groupBy: f => (acc,va)=> {(acc[(f?f(va):va)] = acc[(f?f(va):va)] || []).push(va);return acc}
}

exports.or = (array,f= x=>x) => array.some(f)
exports.and = (array,f= x=>x) => array.every(f)
exports.min = (array,f) => array.reduce(this.reducers.min(f),Number.MAX_VALUE)
exports.max = (array,f) => array.reduce(this.reducers.max(f),Number.MIN_VALUE)
exports.sum = (array,f) => Math.round(1000*array.reduce(this.reducers.sum(f),0))/1000
exports.groupBy = (array,f) => array.reduce(this.reducers.groupBy(f),[])
exports.flatGroupBy = (array,f) => {var a = this.groupBy(array,f);return Object.keys(a).map(k => a[k])}
exports.stringConcat = (array,f) => array.reduce(this.reducers.stringConcat(f),"")

//sorters
exports.sorters = {
	asc : f => (a,b)=> f?f(a)-f(b):a-b,
	desc : f => (a,b)=> f?f(b)-f(a):b-a
}

//array functions
exports.flatten = node => {
	if(Array.isArray(node)){
		return node.reduce(exports.reducers.concat(),[])
	}else return Object.keys(node).reduce((ac, va) => [...ac,...exports.flatten(node[va])],[])
}
exports.isArrayAIncludedInB = (a,b) => this.and(a.map(aa => b.indexOf(aa)>-1)) 
exports.rotateRight = function(arr, n) {
  arr.unshift.apply(arr,arr.splice(n,arr.length));
  return arr;
}
exports.rotateLeft = (arr,n) => exports.rotateRight(arr,-n);

exports.round2Decimals = (x) => Math.round(x*100)/100

exports.getNewUuid = function(){
	return uuidv4();
}

exports.convertDatesToString = function(obj){
	objectReplaceForEach(obj,function(value){
		if(value instanceof Date){
			return value+""
		}else return value
	})
	return obj;
}

exports.convertStringsToDates = function(obj){
	objectReplaceForEach(obj,function(value){
		if(!/^\d+$/.test(value) && !isNaN(new Date(value))){ //numbers will be converted to Dates otherwise
			return new Date(value)
		}else return value
	})
	return obj;
}

function objectReplaceForEach(obj,f){
	if(!f)f=(a) => a; 
    for (var k in obj){
        if (typeof obj[k] == "object" && !(obj[k] instanceof Date) && obj[k] !== null)objectReplaceForEach(obj[k],f);
        else if(k.toLowerCase().indexOf("date")>-1) obj[k] = f(obj[k])//only apply the function if the field seems to be a date
    }
}

exports.morphObjectAIntoB = function(a,b){
    Object.keys(a).forEach(key => delete a[key])
    Object.keys(b).forEach(key => a[key] = b[key])
}

exports.getSavableClone = function(obj){return this.convertDatesToString(JSON.parse(JSON.stringify(obj)))}
exports.getObjectClone = function(obj){return this.convertStringsToDates(JSON.parse(JSON.stringify(obj)))}


exports.stringMerge = function(array,delimitor){//merges an array of strings
	return array.reduce(this.reducers.stringConcat(undefined,delimitor),"")
}

exports.formatDollarAmount = function(n,fixed = 2,noMinusSign = false, noPlusSign = true){
	return ((n<0 && !noMinusSign)?"-":(n>0 && !noPlusSign)?"+":"")+"$"+(Math.abs(n).toFixed(fixed).replace(/\B(?=(\d{3})+(?!\d))/g, ",")||"-")
}
exports.parseDollarsAmount = (a) => currency(a)


exports.makeMapFromId = function(arr,f){
	if(!f)throw new Error("function makeMapFromId requires to pass an accessor function.")
	var res = {};
	arr.forEach(item => {
		res[f(item)] = item
	})
	return res;
}

exports.getAllValuesFromObject = (obj) => Object.keys(obj).map(k => obj[k])

exports.dedup = (array,hash,isDuplicate) => { //either use hash function or isDuplicate test
	if(!!hash){
		var res = []
		var hashes = []
		array.forEach(e => {
			if(hashes.indexOf(hash(e))==-1){
				res.push(e)
				hashes.push(hash(e))
			}
		})
		return res
	}else{
		var res = [];
		array.forEach(e => {
			if(res.filter(a => isDuplicate(a,e)).length==0){
				res.push(e)
			}
		})
		return res
	}
}


//merge arrays with associated scores driven by weights
exports.weightedMerge = (sets,weights,accessor) => {
	var max = sets.reduce(this.reducers.max(s => s.length),0)
	var res = {}
	for (var i = max - 1; i >= 0; i--) {
		sets.forEach((s,j) => {
			if(!!s[i]){
				var k = accessor(s[i])
				if(!res[k])res[k]={obj: s[i],score:0}

				res[k].score = res[k].score + weights[j]
			}
		})
	}
	return Object.keys(res).map(k => res[k])
}

exports.pivot = (columns, data, belongingTest) => {
	var res = columns.map(a => {
		return {key: a, matching: []}
	})
	var indexes = columns.map(a => JSON.stringify(a))
	columns.forEach(c => {
		data.forEach(d => {
			if(belongingTest(c,d)){
				res[indexes.indexOf(JSON.stringify(c))].matching.push(d)
				return
			}
		})
	})
	return res
}

exports.combine = function(a, min) {var fn = function(n, src, got, all) {if (n == 0) {if (got.length > 0) {all[all.length] = got};return};for (var j = 0; j < src.length; j++) {fn(n - 1, src.slice(j + 1), got.concat([src[j]]), all)};return};var all = [];for (var i = min; i < a.length; i++) {fn(i, a, [], all)};all.push(a);return all}
exports.formatDateShort = (d) => (d.getMonth()+1)+"/"+d.getDate()+"/"+(d.getFullYear()-2000)

//returns the insert index of value in array.map(accessor)
exports.searchInsertAsc = function(array, value, accessor = a => a) {
    var s = 0,e = array.length - 1;
    var i = Math.floor((e - s) / 2) + s;
    if (value > accessor(array[array.length-1])) {i = array.length}
    else {while (s < e) {
        var val = accessor(array[i]);
        if (val === value) {break}
        else if (value < val) {e=i}
        else {s = i + 1}
        i = Math.floor((e-s)/2)+s;
    }}
    if(value === array[i]) {
    	while(value === array[i] && i >= 0){i--}
    		return i+1
    }else return i;
};

exports.searchInsertDesc = function(array, value, accessor = a => a) {
    var s = 0,e = array.length - 1;
    var i = Math.floor((e - s) / 2) + s;
    if (value < accessor(array[array.length-1])) {i = array.length}
    else {while (s < e) {
        var val = accessor(array[i]);
        if (val === value) {break}
        else if (value > val) {e=i}
        else {s = i + 1}
        i = Math.floor((e-s)/2)+s;
    }}
    if(value === array[i]) {
    	while(value === array[i] && i >= 0){i--}
    		return i+1
    }else return i;
};
//searchInsertDesc([5,5,4],5)