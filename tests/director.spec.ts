import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Director } from '../src/director.ts'
import { resolveConfig } from '../src/config.ts'
import { stageLabel } from '../src/prompts.ts'
import { mockAgent, setupPlugin, StubProvider } from './helpers.ts'

function tsWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ub-dir-'))
  writeFileSync(join(dir, 'package.json'), '{"name":"tmp"}\n')
  writeFileSync(join(dir, 'tsconfig.json'), '{}\n')
  mkdirSync(join(dir, 'src'))
  mkdirSync(join(dir, 'tests'))
  return dir
}

describe('director.start', () => {
  it('spawns Specifier with the story text and persona', async () => {
    const provider = new StubProvider()
    const { ctx } = await setupPlugin({
      provider,
      config: { retryBudget: 0, unitCommand: ['node', '-e', 'process.exit(0)'] },
    })
    const cwd = tsWorkspace()
    const director = new Director(ctx, resolveConfig({
      subagentProvider: 'spawn',
      retryBudget: 0,
      snapshotOnPass: false,
    }))
    const halt = await director.start(
      mockAgent(cwd),
      'Implement FizzBuzz for n=1..100',
      new AbortController().signal,
      'command',
    )
    expect(provider.requests.length).toBeGreaterThanOrEqual(1)
    expect(provider.requests[0]?.label).toBe(stageLabel('specifier'))
    const text = (provider.requests[0]?.prompt[0] as { type: string; text: string }).text
    expect(text).toContain('Implement FizzBuzz for n=1..100')
    expect(provider.requests[0]?.persona).toContain('You are a Specifier')
    expect(provider.requests[0]?.toolFilter).toEqual({
      deny: expect.arrayContaining(['subagent', 'uncle_bob_story', 'ralph', 'workflow']),
    })
    expect(provider.disposed).toBeGreaterThanOrEqual(1)
    expect(halt.status).toBe('blocked')
  })

  it('rejects a second concurrent start on the same agent', async () => {
    let release!: () => void
    const hang = new Promise<void>(resolve => { release = resolve })
    const provider = new StubProvider()
    provider.hang = hang
    const { ctx } = await setupPlugin({ provider })
    const cwd = tsWorkspace()
    const director = new Director(ctx, resolveConfig({ subagentProvider: 'spawn', retryBudget: 0 }))
    const agent = mockAgent(cwd, 'same')
    const first = director.start(agent, 'story one', new AbortController().signal, 'command')
    await vi.waitFor(() => {
      expect(provider.requests.length).toBe(1)
    })
    const second = await director.start(agent, 'story two', new AbortController().signal, 'command')
    expect(second.status).toBe('blocked')
    expect(second.reason).toMatch(/already running/)
    expect(provider.requests.length).toBe(1)
    release()
    await first
  })

  it('Specifier FAIL retries with gate JSON until retryBudget then blocks', async () => {
    const provider = new StubProvider()
    const { ctx } = await setupPlugin({ provider })
    const cwd = tsWorkspace()
    provider.onStart = async () => {
      const dir = join(cwd, '.uncle-bob')
      const stories = readdirSync(dir).filter(name => name.startsWith('story-'))
      const root = join(dir, stories[0]!)
      writeFileSync(join(root, 'acceptance.feature'), 'this is not gherkin\n')
      writeFileSync(join(root, 'qa.md'), 'cases\n')
      writeFileSync(join(root, 'blockers.md'), '')
    }
    const director = new Director(ctx, resolveConfig({
      subagentProvider: 'spawn',
      retryBudget: 1,
      snapshotOnPass: false,
    }))
    const halt = await director.start(
      mockAgent(cwd, 'retry'),
      'Implement FizzBuzz',
      new AbortController().signal,
      'command',
    )
    expect(halt.status).toBe('blocked')
    expect(provider.requests.length).toBe(2)
    expect(provider.requests[1]?.label).toBe('Specifier')
    const retryPrompt = (provider.requests[1]?.prompt[0] as { text: string }).text
    expect(retryPrompt).toMatch(/Last gate report|gherkin-parse|verdict/)
  })
})
