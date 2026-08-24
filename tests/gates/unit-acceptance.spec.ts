import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { artifactLayout } from '../../src/artifacts.ts'
import { resolveConfig } from '../../src/config.ts'
import { runUnitAcceptanceGate } from '../../src/gates/unit-acceptance.ts'
import { captureProtectedSurfaces } from '../../src/gates/tamper.ts'
import type { GateInput } from '../../src/gates/types.ts'
import { FakeSubprocess } from '../helpers.ts'

async function inputWithExit(exitCode: number, spawnError?: string): Promise<GateInput> {
  const cwd = mkdtempSync(join(tmpdir(), 'ub-unit-'))
  mkdirSync(join(cwd, 'tests', 'acceptance'), { recursive: true })
  const layout = artifactLayout(cwd, '.uncle-bob', 'stest')
  mkdirSync(layout.root, { recursive: true })
  writeFileSync(layout.acceptance, 'Feature: x\n')
  const ctx = new Context()
  await ctx.plugin(FakeSubprocess)
  const subprocess = ctx.subprocess as unknown as FakeSubprocess
  subprocess.exitCode = exitCode
  subprocess.spawnError = spawnError
  return {
    ctx,
    cwd,
    config: resolveConfig({
      unitCommand: ['node', '-e', 'process.exit(0)'],
      acceptanceCommand: ['node', '-e', 'process.exit(0)'],
    }),
    stage: 'coder',
    attempt: 1,
    layout,
    signal: new AbortController().signal,
    srcBefore: new Map(),
    testsBefore: new Map(),
    startSurfaces: await captureProtectedSurfaces(cwd, 'architecture.rules.json'),
    worktreeFingerprint: 'sha256:test',
  }
}

describe('unit-acceptance gate', () => {
  it('PASS when stub commands exit 0', async () => {
    const report = await runUnitAcceptanceGate(await inputWithExit(0))
    expect(report.verdict).toBe('PASS')
  })

  it('FAIL when the unit command exits non-zero', async () => {
    const report = await runUnitAcceptanceGate(await inputWithExit(1))
    expect(report.verdict).toBe('FAIL')
  })

  it('BLOCKED when the executable is missing', async () => {
    const report = await runUnitAcceptanceGate(await inputWithExit(0, 'not found'))
    expect(report.verdict).toBe('BLOCKED')
  })
})
