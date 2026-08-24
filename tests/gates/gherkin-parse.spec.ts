import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { artifactLayout } from '../../src/artifacts.ts'
import { resolveConfig } from '../../src/config.ts'
import { runGherkinParseGate } from '../../src/gates/gherkin-parse.ts'
import { srcFileMap } from '../../src/git.ts'
import type { GateInput } from '../../src/gates/types.ts'
import { captureProtectedSurfaces } from '../../src/gates/tamper.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gates')

async function inputFor(cwd: string, storyId = 'stest'): Promise<GateInput> {
  const layout = artifactLayout(cwd, '.uncle-bob', storyId)
  mkdirSync(layout.gatesDir, { recursive: true })
  return {
    ctx: new Context(),
    cwd,
    config: resolveConfig({}),
    stage: 'specifier',
    attempt: 1,
    layout,
    signal: new AbortController().signal,
    srcBefore: await srcFileMap(cwd),
    testsBefore: new Map(),
    startSurfaces: await captureProtectedSurfaces(cwd, 'architecture.rules.json'),
    worktreeFingerprint: 'sha256:test',
  }
}

describe('gherkin-parse gate', () => {
  it('parses the gherkin-pass fixture', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-gherkin-pass-'))
    const layout = artifactLayout(cwd, '.uncle-bob', 'stest')
    mkdirSync(layout.root, { recursive: true })
    cpSync(join(FIXTURES, 'gherkin-pass/acceptance.feature'), layout.acceptance)
    cpSync(join(FIXTURES, 'gherkin-pass/qa.md'), layout.qaMd)
    cpSync(join(FIXTURES, 'gherkin-pass/blockers.md'), layout.blockers)
    const report = await runGherkinParseGate(await inputFor(cwd))
    expect(report.verdict).toBe('PASS')
  })

  it('FAIL on broken Gherkin keyword', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-gherkin-fail-'))
    const layout = artifactLayout(cwd, '.uncle-bob', 'stest')
    mkdirSync(layout.root, { recursive: true })
    cpSync(join(FIXTURES, 'gherkin-fail/acceptance.feature'), layout.acceptance)
    cpSync(join(FIXTURES, 'gherkin-fail/qa.md'), layout.qaMd)
    writeFileSync(layout.blockers, '')
    const report = await runGherkinParseGate(await inputFor(cwd))
    expect(report.verdict).toBe('FAIL')
    expect(report.reason).toMatch(/Gherkin parse error|Scenario/i)
  })

  it('FAIL when files are missing so Specifier can retry', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-gherkin-missing-'))
    const report = await runGherkinParseGate(await inputFor(cwd))
    expect(report.verdict).toBe('FAIL')
  })

  it('BLOCKED on open blockers.md', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-gherkin-block-'))
    const layout = artifactLayout(cwd, '.uncle-bob', 'stest')
    mkdirSync(layout.root, { recursive: true })
    cpSync(join(FIXTURES, 'gherkin-pass/acceptance.feature'), layout.acceptance)
    cpSync(join(FIXTURES, 'gherkin-pass/qa.md'), layout.qaMd)
    writeFileSync(layout.blockers, 'What is equality for n=0?\n')
    const report = await runGherkinParseGate(await inputFor(cwd))
    expect(report.verdict).toBe('BLOCKED')
    expect(report.reason).toMatch(/blockers/)
  })

  it('FAIL when Specifier writes src/', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-gherkin-src-'))
    mkdirSync(join(cwd, 'src'), { recursive: true })
    const layout = artifactLayout(cwd, '.uncle-bob', 'stest')
    mkdirSync(layout.root, { recursive: true })
    cpSync(join(FIXTURES, 'gherkin-pass/acceptance.feature'), layout.acceptance)
    cpSync(join(FIXTURES, 'gherkin-pass/qa.md'), layout.qaMd)
    writeFileSync(layout.blockers, '')
    const before = await srcFileMap(cwd)
    writeFileSync(join(cwd, 'src/index.ts'), 'export const x = 1\n')
    const input = await inputFor(cwd)
    input.srcBefore = before
    const report = await runGherkinParseGate(input)
    expect(report.verdict).toBe('FAIL')
    expect(report.reason).toMatch(/src\//)
  })
})
