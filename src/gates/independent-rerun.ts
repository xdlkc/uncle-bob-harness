/**
 * After QA PASS, director re-runs all host gates and the tamper check.
 * @module uncle-bob-harness/gates/independent-rerun
 */

import { droppedTestFiles, runTamperGate } from './tamper.ts'
import { runUnitAcceptanceGate } from './unit-acceptance.ts'
import { runCrapGate } from './crap.ts'
import { runArchitectureGate } from './architecture.ts'
import { runMutationGate } from './mutation.ts'
import { runQaGate } from './qa.ts'
import { gateReport, utcNow, type GateInput } from './types.ts'
import type { GateReport } from '../schema.ts'

const SUBGATES = ['unit-acceptance', 'crap', 'architecture', 'mutation', 'qa', 'tamper'] as const

/**
 * Re-run unit, acceptance, CRAP, architecture, mutation, QA, then anti-tamper.
 * @param input - gate input.
 * @returns composite host gate report.
 */
export async function runIndependentRerunGate(input: GateInput): Promise<GateReport> {
  const startedUtc = utcNow()
  const reports: GateReport[] = []

  reports.push(await runUnitAcceptanceGate(input))
  if (reports[reports.length - 1]!.verdict === 'PASS') {
    reports.push(await runCrapGate(input))
  }
  if (reports[reports.length - 1]!.verdict === 'PASS') {
    reports.push(await runArchitectureGate(input))
  }
  if (reports[reports.length - 1]!.verdict === 'PASS') {
    reports.push(await runMutationGate(input))
  }
  if (reports[reports.length - 1]!.verdict === 'PASS') {
    reports.push(await runQaGate(input))
  }
  reports.push(await runTamperGate(input))

  const dropped = await droppedTestFiles(input.cwd, input.testsBefore)
  if (dropped.length > 0) {
    reports.push(gateReport({
      gate: 'tamper-tests',
      stage: input.stage,
      attempt: input.attempt,
      cwd: input.cwd,
      candidate: { dirty: true, worktreeFingerprint: input.worktreeFingerprint },
      command: ['tamper-tests'],
      startedUtc,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'FAIL',
      reason: `POST_RUN_TAMPERING: dropped test files ${dropped.join(', ')}`,
      artifacts: [],
    }))
  }

  const failed = reports.find(report => report.verdict !== 'PASS')
  const verdict = failed === undefined ? 'PASS' : failed.verdict
  return gateReport({
    gate: 'independent-rerun',
    stage: input.stage,
    attempt: input.attempt,
    cwd: input.cwd,
    candidate: { dirty: true, worktreeFingerprint: input.worktreeFingerprint },
    command: [...SUBGATES],
    startedUtc,
    endedUtc: utcNow(),
    exitCode: verdict === 'PASS' ? 0 : 1,
    verdict,
    reason: failed === undefined
      ? 'independent rerun of all host gates passed'
      : failed.reason,
    subgates: reports.map(report => ({ gate: report.gate, verdict: report.verdict, reason: report.reason })),
    artifacts: [],
  })
}
