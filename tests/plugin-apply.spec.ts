import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Director } from '../src/director.ts'
import { resolveConfig } from '../src/config.ts'
import { requireFreshProvider } from '../src/spawn.ts'
import { mockAgent, setupPlugin, StubProvider } from './helpers.ts'

function tsWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ub-apply-'))
  writeFileSync(join(dir, 'package.json'), '{"name":"tmp"}\n')
  writeFileSync(join(dir, 'tsconfig.json'), '{}\n')
  mkdirSync(join(dir, 'src'))
  return dir
}

describe('plugin apply', () => {
  it('registers command story, tool uncle_bob_story, and skill provider', async () => {
    const { commands, tools, skills } = await setupPlugin()
    expect(commands.registered.map(item => item.name)).toContain('story')
    expect(tools.registered.map(item => item.name)).toContain('uncle_bob_story')
    expect(skills.providers.map(item => item.name)).toContain('uncle-bob-bundled')
    const listed = await skills.providers[0]!.list()
    expect(listed.map((item: { name: string }) => item.name)).toEqual([
      'gherkin-acceptance',
      'coder-tdd',
      'crap-cleanup',
      'architecture-deps',
      'mutation-gaps',
      'black-box-qa',
    ])
  })

  it('skips the story tool when enableStoryTool is false', async () => {
    const { tools } = await setupPlugin({ config: { enableStoryTool: false } })
    expect(tools.registered.map(item => item.name)).not.toContain('uncle_bob_story')
  })

  it('missing spawn provider at start() fails closed', async () => {
    const { ctx } = await setupPlugin({ provider: false })
    expect(() => requireFreshProvider(ctx, 'spawn')).toThrow(/is not registered/)
    const director = new Director(ctx, resolveConfig({ subagentProvider: 'spawn' }))
    const halt = await director.start(
      mockAgent(tsWorkspace()),
      'Implement FizzBuzz',
      new AbortController().signal,
      'command',
    )
    expect(halt.status).toBe('blocked')
    expect(halt.reason).toMatch(/is not registered/)
  })

  it('rejects a provider that inherits parent context', async () => {
    const provider = new StubProvider({ inheritsParentContext: true })
    const { ctx } = await setupPlugin({ provider })
    expect(() => requireFreshProvider(ctx, 'spawn')).toThrow(/inherits parent context/)
  })
})
