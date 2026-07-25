# AGENTS.md

## 0. 协作纪律（本项目专属，优先级高于下面的通用准则）

本仓库由 **Claude Code / Codex / Kimi 轮流**在**同一个目录**里开发。三个工具看不到彼此的对话记录，
所以交接状态必须落在仓库里。

### 0.1 交接协议

- **开工第一件事：读 [HANDOFF.md](HANDOFF.md)。** 不要去翻别人的对话记录。
- **收工最后一件事：更新 HANDOFF.md。** 至少写清：你改了什么、做到哪、下一步、踩到什么坑。
- **收工前工作区必须干净**——要么提交，要么在 HANDOFF.md 里写明为什么留着未提交的东西、那是在做什么。
  留下无人认领的未提交改动是本项目最常见的事故来源。
- 长期记录靠 `git log`（提交信息要写**为什么**改），HANDOFF.md 只管「现在在飞的是什么」。

### 0.2 分支

默认分支是 `main`。工作分支按工具加前缀，避免三方互相覆盖：

| 前缀 | 谁 |
|---|---|
| `claude/<主题>` | Claude Code |
| `codex/<主题>` | Codex |
| `kimi/<主题>` | Kimi |

一个分支只做一件事；合并前先 `git fetch origin && git rebase origin/main`；合并用 `git merge --no-ff`。

> ⚠ **三个工具共用一个目录时，分支不提供隔离。** `git checkout` 切的是整个目录，
> 两个工具同时跑，一个切分支就会把另一个正在编辑的文件换掉。**同一时间只让一个工具动这个目录。**

### 0.3 部署

`./deploy.sh` 从**本地工作树** rsync 到 Contabo，**不经过 git**（`/opt/hotcrush/*` 下没有 `.git`）。

- 工作区不干净就跑 deploy = 把半成品推上生产。
- 分支不构成保护：只要 checkout 在本地，deploy 就会带上去。
- 部署前必过门禁：`tsc --noEmit` + `vitest run` + `next build`（deploy.sh 默认已含，`--skip-gate` 慎用）。

### 0.4 数据库

只有一个 Supabase 生产库，没有 staging，且**被 4 个代码库 / 3 个部署目标共用**
（本仓库、`res_api`、Vercel 上的财务网站、Contabo 上的 Python 脚本）。

- 只读查询随便跑；**DDL/DML 一律只写成迁移文件，交给人执行**。
- 改任何表之前先确认这张表还有谁在读写——治理方案与所有权登记见
  `~/Downloads/企业级数据库重构与全代码数据访问改造总控Prompt.md`（v2）。
- 爬虫写入窗口是 KL 时间每晚 23:00 前后，DDL 避开，建议 01:00–13:00。

---

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
