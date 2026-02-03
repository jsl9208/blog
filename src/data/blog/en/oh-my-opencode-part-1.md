---
author: Shilong Jiang
pubDatetime: 2026-01-20T00:00:00Z
modDatetime: 2026-02-01T00:00:00Z
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

Claude Code's capabilities are no secret, and I was a loyal user for a long time. That is, until the combination of [OpenCode](https://github.com/anomalyco/opencode) and Oh My OpenCode (hereafter OMO) came along and once again upgraded my workflow and productivity.

Beyond personal experience, the more important reason I started this blog is the recent business challenges we've faced. They forced me to rethink how our entire team works — not just at the level of "using Copilot for code completion" or "LLM-assisted code review," but something more fundamental: how to build a system that enables an entire team to collaborate deeply with AI, or even build a Full-AI team to supplement capacity.

As a side note, with the improvement in LLM coding capabilities and consistency over the past two years, and the emergence of agentic assistants like Cursor and Claude Code, I can clearly feel the essence of software development changing. At the technical management level, we also need to rethink the definition and composition of a "team"—how human developers and AI assistants collaborate, and how to design workflows to maximize the strengths of both. In early 2025, I proposed internally that most development tasks might eventually become "0-person-day" tasks. Seeing the rapid evolution of agents in just a year, I have a strong feeling this fantasy is becoming reality.

Back to the topic, I spent a few days diving deep into OMO, a system built on top of OpenCode, and found its multi-agent orchestration architecture to be far more mature than I expected, with many elegant designs worth studying. This gave me the inspiration to start this series, breaking down OMO's design—both as a way to organize my own learning and as a starting point for building a "0-person-day" AI team.

---

## The Scenario: Adding Authentication to a Project

Imagine you are developing a web application and need to add user authentication. You type a single command into your terminal:

```
Add JWT authentication to this project, including registration, login, and middleware.
```

Under a typical Coding Agent's working logic, this would trigger a single LLM call. The model would try to write all the code at once — the quality often depends on luck, often requiring significant manual intervention and feedback.

In OMO, this command triggers an entire orchestration chain. Let's see what happens behind the scenes.

---

## Request Classification: Sisyphus's Intent Gate

The user's message first passes through the `chat.message` hook chain. The keyword detector (`keywordDetector`) scans the content, and a context injector pulls in the project's `AGENTS.md` and related rule files.

Once processed, the message reaches the primary agent **Sisyphus**.

_The name comes from Greek mythology — Sisyphus, condemned to roll a boulder uphill for eternity. As the OMO author explains in the [README](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/README.md#L187-L191): LLM agents "push" their thinking every day, not so different from human developers. The metaphor extends into the implementation — the agent's work plan is called a `boulder`, and there's a strict mechanism ensuring the agent never quits halfway — quite interesting._

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

"Add JWT authentication" is a typical open-ended task involving multiple files and modules. If a single agent were to handle this kind of complex work, it would very likely miss things and fail to produce a thorough result. Sisyphus won't do it alone; it first hands the task to Prometheus for planning.

---

## Plan Generation: Prometheus's Three-Phase Workflow

**Prometheus** is the "architect" here. It doesn't handle concrete code tasks — it only produces blueprints (structured plans with Todos).

Its workflow has three phases:

1. **Interview Phase**: Checks whether there's enough information for the task. If not, it automatically triggers Explore to search the project structure.
2. **Plan Generation**: Breaks the task into logically independent stages, assigning an agent category and required Skills to each.
3. **Refinement & Review**: Submits the draft to Momus (the auditor agent) for rigorous review, iterating based on feedback (potentially many rounds).

Prometheus is bound by a hard constraint: the `prometheus-md-only` hook restricts it to writing only `.md` files — it cannot touch any code files. This fundamentally separates planning from execution.

_Hooks here refer to the lifecycle interception mechanism provided by OpenCode's [Plugin API](https://github.com/anomalyco/opencode/blob/aef0e58ad7c8fc299ac7bdf0bb63a54d6ab878e3/packages/plugin/src/index.ts#L148-L226) — similar to Git Hooks — that fire automatically around specific events (message sent, tool called, agent responded). OMO, as an OpenCode plugin, implements 30+ hooks on top of this API. We'll dive deeper later; for now, just remember: OpenCode provides the mechanism, OMO builds policy on top of it._

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

A few key design choices to note:

- The system's term for task phases is **Wave**.
- Each task includes a recommended **Agent Profile** (Category + Skills).
- Acceptance criteria must be **agent-executable** — descriptions like "user manually verifies" are explicitly forbidden.

---

## Parallel Exploration: Explore and Librarian

While Prometheus is planning, Sisyphus has already launched two exploration agents in the background:

- **Explore**: Scans the project codebase to find existing route structures, database connection methods, and directory conventions.
- **Librarian**: Retrieves external resources (docs, open source code, etc.) to find the usage and best practices of `jsonwebtoken`.

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

This **read-write separation** design is critical — restricting agents' permission scope proactively prevents side effects. In OMO, only Sisyphus and Sisyphus-Junior can modify code; all other agents are all read-only.

Explore and Librarian are launched via `delegate_task` with `run_in_background: true`. OMO implements its own [concurrency manager](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/features/background-agent/concurrency.ts) that maintains a counting semaphore per Provider/Model combination. For example, it might cap Anthropic at 3 concurrent tasks or Opus at 2. Tasks exceeding the limit are automatically queued and handed off as slots become available, preventing API rate limiting and cost spikes.

---

## Task Execution: Sisyphus-Junior and delegate_task

Once the plan is ready and exploration results have returned, Sisyphus begins delegating tasks by phase.

Each sub-task is dispatched to **Sisyphus-Junior** via `delegate_task`, carrying a `category` (task type) and `load_skills` (skill injection):

```typescript
delegate_task({
  category: "unspecified-high",
  load_skills: ["git-master"],
  description: "Implement JWT auth",
  prompt: "...(包含完整的任务描述、代码规范、文件路径等)...",
  run_in_background: false, // 同步等待结果
});
```

The `category` and `load_skills` parameters are central to OMO's dispatch design. `category` determines which model handles the task, for example:

- `visual-engineering` → Routes to a frontend-oriented model.
- `ultrabrain` → Routes to the strongest reasoning model.
- `quick` → Routes to a lightweight model to save cost.

`load_skills` loads [Skills](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/overview), injecting domain-specific instructions and knowledge into the agent. This mechanism lets Prometheus specify at planning time exactly which model and skills each task should use.

Junior is the busiest builder role in the system, with strict discipline — most of which is structurally enforced, not just textual conventions in the prompt:

- **No Nested Delegation**: The `agent-tool-restrictions` shown earlier sets `task` and `delegate_task` to `false`, blocking them at the tool level to prevent infinite recursion.
- **Background Research Allowed**: `call_omo_agent` is [explicitly set to `allow`](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/agents/sisyphus-junior.ts#L85) in the agent definition. Junior can spawn Explore/Librarian for read-only research, but cannot delegate implementation work.
- **Single Category**: The `delegate_task` tool has [parameter validation](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/tools/delegate-task/tools.ts#L502-L508) that accepts only one category per call — passing multiple is rejected outright.

Junior starts writing code. The `tool.execute.before` hook performs environment checks before each tool call, while `tool.execute.after` handles output truncation and error detection. If something goes wrong, the latter triggers the error recovery flow.

---

## Error Recovery: edit-error-recovery and Phase 2C

Junior uses an incorrect import path while writing the auth middleware, and the Edit tool fails with `oldString not found`.

The [`edit-error-recovery`](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/hooks/edit-error-recovery/index.ts) hook kicks in. It intercepts Edit tool output via `tool.execute.after`, pattern-matches common errors (`oldString not found`, `found multiple times`), and injects a recovery prompt into the conversation, telling the agent to read the file's actual state before retrying.

But suppose the problem is more severe — Junior fails three times in a row. Sisyphus's [Phase 2C](https://github.com/code-yeongyu/oh-my-opencode/blob/839a4c53169d33bfe702cc3b1f241983b0df7823/src/agents/sisyphus.ts#L269-L286) failure recovery rules will intervene:

1. **Stop** all further modifications.
2. **Roll back** to the last known good state.
3. **Log** all attempted fixes.
4. **Consult the Oracle**.

Worth noting: Phase 2C is **purely prompt-based** — there's no programmatic counter tracking consecutive failures, and no structural enforcement of the "stop after 3" rule. It relies on the LLM's self-discipline to follow the protocol.

Prompt engineering and structural constraints coexist in OMO's current design: the former is flexible but unreliable, while the latter is rigid but has limited coverage. I think there is room for improvement here, and more structured error reporting and state machines could be introduced at the `delegate_task` level in the future.

---

## Advanced Diagnosis: Oracle Intervenes

**Oracle** is the most expensive agent in the system (marked as `EXPENSIVE`), used for high-difficulty debugging and architectural decisions. It has read-only permissions and cannot modify files or delegate tasks. Its system prompt is blunt: "Dense and useful beats long and thorough"—don't just stay at the analysis level, provide actionable advice.

Oracle's output follows a three-layer structure, with explicit triggers for each:

- **Essential / Core** (Always included): Conclusion (2-3 sentences) + Action Plan + Effort Estimation.
- **Expanded** (Included as appropriate): Rationale for the chosen solution + Risks and edge cases to watch for.
- **Edge cases** (When truly needed): Escalation triggers + Alternative solution sketches.

The effort estimation uses a four-level scale: `Quick(<1h)`, `Short(1-4h)`, `Medium(1-2d)`, and `Large(3d+)`, allowing downstream agents to anticipate the workload before execution.

Oracle's invocation design also includes several noteworthy points:

- **Only Sisyphus can call it**: Junior's `call_omo_agent` only allows Explore and Librarian. Oracle must be called via `delegate_task(subagent_type="oracle")`, a tool disabled for Junior. This ensures the decision to "consult an expert" stays with the Orchestrator.
- **Always synchronous**: Unlike the background asynchronous mode of Explore/Librarian, Oracle calls use `run_in_background: false`. Sisyphus stops and waits for the result, as subsequent decisions depend on Oracle's judgment.
- **The only agent requiring an "announcement"**: Sisyphus must state "Consulting Oracle for [reason]" before calling it. While all other work starts without preamble, Oracle is the exception, giving the user visibility into high-cost operations.

Back to our scenario: Oracle analyzes Junior's three failed attempts and provides a root-cause diagnosis and repair path. Sisyphus takes the advice as context and re-delegates the fix to Junior. This time, with a clear diagnosis and path forward, Junior succeeds.

---

## Continuous Assurance: Ralph Loop and Todo Continuation

Throughout the task, two background mechanisms are constantly running:

**Todo Continuation Enforcer**: Checks the Todo list. If it finds uncompleted items, it automatically reactivates the agent to continue working. This ensures the agent doesn't stop halfway through a complex task.

The strict management of Todos is an important reason for OMO to maintain task continuity, especially when the context window is not enough and needs to be compacted, or when switching to a new session, the Todo list acts as a state anchor across sessions.

```text
[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO_CONTINUATION]
The following todo items are not yet completed:
- [ ] Add unit tests for auth middleware
Please continue your work.
```

**Ralph Loop**: Monitors the agent's session state. If the agent stops responding without outputting a completion marker (`<promise>DONE</promise>`), it automatically injects a continuation message to reactivate it. By default, it allows up to [100 rounds](https://github.com/code-yeongyu/oh-my-opencode/blob/8c3feb8a9dff334ee95bc8d0a0c3878b5c997d58/src/hooks/ralph-loop/constants.ts#L4). This is a continuation mechanism, not error detection — it doesn't care what the agent is doing, only that it doesn't stop until the task is truly finished.

The two roles complement each other: Todo Continuation ensures no task is forgotten, while Ralph Loop ensures the quality and completion of the output.

---

## Final Verification and Delivery

All phases complete. Sisyphus performs final verification:

1. Runs `lsp_diagnostics` on all modified files to confirm no type errors.
2. Executes tests (if the project has a test command).
3. Compares the output with the original requirements to ensure feature completeness.

The task is finished. From a single user command to final delivery, the process involved 5+ agents, dozens of tool calls, and multiple rounds of error recovery. But for the user, it was just a short wait.

---

## System Overview

Execution Flow:

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
Prometheus -> Sisyphus: Waves of execution plan
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
| (No corresponding mechanism)         | Sisyphus / Prometheus task orchestration, `delegate_task` multi-agent collaboration |

This series focuses on OMO rather than OpenCode because **multi-agent orchestration is built from scratch by OMO** — it's OMO's most critical differentiator, and the most valuable part to learn from.

---

## What's Next

This post walked through OMO's standard workflow. It is clear that the entire OMO system has a deep understanding of the pain points in multi-agent collaboration scenarios, and has built an effective layered design, work policies, and many detailed engineering optimizations for it.

In the next post, I plan to dive into the details of `delegate_task`: what kind of prompts Sisyphus constructs when delegating tasks, and what structural means are used to control the behavioral boundaries of sub-agents. I believe it is the core hub of OMO's multi-agent collaboration, and understanding it will help us better design our own multi-agent systems.
