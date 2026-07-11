export type IntentLevel = "A" | "B" | "C" | "unknown";
export type NodeType = "start" | "question" | "logic" | "case_match" | "handoff" | "ending";
export type NodeStatus = "draft" | "ready" | "deprecated";

export interface Point {
  x: number;
  y: number;
}

export interface NodeLayout extends Point {
  width: number;
  height: number;
}

export interface ScriptLine {
  id: string;
  text: string;
  tone: string;
  usage: string;
  required: boolean;
}

export interface CaptureField {
  key: string;
  label: string;
  required: boolean;
  examples: string[];
  avoidAskDirectly: boolean;
  note: string;
}

export interface DecisionRule {
  id: string;
  label: string;
  customerSignals: string[];
  intentLevel: IntentLevel;
  nextNodeId: string;
  priority: number;
  stopAfterMatch: boolean;
  notes: string;
}

export interface WorkflowNode {
  id: string;
  code: string;
  title: string;
  type: NodeType;
  intentLevel: IntentLevel[];
  scripts: ScriptLine[];
  logicNotes: string[];
  captureFields: CaptureField[];
  decisions: DecisionRule[];
  promptNotes: string[];
  layout: NodeLayout;
  tags: string[];
  status: NodeStatus;
  output?: {
    includeInPrompt: boolean;
    order?: number;
    showDecisionTable: boolean;
    showLogicNotes: boolean;
  };
  caseLibraryId?: string;
}

export interface EdgeStyle {
  color: string;
  dashed: boolean;
}

export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  sourceDecisionId: string;
  targetNodeId: string;
  label: string;
  intentLevel: IntentLevel;
  routePoints: Point[];
  autoRoute: boolean;
  style: EdgeStyle;
}

export interface CaseMatchRule {
  id: string;
  label: string;
  description: string;
  priority: number;
}

export interface BusinessCase {
  id: string;
  industry: string;
  keywords: string[];
  company: string;
  shop: string;
  region: string;
  monthlyRevenue: string;
  priority: number;
  notes: string;
}

export interface CaseLibrary {
  id: string;
  title: string;
  matchRules: CaseMatchRule[];
  cases: BusinessCase[];
}

export interface GlobalRule {
  id: string;
  title: string;
  trigger: string;
  content: string[];
  appliesTo: string[];
  outputPosition: "prompt_start" | "before_nodes" | "after_nodes" | "prompt_end";
}

export interface PromptCompilerConfig {
  format: "markdown";
  nodeOrder: "code" | "layout";
  includeLogicNotes: boolean;
  includeCaseLibrary: boolean;
  includeGlobalRules: boolean;
}

export interface Workflow {
  id: string;
  title: string;
  description: string;
  version: string;
  startNodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  caseLibraries: CaseLibrary[];
  globalRules: GlobalRule[];
  promptCompiler: PromptCompilerConfig;
}

export interface WorkflowDocument {
  schemaVersion: string;
  workflow: Workflow;
}
