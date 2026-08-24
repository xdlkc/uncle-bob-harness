import { describe, expect, it } from 'vitest'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import { createPreStepHandler, extractStoryText } from '../src/park.ts'
import type { ParkHalt, StoryRunner } from '../src/park.ts'
import { mockAgent } from './helpers.ts'

function message(text: string): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } as UserMessage
}

class FakeRunner implements StoryRunner {
  running = false
  started = false
  halt: ParkHalt = { status: 'passed', storyId: 's1', reason: 'ok' }
  starts: string[] = []
  hold?: Promise<void>

  isRunning(): boolean {
    return this.running
  }

  hasStarted(): boolean {
    return this.started
  }

  async start(_agent: never, storyText: string): Promise<ParkHalt> {
    this.starts.push(storyText)
    this.running = true
    this.started = true
    if (this.hold !== undefined) await this.hold
    this.running = false
    return this.halt
  }
}

describe('park parent', () => {
  it('extracts story text from claimed messages', () => {
    expect(extractStoryText([message('hello'), message('world')])).toBe('hello\nworld')
  })

  it('rejects while a story is running', async () => {
    const runner = new FakeRunner()
    runner.running = true
    runner.started = true
    const handler = createPreStepHandler(runner, resolveConfig({ startOnFirstUserMessage: true }))
    const next = async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] })
    const decision = await handler({
      agent: mockAgent('/tmp'),
      messages: [message('later')],
      signal: new AbortController().signal,
    }, next)
    expect(decision).toEqual({ kind: 'reject' })
    expect(runner.starts).toEqual([])
  })

  it('first-message hold then empty enter on PASS', async () => {
    const runner = new FakeRunner()
    runner.halt = { status: 'passed', storyId: 'sabc', reason: 'ok' }
    const handler = createPreStepHandler(runner, resolveConfig({ startOnFirstUserMessage: true }))
    let nextCalled = 0
    const decision = await handler({
      agent: mockAgent('/tmp', 'headless-1'),
      messages: [message('Implement FizzBuzz')],
      signal: new AbortController().signal,
    }, async () => {
      nextCalled += 1
      return { kind: 'enter', messages: [] }
    })
    expect(nextCalled).toBe(0)
    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(runner.starts).toEqual(['Implement FizzBuzz'])
  })

  it('first-message reject on BLOCKED', async () => {
    const runner = new FakeRunner()
    runner.halt = { status: 'blocked', storyId: 'sabc', reason: 'nope' }
    const handler = createPreStepHandler(runner, resolveConfig({}))
    const decision = await handler({
      agent: mockAgent('/tmp'),
      messages: [message('Implement FizzBuzz')],
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))
    expect(decision).toEqual({ kind: 'reject' })
  })

  it('calls next when startOnFirstUserMessage is false and no story runs', async () => {
    const runner = new FakeRunner()
    const handler = createPreStepHandler(runner, resolveConfig({ startOnFirstUserMessage: false }))
    const decision = await handler({
      agent: mockAgent('/tmp'),
      messages: [message('chat')],
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))
    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(runner.starts).toEqual([])
  })

  it('does not capture subagent children', async () => {
    const runner = new FakeRunner()
    const handler = createPreStepHandler(runner, resolveConfig({}))
    const agent = mockAgent('/tmp', 'child')
    ;(agent.session.header as { origin?: string; parentSession?: string }).origin = 'subagent'
    ;(agent.session.header as { parentSession?: string }).parentSession = 'parent'
    const decision = await handler({
      agent,
      messages: [message('child prompt')],
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))
    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(runner.starts).toEqual([])
  })
})
