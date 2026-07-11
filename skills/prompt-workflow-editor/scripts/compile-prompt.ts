import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compilePrompt } from "../../../src/workflow/compiler";
import { syncEdges } from "../../../src/workflow/edgeSync";
import type { Workflow, WorkflowDocument } from "../../../src/workflow/schema";

function loadWorkflow(filePath: string): Workflow {
  const raw = JSON.parse(readFileSync(resolve(filePath), "utf8")) as Partial<WorkflowDocument> | Workflow;
  const maybeDocument = raw as Partial<WorkflowDocument>;
  const workflow = maybeDocument.workflow ?? (raw as Workflow);
  return syncEdges(workflow);
}

const filePath = process.argv[2] ?? "data/workflow.example.json";
process.stdout.write(compilePrompt(loadWorkflow(filePath)));
