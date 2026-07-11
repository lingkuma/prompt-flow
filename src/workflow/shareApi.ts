import type { WorkflowDocument } from "./schema";

const SHARE_TOKEN_KEY = "prompt-workflow-editor.shareCreateToken";

export interface ShareLinkResult {
  id: string;
  title: string;
  url: string;
}

export class ShareApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ShareApiError(payload?.error || `Request failed with ${response.status}`, response.status);
  }
  return payload as T;
}

export function readShareToken() {
  return localStorage.getItem(SHARE_TOKEN_KEY) || "";
}

export function writeShareToken(token: string) {
  localStorage.setItem(SHARE_TOKEN_KEY, token);
}

export async function createShareLink(document: WorkflowDocument, token = readShareToken()) {
  const headers: HeadersInit = { "content-type": "application/json" };
  if (token) headers["x-share-token"] = token;

  const response = await fetch("/api/shares", {
    method: "POST",
    headers,
    body: JSON.stringify({ document }),
  });

  return readJsonResponse<ShareLinkResult>(response);
}

export async function fetchSharedDocument(id: string) {
  const response = await fetch(`/api/shares/${encodeURIComponent(id)}`);
  const payload = await readJsonResponse<{ document: WorkflowDocument }>(response);
  return payload.document;
}
