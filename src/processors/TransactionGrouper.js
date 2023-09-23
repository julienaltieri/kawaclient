import utils from '../utils'
let exports = {}


exports.clusterTransactions = (transactionArray) => processTree(affinityTree(transactionArray,0))
exports.getRelevantBranchInTree = (txn,tree) => {
	var {key,branch} = getDeepestBranchMatchingPrefix(txn.description,tree)
	return {key:key,branch:utils.flatten(branch)}
}

//looks for the deeptest branch matching the prefix and return a pair {key, branch} where key is the deepest prefix found in tree, and branch is the structured tree matching this key
//ex: "99 ranch mountain view ca a245s312" will match the branch "99 ranch"->"mountain vew ca", and therefore will return the subtree containing all transaction matching "99 ranch mountain view ca"
function getDeepestBranchMatchingPrefix(prefix,tree){
	if(prefix?.length>0 && !Array.isArray(tree)){
		var words = getWords(cleanString(prefix))
		for(var k in tree){
			if(words.reduce(utils.reducers.stringConcat(undefined," "),"").indexOf(k)>-1){
				var r = getDeepestBranchMatchingPrefix(cleanString(prefix).split(k+" ")[1],tree[k])
				return {key:r.key.length?k+" "+r.key:k, branch: r.branch}
			}
		}
	}
	return {key: "",branch:tree}
}

exports.doesTransactionMatchString = (transaction,matchingString) => hasPrefix(transaction.description,matchingString)
exports.doesTransactionContainStringByWords = (transaction,matchingString) => containsAllWords(transaction.description,matchingString)

function hasPrefix(s,prefix){
	return (getWords(s).reduce(utils.reducers.stringConcat(undefined," "),"").indexOf(prefix)>-1)
}
function containsAllWords(s,matchingString){
	var testString = getWords(s)
	return utils.and(getWords(matchingString), w => testString.indexOf(w)>-1)
}

function getWords(s){return cleanString(s).split(" ")}
function cleanString(s){return s.toLowerCase().replace(/[^a-zA-Z0-9]/g, " ").replace(/\s\s+/g, ' ').replace(/"|'/g, '').replace(/^\s+|\s+$/g,'')}
function affinityTree(transactionArray,skipWords){
	if(skipWords>5 || transactionArray.length<=1){return transactionArray}//cap at 5 words deep
	var grouped = transactionArray.reduce((ac,txn)=>{
		var txnWords = getWords(txn.description)
		var words = txnWords.slice(skipWords,txnWords.length)//we will use the words skipping skipWords words
		if(!!ac[(words[0]||"--other--")]){ac[words[0]||"--other--"].push(txn)}
		else{ac[words[0]||"--other--"] = [txn]}
		return ac;
	},{})

	for(var k in grouped){grouped[k] = affinityTree(grouped[k],skipWords+1)}
	return grouped
}
function processTree(node){
	if(Array.isArray(node)|| !!node.description)return node
	var res = {}
	for(var k in node){
		var children = Object.keys(node[k]).map(i => node[k][i]);
		if(children.filter(a => Array.isArray(a) && a.length==1).length>0){//if there is a solo transaction at the root of this tree, flatten
			res[k] = utils.flatten(node[k])
		}else if(children.length==1){//only one sub grouping, merge
			var uniqueKey = Object.keys(node[k])[0]//unique key
			if(!!uniqueKey && uniqueKey!="" && uniqueKey!=0){//if the unique key is a real one, move child up one level
				var updatedKey = (uniqueKey=="--other--")?k:(k+' '+uniqueKey)
				res[updatedKey] = processTree(node[k][uniqueKey])
				res = processTree(res)
			}else{res[k] = node[k]}
		}else{//if there are multiple children, process them
			res[k] = processTree(node[k])
		}
	}
	return res
}


const TransactionGrouper = exports
export default TransactionGrouper