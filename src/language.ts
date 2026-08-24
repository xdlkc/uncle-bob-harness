/**
 * v1 TypeScript-only language detection and the LanguageAdapter extension point.
 * @module uncle-bob-harness/language
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GateReport } from './schema.ts'

/** v1 language ids. */
export type DetectedLanguage = 'typescript' | 'unsupported'

/** Coverage + complexity input for a CRAP adapter. */
export interface CrapInput {
  cwd: string
  coverageByFunction: ReadonlyMap<string, number>
  complexityByFunction: ReadonlyMap<string, { cc: number; startLine: number }>
  crapCap: number
}

/**
 * Documented extension point for later languages. v1 ships TypeScript only.
 */
export interface LanguageAdapter {
  readonly id: string
  detect(cwd: string): boolean
  crap(input: CrapInput): Promise<GateReport>
  mutationCommandDefault: string[]
  unitCommandDefault: string[]
}

/**
 * Detect the workspace language.
 * @param cwd - session workspace.
 * @returns `typescript` when both tsconfig.json and package.json exist.
 */
export function detectLanguage(cwd: string): DetectedLanguage {
  if (existsSync(join(cwd, 'tsconfig.json')) && existsSync(join(cwd, 'package.json'))) {
    return 'typescript'
  }
  return 'unsupported'
}

/** v1 TypeScript adapter (detection only; CRAP lives in gates/crap.ts). */
export const typescriptAdapter: Pick<LanguageAdapter, 'id' | 'detect' | 'mutationCommandDefault' | 'unitCommandDefault'> = {
  id: 'typescript',
  detect: cwd => detectLanguage(cwd) === 'typescript',
  mutationCommandDefault: ['npx', 'stryker', 'run'],
  unitCommandDefault: ['npx', 'vitest', 'run'],
}
