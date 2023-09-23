import utils from '../utils'

let exports = {}

exports.frequencies = function(data, accessor){
	var res = {}
	data.forEach(d => {
		var key = accessor(d)
		res[key] = 1 + (res[key] || 0)
	})

	return Object.keys(res).map(k => {
		return {
			key: k,
			count: res[k],
			frequency: res[k]/data.length
		}
	}).sort(utils.sorters.desc(o => o.frequency))
}

exports.avg = (arr,f) => {
	if(!f)f = x => x
	if(arr.length == 0)return NaN
	return arr.map(f).reduce(utils.reducers.sum(),0)/arr.length
}

exports.median = (arr,f) => {
	if(!f)f = x => x
	if(arr.length == 0)return NaN
	return arr.map(f).sort(utils.sorters.asc())[Math.floor(arr.length/2)]
}

exports.variance = (arr,f) => {
	if(!f)f = x => x
	if(arr.length == 0)return NaN
	var avg = exports.avg(arr,f)
	return arr.map(f).reduce((ac,va) => ac + Math.pow(va-avg,2),0)/arr.length
}

exports.stddev = (arr,f) => Math.sqrt(exports.variance(arr,f))



exports.trendLine = (data) => { //expects [{x:..., y:...},...]
	var a, b, c, d, e, slope, yIntercept;
	var xSum = 0, ySum = 0, xySum = 0, xSquare = 0, n = data.length;
	for(var i = 0; i < n; i++) {
		xySum += data[i].x * data[i].y;
		xSum += data[i].x;
		ySum += data[i].y;
		xSquare += Math.pow(data[i].x, 2)
	}
	slope = (xySum*n - xSum*ySum)/(n*xSquare - Math.pow(xSum, 2));  
	yIntercept = (ySum - slope*xSum) / n;

	return {slope: slope,yIntercept: yIntercept}
}

const Statistics = exports
export default Statistics