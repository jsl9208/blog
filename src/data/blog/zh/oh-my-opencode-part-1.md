---
author: Shilong Jiang
pubDatetime: 2026-01-20T00:00:00Z
title: "深入 Oh My OpenCode（1）：从一条指令到一个 PR —— 多 Agent 协作实录"
featured: true
draft: false
tags:
  - oh-my-opencode
  - 源码解析
  - opencode
description: "通过一个完整的开发场景，展示 OMO 多 Agent 协作系统如何从用户的一条指令出发，经过规划、探索、执行、审查、自愈，最终交付一个完整的 PR"
---

## Table of contents

## 背景

Claude Code 的能力大家并不陌生，很长时间我一直是它的忠实用户。直到近期 [OpenCode](https://github.com/anomalyco/opencode) + Oh My OpenCode（以下简称 OMO）这套组合出现，又一次升级了我的工作流和工作效率。

除了个人感受之外，促使我开始动笔写博客的更重要的原因，是最近在公司经营上遇到的一些挑战，让我重新审视了整个团队的工作方式，不是停留在"用 Copilot 补全代码"和"LLM 辅助 code review"的层面，而是：有没有一套系统，能让整个团队充分与 AI 协作，甚至构建一个 AI team 来补充产能？我深入研究了 OMO 这套基于 OpenCode 搭建的系统，在多 Agent 协作编排上远比我预期的成熟，有很多精巧的设计值得琢磨和借鉴。这给了我一些启发，于是决定写这个系列，拆解 OMO 的设计，分享我的理解和思考。

---

## 场景：给项目加一套认证模块

假设你正在开发一个 Web 应用，现在需要加上用户认证。你在终端里输入了一条指令：

```
帮我给这个项目加上 JWT 认证，包括注册、登录和中间件
```

在普通的 AI 编码助手里，这会触发一次 LLM 调用。模型会尝试一口气把所有代码写出来，结果好不好有一定的运气成分，往往需要比较多的人工干预和反馈。

在 OMO 里，这条指令触发的是一整条协作链。我们来看看这背后的逻辑。

---

## 请求分类：Sisyphus 的 Intent Gate

用户的消息首先经过 `chat.message` Hook 链。关键词检测器（`keywordDetector`）扫描内容，Context Injector 将当前项目的 `AGENTS.md` 和相关规则文件注入到对话中。

处理完毕后，消息到达主 Agent **Sisyphus**。

_名字来自希腊神话中永远推巨石上山的西西弗斯。OMO 作者的 [解释](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/README.md#L187-L191) 是：Agent 每天都在"推动"思维，和人类开发者没什么不同。这个隐喻也延伸到了实现层——工作计划叫 `boulder`（巨石），Todo Continuation Enforcer 确保 Agent 不会半途而废。_

Sisyphus 的角色是 Orchestrator，不是执行者。它的 [System Prompt](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/agents/sisyphus.ts#L92) 里写得很清楚：

> **Default Bias: DELEGATE. WORK YOURSELF ONLY WHEN IT IS SUPER SIMPLE.**

Sisyphus 对每个请求都会走一遍 **Phase 0 Intent Classification**：

```d2
direction: down
入口: 用户请求
判断: Intent Classification {
  shape: diamond
}
直接: 直接用工具完成
委派: 进入 Delegate
探索: 启动 Explore Agent
规划: 启动 Prometheus 规划
追问: 反问用户

入口 -> 判断
判断 -> 直接: 琐碎
判断 -> 委派: 显式
判断 -> 探索: 探索性
判断 -> 规划: 开放式
判断 -> 追问: 模糊
```

"加 JWT 认证"是个典型的开放式任务，涉及多文件、多模块。如果是单 Agent 去承载这种复杂工作，很容易出现遗漏或质量不稳定。Sisyphus 不会自己动手，而是先将任务交给 Prometheus 规划。

---

## 计划生成：Prometheus 的三阶段工作流

**Prometheus** 是这里的“架构师”。它不负责具体代码任务，只管出蓝图。

它的工作流分三个阶段：

1. **访谈阶段**：检查任务是否有足够信息。如果不够，它会自动触发 Explore 去搜索项目结构。
2. **计划生成**：把任务拆成逻辑独立的阶段，为每个阶段指定执行 Agent 的类别和所需技能。
3. **精炼与审核**：将草案提交给 Momus（审核 Agent）进行严苛的评审，根据反馈迭代（可能很多轮）。

Prometheus 受到一个硬约束：`prometheus-md-only` Hook 强制限制它只能写 `.md` 文件，不能碰任何代码文件。这从根本上隔离了规划与执行。

_Hook 是 OpenCode [Plugin API](https://github.com/anomalyco/opencode/blob/aef0e58ad7c8fc299ac7bdf0bb63a54d6ab878e3/packages/plugin/src/index.ts#L148-L226) 中的生命周期拦截机制，类似 Git Hooks，在特定事件前后自动触发。OMO 利用这套 API 实现了 30+ 个 Hook，后续文章会展开。这里先记住：OpenCode 提供机制，OMO 提供策略。_

最终输出的计划是一个[结构化的 Markdown 文档](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/agents/prometheus-prompt.ts#L861-L1194)，保存在 `.sisyphus/plans/` 目录下，大致结构如下（简化版）：

```markdown
# JWT Authentication

## TL;DR

> **Quick Summary**: Add JWT auth with registration, login and middleware
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves

## Execution Strategy

Wave 1 (Start Immediately):
├── Task 1: Install deps + create User model
└── Task 2: Research existing route patterns

Wave 2 (After Wave 1):
├── Task 3: Implement register/login endpoints
└── Task 4: Create auth middleware + tests

## TODOs

- [ ] 1. Setup auth infrastructure
     **Category**: `quick`
     **Skills**: [`git-master`]
     **Blocked By**: None
     **Acceptance Criteria**:
  - bun test src/models/user.test.ts → PASS

- [ ] 2. Implement JWT endpoints
     **Category**: `unspecified-high`
     **Skills**: [`git-master`]
     **Blocked By**: Task 1
     **Acceptance Criteria**:
  - curl -X POST /auth/login → 200 with JWT token
```

注意几个关键设计：

- 用 **Wave（波次）** 而不是 Phase 来组织并行执行。
- 每个任务都带有推荐的 **Agent Profile**（category + skills）。
- 验收标准必须是 **Agent 可自动执行的**，不允许出现"用户手动验证"这类描述。

---

## 并行探索：Explore 与 Librarian

在 Prometheus 规划的同时，Sisyphus 已经在后台并行启动了两个探索 Agent：

- **Explore**：搜索项目代码库，找到现有的路由结构、数据库连接方式、目录组织约定
- **Librarian**：检索外部资源（文档、开源代码等），查找 `jsonwebtoken` 的用法和最佳实践

这两个 Agent 都是**只读**的。OMO 通过一个[共享配置模块](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/shared/agent-tool-restrictions.ts)为每个 Agent 定义工具黑名单，在调用 OpenCode SDK 的 `session.prompt()` 时通过 `tools` 参数注入：

```typescript
// src/shared/agent-tool-restrictions.ts
const EXPLORATION_AGENT_DENYLIST = {
  write: false,
  edit: false,
  task: false,
  delegate_task: false,
  call_omo_agent: false,
};

const AGENT_RESTRICTIONS = {
  explore: EXPLORATION_AGENT_DENYLIST,
  librarian: EXPLORATION_AGENT_DENYLIST,
  oracle: { write: false, edit: false, task: false, delegate_task: false },
  "sisyphus-junior": { task: false, delegate_task: false },
};
```

这种 **读写分离** 的设计非常关键，限制 Agent 的权限范围，从机制上杜绝副作用。在 OMO 里，只有 Sisyphus 和 Sisyphus-Junior 能动代码，其余 Agent 全部只读。

Explore 和 Librarian 是通过 `delegate_task` 以 `run_in_background: true` 模式启动的。OMO 实现了一套[并发管理器](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/features/background-agent/concurrency.ts)，为每个 Provider/Model 组合维护独立的计数信号量，比如限制 Anthropic 最多 3 个并发、Opus 最多 2 个。超出上限的任务自动排队等待 slot 释放，以此防止 API 限流和费用失控。

---

## 任务执行：Sisyphus-Junior 与 delegate_task

计划就绪，探索结果也回来了。Sisyphus 开始按阶段委派执行任务。

每个子任务通过 `delegate_task` 分发给 **Sisyphus-Junior**，并携带 `category`（任务类型）和 `load_skills`（技能注入）：

```typescript
delegate_task({
  category: "unspecified-high",
  load_skills: ["git-master"],
  description: "Implement JWT auth",
  prompt: "...(包含完整的任务描述、代码规范、文件路径等)...",
  run_in_background: false, // 同步等待结果
});
```

这里的 `category` 和 `load_skills` 是 OMO 的核心调度设计。`category` 决定用哪个模型执行，例如：

- `visual-engineering` → 擅长前端的模型
- `ultrabrain` → 推理能力最强的模型
- `quick` → 轻量模型，降低成本

`load_skills` 加载 [Skills](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/overview)，向 Agent 注入特定领域的指令和知识。这套机制让 Prometheus 在规划阶段就能精确指定每个任务"该用什么模型、附带什么 Skill"。

Junior 是系统中最繁忙的 builder 角色，它有严格的纪律——其中大部分通过结构化机制强制执行，而非仅靠 prompt 约定：

- **禁止嵌套 Delegate**：前面展示的 `agent-tool-restrictions` 将 `task` 和 `delegate_task` 设为 `false`，从工具层面彻底封死，防止无限递归
- **允许背景研究**：`call_omo_agent` 在 [Agent 定义中被显式设为 `allow`](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/agents/sisyphus-junior.ts#L85)，Junior 可以启动 Explore/Librarian 做只读研究，但不能委派实现工作
- **单一 category**：`delegate_task` 工具层做了[参数校验](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/tools/delegate-task/tools.ts#L502-L508)，每次调用只接受一个 category，传多个直接报错

Junior 开始写代码。运行时，`tool.execute.before` Hook 在每次工具调用前做环境检查，`tool.execute.after` 在执行后做输出截断和错误检测。如果出了问题，后者会触发错误恢复流程。

---

## 错误恢复：edit-error-recovery 与 Phase 2C

Junior 在写 auth 中间件时用了错误的导入路径，Edit 工具报错 `oldString not found`。

这时 [`edit-error-recovery`](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/hooks/edit-error-recovery/index.ts) Hook 介入。它通过 `tool.execute.after` 拦截 Edit 工具的输出，模式匹配常见错误（如 `oldString not found`、`found multiple times`），然后向对话流中注入一段修复提示，要求 Agent 先读取文件实际状态再重试。

但假设问题更严重：Junior 连续失败了 3 次。这时 Sisyphus 的 [Phase 2C](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/agents/sisyphus.ts#L269-L286) 失败恢复规则会介入：

1. **停止**所有进一步的修改
2. **回退**到上一个已知的正常状态
3. **记录**所有尝试过的修复方案
4. **咨询 Oracle**

值得注意的是，Phase 2C 是**纯 prompt 层面的约定**——系统没有编程计数器来追踪失败次数，也没有强制执行"3 次后停止"的结构化机制。它依赖 LLM 的自律来遵守这套规则。OMO 当前设计中 prompt 工程与结构化约束并存：前者灵活但不可靠，后者刚性但覆盖面有限。

---

## 高级诊断：Oracle 介入

**Oracle** 是系统中最贵的 Agent（标记为 EXPENSIVE），用于高难度调试和架构决策。它只有只读权限，不能修改文件也不能委派任务。它的 System Prompt 写得很直白：「Dense and useful beats long and thorough」，不要面面俱到的分析，要能直接落地的建议。

Oracle 的输出遵循三层结构，每层有明确的触发条件：

- **Essential / 核心**（必须包含）：结论（2-3 句）+ 行动计划 + 工作量估算
- **Expanded / 展开**（相关时包含）：选择该方案的理由 + 需要注意的风险与边缘情况
- **Edge cases / 边缘场景**（确实需要时）：升级触发条件 + 备选方案草图

其中工作量估算使用四级标注：`Quick(<1h)`、`Short(1-4h)`、`Medium(1-2d)`、`Large(3d+)`，让下游 Agent 在执行前就能预判工作量。

Oracle 的调用方式也有几个值得注意的设计：

- **只有 Sisyphus 能调用**：Junior 的 `call_omo_agent` 只允许 explore 和 librarian，Oracle 必须通过 `delegate_task(subagent_type="oracle")` 调用，而这个工具在 Junior 身上是被禁用的。这意味着"请教高人"这个决策权只在 Orchestrator 手里。
- **始终同步执行**：不同于 explore/librarian 的后台异步模式，Oracle 调用是 `run_in_background: false`，Sisyphus 会停下来等结果。昂贵但必要，因为后续决策依赖 Oracle 的判断。
- **唯一需要「先宣布」的 Agent**：Sisyphus 在调用 Oracle 前必须先说「Consulting Oracle for [reason]」。系统中所有其他工作都是直接开始不做预告，只有 Oracle 例外，这给了用户对高成本操作的可见性。

回到我们的场景：Oracle 分析了 Junior 之前的三次失败尝试，给出了根因诊断和修复路径。Sisyphus 将诊断结果作为上下文，重新委派 Junior 执行修复。这次 Junior 有了明确的根因和修复路径，顺利通过。

---

## 持续保障：Ralph Loop 与 Todo Continuation

整个任务过程中，有两个后台机制在持续运作：

**Todo Continuation Enforcer**：检查 Todo 列表，如果发现有未完成的任务项，自动重新激活 Agent 继续工作。这确保 Agent 不会在任务完成到一半时就停下来。

```text
[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO_CONTINUATION]
The following todo items are not yet completed:
- [ ] Add unit tests for auth middleware
Please continue your work.
```

**Ralph Loop**：监听 Agent 的会话状态，如果 Agent 停止响应但尚未输出完成标记（`<promise>DONE</promise>`），自动注入 continuation message 重新激活 Agent 继续工作。默认最多 [100 轮](https://github.com/code-yeongyu/oh-my-opencode/blob/8c3feb8a9dff334ee95bc8d0a0c3878b5c997d58/src/hooks/ralph-loop/constants.ts#L4)，可通过配置调整。这是一个 continuation 机制而非错误检测：它不关心 Agent 具体在做什么，只确保 Agent 在任务真正完成前不会停下来。

两者各司其职：Todo Continuation 保证任务不被遗忘，Ralph Loop 保证产出物的质量。

---

## 最终验证与交付

所有阶段完成。Sisyphus 执行最终验证：

1. `lsp_diagnostics` 检查所有修改文件，确认无类型错误
2. 运行测试（如果项目有测试命令）
3. 与原始需求对比，确认功能完整

任务结束。从用户输入一条指令，到最终交付，整个过程涉及了 5+ 个 Agent、数十次工具调用、多轮错误恢复。但对用户来说，只是多等了一会儿。

---

## 系统全景

回顾整个流程：

```d2
shape: sequence_diagram
用户: 用户
Sisyphus: "Sisyphus\n编排者"
Prometheus: "Prometheus\n规划"
Explore: "Explore/Librarian\n探索"
Junior: "Junior\n执行"
Oracle: "Oracle\n顾问"

用户 -> Sisyphus: "帮我加 JWT 认证"
Sisyphus -> Prometheus: 需要规划
Sisyphus -> Explore: 并行探索代码库和文档
Prometheus -> Sisyphus: 分波次执行计划
Explore -> Sisyphus: 项目结构 + 库文档
Sisyphus -> Junior: "Wave 1: 基础设施 + 依赖安装"
Junior -> Sisyphus: 完成
Sisyphus -> Junior: "Wave 2: JWT 端点 + 中间件"
Junior -> Sisyphus: 连续失败
Sisyphus -> Oracle: 请求诊断
Oracle -> Sisyphus: 根因分析 + 修复路径
Sisyphus -> Junior: 按 Oracle 建议修复
Junior -> Sisyphus: 修复成功
Sisyphus -> Junior: "Wave 2 续: 测试补全"
Junior -> Sisyphus: 完成
Sisyphus -> 用户: 全部完成
```

回顾整个流程，可以清晰看到 OpenCode 与 OMO 的分工边界——**OpenCode 提供机制，OMO 提供策略**：

| OpenCode 提供的机制             | OMO 在其上构建的策略                                          |
| ------------------------------- | ------------------------------------------------------------- |
| Agent / Command / MCP 加载器    | Claude Code 兼容层、自定义 Agent 定义                         |
| Hook Plugin API（生命周期钩子） | context-injector、hook-message-injector 等注入管道            |
| 基础 MCP 调用能力               | BackgroundManager 后台并发、任务状态管理                      |
| Slash Command / Skill 基础设施  | 内置技能库、task-toast 通知、一键 `/start-work`               |
| （无对应机制）                  | Sisyphus / Prometheus 任务编排、`delegate_task` 多 Agent 协作 |

本系列着重分析 OMO 而非 OpenCode，是因为**多 Agent 编排是 OMO 从零搭建的**，是它最核心的差异化能力，也是我认为最值得借鉴的部分。

---

## 接下来

本篇主要是带大家过了一遍 OMO 的标准工作流程。下一篇我们会深入 `delegate_task` 的细节：Sisyphus 每次委派任务时构造了怎样的 prompt，又有哪些结构化的手段来控制子 Agent 的行为边界。
