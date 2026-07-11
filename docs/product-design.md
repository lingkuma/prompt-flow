# Prompt Workflow 产品设计

## 1. 产品定位

这是一个面向“销售话术 / AI prompt 流程规则图”的可视化编辑器。它不是通用工作流自动化工具，而是把纯文本 prompt 里的节点、分支、判断、案例库、收尾规则拆成结构化数据，再通过画布编辑和一键编译重新生成完整 prompt。

核心目标：

- 让用户像画流程图一样编辑 prompt 话术流程。
- 每个节点都能维护多条话术、逻辑说明、判断规则和后续跳转。
- 连线可自动生成，也允许手动调整折点，解决复杂流程重叠问题。
- 最终可以一键生成可直接复制给大模型使用的完整 prompt。
- 数据结构要适合 AI 直接读写，后续可以做成一个 Codex skill 或项目内 Agent 规范，让 AI 按结构编辑网页和流程数据。

## 2. 目标用户与使用场景

主要用户：

- 需要设计复杂外呼、客服、销售、招商、面销话术流程的人。
- 会写 prompt，但不适合长期维护大段纯 Markdown 分支表的人。
- 希望 AI 能参与维护流程，但又不想让 AI 在整篇纯文本里乱改的人。

典型场景：

1. 用户先在画布上创建“识别来意”“使用场景”“产品答疑”“注册链接承接”等节点。
2. 在节点属性面板里填写多条话术示例、话术逻辑、判断逻辑。
3. 对判断规则选择后续节点，系统自动生成连线。
4. 用户拖动画布节点和连线折点，整理布局。
5. 用户点击“生成 prompt”，系统按固定模板拼接为完整 Markdown prompt。
6. 用户也可以让 AI 修改 JSON 数据，比如“把第一次拒绝但未挂断的客户都统一接到短挽留节点”。

## 3. 产品边界

MVP 必须做：

- 节点增删改查。
- 节点拖拽布局。
- 连线自动生成和手动调整折点。
- 节点字段编辑。
- 结构化数据保存为 JSON。
- JSON 编译为 Markdown prompt。
- 案例库和全局收尾规则作为独立模块维护。

MVP 暂不做：

- 多人实时协作。
- 运行时自动外呼。
- CRM 集成。
- AI 自动判断客户回答。
- 节点版本分支合并。

后续可扩展：

- 对话模拟器。
- prompt 质量检查。
- AI 辅助补分支。
- 节点模板库。
- 多行业案例库。
- 从旧 Markdown prompt 反向解析为流程图。

## 4. 信息架构

页面建议分为 4 个主要区域：

- 顶部工具栏：新建节点、生成 prompt、导入 JSON、导出 JSON、校验、预览。
- 左侧资源栏：节点列表、案例库、全局规则、变量定义。
- 中间画布：节点卡片、连线、折点、缩放和平移。
- 右侧属性面板：当前选中节点、连线、案例或全局规则的详细字段。

建议视图：

- 画布视图：主编辑入口。
- Prompt 预览：展示编译后的 Markdown。
- 数据视图：展示 AI 可编辑 JSON。
- 校验视图：展示断链、空判断、重复节点名、未引用案例等问题。

## 5. 核心对象

### 5.1 Workflow

表示一个完整 prompt 流程。

字段建议：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 流程唯一 ID |
| title | string | 流程名称 |
| description | string | 流程说明 |
| version | string | 数据结构版本 |
| startNodeId | string | 起始节点 |
| nodes | Node[] | 节点列表 |
| edges | Edge[] | 连线列表 |
| caseLibraries | CaseLibrary[] | 案例库 |
| globalRules | GlobalRule[] | 全局规则 |
| promptCompiler | PromptCompilerConfig | 生成 prompt 的配置 |

### 5.2 Node

节点是编辑器的核心单位。一个节点对应 `data/workflow.example.json` 里的“节点1：大白接待 · 识别来意”“节点9：注册链接承接”等块。

字段建议：

| 字段 | 类型 | 是否必填 | 说明 |
|---|---|---|---|
| id | string | 是 | 稳定 ID，AI 修改时主要引用这个 |
| code | string | 是 | 展示编号，如 `1`、`4.2`、`7.1` |
| title | string | 是 | 节点名称 |
| type | enum | 是 | start、question、logic、case_match、handoff、ending |
| intentLevel | enum[] | 否 | 该节点可能产生的 A/B/C 意向 |
| scripts | ScriptLine[] | 否 | 对话示例，可多条 |
| logicNotes | string[] | 否 | 话术逻辑，可多条 |
| captureFields | CaptureField[] | 否 | 该节点希望收集的信息 |
| decisions | DecisionRule[] | 否 | 判断逻辑和后续跳转 |
| promptNotes | string[] | 否 | 编译 prompt 时额外展示的说明 |
| layout | NodeLayout | 是 | 画布位置和尺寸 |
| tags | string[] | 否 | 如“拒绝挽留”“案例承接” |
| status | enum | 否 | draft、ready、deprecated |

节点类型建议：

- start：开场节点。
- question：询问节点，如使用场景、API 接入方式。
- logic：规则说明型节点。
- case_match：需要匹配案例库的节点。
- handoff：注册链接或其他后续动作承接节点。
- ending：成功开通、暂缓决定、无需求等收尾节点。

### 5.3 ScriptLine

用于存话术示例。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 话术 ID |
| text | string | 话术内容 |
| tone | string | 语气标签，如自然、降压、短挽留 |
| usage | string | 使用条件 |
| required | boolean | 是否生成 prompt 时必须出现 |

示例：

```json
{
  "id": "script_9_main",
  "text": "可以，直接从这里注册：https://0-0.pro/register?ref=75RRBBR3 。注册后就能查看实时模型、价格和充值通道，再按需要创建 token。你先打开看看；如果卡在注册、充值或接入哪一步，把页面提示告诉我就行，注意不要发完整 token 或支付敏感信息。",
  "tone": "清晰、低压力承接",
  "usage": "客户愿意注册、试用或主动索要网址时",
  "required": true
}
```

### 5.4 CaptureField

表示节点要收集的信息。

| 字段 | 类型 | 说明 |
|---|---|---|
| key | string | 字段名，如 usage_scenario |
| label | string | 中文显示名 |
| required | boolean | 是否关键字段 |
| examples | string[] | 用户回答示例 |
| avoidAskDirectly | boolean | 是否避免直接问 |
| note | string | 采集说明 |

`data/workflow.example.json` 里重要的采集字段：

- primary_question：客户当前最想了解的事项，如模型、价格、稳定性、线路、支付或注册。
- usage_scenario：个人对话、程序开发、内容生产、团队系统或转售。
- preferred_model：客户点名或偏好的模型。
- usage_volume：预计用量，用于客户主动要求估算成本时的说明。
- region / carrier：所在地区和网络运营商，用于线路建议。
- payment_method：客户主动提到的微信、支付宝、银行卡或 USDC。
- client_type：聊天客户端、Python、Node.js 或团队后端等接入方式。
- registration_status / issue_stage / error_message：注册状态和排查所需的非敏感信息。

### 5.5 DecisionRule

判断规则决定节点如何流向后续节点。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 判断 ID |
| label | string | 规则名称 |
| customerSignals | string[] | 客户回答信号 |
| intentLevel | enum | A、B、C、unknown |
| nextNodeId | string | 后续节点 |
| priority | number | 多规则命中时的优先级 |
| stopAfterMatch | boolean | 命中后是否停止继续判断 |
| notes | string | 判断说明 |

设计要求：

- `customerSignals` 使用自然语言短语，不要求写成复杂代码。
- `nextNodeId` 一旦选择，系统自动创建或更新连线。
- 同一节点可以有多个判断指向同一后续节点。
- 拒绝类判断要支持“第一次拒绝”和“再次拒绝”的差异。

示例：

```json
{
  "id": "decision_1_model",
  "label": "询问模型",
  "customerSignals": ["有什么模型", "支持哪些模型", "能用 GPT 吗", "能用 Claude 吗"],
  "intentLevel": "A",
  "nextNodeId": "node_3",
  "priority": 10,
  "stopAfterMatch": true,
  "notes": ""
}
```

### 5.6 Edge

连线可以由判断规则自动生成，也可以手动补充。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 连线 ID |
| sourceNodeId | string | 起点节点 |
| sourceDecisionId | string | 对应判断规则 |
| targetNodeId | string | 终点节点 |
| label | string | 连线显示文案 |
| intentLevel | enum | A、B、C、unknown |
| routePoints | Point[] | 手动折点 |
| autoRoute | boolean | 是否使用自动布线 |
| style | EdgeStyle | 颜色、线型 |

连线交互：

- 用户在判断规则里选择后续节点时，系统自动创建连线。
- 画布中显示连线标签，如“有店铺”“再次拒绝”“愿意看数据”。
- 连线中间允许添加多个折点。
- 如果用户拖动折点，则 `autoRoute=false`。
- 用户可以点击“重新自动布线”，清空 `routePoints`。

### 5.7 CaseLibrary

案例库要从节点中拆出来，需要案例匹配时由相应节点引用案例库。当前 `data/workflow.example.json` 使用的是产品答疑流程，`caseLibraries` 为空；案例库属于可选扩展。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 案例库 ID |
| title | string | 案例库名称 |
| matchRules | CaseMatchRule[] | 匹配规则 |
| cases | BusinessCase[] | 案例列表 |

BusinessCase 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 案例 ID |
| industry | string | 行业大类 |
| keywords | string[] | 关键词 |
| company | string | 公司 |
| shop | string | 店铺 |
| region | string | 地区 |
| monthlyRevenue | string | 月营收 |
| priority | number | 同类多个案例时排序 |
| notes | string | 注意事项 |

案例匹配规则：

- 优先完全匹配小类关键词。
- 其次匹配行业大类。
- 多个案例命中时优先高月营收、同行感更强的案例。
- 未命中时使用当前流程定义的通用说法。
- 不允许把案例数据写成承诺结果。

### 5.8 GlobalRule

全局规则用于存“收尾处理逻辑”“客户忙 / 没空”等不适合作为普通节点的规则。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 规则 ID |
| title | string | 规则标题 |
| trigger | string | 触发条件 |
| content | string[] | 规则内容 |
| appliesTo | string[] | 适用节点或全局 |
| outputPosition | enum | prompt_start、before_nodes、after_nodes、prompt_end |

建议把 A/B/C 收尾做成两种方式之一：

- 如果需要画出来，就做 ending 节点。
- 如果只作为统一规则，就放在 GlobalRule。

MVP 建议：A/B/C 收尾既有 ending 节点，也在全局规则中说明收尾原则。这样画布清晰，prompt 也完整。

## 6. 节点属性面板设计

选中节点时，右侧面板展示以下分组：

### 基础信息

- 节点编号。
- 节点名称。
- 节点类型。
- 意向等级。
- 标签。
- 状态。

### 对话示例

- 支持多条。
- 每条包含话术正文、使用条件、语气标签。
- 支持拖拽排序。
- 支持设为主话术。

### 话术逻辑

- 多条 bullet。
- 用于说明为什么这么问。
- 生成 prompt 时输出在“话术逻辑”下面。

### 采集字段

- 字段名。
- 显示名。
- 是否必填。
- 是否避免直接问。
- 采集说明。

### 判断逻辑

每条判断规则包含：

- 客户回答信号。
- 意向等级。
- 下一步节点。
- 判断说明。
- 优先级。

这里选择“下一步节点”后，画布自动生成连线。

### Prompt 输出设置

- 是否在生成 prompt 中显示该节点。
- 输出顺序。
- 是否显示表格。
- 是否显示逻辑说明。
- 是否合并到父节点。

## 7. 画布交互设计

### 节点卡片

节点卡片在画布中只展示摘要，避免太大：

- 节点编号 + 名称。
- 节点类型图标。
- 主话术前 1 行。
- 判断数量。
- 输出意向标签。
- 是否有断链或校验错误。

### 连线

连线颜色建议：

- A 级：绿色。
- B 级：蓝色。
- C 级：灰色或红色。
- unknown：中性灰。

连线标签显示判断名称或客户信号摘要。

### 自动布局

MVP 可以提供三个布局按钮：

- 从起点向右布局。
- 按节点编号布局。
- 按意向等级分层布局。

自动布局只修改节点位置，不改变节点内容。

### 折点调整

交互规则：

- 点击连线选中。
- 连线中部出现“加折点”控制点。
- 拖动折点改变 `routePoints`。
- 双击折点删除。
- 点击“恢复自动”清空手动折点。

## 8. Prompt 生成设计

Prompt 编译器负责把结构化数据变回 Markdown。

### 输出顺序

默认顺序：

1. 流程标题。
2. 总体说明。
3. 辅助流程图。
4. 按 `code` 排序输出节点。
5. 案例库（启用 `includeCaseLibrary` 时）。
6. 收尾处理逻辑。
7. 全局注意事项。

### 节点输出模板

```md
## 节点{code}：{title}

> {主话术}

{其他话术示例}

**话术逻辑：**
- {logicNotes}

**采集字段：**
- {captureFields}

| 客户回答 | 意向 | 下一步 |
|---|---|---|
| {customerSignals} | {intentLevel} | → {nextNodeCode} |

{promptNotes}
```

### 特殊节点输出

case_match 节点：

- 输出案例匹配规则。
- 输出模板结构。
- 输出已启用的案例库。
- 输出案例说法示例。

ending 节点：

- 输出收尾原则。
- 输出确认动作。
- 不输出普通判断表，除非该节点还能继续跳转。

### 编译校验

生成 prompt 前先校验：

- startNodeId 是否存在。
- 每个 decision.nextNodeId 是否存在。
- 每条 edge 是否能对应到 source/target。
- 是否存在孤立节点。
- 节点编号是否重复。
- case_match 节点是否绑定案例库。
- required 的话术是否为空。
- 是否存在“再次拒绝”没有终止出口。

## 9. AI 可编辑数据结构

为了让 AI 稳定编辑，不建议让 AI 直接改画布 DOM 或复杂二进制文件。建议保存为一个主 JSON 文件：

```text
workflow.json
```

AI 修改规则：

- 优先按 `id` 修改，不按中文标题猜测。
- 不直接重排全文件，除非用户明确要求。
- 新增节点必须同时补 `layout`。
- 新增判断必须写 `nextNodeId`。
- 如果 `nextNodeId` 变化，系统或脚本同步更新 edges。
- 不把案例月营收改写为承诺效果。
- 不删除用户手动设置的 `routePoints`，除非用户要求重新自动布线。

推荐的顶层 JSON 形态：

```json
{
  "schemaVersion": "0.1.0",
  "workflow": {
    "id": "zerozero_ai_api_customer_service_v1",
    "title": "0-0 AI API Token 销售客服流程",
    "description": "网络服务客服大白为客户介绍模型、价格、稳定性、线路和支付方式，并引导客户注册。",
    "version": "1.0.0",
    "startNodeId": "node_1",
    "nodes": [],
    "edges": [],
    "caseLibraries": [],
    "globalRules": [],
    "promptCompiler": {
      "format": "markdown",
      "nodeOrder": "code",
      "includeLogicNotes": true,
      "includeCaseLibrary": false,
      "includeGlobalRules": true
    }
  }
}
```

## 10. Skill 设计建议

可以在项目后续加入一个本地 skill，让 AI 按固定规范编辑流程。

skill 名称建议：

```text
prompt-workflow-editor
```

skill 职责：

- 读取 `workflow.json`。
- 按用户要求修改节点、判断、案例库或全局规则。
- 运行校验脚本。
- 运行 prompt 编译脚本。
- 输出改动摘要和校验结果。

skill 指令要点：

- 修改前先定位节点 ID。
- 不整篇重写中文 prompt。
- 修改结构化 JSON 后再编译 Markdown。
- 不直接编辑生成产物，除非用户明确要求。
- 对有歧义的分支跳转，先使用最小合理修改，并在总结中说明。

建议目录：

```text
skills/
  prompt-workflow-editor/
    SKILL.md
    scripts/
      validate-workflow.mjs
      compile-prompt.mjs
```

## 11. 文件与模块建议

后续实现可以采用以下结构：

```text
src/
  app/
    App.tsx
  components/
    Canvas/
    NodeCard/
    PropertyPanel/
    PromptPreview/
    CaseLibraryEditor/
  workflow/
    schema.ts
    compiler.ts
    validator.ts
    edgeSync.ts
    sampleWorkflow.ts
  styles/
    globals.css
docs/
  product-design.md
data/
  workflow.example.json
skills/
  prompt-workflow-editor/
```

如果先做最小可用版本，优先实现：

1. `schema.ts`：定义 Workflow、Node、Edge 等类型。
2. `sampleWorkflow.ts`：读取或内置 `data/workflow.example.json` 的在线客服结构化样例。
3. `compiler.ts`：结构化数据生成 Markdown。
4. `validator.ts`：检查断链和必填字段。
5. 前端画布：节点拖拽 + 属性面板 + prompt 预览。

## 12. MVP 迭代计划

### 第 1 阶段：静态数据和 prompt 编译

目标：先证明结构化数据能生成 `data/workflow.example.json` 对应的 Markdown prompt。

交付：

- Workflow TypeScript 类型。
- 示例 `workflow.example.json`。
- Prompt 编译函数。
- 校验函数。
- 命令行生成 Markdown。

### 第 2 阶段：基础可视化编辑器

目标：能在网页里改节点内容和跳转。

交付：

- 画布展示节点。
- 拖拽节点位置。
- 属性面板编辑节点字段。
- 判断规则选择后续节点。
- 自动生成连线。
- Prompt 预览。

### 第 3 阶段：连线折点和案例库

目标：让复杂流程图可整理，案例库可维护。

交付：

- 连线手动折点。
- 案例库表格编辑。
- case_match 节点绑定案例库。
- 案例匹配规则配置。

### 第 4 阶段：AI 编辑能力

目标：让 AI 稳定修改结构化流程。

交付：

- `prompt-workflow-editor` skill。
- 校验脚本。
- 编译脚本。
- AI 修改规范。
- 修改后差异摘要。

## 13. 关键产品决策

- 数据源以 JSON 为主，Markdown prompt 是生成产物。
- 节点判断是一级产品能力，不藏在纯文本里。
- 连线来自判断规则，不单独维护一套容易失真的流程图。
- 案例库独立于节点，避免同一行业案例散落在多个话术里。
- AI 只改结构化数据，减少对中文长文的误改和编码风险。
- 第一版不追求自动识别客户语义，只设计“规则图 + prompt 编译”。

## 14. 从 workflow.example.json 映射到产品对象

`data/workflow.example.json` 中的内容可以这样映射：

| 原文内容 | 产品对象 |
|---|---|
| 节点1、节点2、节点9 | Node |
| 大白接待、使用场景、注册链接承接 | Node.title |
| `scripts` 中的话术正文 | ScriptLine |
| 话术逻辑 bullet | Node.logicNotes |
| `customerSignals` 中的客户回答信号 | DecisionRule.customerSignals |
| `intentLevel` 中的意向等级 | DecisionRule.intentLevel |
| `nextNodeId` 中的下一步 | DecisionRule.nextNodeId |
| `caseLibraries` 中的案例列表 | CaseLibrary.cases |
| `matchRules` 中的案例匹配规则 | CaseLibrary.matchRules |
| A/B/C 收尾处理 | GlobalRule 或 ending Node |
| “先解决问题，再自然给出注册链接”这类原则 | Node.logicNotes 或 GlobalRule |

## 15. 下一步建议

下一步不要先做复杂 UI。建议继续以 `data/workflow.example.json` 为基准，运行校验和 prompt 编译，确认 13 个在线客服节点、判断跳转和全局规则都能稳定生成 Markdown prompt。这个验证通过后，再开始扩展更多行业或销售场景会更稳。

## 16. Prompt 对话测试台

编辑完成后，用户可以从顶部工具栏进入独立的全屏对话测试台。测试台不放在右侧属性面板中：属性面板宽度只适合编辑单个对象，无法承载多列长对话；全屏工作区则可以横向滚动展示 1～6 列结果，同时保留当前 workflow 编辑上下文。

### 模型配置

- 模型设置是独立的浏览器本地资源，不写入 workflow JSON，也不随分享链接传递。
- 每个配置包含配置名称、OpenAI 兼容 Base URL、API Key、模型名称和 Temperature。
- 用户可以保存多个命名配置；测试台每一列可以独立选择任意配置。
- API Key 当前保存在浏览器 localStorage，只适合个人或受控环境使用。公开部署若需要多人使用，应改为服务端代理和密钥托管。

### 对比方式

- 对比列数支持 1～6 列。
- 同一条用户消息并行发送到所有可见列，保证比较输入一致。
- 每列保留自己的完整消息历史，并支持独立停止、清空和切换模型配置。
- 系统消息始终使用当前 workflow 实时编译得到的 Prompt，因此返回编辑器修改后重新打开测试台即可测试最新版本。

### AI 开场白

测试台提供 workflow 级的 AI 开场白设置。应用开场白时重置各列，并把开场白作为第一条 `assistant` 消息显示和加入后续请求上下文，从而支持销售 AI 主动开口，也兼容不需要开场白的其他场景。

### API 调用边界

第一版直接从浏览器调用用户配置的 OpenAI 兼容 `/chat/completions` 接口。目标服务必须允许浏览器跨域请求（CORS）；如果服务不允许跨域，公开部署版本应增加同源后端代理。
