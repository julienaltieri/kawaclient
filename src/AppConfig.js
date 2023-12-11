import {relativeDates} from './Time'
import utils from './utils'

let staging = false;

const AppConfig = {
	serverURL: staging?"":"https://8nwhu27f2l.execute-api.us-west-2.amazonaws.com/dev",
	featureFlags: {
		apiCategorizationOfflineMode: false,
		apiUncategorizationOfflineMode: false,
		apiDisableMasterStreamUpdates: false,
		forceDesignMode: ["","darkMode","lightMode"][0],
	},
	transactionFetchMinDate: relativeDates.oneYearAgo(),
}


export default AppConfig;