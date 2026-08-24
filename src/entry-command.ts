/**
 * `/story` command: no parent model turn.
 * @module uncle-bob-harness/entry-command
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type { Director } from './director.ts'

/**
 * Register `/story` when a command registry is composed.
 * @param commandCtx - context that has ctx.commands.
 * @param director - shared FSM driver.
 */
export function registerStoryCommand(commandCtx: Context, director: Director): void {
  commandCtx.commands.register({
    name: 'story',
    description: 'Run the Uncle Bob assembly line for one User Story',
    input: { hint: '<user story text>' },
    recordInput: true,
    async handler({ agent, rawInput, signal }) {
      const story = rawInput.trim()
      if (story.length === 0) return { kind: 'error', text: 'Usage: /story <user story>' }
      const halt = await director.start(agent, story, signal, 'command')
      return halt.status === 'passed'
        ? { kind: 'success', text: halt.reportText }
        : { kind: 'error', text: halt.reportText }
    },
  })
}
