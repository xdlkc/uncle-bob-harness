import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('loader-compose', () => {
  it('inserts uncle-bob-director onto an empty entry list', () => {
    const raw = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
    const patches = parse(raw) as Parameters<typeof applyEntryPatches>[1]
    const warnings: string[] = []
    const entries = applyEntryPatches([], patches, (message, ...args) => {
      warnings.push([message, ...args].join(' '))
    })
    expect(warnings).toEqual([])
    expect(entries).toEqual([
      expect.objectContaining({
        id: 'uncle-bob-director',
        name: 'uncle-bob-harness',
      }),
    ])
    expect(entries[0]?.config).toMatchObject({
      subagentProvider: 'spawn',
      artifactRoot: '.uncle-bob',
      startOnFirstUserMessage: true,
      enableStoryTool: true,
    })
  })
})
