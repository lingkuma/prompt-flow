import type { WorkflowDocument } from "./schema";

const DB_NAME = "prompt-workflow-editor";
const DB_VERSION = 1;
const STORE_NAME = "workflows";
const ACTIVE_WORKFLOW_KEY = "prompt-workflow-editor.activeWorkflowId";

export interface WorkflowRecord {
  id: string;
  title: string;
  updatedAt: string;
  document: WorkflowDocument;
}

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `workflow_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
  });

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
};

export const createWorkflowRecord = (document: WorkflowDocument, id = createId()): WorkflowRecord => ({
  id,
  title: document.workflow.title || "Untitled workflow",
  updatedAt: new Date().toISOString(),
  document,
});

export const getWorkflowRecords = async () => {
  const records = await withStore<WorkflowRecord[]>("readonly", (store) => store.getAll());
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const saveWorkflowRecord = (record: WorkflowRecord) =>
  withStore<IDBValidKey>("readwrite", (store) => store.put(record));

export const deleteWorkflowRecord = (id: string) =>
  withStore<undefined>("readwrite", (store) => store.delete(id));

export const readActiveWorkflowId = () => localStorage.getItem(ACTIVE_WORKFLOW_KEY) ?? "";

export const writeActiveWorkflowId = (id: string) => {
  localStorage.setItem(ACTIVE_WORKFLOW_KEY, id);
};
