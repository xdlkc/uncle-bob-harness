/**
 * Structured child report schema and host-owned gate envelope.
 * @module uncle-bob-harness/schema
 */

import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { Stage, Verdict } from './fsm.ts'
import { isRecord, normalizedList, normalizedText } from './util.ts'

/** Child structured report. Host gates, not `status`, own PASS. */
export interface StageReport {
  status: 'complete' | 'failed' | 'blocked'
  summary: string
  artifactsWritten: string[]
  evidence: string[]
  blocker: string
}

/** JSON Schema requested from each spawn child. */
export const STAGE_REPORT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'artifactsWritten', 'evidence', 'blocker'],
  properties: {
    status: { type: 'string', enum: ['complete', 'failed', 'blocked'] },
    summary: { type: 'string' },
    artifactsWritten: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
  },
}

/** Worktree identity recorded on every gate JSON. */
export interface GateCandidate {
  gitHead?: string
  dirty: boolean
  worktreeFingerprint: string
}

/** Host-owned gate report envelope. Child-specific fields hang off the same object. */
export interface GateReport {
  schemaVersion: 1
  gate: string
  stage: Stage
  attempt: number
  cwd: string
  candidate: GateCandidate
  command: string[]
  startedUtc: string
  endedUtc: string
  exitCode: number
  verdict: Verdict
  reason: string
  adaptation?: string
  artifacts: string[]
  [extra: string]: unknown
}

/**
 * Validate and bound a child structured report. Invalid input is a stage FAIL,
 * never a host PASS.
 * @param value - raw structured output.
 * @param maxHandoffChars - serialized length cap.
 * @returns the report, or a failure reason string.
 */
export function readStageReport(value: unknown, maxHandoffChars: number): StageReport | { error: string } {
  if (!isRecord(value)) {
    return { error: 'structured report is not an object' }
  }
  const keys = Object.keys(value).sort().join(',')
  if (keys !== 'artifactsWritten,blocker,evidence,status,summary') {
    return { error: `structured report has extra or missing keys: ${keys}` }
  }
  const status = value['status']
  if (status !== 'complete' && status !== 'failed' && status !== 'blocked') {
    return { error: 'structured report status is invalid' }
  }
  if (!normalizedText(value['summary'])) {
    return { error: 'structured report summary must be non-empty and normalized' }
  }
  if (!normalizedList(value['artifactsWritten']) || !normalizedList(value['evidence'])) {
    return { error: 'structured report arrays must contain only non-empty normalized strings' }
  }
  if (typeof value['blocker'] !== 'string' || value['blocker'] !== value['blocker'].trim()) {
    return { error: 'structured report blocker must be a normalized string' }
  }
  if (status === 'blocked' && !normalizedText(value['blocker'])) {
    return { error: 'a blocked report needs a concrete blocker' }
  }
  if (status !== 'blocked' && value['blocker'] !== '') {
    return { error: 'blocker must be empty unless status is blocked' }
  }
  const report: StageReport = {
    status,
    summary: value['summary'],
    artifactsWritten: value['artifactsWritten'],
    evidence: value['evidence'],
    blocker: value['blocker'],
  }
  const serialized = JSON.stringify(report)
  if (serialized.length > maxHandoffChars) {
    return { error: `structured report exceeds maxHandoffChars (${serialized.length} > ${maxHandoffChars})` }
  }
  return report
}
