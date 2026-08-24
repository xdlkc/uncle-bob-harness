import { describe, expect, it } from 'vitest'
import { detectSpin, initialState, reduce, type AttemptRecord, type FsmConfig, type FsmEvent } from '../src/fsm.ts'

const config: FsmConfig = { retryBudget: 2, spinWindow: 4, diagnosticOnSpin: true }

function apply(events: FsmEvent[]) {
  let state = initialState()
  let commands = [] as ReturnType<typeof reduce>['commands']
  for (const event of events) {
    const result = reduce(state, event, config)
    state = result.state
    commands = result.commands
  }
  return { state, commands }
}

describe('fsm reducer', () => {
  it('START spawns specifier', () => {
    const { state, commands } = apply([{ type: 'START', storyId: 's1', storyText: 'do fizzbuzz' }])
    expect(commands).toEqual([{ type: 'spawn', stage: 'specifier' }])
    expect(state.stage).toBe('specifier')
    expect(state.attempt).toBe(1)
    expect(state.status).toBe('running')
  })

  it('child complete runs the host gate', () => {
    const started = apply([{ type: 'START', storyId: 's1', storyText: 'x' }])
    const { commands } = reduce(started.state, {
      type: 'CHILD_SETTLED',
      stage: 'specifier',
      childStatus: 'complete',
    }, config)
    expect(commands).toEqual([{ type: 'runGate', stage: 'specifier' }])
  })

  it('child blocked still runs the host gate', () => {
    const started = apply([{ type: 'START', storyId: 's1', storyText: 'x' }])
    const { commands } = reduce(started.state, {
      type: 'CHILD_SETTLED',
      stage: 'specifier',
      childStatus: 'blocked',
    }, config)
    expect(commands).toEqual([{ type: 'runGate', stage: 'specifier' }])
  })

  it('PASS advances specifier → coder', () => {
    let { state } = apply([{ type: 'START', storyId: 's1', storyText: 'x' }])
    const { state: next, commands } = reduce(state, {
      type: 'GATE',
      stage: 'specifier',
      verdict: 'PASS',
      fingerprint: 'h1',
      reason: 'parsed',
    }, config)
    expect(next.stage).toBe('coder')
    expect(next.attempt).toBe(1)
    expect(commands).toEqual([
      { type: 'snapshotGreen' },
      { type: 'spawn', stage: 'coder' },
    ])
  })

  it('FAIL retries until budget then blocks', () => {
    let { state } = apply([{ type: 'START', storyId: 's1', storyText: 'x' }])
    const fail = (fingerprint: string) => reduce(state, {
      type: 'GATE',
      stage: state.stage,
      verdict: 'FAIL',
      fingerprint,
      reason: 'nope',
    }, config)
    let result = fail('a')
    expect(result.commands).toEqual([{ type: 'spawn', stage: 'specifier' }])
    expect(result.state.retriesUsed.specifier).toBe(1)
    state = result.state
    result = fail('b')
    expect(result.state.retriesUsed.specifier).toBe(2)
    state = result.state
    result = fail('c')
    expect(result.commands).toEqual([{ type: 'halt', status: 'blocked', reason: 'retry budget exhausted on specifier: nope' }])
    expect(result.state.status).toBe('blocked')
  })

  it('QA FAIL routes to coder then walks cleaner → hardener → QA', () => {
    let { state } = apply([{ type: 'START', storyId: 's1', storyText: 'x' }])
    const stages = ['specifier', 'coder', 'cleaner', 'hardener', 'qa'] as const
    for (const stage of stages) {
      const passed = reduce(state, {
        type: 'GATE',
        stage,
        verdict: 'PASS',
        fingerprint: stage,
        reason: 'ok',
      }, config)
      state = passed.state
    }
    expect(state.stage).toBe('independent-rerun')
    // rewind to qa: simulate QA fail from a qa-stage state
    state = { ...state, stage: 'qa', attempt: 1, status: 'running' }
    const failed = reduce(state, {
      type: 'GATE',
      stage: 'qa',
      verdict: 'FAIL',
      fingerprint: 'qa-fail',
      reason: 'src touched',
    }, config)
    expect(failed.commands).toEqual([{ type: 'spawn', stage: 'coder' }])
    expect(failed.state.stage).toBe('coder')
    expect(failed.state.retriesUsed.qa).toBe(1)

    let next = failed.state
    for (const stage of ['coder', 'cleaner', 'hardener', 'qa'] as const) {
      const passed = reduce(next, {
        type: 'GATE',
        stage,
        verdict: 'PASS',
        fingerprint: `again-${stage}`,
        reason: 'ok',
      }, config)
      next = passed.state
    }
    expect(next.stage).toBe('independent-rerun')
  })

  it('independent-rerun FAIL blocks without retry', () => {
    const { state } = apply([{ type: 'START', storyId: 's1', storyText: 'x' }])
    const running = { ...state, stage: 'independent-rerun' as const, attempt: 1 }
    const result = reduce(running, {
      type: 'GATE',
      stage: 'independent-rerun',
      verdict: 'FAIL',
      fingerprint: 'tamper',
      reason: 'POST_RUN_TAMPERING',
    }, config)
    expect(result.state.status).toBe('blocked')
    expect(result.commands[0]).toMatchObject({ type: 'halt', status: 'blocked' })
  })

  it('GATE BLOCKED halts immediately', () => {
    const { state } = apply([{ type: 'START', storyId: 's1', storyText: 'x' }])
    const result = reduce(state, {
      type: 'GATE',
      stage: 'specifier',
      verdict: 'BLOCKED',
      fingerprint: 'x',
      reason: 'v1 TypeScript-only',
    }, config)
    expect(result.commands).toEqual([{ type: 'halt', status: 'blocked', reason: 'v1 TypeScript-only' }])
  })

  it('ABORT halts blocked', () => {
    const { state } = apply([{ type: 'START', storyId: 's1', storyText: 'x' }])
    const result = reduce(state, { type: 'ABORT', reason: 'user cancel' }, config)
    expect(result.commands).toEqual([{ type: 'halt', status: 'blocked', reason: 'user cancel' }])
  })

  it('spin on cycling fingerprints restores then spawns diagnostic', () => {
    const history: AttemptRecord[] = [
      { stage: 'cleaner', attempt: 1, verdict: 'FAIL', fingerprint: 'h1' },
      { stage: 'cleaner', attempt: 2, verdict: 'FAIL', fingerprint: 'h2' },
    ]
    const state = {
      ...initialState(),
      storyId: 's1',
      storyText: 'x',
      stage: 'cleaner' as const,
      attempt: 3,
      history,
      status: 'running' as const,
    }
    const result = reduce(state, {
      type: 'GATE',
      stage: 'cleaner',
      verdict: 'FAIL',
      fingerprint: 'h1',
      reason: 'crap',
    }, config)
    expect(result.commands).toEqual([
      { type: 'restoreGreen' },
      { type: 'spawn', stage: 'diagnostic' },
    ])
    const halted = reduce(result.state, {
      type: 'CHILD_SETTLED',
      stage: 'diagnostic',
      childStatus: 'complete',
    }, config)
    expect(halted.commands[0]).toMatchObject({ type: 'halt', status: 'blocked' })
  })

  it('spin without diagnosticOnSpin restores and halts', () => {
    const state = {
      ...initialState(),
      storyId: 's1',
      storyText: 'x',
      stage: 'coder' as const,
      attempt: 3,
      history: [
        { stage: 'coder' as const, attempt: 1, verdict: 'FAIL' as const, fingerprint: 'a' },
        { stage: 'coder' as const, attempt: 2, verdict: 'FAIL' as const, fingerprint: 'a' },
      ],
      status: 'running' as const,
    }
    const result = reduce(state, {
      type: 'GATE',
      stage: 'coder',
      verdict: 'FAIL',
      fingerprint: 'a',
      reason: 'same',
    }, { retryBudget: 5, spinWindow: 4, diagnosticOnSpin: false })
    expect(result.commands[0]).toEqual({ type: 'restoreGreen' })
    expect(result.commands[1]).toMatchObject({ type: 'halt', status: 'blocked' })
  })

  it('detectSpin requires 3 fails and a repeated fingerprint', () => {
    expect(detectSpin([
      { stage: 'coder', attempt: 1, verdict: 'FAIL', fingerprint: 'a' },
      { stage: 'coder', attempt: 2, verdict: 'FAIL', fingerprint: 'b' },
    ], 'coder', 4)).toBe(false)
    expect(detectSpin([
      { stage: 'coder', attempt: 1, verdict: 'FAIL', fingerprint: 'a' },
      { stage: 'coder', attempt: 2, verdict: 'FAIL', fingerprint: 'b' },
      { stage: 'coder', attempt: 3, verdict: 'FAIL', fingerprint: 'c' },
    ], 'coder', 4)).toBe(false)
    expect(detectSpin([
      { stage: 'coder', attempt: 1, verdict: 'FAIL', fingerprint: 'h1' },
      { stage: 'coder', attempt: 2, verdict: 'FAIL', fingerprint: 'h2' },
      { stage: 'coder', attempt: 3, verdict: 'FAIL', fingerprint: 'h1' },
    ], 'coder', 4)).toBe(true)
  })

  it('independent-rerun PASS snapshots and halts passed', () => {
    const state = {
      ...initialState(),
      storyId: 's1',
      storyText: 'x',
      stage: 'independent-rerun' as const,
      attempt: 1,
      status: 'running' as const,
    }
    const result = reduce(state, {
      type: 'GATE',
      stage: 'independent-rerun',
      verdict: 'PASS',
      fingerprint: 'ok',
      reason: 'all green',
    }, config)
    expect(result.state.status).toBe('passed')
    expect(result.commands).toEqual([
      { type: 'snapshotGreen' },
      { type: 'halt', status: 'passed', reason: 'all green' },
    ])
  })
})
