import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { artifactLayout } from '../../src/artifacts.ts'
import { resolveConfig } from '../../src/config.ts'
import { runArchitectureGate } from '../../src/gates/architecture.ts'
import { captureProtectedSurfaces } from '../../src/gates/tamper.ts'
import type { GateInput } from '../../src/gates/types.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gates')

async function inputFor(cwd: string): Promise<GateInput> {
  const layout = artifactLayout(cwd, '.uncle-bob', 'stest')
  return {
    ctx: new Context(),
    cwd,
    config: resolveConfig({}),
    stage: 'cleaner',
    attempt: 1,
    layout,
    signal: new AbortController().signal,
    srcBefore: new Map(),
    testsBefore: new Map(),
    startSurfaces: await captureProtectedSurfaces(cwd, 'architecture.rules.json'),
    worktreeFingerprint: 'sha256:test',
  }
}

describe('architecture gate', () => {
  it('PASS on legal public → impl import', async () => {
    const report = await runArchitectureGate(await inputFor(join(FIXTURES, 'architecture-pass')))
    expect(report.verdict).toBe('PASS')
  })

  it('FAIL when impl imports public', async () => {
    const report = await runArchitectureGate(await inputFor(join(FIXTURES, 'architecture-fail')))
    expect(report.verdict).toBe('FAIL')
    expect(report.reason).toMatch(/may not depend on/)
  })

  it('BLOCKED when rules file is missing', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-arch-missing-'))
    const report = await runArchitectureGate(await inputFor(cwd))
    expect(report.verdict).toBe('BLOCKED')
    expect(report.reason).toMatch(/missing/)
  })

  it('BLOCKED when modules array is empty', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-arch-empty-'))
    mkdirSync(join(cwd, 'src'), { recursive: true })
    writeFileSync(join(cwd, 'src/index.ts'), 'export const x = 1\n')
    writeFileSync(join(cwd, 'architecture.rules.json'), JSON.stringify({ modules: [], forbidCycles: true }))
    const report = await runArchitectureGate(await inputFor(cwd))
    expect(report.verdict).toBe('BLOCKED')
    expect(report.reason).toMatch(/empty/)
  })
})
