import { registerBundledSkill } from '../bundledSkills.js'

const UI_UX_PRO_MAX_PROMPT = `# UI/UX Pro Max

You are using the UI/UX Pro Max design intelligence skill, adapted for Claudex as a bundled frontend skill.

Source inspiration: nextlevelbuilder/ui-ux-pro-max-skill, MIT licensed.

## When To Use

Use this skill whenever the task changes how an interface looks, feels, moves, or is interacted with:

- Building or refactoring frontend pages, landing pages, dashboards, admin panels, SaaS apps, e-commerce, portfolios, blogs, mobile apps, or component libraries.
- Creating or improving UI components such as buttons, modals, navbars, sidebars, cards, tables, forms, charts, dialogs, and toolbars.
- Choosing visual direction, color palette, typography, spacing, layout, motion, accessibility, responsive behavior, or design-system tokens.
- Reviewing UI code for professional polish, usability, accessibility, visual consistency, and mobile/desktop fit.

Skip this skill for pure backend, database, infrastructure, or non-visual automation work.

## Core Priorities

Follow these priorities in order:

1. Accessibility: contrast, keyboard navigation, semantic labels, focus states, reduced motion, readable text.
2. Touch and interaction: 44px minimum touch targets, visible loading/error/success states, no hover-only critical actions.
3. Layout and responsive behavior: mobile-first, no horizontal overflow, stable dimensions, clear hierarchy, predictable navigation.
4. Style selection: match the visual language to the product domain; avoid mixing incompatible styles.
5. Typography and color: use semantic tokens, readable scale, consistent font pairing, and accessible foreground/background pairs.
6. Motion: use transform/opacity, 150-300ms micro-interactions, meaningful transitions, and prefers-reduced-motion.
7. Forms and feedback: visible labels, inline errors, helper text, retry/recovery paths, autosave for long forms when appropriate.
8. Data and charts: legends, tooltips, accessible colors, clear axes, avoid relying on color alone.

## Product-To-Design Reasoning

Before designing, infer the product type and choose an appropriate UI direction:

- SaaS, CRM, admin, finance, developer tools: quiet, dense, utilitarian, scannable, restrained styling.
- Landing pages, products, venues, portfolios: strong first-viewport product signal, real imagery or meaningful visuals, clear CTA.
- Wellness, beauty, lifestyle: calm spacing, soft contrast, warm but accessible color systems.
- Gaming, creative, music, youth brands: more expressive, interactive, animated, and illustrative.
- Healthcare, government, education, legal: trust, clarity, accessibility, conservative motion, predictable navigation.
- E-commerce: product visibility, comparison, filtering, checkout clarity, trust and return/shipping details.

Do not default to generic purple/blue gradients, oversized marketing cards, decorative blobs, emoji icons, or one-note palettes.

## Implementation Checklist

When editing code:

- Inspect the existing framework, design system, component library, and CSS conventions before adding new patterns.
- Use the project's existing components and utilities first.
- Prefer lucide or the existing icon library for icons.
- Use stable dimensions for boards, grids, toolbars, counters, tiles, buttons, and cards to prevent layout shift.
- Ensure text fits inside containers at mobile and desktop sizes.
- Keep cards for repeated items, modals, and framed tools; avoid cards inside cards.
- Use semantic HTML and ARIA only where needed.
- Verify responsive behavior at approximately 375px, 768px, 1024px, and 1440px.
- If a dev server exists, run it and inspect the result with screenshots or browser checks when possible.

## Quality Bar

The final UI should feel intentional, domain-appropriate, accessible, responsive, and usable on the first screen. If the current request is vague, make a conservative design choice that matches the app's domain and existing visual language, then implement it.`

export function registerUiUxProMaxSkill(): void {
  registerBundledSkill({
    name: 'ui-ux-pro-max',
    description:
      'Frontend UI/UX design intelligence for building, improving, reviewing, and polishing web/mobile interfaces, components, layouts, design systems, accessibility, responsive behavior, color, typography, and motion.',
    whenToUse:
      'Use for frontend, UI, UX, visual design, design systems, landing pages, dashboards, components, responsive layouts, accessibility, colors, typography, animation, forms, charts, and interface polish.',
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [UI_UX_PRO_MAX_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
