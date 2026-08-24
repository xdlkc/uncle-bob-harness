/**
 * Role personas and per-stage user prompts. Text matches design §6.
 * @module uncle-bob-harness/prompts
 */

import type { Config } from './config.ts'
import type { Stage } from './fsm.ts'
import { assertNever } from './util.ts'

/** Placeholder values interpolated into prompt templates. */
export interface PromptContext {
  storyText: string
  storyId: string
  artifactDir: string
  cwd: string
  unitCommand: string
  acceptanceCommand: string
  mutationCommand: string
  qaCommand: string
  architectureRulesPath: string
  mutationWaiverPath: string
  crapCap: number
  lastGateJson: string
}

const SHARED_FOOTER = `Workspace cwd is the session working directory. Artifacts for this story:
  {artifactDir}
Read existing files there before writing. Do not call subagent, ralph, workflow, or uncle_bob_story.
When finished, call structured_output exactly once. The host will re-run gates; your status is not PASS.`

const PERSONA_SPECIFIER = `You are a Specifier for one User Story. You do not write product code or unit tests.

Convert the story into:
1. Gherkin Given-When-Then in acceptance.feature
2. Black-box QA steps in qa.md

If a product choice is missing (boundaries, errors, equality), do not invent it.
Write blockers.md with the exact competing examples and leave status blocked.

Forbidden: implementing src/, weakening the story into a multi-story plan, or claiming the code already works.`

const PERSONA_CODER = `You are a Coder for one User Story. Make unit tests and Gherkin acceptance pass.

Write a failing test first, then production code. If you finish a whole function and then test it, that is acceptable; the host does not police keystrokes.

Messy structure is expected. Do not claim CRAP, mutation, or QA. Do not start the next story.

Public surface is defined by the Gherkin. Do not silently change accepted behavior.`

const PERSONA_CLEANER = `You are a Cleaner. Preserve behavior. Reduce CRAP. Repair illegal dependencies by inversion or Interface extraction, not by deleting the rule.

Do not change product behavior to make scores pretty. Do not weaken coverage filters, ignore files, or architecture rules.`

const PERSONA_HARDENER = `You are a Hardener. Kill surviving mutants by strengthening tests (and fixing real defects).

Mutation is a test-gap tool, not a design tool. Do not delete tests and mutate from scratch.
Do not stop while unexplained survivors remain. Equivalent mutants require a committed waiver file the host reads; you cannot approve your own waiver.`

const PERSONA_QA = `You are a QA Agent. Turn qa.md into deterministic tests against the public interface.

You must not patch product code under src/ or equivalent. If behavior is wrong, report failed and leave the product tree unchanged.

Black-box only: import the public entry, not private modules.`

const PERSONA_DIAGNOSTIC = `You are a diagnostic worker. Do not edit files. Read the last gate JSON and the current tree.
Report: what oscillated, which module is tangled, and the smallest next human decision.`

const USER_SPECIFIER = `User Story:
{storyText}

Write:
  {artifactDir}/acceptance.feature
  {artifactDir}/qa.md
  {artifactDir}/blockers.md   (empty file if none)

Gherkin must parse. Each scenario needs a concrete Then. Tag scenarios with @story_{storyId}.
qa.md: one numbered case per scenario with setup, action, observation, teardown against the public API (not private functions).`

const USER_CODER = `Story: {storyText}
Acceptance: {artifactDir}/acceptance.feature
Last gate report (if any): {artifactDir}/gates/latest.json

Implement the public API the Gherkin describes. Put unit tests under tests/.
Run \`{unitCommand}\` and \`{acceptanceCommand}\` yourself if you can; the host will re-run them.`

const USER_CLEANER = `CRAP formula (host, not you): CRAP(cc, cov) = cc^2 * (1-cov)^3 + cc with cov in 0..1.
A function fails when score > {crapCap}.
Architecture rules: {cwd}/{architectureRulesPath}
Last CRAP/architecture/test reports: {artifactDir}/gates/

Refactor until the host CRAP, architecture, and test gates pass. Behavior must stay green.`

const USER_HARDENER = `Mutation command the host will run: {mutationCommand}
Waiver file (committed, host-owned): {cwd}/{mutationWaiverPath}
Last mutation report: {artifactDir}/gates/mutation.json

Strengthen tests until the host mutation gate reports no unexplained survivors.`

const USER_QA = `QA steps: {artifactDir}/qa.md
Acceptance: {artifactDir}/acceptance.feature
Write executable tests under tests/qa/ that the host will run with: {qaCommand}
Also write {artifactDir}/qa-report.md describing cases. Do not modify src/.`

const USER_DIAGNOSTIC = `Do not edit files.
Last gate JSON:
{lastGateJson}

Report why the last gate failed and which module is the ball of mud. Write nothing under src/ or tests/.`

/** Persona templates keyed by spawn stage. */
export const PERSONA: Record<Exclude<Stage, 'independent-rerun'>, string> = {
  specifier: PERSONA_SPECIFIER,
  coder: PERSONA_CODER,
  cleaner: PERSONA_CLEANER,
  hardener: PERSONA_HARDENER,
  qa: PERSONA_QA,
  diagnostic: PERSONA_DIAGNOSTIC,
}

function interpolate(template: string, ctx: PromptContext): string {
  return template
    .replaceAll('{storyText}', ctx.storyText)
    .replaceAll('{storyId}', ctx.storyId)
    .replaceAll('{artifactDir}', ctx.artifactDir)
    .replaceAll('{cwd}', ctx.cwd)
    .replaceAll('{unitCommand}', ctx.unitCommand)
    .replaceAll('{acceptanceCommand}', ctx.acceptanceCommand)
    .replaceAll('{mutationCommand}', ctx.mutationCommand)
    .replaceAll('{qaCommand}', ctx.qaCommand)
    .replaceAll('{architectureRulesPath}', ctx.architectureRulesPath)
    .replaceAll('{mutationWaiverPath}', ctx.mutationWaiverPath)
    .replaceAll('{crapCap}', String(ctx.crapCap))
    .replaceAll('{lastGateJson}', ctx.lastGateJson)
}

/**
 * Build the child's persona string (no `{{…}}` interpolations).
 * @param stage - spawn stage.
 * @returns persona template text.
 */
export function personaFor(stage: Exclude<Stage, 'independent-rerun'>): string {
  return PERSONA[stage]
}

/**
 * Build the child's user prompt (story/artifact instructions + shared footer).
 * @param stage - spawn stage.
 * @param ctx - interpolation values.
 * @returns prompt text.
 */
export function buildPrompt(stage: Exclude<Stage, 'independent-rerun'>, ctx: PromptContext): string {
  let body: string
  switch (stage) {
    case 'specifier':
      body = USER_SPECIFIER
      break
    case 'coder':
      body = USER_CODER
      break
    case 'cleaner':
      body = USER_CLEANER
      break
    case 'hardener':
      body = USER_HARDENER
      break
    case 'qa':
      body = USER_QA
      break
    case 'diagnostic':
      body = USER_DIAGNOSTIC
      break
    default:
      return assertNever(stage)
  }
  let prompt = `${interpolate(body, ctx)}\n\n${interpolate(SHARED_FOOTER, ctx)}`
  if (ctx.lastGateJson.trim().length > 0) {
    prompt += `\n\nLast gate report (if any):\n${ctx.lastGateJson}`
  }
  return prompt
}

/**
 * Display label for the existing web subagent catalog.
 * @param stage - spawn stage.
 * @returns capitalized role label.
 */
export function stageLabel(stage: Exclude<Stage, 'independent-rerun'>): string {
  switch (stage) {
    case 'specifier':
      return 'Specifier'
    case 'coder':
      return 'Coder'
    case 'cleaner':
      return 'Cleaner'
    case 'hardener':
      return 'Hardener'
    case 'qa':
      return 'QA'
    case 'diagnostic':
      return 'Diagnostic'
    default:
      return assertNever(stage)
  }
}

/**
 * Format a command argv for interpolation into prompts.
 * @param argv - command argv.
 * @returns space-joined string.
 */
export function formatCommand(argv: readonly string[]): string {
  return argv.join(' ')
}

/**
 * Build PromptContext from config and story fields.
 * @param args - story + config + last gate.
 * @returns interpolation context.
 */
export function promptContextFrom(args: {
  storyText: string
  storyId: string
  artifactDir: string
  cwd: string
  config: Config
  lastGateJson: string
}): PromptContext {
  return {
    storyText: args.storyText,
    storyId: args.storyId,
    artifactDir: args.artifactDir,
    cwd: args.cwd,
    unitCommand: formatCommand(args.config.unitCommand),
    acceptanceCommand: formatCommand(args.config.acceptanceCommand),
    mutationCommand: formatCommand(args.config.mutationCommand),
    qaCommand: formatCommand(args.config.qaCommand),
    architectureRulesPath: args.config.architectureRulesPath,
    mutationWaiverPath: args.config.mutationWaiverPath,
    crapCap: args.config.crapCap,
    lastGateJson: args.lastGateJson,
  }
}
