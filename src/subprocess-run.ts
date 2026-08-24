/**
 * Bounded host command execution via ctx.subprocess.
 * Missing service, missing executable, or timeout → caller maps to BLOCKED.
 * @module uncle-bob-harness/subprocess-run
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

const COLLECT = { maxBytes: 256 * 1024 } as const
const GRACE_MS = 5_000

function scrubEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> | undefined {
  if (env === undefined) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/** Collected argv run. */
export interface CommandRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError?: string
}

function readCollected(handle: SubprocessHandle, stream: 'stdout' | 'stderr'): string {
  const reader = handle.collected[stream]
  if (reader === undefined) return ''
  return reader.readFrom(0).text
}

/**
 * Run argv with collected stdio and a timeout.
 * @param args - context, argv, cwd, timeout, signal.
 * @returns collected result (never throws on non-zero exit).
 */
export async function runCommand(args: {
  ctx: Context
  argv: readonly string[]
  cwd: string
  timeoutMs: number
  signal: AbortSignal
  env?: NodeJS.ProcessEnv
}): Promise<CommandRunResult> {
  if (args.ctx.subprocess === undefined) {
    return {
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: 'ctx.subprocess is not available',
    }
  }
  if (args.argv.length === 0 || args.argv[0] === undefined || args.argv[0].length === 0) {
    return {
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: 'command argv is empty',
    }
  }
  let executable: string
  try {
    executable = await args.ctx.subprocess.resolveExecutable(args.argv[0], scrubEnv(args.env), args.signal)
  } catch (error) {
    return {
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: error instanceof Error ? error.message : String(error),
    }
  }
  const timeout = AbortSignal.timeout(args.timeoutMs)
  const combined = AbortSignal.any([args.signal, timeout])
  let handle: SubprocessHandle
  try {
    handle = args.ctx.subprocess.spawn({
      argv: [executable, ...args.argv.slice(1)],
      cwd: args.cwd,
      stdio: { stdin: 'ignore', stdout: COLLECT, stderr: COLLECT },
      graceMs: GRACE_MS,
      signal: combined,
      env: scrubEnv(args.env),
    })
  } catch (error) {
    return {
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: error instanceof Error ? error.message : String(error),
    }
  }
  try {
    const outcome = await handle.done
    return {
      exitCode: outcome.exitCode,
      stdout: readCollected(handle, 'stdout'),
      stderr: readCollected(handle, 'stderr'),
      timedOut: timeout.aborted && !args.signal.aborted,
    }
  } catch (error) {
    return {
      exitCode: null,
      stdout: readCollected(handle, 'stdout'),
      stderr: readCollected(handle, 'stderr'),
      timedOut: timeout.aborted && !args.signal.aborted,
      spawnError: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Tail of captured output for gate reasons.
 * @param text - stdout/stderr.
 * @param max - character cap.
 * @returns truncated tail.
 */
export function outputTail(text: string, max = 2_000): string {
  if (text.length <= max) return text
  return text.slice(text.length - max)
}
