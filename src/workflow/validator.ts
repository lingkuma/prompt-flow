import type { Workflow } from "./schema";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  target: string;
  message: string;
}

export function validateWorkflow(workflow: Workflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const codes = new Map<string, string[]>();

  if (!nodesById.has(workflow.startNodeId)) {
    issues.push({
      id: "missing-start",
      severity: "error",
      target: "workflow.startNodeId",
      message: `起始节点 ${workflow.startNodeId} 不存在。`,
    });
  }

  for (const node of workflow.nodes) {
    codes.set(node.code, [...(codes.get(node.code) ?? []), node.id]);

    if (!node.title.trim()) {
      issues.push({ id: `empty-title-${node.id}`, severity: "error", target: node.id, message: "节点名称不能为空。" });
    }

    for (const script of node.scripts) {
      if (script.required && !script.text.trim()) {
        issues.push({ id: `empty-required-script-${script.id}`, severity: "error", target: node.id, message: `必填话术 ${script.id} 为空。` });
      }
    }

    for (const decision of node.decisions) {
      if (!decision.nextNodeId || !nodesById.has(decision.nextNodeId)) {
        issues.push({
          id: `broken-decision-${decision.id}`,
          severity: "error",
          target: node.id,
          message: `判断「${decision.label}」指向不存在的节点 ${decision.nextNodeId || "未设置"}。`,
        });
      }
      if (!decision.customerSignals.length) {
        issues.push({
          id: `empty-signal-${decision.id}`,
          severity: "warning",
          target: node.id,
          message: `判断「${decision.label}」没有客户回答信号。`,
        });
      }
      const isRepeatReject = decision.customerSignals.some((signal) => signal.includes("再次拒绝"));
      const target = nodesById.get(decision.nextNodeId);
      if (isRepeatReject && target?.type !== "ending") {
        issues.push({
          id: `repeat-reject-no-ending-${decision.id}`,
          severity: "warning",
          target: node.id,
          message: `「${decision.label}」包含再次拒绝，但没有进入 ending 节点。`,
        });
      }
    }

    if (node.type === "case_match" && !workflow.caseLibraries.some((library) => library.id === node.caseLibraryId)) {
      issues.push({
        id: `case-node-without-library-${node.id}`,
        severity: "error",
        target: node.id,
        message: `案例匹配节点「${node.title}」未绑定案例库。`,
      });
    }
  }

  for (const [code, ids] of codes) {
    if (ids.length > 1) {
      issues.push({
        id: `duplicate-code-${code}`,
        severity: "error",
        target: ids.join(", "),
        message: `节点编号 ${code} 重复。`,
      });
    }
  }

  for (const edge of workflow.edges) {
    if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) {
      issues.push({
        id: `broken-edge-${edge.id}`,
        severity: "error",
        target: edge.id,
        message: `连线 ${edge.id} 的起点或终点不存在。`,
      });
    }
    const source = nodesById.get(edge.sourceNodeId);
    if (source && !source.decisions.some((decision) => decision.id === edge.sourceDecisionId && decision.nextNodeId === edge.targetNodeId)) {
      issues.push({
        id: `stale-edge-${edge.id}`,
        severity: "warning",
        target: edge.id,
        message: `连线 ${edge.id} 与源节点判断不同步。`,
      });
    }
  }

  const reachable = new Set<string>();
  const queue = [workflow.startNodeId];
  while (queue.length) {
    const current = queue.shift()!;
    if (reachable.has(current) || !nodesById.has(current)) continue;
    reachable.add(current);
    const node = nodesById.get(current)!;
    for (const decision of node.decisions) {
      if (decision.nextNodeId) queue.push(decision.nextNodeId);
    }
  }

  for (const node of workflow.nodes) {
    if (!reachable.has(node.id) && node.type !== "ending") {
      issues.push({
        id: `orphan-${node.id}`,
        severity: "warning",
        target: node.id,
        message: `节点「${node.title}」从起始节点不可达。`,
      });
    }
  }

  return issues;
}
