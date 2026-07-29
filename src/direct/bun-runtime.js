import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Resolve Bun to a directly executable file.
 *
 * npm creates `node_modules/.bin/bun.cmd` on Windows, but `.cmd` files cannot
 * be launched directly by Node's spawnSync without a shell and fail with
 * EINVAL. The `bun` package also installs the native executable, so prefer it.
 */
export function resolveBunExecutable(repoRoot, platform = process.platform) {
  const candidates =
    platform === 'win32'
      ? [
          resolve(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
          resolve(repoRoot, 'node_modules', '.bin', 'bun.exe'),
        ]
      : [
          resolve(repoRoot, 'node_modules', '.bin', 'bun'),
          resolve(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
        ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  return platform === 'win32' ? 'bun.exe' : 'bun'
}
