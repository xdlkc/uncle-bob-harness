/**
 * Headless / first user message wiring. Re-exports the pre-step handler.
 * @module uncle-bob-harness/entry-first-message
 */

export { createPreStepHandler, extractStoryText } from './park.ts'
export type { PreStepPayload, StoryRunner } from './park.ts'
