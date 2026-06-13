import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { registerBundledSkill } from '../bundledSkills.js'
import { SKILL_FILES, SKILL_MD } from './verifyContent.js'

const { frontmatter, content: SKILL_BODY } = parseFrontmatter(SKILL_MD)

const DESCRIPTION =
  typeof frontmatter.description === 'string'
    ? frontmatter.description
    : 'Verify code changes work by running tests, linters, type-checkers, and builds. Validates correctness after any edit.'

const WHEN_TO_USE =
  typeof frontmatter.when_to_use === 'string'
    ? frontmatter.when_to_use
    : 'After editing code, refactoring, fixing bugs, or any non-trivial change. Run to confirm nothing is broken before reporting done.'

export function registerVerifySkill(): void {
  registerBundledSkill({
    name: 'verify',
    description: DESCRIPTION,
    whenToUse: WHEN_TO_USE,
    userInvocable: true,
    files: SKILL_FILES,
    async getPromptForCommand(args) {
      const parts: string[] = [SKILL_BODY.trimStart()]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
