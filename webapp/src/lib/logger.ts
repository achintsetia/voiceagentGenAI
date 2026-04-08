type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// In production builds, suppress debug/info. Set to "debug" locally via localStorage.
function getMinLevel(): LogLevel {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("logLevel") as LogLevel | null;
    if (stored && stored in LEVELS) return stored;
  }
  return import.meta.env.DEV ? "debug" : "warn";
}

function formatMsg(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  return `[${ts}] [${tag}] ${msg}`;
}

export function createLogger(tag: string) {
  function shouldLog(level: LogLevel) {
    return LEVELS[level] >= LEVELS[getMinLevel()];
  }

  return {
    debug: (msg: string, ...args: unknown[]) => {
      if (shouldLog("debug")) console.debug(formatMsg(tag, msg), ...args);
    },
    info: (msg: string, ...args: unknown[]) => {
      if (shouldLog("info")) console.info(formatMsg(tag, msg), ...args);
    },
    warn: (msg: string, ...args: unknown[]) => {
      if (shouldLog("warn")) console.warn(formatMsg(tag, msg), ...args);
    },
    error: (msg: string, ...args: unknown[]) => {
      if (shouldLog("error")) console.error(formatMsg(tag, msg), ...args);
    },
  };
}
