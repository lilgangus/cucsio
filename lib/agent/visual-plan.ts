export type VisualAgentTriggerPayload = {
  reason: string;
  targetPrompt?: string;
  context?: string;
  source?: "chat" | "search" | "tree" | "prompt";
};

export type VisualAgentPlanStep = {
  label: string;
  detail: string;
};

export type VisualAgentFinding = {
  label: string;
  reason: string;
};

export type VisualAgentPlan = {
  planSummary: string;
  steps: VisualAgentPlanStep[];
  findings: VisualAgentFinding[];
};

export type VisualAgentPlanResponse = {
  plan: VisualAgentPlan;
};
