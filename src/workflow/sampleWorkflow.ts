import sampleDocument from "../../data/workflow.example.json";
import { syncEdges } from "./edgeSync";
import type { WorkflowDocument } from "./schema";

const sourceDocument = sampleDocument as unknown as WorkflowDocument;

export const sampleWorkflow = syncEdges(structuredClone(sourceDocument.workflow));

export const sampleWorkflowDocument: WorkflowDocument = {
  schemaVersion: sourceDocument.schemaVersion,
  workflow: sampleWorkflow,
};
