import {relativeDates} from './Time'
import utils from './utils'

const AppConfig = {
	serverURL: "https://8nwhu27f2l.execute-api.us-west-2.amazonaws.com/dev",
	featureFlags: {
		apiCategorizationOfflineMode: false,
		apiUncategorizationOfflineMode: false
	},
	transactionFetchMinDate: relativeDates.threeYearsAgo(),
}


export default AppConfig;