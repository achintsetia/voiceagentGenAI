import * as dotenv from "dotenv";
dotenv.config();

import {setGlobalOptions} from "firebase-functions";

setGlobalOptions({maxInstances: 10, region: "asia-south1"});

export {fetchAPIKey} from "./fetchAPIKey.js";
export {saveSession} from "./saveSession.js";
export {processTodos} from "./processTodos.js";
export {getLastSessionSummary} from "./getLastSessionSummary.js";

