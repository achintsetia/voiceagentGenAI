import * as dotenv from "dotenv";
dotenv.config();

import {onDocumentCreated} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {GoogleGenAI} from "@google/genai";

if (getApps().length === 0) {
  initializeApp();
}

const GEMINI_MODEL = "gemini-2.5-flash-lite";

interface SessionMessage {
  role: "user" | "assistant";
  text: string;
}

interface TodoItem {
  text: string;
  status: "open" | "closed";
  timestamp: number;
  sourceSessionId: string;
}

interface GeminiTodoItem {
  text: string;
}

/**
 * Builds a prompt that asks Gemini to extract action items from a journal conversation.
 * @param {SessionMessage[]} messages - The conversation messages to process.
 * @return {string} The prompt string to send to Gemini.
 */
function buildExtractionPrompt(messages: SessionMessage[]): string {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.text}`)
    .join("\n");

  return `You are an assistant that extracts actionable to-do items from a journal conversation.

Read the conversation below and identify every concrete action, task, or commitment the user mentioned — things they want to do, need to do, or said they would do.

Rules:
- Only extract clear, actionable items (not general feelings or observations).
- Write each item as a short, actionable phrase starting with a verb (e.g. "Call the dentist", "Finish the project report").
- If there are no actionable items, return an empty array.
- Return ONLY a valid JSON array of objects with a single "text" field and nothing else. No markdown, no explanation.

Example output:
[{"text":"Buy groceries"},{"text":"Schedule a meeting with the team"}]

Conversation:
${transcript}`;
}

export const processTodos = onDocumentCreated(
  {
    document: "conversations/{userEmail}/sessions/{sessionId}",
    region: "asia-south1",
  },
  async (event) => {
    const {userEmail, sessionId} = event.params;

    const snap = event.data;
    if (!snap) {
      logger.warn(`processTodos: no data for session ${sessionId}`);
      return;
    }

    const data = snap.data();
    const messages: SessionMessage[] = (data.messages ?? []) as SessionMessage[];

    if (messages.length === 0) {
      logger.info(`processTodos: empty session ${sessionId}, skipping`);
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.error("processTodos: GEMINI_API_KEY is not set");
      return;
    }

    logger.info(`processTodos: processing session ${sessionId} for ${userEmail} (${messages.length} messages)`);

    let todoTexts: GeminiTodoItem[] = [];

    try {
      const ai = new GoogleGenAI({apiKey});
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: buildExtractionPrompt(messages),
      });

      const raw = response.text?.trim() ?? "[]";
      logger.info(`processTodos: Gemini raw response: ${raw.slice(0, 200)}`);

      // Strip markdown code fences if present
      const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      todoTexts = JSON.parse(jsonStr) as GeminiTodoItem[];

      if (!Array.isArray(todoTexts)) {
        logger.warn("processTodos: Gemini response was not an array, defaulting to empty");
        todoTexts = [];
      }
    } catch (err) {
      logger.error("processTodos: Gemini extraction failed", err);
      return;
    }

    if (todoTexts.length === 0) {
      logger.info(`processTodos: no todos extracted from session ${sessionId}`);
      return;
    }

    const db = getFirestore();
    const batch = db.batch();
    const timestamp = Date.now();

    for (const item of todoTexts) {
      if (!item.text?.trim()) continue;
      const ref = db
        .collection("todos")
        .doc(userEmail)
        .collection("items")
        .doc();

      const todo: TodoItem = {
        text: item.text.trim(),
        status: "open",
        timestamp,
        sourceSessionId: sessionId,
      };
      batch.set(ref, {
        ...todo,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    logger.info(`processTodos: saved ${todoTexts.length} todos for ${userEmail} from session ${sessionId}`);
  }
);
