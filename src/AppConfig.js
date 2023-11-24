import {relativeDates} from './Time'
import utils from './utils'

let staging = true;

const AppConfig = {
	serverURL: staging?"":"https://8nwhu27f2l.execute-api.us-west-2.amazonaws.com/dev",
	featureFlags: {
		apiCategorizationOfflineMode: false,
		apiUncategorizationOfflineMode: false,
		apiDisableMasterStreamUpdates: false,
	},
	transactionFetchMinDate: relativeDates.oneYearAgo(),
}


export default AppConfig;