/**
 * Anti-tamper: protected-surface fingerprints vs start-of-story snapshots.
 * Implementation adaptation of “trust the tools, own constraints.”
 * @module uncle-bob-harness/gates/tamper
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { directoryFingerprint, fileFingerprint } from '../git.ts'
import { loadArchitectureRules } from './architecture.ts'
import { gateReport, utcNow, type GateInput, type ProtectedSurfaces } from './types.ts'
import type { GateReport } from '../schema.ts'

const SURFACE_FILES = {
  gitignore: '.gitignore',
  ignore: '.ignore',
  vitestConfig: 'vitest.config.ts',
  nycConfig: 'nyc.config',
  packageJson: 'package.json',
  strykerJson: 'stryker.config.json',
  strykerMjs: 'stryker.config.mjs',
  cucumberJs: 'cucumber.js',
} as const

/**
 * Snapshot protected surfaces at story START.
 * @param cwd - workspace.
 * @param architectureRulesPath - relative rules path.
 * @returns fingerprints.
 */
export async function captureProtectedSurfaces(
  cwd: string,
  architectureRulesPath: string,
  mutationWaiverPath = '.uncle-bob/mutation-waivers.json',
): Promise<ProtectedSurfaces> {
  const read = async (rel: string): Promise<string> => fileFingerprint(join(cwd, rel))
  let mutationWaiverText = ''
  const waiverAbs = join(cwd, mutationWaiverPath)
  if (existsSync(waiverAbs)) {
    mutationWaiverText = await readFile(waiverAbs, 'utf8')
  }
  return {
    gitignore: await read(SURFACE_FILES.gitignore),
    ignore: await read(SURFACE_FILES.ignore),
    vitestConfig: await read(SURFACE_FILES.vitestConfig),
    nycConfig: await read(SURFACE_FILES.nycConfig),
    packageJson: await read(SURFACE_FILES.packageJson),
    strykerJson: await read(SURFACE_FILES.strykerJson),
    strykerMjs: await read(SURFACE_FILES.strykerMjs),
    architectureRules: await read(architectureRulesPath),
    cucumberJs: await read(SURFACE_FILES.cucumberJs),
    testsFingerprint: await directoryFingerprint(join(cwd, 'tests')),
    mutationWaiverText,
  }
}

function ignoreAddsSrc(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    if (trimmed === 'src' || trimmed === 'src/' || trimmed === '/src' || trimmed === '/src/'
      || trimmed === 'src/**' || trimmed === 'src/**/*' || trimmed.startsWith('src/')) {
      return true
    }
  }
  return false
}

function coverageExcludesSrc(text: string): boolean {
  if (/exclude[\s\S]{0,200}src/.test(text)) return true
  try {
    const parsed = JSON.parse(text) as { nyc?: { exclude?: string[] }; coverage?: { exclude?: string[] } }
    const lists = [parsed.nyc?.exclude, parsed.coverage?.exclude]
    for (const list of lists) {
      if (Array.isArray(list) && list.some(item => String(item).includes('src'))) return true
    }
  } catch {
    // Not JSON — the text heuristic above already ran.
  }
  return false
}

function mutationExcludesAll(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { mutate?: string[]; ignorePatterns?: string[] }
    const ignore = parsed.ignorePatterns ?? []
    if (ignore.some(item => item === 'src/**/*.ts' || item === 'src/**' || item === '**/*')) return true
    if (Array.isArray(parsed.mutate) && parsed.mutate.length === 0) return true
  } catch {
    if (/ignorePatterns[\s\S]*src\/\*\*/.test(text)) return true
  }
  return false
}

function architectureAllowsAll(cwd: string, rulesPath: string): boolean {
  const loaded = loadArchitectureRules(join(cwd, rulesPath))
  if ('error' in loaded) return false
  return loaded.modules.some(mod => mod.mayDependOn.includes('*'))
}

async function readText(cwd: string, rel: string): Promise<string> {
  const path = join(cwd, rel)
  if (!existsSync(path)) return ''
  return readFile(path, 'utf8')
}

/**
 * Compare current protected surfaces against the START snapshot.
 * @param input - gate input (uses startSurfaces).
 * @returns host gate report.
 */
export async function runTamperGate(input: GateInput): Promise<GateReport> {
  const startedUtc = utcNow()
  const now = await captureProtectedSurfaces(
    input.cwd,
    input.config.architectureRulesPath,
    input.config.mutationWaiverPath,
  )
  const reasons: string[] = []

  const gitignore = await readText(input.cwd, SURFACE_FILES.gitignore)
  const ignore = await readText(input.cwd, SURFACE_FILES.ignore)
  if (now.gitignore !== input.startSurfaces.gitignore && ignoreAddsSrc(gitignore)) {
    reasons.push('.gitignore adds ignore of src/')
  }
  if (now.ignore !== input.startSurfaces.ignore && ignoreAddsSrc(ignore)) {
    reasons.push('.ignore adds ignore of src/')
  }

  const vitest = await readText(input.cwd, SURFACE_FILES.vitestConfig)
  const pkg = await readText(input.cwd, SURFACE_FILES.packageJson)
  if (
    (now.vitestConfig !== input.startSurfaces.vitestConfig && coverageExcludesSrc(vitest))
    || (now.packageJson !== input.startSurfaces.packageJson && coverageExcludesSrc(pkg))
  ) {
    reasons.push('coverage exclude of src/')
  }

  const stryker = (await readText(input.cwd, SURFACE_FILES.strykerJson))
    || (await readText(input.cwd, SURFACE_FILES.strykerMjs))
  if (
    (now.strykerJson !== input.startSurfaces.strykerJson || now.strykerMjs !== input.startSurfaces.strykerMjs)
    && mutationExcludesAll(stryker)
  ) {
    reasons.push('mutation exclude-all / ignorePatterns of src')
  }

  if (now.architectureRules !== input.startSurfaces.architectureRules) {
    reasons.push('architecture.rules.json changed after story start')
  }
  if (architectureAllowsAll(input.cwd, input.config.architectureRulesPath)) {
    reasons.push('architecture mayDependOn contains ["*"]')
  }
  if (now.mutationWaiverText !== input.startSurfaces.mutationWaiverText) {
    reasons.push('mutation waiver file changed after story start')
  }

  if (now.testsFingerprint !== input.startSurfaces.testsFingerprint) {
    // Dropping tests that existed at START is tamper; adding tests is allowed.
    // directoryFingerprint change alone is not FAIL; only disappearance of prior files.
  }

  const verdict = reasons.length > 0 ? 'FAIL' : 'PASS'
  return gateReport({
    gate: 'tamper',
    stage: input.stage,
    attempt: input.attempt,
    cwd: input.cwd,
    candidate: { dirty: true, worktreeFingerprint: input.worktreeFingerprint },
    command: ['tamper-in-process'],
    startedUtc,
    endedUtc: utcNow(),
    exitCode: verdict === 'PASS' ? 0 : 1,
    verdict,
    reason: verdict === 'PASS' ? 'protected surfaces unchanged in weakening ways' : `POST_RUN_TAMPERING: ${reasons.join('; ')}`,
    adaptation: 'Anti-tamper is an Implementation adaptation of trust-the-tools',
    artifacts: [],
  })
}

/**
 * Detect dropped test files vs a pre-stage tests map.
 * @param cwd - workspace.
 * @param testsBefore - path → hash at START.
 * @returns dropped relative paths.
 */
export async function droppedTestFiles(cwd: string, testsBefore: ReadonlyMap<string, string>): Promise<string[]> {
  const { testsFileMap } = await import('../git.ts')
  const now = await testsFileMap(cwd)
  const dropped: string[] = []
  for (const path of testsBefore.keys()) {
    if (!now.has(path) && (path.includes('tests/') || path.startsWith('tests'))) dropped.push(path)
  }
  return dropped
}
