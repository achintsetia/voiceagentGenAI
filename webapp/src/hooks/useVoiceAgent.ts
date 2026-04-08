import { useState, useRef, useCallback } from "react";
import { GoogleGenAI, Modality } from "@google/genai";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/firebase.js";
import { createLogger } from "@/lib/logger";

// All Cloud Functions are deployed to asia-south1.
const functions = getFunctions(app, "asia-south1");

// Gemini Live model for real-time voice interactions.
// Switch to "gemini-live-2.5-flash-preview" when it becomes available in your region.
const GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";

const INPUT_SAMPLE_RATE = 16000;  // Gemini Live input: 16 kHz PCM
const OUTPUT_SAMPLE_RATE = 24000; // Gemini Live output: 24 kHz PCM

const log = createLogger("VoiceAgent");

function buildSystemInstruction(userName: string | null): string {
  const addressee = userName ? userName.split(" ")[0] : "there";
  return `You are a warm, empathetic daily journal companion. Your purpose is to help ${userName ?? "the user"} reflect on their day through natural, conversational voice interactions.

The user's name is ${userName ?? "unknown"}. Address them by their first name (${addressee}) naturally throughout the conversation — not in every sentence, but enough to make it feel personal.

Guidelines:
- Greet ${addressee} warmly at the start of each session and ask how their day is going.
- Ask open-ended, thoughtful questions about their activities, feelings, accomplishments, and challenges.
- Listen attentively; refer back to things they mentioned earlier in the conversation to show you're paying attention.
- Respond with empathy and encouragement — never judge.
- Keep your responses concise (2-3 sentences) so the conversation flows naturally.
- Gently prompt for deeper reflection when they share something significant (e.g., "That sounds meaningful — how did that make you feel?").
- If the user mentions something repeatedly across sessions, acknowledge patterns with curiosity.
- When the user wants to wrap up, offer a brief, positive summary of what they shared today.
- Use a calm, supportive tone at all times. You are their trusted confidant.`;
}

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

export function useVoiceAgent(userName: string | null = null) {
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

  // Connecting tone refs
  const toneCtxRef = useRef<AudioContext | null>(null);
  const toneIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Accumulate assistant text across streaming parts until turnComplete
  const pendingAssistantTextRef = useRef<string>("");

  const addMessage = useCallback((role: "user" | "assistant", text: string) => {
    if (!text.trim()) return;
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role, text: text.trim(), timestamp: new Date() },
    ]);
  }, []);

  // Play a soft two-note pulse every 1.2 s while connecting.
  const playConnectingTone = useCallback(() => {
    const ctx = new AudioContext();
    toneCtxRef.current = ctx;

    const playPulse = () => {
      if (!toneCtxRef.current || toneCtxRef.current.state === "closed") return;
      // Two overlapping sine tones (C5 + E5) for a gentle chord
      [[523.25, 0], [659.25, 0.06]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const t = ctx.currentTime + delay;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.12, t + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.start(t);
        osc.stop(t + 0.48);
      });
    };

    playPulse();
    toneIntervalRef.current = setInterval(playPulse, 1200);
    log.debug("Connecting tone started");
  }, []);

  const stopConnectingTone = useCallback(() => {
    if (toneIntervalRef.current) {
      clearInterval(toneIntervalRef.current);
      toneIntervalRef.current = null;
    }
    toneCtxRef.current?.close();
    toneCtxRef.current = null;
    log.debug("Connecting tone stopped");
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

    stopConnectingTone();

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

  }, [stopConnectingTone]);

  const startSession = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    log.info(`Starting session — userName received by hook: "${userName ?? "(null)"}"`);
    playConnectingTone();

    try {
      // 1. Fetch the Gemini API key from the backend (requires Firebase Auth).
      log.info("Fetching API key from backend");
      const fetchAPIKey = httpsCallable<void, { apiKey: string }>(functions, "fetchAPIKey");
      const { data } = await fetchAPIKey();
      const { apiKey } = data;
      log.info("API key fetched successfully");

      // 2. Connect to Gemini Live API.
      log.info(`Connecting to Gemini Live model: ${GEMINI_LIVE_MODEL} (user: ${userName ?? "anonymous"})`);
      const ai = new GoogleGenAI({ apiKey });
      const session = await ai.live.connect({
        model: GEMINI_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},   // transcribe user speech → show in UI
          outputAudioTranscription: {},  // transcribe agent audio → show in UI
          systemInstruction: {
            parts: [{ text: buildSystemInstruction(userName) }],
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

      stopConnectingTone();
      setIsListening(true);
      setIsConnecting(false);
      log.info("Session started — listening");
    } catch (err) {
      log.error("Failed to start session", err);
      stopConnectingTone();
      const message =
        err instanceof Error ? err.message : "Failed to connect. Please try again.";
      setError(message);
      setIsConnecting(false);
      stopSession();
    }
  }, [addMessage, enqueueAudio, stopSession, playConnectingTone, stopConnectingTone, userName]);

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
