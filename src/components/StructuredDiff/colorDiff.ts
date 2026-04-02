import * as colorDiff from 'color-diff-napi'
import type { SyntaxTheme } from 'color-diff-napi'
import { isEnvDefinedFalsy } from '../../utils/envUtils.js'

// color-diff-napi may be absent or export nothing in some environments.
const ColorDiff = (colorDiff as { ColorDiff?: unknown }).ColorDiff ?? null
const ColorFile = (colorDiff as { ColorFile?: unknown }).ColorFile ?? null
const nativeGetSyntaxTheme =
  (colorDiff as { getSyntaxTheme?: (theme: string) => SyntaxTheme }).getSyntaxTheme ??
  (() => null)

export type ColorModuleUnavailableReason = 'env'

/**
 * Returns a static reason why the color-diff module is unavailable, or null if available.
 * 'env' = disabled via CLAUDE_CODE_SYNTAX_HIGHLIGHT
 *
 * The TS port of color-diff works in all build modes, so the only way to
 * disable it is via the env var.
 */
export function getColorModuleUnavailableReason(): ColorModuleUnavailableReason | null {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT)) {
    return 'env'
  }
  return null
}

export function expectColorDiff(): typeof ColorDiff | null {
  return getColorModuleUnavailableReason() === null ? ColorDiff : null
}

export function expectColorFile(): typeof ColorFile | null {
  return getColorModuleUnavailableReason() === null ? ColorFile : null
}

export function getSyntaxTheme(themeName: string): SyntaxTheme | null {
  return getColorModuleUnavailableReason() === null
    ? nativeGetSyntaxTheme(themeName)
    : null
}
