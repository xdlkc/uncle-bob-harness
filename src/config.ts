/**
 * Deployment knobs for the Uncle Bob director. Fail loud when Loader did not
 * normalize (Ralph pattern).
 * @module uncle-bob-harness/config
 */

import Schema from '@deepseek-ai/schemastery'

/** How last-green snapshots are stored. */
export type SnapshotMode = 'git-commit' | 'copy-tree'

/** Deployment-varying director configuration. */
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
  snapshotMode: SnapshotMode
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

const DEFAULT_CHILD_TOOL_DENY = [
  'subagent',
  'ralph',
  'workflow',
  'uncle_bob_story',
  'send_message',
  'interrupt',
  'list_agents',
] as const

/** Default knobs applied when Loader did not fill the config. */
export const DEFAULT_CONFIG: Config = {
  subagentProvider: 'spawn',
  artifactRoot: '.uncle-bob',
  crapCap: 8,
  retryBudget: 2,
  spinWindow: 4,
  unitCommand: ['npx', 'vitest', 'run'],
  acceptanceCommand: ['npx', 'cucumber-js', '--fail-fast'],
  mutationCommand: ['npx', 'stryker', 'run'],
  qaCommand: ['npx', 'vitest', 'run', 'tests/qa'],
  architectureRulesPath: 'architecture.rules.json',
  mutationWaiverPath: '.uncle-bob/mutation-waivers.json',
  snapshotOnPass: true,
  snapshotMode: 'copy-tree',
  startOnFirstUserMessage: true,
  gateTimeoutMs: 600_000,
  maxHandoffChars: 16_384,
  diagnosticOnSpin: true,
  childToolDeny: [...DEFAULT_CHILD_TOOL_DENY],
  enableStoryTool: true,
}

/** Schemastery configuration for the director plugin. */
export const Config: Schema<Config> = Schema.object({
  subagentProvider: Schema.string().default(DEFAULT_CONFIG.subagentProvider),
  artifactRoot: Schema.string().default(DEFAULT_CONFIG.artifactRoot),
  crapCap: Schema.number().min(1).default(DEFAULT_CONFIG.crapCap),
  retryBudget: Schema.number().step(1).min(0).default(DEFAULT_CONFIG.retryBudget),
  spinWindow: Schema.number().step(1).min(2).default(DEFAULT_CONFIG.spinWindow),
  unitCommand: Schema.array(Schema.string()).default(DEFAULT_CONFIG.unitCommand),
  acceptanceCommand: Schema.array(Schema.string()).default(DEFAULT_CONFIG.acceptanceCommand),
  mutationCommand: Schema.array(Schema.string()).default(DEFAULT_CONFIG.mutationCommand),
  qaCommand: Schema.array(Schema.string()).default(DEFAULT_CONFIG.qaCommand),
  architectureRulesPath: Schema.string().default(DEFAULT_CONFIG.architectureRulesPath),
  mutationWaiverPath: Schema.string().default(DEFAULT_CONFIG.mutationWaiverPath),
  snapshotOnPass: Schema.boolean().default(DEFAULT_CONFIG.snapshotOnPass),
  snapshotMode: Schema.union(['git-commit', 'copy-tree']).default(DEFAULT_CONFIG.snapshotMode),
  startOnFirstUserMessage: Schema.boolean().default(DEFAULT_CONFIG.startOnFirstUserMessage),
  gateTimeoutMs: Schema.number().step(1).min(1000).default(DEFAULT_CONFIG.gateTimeoutMs),
  maxHandoffChars: Schema.number().step(1).min(256).default(DEFAULT_CONFIG.maxHandoffChars),
  diagnosticOnSpin: Schema.boolean().default(DEFAULT_CONFIG.diagnosticOnSpin),
  childToolDeny: Schema.array(Schema.string()).default(DEFAULT_CONFIG.childToolDeny),
  enableStoryTool: Schema.boolean().default(DEFAULT_CONFIG.enableStoryTool),
})

function requireNonEmptyString(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${name} must be a non-empty normalized string`)
  }
  return value
}

function requireSafeInteger(name: string, value: unknown, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw new TypeError(`${name} must be a safe integer >= ${min}`)
  }
  return value
}

function requirePositiveNumber(name: string, value: unknown, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new TypeError(`${name} must be a finite number >= ${min}`)
  }
  return value
}

function requireCommand(name: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name} must be a non-empty array of non-empty strings`)
  }
  return [...value]
}

function requireStringArray(name: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0 || item !== item.trim())) {
    throw new TypeError(`${name} must be an array of non-empty normalized strings`)
  }
  return [...value]
}

function requireBoolean(name: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean`)
  }
  return value
}

function requireSnapshotMode(value: unknown): SnapshotMode {
  if (value === 'git-commit' || value === 'copy-tree') return value
  throw new TypeError('snapshotMode must be "git-commit" or "copy-tree"')
}

/**
 * Apply defaults and validate even when Loader did not normalize.
 * @param config - raw plugin config, possibly partial.
 * @returns a fully populated Config.
 */
export function resolveConfig(config: Partial<Config> | undefined): Config {
  const raw = config ?? {}
  const merged: Config = {
    subagentProvider: raw.subagentProvider ?? DEFAULT_CONFIG.subagentProvider,
    artifactRoot: raw.artifactRoot ?? DEFAULT_CONFIG.artifactRoot,
    crapCap: raw.crapCap ?? DEFAULT_CONFIG.crapCap,
    retryBudget: raw.retryBudget ?? DEFAULT_CONFIG.retryBudget,
    spinWindow: raw.spinWindow ?? DEFAULT_CONFIG.spinWindow,
    unitCommand: raw.unitCommand ?? [...DEFAULT_CONFIG.unitCommand],
    acceptanceCommand: raw.acceptanceCommand ?? [...DEFAULT_CONFIG.acceptanceCommand],
    mutationCommand: raw.mutationCommand ?? [...DEFAULT_CONFIG.mutationCommand],
    qaCommand: raw.qaCommand ?? [...DEFAULT_CONFIG.qaCommand],
    architectureRulesPath: raw.architectureRulesPath ?? DEFAULT_CONFIG.architectureRulesPath,
    mutationWaiverPath: raw.mutationWaiverPath ?? DEFAULT_CONFIG.mutationWaiverPath,
    snapshotOnPass: raw.snapshotOnPass ?? DEFAULT_CONFIG.snapshotOnPass,
    snapshotMode: raw.snapshotMode ?? DEFAULT_CONFIG.snapshotMode,
    startOnFirstUserMessage: raw.startOnFirstUserMessage ?? DEFAULT_CONFIG.startOnFirstUserMessage,
    gateTimeoutMs: raw.gateTimeoutMs ?? DEFAULT_CONFIG.gateTimeoutMs,
    maxHandoffChars: raw.maxHandoffChars ?? DEFAULT_CONFIG.maxHandoffChars,
    diagnosticOnSpin: raw.diagnosticOnSpin ?? DEFAULT_CONFIG.diagnosticOnSpin,
    childToolDeny: raw.childToolDeny ?? [...DEFAULT_CONFIG.childToolDeny],
    enableStoryTool: raw.enableStoryTool ?? DEFAULT_CONFIG.enableStoryTool,
  }
  return {
    subagentProvider: requireNonEmptyString('subagentProvider', merged.subagentProvider),
    artifactRoot: requireNonEmptyString('artifactRoot', merged.artifactRoot),
    crapCap: requirePositiveNumber('crapCap', merged.crapCap, 1),
    retryBudget: requireSafeInteger('retryBudget', merged.retryBudget, 0),
    spinWindow: requireSafeInteger('spinWindow', merged.spinWindow, 2),
    unitCommand: requireCommand('unitCommand', merged.unitCommand),
    acceptanceCommand: requireCommand('acceptanceCommand', merged.acceptanceCommand),
    mutationCommand: requireCommand('mutationCommand', merged.mutationCommand),
    qaCommand: requireCommand('qaCommand', merged.qaCommand),
    architectureRulesPath: requireNonEmptyString('architectureRulesPath', merged.architectureRulesPath),
    mutationWaiverPath: requireNonEmptyString('mutationWaiverPath', merged.mutationWaiverPath),
    snapshotOnPass: requireBoolean('snapshotOnPass', merged.snapshotOnPass),
    snapshotMode: requireSnapshotMode(merged.snapshotMode),
    startOnFirstUserMessage: requireBoolean('startOnFirstUserMessage', merged.startOnFirstUserMessage),
    gateTimeoutMs: requireSafeInteger('gateTimeoutMs', merged.gateTimeoutMs, 1000),
    maxHandoffChars: requireSafeInteger('maxHandoffChars', merged.maxHandoffChars, 256),
    diagnosticOnSpin: requireBoolean('diagnosticOnSpin', merged.diagnosticOnSpin),
    childToolDeny: requireStringArray('childToolDeny', merged.childToolDeny),
    enableStoryTool: requireBoolean('enableStoryTool', merged.enableStoryTool),
  }
}
