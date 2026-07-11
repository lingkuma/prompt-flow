# prompt-workflow-editor

Use this skill when editing the structured prompt workflow for this project.

## Data Contract

- Primary source: `data/workflow.example.json` or another user-specified `workflow.json`.
- Do not edit generated Markdown directly unless the user explicitly asks for it.
- Prefer editing stable IDs such as `node_7_1`, `decision_4_reject_once`, and `industrial_cases`.
- When adding a node, include `layout`.
- When adding a decision, include `nextNodeId`; edges are synchronized from decisions by the app and scripts.
- Do not delete or rewrite `routePoints` unless the user asks to reset routing.
- Do not turn case-library revenue into promised customer results.
- Preserve Chinese text and UTF-8 encoding.

## Workflow

1. Read the JSON workflow file.
2. Make the smallest structured change that satisfies the user request.
3. Run validation:

```powershell
npm run validate -- data/workflow.example.json
```

4. Compile prompt when needed:

```powershell
npm run compile -- data/workflow.example.json > generated-prompt.md
```

5. Summarize changed node IDs, changed decision IDs, and validation results.

## Useful Commands

```powershell
npm run dev
npm run build
npm run validate -- data/workflow.example.json
npm run compile -- data/workflow.example.json
```
