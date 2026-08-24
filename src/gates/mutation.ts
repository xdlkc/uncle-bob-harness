/**
 * Hardener gate: parse Stryker JSON, apply labeled equivalent-mutant waivers.
 * @module uncle-bob-harness/gates/mutation
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { outputTail, runCommand } from '../subprocess-run.ts'
import { isRecord } from '../util.ts'
import { gateReport, utcNow, type GateInput } from './types.ts'
import type { GateReport } from '../schema.ts'

/** One committed equivalent-mutant waiver. Adaptation labeled. */
export interface MutationWaiver {
  mutantId: string
  reason: string
  adaptation: true
}

/** One surviving mutant from a Stryker report. */
export interface SurvivingMutant {
  mutantId: string
  file?: string
  mutatorName?: string
}

/**
 * Parse Stryker `reports/mutation/mutation.json`.
 * @param json - parsed report.
 * @returns survived mutants.
 */
export function parseStrykerReport(json: unknown): SurvivingMutant[] | { error: string } {
  if (!isRecord(json)) return { error: 'Stryker report is not an object' }
  const files = isRecord(json['files']) ? json['files'] : undefined
  if (files === undefined) return { error: 'Stryker report missing files' }
  const survived: SurvivingMutant[] = []
  for (const [file, entry] of Object.entries(files)) {
    if (!isRecord(entry) || !Array.isArray(entry['mutants'])) continue
    for (const mutant of entry['mutants']) {
      if (!isRecord(mutant)) continue
      if (mutant['status'] !== 'Survived') continue
      const id = mutant['id']
      survived.push({
        mutantId: id === undefined ? `${file}:unknown` : String(id),
        file,
        mutatorName: typeof mutant['mutatorName'] === 'string' ? mutant['mutatorName'] : undefined,
      })
    }
  }
  return survived
}

/**
 * Parse waiver JSON text captured at story START. Current-file writes are ignored.
 * @param text - snapshot text; empty means no waivers.
 * @returns waivers or an error.
 */
export function parseWaiverText(text: string): MutationWaiver[] | { error: string } {
  if (text.trim().length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { error: `waiver file is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!Array.isArray(parsed)) return { error: 'waiver file must be an array' }
  const waivers: MutationWaiver[] = []
  for (const item of parsed) {
    if (!isRecord(item) || typeof item['mutantId'] !== 'string' || typeof item['reason'] !== 'string' || item['adaptation'] !== true) {
      return { error: 'each waiver needs mutantId, reason, and adaptation: true' }
    }
    waivers.push({ mutantId: item['mutantId'], reason: item['reason'], adaptation: true })
  }
  return waivers
}

/**
 * Classify survivors against committed waivers.
 * @param survived - Stryker survivors.
 * @param waivers - committed waivers.
 * @returns unexplained vs adapted ids.
 */
export function classifySurvivors(
  survived: readonly SurvivingMutant[],
  waivers: readonly MutationWaiver[],
): { unexplained: SurvivingMutant[]; adapted: SurvivingMutant[] } {
  const waived = new Set(waivers.map(waiver => waiver.mutantId))
  const unexplained: SurvivingMutant[] = []
  const adapted: SurvivingMutant[] = []
  for (const mutant of survived) {
    if (waived.has(mutant.mutantId)) adapted.push(mutant)
    else unexplained.push(mutant)
  }
  return { unexplained, adapted }
}

/**
 * Run mutationCommand and parse the Stryker report.
 * @param input - gate input.
 * @param options - skip the subprocess (unit tests with a fixture report).
 * @returns host gate report.
 */
export async function runMutationGate(
  input: GateInput,
  options?: { reportJson?: unknown; skipCommand?: boolean },
): Promise<GateReport> {
  const startedUtc = utcNow()
  const command = [...input.config.mutationCommand]
  const base = {
    gate: 'mutation',
    stage: input.stage,
    attempt: input.attempt,
    cwd: input.cwd,
    candidate: { dirty: true, worktreeFingerprint: input.worktreeFingerprint },
    command,
    startedUtc,
    artifacts: [] as string[],
  }

  if (options?.skipCommand !== true) {
    const ran = await runCommand({
      ctx: input.ctx,
      argv: input.config.mutationCommand,
      cwd: input.cwd,
      timeoutMs: input.config.gateTimeoutMs,
      signal: input.signal,
    })
    if (ran.spawnError !== undefined) {
      return gateReport({
        ...base,
        endedUtc: utcNow(),
        exitCode: 1,
        verdict: 'BLOCKED',
        reason: ran.spawnError,
      })
    }
    if (ran.timedOut) {
      return gateReport({
        ...base,
        endedUtc: utcNow(),
        exitCode: 1,
        verdict: 'BLOCKED',
        reason: `mutation command timed out after ${input.config.gateTimeoutMs}ms`,
      })
    }
    if (ran.exitCode !== 0 && options?.reportJson === undefined) {
      // Stryker exits non-zero on survivors; still parse the report when present.
      const reportPath = join(input.cwd, 'reports', 'mutation', 'mutation.json')
      if (!existsSync(reportPath)) {
        return gateReport({
          ...base,
          endedUtc: utcNow(),
          exitCode: ran.exitCode ?? 1,
          verdict: 'FAIL',
          reason: `mutation command failed (exit ${ran.exitCode}): ${outputTail(ran.stderr || ran.stdout)}`,
        })
      }
    }
  }

  let json: unknown = options?.reportJson
  if (json === undefined) {
    const reportPath = join(input.cwd, 'reports', 'mutation', 'mutation.json')
    if (!existsSync(reportPath)) {
      return gateReport({
        ...base,
        endedUtc: utcNow(),
        exitCode: 1,
        verdict: 'BLOCKED',
        reason: `Stryker report missing: ${reportPath}`,
      })
    }
    json = JSON.parse(await readFile(reportPath, 'utf8')) as unknown
  }

  const survived = parseStrykerReport(json)
  if ('error' in survived) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'BLOCKED',
      reason: survived.error,
    })
  }

  const waivers = parseWaiverText(input.startSurfaces.mutationWaiverText)
  if ('error' in waivers) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'BLOCKED',
      reason: waivers.error,
    })
  }

  const { unexplained, adapted } = classifySurvivors(survived, waivers)
  if (unexplained.length > 0) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'FAIL',
      reason: `unexplained survivors: ${unexplained.map(item => item.mutantId).join(', ')}`,
      survived: unexplained,
      adapted,
      adaptation: 'Equivalent-mutant waivers are an Implementation adaptation; target remains kill-all',
    })
  }

  const adaptedNote = adapted.length > 0
    ? `ADAPTED: ${adapted.length} waived equivalent mutant(s)`
    : 'no surviving mutants'
  return gateReport({
    ...base,
    endedUtc: utcNow(),
    exitCode: 0,
    verdict: 'PASS',
    reason: adaptedNote,
    adapted,
    adaptedPass: adapted.length > 0,
    adaptation: adapted.length > 0
      ? 'Waived survivors PASS only as ADAPTED. Equivalent-mutant waivers are an Implementation adaptation'
      : undefined,
  })
}
