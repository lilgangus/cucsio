export type VisualAgentTriggerPayload = {
  reason: string;
  targetPrompt?: string;
  context?: string;
  source?: "chat" | "search" | "tree" | "prompt";
};

export type VisualAgentTreeNode = {
  key: string;
  parentKey: string | null;
  summary: string;
  detail: string;
};

export type VisualAgentFinding = {
  summary: string;
};

export type VisualAgentPlan = {
  planSummary: string;
  tree: VisualAgentTreeNode[];
  findings: VisualAgentFinding[];
};

export type VisualAgentPlanResponse = {
  plan: VisualAgentPlan;
};

export type AgentChatFindingsPayload = {
  userMessage: string;
  assistantAnswer: string;
  context?: string;
};

export type AgentChatFindingsResponse = {
  findings: VisualAgentFinding[];
};
