/**
 * CircuitBreaker — Prevents runaway model behavior by limiting
 * repetitive or non-progressive tool call patterns.
 *
 * Tracks state across an entire query() recursive loop. When the
 * breaker trips, it injects a <system-reminder> that forces the
 * model to change approach.
 *
 * Reset counters: when the model does something productive (write,
 * edit, or calls a different tool with different params), the
 * relevant counters are reset.
 */

export interface BreakerState {
  consecutiveReads: number
  consecutiveEdits: number
  consecutiveIdents: number
  totalReads: number
  totalEdits: number
  totalWrites: number
  lastIdenticalSig: string | null
  lastFileRead: string | null
  lastFileEdited: string | null
  tripped: boolean
  tripReason: string | null
}

export function createBreakerState(): BreakerState {
  return {
    consecutiveReads: 0,
    consecutiveEdits: 0,
    consecutiveIdents: 0,
    totalReads: 0,
    totalEdits: 0,
    totalWrites: 0,
    lastIdenticalSig: null,
    lastFileRead: null,
    lastFileEdited: null,
    tripped: false,
    tripReason: null,
  }
}

const LIMITS = {
  MAX_CONSECUTIVE_READS: 5,
  MAX_CONSECUTIVE_EDITS: 4,
  MAX_CONSECUTIVE_IDENTICAL: 3,
  MAX_TOTAL_READS_BEFORE_WRITE: 12,
} as const

export type ToolAction =
  | { type: 'read'; filePath: string }
  | { type: 'write'; filePath: string }
  | { type: 'edit'; filePath: string }
  | { type: 'other'; name: string; params: Record<string, unknown> }

/**
 * Evaluate a tool action against the breaker state.
 * Returns a <system-reminder> string if the breaker trips, or null.
 */
export function evaluateBreaker(
  state: BreakerState,
  action: ToolAction,
): string | null {
  if (state.tripped) return null

  const sig = action.type === 'other'
    ? `${action.name}:${JSON.stringify(action.params)}`
    : `${action.type}:${action.filePath}`

  // Track consecutive identical calls
  if (sig === state.lastIdenticalSig) {
    state.consecutiveIdents++
  } else {
    state.consecutiveIdents = 0
    state.lastIdenticalSig = sig
  }

  if (state.consecutiveIdents >= LIMITS.MAX_CONSECUTIVE_IDENTICAL) {
    state.tripped = true
    state.tripReason = `identical_call_loop`
    return buildTripReminder(
      `You called ${action.type === 'other' ? action.name : action.type} with identical parameters ${state.consecutiveIdents}x in a row. This looks like a loop. Change approach: try a different tool, different parameters, or a different file.`,
    )
  }

  switch (action.type) {
    case 'read': {
      state.consecutiveReads++
      state.totalReads++
      state.lastFileRead = action.filePath

      if (state.consecutiveReads >= LIMITS.MAX_CONSECUTIVE_READS) {
        state.tripped = true
        state.tripReason = `read_loop`
        return buildTripReminder(
          `You have performed ${state.consecutiveReads} consecutive reads. If you need to modify a file, use Edit or Write. If you're searching for something, use Grep. Re-reading the same files won't produce new information.`,
        )
      }

      if (state.totalReads >= LIMITS.MAX_TOTAL_READS_BEFORE_WRITE) {
        state.tripped = true
        state.tripReason = `read_without_write`
        return buildTripReminder(
          `${state.totalReads} reads with zero writes/edits. You need to DO something — write code, edit a file, run a command. Reading alone won't solve the task.`,
        )
      }

      // Reading same file repeatedly? That's a flag
      if (state.lastFileEdited !== action.filePath) {
        const readCount = countRecentReads(state, action.filePath)
        if (readCount >= 3) {
          state.tripped = true
          state.tripReason = `same_file_read_loop`
          return buildTripReminder(
            `You've read "${action.filePath}" ${readCount}x recently. You already know its contents. Move forward: either edit it, or move to a different file.`,
          )
        }
      }

      break
    }

    case 'edit': {
      state.consecutiveEdits++
      state.totalEdits++
      state.lastFileEdited = action.filePath
      // Reset read counter when we actually do something
      state.consecutiveReads = 0

      if (state.consecutiveEdits >= LIMITS.MAX_CONSECUTIVE_EDITS) {
        state.tripped = true
        state.tripReason = `edit_loop`
        return buildTripReminder(
          `You've edited "${action.filePath}" ${state.consecutiveEdits}x. If your edits aren't working, step back, read the error, and try a different approach instead of making more edits.`,
        )
      }
      break
    }

    case 'write': {
      state.totalWrites++
      state.consecutiveReads = 0
      state.consecutiveEdits = 0
      state.consecutiveIdents = 0
      break
    }

    case 'other': {
      // Reset read counter on non-read/edit actions
      state.consecutiveReads = 0
      break
    }
  }

  return null
}

function buildTripReminder(message: string): string {
  return `<system-reminder>
[Circuit Breaker] ${message}
DO NOT retry the same action. Pause, re-evaluate, and choose a different approach.
</system-reminder>`
}

/**
 * Count how many times a file has been read in recent history.
 */
function countRecentReads(state: BreakerState, filePath: string): number {
  // Simplified: just check if it matches the last read file
  if (state.lastFileRead === filePath) return (state.consecutiveReads || 1)
  return 0
}
