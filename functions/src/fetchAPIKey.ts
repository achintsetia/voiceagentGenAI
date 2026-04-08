import {onCall, HttpsError} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";

export const fetchAPIKey = onCall({region: "asia-south1"}, (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "User must be authenticated to access this resource."
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.error("GEMINI_API_KEY is not set in environment variables.");
    throw new HttpsError(
      "internal",
      "API key is not configured on the server."
    );
  }

  logger.info("Serving Gemini API key to user:", request.auth.uid);
  return {apiKey};
});
