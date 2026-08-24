import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { artifactLayout } from '../../src/artifacts.ts'
import { resolveConfig } from '../../src/config.ts'
import { captureProtectedSurfaces, runTamperGate } from '../../src/gates/tamper.ts'
import type { GateInput } from '../../src/gates/types.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gates')

describe('tamper gate', () => {
  it('FAIL when vitest coverage starts excluding src/', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-tamper-'))
    writeFileSync(join(cwd, 'vitest.config.ts'), 'export default { test: { coverage: { include: ["src"] } } }\n')
    writeFileSync(join(cwd, 'package.json'), '{}\n')
    const startSurfaces = await captureProtectedSurfaces(cwd, 'architecture.rules.json')
    cpSync(join(FIXTURES, 'tamper-coverage-exclude/vitest.config.ts'), join(cwd, 'vitest.config.ts'))
    const input: GateInput = {
      ctx: new Context(),
      cwd,
      config: resolveConfig({}),
      stage: 'independent-rerun',
      attempt: 1,
      layout: artifactLayout(cwd, '.uncle-bob', 'stest'),
      signal: new AbortController().signal,
      srcBefore: new Map(),
      testsBefore: new Map(),
      startSurfaces,
      worktreeFingerprint: 'sha256:test',
    }
    const report = await runTamperGate(input)
    expect(report.verdict).toBe('FAIL')
    expect(report.reason).toMatch(/POST_RUN_TAMPERING/)
    expect(report.reason).toMatch(/coverage exclude/)
  })

  it('FAIL when stryker ignorePatterns excludes all of src', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-tamper-mut-'))
    writeFileSync(join(cwd, 'stryker.config.json'), JSON.stringify({ mutate: ['src/**/*.ts'] }))
    const startSurfaces = await captureProtectedSurfaces(cwd, 'architecture.rules.json')
    writeFileSync(join(cwd, 'stryker.config.json'), JSON.stringify({ mutate: ['src/**/*.ts'], ignorePatterns: ['src/**/*.ts'] }))
    const input: GateInput = {
      ctx: new Context(),
      cwd,
      config: resolveConfig({}),
      stage: 'independent-rerun',
      attempt: 1,
      layout: artifactLayout(cwd, '.uncle-bob', 'stest'),
      signal: new AbortController().signal,
      srcBefore: new Map(),
      testsBefore: new Map(),
      startSurfaces,
      worktreeFingerprint: 'sha256:test',
    }
    const report = await runTamperGate(input)
    expect(report.verdict).toBe('FAIL')
    expect(report.reason).toMatch(/mutation exclude/)
  })

  it('FAIL when architecture.rules.json changes after START', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-tamper-arch-'))
    writeFileSync(join(cwd, 'architecture.rules.json'), JSON.stringify({
      modules: [{ name: 'public', pattern: 'src/index.ts', mayDependOn: ['impl'] }],
    }))
    const startSurfaces = await captureProtectedSurfaces(cwd, 'architecture.rules.json')
    writeFileSync(join(cwd, 'architecture.rules.json'), JSON.stringify({ modules: [] }))
    const input: GateInput = {
      ctx: new Context(),
      cwd,
      config: resolveConfig({}),
      stage: 'independent-rerun',
      attempt: 1,
      layout: artifactLayout(cwd, '.uncle-bob', 'stest'),
      signal: new AbortController().signal,
      srcBefore: new Map(),
      testsBefore: new Map(),
      startSurfaces,
      worktreeFingerprint: 'sha256:test',
    }
    const report = await runTamperGate(input)
    expect(report.verdict).toBe('FAIL')
    expect(report.reason).toMatch(/architecture.rules.json changed/)
  })
})
