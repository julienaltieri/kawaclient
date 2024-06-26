const {v4:uuidv4}  = require('uuid');
const currency = require('currency.js');

let exports = {}

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
exports.min = (array,f) => array.reduce(exports.reducers.min(f),Number.MAX_VALUE)
exports.max = (array,f) => array.reduce(exports.reducers.max(f),Number.MIN_VALUE)
exports.sum = (array,f) => Math.round(1000*array.reduce(exports.reducers.sum(f),0))/1000
exports.groupBy = (array,f) => array.reduce(exports.reducers.groupBy(f),[])
exports.flatGroupBy = (array,f) => {var a = exports.groupBy(array,f);return Object.keys(a).map(k => a[k])}
exports.stringConcat = (array,f) => array.reduce(exports.reducers.stringConcat(f),"")

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
exports.isArrayAIncludedInB = (a,b) => exports.and(a.map(aa => b.indexOf(aa)>-1)) 
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

exports.getSavableClone = function(obj){return exports.convertDatesToString(JSON.parse(JSON.stringify(obj)))}
exports.getObjectClone = function(obj){return exports.convertStringsToDates(JSON.parse(JSON.stringify(obj)))}
exports.deepClone = function(obj, clones = new WeakMap()) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof RegExp) return new RegExp(obj);
    if (obj instanceof Error) return new Error(obj.message);
    if (typeof obj === 'function') return structuredClone(obj);
    if (typeof obj === 'symbol') return Object(Symbol.prototype.valueOf.call(obj));
    if (obj instanceof Map) return new Map([...obj].map(([k, v]) => [exports.deepClone(k, clones), exports.deepClone(v, clones)]));
    if (obj instanceof Set) return new Set([...obj].map(v => exports.deepClone(v, clones)));
    const proto = Object.getPrototypeOf(obj);
    if (proto !== null && proto !== Object.prototype) exports.deepClone(proto, clones);
    const clone = Array.isArray(obj) ? [] : Object.create(proto);
    clones.set(obj, clone);
    for (const [key, value] of Object.entries(obj)) clone[key] = exports.deepClone(value, clones);
    return clone;
}

exports.stringMerge = function(array,delimitor){//merges an array of strings
	return array.reduce(exports.reducers.stringConcat(undefined,delimitor),"")
}

//exports.formatDollarAmount = (n,fixed,noMinusSign,noPlusSign) => exports.formatCurrencyAmount(n,fixed,noMinusSign,noPlusSign,"USD")
exports.formatCurrencyAmount = function(n,fixed = 2,noMinusSign = false, noPlusSign = true, cur = "USD"){
	if(cur=="EUR"){return ((n<0 && !noMinusSign)?"-":(n>0 && !noPlusSign)?"+":"")+(Math.abs(n).toFixed(fixed).replace(".",",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")||"-")+"€"}
	else return ((n<0 && !noMinusSign)?"-":(n>0 && !noPlusSign)?"+":"")+"$"+(Math.abs(n).toFixed(fixed).replace(/\B(?=(\d{3})+(?!\d))/g, ",")||"-")
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
	var max = sets.reduce(exports.reducers.max(s => s.length),0)
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

exports.capitalize = function(s){
	return s.split(". ").map(ss => ss[0].toUpperCase()+ss.slice(1)).reduce((a,v) => a = a+v,[])
}

//returns an array of sorted words from the provided string immune to accent, special characters, double spaces, and order change. Used for hashing
exports.stringHashArray = function(s){
	return s.toLowerCase()
	.normalize("NFD").replace(/[\u0300-\u036f]/g, "") 	//removes any accent
	.replace(/[^\w\s]/gi, '').replace(/ +/g,' ')		//removes extra spaces and special characters
	.split(' ').sort(exports.sorters.alphabetical())		//descriptions change order sometimes based on the aggregator
}


/**** Hashmap ****
Class to manage typical operations withing hashmaps. Inspired by ES6 Maps, but not a replica and compatible with node.js
- set: must be either a structured hashmap { key: [values...]} or an array of [values...] with a hash function (value) => group 
- values can be objects
*******************/
class Hashmap{
	constructor(set,hashF){
		if(typeof set == 'object'){
			if(Array.isArray(set)){
				let res = {}
				set.forEach(t => {
					if(!res[hashF(t)]){res[hashF(t)] = []}
					res[hashF(t)].push(t)
				})
				this.map = res
			}else{this.map = set}
		}
	}
	//getters
	get(k){return this.map[typeof k=='number'?Object.keys(this.map)[0]:k]}
	getValues(){return exports.flatten(Object.values(this.map))}
	valuesLength(){return this.getValues().length}
	keysLength(){return Object.keys(this.map).length}
	snap(){return exports.deepClone(this.map)}

	//operators (always return a new hashmap and doesn't mutate the original one)
	filterByKeys(test){return new Hashmap(Object.fromEntries(Object.entries(this.map).filter(([k,v]) => test(k))))}
	filterByValues(test){return new Hashmap(Object.fromEntries(Object.entries(this.map).map(([k,v]) => [k,v.filter(test)]).filter(([k,v])=>v.length>0)))}
	substract(hashmap,idAccessor = x => JSON.stringify(x)){
		let ids = hashmap.getValues().map(idAccessor)
		return this.filterByValues(t => ids.indexOf(idAccessor(t))==-1)
	}
	mergeWith(hashmap, idAccessor = x => JSON.stringify(x)){
		let r = this.snap()
		Object.keys(hashmap.map).forEach(k => {
			if(!r[k]){r[k]=hashmap.map[k]}
			else{r[k] = utils.dedup([...r[k],...hashmap.map[k]],idAccessor)}
		})
		return new Hashmap(r)
	}
	//returns a new Hashmap where keys have been reduced and merged based on the getCommonKey function. getCommonKey must return the common key of two values if they should be merged, and undefined otherwise.
	reduceByKey(getCommonKey){
		let keys = Object.keys(this.map)
		let res = {}
		for (var i = 0; i < keys.length; i++) {
			let matched = false
			keys.slice(0,i).forEach(k => {
				let c = getCommonKey(this.map[keys[i]][0],this.map[k][0])
				if(c){//if there is a common key
					res[c] = [...this.map[k],...this.map[keys[i]]]
					delete res[[keys[i],k].filter(o => o!=c)[0]]
					matched = true
				}
			})
			if(!matched){res[keys[i]]=this.map[keys[i]]}
		}
		return new Hashmap(res)
	}


	//analysis
	histogram(){
		let res ={};
		Object.keys(this.map).forEach(k => {
			let l = this.map[k].length
			if(!res[l]){res[l]={description: "Groups with " +l+" value(s)",count:0}}
			res[l].count = res[l].count+1
		})
		return Object.entries(res).map(([k,v])=> {
			let r = {}
			r[v.description] = v.count
			return r
		})
	}
}

exports.Hashmap = Hashmap


const utils = exports
export default utils
