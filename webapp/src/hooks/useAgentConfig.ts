import { useState, useEffect, useCallback } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/firebase.js";
import type { User } from "firebase/auth";

export type AgentGender = "neutral" | "female" | "male";

export interface AgentConfig {
  agentName: string;
  agentGender: AgentGender;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  agentName: "Aria",
  agentGender: "neutral",
};

export function useAgentConfig(user: User | null) {
  const [agentConfig, setAgentConfig] = useState<AgentConfig>(DEFAULT_AGENT_CONFIG);
  const [loadingConfig, setLoadingConfig] = useState(false);

  useEffect(() => {
    if (!user) {
      setAgentConfig(DEFAULT_AGENT_CONFIG);
      return;
    }
    setLoadingConfig(true);
    const ref = doc(db, "users", user.uid);
    getDoc(ref)
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setAgentConfig({
            agentName: data.agentName ?? DEFAULT_AGENT_CONFIG.agentName,
            agentGender: data.agentGender ?? DEFAULT_AGENT_CONFIG.agentGender,
          });
        }
      })
      .catch(console.error)
      .finally(() => setLoadingConfig(false));
  }, [user]);

  const saveAgentConfig = useCallback(
    async (config: AgentConfig) => {
      if (!user) return;
      const ref = doc(db, "users", user.uid);
      await setDoc(ref, { agentName: config.agentName, agentGender: config.agentGender }, { merge: true });
      setAgentConfig(config);
    },
    [user]
  );

  return { agentConfig, loadingConfig, saveAgentConfig };
}
