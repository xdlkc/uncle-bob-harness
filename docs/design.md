# Uncle Bob assembly-line plugin — DSH technical design (v1)

Status: implementable design. Do not reopen product locks in `research/operating-principles.md`.
Sources: Uncle Bob interview (`research/interview-core.md`), Twitter year (`research/twitter-year.md`), Implementation adaptations labeled in place.

This repo is an **out-of-tree DSH bundle** at `/Users/lkc/Code/uncle-bob-harness`. It is not a PR into `deepseek-harness/packages/`. Do not change `agent-loop`.

---

## 1. Goal and non-goals

### Goal

In a DSH **web** profile, a human submits **one** User Story and sees five short-lived children run **Specifier → Coder → Cleaner → Hardener → QA**. A TypeScript finite state machine in this plugin is the director. Each stage is a fresh `spawn` subagent (`inheritsParentContext: false`) that writes workspace artifacts, then is destroyed. The plugin re-runs deterministic host gates and owns PASS. Headless repeats the same FSM against `fixtures/fizzbuzz`.

The human watches process, gate JSON, architecture rules, and spot-checks. The human does not line-review generated code.

### Non-goals (v1)

| Item | Why out |
|---|---|
| Packs / squad-of-parallel-writers / supervisor | **Twitter** 2026-08-21: parallel writers failed. Packs are a later hypothesis (**Twitter** 2026-08-22/23). |
| Agent-to-agent debate, prompt-fixing | **Twitter** 2026-08-21: no honking; prompt-fixing is “spooky.” |
| Five immortal agent presets as the director | **Twitter** 2026-08-06: do not prompt a procedure; director is an executable FSM. |
| Architecture-viewer GUI, Client UI package | Existing subagent lineage + command result text + artifact files are enough. |
| Junior apprenticeship | Deferred (**Uncle Bob** UB-15; lock). |
| CRAP &lt; 4 as an agent gate | **Twitter** Wumpus: 4 overdoes it. |
| Delete-then-mutate | Experiment, not a method. |
| Growing `AGENTS.md` / 5–10 page prompts | **Uncle Bob** UB-08 (Lost in the Middle). |
| In-tree DSH PR, bilingual docs beyond a short README | Lock. |
| Claiming DSH `test:coverage` 100% on this repo | Out-of-tree. Still unit-test FSM and gates thoroughly. |

---

## 2. Approaches considered and choice

### A. TypeScript FSM tool + command calling `ctx.subagents` and running gates in-process (**chosen**)

A Cordis plugin owns a pure FSM plus an I/O driver. Entry points (`/story`, first user message, `uncle_bob_story` tool) all call `Director.start(agent, story, signal)`. The driver:

1. parks the parent (`agent/pre-step` reject / hold);
2. `ctx.subagents.start('spawn', { prompt, outputSchema, parent, signal, label, toolFilter })`;
3. awaits the one-shot run, reads `structured`, `dispose()`s;
4. runs host gates via `ctx.subprocess` + in-process parsers;
5. advances or retries from **gate JSON**, never from the model’s “done.”

This matches `dsh-tool-ralph` (fresh child, structured report, parent not the orchestrator) with the missing piece Ralph explicitly deferred: **independent evaluation**. Workflow JS cannot supply that (see B).

Closest in-tree template: `packages/workflow/tool-ralph/src/index.ts` (`requireFreshProvider`, structured schema, `run.dispose()` in `finally`). Difference: named stages and host gates between them live in TypeScript, not in a worker script.

### B. Ralph-like `workflowEngine` script for agent sequence, TypeScript wrapper for gates

`dsh-workflow-worker-thread` scripts get only these globals: `agent`, `parallel`, `pipeline`, `phase`, `log`, `args` (`packages/workflow/workflow-worker-thread/src/runtime.ts`). There is **no** `exec`, `fs`, `ctx.subprocess`, or host-gate hook. A script can spawn children and read their structured reports. It cannot run CRAP, Stryker, vitest, or an architecture checker.

A TypeScript wrapper that starts one workflow per stage, then runs gates, is just approach A with an extra isolation boundary and no gain: the director still has to live in TypeScript, and the script cannot own PASS. Multiple `workflowEngine.start` calls also lose the single FSM’s retry/spin/restore state unless that state is duplicated outside the script.

**Reject B** until DSH adds a host-gate hook to workflow scripts. None exists today.

### C. Five agent presets + parent model orchestrates

`dsh-agent-presets` would give each role a standing tool/prompt layer. The parent model would still have to follow a procedure (call Specifier, decide if Gherkin is good, call Coder, …). That is the failure mode **Twitter** 2026-08-06 named (“it will lose track of them”) and the lock forbids (“do not make the parent model the director”). Presets also tend toward immortal personas (**Uncle Bob** UB-10-05/06).

v1 uses **tiny prompts inside the FSM** (and optional short skills). No five immortal presets.

### Choice

**Implement A.** No DSH API is a better director than a plugin-owned TypeScript FSM over `ctx.subagents.start('spawn')` plus in-process gates.

---

## 3. Package / file layout of uncle-bob-harness

Single npm package (YAGNI: no package family). Compiled JS is what Cordis loads after `dsh plugin add`.

```
uncle-bob-harness/
  package.json                 # "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
  cordis.patch.yml
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                   # plugin: name, inject, Config, apply()
    config.ts                  # resolveConfig (fail loud even without Loader)
    director.ts                # I/O driver: spawn, gates, park, artifacts, git
    fsm.ts                     # pure reducer: states, events, retry, spin
    spawn.ts                   # ctx.subagents.start + dispose + schema validate
    prompts.ts                 # role persona + per-stage user prompt builders
    artifacts.ts               # paths under <cwd>/<artifactRoot>/story-<id>/
    schema.ts                  # structured child report + gate report types
    park.ts                    # agent/pre-step hold / reject
    entry-command.ts           # /story
    entry-tool.ts              # uncle_bob_story
    entry-first-message.ts     # headless / first user message
    skills-provider.ts         # badge-style bundled skills
    git.ts                     # last-green snapshot / restore
    subprocess-run.ts          # ctx.subprocess collect + timeout
    language.ts                # v1: typescript | unsupported
    gates/
      types.ts
      index.ts                 # runGate(name, cwd, config, signal)
      gherkin-parse.ts
      unit-acceptance.ts
      crap.ts                  # formula + join coverage/complexity
      architecture.ts          # import graph vs architecture.rules.json
      mutation.ts              # Stryker JSON + waivers
      qa.ts                    # QA command + product-tree diff
      tamper.ts                # protected-surface fingerprints
      independent-rerun.ts
  assets/skills/
    gherkin-acceptance/SKILL.md
    coder-tdd/SKILL.md
    crap-cleanup/SKILL.md
    architecture-deps/SKILL.md
    mutation-gaps/SKILL.md
    black-box-qa/SKILL.md
  fixtures/
    fizzbuzz/                  # demo workspace (human cwd)
    gates/
      gherkin-pass/
      gherkin-fail/
      crap-pass/
      crap-fail/
      architecture-pass/
      architecture-fail/
      mutation-pass/
      mutation-fail/
      tamper-coverage-exclude/
  tests/
    fsm.spec.ts
    spawn-schema.spec.ts
    park.spec.ts
    language.spec.ts
    loader-compose.spec.ts
    gates/*.spec.ts
  docs/design.md               # this file
  README.md                    # install + run (short)
  research/                    # already present; do not treat as runtime
```

`package.json` sketch:

```json
{
  "name": "uncle-bob-harness",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "assets"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "scripts": {
    "prepare": "tsc -p tsconfig.json",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-agent": "*",
    "@deepseek-ai/dsh-commands": "*",
    "@deepseek-ai/dsh-llm": "*",
    "@deepseek-ai/dsh-session": "*",
    "@deepseek-ai/dsh-skill": "*",
    "@deepseek-ai/dsh-subagent": "*",
    "@deepseek-ai/dsh-subprocess": "*",
    "@deepseek-ai/dsh-system-prompt": "*",
    "@deepseek-ai/dsh-tools": "*",
    "@deepseek-ai/schemastery": "*"
  }
}
```

`@deepseek-ai/dsh-*` packages are `private: true`. At runtime they resolve from `$DSH_HOME/profiles/node_modules` (app-boot installation fallback), not from npm. `prepare` builds `lib/` so a path/`git` install has an entry point. Allow `prepare` in the profile’s `pnpm-workspace.yaml` if pnpm ≥10 blocks it.

---

## 4. Cordis plugin(s): name, inject, Config schema, patch rows

One plugin. Skills are registered from the same `apply()`.

```ts
export const name = 'uncle-bob-director'
export const inject = ['subagents', 'tools', 'skills', 'subprocess']
```

Commands are optional (plan-mode pattern) so a composition without `ctx.commands` still loads:

```ts
ctx.inject(['commands'], (commandCtx) => {
  commandCtx.commands.register({ name: 'story', ... })
})
```

`agent/pre-step` is registered with `ctx.on(...)` (already an effect). `ctx.tools.register` / `ctx.skills.registerProvider` already return disposers.

### Config (Schemastery)

Every deployment-varying knob is a field. Protocol/security invariants stay fixed in code (see §15).

```ts
export interface Config {
  /** Fresh structured-output provider. Must report inheritsParentContext: false. */
  subagentProvider: string
  /** Artifact directory relative to session cwd. */
  artifactRoot: string
  /** Fail a function when CRAP(cc, cov) > this number (inclusive pass at equality). */
  crapCap: number
  /** Max director re-spawns of the same stage after a gate FAIL (not including the first try). */
  retryBudget: number
  /** Consecutive same-stage attempts inspected for A→B→C cycling. */
  spinWindow: number
  /** Host command argv for unit tests (cwd = session workspace). */
  unitCommand: string[]
  /** Host command argv for Gherkin/acceptance execution. */
  acceptanceCommand: string[]
  /** Host command argv for mutation (StrykerJS on TS workspaces). */
  mutationCommand: string[]
  /** Host command argv for QA scripts the QA child wrote. */
  qaCommand: string[]
  /** Relative path of committed architecture allow/forbid rules. */
  architectureRulesPath: string
  /** Relative path of committed equivalent-mutant waivers. Empty file = no waivers. */
  mutationWaiverPath: string
  /** After each stage PASS, snapshot the worktree as last-green. */
  snapshotOnPass: boolean
  /** How to snapshot: git commit in the workspace, or copy into artifactRoot. */
  snapshotMode: 'git-commit' | 'copy-tree'
  /** First admitted user message of a session starts the FSM (headless). */
  startOnFirstUserMessage: boolean
  /** Per-gate subprocess timeout. */
  gateTimeoutMs: number
  /** Max serialized child structured report. */
  maxHandoffChars: number
  /** On spin: one extra diagnostic spawn, then blocked. */
  diagnosticOnSpin: boolean
  /** Child tool deny-list (delegation + this plugin's own tool). */
  childToolDeny: string[]
  /** Register the model-facing uncle_bob_story tool. */
  enableStoryTool: boolean
}

export const Config: Schema<Config> = Schema.object({
  subagentProvider: Schema.string().default('spawn'),
  artifactRoot: Schema.string().default('.uncle-bob'),
  crapCap: Schema.number().min(1).default(8),
  retryBudget: Schema.number().step(1).min(0).default(2),
  spinWindow: Schema.number().step(1).min(2).default(4),
  unitCommand: Schema.array(Schema.string()).default(['npx', 'vitest', 'run']),
  acceptanceCommand: Schema.array(Schema.string()).default(['npx', 'cucumber-js', '--fail-fast']),
  mutationCommand: Schema.array(Schema.string()).default(['npx', 'stryker', 'run']),
  qaCommand: Schema.array(Schema.string()).default(['npx', 'vitest', 'run', 'tests/qa']),
  architectureRulesPath: Schema.string().default('architecture.rules.json'),
  mutationWaiverPath: Schema.string().default('.uncle-bob/mutation-waivers.json'),
  snapshotOnPass: Schema.boolean().default(true),
  snapshotMode: Schema.union(['git-commit', 'copy-tree']).default('copy-tree'),
  startOnFirstUserMessage: Schema.boolean().default(true),
  gateTimeoutMs: Schema.number().step(1).min(1000).default(600_000),
  maxHandoffChars: Schema.number().step(1).min(256).default(16_384),
  diagnosticOnSpin: Schema.boolean().default(true),
  childToolDeny: Schema.array(Schema.string()).default([
    'subagent', 'ralph', 'workflow', 'uncle_bob_story',
    'send_message', 'interrupt', 'list_agents',
  ]),
  enableStoryTool: Schema.boolean().default(true),
})
```

`resolveConfig()` in `apply()` must validate even if Loader did not normalize (Ralph pattern): empty `subagentProvider`, non-integer budgets, and empty command arrays throw at load.

**Fixed, not Config:** CRAP formula; `inheritsParentContext: false`; sequential one-writer; fail-closed on missing tools/artifacts; Specifier must not implement product code (enforced by “no `src/` writes” diff in the Specifier gate, **Implementation adaptation**); QA must not patch product code (diff gate).

### `cordis.patch.yml`

```yaml
# uncle-bob-harness bundle layer. Applied after whatever in-box bundles the
# profile already stacked (base+web-app or base+headless). Insert only; do not
# replace dsh-base rows (a replace must restate every key).
- insert:
    - id: uncle-bob-director
      name: uncle-bob-harness
      config:
        subagentProvider: spawn
        artifactRoot: .uncle-bob
        crapCap: 8
        retryBudget: 2
        startOnFirstUserMessage: true
        enableStoryTool: true
```

A dedicated **web** profile that still wants ordinary chat without auto-pipeline can override in the profile’s own `cordis.patch.yml` (later layer wins, whole config replace — restate every key):

```yaml
- id: uncle-bob-director
  config:
    subagentProvider: spawn
    artifactRoot: .uncle-bob
    crapCap: 8
    retryBudget: 2
    startOnFirstUserMessage: false
    enableStoryTool: true
    # ...every other key from the bundle defaults
```

v1 recommendation: keep `startOnFirstUserMessage: true`. The uncle-bob profile is a story runner, not a general chat profile. Web users can still use `/story`. Headless has no command adapter; the task positional *is* the first user message.

---

## 5. Story FSM: states, events, retry, A→B→C spin stop, park parent

### Pure reducer (`src/fsm.ts`)

Keep I/O out of the reducer. The driver interprets commands the reducer returns (`spawn`, `runGate`, `restoreGreen`, `park`, `unpark`, `halt`).

```ts
export type Stage =
  | 'specifier'
  | 'coder'
  | 'cleaner'
  | 'hardener'
  | 'qa'
  | 'independent-rerun'
  | 'diagnostic'

export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED'

export interface AttemptRecord {
  stage: Stage
  attempt: number
  verdict: Verdict
  /** Stable hash of gate JSON + worktree fingerprint (paths+contents of src/ and tests/). */
  fingerprint: string
}

export interface StoryState {
  storyId: string
  storyText: string
  stage: Stage
  attempt: number          // 1-based for the current stage
  retriesUsed: Partial<Record<Stage, number>>
  lastGreenId?: string     // git SHA or snapshot directory name
  history: AttemptRecord[]
  status: 'running' | 'passed' | 'blocked'
  blockReason?: string
}

export type FsmEvent =
  | { type: 'START'; storyId: string; storyText: string }
  | { type: 'CHILD_SETTLED'; stage: Stage; childStatus: 'complete' | 'blocked' | 'failed' | 'missing-structured' }
  | { type: 'GATE'; stage: Stage; verdict: Verdict; fingerprint: string; reason: string }
  | { type: 'ABORT'; reason: string }

export type FsmCommand =
  | { type: 'spawn'; stage: Exclude<Stage, 'independent-rerun'> }
  | { type: 'runGate'; stage: Stage }
  | { type: 'snapshotGreen' }
  | { type: 'restoreGreen' }
  | { type: 'halt'; status: 'passed' | 'blocked'; reason: string }
```

### State diagram

```
                    START
                      │
                      ▼
                 [specifier] ──spawn──► child ──GATE parse──► PASS ──► [coder]
                      ▲                                         │
                      └── FAIL & retries < budget ──────────────┤
                                                                │ FAIL & retries exhausted
                                                                ▼
                                                             blocked

[coder] → unit+acceptance PASS → [cleaner]
[cleaner] → tests PASS + CRAP + architecture PASS → [hardener]
[hardener] → mutation PASS → [qa]
[qa] PASS → [independent-rerun] → all gates PASS → passed
[qa] FAIL → route to [coder] (not QA rewriting product), count against QA retry budget;
            after Coder PASS, still walk Cleaner → Hardener → QA (do not skip)
any GATE BLOCKED (missing tool, unsupported language, open product blocker) → blocked
spin detected on a stage → restoreGreen → optional diagnostic spawn → blocked
```

**QA failure routing** is an **Implementation adaptation** of the role split (QA must not own product-code fixes; **Uncle Bob** UB-10-21 plus lock table).

### Retry

Per-stage `retryBudget` (default 2 extra spawns). First attempt + budget = max tries. Gate FAIL on Specifier/Coder/Cleaner/Hardener → re-spawn **that** stage with the gate JSON in the new child’s prompt. Child context is always fresh.

Do not retry `independent-rerun`; a fail there is `blocked` (tamper or flake). Human hawk.

### A→B→C spin stop

**Uncle Bob** UB-07-04: change A, break B, repair B, break C, spin.

**Implementation adaptation:** after each GATE, look at the last `spinWindow` records for the **current stage**. Detect spin when:

1. at least 3 FAIL attempts at this stage, and
2. fingerprints are not monotonically new work (cycle: two or more fingerprints appear interleaved, e.g. `h1,h2,h1` or `h1,h2,h3,h1`), **or** the same fingerprint repeats twice (no progress).

On detection: `restoreGreen`, then if `diagnosticOnSpin` spawn one read-mostly diagnostic child (prompt: “do not edit; report why the last gate failed and which module is the ball of mud”), then `halt blocked` with the diagnostic report path. Never keep feeding the same Context (**Uncle Bob** UB-10-05; lock).

### Last green

After a stage GATE PASS, if `snapshotOnPass`:

- `copy-tree` (v1 default): copy `src/`, `tests/`, `package.json`, lockfile, `architecture.rules.json` into `<artifactRoot>/story-<id>/green/<stage>/`.
- `git-commit`: `git add -A && git commit -m "uncle-bob: story <id> <stage> pass"` in session cwd. Fail closed if git is missing or the commit fails (do not pretend a snapshot exists). Requires a git user identity.

Restore uses `git reset --hard <sha>` or copy-back. Only the director restores; children never `git reset`.

### Park parent

Ralph parks by occupying the parent’s tool call. `/story` is a command: **no parent model turn** (`dsh-commands`: handlers never submit to the model). Headless *does* open a turn for the task positional.

Use `agent/pre-step` (waterfall; must call `next()` when not intercepting):

| Situation | Decision | Why |
|---|---|---|
| This agent has an active story, and this is **not** the capturing first-message turn | `{ kind: 'reject' }` | Closes a claimed prompt turn with `turn/end.reason = { kind: 'blocked' }`, no `user/message`, no model call (`agent-loop` interception tests). |
| Headless / first-user-message capture: first claim of a session, `startOnFirstUserMessage`, no active story | **Hold the waterfall** (do not call `next` until the FSM halt), run the entire pipeline, then: PASS → `{ kind: 'enter', messages: [] }`; BLOCKED/ABORT → `{ kind: 'reject' }` | Empty first `enter` completes the turn with `{ kind: 'completed' }` and **no model call**. Headless `whenIdle` then exits `0` on PASS and `1` on reject (`packages/bundle/headless/src/index.ts` uses `reason.kind === 'completed'`). Parent is not idle while pre-step is held, so headless does not exit early. |
| `/story` or tool path | Park via reject of any later parent step; FSM runs in the command/tool handler (awaited). | Command plane has no model turn. |
| No active story, not a first-message capture | `return next()` | Ordinary chat (if any). |

**Do not** inject a parent “summarize this pipeline” prompt. That would make the parent a director-adjacent LLM. Authoritative output is `REPORT.md` plus `command/done` text (web) plus headless exit code.

Claimed first-message text is **not** appended as `user/message` when we rewrite empty or reject (`agent-loop`: append happens only after a non-empty enter). Persist the story in `story.md` under the artifact root **before** children run. Child prompts include that path and the story text; those `user/message` events live on **child** sessions (model-visible ⟺ logged).

One writer: `Director` holds a map `sessionId → StoryState`. A second `/story` or first-message while `status === 'running'` returns an error / BLOCKED without spawning. No `parallel()` writers on one worktree (**Twitter** 2026-08-21; lock).

---

## 6. Subagent spawn: provider, structured report, prompts

### Provider

Name: Config `subagentProvider` default `'spawn'` (`dsh-subagent-spawn-in-process`, `inheritsParentContext: false`, `outputSchema: true`).

At each start, copy Ralph’s `requireFreshProvider`:

- provider exists;
- `provider.capabilities.outputSchema`;
- `!provider.inheritsParentContext`.

Otherwise halt `blocked` with that evidence (fail closed).

### Start request

```ts
const run = await ctx.subagents.start(providerName, {
  label: stageLabel(stage),          // "Specifier" | "Coder" | ...
  parent: agent,
  signal,
  prompt: [{ type: 'text', text: buildPrompt(stage, ctx) }],
  outputSchema: STAGE_REPORT_SCHEMA,
  toolFilter: { deny: config.childToolDeny },
  persona: PERSONA[stage],
})
try {
  const result = await run.result
  const report = readStageReport(result.structured, config.maxHandoffChars)
  // GATE still runs even if report.status === 'complete'
} finally {
  await run.dispose()
}
```

`label` is what the existing web subagent catalog shows. One-shot: destroy after handoff (**Uncle Bob** UB-10-05/06). Do **not** use `startContinuable`.

If `result.stopReason !== 'completed'` or `structured` is missing/malformed: treat as GATE FAIL (retry or blocked), do not ask the model what happened.

### Structured report schema (child)

Director does **not** treat `status` as PASS. PASS is the host gate.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["status", "summary", "artifactsWritten", "evidence", "blocker"],
  "properties": {
    "status": { "type": "string", "enum": ["complete", "failed", "blocked"] },
    "summary": { "type": "string" },
    "artifactsWritten": { "type": "array", "items": { "type": "string" } },
    "evidence": { "type": "array", "items": { "type": "string" } },
    "blocker": { "type": "string" }
  }
}
```

Validation (Ralph-style): non-empty trimmed `summary`; arrays of non-empty trimmed strings; `blocker` empty unless `blocked`. Serialized length ≤ `maxHandoffChars`. Invalid → stage FAIL.

### Prompt templates (actual text)

Keep each persona under a few dozen lines. Skills are optional (`skill({ name })`). Do not encode CRAP formula, coverage math, or architecture graphs in prose — those are host tools.

Shared footer appended to every user prompt:

```
Workspace cwd is the session working directory. Artifacts for this story:
  {artifactDir}
Read existing files there before writing. Do not call subagent, ralph, workflow, or uncle_bob_story.
When finished, call structured_output exactly once. The host will re-run gates; your status is not PASS.
```

#### Specifier persona

```
You are a Specifier for one User Story. You do not write product code or unit tests.

Convert the story into:
1. Gherkin Given-When-Then in acceptance.feature
2. Black-box QA steps in qa.md

If a product choice is missing (boundaries, errors, equality), do not invent it.
Write blockers.md with the exact competing examples and leave status blocked.

Forbidden: implementing src/, weakening the story into a multi-story plan, or claiming the code already works.
```

#### Specifier user prompt

```
User Story:
{storyText}

Write:
  {artifactDir}/acceptance.feature
  {artifactDir}/qa.md
  {artifactDir}/blockers.md   (empty file if none)

Gherkin must parse. Each scenario needs a concrete Then. Tag scenarios with @story_{storyId}.
qa.md: one numbered case per scenario with setup, action, observation, teardown against the public API (not private functions).
```

#### Coder persona

```
You are a Coder for one User Story. Make unit tests and Gherkin acceptance pass.

Write a failing test first, then production code. If you finish a whole function and then test it, that is acceptable; the host does not police keystrokes.

Messy structure is expected. Do not claim CRAP, mutation, or QA. Do not start the next story.

Public surface is defined by the Gherkin. Do not silently change accepted behavior.
```

#### Coder user prompt

```
Story: {storyText}
Acceptance: {artifactDir}/acceptance.feature
Last gate report (if any): {artifactDir}/gates/latest.json

Implement the public API the Gherkin describes. Put unit tests under tests/.
Run `{unitCommand}` and `{acceptanceCommand}` yourself if you can; the host will re-run them.
```

#### Cleaner persona

```
You are a Cleaner. Preserve behavior. Reduce CRAP. Repair illegal dependencies by inversion or Interface extraction, not by deleting the rule.

Do not change product behavior to make scores pretty. Do not weaken coverage filters, ignore files, or architecture rules.
```

#### Cleaner user prompt

```
CRAP formula (host, not you): CRAP(cc, cov) = cc^2 * (1-cov)^3 + cc with cov in 0..1.
A function fails when score > {crapCap}.
Architecture rules: {cwd}/{architectureRulesPath}
Last CRAP/architecture/test reports: {artifactDir}/gates/

Refactor until the host CRAP, architecture, and test gates pass. Behavior must stay green.
```

#### Hardener persona

```
You are a Hardener. Kill surviving mutants by strengthening tests (and fixing real defects).

Mutation is a test-gap tool, not a design tool. Do not delete tests and mutate from scratch.
Do not stop while unexplained survivors remain. Equivalent mutants require a committed waiver file the host reads; you cannot approve your own waiver.
```

#### Hardener user prompt

```
Mutation command the host will run: {mutationCommand}
Waiver file (committed, host-owned): {cwd}/{mutationWaiverPath}
Last mutation report: {artifactDir}/gates/mutation.json

Strengthen tests until the host mutation gate reports no unexplained survivors.
```

#### QA persona

```
You are a QA Agent. Turn qa.md into deterministic tests against the public interface.

You must not patch product code under src/ or equivalent. If behavior is wrong, report failed and leave the product tree unchanged.

Black-box only: import the public entry, not private modules.
```

#### QA user prompt

```
QA steps: {artifactDir}/qa.md
Acceptance: {artifactDir}/acceptance.feature
Write executable tests under tests/qa/ that the host will run with: {qaCommand}
Also write {artifactDir}/qa-report.md describing cases. Do not modify src/.
```

#### Diagnostic persona (spin only)

```
You are a diagnostic worker. Do not edit files. Read the last gate JSON and the current tree.
Report: what oscillated, which module is tangled, and the smallest next human decision.
```

---

## 7. Artifact contract

Root: `{cwd}/{artifactRoot}/story-{storyId}/`

`storyId`: `s` + first 12 hex chars of SHA-256(`storyText` + `sessionId` + `startTime`). Collision → fail closed (do not reuse a dirty directory).

| Path | Writer | Reader |
|---|---|---|
| `story.md` | director at START | every child prompt |
| `acceptance.feature` | Specifier | Coder, gates, QA |
| `qa.md` | Specifier | QA, gates |
| `blockers.md` | Specifier | Specifier gate (non-empty open blockers → BLOCKED) |
| `gates/<stage>-<attempt>.json` | director after each host gate | retries, human, independent rerun |
| `gates/latest.json` | director (copy of last) | next child prompt |
| `gates/independent-rerun.json` | director | halt |
| `REPORT.md` | director at halt | human, headless |
| `green/` | director snapshots | restore |
| `qa-report.md` | QA child | QA gate (must exist) |
| product `src/`, `tests/` | Coder/Cleaner/Hardener | all later gates |
| `tests/qa/` | QA only | QA gate |

Specifier and QA writing product `src/` is a **gate FAIL** (diff against last green / against the pre-stage snapshot). **Implementation adaptation** of the role table.

### Example Gherkin (`acceptance.feature`)

```gherkin
Feature: FizzBuzz
  @story_s1a2b3c4d5e6
  Scenario: multiples of 15 are FizzBuzz
    Given an integer 15
    When fizzBuzz is evaluated
    Then the result is "FizzBuzz"
  Scenario: a plain number
    Given an integer 1
    When fizzBuzz is evaluated
    Then the result is "1"
```

### Example `qa.md`

```
# QA cases
1. setup: none. action: call fizzBuzz(1). observation: "1". teardown: none.
2. action: fizzBuzz(3) => "Fizz"
3. action: fizzBuzz(5) => "Buzz"
4. action: fizzBuzz(15) => "FizzBuzz"
5. action: fizzBuzz(100) => "Buzz"
Public interface: exported fizzBuzz(n: number): string from src/index.ts.
Do not import other modules.
```

### Example gate report JSON (host-owned)

```json
{
  "schemaVersion": 1,
  "gate": "crap",
  "stage": "cleaner",
  "attempt": 1,
  "cwd": "/path/to/fixtures/fizzbuzz",
  "candidate": {
    "gitHead": "abc123",
    "dirty": true,
    "worktreeFingerprint": "sha256:…"
  },
  "command": ["node", "lib/crap-runner.js"],
  "startedUtc": "2026-08-24T12:00:00.000Z",
  "endedUtc": "2026-08-24T12:00:01.200Z",
  "exitCode": 1,
  "verdict": "FAIL",
  "reason": "function src/index.ts:fizzBuzz CRAP 12.4 > cap 8",
  "adaptation": "CRAP formula and cap are Implementation adaptations, not Uncle Bob quotes",
  "functions": [
    {
      "id": "src/index.ts:fizzBuzz:3",
      "cc": 6,
      "coverage": 0.4,
      "crap": 12.4,
      "cap": 8,
      "pass": false
    }
  ],
  "artifacts": ["gates/cleaner-1.json"]
}
```

Every gate JSON uses this envelope (`gate`, `verdict`, `reason`, `exitCode`, `candidate`, `command`). Child-specific fields hang off the same object. `verdict` is only `PASS` | `FAIL` | `BLOCKED`.

---

## 8. Gate runners

All gates execute against **session workspace cwd**: `agent.session.header.cwd ?? process.cwd()`. Never the harness checkout, never `artifactRoot` as cwd unless the command is a reporter.

Missing `ctx.subprocess`, missing argv[0] executable, timeout, or unreadable report → `BLOCKED` (fail closed). Never ask a model for coverage, CC, mutation score, or architecture (**Twitter** 2026-08-06).

### Language detection (v1 TypeScript-only)

```ts
export function detectLanguage(cwd: string): 'typescript' | 'unsupported' {
  // tsconfig.json exists AND package.json exists → typescript
  // otherwise unsupported
}
```

`unsupported` → story `blocked` with reason `v1 TypeScript-only`. Documented extension point:

```ts
export interface LanguageAdapter {
  readonly id: string
  detect(cwd: string): boolean
  crap(input: CrapInput): Promise<GateReport>
  mutationCommandDefault: string[]
  unitCommandDefault: string[]
}
```

v1 ships only the TypeScript adapter. Do not auto-install language tools globally; use the workspace’s `npx` / lockfile.

### Specifier gate (`gherkin-parse`)

1. `acceptance.feature` and `qa.md` exist and are non-empty.
2. Parse with `@cucumber/gherkin` `generateMessages`. Parser errors → FAIL.
3. At least one `Scenario` / `Scenario Outline`.
4. `blockers.md` if non-empty after trim → BLOCKED (unresolved product policy).
5. Worktree diff vs last green: no modifications under `src/` (Specifier must not implement). **Implementation adaptation.**

### Coder gate (`unit-acceptance`)

1. Run `unitCommand` via `ctx.subprocess` (collect stdout/stderr, `gateTimeoutMs`).
2. Run `acceptanceCommand`.
3. Both exit 0 → PASS. Nonzero → FAIL with captured tail. Missing cucumber/vitest → BLOCKED.

### Cleaner gates (after child)

1. Re-run unit + acceptance (behavior preserved).
2. **CRAP** (in-process TypeScript):
   - Coverage: run unit command with V8 coverage (`NODE_V8_COVERAGE` temp dir, or `npx vitest run --coverage` if the fixture enables `v8`). Parse Istanbul JSON. Per-function coverage = hit executable ranges / executable ranges overlapping the function.
   - Complexity: TypeScript compiler API (workspace `typescript` if present, else bundled `typescript` devDependency of this plugin). Cyclomatic complexity for a function: `1 +` count of `if`, `?:`, `&&`/`||` in conditions, `case`, loops, `catch`, `??`. **Implementation adaptation** of “cyclomatic complexity.”
   - Join by `relativePath:name:startLine`. Missing coverage for an executable function → treat `cov = 0` (fail closed), do not invent 100%.
   - Formula (**Implementation adaptation**, lock):
     `CRAP(cc, cov) = cc² * (1 - cov)³ + cc` with `cov ∈ [0,1]`.
     Fail a function when `score > crapCap` (default 8). Equality passes.
3. **Architecture:** load `{cwd}/{architectureRulesPath}`. Walk `import`/`export from` in `src/**/*.ts`. Map file → module by `pattern`. An edge not in the source module’s `mayDependOn` (and not `externalAllow`) is FAIL. Cycles fail if `forbidCycles: true`. Missing rules file → BLOCKED.

Example `architecture.rules.json` (fixture):

```json
{
  "modules": [
    { "name": "public", "pattern": "src/index.ts", "mayDependOn": ["impl"] },
    { "name": "impl", "pattern": "src/**/*.ts", "mayDependOn": [] }
  ],
  "externalAllow": ["node:"],
  "forbidCycles": true
}
```

No architecture-viewer GUI in v1 (**Uncle Bob** had a viewer; lock defers it). Checker is the gate (**Uncle Bob** UB-11-14).

### Hardener gate (`mutation`)

1. Baseline unit+acceptance must already be green (driver does this by construction).
2. Run `mutationCommand`. Parse Stryker `reports/mutation/mutation.json` (or Config-discovered path). Missing report → BLOCKED.
3. Count `survived`. Load waiver file: `{ mutantId, reason, adaptation: true }[]`. Unknown survivors → FAIL. Waived survivors → PASS only as **ADAPTED**; `REPORT.md` must say so. Target remains kill-all (**Uncle Bob** UB-10-17–19). Waivers are an **Implementation adaptation**.
4. Tamper: mutation `mutate`/`ignorePatterns` vs snapshot taken at story START (see independent rerun). Weakening → FAIL.

### QA gate

1. `tests/qa/` exists.
2. Diff vs pre-QA snapshot: no changes under `src/`. Any product edit → FAIL (route to Coder).
3. QA files may import only the public entry listed in `qa.md` (default `src/index.ts`). Other product imports → FAIL.
4. Run `qaCommand`. Exit 0 → PASS.

For fizzbuzz, “UI” is the public function. That is an **Implementation adaptation** of **Uncle Bob** UB-10-21 (system UI or interface).

### Independent rerun + anti-tamper

After QA PASS, the director (not a child) re-runs **unit, acceptance, CRAP, architecture, mutation, QA** on the same cwd without spawning agents.

Protected surfaces fingerprinted at START, after last child, and after independent rerun:

| Surface | Files |
|---|---|
| ignore | `.gitignore`, `.ignore` |
| coverage | `vitest.config.ts`, `nyc.config`, `coverage/` exclude in package.json |
| mutation | `stryker.config.json` / `stryker.config.mjs` |
| architecture | `architecture.rules.json` |
| tests | `vitest.config.ts`, cucumber profiles |

A fingerprint change that **adds** ignore of `src/`, **adds** mutation exclude, **widens** architecture `mayDependOn` to `["*"]`, or **drops** test files is FAIL (`POST_RUN_TAMPERING`). **Implementation adaptation** of “trust the tools, own constraints” (not a named interview role).

---

## 9. Session events / UI

### Do not add custom `SessionEventMap` types in v1

DSH `KNOWN_SESSION_EVENT_TYPES` is generated from the harness repo. `Session.append` has **no** `ignorable: true` writer API yet (Agent Note `2026-08-10-session-log-version-mechanism.md`: “writers do not yet set ignorable … Session.append gains that surface with its first user”). An out-of-tree event type is required-on-read by default; first-party resume **refuses** the log.

v1 therefore persists FSM + gates in **workspace artifacts**. Existing durable events already cover the web UX:

| Event | Who | What the human sees |
|---|---|---|
| `command/run` + `command/done` | `/story` | Command card with the story text and the final `REPORT.md` excerpt |
| `subagent/start` + `subagent/end` | each child | Header lineage / descendant dropdown (`dsh-client-ui-subagent`) with labels Specifier, Coder, … |
| Child `user/message` | spawn prompt | Opening the child transcript |
| Child `tool/call` `structured_output` | child | Final structured report in the child log |
| Headless `turn/start`+`turn/end` | park | Empty parent transcript; exit code 0/1 |

No new Client package. No conversation node. Trajectory already shows child tool calls if the user opens the child.

`command/done.text` (web) is the director’s `REPORT.md` (truncated to ~8k). `recordInput: true` so the story text is in `command/run.args`.

### Model-visible ⟺ logged

- Child prompts: `user/message` on the child session via `subagents.start`.
- Gate JSON is **not** injected into the parent model (parent is parked).
- Retry child prompts include previous gate JSON as text in the new child’s `user/message`.
- Do not `agent.inject()` parent context for the pipeline.

---

## 10. Skills

Optional loaders, not the control plane. Register a badge-style provider (`dsh-skill-badge` pattern) from the director plugin:

```ts
ctx.skills.registerProvider(() => ({
  name: 'uncle-bob-bundled',
  list: () => Promise.resolve(CANDIDATES),
  get: async (candidate) => ({ ...candidate, content: await readFile(locator, 'utf8') }),
}))
```

Each candidate: `source: 'bundled'`, `rank: BUNDLED_SKILL_RANK` (600), `invocation: { modelInvocable: true, userInvocable: false }` (workers load via `skill` tool; humans use `/story`).

Do **not** copy the 50-page capability-skill-collection files. Reuse their operational essence in ≤40 lines each:

| Bundled name | From collection | Body (essence only) |
|---|---|---|
| `gherkin-acceptance` | `uncle-bob-gherkin-acceptance` | One story; Given-When-Then; no invented policy; write `acceptance.feature` + `qa.md`; blockers stay blocked. |
| `coder-tdd` | `uncle-bob-ai-era-tdd` | Failing test then code; host does not police keystrokes; keep quality values. |
| `crap-cleanup` | `uncle-bob-crap-analysis` | Host computes CRAP; refactor high scores without changing behavior; do not game excludes. |
| `architecture-deps` | `uncle-bob-architecture-guardrails` | Honor `architecture.rules.json`; invert dependencies; do not delete rules. |
| `mutation-gaps` | `uncle-bob-mutation-testing` | Kill survivors with stronger tests; no self-approved waivers. |
| `black-box-qa` | `uncle-bob-system-qa` | Public interface only; never patch `src/`. |

Omit apprenticeship, quality-harness Python contract, deep-modules essay, workflow routing table. Those are not v1 control.

Do **not** patch `skill-filesystem` `bundledSkillDir` (would require restating that whole row). A dedicated provider avoids fighting user skill dirs; project skills still win on rank.

---

## 11. Entry points: `/story`, headless user-message, tool — same FSM

```ts
async function startStory(ctx: Context, agent: Agent, storyText: string, signal: AbortSignal, source: 'command' | 'first-message' | 'tool'): Promise<Halt>
```

All three call this. One writer lock inside.

### `/story` (web)

```ts
commandCtx.commands.register({
  name: 'story',
  description: 'Run the Uncle Bob assembly line for one User Story',
  input: { hint: '<user story text>' },
  recordInput: true,
  async handler({ agent, rawInput, signal }) {
    const story = rawInput.trim()
    if (story.length === 0) return { kind: 'error', text: 'Usage: /story <user story>' }
    const halt = await director.start(agent, story, signal, 'command')
    return halt.status === 'passed'
      ? { kind: 'success', text: halt.reportText }
      : { kind: 'error', text: halt.reportText }
  },
})
```

No `agent.steer`. Children show in lineage while the handler awaits (other sessions). Composer park: `agent/pre-step` reject while running.

### Headless / first user message

`startOnFirstUserMessage` (default true): on the first `agent/pre-step` of a session that still has no story, extract text from claimed messages, hold the waterfall, `director.start(..., 'first-message')`, then empty-enter or reject (§5).

Headless stdout stays empty (no parent assistant message). Document `cat .uncle-bob/story-*/REPORT.md` and the exit code. Optionally write one stderr line `uncle-bob: passed story-…` / `uncle-bob: blocked …` so a human sees a pulse without forging `assistant/message`.

### Tool `uncle_bob_story`

`defineTool` name `uncle_bob_story`, `generic` card, `rawInput: args.story`. Description: use only when the human already asked for the Uncle Bob pipeline or `/story` is unavailable. `execute` requires `exec.agent`, calls the same `director.start`. Output: `{ status, storyId, reportPath, report }`.

If a story is already running on that agent: error, do not nest.

Park still applies: while the tool call occupies a parent step, the FSM is inside `execute` (like Ralph). Also keep the pre-step reject so a steer cannot start a second parent step.

---

## 12. Fixture demo (`fixtures/fizzbuzz`)

Tiny TypeScript workspace. Human cwd:

```
fixtures/fizzbuzz/
  package.json              # name fizzbuzz, vitest, cucumber, typescript, stryker
  tsconfig.json
  vitest.config.ts          # coverage v8, include src + tests
  cucumber.js               # paths: .uncle-bob/story-*/acceptance.feature + tests/acceptance
  stryker.config.json       # mutate src/**/*.ts, test runner vitest
  architecture.rules.json   # public vs impl as in §8
  src/index.ts              # export function fizzBuzz(_n: number): string { throw new Error('not implemented') }
  tests/.gitkeep
  tests/qa/.gitkeep
  README.md                 # the story text to paste
```

Story the human types (lock):

> Implement FizzBuzz for n=1..100. Multiples of 3 → Fizz, 5 → Buzz, both → FizzBuzz, else the number. Public function `fizzBuzz(n: number): string`.

Acceptance step defs live in `tests/acceptance/steps.ts` **after Coder writes them**; the fixture may ship empty step skeletons so cucumber is wired, or Coder creates them. Prefer shipping a failing skeleton that imports `fizzBuzz` so the acceptance command exists before the first Coder:

```ts
// tests/acceptance/steps.ts — fixture ships this; Coder may extend
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { fizzBuzz } from '../../src/index.ts'
let n = 0, result = ''
Given('an integer {int}', (value: number) => { n = value })
When('fizzBuzz is evaluated', () => { result = fizzBuzz(n) })
Then('the result is {string}', (expected: string) => { assert.equal(result, expected) })
```

That is fixture scaffolding, not the Coder. Specifier still writes the `.feature` under `.uncle-bob/`. Cucumber `paths` must include the artifact glob; document that in fixture `cucumber.js`:

```js
export default { paths: ['.uncle-bob/**/*.feature'], import: ['tests/acceptance/**/*.ts'] }
```

If cucumber cannot glob artifacts until they exist, the Coder gate copies `acceptance.feature` to `tests/acceptance/acceptance.feature` **as a host step** before running `acceptanceCommand` (director-owned copy; not a child). Prefer that copy: deterministic path, still authored by Specifier.

---

## 13. Testing plan

Out-of-tree: **do not** claim DSH per-file 100% coverage. Use vitest here.

| Layer | What | Pass / fail / tamper |
|---|---|---|
| `tests/fsm.spec.ts` | reducer: START→specifier, PASS advances, FAIL retries until budget, QA FAIL routes to coder then cleaner, spin restore+halt, abort | table-driven |
| `tests/spawn-schema.spec.ts` | `readStageReport` rejects extra keys, empty summary, oversized JSON | malformed fixtures |
| `tests/park.spec.ts` | with `dsh-agent-loop-testkit` if reachable; else mock waterfall: active story rejects; first-message hold then empty enter on PASS | — |
| `tests/language.spec.ts` | tsconfig+package.json → typescript; empty dir → unsupported | — |
| `tests/gates/gherkin-parse.spec.ts` | `fixtures/gates/gherkin-pass` parses; `gherkin-fail` (broken keyword) FAIL; missing file BLOCKED | yes |
| `tests/gates/crap.spec.ts` | known `(cc, cov)` tuples; function with cc=6 cov=0 exceeds 8; cov=1 with cc=9 is 9>8 FAIL; cc=2 cov=1 is 2 PASS | yes |
| `tests/gates/architecture.spec.ts` | pass fixture (legal import); fail fixture (impl imports public); missing rules BLOCKED | yes |
| `tests/gates/mutation.spec.ts` | parse Stryker JSON all-killed PASS; one survivor FAIL; survivor id in waiver ADAPTED PASS | yes |
| `tests/gates/tamper.spec.ts` | start fingerprint vs mutated `stryker.config.json` exclude-all → FAIL | yes |
| `tests/gates/qa-diff.spec.ts` | QA touching `src/` FAIL; tests/qa only PASS | yes |
| `tests/loader-compose.spec.ts` | `applyEntryPatches` from `@deepseek-ai/cordis-plugin-include`: empty list + parsed `cordis.patch.yml` yields row `id: uncle-bob-director` `name: uncle-bob-harness` | compose-only, no LLM |
| `tests/plugin-apply.spec.ts` | mock ctx: `apply` registers command `story`, tool `uncle_bob_story`, skill provider; missing spawn provider at start() throws | — |

Do **not** require live `DEEPSEEK_API_KEY` for these. Full pipeline is the human’s verification after story 12, plus optional later snapshot if the orchestrator asks.

Gate unit tests must not network. CRAP tests feed synthetic coverage/complexity maps, not a full vitest run. One optional integration test may run crap against `fixtures/gates/crap-fail` if it stays keyless.

---

## 14. Install and run commands

DSH `@deepseek-ai/dsh-*` stay in-box. `dsh plugin add` for an **unknown** profile name initializes **only** `@deepseek-ai/dsh-base` (`DEFAULT_PROFILE_BUNDLES`). Web and headless templates are named `web` and `headless`. Copy a template, then add this bundle.

From a **built** harness checkout (`pnpm run build` if `lib/` is required for the launcher you use):

```sh
# 0. Harness home
# Default: ~/.dsh   override: DSH_HOME

# 1. Web profile (human watches children)
pnpm dsh --profile web --dump-config >/dev/null
cp -R "${DSH_HOME:-$HOME/.dsh}/profiles/web" "${DSH_HOME:-$HOME/.dsh}/profiles/uncle-bob"
# optional: set "name": "dsh-profile-uncle-bob" in that profile package.json
pnpm dsh plugin --profile uncle-bob add /Users/lkc/Code/uncle-bob-harness
pnpm dsh --profile uncle-bob --dump-config | head   # expect "# == uncle-bob-harness"

# If pnpm ≥10 blocks prepare:
#   add to ~/.dsh/profiles/uncle-bob/pnpm-workspace.yaml
#     allowBuilds:
#       uncle-bob-harness: true
#   then re-run the add.

# 2. Run web, open the workspace at the fixture
cd /Users/lkc/Code/uncle-bob-harness/fixtures/fizzbuzz
pnpm install   # fixture deps: vitest, cucumber, typescript, stryker
# from harness checkout:
pnpm dsh --profile uncle-bob
# In the web composer:
# /story Implement FizzBuzz for n=1..100. Multiples of 3 → Fizz, 5 → Buzz, both → FizzBuzz, else the number. Public function fizzBuzz(n: number): string.
```

Headless repeat:

```sh
pnpm dsh --profile headless --dump-config >/dev/null
cp -R "${DSH_HOME:-$HOME/.dsh}/profiles/headless" "${DSH_HOME:-$HOME/.dsh}/profiles/uncle-bob-headless"
pnpm dsh plugin --profile uncle-bob-headless add /Users/lkc/Code/uncle-bob-harness

cd /Users/lkc/Code/uncle-bob-harness/fixtures/fizzbuzz
pnpm dsh --profile uncle-bob-headless "Implement FizzBuzz for n=1..100. Multiples of 3 → Fizz, 5 → Buzz, both → FizzBuzz, else the number. Public function fizzBuzz(n: number): string."
echo $?    # 0 passed, 1 blocked
cat .uncle-bob/story-*/REPORT.md
```

Needs `DEEPSEEK_API_KEY` (and optional `DEEPSEEK_BASE_URL`) in the environment or harness-home `.env`, same as other real-API dsh runs.

Wrong: `pnpm dsh plugin --profile uncle-bob add …` **without** copying the web template first — that profile is base-only (no browser, no `/story` UI).

---

## 15. Key Decisions

| Decision | Rationale | Adaptation vs Bob |
|---|---|---|
| TypeScript FSM director in the plugin | **Twitter** 2026-08-06 executable FSM; lock: not a parent LLM; workflow JS has no host-gate hook | **Twitter** refinement of interview tools |
| Fresh `spawn` per stage, `inheritsParentContext: false`, dispose after handoff | **Uncle Bob** UB-10-05/06 | Direct |
| Handoff by artifacts + structured report, not chat | **Twitter** 2026-08-21 no honking; **Uncle Bob** short-lived workers | Direct |
| Host re-runs gates; child self-report is not PASS | **Uncle Bob** UB-09-04/05; **Twitter** 2026-08-06 never ask the agent to calculate quality | Direct |
| CRAP `cc²*(1-cov)³+cc`, fail when `> 8` | Interview omits formula; lock chose this and inclusive-at-8 via `>` | **Implementation adaptation**. Do not call it “Bob’s formula.” Human &lt;4 not shipped (**Twitter** Wumpus). Interview “considering 8” vs March campaign “below 8”: lock picked this operator. |
| Mutation: StrykerJS, kill-all, waivers labeled | **Uncle Bob** UB-10-17–19; tool limits unlabeled in interview | Waiver file = **Implementation adaptation**. Mutation improves tests not design (**Twitter** Wumpus). |
| Architecture checker, no viewer GUI | **Uncle Bob** UB-11-11–14 checker is the gate; viewer deferred by lock | Direct checker; viewer omission is v1 cut |
| TDD: ask failing-test-first; do not fail if they test after a function | **Twitter** 2026-08-12 vs **Uncle Bob** UB-13-10–15 | **Implementation adaptation** named in lock |
| One writer worktree | **Twitter** 2026-08-21 assembly line worked, parallel writers did not | Direct Twitter; interview inferred ordered stages |
| QA cannot edit `src/`; fail routes to Coder | Role split; lock table | **Implementation adaptation** |
| Independent rerun + anti-tamper | Not in 242 items; operationalizes UB-06-56/60 | **Implementation adaptation** |
| No custom session events | DSH `append` cannot mark `ignorable`; unknown types refuse resume | Engineering constraint, not Bob |
| Empty-enter / reject for headless exit code | Headless prints last parent assistant message and exits on `turn/end.reason` | Engineering constraint |
| Copy web/headless profile templates before `plugin add` | Unknown profile names get `dsh-base` only | DSH profile API |
| Tiny prompts + short bundled skills | **Uncle Bob** UB-08 Lost in the Middle | Direct |
| v1 TypeScript-only gates | Demo fixture; extension point `LanguageAdapter` | **Implementation adaptation** |
| `snapshotMode: copy-tree` default | Restore last green without requiring git identity in the demo workspace | **Implementation adaptation**. `git-commit` remains Config. |
| No five presets | Lock; parent must not orchestrate | Direct |
| Approach A not workflow script | Scripts cannot exec host tools | DSH API |

---

## 16. Implementation stories for Subagent D

Build incrementally. The **human** only verifies the full fizzbuzz pipeline at the end. Each story is independently testable with keyless vitest unless noted.

### Story 1 — Loadable bundle + director starts Specifier

**Done when:**

- `package.json` + `cordis.patch.yml` + `src/index.ts` `apply()` register command `/story` and (if enabled) tool `uncle_bob_story`.
- `tests/loader-compose.spec.ts` passes: patch insert is visible on an empty entry list.
- Pure FSM: `START` → command `{ spawn: 'specifier' }`.
- `director.start` with a **fake** `SubagentProvider` (in-process stub, `inheritsParentContext: false`, `outputSchema: true`) receives one start with `label: 'Specifier'` and the Specifier prompt containing the story text.
- Second concurrent start on the same agent is rejected.
- `pnpm dsh plugin --profile uncle-bob add` onto a copied web profile dumps a layer `# == uncle-bob-harness` (`--dump-config`).

**Not in this story:** real gates, later stages, fizzbuzz green.

### Story 2 — Specifier artifacts + Gherkin parse gate

Host gate on fixtures `gherkin-pass` / `gherkin-fail` / missing files. After stub Specifier writes files, director runs the parse gate and records `gates/specifier-1.json`. Open `blockers.md` → BLOCKED. Specifier `src/` diff → FAIL.

### Story 3 — Park parent + retry budget

`agent/pre-step` reject while running. First-message hold then empty enter on PASS / reject on BLOCKED (unit test with loop testkit or a stub Agent). Specifier FAIL retries until `retryBudget`, then halt blocked. Gate JSON is included in the retry prompt.

### Story 4 — Coder stage + unit/acceptance gates

FSM advances Specifier PASS → Coder spawn. Unit/acceptance subprocess helpers with stub commands (`['node', '-e', 'process.exit(0)']` in tests). Real argv used in fixture later.

### Story 5 — Cleaner + CRAP + architecture

Implement formula + TS complexity walker + Istanbul join on synthetic maps. Architecture pass/fail fixtures. Cleaner child stub. Behavior tests re-run before CRAP.

### Story 6 — Hardener + mutation JSON + waivers

Parse Stryker report fixtures. Waiver path labeled adaptation. Unknown survivor FAIL.

### Story 7 — QA + product-diff + route to Coder

QA touching `src/` FAIL → FSM event routes to Coder, then Cleaner → Hardener → QA again. QA-only `tests/qa` + public import rule.

### Story 8 — Independent rerun + anti-tamper

After QA PASS, re-run all host gates. Tamper fixture (coverage exclude of `src`) FAIL. `REPORT.md` written.

### Story 9 — A→B→C spin + last green

Cycling fingerprints halt, restore snapshot. `git-commit` and `copy-tree` modes unit-tested with a temp dir git repo.

### Story 10 — Headless first-user-message wiring

`startOnFirstUserMessage` path uses the same `director.start`. Documented stderr pulse. No parent model director.

### Story 11 — Bundled short skills + child tool deny

Skill provider lists six SKILL.md files. Spawn `toolFilter.deny` includes `uncle_bob_story` and `subagent`. Children can still `skill`.

### Story 12 — Fixture fizzbuzz + README

Ship `fixtures/fizzbuzz` as in §12. README copies §14 commands. **Human** runs web `/story` and headless task, watches five children and five gate reports. D does not need a live key for stories 1–11.

---

## 17. Open questions

Only DSH API facts that remain after reading the code. Product locks are closed.

1. **`Session.append` has no `ignorable` writer.** Out-of-tree event types refuse resume on first-party loaders. v1 workaround: no custom `SessionEventMap`; artifacts + existing command/subagent events (§9). If DSH later adds `append(type, data, { ignorable: true })`, a follow-up story may add `uncle-bob/story-progress` without a Client package.

2. **Headless prints the last parent `assistant/message` and ignores our artifacts.** Workaround: empty-enter/reject for exit code; `REPORT.md` + stderr pulse (§5, §11). There is no supported way for an out-of-tree plugin to set headless stdout without a parent model turn or forging `assistant/message`.

3. **Unknown profile names do not stack `dsh-web-app`.** Workaround: copy the `web` / `headless` template directories, then `plugin add` (§14). No CLI verb “create profile from template X” exists beyond `PROFILE_TEMPLATES` keys `web` and `headless`.

No other DSH API needed for v1 is missing: `ctx.subagents.start`, structured output, `toolFilter`, `commands.register`, `agent/pre-step` reject/enter, `ctx.subprocess.spawn`, `ctx.skills.registerProvider`, bundle `dsh.bundle.patch` are all present and used as specified.
