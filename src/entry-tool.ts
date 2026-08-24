/**
 * Model-facing `uncle_bob_story` tool. Same FSM as `/story`.
 * @module uncle-bob-harness/entry-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import type { Director } from './director.ts'

const DESCRIPTION
  = 'Run the Uncle Bob assembly line for one User Story. Use only when the human already asked for the Uncle Bob pipeline or /story is unavailable.'

/**
 * Register the model-facing story tool.
 * @param ctx - context with ctx.tools.
 * @param director - shared FSM driver.
 */
export function registerStoryTool(ctx: Context, director: Director): void {
  ctx.tools.register(defineTool({
    name: 'uncle_bob_story',
    description: DESCRIPTION,
    parameters: {
      story: {
        type: 'string',
        required: true,
        description: 'The single User Story to run through Specifier → Coder → Cleaner → Hardener → QA.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          storyId: { type: 'string', required: true },
          reportPath: { type: 'string', required: true },
          report: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.report }],
    },
    presentCall: args => ({ card: 'generic', title: 'uncle-bob-story', rawInput: args.story }),
    presentResult: () => ({ card: 'generic' }),
    async execute(args, exec) {
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error('uncle_bob_story requires a calling agent (exec.agent was undefined)')
      }
      const story = args.story.trim()
      if (story.length === 0) throw new Error('story must be a non-empty string')
      const halt = await director.start(parent, story, exec.signal, 'tool')
      return {
        status: halt.status,
        storyId: halt.storyId,
        reportPath: halt.reportPath,
        report: halt.reportText,
      }
    },
  }))
}
