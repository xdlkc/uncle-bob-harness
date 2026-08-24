/**
 * Coder gate: unit + acceptance subprocesses. Host owns PASS.
 * @module uncle-bob-harness/gates/unit-acceptance
 */

import { existsSync } from 'node:fs'
import { copyAcceptanceFeature } from '../git.ts'
import { outputTail, runCommand } from '../subprocess-run.ts'
import { gateReport, utcNow, type GateInput } from './types.ts'
import type { GateReport } from '../schema.ts'

function blocked(
  input: GateInput,
  startedUtc: string,
  command: string[],
  reason: string,
): GateReport {
  return gateReport({
    gate: 'unit-acceptance',
    stage: input.stage,
    attempt: input.attempt,
    cwd: input.cwd,
    candidate: { dirty: true, worktreeFingerprint: input.worktreeFingerprint },
    command,
    startedUtc,
    endedUtc: utcNow(),
    exitCode: 1,
    verdict: 'BLOCKED',
    reason,
    artifacts: [],
  })
}

/**
 * Run unitCommand then acceptanceCommand. Both must exit 0.
 * @param input - gate input.
 * @returns host gate report.
 */
export async function runUnitAcceptanceGate(input: GateInput): Promise<GateReport> {
  const startedUtc = utcNow()
  const command = [...input.config.unitCommand, '&&', ...input.config.acceptanceCommand]

  const unit = await runCommand({
    ctx: input.ctx,
    argv: input.config.unitCommand,
    cwd: input.cwd,
    timeoutMs: input.config.gateTimeoutMs,
    signal: input.signal,
  })
  if (unit.spawnError !== undefined) {
    return blocked(input, startedUtc, input.config.unitCommand, unit.spawnError)
  }
  if (unit.timedOut) {
    return blocked(input, startedUtc, input.config.unitCommand, `unit command timed out after ${input.config.gateTimeoutMs}ms`)
  }
  if (unit.exitCode !== 0) {
    return gateReport({
      gate: 'unit-acceptance',
      stage: input.stage,
      attempt: input.attempt,
      cwd: input.cwd,
      candidate: { dirty: true, worktreeFingerprint: input.worktreeFingerprint },
      command: [...input.config.unitCommand],
      startedUtc,
      endedUtc: utcNow(),
      exitCode: unit.exitCode ?? 1,
      verdict: 'FAIL',
      reason: `unit tests failed (exit ${unit.exitCode}): ${outputTail(unit.stderr || unit.stdout)}`,
      artifacts: [],
    })
  }

  if (existsSync(input.layout.acceptance)) {
    await copyAcceptanceFeature(input.layout.acceptance, input.cwd)
  }

  const acceptance = await runCommand({
    ctx: input.ctx,
    argv: input.config.acceptanceCommand,
    cwd: input.cwd,
    timeoutMs: input.config.gateTimeoutMs,
    signal: input.signal,
  })
  if (acceptance.spawnError !== undefined) {
    return blocked(input, startedUtc, input.config.acceptanceCommand, acceptance.spawnError)
  }
  if (acceptance.timedOut) {
    return blocked(input, startedUtc, input.config.acceptanceCommand, `acceptance command timed out after ${input.config.gateTimeoutMs}ms`)
  }
  if (acceptance.exitCode !== 0) {
    return gateReport({
      gate: 'unit-acceptance',
      stage: input.stage,
      attempt: input.attempt,
      cwd: input.cwd,
      candidate: { dirty: true, worktreeFingerprint: input.worktreeFingerprint },
      command: [...input.config.acceptanceCommand],
      startedUtc,
      endedUtc: utcNow(),
      exitCode: acceptance.exitCode ?? 1,
      verdict: 'FAIL',
      reason: `acceptance tests failed (exit ${acceptance.exitCode}): ${outputTail(acceptance.stderr || acceptance.stdout)}`,
      artifacts: [],
    })
  }

  return gateReport({
    gate: 'unit-acceptance',
    stage: input.stage,
    attempt: input.attempt,
    cwd: input.cwd,
    candidate: { dirty: true, worktreeFingerprint: input.worktreeFingerprint },
    command,
    startedUtc,
    endedUtc: utcNow(),
    exitCode: 0,
    verdict: 'PASS',
    reason: 'unit and acceptance exited 0',
    artifacts: [],
  })
}
