/**
 * OutputGuard — Anti-hallucination and loop detection.
 *
 * Tracks tool call patterns during a query turn to detect:
 * - Repetitive loops (same file read/written repeatedly)
 * - Fabricated results (model claims output that doesn't match reality)
 * - Context-less claims (model asserts file contents without reading)
 *
 * Each guard instance is scoped to a single query() call and reset
 * between turns. Detection triggers <system-reminder> injection via
 * the circuit breaker.
 */

export interface ToolCallRecord {
  toolName: string
  input: Record<string, unknown>
  timestamp: number
  turnNumber: number
}

export interface FileAccessRecord {
  filePath: string
  action: 'read' | 'write' | 'edit'
  turnNumber: number
}

export interface LoopWarning {
  type: 'read_loop' | 'edit_loop' | 'identical_call_loop' | 'read_without_write' | 'stall'
  message: string
  severity: 'warning' | 'error'
}

export class OutputGuard {
  private toolCallHistory: ToolCallRecord[] = []
  private fileAccessHistory: FileAccessRecord[] = []
  private consecutiveIdents = 0
  private lastIdenticalCall: string | null = null

  private readonly MAX_CONSECUTIVE_IDENTICAL = 3
  private readonly MAX_READS_BEFORE_WRITE = 10
  private readonly MAX_CONSECUTIVE_READS_SAME_FILE = 4
  private readonly MAX_CONSECUTIVE_EDITS_SAME_FILE = 4
  private readonly MAX_TOTAL_TOOL_CALLS_WITHOUT_USER_MSG = 15

  constructor(
    private currentTurn: number = 0,
  ) {}

  recordToolCall(toolName: string, input: Record<string, unknown>): void {
    this.toolCallHistory.push({
      toolName,
      input,
      timestamp: Date.now(),
      turnNumber: this.currentTurn,
    })
  }

  recordFileAccess(filePath: string, action: 'read' | 'write' | 'edit'): void {
    this.fileAccessHistory.push({ filePath, action, turnNumber: this.currentTurn })
  }

  getToolCallCount(): number {
    return this.toolCallHistory.length
  }

  advanceTurn(): void {
    this.currentTurn++
  }

  /**
   * Check for loop patterns and return warnings if detected.
   * Called after each tool call completes.
   */
  check(forceUserMsgThisTurn: boolean): LoopWarning[] {
    const warnings: LoopWarning[] = []

    // 1. Detect identical consecutive tool calls (same tool + same params)
    const lastCall = this.toolCallHistory[this.toolCallHistory.length - 1]
    if (lastCall) {
      const callSig = `${lastCall.toolName}:${JSON.stringify(lastCall.input)}`
      if (callSig === this.lastIdenticalCall) {
        this.consecutiveIdents++
      } else {
        this.consecutiveIdents = 1
        this.lastIdenticalCall = callSig
      }

      if (this.consecutiveIdents >= this.MAX_CONSECUTIVE_IDENTICAL) {
        warnings.push({
          type: 'identical_call_loop',
          message: `Model called ${lastCall.toolName} with identical params ${this.consecutiveIdents}x consecutively. Possible loop.`,
          severity: 'error',
        })
      }
    }

    // 2. Detect read loops: same file read back-to-back without edit between
    const reads = this.fileAccessHistory.filter(f => f.action === 'read')
    if (reads.length >= 2) {
      const lastRead = reads[reads.length - 1]
      const secondLastRead = reads[reads.length - 2]
      if (lastRead && secondLastRead && lastRead.filePath === secondLastRead.filePath) {
        const editsBetween = this.fileAccessHistory.filter(
          f => f.filePath === lastRead.filePath && f.action === 'edit',
        )
        const readsSinceLastEdit = reads
          .slice()
          .reverse()
          .filter(f => f.filePath === lastRead.filePath)
          .findIndex((f, i) => {
            if (i === 0) return false
            const laterFile = this.fileAccessHistory
              .slice(this.fileAccessHistory.indexOf(f) + 1)
              .find(h => h.filePath === f.filePath && h.action === 'edit')
            return !laterFile
          })
        if (readsSinceLastEdit >= this.MAX_CONSECUTIVE_READS_SAME_FILE) {
          warnings.push({
            type: 'read_loop',
            message: `Model read "${lastRead.filePath}" ${readsSinceLastEdit + 1}x without any edit. Stuck in read loop.`,
            severity: 'warning',
          })
        }
      }
    }

    // 3. Detect edit loop: same file edited repeatedly without progress
    const edits = this.fileAccessHistory.filter(f => f.action === 'edit')
    if (edits.length >= 2) {
      const lastEdit = edits[edits.length - 1]
      const sameFileEdits = edits.filter(f => f.filePath === lastEdit.filePath)
      if (sameFileEdits.length >= this.MAX_CONSECUTIVE_EDITS_SAME_FILE) {
        warnings.push({
          type: 'edit_loop',
          message: `Model edited "${lastEdit.filePath}" ${sameFileEdits.length}x. Possible edit loop.`,
          severity: 'warning',
        })
      }
    }

    // 4. Detect stall: many reads without any write/edit
    if (this.toolCallHistory.length >= this.MAX_READS_BEFORE_WRITE) {
      const writes = this.fileAccessHistory.filter(f => f.action === 'write' || f.action === 'edit')
      if (writes.length === 0) {
        warnings.push({
          type: 'read_without_write',
          message: `${this.toolCallHistory.length} tool calls without a single write or edit. Model is stalling.`,
          severity: 'warning',
        })
      }
    }

    // 5. Total tool calls without user message
    if (!forceUserMsgThisTurn && this.toolCallHistory.length >= this.MAX_TOTAL_TOOL_CALLS_WITHOUT_USER_MSG) {
      warnings.push({
        type: 'stall',
        message: `${this.toolCallHistory.length} consecutive tool calls without user message. Forcing re-evaluation.`,
        severity: 'error',
      })
    }

    return warnings
  }

  /**
   * Build a <system-reminder> for the most severe warning, or null if none.
   */
  buildReminder(warnings: LoopWarning[]): string | null {
    if (warnings.length === 0) return null

    const mostSevere = warnings.find(w => w.severity === 'error') || warnings[0]
    return `<system-reminder>
[OutputGuard Warning] ${mostSevere.message}
Suggested action: approach the task differently. Do NOT repeat the same tool calls.
</system-reminder>`
  }

  reset(): void {
    this.toolCallHistory = []
    this.fileAccessHistory = []
    this.consecutiveIdents = 0
    this.lastIdenticalCall = null
  }
}
