import { feature } from 'bun:bundle'
import { shouldAutoEnableClaudeInChrome } from 'src/utils/claudeInChrome/setup.js'
import { registerBatchSkill } from './batch.js'
import { registerClaudeInChromeSkill } from './claudeInChrome.js'
import { registerDebugSkill } from './debug.js'
import { registerKeybindingsSkill } from './keybindings.js'
import { registerLoremIpsumSkill } from './loremIpsum.js'
import { registerRememberSkill } from './remember.js'
import { registerSimplifySkill } from './simplify.js'
import { registerSkillifySkill } from './skillify.js'
import { registerStuckSkill } from './stuck.js'
import { registerCodexFrontendMasterSkill } from './codexFrontendMaster.js'
import { registerFrontendDesignSkill } from './frontendDesign.js'
import { registerV0FrontendSkill } from './v0Frontend.js'
import { registerUiUxProMaxSkill } from './uiUxProMax.js'
import { registerTestSkill } from './test.js'
import { registerArchitectureSkill } from './architecture.js'
import { registerReviewSkill } from './review.js'
import { registerRefactorSkill } from './refactor.js'
import { registerDocsSkill } from './docs.js'
import { registerCommitSkill } from './commit.js'
import { registerOnboardSkill } from './onboard.js'
import { registerSpecSkill } from './spec.js'
import { registerInstructionsSkill } from './instructions.js'
import { registerSessionSkill } from './session.js'
import { registerSelfTestSkill } from './selfTest.js'
import { registerUpdateConfigSkill } from './updateConfig.js'
import { registerVerifySkill } from './verify.js'
import { registerLearnSkill } from './learn.js'
import { registerApiDesignSkill } from './api-design.js'
import { registerDatabaseSkill } from './database.js'
import { registerDeploySkill } from './deploy.js'
import { registerBackendSecuritySkill } from './backend-security.js'
import { registerAiProviderSkill } from './ai-provider.js'

/**
 * Initialize all bundled skills.
 * Called at startup to register skills that ship with the CLI.
 *
 * To add a new bundled skill:
 * 1. Create a new file in src/skills/bundled/ (e.g., myskill.ts)
 * 2. Export a register function that calls registerBundledSkill()
 * 3. Import and call that function here
 */
export function initBundledSkills(): void {
  registerUpdateConfigSkill()
  registerKeybindingsSkill()
  registerVerifySkill()
  registerDebugSkill()
  registerLoremIpsumSkill()
  registerSkillifySkill()
  registerRememberSkill()
  registerSimplifySkill()
  registerBatchSkill()
  registerStuckSkill()
  registerCodexFrontendMasterSkill()
  registerFrontendDesignSkill()
  registerV0FrontendSkill()
  registerUiUxProMaxSkill()
  registerTestSkill()
  registerArchitectureSkill()
  registerReviewSkill()
  registerRefactorSkill()
  registerDocsSkill()
  registerCommitSkill()
  registerOnboardSkill()
  registerSpecSkill()
  registerInstructionsSkill()
  registerSessionSkill()
  registerSelfTestSkill()
  registerLearnSkill()
  registerApiDesignSkill()
  registerDatabaseSkill()
  registerDeploySkill()
  registerBackendSecuritySkill()
  registerAiProviderSkill()
  if (feature('KAIROS') || feature('KAIROS_DREAM')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerDreamSkill } = require('./dream.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerDreamSkill()
  }
  if (feature('REVIEW_ARTIFACT')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerHunterSkill } = require('./hunter.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerHunterSkill()
  }
  if (feature('AGENT_TRIGGERS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerLoopSkill } = require('./loop.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    // /loop's isEnabled delegates to isKairosCronEnabled() — same lazy
    // per-invocation pattern as the cron tools. Registered unconditionally;
    // the skill's own isEnabled callback decides visibility.
    registerLoopSkill()
  }
  if (feature('AGENT_TRIGGERS_REMOTE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const {
      registerScheduleRemoteAgentsSkill,
    } = require('./scheduleRemoteAgents.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerScheduleRemoteAgentsSkill()
  }
  if (feature('BUILDING_CLAUDE_APPS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerClaudeApiSkill } = require('./claudeApi.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerClaudeApiSkill()
  }
  if (shouldAutoEnableClaudeInChrome()) {
    registerClaudeInChromeSkill()
  }
  if (feature('RUN_SKILL_GENERATOR')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerRunSkillGeneratorSkill } = require('./runSkillGenerator.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    registerRunSkillGeneratorSkill()
  }
}
