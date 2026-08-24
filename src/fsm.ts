/**
 * Pure story FSM. I/O stays in the director driver.
 * @module uncle-bob-harness/fsm
 */

import { assertNever } from './util.ts'

/** Pipeline stage, including host-only independent-rerun and spin diagnostic. */
export type Stage =
  | 'specifier'
  | 'coder'
  | 'cleaner'
  | 'hardener'
  | 'qa'
  | 'independent-rerun'
  | 'diagnostic'

/** Host-owned gate verdict. Child structured `status` is never this. */
export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED'

/** One completed spawn+gate (or child-settled failure) record. */
export interface AttemptRecord {
  stage: Stage
  attempt: number
  verdict: Verdict
  /** Stable hash of gate JSON + worktree fingerprint (paths+contents of src/ and tests/). */
  fingerprint: string
}

/** Mutable story progress owned by the reducer. */
export interface StoryState {
  storyId: string
  storyText: string
  stage: Stage
  attempt: number
  retriesUsed: Partial<Record<Stage, number>>
  lastGreenId?: string
  history: AttemptRecord[]
  status: 'running' | 'passed' | 'blocked'
  blockReason?: string
}

/** Inputs the driver feeds the reducer. */
export type FsmEvent =
  | { type: 'START'; storyId: string; storyText: string }
  | { type: 'CHILD_SETTLED'; stage: Stage; childStatus: 'complete' | 'blocked' | 'failed' | 'missing-structured' }
  | { type: 'GATE'; stage: Stage; verdict: Verdict; fingerprint: string; reason: string }
  | { type: 'ABORT'; reason: string }

/** Side effects the driver must perform. */
export type FsmCommand =
  | { type: 'spawn'; stage: Exclude<Stage, 'independent-rerun'> }
  | { type: 'runGate'; stage: Stage }
  | { type: 'snapshotGreen' }
  | { type: 'restoreGreen' }
  | { type: 'halt'; status: 'passed' | 'blocked'; reason: string }

/** Retry and spin knobs the reducer reads. */
export interface FsmConfig {
  retryBudget: number
  spinWindow: number
  diagnosticOnSpin: boolean
}

/** Reducer output: next state plus driver commands. */
export interface ReduceResult {
  state: StoryState
  commands: FsmCommand[]
}

const PIPELINE: readonly Stage[] = [
  'specifier',
  'coder',
  'cleaner',
  'hardener',
  'qa',
  'independent-rerun',
]

/**
 * Empty pre-START state.
 * @returns a running placeholder with no story.
 */
export function initialState(): StoryState {
  return {
    storyId: '',
    storyText: '',
    stage: 'specifier',
    attempt: 0,
    retriesUsed: {},
    history: [],
    status: 'running',
  }
}

function cloneState(state: StoryState): StoryState {
  return {
    ...state,
    retriesUsed: { ...state.retriesUsed },
    history: [...state.history],
  }
}

function nextStage(stage: Stage): Stage | undefined {
  const index = PIPELINE.indexOf(stage)
  if (index < 0 || index === PIPELINE.length - 1) return undefined
  return PIPELINE[index + 1]
}

/**
 * Detect A→B→C spin on the current stage.
 * Implementation adaptation of Uncle Bob UB-07-04.
 * @param history - full attempt history.
 * @param stage - stage under inspection.
 * @param spinWindow - max same-stage records inspected.
 * @returns true when fingerprints cycle or stall.
 */
export function detectSpin(history: readonly AttemptRecord[], stage: Stage, spinWindow: number): boolean {
  const stageRecords = history.filter(record => record.stage === stage)
  const window = stageRecords.slice(-spinWindow)
  const fails = window.filter(record => record.verdict === 'FAIL')
  if (fails.length < 3) return false
  const fingerprints = fails.map(record => record.fingerprint)
  return new Set(fingerprints).size < fingerprints.length
}

function halt(state: StoryState, status: 'passed' | 'blocked', reason: string): ReduceResult {
  const next = cloneState(state)
  next.status = status
  next.blockReason = status === 'blocked' ? reason : undefined
  return {
    state: next,
    commands: [{ type: 'halt', status, reason }],
  }
}

function spawnStage(state: StoryState, stage: Exclude<Stage, 'independent-rerun'>, attempt: number): ReduceResult {
  const next = cloneState(state)
  next.stage = stage
  next.attempt = attempt
  next.status = 'running'
  return {
    state: next,
    commands: [{ type: 'spawn', stage }],
  }
}

function onPass(state: StoryState, stage: Stage, fingerprint: string, reason: string): ReduceResult {
  const next = cloneState(state)
  next.history.push({
    stage,
    attempt: state.attempt,
    verdict: 'PASS',
    fingerprint,
  })
  if (stage === 'independent-rerun') {
    next.status = 'passed'
    return {
      state: next,
      commands: [{ type: 'snapshotGreen' }, { type: 'halt', status: 'passed', reason }],
    }
  }
  const following = nextStage(stage)
  if (following === undefined) {
    return halt(next, 'blocked', `no successor for stage ${stage}`)
  }
  if (following === 'independent-rerun') {
    next.stage = 'independent-rerun'
    next.attempt = 1
    return {
      state: next,
      commands: [{ type: 'snapshotGreen' }, { type: 'runGate', stage: 'independent-rerun' }],
    }
  }
  next.stage = following
  next.attempt = 1
  return {
    state: next,
    commands: [{ type: 'snapshotGreen' }, { type: 'spawn', stage: following }],
  }
}

function retryOrBlock(
  state: StoryState,
  stage: Stage,
  fingerprint: string,
  reason: string,
  config: FsmConfig,
  routeToCoder: boolean,
): ReduceResult {
  const next = cloneState(state)
  next.history.push({
    stage,
    attempt: state.attempt,
    verdict: 'FAIL',
    fingerprint,
  })
  if (detectSpin(next.history, stage, config.spinWindow)) {
    next.blockReason = `spin detected on ${stage}: ${reason}`
    if (config.diagnosticOnSpin) {
      next.stage = 'diagnostic'
      next.attempt = 1
      return {
        state: next,
        commands: [{ type: 'restoreGreen' }, { type: 'spawn', stage: 'diagnostic' }],
      }
    }
    next.status = 'blocked'
    return {
      state: next,
      commands: [
        { type: 'restoreGreen' },
        { type: 'halt', status: 'blocked', reason: next.blockReason },
      ],
    }
  }
  const used = next.retriesUsed[stage] ?? 0
  if (used >= config.retryBudget) {
    return halt(next, 'blocked', `retry budget exhausted on ${stage}: ${reason}`)
  }
  next.retriesUsed[stage] = used + 1
  if (routeToCoder) {
    // Implementation adaptation: QA must not own product-code fixes.
    next.stage = 'coder'
    next.attempt = 1
    return {
      state: next,
      commands: [{ type: 'spawn', stage: 'coder' }],
    }
  }
  next.stage = stage
  next.attempt = state.attempt + 1
  if (stage === 'independent-rerun' || stage === 'diagnostic') {
    return halt(next, 'blocked', reason)
  }
  return {
    state: next,
    commands: [{ type: 'spawn', stage }],
  }
}

/**
 * Advance the story FSM.
 * @param state - previous state.
 * @param event - driver event.
 * @param config - retry/spin knobs.
 * @returns next state and driver commands.
 */
export function reduce(state: StoryState, event: FsmEvent, config: FsmConfig): ReduceResult {
  if (state.status !== 'running' && event.type !== 'START') {
    return { state, commands: [] }
  }
  switch (event.type) {
    case 'START': {
      const next = cloneState(initialState())
      next.storyId = event.storyId
      next.storyText = event.storyText
      next.stage = 'specifier'
      next.attempt = 1
      return {
        state: next,
        commands: [{ type: 'spawn', stage: 'specifier' }],
      }
    }
    case 'CHILD_SETTLED': {
      if (event.stage === 'diagnostic') {
        return halt(state, 'blocked', state.blockReason ?? 'spin diagnostic complete')
      }
      // Host gate always runs. Child structured status is evidence, never PASS.
      return {
        state: cloneState(state),
        commands: [{ type: 'runGate', stage: event.stage }],
      }
    }
    case 'GATE': {
      switch (event.verdict) {
        case 'PASS':
          return onPass(state, event.stage, event.fingerprint, event.reason)
        case 'BLOCKED':
          return halt(state, 'blocked', event.reason)
        case 'FAIL':
          if (event.stage === 'independent-rerun') {
            const next = cloneState(state)
            next.history.push({
              stage: event.stage,
              attempt: state.attempt,
              verdict: 'FAIL',
              fingerprint: event.fingerprint,
            })
            return halt(next, 'blocked', event.reason)
          }
          return retryOrBlock(
            state,
            event.stage,
            event.fingerprint,
            event.reason,
            config,
            event.stage === 'qa',
          )
        default:
          return assertNever(event.verdict)
      }
    }
    case 'ABORT':
      return halt(state, 'blocked', event.reason)
    default:
      return assertNever(event)
  }
}
