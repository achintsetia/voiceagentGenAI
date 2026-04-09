import { useState, useEffect } from "react";
import { Bot } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { AgentConfig, AgentGender } from "@/hooks/useAgentConfig";

interface CustomizeAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentConfig: AgentConfig;
  onSave: (config: AgentConfig) => Promise<void>;
}

export function CustomizeAgentDialog({
  open,
  onOpenChange,
  currentConfig,
  onSave,
}: CustomizeAgentDialogProps) {
  const [agentName, setAgentName] = useState(currentConfig.agentName);
  const [agentGender, setAgentGender] = useState<AgentGender>(currentConfig.agentGender);
  const [saving, setSaving] = useState(false);

  // Keep local state in sync whenever currentConfig updates (e.g. loaded from Firestore after dialog opens)
  useEffect(() => {
    setAgentName(currentConfig.agentName);
    setAgentGender(currentConfig.agentGender);
  }, [currentConfig]);

  // Reset local state whenever dialog opens with fresh config
  const handleOpenChange = (value: boolean) => {
    if (value) {
      setAgentName(currentConfig.agentName);
      setAgentGender(currentConfig.agentGender);
    }
    onOpenChange(value);
  };

  const handleSave = async () => {
    const trimmed = agentName.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSave({ agentName: trimmed, agentGender });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[hsl(260,30%,30%)]">
            <Bot size={20} className="text-[hsl(260,50%,55%)]" />
            Customize Your Agent
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Agent name */}
          <div className="space-y-2">
            <Label htmlFor="agent-name" className="text-sm font-medium text-[hsl(260,25%,35%)]">
              Agent Name
            </Label>
            <Input
              id="agent-name"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g. Aria"
              maxLength={40}
              className="border-[hsl(260,30%,80%)] focus-visible:ring-[hsl(260,50%,55%)]"
            />
          </div>

          {/* Agent gender */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-[hsl(260,25%,35%)]">
              Agent Voice &amp; Persona
            </Label>
            <RadioGroup
              value={agentGender}
              onValueChange={(v) => setAgentGender(v as AgentGender)}
              className="space-y-2"
            >
              {(
                [
                  { value: "neutral", label: "Neutral", description: "Calm, balanced persona" },
                  { value: "female", label: "Female", description: "Warm, expressive voice" },
                  { value: "male", label: "Male", description: "Deep, steady voice" },
                ] as { value: AgentGender; label: string; description: string }[]
              ).map(({ value, label, description }) => (
                <div
                  key={value}
                  className="flex items-center gap-3 p-3 rounded-xl border border-[hsl(260,30%,88%)] has-[[data-state=checked]]:border-[hsl(260,50%,55%)] has-[[data-state=checked]]:bg-[hsl(260,50%,55%)]/5 transition-colors cursor-pointer"
                >
                  <RadioGroupItem value={value} id={`gender-${value}`} />
                  <Label
                    htmlFor={`gender-${value}`}
                    className="flex flex-col gap-0.5 cursor-pointer"
                  >
                    <span className="text-sm font-medium text-[hsl(260,25%,30%)]">{label}</span>
                    <span className="text-xs text-[hsl(260,20%,55%)]">{description}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[hsl(260,30%,80%)] text-[hsl(260,25%,40%)]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !agentName.trim()}
            className="bg-[hsl(260,50%,55%)] hover:bg-[hsl(260,50%,48%)] text-white"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
