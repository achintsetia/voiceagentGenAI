import { useState, useRef, useCallback } from "react";
import { GoogleGenAI, Modality } from "@google/genai";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/firebase.js";

// All Cloud Functions are deployed to asia-south1.
const functions = getFunctions(app, "asia-south1");
import { createLogger } from "@/lib/logger";

// Gemini Live model for real-time voice interactions.
// Switch to "gemini-live-2.5-flash-preview" when it becomes available in your region.
const GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";

const INPUT_SAMPLE_RATE = 16000;  // Gemini Live input: 16 kHz PCM
const OUTPUT_SAMPLE_RATE = 24000; // Gemini Live output: 24 kHz PCM

const log = createLogger("VoiceAgent");

const SYSTEM_INSTRUCTION = `You are a warm, empathetic daily journal companion. Your purpose is to help the user reflect on their day through natural, conversational voice interactions.

Guidelines:
- Greet the user at the start of each session and ask how their day is going.
- Ask open-ended, thoughtful questions about their activities, feelings, accomplishments, and challenges.
- Listen attentively; refer back to things they mentioned earlier in the conversation to show you're paying attention.
- Respond with empathy and encouragement — never judge.
- Keep your responses concise (2-3 sentences) so the conversation flows naturally.
- Gently prompt for deeper reflection when they share something significant (e.g., "That sounds meaningful — how did that make you feel?").
- If the user mentions something repeatedly across sessions, acknowledge patterns with curiosity.
- When the user wants to wrap up, offer a brief, positive summary of what they shared today.
- Use a calm, supportive tone at all times. You are their trusted confidant.`;

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

// Convert Float32 PCM samples to Int16 PCM (required by Gemini Live).
function float32ToInt16PCM(float32: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function useVoiceAgent() {
  const [isListening, setIsListening] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Session & microphone refs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Playback refs — schedule audio chunks back-to-back without gaps
  const playbackContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  // Accumulate assistant text across streaming parts until turnComplete
  const pendingAssistantTextRef = useRef<string>("");

  const addMessage = useCallback((role: "user" | "assistant", text: string) => {
    if (!text.trim()) return;
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role, text: text.trim(), timestamp: new Date() },
    ]);
  }, []);

  const getPlaybackContext = useCallback(() => {
    if (!playbackContextRef.current || playbackContextRef.current.state === "closed") {
      playbackContextRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      nextPlayTimeRef.current = 0;
    }
    return playbackContextRef.current;
  }, []);

  // Enqueue a base64-encoded Int16 PCM audio chunk for seamless playback.
  const enqueueAudio = useCallback(
    (base64Data: string) => {
      try {
        const ctx = getPlaybackContext();
        const binary = atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

        const audioBuffer = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
        audioBuffer.getChannelData(0).set(float32);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const startAt = Math.max(ctx.currentTime + 0.05, nextPlayTimeRef.current);
        source.start(startAt);
        nextPlayTimeRef.current = startAt + audioBuffer.duration;
        log.debug(`Audio chunk queued: ${float32.length} samples, starts at ${startAt.toFixed(3)}s`);
      } catch (e) {
        log.error("Audio playback error", e);
      }
    },
    [getPlaybackContext]
  );

  const stopSession = useCallback(() => {
    log.info("Stopping session — tearing down audio pipeline");

    // Tear down microphone pipeline
    processorRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    log.debug("Microphone pipeline torn down");

    // Close Gemini Live session
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch { /* already closed */ }
      sessionRef.current = null;
      log.debug("Gemini Live session closed");
    }

    // Close playback context
    playbackContextRef.current?.close();
    playbackContextRef.current = null;
    nextPlayTimeRef.current = 0;
    pendingAssistantTextRef.current = "";

    setIsListening(false);
    log.info("Session stopped");
  }, []);

  const startSession = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      // 1. Fetch the Gemini API key from the backend (requires Firebase Auth).
      log.info("Fetching API key from backend");
      const fetchAPIKey = httpsCallable<void, { apiKey: string }>(functions, "fetchAPIKey");
      const { data } = await fetchAPIKey();
      const { apiKey } = data;
      log.info("API key fetched successfully");

      // 2. Connect to Gemini Live API.
      log.info(`Connecting to Gemini Live model: ${GEMINI_LIVE_MODEL}`);
      const ai = new GoogleGenAI({ apiKey });
      const session = await ai.live.connect({
        model: GEMINI_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},   // transcribe user speech → show in UI
          outputAudioTranscription: {},  // transcribe agent audio → show in UI
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
          },
        },
        callbacks: {
          onopen: () => {
            log.info("Session opened");
          },

          onmessage: (msg) => {
            log.debug("Message received", msg);

            // Handle agent audio chunks
            const audioParts =
              msg.serverContent?.modelTurn?.parts?.filter((p) => p.inlineData) ?? [];
            if (audioParts.length > 0) {
              log.debug(`Received ${audioParts.length} audio part(s)`);
            }
            for (const part of audioParts) {
              if (part.inlineData?.data) {
                enqueueAudio(part.inlineData.data);
              }
            }

            // Accumulate agent text (from TEXT modality or transcription)
            const textParts =
              msg.serverContent?.modelTurn?.parts
                ?.filter((p) => p.text)
                ?.map((p) => p.text ?? "")
                ?.join("") ?? "";
            if (textParts) {
              log.debug(`Accumulating text parts: "${textParts}"`);
              pendingAssistantTextRef.current += textParts;
            }

            // Output audio transcription (preferred for audio-only responses)
            const outputTranscript = (msg.serverContent as any)?.outputTranscription?.text as string | undefined;
            if (outputTranscript) {
              log.debug(`Output transcription: "${outputTranscript}"`);
              pendingAssistantTextRef.current += outputTranscript;
            }

            // Flush assistant message when turn is complete
            if (msg.serverContent?.turnComplete) {
              log.info(`Turn complete — assistant said: "${pendingAssistantTextRef.current.slice(0, 80)}${pendingAssistantTextRef.current.length > 80 ? "…" : ""}"`);
              if (pendingAssistantTextRef.current) {
                addMessage("assistant", pendingAssistantTextRef.current);
                pendingAssistantTextRef.current = "";
              }
            }

            // User speech transcription
            const inputTranscript = (msg.serverContent as any)?.inputTranscription?.text as string | undefined;
            if (inputTranscript) {
              log.info(`User said: "${inputTranscript}"`);
              addMessage("user", inputTranscript);
            }
          },

          onerror: (e) => {
            log.error("Session error", e);
            setError("Connection error. Please try again.");
            stopSession();
          },

          onclose: () => {
            log.info("Session closed by server");
            setIsListening(false);
          },
        },
      });

      sessionRef.current = session;
      log.info("Gemini Live session established");

      // 3. Open microphone and stream PCM to Gemini Live.
      log.info("Requesting microphone access");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      log.info("Microphone access granted");

      const audioCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // ScriptProcessorNode captures raw PCM frames.
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (ev) => {
        if (!sessionRef.current) return;
        const pcm = float32ToInt16PCM(ev.inputBuffer.getChannelData(0));
        const b64 = arrayBufferToBase64(pcm);
        sessionRef.current.sendRealtimeInput({
          audio: { data: b64, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
        });
      };

      source.connect(processor);
      // Connect to destination with zero gain to keep the audio graph alive (required by some browsers).
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);
      log.info(`Audio pipeline ready — input: ${INPUT_SAMPLE_RATE} Hz, output: ${OUTPUT_SAMPLE_RATE} Hz`);

      setIsListening(true);
      setIsConnecting(false);
      log.info("Session started — listening");
    } catch (err) {
      log.error("Failed to start session", err);
      const message =
        err instanceof Error ? err.message : "Failed to connect. Please try again.";
      setError(message);
      setIsConnecting(false);
      stopSession();
    }
  }, [addMessage, enqueueAudio, stopSession]);

  const toggleListening = useCallback(() => {
    if (isListening || isConnecting) {
      stopSession();
    } else {
      startSession();
    }
  }, [isListening, isConnecting, startSession, stopSession]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    isListening,
    isConnecting,
    messages,
    error,
    toggleListening,
    clearMessages,
  };
}
