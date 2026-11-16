# uncle-bob-harness

English | [简体中文](./README.zh-CN.md)

An out-of-tree plugin bundle for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) that turns a single User Story into an assembly-line pipeline orchestrated by a TypeScript finite state machine (`uncle-bob-director`).

Instead of relying on a parent LLM to remember multi-step instructions, the director runs **Specifier → Coder → Cleaner → Hardener → QA** as isolated, short-lived `spawn` sub-sessions (`inheritsParentContext: false`), runs deterministic host gates after every stage, and owns every `PASS` / `FAIL` / `BLOCKED` verdict.

## How It Works

### DeepSeek Harness Integration

In DSH, capabilities and startup profiles are composed from Cordis plugins and layered YAML patches. This repository packages `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` in [`package.json`](./package.json) and inserts the `uncle-bob-director` plugin ([`src/index.ts`](./src/index.ts)) onto an existing `web` or `headless` profile via [`cordis.patch.yml`](./cordis.patch.yml).

While a story is running, the director parks the parent agent loop on `agent/pre-step` ([`src/park.ts`](./src/park.ts)) so the parent model cannot interfere or advance early.

### Entry Points

All three entry points invoke the same TypeScript FSM ([`src/director.ts`](./src/director.ts), [`src/fsm.ts`](./src/fsm.ts)):

| Entry | Trigger | Behavior |
|---|---|---|
| `/story <text>` | Web / command registry ([`src/entry-command.ts`](./src/entry-command.ts)) | Starts the FSM directly with no parent model turn |
| First user message | `startOnFirstUserMessage: true` ([`src/park.ts`](./src/park.ts)) | Captures the first non-empty user message (headless mode) and halts with exit code `0` (`passed`) or `1` (`blocked`) |
| `uncle_bob_story` tool | `enableStoryTool: true` ([`src/entry-tool.ts`](./src/entry-tool.ts)) | Allows a parent model to delegate a story into the same FSM |

### Assembly-Line Stages & Host Gates

Every child stage writes workspace/artifact outputs and returns a validated `STAGE_REPORT_SCHEMA` JSON object ([`src/schema.ts`](./src/schema.ts)), which the host treats as **evidence only—never as `PASS`**. After each child settles and is disposed, the host runs deterministic gates ([`src/gates/index.ts`](./src/gates/index.ts)):

| Stage | Child Responsibility | Host Gate(s) | On Failure |
|---|---|---|---|
| **1. Specifier** | Writes `acceptance.feature`, `qa.md`, and `blockers.md` under `<artifactRoot>/story-<id>/` | `gherkin-parse`: validates files, parses Gherkin via `@cucumber/gherkin`, fails closed (`BLOCKED`) if `blockers.md` is non-empty, fails if `src/` changed | Re-spawns Specifier (up to `retryBudget`) |
| **2. Coder** | Implements public API under `src/` and unit tests under `tests/` | `unit-acceptance`: runs `unitCommand` (`npx vitest run`) and `acceptanceCommand` (`npx cucumber-js --fail-fast`) | Re-spawns Coder |
| **3. Cleaner** | Refactors structure while preserving behavior | `unit-acceptance` + `crap` (`CRAP(cc, cov) <= crapCap`, default `8`) + `architecture` (`architecture.rules.json` dependency & cycle check) | Re-spawns Cleaner |
| **4. Hardener** | Strengthens tests to kill surviving mutants | `mutation`: runs `mutationCommand` (`npx stryker run`), parses `reports/mutation/mutation.json`, validates against committed waivers captured at story start | Re-spawns Hardener |
| **5. QA** | Writes black-box tests in `tests/qa/` and `qa-report.md` against the public entry | `qa`: verifies `src/` is untouched, checks `tests/qa/` imports only the public entry, runs `qaCommand` (`npx vitest run tests/qa`) | Routes back to **Coder** (QA never patches `src/`) |
| **6. Independent Rerun** | Host-only final verification | `independent-rerun` + `tamper`: re-runs all gates (`unit-acceptance`, `crap`, `architecture`, `mutation`, `qa`) and checks protected files and pre-existing `tests/` for tampering | Halts `blocked` |

Additional safeguards:
- **Last-green snapshots**: Snapshots the workspace after each `PASS` (`copy-tree` into `.uncle-bob/story-<id>/green/` by default, or `git-commit` via `snapshotMode`).
- **Spin detection & diagnostic**: `detectSpin` watches for repeated failure fingerprints within `spinWindow` (default `4`), restores the last-green snapshot, optionally spawns a read-only `diagnostic` worker (`diagnosticOnSpin: true`), and halts `blocked`.
- **Anti-tamper checks** ([`src/gates/tamper.ts`](./src/gates/tamper.ts)): Detects post-start modifications that weaken `.gitignore`/`.ignore`, Vitest/package coverage excludes, Stryker ignores, `architecture.rules.json`, mutation waivers, or dropped test files.
- **Bundled capability skills** ([`src/skills-provider.ts`](./src/skills-provider.ts), `assets/skills/`): Registers six short worker skills (`gherkin-acceptance`, `coder-tdd`, `crap-cleanup`, `architecture-deps`, `mutation-gaps`, `black-box-qa`).
- **v1 scope**: TypeScript workspaces only (detected via presence of both `tsconfig.json` and `package.json`).

## Prerequisites

- **Node.js**: `^22.19 || >=24`
- **pnpm**
- A built local checkout of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`pnpm run build` if required by your launcher)
- `DEEPSEEK_API_KEY` (and optional `DEEPSEEK_BASE_URL`) exported in the environment or configured in `${DSH_HOME:-$HOME/.dsh}/.env`

## Install and Run

DSH in-box packages (`@deepseek-ai/dsh-*`) are bundled inside the harness checkout. Running `dsh plugin add` against an unknown profile name initializes only `@deepseek-ai/dsh-base`, so you must **copy an existing `web` or `headless` profile template first**, then add this bundle.

### 1. Web Profile (Interactive `/story` Watch Mode)

Run from your built `deepseek-harness` checkout:

```sh
# Default harness home is ~/.dsh (override with DSH_HOME)
pnpm dsh --profile web --dump-config >/dev/null
cp -R "${DSH_HOME:-$HOME/.dsh}/profiles/web" "${DSH_HOME:-$HOME/.dsh}/profiles/uncle-bob"

# Optional: set "name": "dsh-profile-uncle-bob" in that profile's package.json
pnpm dsh plugin --profile uncle-bob add /path/to/uncle-bob-harness
pnpm dsh --profile uncle-bob --dump-config | head   # Expect "# == uncle-bob-harness"
```

> **If pnpm ≥ 10 blocks the `prepare` build script**: add the following to `~/.dsh/profiles/uncle-bob/pnpm-workspace.yaml` and re-run `pnpm dsh plugin --profile uncle-bob add ...`:
>
> ```yaml
> allowBuilds:
>   uncle-bob-harness: true
> ```

Install dependencies in the included [`fixtures/fizzbuzz`](./fixtures/fizzbuzz/README.md) workspace and launch the web UI:

```sh
cd /path/to/uncle-bob-harness/fixtures/fizzbuzz
pnpm install   # installs vitest, cucumber, typescript, stryker

# Launch from your deepseek-harness checkout with cwd set to fixtures/fizzbuzz
pnpm dsh --profile uncle-bob
```

In the web composer, submit a story via `/story`:

```text
/story Implement FizzBuzz for n=1..100. Multiples of 3 → Fizz, 5 → Buzz, both → FizzBuzz, else the number. Public function fizzBuzz(n: number): string.
```

### 2. Headless Profile (CI / Repeatable Runs)

```sh
pnpm dsh --profile headless --dump-config >/dev/null
cp -R "${DSH_HOME:-$HOME/.dsh}/profiles/headless" "${DSH_HOME:-$HOME/.dsh}/profiles/uncle-bob-headless"
pnpm dsh plugin --profile uncle-bob-headless add /path/to/uncle-bob-harness

cd /path/to/uncle-bob-harness/fixtures/fizzbuzz
pnpm install
pnpm dsh --profile uncle-bob-headless "Implement FizzBuzz for n=1..100. Multiples of 3 → Fizz, 5 → Buzz, both → FizzBuzz, else the number. Public function fizzBuzz(n: number): string."
echo $?    # 0 passed, 1 blocked
cat .uncle-bob/story-*/REPORT.md
```

In headless mode, `stdout` remains empty (there is no parent assistant reply); `stderr` prints `uncle-bob: passed story-…` or `uncle-bob: blocked …`, and the full gate trail is written to `.uncle-bob/story-<id>/REPORT.md`.

> **Important**: Never run `pnpm dsh plugin --profile uncle-bob add …` without copying the `web` or `headless` profile template first—a fresh profile contains only `dsh-base` (no web UI and no `/story` support).

## Configuration

Default layer settings live in [`cordis.patch.yml`](./cordis.patch.yml), validated by Schemastery in [`src/config.ts`](./src/config.ts):

| Option | Default | Description |
|---|---|---|
| `subagentProvider` | `'spawn'` | Fresh subagent provider (`inheritsParentContext` must be `false`) |
| `artifactRoot` | `'.uncle-bob'` | Directory under workspace `cwd` for `story-<id>/` artifacts |
| `crapCap` | `8` | Maximum allowed `CRAP(cc, cov)` score per function (inclusive pass) |
| `retryBudget` | `2` | Max re-spawns per stage after a gate `FAIL` |
| `spinWindow` | `4` | Recent same-stage attempts inspected for A→B→C cycling |
| `snapshotMode` | `'copy-tree'` | Last-green snapshot mechanism (`'copy-tree'` or `'git-commit'`) |
| `startOnFirstUserMessage` | `true` | Auto-start FSM on first user message (for headless execution) |
| `enableStoryTool` | `true` | Register the model-facing `uncle_bob_story` tool |
| `gateTimeoutMs` | `600000` | Per-gate subprocess timeout in milliseconds |

## Develop This Bundle

If `deepseek-harness` is checked out at `../deepseek-harness`, `pnpm install` runs [`scripts/link-dsh.mjs`](./scripts/link-dsh.mjs) via `postinstall` to symlink `@deepseek-ai/*` workspace packages into `node_modules/` so TypeScript and Vitest resolve them locally without `workspace:*`.

```sh
pnpm install
pnpm test
pnpm run build
```

## Repository Map

- [`cordis.patch.yml`](./cordis.patch.yml) — Bundle patch inserting `uncle-bob-director`
- [`src/`](./src/index.ts) — Director, pure FSM reducer ([`src/fsm.ts`](./src/fsm.ts)), config, prompts, spawn wrapper, git snapshots, and host gates ([`src/gates/index.ts`](./src/gates/index.ts))
- [`assets/skills/`](./assets/skills/gherkin-acceptance/SKILL.md) — Six short capability skills registered via `ctx.skills`
- [`fixtures/fizzbuzz/`](./fixtures/fizzbuzz/README.md) — Sample TypeScript workspace with `vitest`, `cucumber`, `stryker`, and `architecture.rules.json`
- [`fixtures/gates/`](./fixtures/gates/architecture-pass/architecture.rules.json) — Deterministic pass/fail fixtures for gate unit tests
- [`tests/`](./tests/fsm.spec.ts) — Vitest unit and gate suites
- [`docs/design.md`](./docs/design.md) — Full v1 technical design specification
- [`research/`](./research/operating-principles.md) — Operating principles lock and source interviews/notes
