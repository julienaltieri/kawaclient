import {relativeDates} from './Time'
const utils = require('./utils.js');

const AppConfig = {
	featureFlags: {
		apiCategorizationOfflineMode: false,
		apiUncategorizationOfflineMode: false
	},
	transactionFetchMinDate: relativeDates.threeYearsAgo(),
}


export default AppConfig;