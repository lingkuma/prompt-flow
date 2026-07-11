import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { syncEdges } from "../../../src/workflow/edgeSync";
import type { Workflow, WorkflowDocument } from "../../../src/workflow/schema";
import { validateWorkflow } from "../../../src/workflow/validator";

function loadWorkflow(filePath: string): Workflow {
  const raw = JSON.parse(readFileSync(resolve(filePath), "utf8")) as Partial<WorkflowDocument> | Workflow;
  const maybeDocument = raw as Partial<WorkflowDocument>;
  const workflow = maybeDocument.workflow ?? (raw as Workflow);
  return syncEdges(workflow);
}

const filePath = process.argv[2] ?? "data/workflow.example.json";
const workflow = loadWorkflow(filePath);
const issues = validateWorkflow(workflow);

if (!issues.length) {
  console.log("OK: workflow validation passed.");
  process.exit(0);
}

for (const issue of issues) {
  console.log(`${issue.severity.toUpperCase()}: ${issue.target} - ${issue.message}`);
}

process.exit(issues.some((issue) => issue.severity === "error") ? 1 : 0);
