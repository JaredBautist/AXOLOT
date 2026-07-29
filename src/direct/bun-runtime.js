import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const requireFromHere = createRequire(import.meta.url)

function resolveInstalledBunExecutable() {
  try {
    const packageDir = dirname(requireFromHere.resolve('bun/package.json'))
    return resolve(packageDir, 'bin', 'bun.exe')
  } catch {
    return null
  }
}

/**
 * Resolve Bun to a directly executable file.
 *
 * npm creates `node_modules/.bin/bun.cmd` on Windows, but `.cmd` files cannot
 * be launched directly by Node's spawnSync without a shell and fail with
 * EINVAL. The `bun` package also installs the native executable, so prefer it.
 */
export function resolveBunExecutable(repoRoot, platform = process.platform) {
  const installedPackageBin = resolveInstalledBunExecutable()
  const candidates =
    platform === 'win32'
      ? [
          resolve(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
          installedPackageBin,
          resolve(repoRoot, '..', 'bun', 'bin', 'bun.exe'),
          resolve(repoRoot, 'node_modules', '.bin', 'bun.exe'),
        ]
      : [
          resolve(repoRoot, 'node_modules', '.bin', 'bun'),
          installedPackageBin,
          resolve(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
          resolve(repoRoot, '..', 'bun', 'bin', 'bun.exe'),
        ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }

  return platform === 'win32' ? 'bun.exe' : 'bun'
}
