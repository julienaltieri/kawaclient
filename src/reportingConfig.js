/* ==================================================================================================
   THE REPORTING CONFIG, ALONE IN A FILE THAT NEEDS NOTHING.

   IT LIVES HERE RATHER THAN IN ReportingCore.js BECAUSE THE STREAM PREDICTOR CANNOT IMPORT core.js.
   ReportingCore pulls in Core and AppConfig, which need a browser and a logged-in user; a predictor
   that reached them could not be run under node and could not be tested. The predictor still needs
   the ONE anchor date the app already agrees on, so the config moves to where both sides can read it
   instead of being copied - a copy drifts the first time either side is edited, and the two would
   then disagree about where a cycle begins while both looked correct.

   THIS FILE IMPORTS `Period` FROM ./Time AND MUST IMPORT NOTHING ELSE. Time.js depends only on lodash
   and ./utils, so it stays runnable under plain node. Any other import here re-breaks the test suite.
   ================================================================================================== */

import {Period} from './Time';

/* THE ANALYSIS YEAR STARTS ON DECEMBER 21st, chosen because almost no transaction lands on it - a
   seam that falls on a payday splits one movement across two periods.

   `startingMonth` IS 1-BASED - december = 12 - and every reader subtracts one before handing it to a
   Date. The observation period must be longer than or equal to the longest stream's period, or an
   analysis covers less than one cycle of that stream and reports the shortfall as a fact. */
export const reportingConfig = {
	startingDay: 21,
	startingMonth: 12, //december = 12
	observationPeriod: Period.yearly,
}

export default reportingConfig;
