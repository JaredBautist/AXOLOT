import { registerBundledSkill } from '../bundledSkills.js'

export const V0_FRONTEND_PROMPT = `# v0-Inspired Frontend — Production UI Generation

This skill follows Vercel v0's approach for generating production-grade frontend interfaces. Opinionated defaults, complete code, and meticulous attention to detail.

## Default Stack (Opinionated — Do Not Deviate Unless Asked)

- **Framework**: Next.js App Router (default)
- **Styling**: Tailwind CSS with CSS variable-based colors (bg-primary, text-primary-foreground, etc.)
- **Components**: shadcn/ui (import from "@/components/ui/*", never rewrite them)
- **Icons**: lucide-react only — NEVER inline SVG for icons
- **Fonts**: Inter via next/font (default), Geist for modern projects — avoid generic system fonts

## Code Generation Rules

### Complete Code (CRITICAL)
- ALWAYS write COMPLETE code snippets that can be copied and pasted directly
- NEVER write partial code, fragments, or "// implement this" comments
- NEVER include placeholders for the user to fill in
- Every component must be fully functional

### File Structure
- Use kebab-case for file names: \`login-form.tsx\`, \`user-settings.tsx\`
- One component per file, unless they are trivially small and tightly coupled
- Group related files: components/, hooks/, lib/, app/

### Styling Rules
- Use Tailwind CSS variable-based colors: \`bg-primary\`, \`text-primary-foreground\`, \`bg-muted\`, \`text-muted-foreground\`
- AVOID indigo or blue colors unless the user explicitly requests them
- Use shadcn/ui components whenever possible (Button, Card, Dialog, etc.)
- For every shadcn Button with "outline" variant, set background and text colors explicitly via className
- Generate responsive designs (mobile-first)
- On white backgrounds, use a wrapper element with background color when needed

### Images & Media
- Use \`/placeholder.svg?height={height}&width={width}\` for placeholder images
- NEVER use blob URLs directly in code
- Add alt text for all images (empty alt="" if decorative)
- DO NOT output <svg> for icons — use lucide-react

### Accessibility (Non-Negotiable)
- Semantic HTML: \`<main>\`, \`<header>\`, \`<nav>\`, \`<section>\`, \`<article>\`
- Correct ARIA roles and attributes
- \`sr-only\` Tailwind class for screen reader text
- Alt text on all functional images
- Keyboard navigation and visible focus states

## Design Thinking Phase

BEFORE writing code, plan the implementation:

1. **Project Structure** — What files are needed? What's the component tree?
2. **Data Flow** — Server vs client components. Where does data come from?
3. **Styling Approach** — shadcn/ui defaults or custom? Color palette?
4. **Edge Cases** — Loading, empty, error, and success states for every data view
5. **Accessibility** — Semantic HTML, ARIA, keyboard nav, focus management

## What NOT to Do

- NEVER write shadcn/ui component files — just import from "@/components/ui/*"
- NEVER use inline SVG for icons — always import from lucide-react
- NEVER use indigo/blue as default accent colors
- NEVER write partial code with TODO comments
- NEVER use iframes, videos, or other media that won't render in preview
- NEVER regenerate existing framework files (layout.tsx, globals.css, etc.)
- NEVER output \`next.config.js\` or \`package.json\` for Next.js projects
- NEVER skip loading, empty, or error states

## React Patterns

### Server Components (Priority)
Default to React Server Components for data fetching and rendering.
Only use "use client" when you need: interactivity, useEffect, useState, event handlers, browser APIs.

### Client Components (When Needed)
- "use client" directive at the top
- Minimize client-side state
- Use React hooks (useState, useEffect, useCallback, useMemo) appropriately
- Prevent unnecessary re-renders

### Form Handling
- Use Server Actions for form mutations in Next.js
- Client-side validation with clear error messages
- Progressive enhancement (work without JavaScript if possible)`

export function registerV0FrontendSkill(): void {
  registerBundledSkill({
    name: 'v0-frontend',
    description:
      'Vercel v0-inspired frontend generation: opinionated stack (Next.js + Tailwind + shadcn/ui + Lucide), complete code, accessible, production-grade.',
    whenToUse:
      'Use for any frontend generation task. Especially when the user wants production-ready React/Next.js components with proper structure, styling, and accessibility.',
    aliases: ['v0', 'vercel-frontend', 'next-ui'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [V0_FRONTEND_PROMPT]
      if (args) {
        parts.push(`\n## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
