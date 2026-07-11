import type { IntentLevel, Workflow, WorkflowEdge } from "./schema";

const intentColors: Record<IntentLevel, string> = {
  A: "#168a4a",
  B: "#2563eb",
  C: "#b42318",
  unknown: "#667085",
};

export function edgeIdFor(sourceNodeId: string, decisionId: string) {
  return `edge_${sourceNodeId}_${decisionId}`;
}

export function syncEdges(workflow: Workflow): Workflow {
  const existing = new Map(workflow.edges.map((edge) => [edge.id, edge]));
  const edges: WorkflowEdge[] = [];

  for (const node of workflow.nodes) {
    for (const decision of node.decisions) {
      if (!decision.nextNodeId) continue;
      const id = edgeIdFor(node.id, decision.id);
      const prior = existing.get(id);
      edges.push({
        id,
        sourceNodeId: node.id,
        sourceDecisionId: decision.id,
        targetNodeId: decision.nextNodeId,
        label: decision.label || decision.customerSignals[0] || "下一步",
        intentLevel: decision.intentLevel,
        routePoints: prior?.routePoints ?? [],
        autoRoute: prior?.autoRoute ?? true,
        style: {
          color: intentColors[decision.intentLevel],
          dashed: decision.intentLevel === "unknown",
        },
      });
    }
  }

  return { ...workflow, edges };
}
