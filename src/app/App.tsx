import {
  AlertTriangle,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Braces,
  CheckCircle2,
  CirclePlus,
  Download,
  FileText,
  GitBranch,
  ImageDown,
  LayoutGrid,
  MessagesSquare,
  Minus,
  Plus,
  RefreshCcw,
  Save,
  Share2,
  Settings2,
  Trash2,
  Upload,
  Waypoints,
  ZoomIn,
  ZoomOut,
  Copy,
} from "lucide-react";
import type { TextareaHTMLAttributes } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { compilePrompt } from "../workflow/compiler";
import { syncEdges } from "../workflow/edgeSync";
import { sampleWorkflowDocument } from "../workflow/sampleWorkflow";
import { createShareLink, fetchSharedDocument, ShareApiError, writeShareToken } from "../workflow/shareApi";
import {
  createWorkflowRecord,
  deleteWorkflowRecord,
  getWorkflowRecords,
  readActiveWorkflowId,
  saveWorkflowRecord,
  writeActiveWorkflowId,
  type WorkflowRecord,
} from "../workflow/storage";
import type {
  BusinessCase,
  CaseLibrary,
  DecisionRule,
  GlobalRule,
  Point,
  ScriptLine,
  Workflow,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from "../workflow/schema";
import { validateWorkflow } from "../workflow/validator";
import { ModelSettingsDialog } from "../testing/ModelSettingsDialog";
import { PromptTestBench } from "../testing/PromptTestBench";
import { loadModelProfiles, saveModelProfiles, type ModelProfile } from "../testing/modelProfiles";

type ViewMode = "canvas" | "prompt" | "json" | "validation";
type StorageStatus = "loading" | "saving" | "saved" | "error";
type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "caseLibrary"; id: string }
  | { kind: "globalRule"; id: string };

type EdgeRouteMeta = {
  sourceIndex: number;
  sourceCount: number;
  targetIndex: number;
  targetCount: number;
  pairIndex: number;
  pairCount: number;
};

const edgeSortKey = (edge: WorkflowEdge) => `${edge.sourceNodeId}:${edge.targetNodeId}:${edge.id}`;

const spreadPortOffset = (height: number, index: number, count: number) => {
  if (count <= 1) return height / 2;
  const inset = Math.min(32, Math.max(18, height * 0.22));
  const span = Math.max(1, height - inset * 2);
  return inset + (span * index) / (count - 1);
};

const nodeTypeLabels: Record<WorkflowNode["type"], string> = {
  start: "开场",
  question: "询问",
  logic: "逻辑",
  case_match: "案例",
  handoff: "承接",
  ending: "收尾",
};

const statusLabels: Record<WorkflowNode["status"], string> = {
  draft: "草稿",
  ready: "可用",
  deprecated: "弃用",
};

const intentLabels = ["A", "B", "C", "unknown"] as const;

const cloneWorkflow = (workflow: Workflow) => structuredClone(workflow) as Workflow;
const cloneDocument = (document: WorkflowDocument) => structuredClone(document) as WorkflowDocument;
const linesToText = (items: string[]) => items.join("\n");
const textToLines = (value: string) => value === "" ? [] : value.replace(/\r\n?/g, "\n").split("\n");
const sortRecords = (records: WorkflowRecord[]) => [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const createWorkflowId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `workflow_${crypto.randomUUID()}`;
  return `workflow_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const createWorkflowTitle = (prefix: string) => {
  const stamp = new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${prefix} ${stamp}`;
};

const getShareIdFromPath = () => {
  const match = window.location.pathname.match(/^\/s\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
};

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = window.document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  window.document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  window.document.execCommand("copy");
  textarea.remove();
}

type MultilineInputProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  value: string;
  onValueChange: (value: string) => void;
};

function MultilineInput({ value, onValueChange, rows = 2, ...props }: MultilineInputProps) {
  return <textarea rows={rows} value={value} onChange={(event) => onValueChange(event.target.value)} {...props} />;
}

function normalizeDocument(input: unknown): WorkflowDocument {
  const maybeDoc = input as Partial<WorkflowDocument>;
  const maybeWorkflow = input as Partial<Workflow>;
  if (maybeDoc.workflow?.nodes) {
    return { schemaVersion: maybeDoc.schemaVersion ?? "0.1.0", workflow: syncEdges(maybeDoc.workflow as Workflow) };
  }
  if (maybeWorkflow.nodes) {
    return { schemaVersion: "0.1.0", workflow: syncEdges(maybeWorkflow as Workflow) };
  }
  throw new Error("JSON 中没有 workflow.nodes。");
}

function sortByCode(nodes: WorkflowNode[]) {
  const score = (code: string) => code.split(".").reduce((sum, part, index) => sum + Number(part || 0) / Math.pow(100, index), 0);
  return [...nodes].sort((a, b) => score(a.code) - score(b.code));
}

function buildEdgeRouteMeta(workflow: Workflow, nodesById: Map<string, WorkflowNode>) {
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  const pairs = new Map<string, WorkflowEdge[]>();
  const meta = new Map<string, EdgeRouteMeta>();

  for (const edge of workflow.edges) {
    const sourceGroup = outgoing.get(edge.sourceNodeId) ?? [];
    sourceGroup.push(edge);
    outgoing.set(edge.sourceNodeId, sourceGroup);

    const targetGroup = incoming.get(edge.targetNodeId) ?? [];
    targetGroup.push(edge);
    incoming.set(edge.targetNodeId, targetGroup);

    const pairKey = `${edge.sourceNodeId}->${edge.targetNodeId}`;
    const pairGroup = pairs.get(pairKey) ?? [];
    pairGroup.push(edge);
    pairs.set(pairKey, pairGroup);
  }

  const ensureMeta = (edgeId: string) => {
    const existing = meta.get(edgeId);
    if (existing) return existing;
    const created = { sourceIndex: 0, sourceCount: 1, targetIndex: 0, targetCount: 1, pairIndex: 0, pairCount: 1 };
    meta.set(edgeId, created);
    return created;
  };

  for (const edges of outgoing.values()) {
    const sorted = [...edges].sort((a, b) => {
      const aTarget = nodesById.get(a.targetNodeId);
      const bTarget = nodesById.get(b.targetNodeId);
      const aY = aTarget ? aTarget.layout.y + aTarget.layout.height / 2 : 0;
      const bY = bTarget ? bTarget.layout.y + bTarget.layout.height / 2 : 0;
      return aY - bY || edgeSortKey(a).localeCompare(edgeSortKey(b));
    });
    sorted.forEach((edge, index) => {
      const item = ensureMeta(edge.id);
      item.sourceIndex = index;
      item.sourceCount = sorted.length;
    });
  }

  for (const edges of incoming.values()) {
    const sorted = [...edges].sort((a, b) => {
      const aSource = nodesById.get(a.sourceNodeId);
      const bSource = nodesById.get(b.sourceNodeId);
      const aY = aSource ? aSource.layout.y + aSource.layout.height / 2 : 0;
      const bY = bSource ? bSource.layout.y + bSource.layout.height / 2 : 0;
      return aY - bY || edgeSortKey(a).localeCompare(edgeSortKey(b));
    });
    sorted.forEach((edge, index) => {
      const item = ensureMeta(edge.id);
      item.targetIndex = index;
      item.targetCount = sorted.length;
    });
  }

  for (const edges of pairs.values()) {
    const sorted = [...edges].sort((a, b) => edgeSortKey(a).localeCompare(edgeSortKey(b)));
    sorted.forEach((edge, index) => {
      const item = ensureMeta(edge.id);
      item.pairIndex = index;
      item.pairCount = sorted.length;
    });
  }

  return meta;
}

function getEdgeRoute(edge: WorkflowEdge, nodesById: Map<string, WorkflowNode>, edgeRouteMeta: Map<string, EdgeRouteMeta>) {
  const source = nodesById.get(edge.sourceNodeId);
  const target = nodesById.get(edge.targetNodeId);
  if (!source || !target) return null;

  const routeMeta = edgeRouteMeta.get(edge.id);
  const sourceOffset = spreadPortOffset(source.layout.height, routeMeta?.sourceIndex ?? 0, routeMeta?.sourceCount ?? 1);
  const targetOffset = spreadPortOffset(target.layout.height, routeMeta?.targetIndex ?? 0, routeMeta?.targetCount ?? 1);
  const sourcePoint = { x: source.layout.x + source.layout.width, y: source.layout.y + sourceOffset };
  const targetPoint = { x: target.layout.x, y: target.layout.y + targetOffset };
  const sourceLane = ((routeMeta?.sourceIndex ?? 0) - ((routeMeta?.sourceCount ?? 1) - 1) / 2) * 28;
  const targetLane = ((routeMeta?.targetIndex ?? 0) - ((routeMeta?.targetCount ?? 1) - 1) / 2) * 18;
  const pairLane = ((routeMeta?.pairIndex ?? 0) - ((routeMeta?.pairCount ?? 1) - 1) / 2) * 18;
  const laneOffset = sourceLane + targetLane + pairLane;
  const gap = targetPoint.x - sourcePoint.x;
  const isForward = gap >= 0;
  const baseMidX = isForward
    ? gap < 180 ? targetPoint.x + 80 : sourcePoint.x + Math.max(110, gap / 2)
    : Math.max(sourcePoint.x, targetPoint.x) + 140;
  const minMidX = isForward ? sourcePoint.x + 60 : Math.max(sourcePoint.x, targetPoint.x) + 80;
  const midX = Math.max(minMidX, baseMidX + laneOffset);
  const routePoints = edge.autoRoute || edge.routePoints.length === 0
    ? [sourcePoint, { x: midX, y: sourcePoint.y }, { x: midX, y: targetPoint.y }, targetPoint]
    : [sourcePoint, ...edge.routePoints, targetPoint];
  const labelPoint = edge.autoRoute || edge.routePoints.length === 0
    ? { x: midX, y: (sourcePoint.y + targetPoint.y) / 2 }
    : routePoints[Math.floor(routePoints.length / 2)];

  return { routePoints, labelPoint };
}

const nodeAccentColors: Record<WorkflowNode["type"], string> = {
  start: "#168a4a",
  question: "#2563eb",
  logic: "#b66a00",
  case_match: "#7a4cc2",
  handoff: "#0f766e",
  ending: "#b42318",
};

const svgEscape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const filenameSafe = (value: string) => value.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "workflow";

function estimatedCharWidth(char: string, fontSize: number, fontWeight = 400) {
  const weightFactor = fontWeight >= 700 ? 1.06 : 1;
  if (/[\u3000-\u9fff\uff00-\uffef]/.test(char)) return fontSize * weightFactor;
  if (/\s/.test(char)) return fontSize * 0.34;
  if (/[A-Z0-9]/.test(char)) return fontSize * 0.62 * weightFactor;
  if (/[il.,:;|!]/.test(char)) return fontSize * 0.32 * weightFactor;
  if (/[mwMW]/.test(char)) return fontSize * 0.88 * weightFactor;
  return fontSize * 0.56 * weightFactor;
}

function estimatedTextWidth(value: string, fontSize: number, fontWeight = 400) {
  return [...value].reduce((width, char) => width + estimatedCharWidth(char, fontSize, fontWeight), 0);
}

function withEllipsis(value: string, maxWidth: number, fontSize: number, fontWeight = 400) {
  const suffix = "...";
  let next = value.replace(/\s+$/g, "");
  while (next.length > 0 && estimatedTextWidth(`${next}${suffix}`, fontSize, fontWeight) > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next}${suffix}`;
}

function wrapSvgText(value: string, maxWidth: number, fontSize: number, fontWeight = 400, maxLines = Number.POSITIVE_INFINITY) {
  const lines: string[] = [];
  let truncated = false;

  const pushLine = (line: string) => {
    if (lines.length >= maxLines) {
      truncated = true;
      return false;
    }
    lines.push(line || " ");
    return true;
  };

  for (const rawLine of value.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine || " ";
    let current = "";
    for (const char of line) {
      const candidate = `${current}${char}`;
      if (current && estimatedTextWidth(candidate, fontSize, fontWeight) > maxWidth) {
        if (!pushLine(current.replace(/\s+$/g, ""))) break;
        current = char.trimStart();
      } else {
        current = candidate;
      }
    }
    if (truncated) break;
    if (!pushLine(current)) break;
  }

  if (truncated && lines.length > 0) {
    lines[lines.length - 1] = withEllipsis(lines[lines.length - 1], maxWidth, fontSize, fontWeight);
  }
  return lines.length ? lines : [" "];
}

function createExportWorkflow(workflow: Workflow) {
  const nodes = workflow.nodes.map((node) => {
    const textWidth = Math.max(80, node.layout.width - 20);
    const titleLines = wrapSvgText(node.title, textWidth, 15, 700, 3);
    const scriptLines = wrapSvgText(node.scripts[0]?.text ?? "", textWidth, 12, 400, 10);
    const codeLines = wrapSvgText(`节点${node.code}`, Math.max(80, node.layout.width - 92), 12, 700, 2);
    const footerLines = wrapSvgText(`${node.decisions.length} 个判断    ${node.intentLevel.join("/") || "未定级"}`, textWidth, 12, 400, 2);
    const contentHeight =
      18 +
      codeLines.length * 14 +
      14 +
      titleLines.length * 19 +
      12 +
      scriptLines.length * 17 +
      18 +
      footerLines.length * 14;
    const height = Math.max(node.layout.height, Math.ceil(contentHeight));

    return {
      ...node,
      layout: { ...node.layout, height },
      exportLines: { codeLines, titleLines, scriptLines, footerLines },
    };
  });

  return { ...workflow, nodes };
}

function renderSvgText({
  lines,
  x,
  y,
  lineHeight,
  color,
  fontSize,
  fontWeight = 400,
}: {
  lines: string[];
  x: number;
  y: number;
  lineHeight: number;
  color: string;
  fontSize: number;
  fontWeight?: number;
}) {
  const tspans = lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${svgEscape(line)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" fill="${color}" font-size="${fontSize}" font-weight="${fontWeight}">${tspans}</text>`;
}

function createWorkflowSvg(workflow: Workflow) {
  if (workflow.nodes.length === 0) throw new Error("当前图没有节点，无法导出图片。");

  const exportWorkflow = createExportWorkflow(workflow);
  const nodesById = new Map<string, WorkflowNode>(exportWorkflow.nodes.map((node) => [node.id, node]));
  const edgeRouteMeta = buildEdgeRouteMeta(exportWorkflow, nodesById);
  const routedEdges = exportWorkflow.edges
    .map((edge) => ({ edge, route: getEdgeRoute(edge, nodesById, edgeRouteMeta) }))
    .filter((item): item is { edge: WorkflowEdge; route: { routePoints: Point[]; labelPoint: Point } } => item.route !== null);

  const boundsPoints: Point[] = [];
  for (const node of exportWorkflow.nodes) {
    boundsPoints.push(
      { x: node.layout.x, y: node.layout.y },
      { x: node.layout.x + node.layout.width, y: node.layout.y + node.layout.height },
    );
  }
  for (const { route } of routedEdges) {
    boundsPoints.push(...route.routePoints, route.labelPoint);
    boundsPoints.push(
      { x: route.labelPoint.x - 12, y: route.labelPoint.y - 28 },
      { x: route.labelPoint.x + 180, y: route.labelPoint.y + 36 },
    );
  }

  const padding = 80;
  const minX = Math.min(...boundsPoints.map((point) => point.x));
  const minY = Math.min(...boundsPoints.map((point) => point.y));
  const maxX = Math.max(...boundsPoints.map((point) => point.x));
  const maxY = Math.max(...boundsPoints.map((point) => point.y));
  const offsetX = padding - minX;
  const offsetY = padding - minY;
  const width = Math.ceil(maxX - minX + padding * 2);
  const height = Math.ceil(maxY - minY + padding * 2);
  const pointAttr = (point: Point) => `${Math.round(point.x + offsetX)},${Math.round(point.y + offsetY)}`;

  const edgesSvg = routedEdges.map(({ edge, route }) => {
    const points = route.routePoints.map(pointAttr).join(" ");
    const label = wrapSvgText(edge.label, 150, 12, 700, 2);
    return `
      <polyline points="${points}" fill="none" stroke="${edge.style.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" ${edge.style.dashed ? 'stroke-dasharray="7 5"' : ""} marker-end="url(#arrow)" />
      <text x="${route.labelPoint.x + offsetX + 8}" y="${route.labelPoint.y + offsetY - 8}" fill="#202124" stroke="#fbfbf8" stroke-width="4" paint-order="stroke" font-size="12" font-weight="700">${label.map((line, index) => `<tspan x="${route.labelPoint.x + offsetX + 8}" dy="${index === 0 ? 0 : 16}">${svgEscape(line)}</tspan>`).join("")}</text>
    `;
  }).join("");

  const nodesSvg = exportWorkflow.nodes.map((node) => {
    const x = node.layout.x + offsetX;
    const y = node.layout.y + offsetY;
    const width = node.layout.width;
    const height = node.layout.height;
    const { codeLines, titleLines, scriptLines, footerLines } = node.exportLines;
    const titleY = y + 55;
    const scriptY = titleY + titleLines.length * 19 + 20;
    const footerY = y + height - (footerLines.length - 1) * 14 - 13;

    return `
      <g>
        <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="#ffffff" stroke="#cfd3ca" />
        <rect x="${x}" y="${y}" width="${width}" height="4" rx="2" fill="${nodeAccentColors[node.type]}" />
        ${renderSvgText({ lines: codeLines, x: x + 10, y: y + 23, lineHeight: 14, color: "#667085", fontSize: 12, fontWeight: 700 })}
        <rect x="${x + width - 64}" y="${y + 10}" width="54" height="20" rx="10" fill="#f0f2ec" />
        <text x="${x + width - 37}" y="${y + 24}" fill="#4e564a" font-size="12" text-anchor="middle">${svgEscape(nodeTypeLabels[node.type])}</text>
        ${renderSvgText({ lines: titleLines, x: x + 10, y: titleY, lineHeight: 19, color: "#202124", fontSize: 15, fontWeight: 700 })}
        ${renderSvgText({ lines: scriptLines, x: x + 10, y: scriptY, lineHeight: 17, color: "#475046", fontSize: 12 })}
        ${renderSvgText({ lines: footerLines, x: x + 10, y: footerY, lineHeight: 14, color: "#667085", fontSize: 12 })}
      </g>
    `;
  }).join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e5e8df" stroke-width="1" />
    </pattern>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#667085" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#f7f7f3" />
  <rect width="100%" height="100%" fill="url(#grid)" />
  <g font-family="Inter, Segoe UI, Microsoft YaHei, system-ui, sans-serif">
    ${edgesSvg}
    ${nodesSvg}
  </g>
</svg>`;

  return { svg, width, height };
}

async function exportWorkflowImage(workflow: Workflow) {
  const { svg, width, height } = createWorkflowSvg(workflow);
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("图片生成失败。"));
    });
    image.src = url;
    await loaded;

    const maxCanvasSide = 12000;
    const scale = Math.max(1, Math.min(2, maxCanvasSide / Math.max(width, height)));
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 Canvas 导出。");
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 编码失败。")), "image/png");
    });
    const pngUrl = URL.createObjectURL(pngBlob);
    const anchor = window.document.createElement("a");
    anchor.href = pngUrl;
    anchor.download = `${filenameSafe(workflow.title)}.png`;
    anchor.click();
    URL.revokeObjectURL(pngUrl);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function AppToolbar({
  view,
  setView,
  workflowRecords,
  activeWorkflowId,
  storageStatus,
  onSelectWorkflow,
  onCreateWorkflow,
  onDuplicateWorkflow,
  onDeleteWorkflow,
  onAddNode,
  onImport,
  onExport,
  onShare,
  onExportImage,
  onOpenTestBench,
  onOpenModelSettings,
  onLayout,
  onZoom,
  issuesCount,
}: {
  view: ViewMode;
  setView: (view: ViewMode) => void;
  workflowRecords: WorkflowRecord[];
  activeWorkflowId: string;
  storageStatus: StorageStatus;
  onSelectWorkflow: (id: string) => void;
  onCreateWorkflow: () => void;
  onDuplicateWorkflow: () => void;
  onDeleteWorkflow: () => void;
  onAddNode: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onShare: () => void;
  onExportImage: () => void;
  onOpenTestBench: () => void;
  onOpenModelSettings: () => void;
  onLayout: (mode: "code" | "intent" | "start") => void;
  onZoom: (delta: number) => void;
  issuesCount: number;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const storageLabel = storageStatus === "loading" ? "加载中" : storageStatus === "saving" ? "保存中" : storageStatus === "error" ? "保存失败" : "已保存";
  return (
    <header className="toolbar">
      <div className="brand">
        <GitBranch size={20} />
        <div>
          <strong>Prompt Workflow</strong>
          <span>规则图编辑器</span>
        </div>
      </div>
      <div className="toolbarGroup workflowGroup">
        <select
          className="workflowSelect"
          value={activeWorkflowId}
          disabled={storageStatus === "loading" || workflowRecords.length === 0}
          onChange={(event) => onSelectWorkflow(event.target.value)}
          title="切换图"
        >
          {workflowRecords.map((record) => (
            <option key={record.id} value={record.id}>{record.title}</option>
          ))}
        </select>
        <button title="新建图" onClick={onCreateWorkflow} disabled={storageStatus === "loading"}>
          <CirclePlus size={16} /> 新建图
        </button>
        <button title="复制当前图" onClick={onDuplicateWorkflow} disabled={storageStatus === "loading" || !activeWorkflowId}>
          <Copy size={16} />
        </button>
        <button className="danger" title="删除当前图" onClick={onDeleteWorkflow} disabled={storageStatus === "loading" || workflowRecords.length <= 1}>
          <Trash2 size={16} />
        </button>
        <span className={`storageStatus ${storageStatus}`}>{storageLabel}</span>
      </div>
      <div className="toolbarGroup">
        <button title="新建节点" onClick={onAddNode}>
          <CirclePlus size={16} /> 新建节点
        </button>
        <button title="导入 JSON" onClick={() => fileRef.current?.click()}>
          <Upload size={16} /> 导入
        </button>
        <button title="导出 JSON" onClick={onExport}>
          <Download size={16} /> 导出
        </button>
        <button title="复制分享链接" onClick={onShare}>
          <Share2 size={16} /> 分享
        </button>
        <button title="导出全图 PNG" onClick={onExportImage}>
          <ImageDown size={16} /> 导出图片
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.currentTarget.value = "";
          }}
        />
      </div>
      <div className="toolbarGroup">
        <button title="从起点向右布局" onClick={() => onLayout("start")}>
          <ArrowDownToLine size={16} /> 起点布局
        </button>
        <button title="按节点编号布局" onClick={() => onLayout("code")}>
          <LayoutGrid size={16} /> 编号布局
        </button>
        <button title="按意向等级分层布局" onClick={() => onLayout("intent")}>
          <Waypoints size={16} /> 意向布局
        </button>
      </div>
      <div className="toolbarGroup">
        <button title="缩小" onClick={() => onZoom(-0.1)}>
          <ZoomOut size={16} />
        </button>
        <button title="放大" onClick={() => onZoom(0.1)}>
          <ZoomIn size={16} />
        </button>
      </div>
      <div className="toolbarGroup testTools">
        <button className="testPromptButton" title="用当前 Prompt 进行多模型对话测试" onClick={onOpenTestBench}>
          <MessagesSquare size={16} /> 对话测试
        </button>
        <button title="管理 OpenAI 兼容模型配置" onClick={onOpenModelSettings}>
          <Settings2 size={16} /> 模型设置
        </button>
      </div>
      <nav className="viewTabs">
        {[
          ["canvas", "画布", GitBranch],
          ["prompt", "Prompt", FileText],
          ["json", "数据", Braces],
          ["validation", `校验 ${issuesCount}`, issuesCount ? AlertTriangle : CheckCircle2],
        ].map(([key, label, Icon]) => (
          <button key={key as string} className={view === key ? "active" : ""} onClick={() => setView(key as ViewMode)}>
            <Icon size={16} /> {label as string}
          </button>
        ))}
      </nav>
    </header>
  );
}

function Sidebar({
  workflow,
  selection,
  setSelection,
  updateWorkflow,
}: {
  workflow: Workflow;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  updateWorkflow: (updater: (workflow: Workflow) => void) => void;
}) {
  const fields = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of workflow.nodes) {
      for (const field of node.captureFields) map.set(field.key, field.label);
    }
    return [...map.entries()];
  }, [workflow.nodes]);
  const addField = () => {
    const preferredNodeId = selection.kind === "node" ? selection.id : workflow.startNodeId || workflow.nodes[0]?.id;
    const targetNodeId = workflow.nodes.find((node) => node.id === preferredNodeId)?.id ?? workflow.nodes[0]?.id;
    if (!targetNodeId) return;
    updateWorkflow((draft) => {
      const target = draft.nodes.find((node) => node.id === targetNodeId);
      if (!target) return;
      target.captureFields.push({ key: `field_${Date.now()}`, label: "新字段", required: false, examples: [], avoidAskDirectly: false, note: "" });
    });
    setSelection({ kind: "node", id: targetNodeId });
  };
  const deleteField = (key: string) => {
    updateWorkflow((draft) => {
      for (const node of draft.nodes) {
        node.captureFields = node.captureFields.filter((field) => field.key !== key);
      }
    });
  };
  const addGlobalRule = () => {
    const id = `rule_${Date.now()}`;
    updateWorkflow((draft) => {
      draft.globalRules.push({
        id,
        title: "新全局规则",
        trigger: "",
        content: [""],
        appliesTo: [],
        outputPosition: "prompt_start",
      });
    });
    setSelection({ kind: "globalRule", id });
  };
  const moveGlobalRule = (id: string, offset: -1 | 1) => {
    updateWorkflow((draft) => {
      const index = draft.globalRules.findIndex((rule) => rule.id === id);
      const targetIndex = index + offset;
      if (index < 0 || targetIndex < 0 || targetIndex >= draft.globalRules.length) return;
      [draft.globalRules[index], draft.globalRules[targetIndex]] = [draft.globalRules[targetIndex], draft.globalRules[index]];
    });
  };
  const deleteGlobalRule = (id: string) => {
    const index = workflow.globalRules.findIndex((rule) => rule.id === id);
    const fallbackRule = workflow.globalRules[index + 1] ?? workflow.globalRules[index - 1];
    updateWorkflow((draft) => {
      draft.globalRules = draft.globalRules.filter((rule) => rule.id !== id);
    });
    if (selection.kind === "globalRule" && selection.id === id) {
      setSelection(fallbackRule
        ? { kind: "globalRule", id: fallbackRule.id }
        : { kind: "node", id: workflow.nodes[0]?.id ?? "" });
    }
  };

  return (
    <aside className="sidebar">
      <section>
        <h2>节点列表</h2>
        <div className="resourceList">
          {sortByCode(workflow.nodes).map((node) => (
            <button
              key={node.id}
              className={selection.kind === "node" && selection.id === node.id ? "resource active" : "resource"}
              onClick={() => setSelection({ kind: "node", id: node.id })}
            >
              <span className={`typeDot ${node.type}`} />
              <strong>节点{node.code}</strong>
              <span>{node.title}</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>案例库</h2>
        <div className="resourceList">
          {workflow.caseLibraries.map((library) => (
            <button
              key={library.id}
              className={selection.kind === "caseLibrary" && selection.id === library.id ? "resource active" : "resource"}
              onClick={() => setSelection({ kind: "caseLibrary", id: library.id })}
            >
              <span className="typeDot case_match" />
              <strong>{library.title}</strong>
              <span>{library.cases.length} 条案例</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <div className="sectionTop">
          <h2>全局规则</h2>
          <button title="新增全局规则" onClick={addGlobalRule}><Plus size={14} /></button>
        </div>
        <div className="resourceList">
          {workflow.globalRules.map((rule, index) => (
            <div className="resourceRow" key={rule.id}>
              <button
                className={selection.kind === "globalRule" && selection.id === rule.id ? "resource active" : "resource"}
                onClick={() => setSelection({ kind: "globalRule", id: rule.id })}
              >
                <span className="typeDot logic" />
                <strong>{rule.title}</strong>
                <span>{rule.outputPosition}</span>
              </button>
              <div className="resourceActions">
                <button
                  title="上移规则"
                  aria-label={`上移规则：${rule.title}`}
                  disabled={index === 0}
                  onClick={() => moveGlobalRule(rule.id, -1)}
                ><ArrowUp size={13} /></button>
                <button
                  title="下移规则"
                  aria-label={`下移规则：${rule.title}`}
                  disabled={index === workflow.globalRules.length - 1}
                  onClick={() => moveGlobalRule(rule.id, 1)}
                ><ArrowDown size={13} /></button>
                <button
                  className="danger"
                  title="删除规则"
                  aria-label={`删除规则：${rule.title}`}
                  onClick={() => deleteGlobalRule(rule.id)}
                ><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="sectionTop">
          <h2>变量定义</h2>
          <button title="新增变量字段" onClick={addField} disabled={workflow.nodes.length === 0}><Plus size={14} /></button>
        </div>
        <div className="fieldList">
          {fields.map(([key, label]) => (
            <div className="fieldItem" key={key}>
              <div className="fieldSummary">
                {label}<em>{key}</em>
              </div>
              <button
                className="danger"
                title="删除变量"
                aria-label={`删除变量：${label || key}`}
                onClick={() => deleteField(key)}
              ><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

function CanvasView({
  workflow,
  selection,
  setSelection,
  updateWorkflow,
  zoom,
  setZoom,
}: {
  workflow: Workflow;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  updateWorkflow: (updater: (workflow: Workflow) => void) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const [drag, setDrag] = useState<
    | { kind: "node"; id: string; offset: Point }
    | { kind: "point"; edgeId: string; pointIndex: number }
    | { kind: "pan"; start: Point; pan: Point }
    | null
  >(null);

  const nodesById = useMemo(() => new Map(workflow.nodes.map((node) => [node.id, node])), [workflow.nodes]);
  const selectedEdgeId = selection.kind === "edge" ? selection.id : "";
  const edgeRouteMeta = useMemo(() => buildEdgeRouteMeta(workflow, nodesById), [workflow, nodesById]);

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
  };

  const pointerMove = (event: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === "node") {
      const point = toWorld(event.clientX, event.clientY);
      updateWorkflow((workflowDraft) => {
        const target = workflowDraft.nodes.find((node) => node.id === drag.id);
        if (target) {
          target.layout.x = Math.round(point.x - drag.offset.x);
          target.layout.y = Math.round(point.y - drag.offset.y);
        }
      });
    } else if (drag.kind === "point") {
      const point = toWorld(event.clientX, event.clientY);
      updateWorkflow((workflowDraft) => {
        const edge = workflowDraft.edges.find((item) => item.id === drag.edgeId);
        if (edge?.routePoints[drag.pointIndex]) {
          edge.routePoints[drag.pointIndex] = { x: Math.round(point.x), y: Math.round(point.y) };
          edge.autoRoute = false;
        }
      });
    } else if (drag.kind === "pan") {
      setPan({ x: drag.pan.x + event.clientX - drag.start.x, y: drag.pan.y + event.clientY - drag.start.y });
    }
  };

  const startDrag = (event: React.PointerEvent, nextDrag: NonNullable<typeof drag>) => {
    canvasRef.current?.setPointerCapture(event.pointerId);
    setDrag(nextDrag);
  };

  const finishDrag = (event: React.PointerEvent) => {
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    setDrag(null);
  };

  return (
    <main
      ref={canvasRef}
      className="canvas"
      onPointerMove={pointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onPointerDown={(event) => {
        startDrag(event, { kind: "pan", start: { x: event.clientX, y: event.clientY }, pan });
      }}
      onWheel={(event) => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          setZoom(Math.min(1.6, Math.max(0.55, zoom + (event.deltaY > 0 ? -0.05 : 0.05))));
        }
      }}
    >
      <div className="canvasInner" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="edgeLayer" width="3200" height="1200">
          {workflow.edges.map((edge) => {
            const route = getEdgeRoute(edge, nodesById, edgeRouteMeta);
            if (!route) return null;
            const { routePoints, labelPoint } = route;
            const points = routePoints.map((point) => `${point.x},${point.y}`).join(" ");
            const selected = selectedEdgeId === edge.id;
            return (
              <g key={edge.id} className={selected ? "edge selected" : "edge"} onPointerDown={(event) => event.stopPropagation()}>
                <polyline
                  points={points}
                  fill="none"
                  stroke={edge.style.color}
                  strokeWidth={selected ? 3 : 2}
                  strokeDasharray={edge.style.dashed ? "7 5" : undefined}
                  markerEnd="url(#arrow)"
                  onClick={() => setSelection({ kind: "edge", id: edge.id })}
                />
                <text x={labelPoint.x + 8} y={labelPoint.y - 8} onClick={() => setSelection({ kind: "edge", id: edge.id })}>
                  {edge.label}
                </text>
                {selected && !edge.autoRoute && edge.routePoints.map((point, index) => (
                  <circle
                    key={`${edge.id}_${index}`}
                    cx={point.x}
                    cy={point.y}
                    r="7"
                    className="routePoint"
                    onDoubleClick={() => {
                      updateWorkflow((workflowDraft) => {
                        const targetEdge = workflowDraft.edges.find((item) => item.id === edge.id);
                        targetEdge?.routePoints.splice(index, 1);
                      });
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      startDrag(event, { kind: "point", edgeId: edge.id, pointIndex: index });
                    }}
                  />
                ))}
              </g>
            );
          })}
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#667085" />
            </marker>
          </defs>
        </svg>
        {workflow.nodes.map((node) => {
          const selected = selection.kind === "node" && selection.id === node.id;
          const mainScript = node.scripts[0]?.text ?? "";
          return (
            <article
              key={node.id}
              className={selected ? `nodeCard ${node.type} selected` : `nodeCard ${node.type}`}
              style={{ left: node.layout.x, top: node.layout.y, width: node.layout.width, minHeight: node.layout.height }}
              onPointerDown={(event) => {
                event.stopPropagation();
                const world = toWorld(event.clientX, event.clientY);
                startDrag(event, { kind: "node", id: node.id, offset: { x: world.x - node.layout.x, y: world.y - node.layout.y } });
                setSelection({ kind: "node", id: node.id });
              }}
            >
              <header>
                <span>节点{node.code}</span>
                <em>{nodeTypeLabels[node.type]}</em>
              </header>
              <h3>{node.title}</h3>
              <p>{mainScript}</p>
              <footer>
                <span>{node.decisions.length} 个判断</span>
                <span>{node.intentLevel.join("/") || "未定级"}</span>
              </footer>
            </article>
          );
        })}
      </div>
    </main>
  );
}

function NodeEditor({
  node,
  workflow,
  updateNode,
  deleteNode,
}: {
  node: WorkflowNode;
  workflow: Workflow;
  updateNode: (id: string, updater: (node: WorkflowNode) => void) => void;
  deleteNode: (id: string) => void;
}) {
  const addScript = () =>
    updateNode(node.id, (draft) => {
      draft.scripts.push({ id: `script_${Date.now()}`, text: "", tone: "自然", usage: "", required: false });
    });
  const addDecision = () =>
    updateNode(node.id, (draft) => {
      draft.decisions.push({
        id: `decision_${Date.now()}`,
        label: "新判断",
        customerSignals: ["客户回答"],
        intentLevel: "unknown",
        nextNodeId: workflow.nodes[0]?.id ?? "",
        priority: (draft.decisions.length + 1) * 10,
        stopAfterMatch: true,
        notes: "",
      });
    });

  return (
    <div className="editorPanel">
      <PanelTitle title={`节点${node.code}`} action={<button className="danger" title="删除节点" onClick={() => deleteNode(node.id)}><Trash2 size={15} /></button>} />
      <label>节点编号<MultilineInput value={node.code} onValueChange={(value) => updateNode(node.id, (draft) => { draft.code = value; })} /></label>
      <label>节点名称<MultilineInput value={node.title} onValueChange={(value) => updateNode(node.id, (draft) => { draft.title = value; })} /></label>
      <div className="twoCols">
        <label>节点类型
          <select value={node.type} onChange={(event) => updateNode(node.id, (draft) => { draft.type = event.target.value as WorkflowNode["type"]; })}>
            {Object.entries(nodeTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>状态
          <select value={node.status} onChange={(event) => updateNode(node.id, (draft) => { draft.status = event.target.value as WorkflowNode["status"]; })}>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <label>意向等级
        <select
          multiple
          value={node.intentLevel}
          onChange={(event) => updateNode(node.id, (draft) => {
            draft.intentLevel = Array.from(event.currentTarget.selectedOptions).map((option) => option.value as WorkflowNode["intentLevel"][number]);
          })}
        >
          {intentLabels.map((intent) => <option key={intent} value={intent}>{intent}</option>)}
        </select>
      </label>
      <label>标签<textarea rows={2} value={linesToText(node.tags)} onChange={(event) => updateNode(node.id, (draft) => { draft.tags = textToLines(event.target.value); })} /></label>

      <SectionHeader title="对话示例" onAdd={addScript} />
      {node.scripts.map((script, index) => (
        <ScriptEditor
          key={script.id}
          script={script}
          onChange={(updater) => updateNode(node.id, (draft) => updater(draft.scripts[index]))}
          onDelete={() => updateNode(node.id, (draft) => { draft.scripts.splice(index, 1); })}
        />
      ))}

      <SectionHeader title="话术逻辑" />
      <textarea rows={5} value={linesToText(node.logicNotes)} onChange={(event) => updateNode(node.id, (draft) => { draft.logicNotes = textToLines(event.target.value); })} />

      <SectionHeader title="采集字段" onAdd={() => updateNode(node.id, (draft) => draft.captureFields.push({ key: `field_${Date.now()}`, label: "新字段", required: false, examples: [], avoidAskDirectly: false, note: "" }))} />
      {node.captureFields.map((field, index) => (
        <div className="subCard" key={field.key}>
          <div className="twoCols">
            <MultilineInput value={field.key} onValueChange={(value) => updateNode(node.id, (draft) => { draft.captureFields[index].key = value; })} />
            <MultilineInput value={field.label} onValueChange={(value) => updateNode(node.id, (draft) => { draft.captureFields[index].label = value; })} />
          </div>
          <textarea rows={2} value={field.note} onChange={(event) => updateNode(node.id, (draft) => { draft.captureFields[index].note = event.target.value; })} />
          <label className="inlineCheck"><input type="checkbox" checked={field.required} onChange={(event) => updateNode(node.id, (draft) => { draft.captureFields[index].required = event.target.checked; })} /> 必填</label>
          <label className="inlineCheck"><input type="checkbox" checked={field.avoidAskDirectly} onChange={(event) => updateNode(node.id, (draft) => { draft.captureFields[index].avoidAskDirectly = event.target.checked; })} /> 避免直接问</label>
          <button className="textDanger" onClick={() => updateNode(node.id, (draft) => { draft.captureFields.splice(index, 1); })}>删除字段</button>
        </div>
      ))}

      <SectionHeader title="判断逻辑" onAdd={addDecision} />
      {node.decisions.map((rule, index) => (
        <DecisionEditor
          key={rule.id}
          rule={rule}
          nodes={workflow.nodes}
          onChange={(updater) => updateNode(node.id, (draft) => updater(draft.decisions[index]))}
          onDelete={() => updateNode(node.id, (draft) => { draft.decisions.splice(index, 1); })}
        />
      ))}

      <SectionHeader title="Prompt 输出设置" />
      <label className="inlineCheck">
        <input type="checkbox" checked={node.output?.includeInPrompt ?? true} onChange={(event) => updateNode(node.id, (draft) => { draft.output = { includeInPrompt: event.target.checked, showDecisionTable: draft.output?.showDecisionTable ?? true, showLogicNotes: draft.output?.showLogicNotes ?? true }; })} />
        包含在生成 prompt 中
      </label>
      <label className="inlineCheck">
        <input type="checkbox" checked={node.output?.showDecisionTable ?? true} onChange={(event) => updateNode(node.id, (draft) => { draft.output = { includeInPrompt: draft.output?.includeInPrompt ?? true, showDecisionTable: event.target.checked, showLogicNotes: draft.output?.showLogicNotes ?? true }; })} />
        显示判断表
      </label>
      <label>Prompt 说明<textarea rows={4} value={linesToText(node.promptNotes)} onChange={(event) => updateNode(node.id, (draft) => { draft.promptNotes = textToLines(event.target.value); })} /></label>
    </div>
  );
}

function ScriptEditor({ script, onChange, onDelete }: { script: ScriptLine; onChange: (updater: (script: ScriptLine) => void) => void; onDelete: () => void }) {
  return (
    <div className="subCard">
      <textarea rows={4} value={script.text} onChange={(event) => onChange((draft) => { draft.text = event.target.value; })} />
      <div className="twoCols">
        <MultilineInput placeholder="语气标签" value={script.tone} onValueChange={(value) => onChange((draft) => { draft.tone = value; })} />
        <MultilineInput placeholder="使用条件" value={script.usage} onValueChange={(value) => onChange((draft) => { draft.usage = value; })} />
      </div>
      <label className="inlineCheck"><input type="checkbox" checked={script.required} onChange={(event) => onChange((draft) => { draft.required = event.target.checked; })} /> 主/必出话术</label>
      <button className="textDanger" onClick={onDelete}>删除话术</button>
    </div>
  );
}

function DecisionEditor({
  rule,
  nodes,
  onChange,
  onDelete,
}: {
  rule: DecisionRule;
  nodes: WorkflowNode[];
  onChange: (updater: (rule: DecisionRule) => void) => void;
  onDelete: () => void;
}) {
  return (
    <div className="subCard">
      <div className="twoCols">
        <MultilineInput value={rule.label} onValueChange={(value) => onChange((draft) => { draft.label = value; })} />
        <select value={rule.intentLevel} onChange={(event) => onChange((draft) => { draft.intentLevel = event.target.value as DecisionRule["intentLevel"]; })}>
          {intentLabels.map((intent) => <option key={intent} value={intent}>{intent}</option>)}
        </select>
      </div>
      <label>客户回答信号<textarea rows={3} value={linesToText(rule.customerSignals)} onChange={(event) => onChange((draft) => { draft.customerSignals = textToLines(event.target.value); })} /></label>
      <div className="twoCols">
        <label>下一步节点
          <select value={rule.nextNodeId} onChange={(event) => onChange((draft) => { draft.nextNodeId = event.target.value; })}>
            {sortByCode(nodes).map((node) => <option key={node.id} value={node.id}>节点{node.code} {node.title}</option>)}
          </select>
        </label>
        <label>优先级<input type="number" value={rule.priority} onChange={(event) => onChange((draft) => { draft.priority = Number(event.target.value); })} /></label>
      </div>
      <label>判断说明<textarea rows={2} value={rule.notes} onChange={(event) => onChange((draft) => { draft.notes = event.target.value; })} /></label>
      <button className="textDanger" onClick={onDelete}>删除判断</button>
    </div>
  );
}

function EdgeEditor({ edge, workflow, updateEdge }: { edge: WorkflowEdge; workflow: Workflow; updateEdge: (id: string, updater: (edge: WorkflowEdge) => void) => void }) {
  const source = workflow.nodes.find((node) => node.id === edge.sourceNodeId);
  const target = workflow.nodes.find((node) => node.id === edge.targetNodeId);
  const addPoint = () => {
    const sx = source ? source.layout.x + source.layout.width : 0;
    const sy = source ? source.layout.y + source.layout.height / 2 : 0;
    const tx = target ? target.layout.x : sx + 240;
    const ty = target ? target.layout.y + target.layout.height / 2 : sy;
    updateEdge(edge.id, (draft) => {
      draft.routePoints.push({ x: Math.round((sx + tx) / 2), y: Math.round((sy + ty) / 2) });
      draft.autoRoute = false;
    });
  };
  return (
    <div className="editorPanel">
      <PanelTitle title="连线设置" />
      <div className="readonlyLine"><strong>起点</strong><span>{source ? `节点${source.code} ${source.title}` : edge.sourceNodeId}</span></div>
      <div className="readonlyLine"><strong>终点</strong><span>{target ? `节点${target.code} ${target.title}` : edge.targetNodeId}</span></div>
      <label>连线标签<MultilineInput value={edge.label} onValueChange={(value) => updateEdge(edge.id, (draft) => { draft.label = value; })} /></label>
      <label className="inlineCheck"><input type="checkbox" checked={edge.autoRoute} onChange={(event) => updateEdge(edge.id, (draft) => { draft.autoRoute = event.target.checked; if (event.target.checked) draft.routePoints = []; })} /> 自动布线</label>
      <div className="buttonRow">
        <button onClick={addPoint}><Plus size={15} /> 加折点</button>
        <button onClick={() => updateEdge(edge.id, (draft) => { draft.routePoints = []; draft.autoRoute = true; })}><RefreshCcw size={15} /> 恢复自动</button>
      </div>
      <p className="hint">选中连线后，画布上的折点可拖动，双击折点删除。</p>
    </div>
  );
}

function CaseLibraryEditor({
  library,
  updateLibrary,
}: {
  library: CaseLibrary;
  updateLibrary: (id: string, updater: (library: CaseLibrary) => void) => void;
}) {
  const addCase = () =>
    updateLibrary(library.id, (draft) => {
      draft.cases.push({
        id: `case_${Date.now()}`,
        industry: "行业-关键词",
        keywords: ["关键词"],
        company: "公司",
        shop: "店铺",
        region: "地区",
        monthlyRevenue: "10万",
        priority: draft.cases.length * 10 + 10,
        notes: "只作为参考，不承诺结果。",
      });
    });
  return (
    <div className="editorPanel">
      <PanelTitle title="案例库" />
      <label>案例库名称<MultilineInput value={library.title} onValueChange={(value) => updateLibrary(library.id, (draft) => { draft.title = value; })} /></label>
      <SectionHeader title="匹配规则" onAdd={() => updateLibrary(library.id, (draft) => draft.matchRules.push({ id: `case_rule_${Date.now()}`, label: "新规则", description: "", priority: draft.matchRules.length * 10 + 10 }))} />
      {library.matchRules.map((rule, index) => (
        <div className="subCard" key={rule.id}>
          <div className="twoCols">
            <MultilineInput value={rule.label} onValueChange={(value) => updateLibrary(library.id, (draft) => { draft.matchRules[index].label = value; })} />
            <input type="number" value={rule.priority} onChange={(event) => updateLibrary(library.id, (draft) => { draft.matchRules[index].priority = Number(event.target.value); })} />
          </div>
          <textarea rows={2} value={rule.description} onChange={(event) => updateLibrary(library.id, (draft) => { draft.matchRules[index].description = event.target.value; })} />
          <button className="textDanger" onClick={() => updateLibrary(library.id, (draft) => { draft.matchRules.splice(index, 1); })}>删除规则</button>
        </div>
      ))}
      <SectionHeader title={`案例 ${library.cases.length}`} onAdd={addCase} />
      <div className="caseTable">
        {library.cases.map((item, index) => (
          <CaseRow key={item.id} item={item} onChange={(updater) => updateLibrary(library.id, (draft) => updater(draft.cases[index]))} onDelete={() => updateLibrary(library.id, (draft) => { draft.cases.splice(index, 1); })} />
        ))}
      </div>
    </div>
  );
}

function CaseRow({ item, onChange, onDelete }: { item: BusinessCase; onChange: (updater: (item: BusinessCase) => void) => void; onDelete: () => void }) {
  return (
    <div className="subCard compact">
      <MultilineInput value={item.industry} onValueChange={(value) => onChange((draft) => { draft.industry = value; })} />
      <div className="twoCols">
        <MultilineInput value={item.company} onValueChange={(value) => onChange((draft) => { draft.company = value; })} />
        <MultilineInput value={item.shop} onValueChange={(value) => onChange((draft) => { draft.shop = value; })} />
      </div>
      <div className="twoCols">
        <MultilineInput value={item.region} onValueChange={(value) => onChange((draft) => { draft.region = value; })} />
        <MultilineInput value={item.monthlyRevenue} onValueChange={(value) => onChange((draft) => { draft.monthlyRevenue = value; })} />
      </div>
      <textarea rows={2} value={linesToText(item.keywords)} onChange={(event) => onChange((draft) => { draft.keywords = textToLines(event.target.value); })} />
      <button className="textDanger" onClick={onDelete}>删除案例</button>
    </div>
  );
}

function GlobalRuleEditor({ rule, updateRule, deleteRule }: { rule: GlobalRule; updateRule: (id: string, updater: (rule: GlobalRule) => void) => void; deleteRule: (id: string) => void }) {
  return (
    <div className="editorPanel">
      <PanelTitle title="全局规则" action={<button className="danger" onClick={() => deleteRule(rule.id)} title="删除规则"><Trash2 size={15} /></button>} />
      <label>标题<MultilineInput value={rule.title} onValueChange={(value) => updateRule(rule.id, (draft) => { draft.title = value; })} /></label>
      <label>触发条件<textarea rows={2} value={rule.trigger} onChange={(event) => updateRule(rule.id, (draft) => { draft.trigger = event.target.value; })} /></label>
      <label>输出位置
        <select value={rule.outputPosition} onChange={(event) => updateRule(rule.id, (draft) => { draft.outputPosition = event.target.value as GlobalRule["outputPosition"]; })}>
          <option value="prompt_start">prompt_start</option>
          <option value="before_nodes">before_nodes</option>
          <option value="after_nodes">after_nodes</option>
          <option value="prompt_end">prompt_end</option>
        </select>
      </label>
      <label>适用范围<textarea rows={2} value={linesToText(rule.appliesTo)} onChange={(event) => updateRule(rule.id, (draft) => { draft.appliesTo = textToLines(event.target.value); })} /></label>
      <label>规则内容<textarea rows={8} value={linesToText(rule.content)} onChange={(event) => updateRule(rule.id, (draft) => { draft.content = textToLines(event.target.value); })} /></label>
    </div>
  );
}

function RightPanel({
  workflow,
  selection,
  updateWorkflow,
  setSelection,
}: {
  workflow: Workflow;
  selection: Selection;
  updateWorkflow: (updater: (workflow: Workflow) => void) => void;
  setSelection: (selection: Selection) => void;
}) {
  const updateNode = (id: string, updater: (node: WorkflowNode) => void) =>
    updateWorkflow((draft) => {
      const target = draft.nodes.find((node) => node.id === id);
      if (target) updater(target);
    });
  const updateEdge = (id: string, updater: (edge: WorkflowEdge) => void) =>
    updateWorkflow((draft) => {
      const target = draft.edges.find((edge) => edge.id === id);
      if (target) updater(target);
    });
  const updateLibrary = (id: string, updater: (library: CaseLibrary) => void) =>
    updateWorkflow((draft) => {
      const target = draft.caseLibraries.find((library) => library.id === id);
      if (target) updater(target);
    });
  const updateRule = (id: string, updater: (rule: GlobalRule) => void) =>
    updateWorkflow((draft) => {
      const target = draft.globalRules.find((rule) => rule.id === id);
      if (target) updater(target);
    });

  if (selection.kind === "node") {
    const node = workflow.nodes.find((item) => item.id === selection.id) ?? workflow.nodes[0];
    if (!node) return <aside className="propertyPanel" />;
    return (
      <aside className="propertyPanel">
        <NodeEditor
          node={node}
          workflow={workflow}
          updateNode={updateNode}
          deleteNode={(id) => {
            updateWorkflow((draft) => {
              draft.nodes = draft.nodes.filter((node) => node.id !== id);
              for (const node of draft.nodes) node.decisions = node.decisions.filter((decision) => decision.nextNodeId !== id);
              if (draft.startNodeId === id) draft.startNodeId = draft.nodes[0]?.id ?? "";
            });
            setSelection({ kind: "node", id: workflow.nodes.find((item) => item.id !== id)?.id ?? "" });
          }}
        />
      </aside>
    );
  }
  if (selection.kind === "edge") {
    const edge = workflow.edges.find((item) => item.id === selection.id);
    return <aside className="propertyPanel">{edge && <EdgeEditor edge={edge} workflow={workflow} updateEdge={updateEdge} />}</aside>;
  }
  if (selection.kind === "caseLibrary") {
    const library = workflow.caseLibraries.find((item) => item.id === selection.id);
    return <aside className="propertyPanel">{library && <CaseLibraryEditor library={library} updateLibrary={updateLibrary} />}</aside>;
  }
  const rule = workflow.globalRules.find((item) => item.id === selection.id);
  return (
    <aside className="propertyPanel">
      {rule && (
        <GlobalRuleEditor
          rule={rule}
          updateRule={updateRule}
          deleteRule={(id) => {
            updateWorkflow((draft) => { draft.globalRules = draft.globalRules.filter((item) => item.id !== id); });
            setSelection({ kind: "node", id: workflow.nodes[0]?.id ?? "" });
          }}
        />
      )}
    </aside>
  );
}

function PanelTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="panelTitle"><h2>{title}</h2>{action}</div>;
}

function SectionHeader({ title, onAdd }: { title: string; onAdd?: () => void }) {
  return (
    <div className="sectionHeader">
      <h3>{title}</h3>
      {onAdd && <button title="新增" onClick={onAdd}><Plus size={14} /></button>}
    </div>
  );
}

function PromptView({ markdown }: { markdown: string }) {
  const copy = () => navigator.clipboard?.writeText(markdown);
  return (
    <main className="documentView">
      <div className="docHeader"><h2>Prompt 预览</h2><button onClick={copy}><Save size={15} /> 复制</button></div>
      <pre>{markdown}</pre>
    </main>
  );
}

function JsonView({ document, onApply }: { document: WorkflowDocument; onApply: (document: WorkflowDocument) => void }) {
  const [value, setValue] = useState(JSON.stringify(document, null, 2));
  const [error, setError] = useState("");

  useEffect(() => {
    setValue(JSON.stringify(document, null, 2));
    setError("");
  }, [document]);

  return (
    <main className="documentView">
      <div className="docHeader">
        <h2>AI 可编辑 JSON</h2>
        <button onClick={() => {
          try {
            onApply(normalizeDocument(JSON.parse(value)));
            setError("");
          } catch (err) {
            setError(err instanceof Error ? err.message : "JSON 解析失败");
          }
        }}><CheckCircle2 size={15} /> 应用 JSON</button>
      </div>
      {error && <div className="errorBanner">{error}</div>}
      <textarea className="jsonEditor" value={value} onChange={(event) => setValue(event.target.value)} />
    </main>
  );
}

function ValidationView({ workflow }: { workflow: Workflow }) {
  const issues = validateWorkflow(workflow);
  return (
    <main className="validationView">
      <h2>校验结果</h2>
      {issues.length === 0 ? (
        <div className="emptyState"><CheckCircle2 size={22} /> 当前 workflow 没有发现错误或警告。</div>
      ) : (
        <div className="issueList">
          {issues.map((issue) => (
            <article key={issue.id} className={`issue ${issue.severity}`}>
              <strong>{issue.severity === "error" ? "错误" : "警告"}</strong>
              <span>{issue.target}</span>
              <p>{issue.message}</p>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

export function App() {
  const [document, setDocument] = useState<WorkflowDocument>(sampleWorkflowDocument);
  const [workflowRecords, setWorkflowRecords] = useState<WorkflowRecord[]>([]);
  const [activeWorkflowId, setActiveWorkflowId] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>("loading");
  const [view, setView] = useState<ViewMode>("canvas");
  const [selection, setSelection] = useState<Selection>({ kind: "node", id: sampleWorkflowDocument.workflow.startNodeId });
  const [zoom, setZoom] = useState(0.82);
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>(() => loadModelProfiles());
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [showTestBench, setShowTestBench] = useState(false);
  const workflow = document.workflow;
  const markdown = useMemo(() => compilePrompt(workflow), [workflow]);
  const issues = useMemo(() => validateWorkflow(workflow), [workflow]);

  function applyWorkflowRecord(record: WorkflowRecord) {
    setActiveWorkflowId(record.id);
    writeActiveWorkflowId(record.id);
    setDocument(record.document);
    setSelection({ kind: "node", id: record.document.workflow.startNodeId || record.document.workflow.nodes[0]?.id || "" });
  }

  const saveCurrentWorkflowNow = async () => {
    if (!storageReady || !activeWorkflowId) return;
    await saveWorkflowRecord(createWorkflowRecord(document, activeWorkflowId));
  };

  const saveAndOpenWorkflow = async (record: WorkflowRecord) => {
    try {
      await saveCurrentWorkflowNow();
      await saveWorkflowRecord(record);
      setWorkflowRecords((prev) => sortRecords([...prev.filter((item) => item.id !== record.id), record]));
      applyWorkflowRecord(record);
      setStorageReady(true);
      setStorageStatus("saved");
    } catch (error) {
      console.error(error);
      setStorageStatus("error");
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadWorkflows = async () => {
      try {
        let records = await getWorkflowRecords();
        if (records.length === 0) {
          const initialDocument = cloneDocument(sampleWorkflowDocument);
          initialDocument.workflow.id = createWorkflowId();
          const initialRecord = createWorkflowRecord(initialDocument, "default_workflow");
          await saveWorkflowRecord(initialRecord);
          records = [initialRecord];
        }

        let recordToOpen: WorkflowRecord | undefined;
        const shareId = getShareIdFromPath();
        if (shareId) {
          try {
            const sharedDocument = normalizeDocument(await fetchSharedDocument(shareId));
            sharedDocument.workflow.id = createWorkflowId();
            sharedDocument.workflow.title = createWorkflowTitle(sharedDocument.workflow.title || "Shared workflow");
            const sharedRecord = createWorkflowRecord(sharedDocument);
            await saveWorkflowRecord(sharedRecord);
            records = sortRecords([...records, sharedRecord]);
            recordToOpen = sharedRecord;
            window.history.replaceState(null, "", "/");
          } catch (error) {
            console.error(error);
            window.alert(error instanceof Error ? error.message : "Failed to load shared workflow.");
          }
        }

        if (cancelled) return;
        const savedActiveId = readActiveWorkflowId();
        const activeRecord = recordToOpen ?? records.find((record) => record.id === savedActiveId) ?? records[0];
        setWorkflowRecords(sortRecords(records));
        applyWorkflowRecord(activeRecord);
        setStorageReady(true);
        setStorageStatus("saved");
      } catch (error) {
        console.error(error);
        setStorageStatus("error");
      }
    };

    void loadWorkflows();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageReady || !activeWorkflowId) return;

    const record = createWorkflowRecord(document, activeWorkflowId);
    setWorkflowRecords((prev) => sortRecords(prev.map((item) => item.id === activeWorkflowId ? record : item)));
    setStorageStatus("saving");
    const handle = window.setTimeout(() => {
      saveWorkflowRecord(record)
        .then(() => setStorageStatus("saved"))
        .catch((error) => {
          console.error(error);
          setStorageStatus("error");
        });
    }, 350);

    return () => window.clearTimeout(handle);
  }, [activeWorkflowId, document, storageReady]);

  const updateWorkflow = (updater: (workflow: Workflow) => void) => {
    setDocument((prev) => {
      const workflowDraft = cloneWorkflow(prev.workflow);
      updater(workflowDraft);
      return { ...prev, workflow: syncEdges(workflowDraft) };
    });
  };

  const addNode = () => {
    const id = `node_${Date.now()}`;
    updateWorkflow((draft) => {
      const last = draft.nodes[draft.nodes.length - 1];
      draft.nodes.push({
        id,
        code: `${draft.nodes.length + 1}`,
        title: "新节点",
        type: "question",
        intentLevel: [],
        scripts: [{ id: `script_${Date.now()}`, text: "", tone: "自然", usage: "", required: true }],
        logicNotes: [],
        captureFields: [],
        decisions: [],
        promptNotes: [],
        layout: { x: (last?.layout.x ?? 80) + 80, y: (last?.layout.y ?? 120) + 80, width: 280, height: 150 },
        tags: [],
        status: "draft",
        output: { includeInPrompt: true, showDecisionTable: true, showLogicNotes: true },
      });
    });
    setSelection({ kind: "node", id });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = "workflow.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const shareWorkflow = async () => {
    const createAndCopy = async (token?: string) => {
      const result = await createShareLink(document, token);
      if (token) writeShareToken(token);
      await copyText(result.url);
      window.alert(`分享链接已复制：\n${result.url}`);
    };

    try {
      await createAndCopy();
    } catch (error) {
      if (error instanceof ShareApiError && error.status === 403) {
        const token = window.prompt("请输入分享创建密钥。朋友打开链接不需要密钥。");
        if (!token) return;
        try {
          await createAndCopy(token);
        } catch (retryError) {
          console.error(retryError);
          window.alert(retryError instanceof Error ? retryError.message : "创建分享链接失败。");
        }
        return;
      }

      console.error(error);
      window.alert(error instanceof Error ? error.message : "创建分享链接失败。");
    }
  };

  const exportImage = async () => {
    try {
      await exportWorkflowImage(workflow);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "导出图片失败");
    }
  };

  const importJson = async (file: File) => {
    try {
      const parsed = normalizeDocument(JSON.parse(await file.text()));
      const importedDocument = cloneDocument(parsed);
      if (!importedDocument.workflow.id) importedDocument.workflow.id = createWorkflowId();
      await saveAndOpenWorkflow(createWorkflowRecord(importedDocument));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "导入失败");
    }
  };

  const selectWorkflow = async (id: string) => {
    if (id === activeWorkflowId) return;
    const record = workflowRecords.find((item) => item.id === id);
    if (!record) return;
    try {
      await saveCurrentWorkflowNow();
      applyWorkflowRecord(record);
      setStorageStatus("saved");
    } catch (error) {
      console.error(error);
      setStorageStatus("error");
    }
  };

  const createWorkflow = async () => {
    const nextDocument = cloneDocument(sampleWorkflowDocument);
    nextDocument.workflow.id = createWorkflowId();
    nextDocument.workflow.title = createWorkflowTitle("新图");
    await saveAndOpenWorkflow(createWorkflowRecord(nextDocument));
  };

  const duplicateWorkflow = async () => {
    const nextDocument = cloneDocument(document);
    nextDocument.workflow.id = createWorkflowId();
    nextDocument.workflow.title = `${document.workflow.title || "Workflow"} 副本`;
    await saveAndOpenWorkflow(createWorkflowRecord(nextDocument));
  };

  const deleteActiveWorkflow = async () => {
    if (!activeWorkflowId || workflowRecords.length <= 1) return;
    if (!window.confirm("删除当前图？这个操作不会删除已导出的 JSON 文件。")) return;

    const remaining = workflowRecords.filter((record) => record.id !== activeWorkflowId);
    const nextRecord = remaining[0];
    try {
      await deleteWorkflowRecord(activeWorkflowId);
      setWorkflowRecords(sortRecords(remaining));
      applyWorkflowRecord(nextRecord);
      setStorageStatus("saved");
    } catch (error) {
      console.error(error);
      setStorageStatus("error");
    }
  };

  const applyLayout = (mode: "code" | "intent" | "start") => {
    updateWorkflow((draft) => {
      const ordered = mode === "code" ? sortByCode(draft.nodes) : [...draft.nodes];
      const levelY: Record<string, number> = { A: 80, B: 330, C: 580, unknown: 820 };
      ordered.forEach((node, index) => {
        if (mode === "code") {
          node.layout.x = 80 + (index % 5) * 360;
          node.layout.y = 80 + Math.floor(index / 5) * 240;
        } else if (mode === "intent") {
          const intent = node.intentLevel[0] ?? (node.type === "ending" ? node.code : "unknown");
          node.layout.x = 80 + index * 190;
          node.layout.y = levelY[intent] ?? levelY.unknown;
        } else {
          node.layout.x = 80 + index * 330;
          node.layout.y = node.id === draft.startNodeId ? 160 : 160 + (index % 3) * 180;
        }
      });
    });
  };

  return (
    <div className="appShell">
      <AppToolbar
        view={view}
        setView={setView}
        workflowRecords={workflowRecords}
        activeWorkflowId={activeWorkflowId}
        storageStatus={storageStatus}
        onSelectWorkflow={selectWorkflow}
        onCreateWorkflow={createWorkflow}
        onDuplicateWorkflow={duplicateWorkflow}
        onDeleteWorkflow={deleteActiveWorkflow}
        onAddNode={addNode}
        onImport={importJson}
        onExport={exportJson}
        onShare={shareWorkflow}
        onExportImage={exportImage}
        onOpenTestBench={() => setShowTestBench(true)}
        onOpenModelSettings={() => setShowModelSettings(true)}
        onLayout={applyLayout}
        onZoom={(delta) => setZoom(Math.min(1.6, Math.max(0.55, zoom + delta)))}
        issuesCount={issues.length}
      />
      <div className="workspace">
        <Sidebar workflow={workflow} selection={selection} setSelection={setSelection} updateWorkflow={updateWorkflow} />
        {view === "canvas" && <CanvasView workflow={workflow} selection={selection} setSelection={setSelection} updateWorkflow={updateWorkflow} zoom={zoom} setZoom={setZoom} />}
        {view === "prompt" && <PromptView markdown={markdown} />}
        {view === "json" && <JsonView document={document} onApply={(next) => { setDocument(next); setSelection({ kind: "node", id: next.workflow.startNodeId || next.workflow.nodes[0]?.id || "" }); }} />}
        {view === "validation" && <ValidationView workflow={workflow} />}
        <RightPanel workflow={workflow} selection={selection} updateWorkflow={updateWorkflow} setSelection={setSelection} />
      </div>
      {showTestBench && (
        <PromptTestBench
          workflowId={workflow.id || activeWorkflowId}
          workflowTitle={workflow.title}
          prompt={markdown}
          profiles={modelProfiles}
          onOpenSettings={() => setShowModelSettings(true)}
          onClose={() => setShowTestBench(false)}
        />
      )}
      {showModelSettings && (
        <ModelSettingsDialog
          profiles={modelProfiles}
          onSave={(profiles) => {
            setModelProfiles(profiles);
            saveModelProfiles(profiles);
          }}
          onClose={() => setShowModelSettings(false)}
        />
      )}
    </div>
  );
}
