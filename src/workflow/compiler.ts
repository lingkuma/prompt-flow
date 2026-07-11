import type { CaseLibrary, Workflow, WorkflowNode } from "./schema";

const codeNumber = (code: string) =>
  code.split(".").reduce((total, part, index) => total + Number(part || 0) / Math.pow(100, index), 0);

function sortedNodes(workflow: Workflow) {
  const nodes = workflow.nodes.filter((node) => node.output?.includeInPrompt ?? true);
  if (workflow.promptCompiler.nodeOrder === "layout") {
    return [...nodes].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  }
  return [...nodes].sort((a, b) => codeNumber(a.code) - codeNumber(b.code));
}

function nodeName(workflow: Workflow, nodeId: string) {
  const node = workflow.nodes.find((item) => item.id === nodeId);
  return node ? `节点${node.code}` : nodeId || "未设置";
}

function compileNode(workflow: Workflow, node: WorkflowNode) {
  const lines: string[] = [`## 节点${node.code}：${node.title}`, ""];
  const [mainScript, ...otherScripts] = node.scripts;
  if (mainScript?.text) {
    lines.push(`> ${mainScript.text}`, "");
  }

  if (otherScripts.length) {
    lines.push("**其他话术示例：**");
    for (const script of otherScripts) {
      lines.push(`- ${script.text}${script.usage ? `（${script.usage}）` : ""}`);
    }
    lines.push("");
  }

  if (workflow.promptCompiler.includeLogicNotes && (node.output?.showLogicNotes ?? true) && node.logicNotes.length) {
    lines.push("**话术逻辑：**");
    for (const note of node.logicNotes) lines.push(`- ${note}`);
    lines.push("");
  }

  if (node.captureFields.length) {
    lines.push("**采集字段：**");
    for (const field of node.captureFields) {
      const required = field.required ? "关键字段" : "辅助字段";
      const direct = field.avoidAskDirectly ? "避免连续直接追问" : "可自然询问";
      lines.push(`- ${field.label}（${field.key}，${required}，${direct}）：${field.note}`);
    }
    lines.push("");
  }

  if (node.type === "case_match") {
    const library = workflow.caseLibraries.find((item) => item.id === node.caseLibraryId);
    lines.push(...compileCaseMatchBlock(library));
  }

  if ((node.output?.showDecisionTable ?? true) && node.decisions.length) {
    lines.push("| 客户回答 | 意向 | 下一步 |");
    lines.push("|---|---|---|");
    for (const decision of [...node.decisions].sort((a, b) => a.priority - b.priority)) {
      lines.push(`| ${decision.customerSignals.join(" / ")} | ${decision.intentLevel}级 | → ${nodeName(workflow, decision.nextNodeId)} |`);
    }
    lines.push("");
  }

  if (node.promptNotes.length) {
    lines.push("**说明：**");
    for (const note of node.promptNotes) lines.push(`- ${note}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function compileCaseMatchBlock(library?: CaseLibrary) {
  if (!library) return ["**案例库：** 未绑定案例库。", ""];
  const lines = [
    "**案例匹配规则：**",
    ...library.matchRules
      .sort((a, b) => a.priority - b.priority)
      .map((rule) => `- ${rule.label}：${rule.description}`),
    "",
    "**真实案例库：**",
    "",
    "| 行业/关键词 | 公司/店铺 | 地区 | 月营收 |",
    "|---|---|---|---|",
  ];
  for (const item of library.cases) {
    lines.push(`| ${item.industry} | ${item.company} / ${item.shop} | ${item.region} | ${item.monthlyRevenue} |`);
  }
  lines.push("");
  return lines;
}

export function compilePrompt(workflow: Workflow) {
  const lines: string[] = [];

  if (workflow.promptCompiler.includeGlobalRules) {
    const before = workflow.globalRules.filter((rule) => rule.outputPosition === "prompt_start" || rule.outputPosition === "before_nodes");
    for (const rule of before) {
      lines.push(`## ${rule.title}`, "", ...rule.content.map((item) => `- ${item}`), "");
    }
  }

  for (const node of sortedNodes(workflow)) {
    lines.push(compileNode(workflow, node), "", "---", "");
  }

  if (workflow.promptCompiler.includeGlobalRules) {
    const after = workflow.globalRules.filter((rule) => rule.outputPosition === "after_nodes" || rule.outputPosition === "prompt_end");
    for (const rule of after) {
      lines.push(`## ${rule.title}`, "", `触发条件：${rule.trigger}`, "", ...rule.content.map((item) => `- ${item}`), "");
    }
  }

  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}
