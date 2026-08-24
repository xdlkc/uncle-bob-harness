/**
 * Uncle Bob assembly-line director plugin.
 * @module uncle-bob-harness
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-tools'
import { Config, resolveConfig, type Config as ConfigShape } from './config.ts'
import { Director } from './director.ts'
import { registerStoryCommand } from './entry-command.ts'
import { registerStoryTool } from './entry-tool.ts'
import { createPreStepHandler } from './park.ts'
import { registerBundledSkills } from './skills-provider.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Park or capture the parent loop while a story runs.
     * @mode waterfall
     * @param payload - agent, claimed messages, signal.
     * @param next - remaining waterfall.
     */
    'agent/pre-step'(
      payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
      next: () => Promise<PreStepDecision>,
    ): Promise<PreStepDecision>
  }
}

export const name = 'uncle-bob-director'
export const inject = ['subagents', 'tools', 'skills', 'subprocess']

export { Config, resolveConfig }
export type { ConfigShape as UncleBobConfig }
export { Director }
export type { Halt, StorySource } from './director.ts'
export { reduce, initialState, detectSpin } from './fsm.ts'
export type { Stage, Verdict, FsmEvent, FsmCommand, StoryState, AttemptRecord, FsmConfig } from './fsm.ts'
export { readStageReport, STAGE_REPORT_SCHEMA } from './schema.ts'
export { detectLanguage } from './language.ts'
export { requireFreshProvider } from './spawn.ts'
export { createPreStepHandler, extractStoryText } from './park.ts'
export { crapScore, crapPasses, joinCrap, analyzeTsComplexity, parseIstanbulCoverage, loadCoverageFromDisk } from './gates/crap.ts'
export { runGate } from './gates/index.ts'
export { snapshotGreen, restoreGreen, worktreeFingerprint } from './git.ts'
export { bundledSkillNames } from './skills-provider.ts'
export { personaFor, buildPrompt, stageLabel } from './prompts.ts'

/**
 * Register the director, optional `/story` command, tool, skills, and park listener.
 * @param ctx - cordis context.
 * @param config - raw plugin config.
 */
export function apply(ctx: Context, config: ConfigShape): void {
  const resolved = resolveConfig(config)
  const director = new Director(ctx, resolved)
  registerBundledSkills(ctx)
  if (resolved.enableStoryTool) {
    registerStoryTool(ctx, director)
  }
  ctx.inject(['commands'], (commandCtx) => {
    registerStoryCommand(commandCtx, director)
  })
  ctx.on('agent/pre-step', createPreStepHandler(director, resolved))
}
