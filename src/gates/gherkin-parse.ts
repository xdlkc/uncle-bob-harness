/**
 * Specifier gate: Gherkin parse, required artifacts, blockers, no src/ writes.
 * @module uncle-bob-harness/gates/gherkin-parse
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { generateMessages } from '@cucumber/gherkin'
import { IdGenerator, SourceMediaType } from '@cucumber/messages'
import { srcDiff } from '../git.ts'
import { gateReport, utcNow, type GateInput } from './types.ts'
import type { GateReport } from '../schema.ts'

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Parse acceptance.feature with @cucumber/gherkin and enforce Specifier artifacts.
 * @param input - gate input.
 * @returns host gate report.
 */
export async function runGherkinParseGate(input: GateInput): Promise<GateReport> {
  const startedUtc = utcNow()
  const command = ['gherkin-parse']
  const base = {
    gate: 'gherkin-parse',
    stage: input.stage,
    attempt: input.attempt,
    cwd: input.cwd,
    candidate: { dirty: true, worktreeFingerprint: input.worktreeFingerprint },
    command,
    startedUtc,
    artifacts: [] as string[],
  }

  const featurePath = input.layout.acceptance
  const qaPath = input.layout.qaMd
  if (!existsSync(featurePath) || !existsSync(qaPath)) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'FAIL',
      reason: 'acceptance.feature or qa.md is missing',
    })
  }

  const feature = await readFile(featurePath, 'utf8')
  const qa = await readFile(qaPath, 'utf8')
  if (feature.trim().length === 0 || qa.trim().length === 0) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'FAIL',
      reason: 'acceptance.feature or qa.md is empty',
    })
  }

  const envelopes = generateMessages(
    feature,
    featurePath,
    SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,
    {
      includeSource: false,
      includeGherkinDocument: true,
      includePickles: true,
      newId: IdGenerator.uuid(),
    },
  )
  const parseErrors = envelopes.filter(envelope => envelope.parseError !== undefined)
  if (parseErrors.length > 0) {
    const message = parseErrors.map(envelope => envelope.parseError?.message ?? 'parse error').join('; ')
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'FAIL',
      reason: `Gherkin parse error: ${message}`,
    })
  }

  let scenarioCount = 0
  for (const envelope of envelopes) {
    const doc = envelope.gherkinDocument
    const children = doc?.feature?.children ?? []
    for (const child of children) {
      if (child.scenario !== undefined) scenarioCount += 1
    }
  }
  if (scenarioCount < 1) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'FAIL',
      reason: 'Gherkin needs at least one Scenario or Scenario Outline',
    })
  }

  const blockers = (await readOptional(input.layout.blockers)) ?? ''
  if (blockers.trim().length > 0) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'BLOCKED',
      reason: 'unresolved product blockers in blockers.md',
    })
  }

  const srcChanges = await srcDiff(input.cwd, input.srcBefore)
  if (srcChanges.length > 0) {
    // Implementation adaptation: Specifier must not implement product code.
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'FAIL',
      reason: `Specifier must not modify src/: ${srcChanges.join(', ')}`,
      adaptation: 'Specifier src/ diff is an Implementation adaptation of the role table',
    })
  }

  return gateReport({
    ...base,
    endedUtc: utcNow(),
    exitCode: 0,
    verdict: 'PASS',
    reason: `parsed ${scenarioCount} scenario(s)`,
    scenarios: scenarioCount,
  })
}
