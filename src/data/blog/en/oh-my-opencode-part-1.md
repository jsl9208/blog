---
author: Shilong Jiang
pubDatetime: 2026-01-20T00:00:00Z
title: "Deep Dive into Oh My OpenCode (1): From One Command to a PR — Multi-Agent Collaboration in Action"
featured: true
draft: false
tags:
  - oh-my-opencode
  - source-code-analysis
  - opencode
description: "A walkthrough of a complete development scenario showing how OMO's multi-agent orchestration system goes from a single user command through planning, exploration, execution, review, and self-healing to deliver a complete PR."
---

## Table of contents

## Background

Heywhale has been facing some business challenges recently. Budgets are tightening and the engineering team is unlikely to grow, yet as a business whose core products and services target key accounts, the workload only increases. This pressure forced me to rethink how our entire team works — not at the level of "using Copilot for code completion" or "LLM-assisted code review," but something more fundamental: is there a system that enables an entire team to collaborate deeply with AI, or even build an AI team to supplement capacity? With that question in mind, I took a deep dive into Oh My OpenCode and found its multi-agent orchestration far more mature than I expected, with many fascinating design decisions and implementations. So I decided to write this series to break down OMO's design and share my understanding and thoughts.

Oh My OpenCode (hereafter OMO) is a plugin for [OpenCode](https://github.com/anomalyco/opencode). OpenCode is an open-source AI coding assistant similar to Claude Code, but with extreme extensibility. As an open-source project, it also offers more room for experimentation and research.

What OMO does on top of this is one thing: **it transforms a single-agent assistant into a multi-agent orchestration platform**. I was genuinely shocked by its capabilities in my recent projects. Out of curiosity, I read the source code from top to bottom, and this series is my teardown notes.

- **10+ Specialized AI Agents**, each with unique models, roles, and permissions
- **20+ Custom Tools**, ranging from LSP analysis to task delegation to background concurrency
- **32+ Lifecycle Hooks**, covering error recovery, context injection, and automatic continuation
- **Claude Code Compatibility Layer**, seamless integration with the existing ecosystem
- **Tmux Integration**, real-time visualization of background agents

In this series, I won't just talk about architecture and source code in the abstract. Instead, I'll walk through a real scenario to show OMO's design philosophy and runtime logic.

---

## The Scenario: Adding Authentication to a Project

Imagine you are developing a web application and need to add user authentication. You type a single command into your terminal:

```
Add JWT authentication to this project, including registration, login, and middleware.
```

In a typical AI coding assistant, this would trigger a single LLM call. The model would try to write all the code at once — whether it works is partly luck and requires a fair amount of manual intervention and feedback.

In OMO, this command triggers an entire orchestration chain. Let's see what happens behind the scenes.

---

## Step 1: Sisyphus Receives the Request

The user's message first passes through the `chat.message` hook chain. The keyword detector (`keywordDetector`) scans the content, and a context injector pulls in the project's `AGENTS.md` and related rule files.

Once processed, the message reaches the primary agent — **Sisyphus**.

_The name comes from Greek mythology — Sisyphus, condemned to roll a boulder uphill for eternity. As the OMO author explains in the [README](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/README.md#L187-L191): LLM agents "push" their thinking every day, not so different from human developers. The metaphor extends into the implementation — the agent's work plan is literally called a `boulder`, and the Todo Continuation Enforcer ensures the agent never quits halfway, just as Sisyphus must keep pushing the stone to the top._

Sisyphus is an orchestrator, not an executor. Its [system prompt](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/agents/sisyphus.ts#L92) is explicit:

> **Default Bias: DELEGATE. WORK YOURSELF ONLY WHEN IT IS SUPER SIMPLE.**

For every request, Sisyphus follows a **Phase 0 Intent Classification** flow:

```d2
direction: down
Input: User Request
Decision: Intent Classification {
  shape: diamond
}
Direct: Complete using tools directly
Delegate: Enter delegation flow
Explore: Launch Explore Agent
Planning: Launch Prometheus for planning
Clarify: Ask user for clarification

Input -> Decision
Decision -> Direct: Trivial
Decision -> Delegate: Explicit
Decision -> Explore: Exploratory
Decision -> Planning: Open-ended
Decision -> Clarify: Ambiguous
```

"Add JWT authentication" is a typical open-ended task involving multiple files and modules. If a single agent were to handle this kind of complex work, it would very likely miss things and fail to produce a thorough result. Sisyphus is smart — it decides to let Prometheus plan first.

---

## Step 2: Prometheus Designs the Plan

**Prometheus** is the "architect" here. It doesn't handle concrete code tasks — it only produces blueprints.

Its workflow has three phases:

1. **Interview Phase**: Checks whether there's enough information for the task. If not, it automatically triggers Explore to search the project structure.
2. **Plan Generation**: Breaks the task into logically independent stages, assigning an agent category and required skills to each.
3. **Refinement & Review**: Submits the draft to Momus (the auditor agent) for rigorous review, iterating based on feedback (potentially many rounds).

Prometheus is bound by a hard constraint: the `prometheus-md-only` hook restricts it to writing only `.md` files — it cannot touch any code files. This fundamentally separates planning from execution.

_Hooks here refer to the lifecycle interception mechanism provided by OpenCode's [Plugin API](https://github.com/anomalyco/opencode/blob/aef0e58ad7c8fc299ac7bdf0bb63a54d6ab878e3/packages/plugin/src/index.ts#L148-L226) — think Git Hooks or React useEffect — that fire automatically around specific events (message sent, tool called, agent responded). OMO, as an OpenCode plugin, implements 30+ hooks on top of this API, covering context injection, permission control, error recovery, and more. We'll explore hooks in depth in later articles; for now, just remember: OpenCode provides the mechanism, OMO provides the policy._

The final plan is a [structured Markdown document](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/agents/prometheus-prompt.ts#L861-L1194) saved under `.sisyphus/plans/`. Here's a simplified version:

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

A few key design choices to note: Prometheus uses **Waves** (not Phases) to organize parallel execution; each task includes a recommended **Agent Profile** (category + skills); and acceptance criteria must be **agent-executable** — descriptions like "user manually verifies" are explicitly forbidden.

---

## Step 3: Parallel Exploration

While Prometheus is planning, Sisyphus has already launched two exploration agents in the background:

- **Explore**: Scans the project codebase to find existing route structures, database connection methods, and directory conventions.
- **Librarian**: Searches external documentation to find the usage of `jsonwebtoken`.

Both agents are **read-only**. OMO defines a tool denylist per agent in a [shared config module](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/shared/agent-tool-restrictions.ts), injected via the `tools` parameter when calling OpenCode SDK's `session.prompt()`:

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

This **read-write separation** design is critical — restricting agents' permission scope proactively prevents side effects. In OMO, only Sisyphus-Junior can modify code.

Explore and Librarian are launched via `delegate_task` with `run_in_background: true`. OMO implements its own [concurrency manager](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/features/background-agent/concurrency.ts) that maintains a counting semaphore per Provider/Model combination — for example, capping Anthropic at 3 concurrent tasks or Opus at 2. Tasks exceeding the limit are automatically queued and handed off as slots become available, preventing API rate limiting and cost spikes.

---

## Step 4: Junior Takes the Stage

With the plan ready and exploration results in hand, Sisyphus begins delegating tasks by phase.

Each sub-task is dispatched to **Sisyphus-Junior** via `delegate_task`, carrying a `category` (task type) and `load_skills` (skill injection):

```typescript
delegate_task({
  category: "unspecified-high",
  load_skills: ["git-master"],
  description: "Implement JWT auth",
  prompt:
    "...(includes full task description, coding standards, file paths, etc.)...",
  run_in_background: false, // Wait synchronously for results
});
```

The `category` and `load_skills` parameters are central to OMO's dispatch design. `category` determines which model handles the task — `visual-engineering` routes to a frontend-oriented model, `ultrabrain` to the strongest reasoning model, and `quick` to a lightweight model to save cost. `load_skills` loads [Skills](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/overview), injecting domain-specific instructions and knowledge into the agent. This mechanism lets Prometheus specify at planning time exactly which model and skills each task should use.

Junior is the busiest builder role in the system, with strict discipline — all constraints are structurally enforced, not just textual conventions in the prompt:

- **No Nested Delegation**: The `agent-tool-restrictions` shown earlier sets `task` and `delegate_task` to `false`, blocking them at the tool level to prevent infinite recursion.
- **Background Research Allowed**: `call_omo_agent` is [explicitly set to `allow`](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/agents/sisyphus-junior.ts#L85) in the agent definition. Junior can spawn Explore/Librarian for read-only research, but cannot delegate implementation work.
- **Single Category**: The `delegate_task` tool has [parameter validation](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/tools/delegate-task/tools.ts#L502-L508) that accepts only one category per call — passing multiple is rejected outright.

Junior starts writing code. The `tool.execute.before` hook performs environment checks before each tool call, while `tool.execute.after` handles output truncation and error detection.

---

## Step 5: Self-Healing After a Crash

Junior uses an incorrect import path while writing the auth middleware, and the Edit tool fails with `oldString not found`.

The [`edit-error-recovery`](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/hooks/edit-error-recovery/index.ts) hook kicks in. It intercepts Edit tool output via `tool.execute.after`, pattern-matches common errors (`oldString not found`, `found multiple times`), and injects a recovery prompt into the conversation, telling the agent to read the file's actual state before retrying.

But suppose the problem is more severe — Junior fails three times in a row. Sisyphus's [Phase 2C](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/agents/sisyphus.ts#L269-L286) failure recovery rules should activate:

1. **Stop** all further modifications.
2. **Roll back** to the last known good state.
3. **Log** all attempted fixes.
4. **Consult the Oracle**.

Worth noting: Phase 2C is **purely prompt-based** — there's no programmatic counter tracking consecutive failures, and no structural enforcement of the "stop after 3" rule. It relies on the LLM's self-discipline to follow the protocol. Prompt engineering and structural constraints coexist in OMO's current design.

---

## Step 6: Calling in the Oracle

**Oracle** is the most expensive agent in the system (marked as `EXPENSIVE`), used for high-difficulty debugging and architectural decisions. It's read-only — it cannot modify files or delegate tasks.

Oracle's output follows a three-layer structure: "Core → Extension → Edge Cases," and each suggestion is labeled with an estimated effort (Quick / Short / Medium / Large).

Oracle analyzes Junior's three failed attempts and provides a root-cause diagnosis and repair path. Sisyphus takes the advice and re-delegates the fix to Junior. This time, it succeeds.

---

## Step 7: Ralph Loop — Until It Passes

Throughout the task, two background mechanisms are constantly running:

**Todo Continuation Enforcer**: Checks the Todo list. If it finds uncompleted items, it automatically reactivates the agent to continue working. This ensures the agent doesn't stop halfway through a complex task.

**Ralph Loop**: When a test failure or build error is detected, it forces the agent into a repair cycle, attempting up to 100 rounds until the issue is resolved or the threshold is exceeded.

```text
[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO_CONTINUATION]
The following todo items are not yet completed:
- [ ] Add unit tests for auth middleware
Please continue your work.
```

---

## Step 8: Delivery

All phases complete. Sisyphus performs final verification:

1. Runs `lsp_diagnostics` on all modified files to confirm no type errors.
2. Executes tests (if the project has a test command).
3. Compares the output with the original requirements to ensure feature completeness.

The task is finished. From a single user command to final delivery, the process involved 5+ agents, dozens of tool calls, and multiple rounds of error recovery. But for me, it was just a short wait.

---

## System Overview

Let's recap the entire workflow:

```d2
shape: sequence_diagram
User: User
Sisyphus: "Sisyphus\nOrchestrator"
Prometheus: "Prometheus\nPlanning"
Explore: "Explore/Librarian\nResearch"
Junior: "Junior\nExecution"
Oracle: "Oracle\nConsultant"

User -> Sisyphus: "Add JWT auth"
Sisyphus -> Prometheus: Request planning
Sisyphus -> Explore: Parallel research (codebase + docs)
Prometheus -> Sisyphus: Structured execution plan
Explore -> Sisyphus: Project structure + library docs
Sisyphus -> Junior: "Wave 1: Infrastructure + deps"
Junior -> Sisyphus: Completed
Sisyphus -> Junior: "Wave 2: JWT endpoints + middleware"
Junior -> Sisyphus: Consecutive failures
Sisyphus -> Oracle: Request diagnosis
Oracle -> Sisyphus: Root cause analysis + repair path
Sisyphus -> Junior: Fix based on Oracle's advice
Junior -> Sisyphus: Fix successful
Sisyphus -> Junior: "Wave 2 contd: Test completion"
Junior -> Sisyphus: Completed
Sisyphus -> User: All tasks finished
```

Looking at the full picture, the division of labor between OpenCode and OMO becomes clear — **OpenCode provides the mechanism, OMO provides the policy**:

| Mechanism Provided by OpenCode       | Policy Built by OMO                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| Agent / Command / MCP loaders        | Claude Code compatibility layer, custom agent definitions                           |
| Hook Plugin API (lifecycle hooks)    | context-injector, hook-message-injector, and other injection pipelines              |
| Basic MCP invocation                 | BackgroundManager for parallel concurrency, task state management                   |
| Slash Command / Skill infrastructure | Built-in skill library, task-toast notifications, one-click `/start-work`           |
| ——                                   | Sisyphus / Prometheus task orchestration, `delegate_task` multi-agent collaboration |

This series focuses on OMO rather than OpenCode because **multi-agent orchestration is built from scratch by OMO** — it's OMO's most critical differentiator, and the key to building the AI team I'm after.

---

## What's Next

This post walked through OMO's standard workflow. In the following articles, I'll continue digging into the details — let's explore together how these elegant mechanisms are implemented.
