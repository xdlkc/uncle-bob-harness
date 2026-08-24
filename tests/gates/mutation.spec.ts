import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { artifactLayout } from '../../src/artifacts.ts'
import { resolveConfig } from '../../src/config.ts'
import { classifySurvivors, parseStrykerReport, runMutationGate } from '../../src/gates/mutation.ts'
import { captureProtectedSurfaces } from '../../src/gates/tamper.ts'
import type { GateInput } from '../../src/gates/types.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gates')

async function inputFor(cwd: string): Promise<GateInput> {
  const layout = artifactLayout(cwd, '.uncle-bob', 'stest')
  return {
    ctx: new Context(),
    cwd,
    config: resolveConfig({}),
    stage: 'hardener',
    attempt: 1,
    layout,
    signal: new AbortController().signal,
    srcBefore: new Map(),
    testsBefore: new Map(),
    startSurfaces: await captureProtectedSurfaces(cwd, 'architecture.rules.json'),
    worktreeFingerprint: 'sha256:test',
  }
}

describe('mutation gate', () => {
  it('PASS when all mutants are killed', async () => {
    const json = JSON.parse(readFileSync(join(FIXTURES, 'mutation-pass/reports/mutation/mutation.json'), 'utf8')) as unknown
    expect(parseStrykerReport(json)).toEqual([])
    const report = await runMutationGate(await inputFor(join(FIXTURES, 'mutation-pass')), {
      reportJson: json,
      skipCommand: true,
    })
    expect(report.verdict).toBe('PASS')
  })

  it('FAIL on an unexplained survivor', async () => {
    const json = JSON.parse(readFileSync(join(FIXTURES, 'mutation-fail/reports/mutation/mutation.json'), 'utf8')) as unknown
    const report = await runMutationGate(await inputFor(join(FIXTURES, 'mutation-fail')), {
      reportJson: json,
      skipCommand: true,
    })
    expect(report.verdict).toBe('FAIL')
    expect(report.reason).toMatch(/survived-9/)
  })

  it('PASS as ADAPTED when the survivor id is waived', () => {
    const survived = [{ mutantId: 'survived-9' }]
    const waivers = [{ mutantId: 'survived-9', reason: 'equivalent boolean', adaptation: true as const }]
    const { unexplained, adapted } = classifySurvivors(survived, waivers)
    expect(unexplained).toEqual([])
    expect(adapted).toEqual(survived)
  })

  it('ignores a waiver file the Hardener wrote after START', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-waiver-'))
    mkdirSync(join(cwd, '.uncle-bob'), { recursive: true })
    const json = JSON.parse(readFileSync(join(FIXTURES, 'mutation-fail/reports/mutation/mutation.json'), 'utf8')) as unknown
    const input = await inputFor(cwd)
    writeFileSync(join(cwd, '.uncle-bob/mutation-waivers.json'), JSON.stringify([
      { mutantId: 'survived-9', reason: 'I approve myself', adaptation: true },
    ]))
    const report = await runMutationGate(input, { reportJson: json, skipCommand: true })
    expect(report.verdict).toBe('FAIL')
    expect(report.reason).toMatch(/survived-9/)
  })
})
