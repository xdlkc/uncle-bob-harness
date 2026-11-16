# uncle-bob-harness

[English](./README.md) | 简体中文

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 的树外（out-of-tree）插件包，通过 TypeScript 有限状态机（`uncle-bob-director`）将单个 User Story 编排为确定性的软件工程流水线。

本插件不依赖父模型用自然语言记忆多步流程，而是由插件内置的状态机严格驱动 **Specifier → Coder → Cleaner → Hardener → QA** 五个隔离的 `spawn` 子会话（`inheritsParentContext: false`），并在每个阶段结束后运行宿主端确定性门禁（Host Gates），由门禁结果裁决 `PASS` / `FAIL` / `BLOCKED`。

## 工作原理

### 与 DeepSeek Harness 的集成方式

DSH 通过 Cordis 插件树与分层 YAML patch 组装运行形态。本仓库在 [`package.json`](./package.json) 中声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，通过 [`cordis.patch.yml`](./cordis.patch.yml) 将 `uncle-bob-director` 插件（[`src/index.ts`](./src/index.ts)）叠加到现有的 `web` 或 `headless` Profile 之上。

故事执行期间，Director 会通过 `agent/pre-step` 拦截并挂起父 Agent 循环（[`src/park.ts`](./src/park.ts)），防止父模型中途插手或自行宣布完成。

### 三种触发入口

以下三种入口全部接入同一个 TypeScript FSM（[`src/director.ts`](./src/director.ts)、[`src/fsm.ts`](./src/fsm.ts)）：

| 入口 | 触发条件 | 行为 |
|---|---|---|
| `/story <text>` | Web / 命令注册表（[`src/entry-command.ts`](./src/entry-command.ts)） | 直接启动 FSM，不经过父模型回合 |
| 首条用户消息 | `startOnFirstUserMessage: true`（[`src/park.ts`](./src/park.ts)） | 捕获会话首条非空消息（Headless 模式），结束时以退出码 `0`（`passed`）或 `1`（`blocked`）返回 |
| `uncle_bob_story` 工具 | `enableStoryTool: true`（[`src/entry-tool.ts`](./src/entry-tool.ts)） | 允许父模型将单个 User Story 委托给同一 FSM 执行 |

### 流水线阶段与宿主门禁

每个阶段的子 Agent 仅负责产出工作区文件与结构化报告（`STAGE_REPORT_SCHEMA`，[`src/schema.ts`](./src/schema.ts)）。**子 Agent 自报的 `status` 仅作证据，绝不代表 `PASS`**；子会话销毁后，宿主会独立执行以下门禁（[`src/gates/index.ts`](./src/gates/index.ts)）：

| 阶段 | 子 Agent 职责 | 宿主门禁校验 | 失败处理 |
|---|---|---|---|
| **1. Specifier** | 在 `<artifactRoot>/story-<id>/` 写入 `acceptance.feature`、`qa.md`、`blockers.md` | `gherkin-parse`：校验文件存在且非空、用 `@cucumber/gherkin` 解析场景、`blockers.md` 非空时 fail-closed 为 `BLOCKED`、禁止修改 `src/` | 重试 Specifier（不超过 `retryBudget`） |
| **2. Coder** | 在 `src/` 实现公共 API，在 `tests/` 编写单元测试 | `unit-acceptance`：执行 `unitCommand`（`npx vitest run`）与 `acceptanceCommand`（`npx cucumber-js --fail-fast`） | 重试 Coder |
| **3. Cleaner** | 在保持行为不变的前提下重构复杂度与依赖 | `unit-acceptance` + `crap`（要求 `CRAP(cc, cov) <= crapCap`，默认 `8`）+ `architecture`（按 `architecture.rules.json` 检查模块导入与循环依赖） | 重试 Cleaner |
| **4. Hardener** | 强化测试以消灭残留变异体 | `mutation`：执行 `mutationCommand`（`npx stryker run`），解析 `reports/mutation/mutation.json`，并核对故事开始前已锁定的豁免清单 | 重试 Hardener |
| **5. QA** | 依据 `qa.md` 在 `tests/qa/` 编写黑盒测试与 `qa-report.md` | `qa`：校验 `src/` 未被改动、限制 `tests/qa/` 仅导入公开入口、运行 `qaCommand`（`npx vitest run tests/qa`） | 失败时退回 **Coder** 修复（QA 严禁修改 `src/`） |
| **6. Independent Rerun** | 宿主独立复核 | `independent-rerun` + `tamper`：重跑全部门禁（`unit-acceptance`、`crap`、`architecture`、`mutation`、`qa`），并检查受保护配置文件与既有测试未被削弱或删除 | 失败则以 `blocked` 终止 |

附加保护机制：
- **Last-green 快照**：每阶段 `PASS` 后自动保存绿色快照（默认 `copy-tree` 存入 `.uncle-bob/story-<id>/green/`，或通过 `snapshotMode` 切换为 `git-commit`）。
- **空转检测（Spin Detection）与诊断**：`detectSpin` 在 `spinWindow`（默认 `4`）窗口内检测重复失败指纹；一旦命中则恢复至最近绿色快照，按需派发只读 `diagnostic` Worker（`diagnosticOnSpin: true`），随后以 `blocked` 终止。
- **防篡改门禁（Anti-tamper）**（[`src/gates/tamper.ts`](./src/gates/tamper.ts)）：与故事开始时的指纹基线对比，拦截针对 `.gitignore`/`.ignore`、Vitest/`package.json` 覆盖率排除、Stryker 忽略规则、`architecture.rules.json`、变异豁免文件或已有测试文件删除的作弊行为。
- **内置能力 Skills**（[`src/skills-provider.ts`](./src/skills-provider.ts)、`assets/skills/`）：注册六个短小精悍的 Worker Skill（`gherkin-acceptance`、`coder-tdd`、`crap-cleanup`、`architecture-deps`、`mutation-gaps`、`black-box-qa`）。
- **v1 支持范围**：仅支持 TypeScript 工作区（通过同时存在 `tsconfig.json` 与 `package.json` 判定）。

## 环境要求

- **Node.js**：`^22.19 || >=24`
- **pnpm**
- 已完成构建的本地 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 仓库（如所用启动器依赖编译产物，请先在 DSH 仓库运行 `pnpm run build`）
- 环境变量或 `${DSH_HOME:-$HOME/.dsh}/.env` 中已配置 `DEEPSEEK_API_KEY`（以及可选的 `DEEPSEEK_BASE_URL`）

## 安装与运行

DSH 内置包（`@deepseek-ai/dsh-*`）随 DSH 仓库分发。若直接对未知 Profile 名运行 `dsh plugin add`，DSH 只会初始化 `@deepseek-ai/dsh-base`，因此必须**先复制一份 `web` 或 `headless` 模板 Profile**，再添加本插件包。

### 1. Web Profile（交互式 `/story` 观察模式）

在已完成构建的 `deepseek-harness` 仓库目录下执行：

```sh
# 默认 harness 目录为 ~/.dsh（可通过 DSH_HOME 覆盖）
pnpm dsh --profile web --dump-config >/dev/null
cp -R "${DSH_HOME:-$HOME/.dsh}/profiles/web" "${DSH_HOME:-$HOME/.dsh}/profiles/uncle-bob"

# 可选：在目标 profile 的 package.json 中将 "name" 设为 "dsh-profile-uncle-bob"
pnpm dsh plugin --profile uncle-bob add /path/to/uncle-bob-harness
pnpm dsh --profile uncle-bob --dump-config | head   # 预期输出包含 "# == uncle-bob-harness"
```

> **若 pnpm ≥ 10 拦截了 `prepare` 构建脚本**：在 `~/.dsh/profiles/uncle-bob/pnpm-workspace.yaml` 中添加以下配置后重新执行 `pnpm dsh plugin --profile uncle-bob add ...`：
>
> ```yaml
> allowBuilds:
>   uncle-bob-harness: true
> ```

在内置的 [`fixtures/fizzbuzz`](./fixtures/fizzbuzz/README.md) 示例工作区安装依赖并启动 Web 界面：

```sh
cd /path/to/uncle-bob-harness/fixtures/fizzbuzz
pnpm install   # 安装 vitest、cucumber、typescript、stryker

# 在工作区目录启动对应的 DSH Profile（具体路径按你的 DSH 启动方式调整）
pnpm dsh --profile uncle-bob
```

在 Web 输入框提交 `/story` 命令：

```text
/story Implement FizzBuzz for n=1..100. Multiples of 3 → Fizz, 5 → Buzz, both → FizzBuzz, else the number. Public function fizzBuzz(n: number): string.
```

### 2. Headless Profile（可重复自动化运行）

```sh
pnpm dsh --profile headless --dump-config >/dev/null
cp -R "${DSH_HOME:-$HOME/.dsh}/profiles/headless" "${DSH_HOME:-$HOME/.dsh}/profiles/uncle-bob-headless"
pnpm dsh plugin --profile uncle-bob-headless add /path/to/uncle-bob-harness

cd /path/to/uncle-bob-harness/fixtures/fizzbuzz
pnpm install
pnpm dsh --profile uncle-bob-headless "Implement FizzBuzz for n=1..100. Multiples of 3 → Fizz, 5 → Buzz, both → FizzBuzz, else the number. Public function fizzBuzz(n: number): string."
echo $?    # 0 表示 passed，1 表示 blocked
cat .uncle-bob/story-*/REPORT.md
```

Headless 模式下 `stdout` 保持为空（父模型不会输出常规对话回复）；`stderr` 会打印 `uncle-bob: passed story-…` 或 `uncle-bob: blocked …`，完整门禁记录写入 `.uncle-bob/story-<id>/REPORT.md`。

> **重要提示**：切勿在未先复制 `web` 或 `headless` 模板的前提下直接运行 `pnpm dsh plugin --profile uncle-bob add …`——新建 Profile 仅包含 `dsh-base`（不含 Web 界面与 `/story` 命令）。

## 配置项

默认插件层配置位于 [`cordis.patch.yml`](./cordis.patch.yml)，并在 [`src/config.ts`](./src/config.ts) 中通过 Schemastery 校验：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `subagentProvider` | `'spawn'` | 无父上下文的独立子会话提供器（`inheritsParentContext` 必须为 `false`） |
| `artifactRoot` | `'.uncle-bob'` | 相对于工作区 `cwd` 的产物根目录（存放 `story-<id>/`） |
| `crapCap` | `8` | 单函数允许的 `CRAP(cc, cov)` 上限（含等于） |
| `retryBudget` | `2` | 单阶段门禁 `FAIL` 后的最大重派次数 |
| `spinWindow` | `4` | 检测同一阶段 A→B→C 震荡循环的最近记录窗口大小 |
| `snapshotMode` | `'copy-tree'` | 绿色快照保存方式（`'copy-tree'` 或 `'git-commit'`） |
| `startOnFirstUserMessage` | `true` | 是否在会话首条用户消息到达时自动启动 FSM（用于 Headless） |
| `enableStoryTool` | `true` | 是否向模型暴露 `uncle_bob_story` 工具 |
| `gateTimeoutMs` | `600000` | 单个宿主门禁子进程的超时时间（毫秒） |

## 本地开发本插件包

若 `../deepseek-harness` 相邻目录存在 DSH 源码仓库，`pnpm install` 会通过 `postinstall` 执行 [`scripts/link-dsh.mjs`](./scripts/link-dsh.mjs)，将 `@deepseek-ai/*` 本地包软链至 `node_modules/`，无需 `workspace:*` 协议即可直接运行测试与编译：

```sh
pnpm install
pnpm test
pnpm run build
```

## 仓库目录导览

- [`cordis.patch.yml`](./cordis.patch.yml) — 插入 `uncle-bob-director` 的 Bundle 配置补丁
- [`src/`](./src/index.ts) — Director 驱动、纯状态机（[`src/fsm.ts`](./src/fsm.ts)）、配置校验、提示词模板、子会话封装、Git 快照与宿主门禁（[`src/gates/index.ts`](./src/gates/index.ts)）
- [`assets/skills/`](./assets/skills/gherkin-acceptance/SKILL.md) — 通过 `ctx.skills` 注册的六个阶段能力 Skill
- [`fixtures/fizzbuzz/`](./fixtures/fizzbuzz/README.md) — 内置 TypeScript 示例工作区（含 `vitest`、`cucumber`、`stryker` 与 `architecture.rules.json`）
- [`fixtures/gates/`](./fixtures/gates/architecture-pass/architecture.rules.json) — 各类宿主门禁的 pass/fail 单元测试样本
- [`tests/`](./tests/fsm.spec.ts) — Vitest 状态机与门禁测试套件
- [`docs/design.md`](./docs/design.md) — 完整 v1 技术设计文档
- [`research/`](./research/operating-principles.md) — 操作原则锁定记录与原始访谈/研究笔记
