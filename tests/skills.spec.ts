import { describe, expect, it } from 'vitest'
import { bundledSkillNames } from '../src/skills-provider.ts'
import { DEFAULT_CONFIG } from '../src/config.ts'
import { setupPlugin } from './helpers.ts'

describe('bundled skills and child deny-list', () => {
  it('lists six short bundled skills', async () => {
    expect(bundledSkillNames()).toEqual([
      'gherkin-acceptance',
      'coder-tdd',
      'crap-cleanup',
      'architecture-deps',
      'mutation-gaps',
      'black-box-qa',
    ])
    const { skills } = await setupPlugin()
    const listed = await skills.providers[0]!.list() as Array<{ name: string; rank: number; invocation: { modelInvocable: boolean; userInvocable: boolean } }>
    expect(listed).toHaveLength(6)
    for (const skill of listed) {
      expect(skill.rank).toBe(600)
      expect(skill.invocation).toEqual({ modelInvocable: true, userInvocable: false })
      const def = await skills.providers[0]!.get(skill) as { content: string }
      expect(def.content.split('\n').length).toBeLessThanOrEqual(40)
    }
  })

  it('childToolDeny includes uncle_bob_story and subagent; skill is not denied', () => {
    expect(DEFAULT_CONFIG.childToolDeny).toEqual(expect.arrayContaining([
      'subagent',
      'ralph',
      'workflow',
      'uncle_bob_story',
    ]))
    expect(DEFAULT_CONFIG.childToolDeny).not.toContain('skill')
  })
})
