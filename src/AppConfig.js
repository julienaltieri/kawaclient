import {relativeDates} from './Time'
const utils = require('./utils.js');

const AppConfig = {
	serverURL: "https://8nwhu27f2l.execute-api.us-west-2.amazonaws.com/dev",
	featureFlags: {
		apiCategorizationOfflineMode: false,
		apiUncategorizationOfflineMode: false
	},
	transactionFetchMinDate: relativeDates.threeYearsAgo(),
}


export default AppConfig;