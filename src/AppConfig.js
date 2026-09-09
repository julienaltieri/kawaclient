import {relativeDates} from './Time'
import utils from './utils'

let staging = false;

const AppConfig = {
	staging,
	serverURL: staging?"":"https://8nwhu27f2l.execute-api.us-west-2.amazonaws.com/dev",
	featureFlags: {
		apiCategorizationOfflineMode: false,
		apiUncategorizationOfflineMode: false,
		apiDisableMasterStreamUpdates: false,
		forceDesignMode: ["","darkMode","lightMode"][0],
		includeInterestInBudgeting: false,
	},
	transactionFetchMinDate: relativeDates.oneYearAgo(),
	/* The port the LOCAL server listens on, used only by the bench's fixture writer. It is not part of
	   serverURL on purpose: serverURL points at the deployed api whenever `staging` is false, and the
	   fixture has to reach the machine holding the repo rather than the one holding the data. */
	localServerPort: 4001,
}


export default AppConfig;