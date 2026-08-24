/**
 * Parent-loop park: reject while a story runs; first-message hold for headless.
 * @module uncle-bob-harness/park
 */

import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { Config } from './config.ts'

/** Halt payload the first-message path needs. */
export interface ParkHalt {
  status: 'passed' | 'blocked'
  storyId: string
  reason: string
}

/** Director methods the pre-step listener uses. */
export interface StoryRunner {
  isRunning(sessionId: string): boolean
  hasStarted(sessionId: string): boolean
  start(
    agent: Agent,
    storyText: string,
    signal: AbortSignal,
    source: 'command' | 'first-message' | 'tool',
  ): Promise<ParkHalt>
}

/** agent/pre-step payload used by the director. */
export interface PreStepPayload {
  agent: Agent
  messages: UserMessage[]
  signal: AbortSignal
}

/**
 * Concatenate text blocks from claimed user messages.
 * @param messages - claimed pre-step messages.
 * @returns joined story text.
 */
export function extractStoryText(messages: readonly UserMessage[]): string {
  const parts: string[] = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
      }
    }
  }
  return parts.join('\n').trim()
}

function isSubagentChild(agent: Agent): boolean {
  const header = agent.session.header
  return header.origin === 'subagent' || header.parentSession !== undefined
}

/**
 * Build the agent/pre-step waterfall listener.
 * Must call next() when not intercepting.
 * @param director - story director.
 * @param config - resolved config.
 * @returns waterfall handler.
 */
export function createPreStepHandler(
  director: StoryRunner,
  config: Config,
): (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision> {
  return async (payload, next) => {
    const agent = payload.agent
    if (isSubagentChild(agent)) {
      return next()
    }
    const sessionId = String(agent.id)
    if (director.isRunning(sessionId)) {
      return { kind: 'reject' }
    }
    if (!config.startOnFirstUserMessage) {
      return next()
    }
    if (director.hasStarted(sessionId)) {
      return next()
    }
    const story = extractStoryText(payload.messages)
    if (story.length === 0) {
      return next()
    }
    let halt: ParkHalt
    try {
      halt = await director.start(agent, story, payload.signal, 'first-message')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      process.stderr.write(`uncle-bob: blocked ${reason}\n`)
      return { kind: 'reject' }
    }
    if (halt.status === 'passed') {
      process.stderr.write(`uncle-bob: passed story-${halt.storyId}\n`)
      return { kind: 'enter', messages: [] }
    }
    process.stderr.write(`uncle-bob: blocked story-${halt.storyId} ${halt.reason}\n`)
    return { kind: 'reject' }
  }
}
