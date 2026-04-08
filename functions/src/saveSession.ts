import {onCall, HttpsError} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

if (getApps().length === 0) {
  initializeApp();
}

interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string; // ISO string
}

interface SaveSessionData {
  timestamp: number;
  messages: SessionMessage[];
}

export const saveSession = onCall({region: "asia-south1"}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated.");
  }

  const email = request.auth.token.email;
  if (!email) {
    throw new HttpsError("unauthenticated", "User email is required.");
  }

  const data = request.data as SaveSessionData;
  const {timestamp, messages} = data;

  if (!timestamp || !Array.isArray(messages) || messages.length === 0) {
    throw new HttpsError("invalid-argument", "timestamp and non-empty messages are required.");
  }

  const db = getFirestore();
  const sessionId = String(timestamp);

  await db
    .collection("conversations")
    .doc(email)
    .collection("sessions")
    .doc(sessionId)
    .set({timestamp, messages});

  logger.info(`Saved session ${sessionId} for ${email} with ${messages.length} messages`);
  return {sessionId};
});
