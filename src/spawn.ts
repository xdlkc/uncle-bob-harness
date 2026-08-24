/**
 * Fresh spawn of one stage child plus structured-report validation.
 * @module uncle-bob-harness/spawn
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentProvider, SubagentResult, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { Config } from './config.ts'
import type { Stage } from './fsm.ts'
import { STAGE_REPORT_SCHEMA, readStageReport, type StageReport } from './schema.ts'
import { buildPrompt, personaFor, promptContextFrom, stageLabel } from './prompts.ts'

/** Outcome of one spawn, including malformed structured output. */
export interface SpawnOutcome {
  childStatus: 'complete' | 'blocked' | 'failed' | 'missing-structured'
  report?: StageReport
  error?: string
  stopReason?: string
}

/**
 * Require a genuinely fresh structured-output provider (Ralph's requireFreshProvider).
 * @param ctx - cordis context with ctx.subagents.
 * @param name - configured provider name.
 * @returns the provider.
 */
export function requireFreshProvider(ctx: Context, name: string): SubagentProvider {
  const provider = ctx.subagents.getProvider(name)
  if (provider === undefined) {
    throw new Error(`Uncle Bob subagent provider "${name}" is not registered`)
  }
  if (!provider.capabilities.outputSchema) {
    throw new Error(`Uncle Bob subagent provider "${name}" does not support structured output`)
  }
  if (provider.inheritsParentContext) {
    throw new Error(`Uncle Bob subagent provider "${name}" inherits parent context; a fresh provider is required`)
  }
  return provider
}

function childStatusFromResult(result: SubagentResult, report: StageReport | { error: string } | undefined): SpawnOutcome['childStatus'] {
  if (result.stopReason !== 'completed') {
    switch (result.stopReason) {
      case 'aborted':
        return 'failed'
      case 'error':
      case 'max-tokens':
      case 'refusal':
        return 'failed'
      default:
        return 'failed'
    }
  }
  if (report === undefined || 'error' in report) return 'missing-structured'
  if (report.status === 'blocked') return 'blocked'
  if (report.status === 'failed') return 'failed'
  return 'complete'
}

/**
 * Start one fresh child, await its result, always dispose.
 * Host gates still run even if report.status === 'complete'.
 * @param args - spawn inputs.
 * @returns structured-report outcome.
 */
export async function spawnStage(args: {
  ctx: Context
  config: Config
  agent: Agent
  signal: AbortSignal
  stage: Exclude<Stage, 'independent-rerun'>
  storyText: string
  storyId: string
  artifactDir: string
  cwd: string
  lastGateJson: string
}): Promise<SpawnOutcome> {
  requireFreshProvider(args.ctx, args.config.subagentProvider)
  const promptCtx = promptContextFrom({
    storyText: args.storyText,
    storyId: args.storyId,
    artifactDir: args.artifactDir,
    cwd: args.cwd,
    config: args.config,
    lastGateJson: args.lastGateJson,
  })
  const request: SubagentStartRequest = {
    label: stageLabel(args.stage),
    parent: args.agent,
    signal: args.signal,
    prompt: [{ type: 'text', text: buildPrompt(args.stage, promptCtx) }],
    outputSchema: STAGE_REPORT_SCHEMA,
    toolFilter: { deny: args.config.childToolDeny },
    persona: personaFor(args.stage),
  }
  const run = await args.ctx.subagents.start(args.config.subagentProvider, request)
  try {
    const result = await run.result
    if (result.structured === undefined) {
      return {
        childStatus: result.stopReason === 'completed' ? 'missing-structured' : 'failed',
        error: 'child returned no structured report',
        stopReason: result.stopReason,
      }
    }
    const report = readStageReport(result.structured, args.config.maxHandoffChars)
    if ('error' in report) {
      return {
        childStatus: 'missing-structured',
        error: report.error,
        stopReason: result.stopReason,
      }
    }
    return {
      childStatus: childStatusFromResult(result, report),
      report,
      stopReason: result.stopReason,
    }
  } finally {
    await run.dispose()
  }
}
