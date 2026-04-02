import { readFileSync } from 'fs';

type MacroShape = {
  VERSION: string;
  PACKAGE_URL?: string;
  NATIVE_PACKAGE_URL?: string;
  BUILD_TIME?: string;
  VERSION_CHANGELOG?: string;
  ISSUES_EXPLAINER?: string;
  FEEDBACK_CHANNEL?: string;
};

// Provide sane default macro values when running the raw sources with `bun run`
// (the production build inlines these via bundler defines).
if (typeof (globalThis as any).MACRO === 'undefined') {
  let version = '0.0.0-dev';
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'));
    version = pkg.version ?? version;
  } catch {
    // ignore – fall back to dev version
  }

  const fallback: MacroShape = {
    VERSION: version,
    PACKAGE_URL: '@anthropic-ai/claude-code',
    NATIVE_PACKAGE_URL: '@anthropic-ai/claude-code',
    BUILD_TIME: undefined,
    VERSION_CHANGELOG: undefined,
    ISSUES_EXPLAINER: 'Report issues at https://github.com/anthropic/claude-code/issues',
    FEEDBACK_CHANNEL: 'https://github.com/anthropic/claude-code/issues',
  };

  (globalThis as any).MACRO = fallback;
}

export {};
