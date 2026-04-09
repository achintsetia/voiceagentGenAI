import * as dotenv from "dotenv";
dotenv.config();

import {onCall, HttpsError} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {GoogleGenAI} from "@google/genai";

if (getApps().length === 0) {
  initializeApp();
}

const GEMINI_MODEL = "gemini-2.5-flash-lite";

interface SessionMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * Builds a prompt that asks Gemini to summarize a journal conversation.
 * @param {SessionMessage[]} messages - The conversation messages to summarize.
 * @return {string} The prompt string to send to Gemini.
 */
function buildSummaryPrompt(messages: SessionMessage[]): string {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.text}`)
    .join("\n");

  return `You are summarizing a personal journaling conversation between a user and their AI journal companion.

Read the conversation below and produce a concise summary (3-5 sentences) that captures:
- The main topics and themes the user talked about
- Key emotions, challenges, or wins they shared
- Any notable goals, plans, or commitments they mentioned
- The overall mood or tone of the session

Write the summary in the third person (e.g. "The user talked about..."). 
Be warm and empathetic in tone. Return only the summary text — no titles, no bullet points, no markdown.

Conversation:
${transcript}`;
}

export const getLastSessionSummary = onCall(
  {region: "asia-south1"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    const email = request.auth.token.email;
    if (!email) {
      throw new HttpsError("unauthenticated", "User email is required.");
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.error("getLastSessionSummary: GEMINI_API_KEY is not set");
      throw new HttpsError("internal", "API key is not configured on the server.");
    }

    const db = getFirestore();

    // Fetch the most recent session for this user
    const sessionsRef = db
      .collection("conversations")
      .doc(email)
      .collection("sessions");

    const snapshot = await sessionsRef
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) {
      logger.info(`getLastSessionSummary: no prior sessions found for ${email}`);
      return {summary: null};
    }

    const sessionDoc = snapshot.docs[0];
    const sessionData = sessionDoc.data();
    const messages: SessionMessage[] = (sessionData.messages ?? []) as SessionMessage[];

    if (messages.length === 0) {
      logger.info(`getLastSessionSummary: last session is empty for ${email}`);
      return {summary: null};
    }

    logger.info(
      `getLastSessionSummary: summarizing session ${sessionDoc.id} for ${email} (${messages.length} messages)`
    );

    try {
      const ai = new GoogleGenAI({apiKey});
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: buildSummaryPrompt(messages),
      });

      const summary = response.text?.trim() ?? null;
      logger.info(
        `getLastSessionSummary: summary generated for ${email}: "${(summary ?? "").slice(0, 100)}…"`
      );
      return {summary};
    } catch (err) {
      logger.error("getLastSessionSummary: Gemini summarization failed", err);
      throw new HttpsError("internal", "Failed to generate summary.");
    }
  }
);
