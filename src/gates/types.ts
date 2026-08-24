/**
 * Gate runner shared types.
 * @module uncle-bob-harness/gates/types
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../config.ts'
import type { Stage } from '../fsm.ts'
import type { ArtifactLayout } from '../artifacts.ts'
import type { GateReport } from '../schema.ts'

export type { GateReport, GateCandidate } from '../schema.ts'

/** Inputs every host gate receives. */
export interface GateInput {
  ctx: Context
  cwd: string
  config: Config
  stage: Stage
  attempt: number
  layout: ArtifactLayout
  signal: AbortSignal
  srcBefore: ReadonlyMap<string, string>
  testsBefore: ReadonlyMap<string, string>
  startSurfaces: ProtectedSurfaces
  worktreeFingerprint: string
}

/** Fingerprints of protected config surfaces. */
export interface ProtectedSurfaces {
  gitignore: string
  ignore: string
  vitestConfig: string
  nycConfig: string
  packageJson: string
  strykerJson: string
  strykerMjs: string
  architectureRules: string
  cucumberJs: string
  testsFingerprint: string
  /** Waiver file contents at START. Later Hardener writes are ignored. */
  mutationWaiverText: string
}

/**
 * Build a gate envelope.
 * @param partial - required envelope fields plus extras.
 * @returns a complete GateReport.
 */
export function gateReport(partial: Omit<GateReport, 'schemaVersion'> & { schemaVersion?: 1 }): GateReport {
  return {
    schemaVersion: 1,
    ...partial,
  } as GateReport
}

/**
 * UTC timestamp now.
 * @returns ISO string.
 */
export function utcNow(): string {
  return new Date().toISOString()
}
