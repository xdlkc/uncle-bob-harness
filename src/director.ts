/**
 * I/O driver: spawn, gates, artifacts, last-green, one-writer lock.
 * The parent model is not the director.
 * @module uncle-bob-harness/director
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createHash } from 'node:crypto'
import type { Config } from './config.ts'
import {
  artifactLayout,
  createArtifactDir,
  makeStoryId,
  readLatestGate,
  writeGateReport,
  writeReport,
  writeStoryMarkdown,
  type ArtifactLayout,
} from './artifacts.ts'
import { reduce, type FsmCommand, type FsmConfig, type Stage, type StoryState } from './fsm.ts'
import { restoreGreen, snapshotGreen, srcFileMap, testsFileMap, worktreeFingerprint } from './git.ts'
import { runGate, captureProtectedSurfaces, type GateInput, type ProtectedSurfaces } from './gates/index.ts'
import { detectLanguage } from './language.ts'
import { requireFreshProvider, spawnStage } from './spawn.ts'
import { assertNever } from './util.ts'

/** How a story entered the FSM. */
export type StorySource = 'command' | 'first-message' | 'tool'

/** Terminal result of one story. */
export interface Halt {
  status: 'passed' | 'blocked'
  storyId: string
  reportText: string
  reportPath: string
  reason: string
}

const REPORT_TRUNCATE = 8_000

function sessionKey(agent: Agent): string {
  return String(agent.id)
}

function workspaceCwd(agent: Agent): string {
  return agent.session.header.cwd ?? process.cwd()
}

function gateFingerprint(report: { verdict: string; reason: string }, worktree: string): string {
  return createHash('sha256')
    .update(report.verdict)
    .update('\0')
    .update(report.reason)
    .update('\0')
    .update(worktree)
    .digest('hex')
}

function renderReport(state: StoryState, reason: string, gates: string[]): string {
  const lines = [
    `# Uncle Bob story ${state.storyId}`,
    '',
    `Status: ${state.status}`,
    `Reason: ${reason}`,
    '',
    '## Story',
    '',
    state.storyText,
    '',
    '## Attempts',
    '',
  ]
  for (const record of state.history) {
    lines.push(`- ${record.stage}#${record.attempt}: ${record.verdict}`)
  }
  if (gates.length > 0) {
    lines.push('', '## Gate files', '')
    for (const path of gates) lines.push(`- ${path}`)
  }
  const adapted = state.history.some(record => record.stage === 'hardener' && record.verdict === 'PASS')
  if (adapted) {
    lines.push('', 'Mutation waivers, if any, are labeled ADAPTED in gate JSON (Implementation adaptation).')
  }
  return `${lines.join('\n')}\n`
}

/**
 * One-writer assembly-line director.
 */
export class Director {
  private readonly stories = new Map<string, StoryState>()
  private readonly fsmConfig: FsmConfig

  /**
   * @param ctx - cordis context (subagents, subprocess).
   * @param config - resolved deployment config.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {
    this.fsmConfig = {
      retryBudget: config.retryBudget,
      spinWindow: config.spinWindow,
      diagnosticOnSpin: config.diagnosticOnSpin,
    }
  }

  /**
   * Whether this session currently has a running story.
   * @param sessionId - agent id.
   * @returns true while status is running.
   */
  isRunning(sessionId: string): boolean {
    return this.stories.get(sessionId)?.status === 'running'
  }

  /**
   * Whether this session has ever started a story (blocks a second first-message capture).
   * @param sessionId - agent id.
   * @returns true when a story record exists.
   */
  hasStarted(sessionId: string): boolean {
    return this.stories.has(sessionId)
  }

  /**
   * Start the FSM for one user story. One writer per agent.
   * @param agent - parent agent.
   * @param storyText - user story.
   * @param signal - cancellation.
   * @param source - entry point.
   * @returns halt with REPORT.md text.
   */
  async start(agent: Agent, storyText: string, signal: AbortSignal, source: StorySource): Promise<Halt> {
    void source
    const key = sessionKey(agent)
    const existing = this.stories.get(key)
    if (existing?.status === 'running') {
      return {
        status: 'blocked',
        storyId: existing.storyId,
        reportText: 'A story is already running on this agent',
        reportPath: '',
        reason: 'A story is already running on this agent',
      }
    }

    const cwd = workspaceCwd(agent)
    const language = detectLanguage(cwd)
    if (language === 'unsupported') {
      return this.failClosed(key, '', 'v1 TypeScript-only', cwd)
    }

    try {
      requireFreshProvider(this.ctx, this.config.subagentProvider)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return this.failClosed(key, '', reason, cwd)
    }

    const storyId = makeStoryId(storyText, key, Date.now())
    const layout = artifactLayout(cwd, this.config.artifactRoot, storyId)
    try {
      await createArtifactDir(layout)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return this.failClosed(key, storyId, reason, cwd)
    }
    await writeStoryMarkdown(layout, storyText)

    const startSurfaces = await captureProtectedSurfaces(
      cwd,
      this.config.architectureRulesPath,
      this.config.mutationWaiverPath,
    )
    let srcBefore = await srcFileMap(cwd)
    const testsBefore = await testsFileMap(cwd)
    const gatePaths: string[] = []

    const started = reduce(
      { storyId: '', storyText: '', stage: 'specifier', attempt: 0, retriesUsed: {}, history: [], status: 'running' },
      { type: 'START', storyId, storyText },
      this.fsmConfig,
    )
    this.stories.set(key, started.state)
    let state = started.state
    let commands = started.commands

    const haltWith = async (status: 'passed' | 'blocked', reason: string): Promise<Halt> => {
      state = { ...state, status, blockReason: status === 'blocked' ? reason : undefined }
      this.stories.set(key, state)
      const reportText = renderReport(state, reason, gatePaths)
      await writeReport(layout, reportText)
      const truncated = reportText.length > REPORT_TRUNCATE
        ? `${reportText.slice(0, REPORT_TRUNCATE)}\n… [truncated]`
        : reportText
      return {
        status,
        storyId,
        reportText: truncated,
        reportPath: layout.report,
        reason,
      }
    }

    try {
      while (commands.length > 0) {
        if (signal.aborted) {
          return haltWith('blocked', 'aborted')
        }
        const nextCommands: FsmCommand[] = []
        for (const command of commands) {
          const produced = await this.executeCommand({
            command,
            agent,
            signal,
            cwd,
            layout,
            state,
            srcBefore,
            testsBefore,
            startSurfaces,
            gatePaths,
          })
          srcBefore = produced.srcBefore
          state = produced.state
          this.stories.set(key, state)
          if (produced.halt !== undefined) {
            return haltWith(produced.halt.status, produced.halt.reason)
          }
          nextCommands.push(...produced.commands)
        }
        commands = nextCommands
      }
      return haltWith(state.status === 'passed' ? 'passed' : 'blocked', state.blockReason ?? 'director idle')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return haltWith('blocked', reason)
    }
  }

  private failClosed(sessionId: string, storyId: string, reason: string, _cwd: string): Halt {
    this.stories.set(sessionId, {
      storyId,
      storyText: '',
      stage: 'specifier',
      attempt: 0,
      retriesUsed: {},
      history: [],
      status: 'blocked',
      blockReason: reason,
    })
    return {
      status: 'blocked',
      storyId,
      reportText: reason,
      reportPath: '',
      reason,
    }
  }

  private async executeCommand(args: {
    command: FsmCommand
    agent: Agent
    signal: AbortSignal
    cwd: string
    layout: ArtifactLayout
    state: StoryState
    srcBefore: Map<string, string>
    testsBefore: Map<string, string>
    startSurfaces: ProtectedSurfaces
    gatePaths: string[]
  }): Promise<{
    state: StoryState
    commands: FsmCommand[]
    srcBefore: Map<string, string>
    halt?: { status: 'passed' | 'blocked'; reason: string }
  }> {
    const { command, agent, signal, cwd, layout, state } = args
    switch (command.type) {
      case 'spawn': {
        const lastGateJson = await readLatestGate(layout)
        const outcome = await spawnStage({
          ctx: this.ctx,
          config: this.config,
          agent,
          signal,
          stage: command.stage,
          storyText: state.storyText,
          storyId: state.storyId,
          artifactDir: layout.root,
          cwd,
          lastGateJson,
        })
        const reduced = reduce(
          state,
          { type: 'CHILD_SETTLED', stage: command.stage, childStatus: outcome.childStatus },
          this.fsmConfig,
        )
        return { state: reduced.state, commands: reduced.commands, srcBefore: args.srcBefore }
      }
      case 'runGate': {
        const fingerprint = await worktreeFingerprint(cwd)
        const input: GateInput = {
          ctx: this.ctx,
          cwd,
          config: this.config,
          stage: command.stage,
          attempt: state.attempt,
          layout,
          signal,
          srcBefore: args.srcBefore,
          testsBefore: args.testsBefore,
          startSurfaces: args.startSurfaces,
          worktreeFingerprint: fingerprint,
        }
        const report = await runGate(command.stage, input)
        const path = await writeGateReport(layout, command.stage, state.attempt, report)
        args.gatePaths.push(path)
        const reduced = reduce(
          state,
          {
            type: 'GATE',
            stage: command.stage,
            verdict: report.verdict,
            fingerprint: gateFingerprint(report, fingerprint),
            reason: report.reason,
          },
          this.fsmConfig,
        )
        return { state: reduced.state, commands: reduced.commands, srcBefore: args.srcBefore }
      }
      case 'snapshotGreen': {
        let next = state
        if (this.config.snapshotOnPass) {
          const lastPass = [...state.history].reverse().find(record => record.verdict === 'PASS')
          const snapshotStage = lastPass?.stage ?? state.stage
          try {
            const id = await snapshotGreen({
              mode: this.config.snapshotMode,
              cwd,
              greenDir: layout.greenDir,
              stage: snapshotStage,
              storyId: state.storyId,
            })
            next = { ...state, lastGreenId: id }
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            return {
              state,
              commands: [],
              srcBefore: args.srcBefore,
              halt: { status: 'blocked', reason: `snapshot failed: ${reason}` },
            }
          }
        }
        const srcBefore = await srcFileMap(cwd)
        return { state: next, commands: [], srcBefore }
      }
      case 'restoreGreen': {
        if (state.lastGreenId === undefined) {
          return { state, commands: [], srcBefore: args.srcBefore }
        }
        await restoreGreen({
          mode: this.config.snapshotMode,
          cwd,
          greenDir: layout.greenDir,
          lastGreenId: state.lastGreenId,
        })
        return { state, commands: [], srcBefore: await srcFileMap(cwd) }
      }
      case 'halt':
        return {
          state,
          commands: [],
          srcBefore: args.srcBefore,
          halt: { status: command.status, reason: command.reason },
        }
      default:
        return assertNever(command)
    }
  }
}

/** Capture src/ before a spawn so Specifier/QA diffs have a baseline. */
export async function captureSrcBefore(cwd: string): Promise<Map<string, string>> {
  return srcFileMap(cwd)
}

/** Stage type re-export for entry modules. */
export type { Stage }
