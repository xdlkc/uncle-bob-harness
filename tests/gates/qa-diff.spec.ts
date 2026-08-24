import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { artifactLayout } from '../../src/artifacts.ts'
import { resolveConfig } from '../../src/config.ts'
import { qaIllegalImports, runQaGate } from '../../src/gates/qa.ts'
import { srcFileMap } from '../../src/git.ts'
import { captureProtectedSurfaces } from '../../src/gates/tamper.ts'
import type { GateInput } from '../../src/gates/types.ts'
import { FakeSubprocess } from '../helpers.ts'

async function setupWorkspace(): Promise<{ cwd: string; input: GateInput }> {
  const cwd = mkdtempSync(join(tmpdir(), 'ub-qa-'))
  mkdirSync(join(cwd, 'src'), { recursive: true })
  mkdirSync(join(cwd, 'tests', 'qa'), { recursive: true })
  writeFileSync(join(cwd, 'src/index.ts'), 'export function fizzBuzz(n: number): string { return String(n) }\n')
  writeFileSync(join(cwd, 'package.json'), '{}\n')
  writeFileSync(join(cwd, 'tsconfig.json'), '{}\n')
  const layout = artifactLayout(cwd, '.uncle-bob', 'stest')
  mkdirSync(layout.root, { recursive: true })
  writeFileSync(layout.qaMd, 'Public interface: exported fizzBuzz(n: number): string from src/index.ts.\n')
  writeFileSync(layout.qaReport, 'cases ran\n')
  const ctx = new Context()
  await ctx.plugin(FakeSubprocess)
  const input: GateInput = {
    ctx,
    cwd,
    config: resolveConfig({ qaCommand: ['node', '-e', 'process.exit(0)'] }),
    stage: 'qa',
    attempt: 1,
    layout,
    signal: new AbortController().signal,
    srcBefore: await srcFileMap(cwd),
    testsBefore: new Map(),
    startSurfaces: await captureProtectedSurfaces(cwd, 'architecture.rules.json'),
    worktreeFingerprint: 'sha256:test',
  }
  return { cwd, input }
}

describe('QA product-diff', () => {
  it('FAIL when QA touches src/', async () => {
    const { cwd, input } = await setupWorkspace()
    writeFileSync(join(cwd, 'src/index.ts'), 'export function fizzBuzz(n: number): string { return "patched" }\n')
    writeFileSync(join(cwd, 'tests/qa/public.test.ts'), 'import { fizzBuzz } from "../../src/index.ts"\n')
    const report = await runQaGate(input)
    expect(report.verdict).toBe('FAIL')
    expect(report.reason).toMatch(/must not modify src/)
  })

  it('PASS when only tests/qa changes and imports the public entry', async () => {
    const { cwd, input } = await setupWorkspace()
    writeFileSync(join(cwd, 'tests/qa/public.test.ts'), `
import { fizzBuzz } from '../../src/index.ts'
if (fizzBuzz(1) !== '1') throw new Error('fail')
`)
    const report = await runQaGate(input)
    expect(report.verdict).toBe('PASS')
  })

  it('FAIL when QA imports a private module', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-qa-priv-'))
    mkdirSync(join(cwd, 'src'), { recursive: true })
    mkdirSync(join(cwd, 'tests', 'qa'), { recursive: true })
    writeFileSync(join(cwd, 'src/impl.ts'), 'export const x = 1\n')
    writeFileSync(join(cwd, 'tests/qa/bad.ts'), `import { x } from '../../src/impl.ts'\n`)
    const illegal = qaIllegalImports(cwd, 'src/index.ts')
    expect(illegal.length).toBeGreaterThan(0)
  })
})
