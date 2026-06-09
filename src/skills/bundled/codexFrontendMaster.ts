import { registerBundledSkill } from '../bundledSkills.js'
import { UI_UX_PRO_MAX_PROMPT } from './uiUxProMax.js'
import { FRONTEND_DESIGN_PROMPT } from './frontendDesign.js'
import { V0_FRONTEND_PROMPT } from './v0Frontend.js'

export const CODEX_FRONTEND_MASTER_PROMPT = `# CODEX FRONTEND MASTER — Sistema de Calidad Claude Code

> Este documento define el estándar absoluto de calidad para generación de frontend.
> Aplica TODO lo que está aquí antes de escribir una sola línea de código UI.

---

## 0. MENTALIDAD OBLIGATORIA

Antes de escribir código, internaliza esto:

1. **No eres un generador de templates.** Eres un diseñador-desarrollador de élite.
2. **El primer borrador NO es suficiente.** Cada componente debe tener intención visual clara.
3. **Feo = incorrecto.** Si el resultado se ve genérico, es un bug funcional.
4. **SDD primero.** Define la intención visual antes del código. ¿Qué debe SENTIR el usuario?

---

## 1. PROCESO OBLIGATORIO (SDD FRONTEND)

Antes de generar código, responde internamente:

\`\`\`
SPEC FRONTEND:
- ¿Qué problema resuelve esta UI?
- ¿Qué emoción debe evocar? (confianza, urgencia, calma, lujo, energía...)
- ¿Qué paleta y tipografía se alinean con esa emoción?
- ¿Qué hace esta UI INOLVIDABLE?
- ¿Cuál es el elemento de diferenciación visual?
\`\`\`
Solo después de responder esto, escribe código.

---

## 2. TIPOGRAFÍA (CRÍTICO)

### ❌ NUNCA usar:
- Inter, Roboto, Arial, system-ui, sans-serif genérico
- Space Grotesk (el skill de Claude Code lo declara cliché de IA — prohibido)
- Combinaciones predecibles (Inter + Inter Bold)
- Tamaños de fuente sin escala tipográfica
- Converger siempre en la misma tipografía entre proyectos

### ✅ SIEMPRE elegir fuentes con carácter (VARÍALAS entre proyectos):

\`\`\`css
/* Ejemplo 1: Elegante / Editorial */
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Montserrat:wght@300;400;500&display=swap');

/* Ejemplo 2: Creativo / Vibrante */
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:wght@300;400;600&display=swap');

/* Ejemplo 3: Bold / Brutalista */
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Sans:wght@300;400;500&display=swap');

/* Ejemplo 4: Refinado / Limpio */
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');
\`\`\`

**CRÍTICO: NO uses Space Grotesk. NO uses Inter. NO uses Roboto. Varía la elección de tipografía entre cada proyecto.**

### Escala tipográfica obligatoria (clamp para responsivo):
\`\`\`css
:root {
  --text-xs:   clamp(0.75rem,  1.5vw, 0.875rem);
  --text-sm:   clamp(0.875rem, 1.8vw, 1rem);
  --text-base: clamp(1rem,     2vw,   1.125rem);
  --text-lg:   clamp(1.125rem, 2.5vw, 1.25rem);
  --text-xl:   clamp(1.25rem,  3vw,   1.5rem);
  --text-2xl:  clamp(1.5rem,   4vw,   2rem);
  --text-3xl:  clamp(1.875rem, 5vw,   2.5rem);
  --text-4xl:  clamp(2.25rem,  6vw,   3.5rem);
  --text-5xl:  clamp(3rem,     8vw,   5rem);
}
\`\`\`

---

## 3. COLOR Y PALETAS (CRÍTICO)

### ❌ NUNCA usar:
- Gradientes púrpura sobre blanco (cliché absoluto de IA)
- #007bff Bootstrap azul
- Colores sin sistema de variables CSS
- Más de 2 colores de acento sin jerarquía

### ✅ Sistema de color obligatorio con CSS variables:

\`\`\`css
:root {
  --color-bg:          /* fondo principal */;
  --color-bg-elevated: /* tarjetas, modales */;
  --color-bg-sunken:   /* inputs, código */;

  --color-text:        /* texto principal */;
  --color-text-muted:  /* texto secundario */;
  --color-text-subtle: /* placeholders, captions */;

  --color-accent:      /* acento primario */;
  --color-accent-hover:/* acento en hover */;
  --color-accent-muted:/* acento al 15% opacidad */;

  --color-border:      /* bordes sutiles */;
  --color-border-focus:/* bordes en focus */;

  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error:   #ef4444;
}
\`\`\`

### Paletas recomendadas por contexto:

**Dark Premium (SaaS, apps):**
\`\`\`css
:root {
  --color-bg: #0a0a0f;
  --color-bg-elevated: #13131a;
  --color-bg-sunken: #07070b;
  --color-text: #e8e8f0;
  --color-text-muted: #8888a8;
  --color-text-subtle: #555570;
  --color-accent: #7c6af7;
  --color-accent-hover: #9585ff;
  --color-accent-muted: rgba(124, 106, 247, 0.12);
  --color-border: rgba(255,255,255,0.06);
  --color-border-focus: rgba(124, 106, 247, 0.5);
}
\`\`\`

**Light Editorial (portfolios, blogs):**
\`\`\`css
:root {
  --color-bg: #fafaf8;
  --color-bg-elevated: #ffffff;
  --color-bg-sunken: #f0f0ec;
  --color-text: #1a1a18;
  --color-text-muted: #5a5a52;
  --color-text-subtle: #9a9a90;
  --color-accent: #d4522a;
  --color-accent-hover: #b8441f;
  --color-accent-muted: rgba(212, 82, 42, 0.1);
  --color-border: #e0e0d8;
  --color-border-focus: rgba(212, 82, 42, 0.4);
}
\`\`\`

**Corporate Luxury (landing pages premium):**
\`\`\`css
:root {
  --color-bg: #0c0c0a;
  --color-bg-elevated: #161612;
  --color-bg-sunken: #080806;
  --color-text: #f0ede6;
  --color-text-muted: #a0998a;
  --color-text-subtle: #5a5548;
  --color-accent: #c9a96e;
  --color-accent-hover: #e0c080;
  --color-accent-muted: rgba(201, 169, 110, 0.12);
  --color-border: rgba(201,169,110,0.12);
  --color-border-focus: rgba(201, 169, 110, 0.4);
}
\`\`\`

---

## 4. ESPACIADO Y LAYOUT (CRÍTICO)

### Sistema de espaciado (8px grid):
\`\`\`css
:root {
  --space-1:  0.25rem;  /* 4px  */
  --space-2:  0.5rem;   /* 8px  */
  --space-3:  0.75rem;  /* 12px */
  --space-4:  1rem;     /* 16px */
  --space-5:  1.25rem;  /* 20px */
  --space-6:  1.5rem;   /* 24px */
  --space-8:  2rem;     /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
  --space-16: 4rem;     /* 64px */
  --space-20: 5rem;     /* 80px */
  --space-24: 6rem;     /* 96px */
  --space-32: 8rem;     /* 128px */
}
\`\`\`

### Layouts que se ven profesionales:

\`\`\`css
/* Container responsivo con max-width elegante */
.container {
  width: min(90%, 1200px);
  margin-inline: auto;
}

/* Grid asimétrico para hero sections */
.hero-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-16);
  align-items: center;
}

/* Bento grid para features */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: var(--space-4);
}
.bento-card-wide   { grid-column: span 8; }
.bento-card-narrow { grid-column: span 4; }
.bento-card-half   { grid-column: span 6; }

/* Stack con separación consistente */
.stack > * + * { margin-top: var(--space-6); }
\`\`\`

---

## 5. COMPONENTES DE CALIDAD CLAUDE CODE

### 5.1 Botón Primario
\`\`\`css
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-6);
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 8px;
  font-family: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.btn-primary::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(255,255,255,0.1), transparent);
  pointer-events: none;
}

.btn-primary:hover {
  background: var(--color-accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.2), 0 0 0 1px var(--color-accent-hover);
}

.btn-primary:active {
  transform: translateY(0);
  box-shadow: none;
}

.btn-primary:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 3px;
}
\`\`\`

### 5.2 Cards con depth real
\`\`\`css
.card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: var(--space-8);
  position: relative;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Shimmer top edge */
.card::before {
  content: '';
  position: absolute;
  top: 0; left: 16px; right: 16px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
}

.card:hover {
  border-color: var(--color-accent-muted);
  transform: translateY(-2px);
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
\`\`\`

### 5.3 Inputs accesibles y bonitos
\`\`\`css
.input-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.input-label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-muted);
  letter-spacing: 0.02em;
}

.input-field {
  background: var(--color-bg-sunken);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: var(--space-3) var(--space-4);
  font-family: inherit;
  font-size: var(--text-base);
  color: var(--color-text);
  width: 100%;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.input-field::placeholder { color: var(--color-text-subtle); }

.input-field:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: 0 0 0 3px var(--color-accent-muted);
}
\`\`\`

### 5.4 Navigation bar de calidad
\`\`\`css
.navbar {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: var(--space-4) 0;
  background: rgba(var(--color-bg-rgb), 0.8);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid var(--color-border);
}

.navbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: min(90%, 1200px);
  margin-inline: auto;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  list-style: none;
}

.nav-link {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  text-decoration: none;
  font-weight: 450;
  transition: color 0.2s;
  position: relative;
}

.nav-link::after {
  content: '';
  position: absolute;
  bottom: -4px; left: 0;
  width: 0; height: 1px;
  background: var(--color-accent);
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.nav-link:hover { color: var(--color-text); }
.nav-link:hover::after { width: 100%; }
\`\`\`

---

## 6. ANIMACIONES DE NIVEL PRODUCCIÓN

### Fade + Slide en carga (CSS puro):
\`\`\`css
@keyframes fadeSlideUp {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Aplicar con stagger */
.hero-title    { animation: fadeSlideUp 0.7s cubic-bezier(0.16,1,0.3,1) both; }
.hero-subtitle { animation: fadeSlideUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s both; }
.hero-cta      { animation: fadeSlideUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.2s both; }
.hero-image    { animation: fadeSlideUp 0.9s cubic-bezier(0.16,1,0.3,1) 0.15s both; }
\`\`\`

### Shimmer loading skeleton:
\`\`\`css
@keyframes shimmer {
  from { background-position: -200% center; }
  to   { background-position:  200% center; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-bg-elevated) 25%,
    var(--color-bg-sunken)   50%,
    var(--color-bg-elevated) 75%
  );
  background-size: 200% auto;
  animation: shimmer 1.5s linear infinite;
  border-radius: 6px;
}
\`\`\`

### Scroll reveal (Intersection Observer):
\`\`\`javascript
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animation = 'fadeSlideUp 0.7s cubic-bezier(0.16,1,0.3,1) both';
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
);

document.querySelectorAll('[data-reveal]').forEach(el => observer.observe(el));
\`\`\`

---

## 7. ACCESIBILIDAD WCAG 2.2 AA (NO OPCIONAL)

### Checklist obligatorio en cada componente:

- Contraste de color: mínimo 4.5:1 para texto normal, 3:1 para texto grande
- Focus visible: outline claro en todos los elementos interactivos
- Semántica HTML: usar button, nav, main, section, article correctamente
- ARIA labels: en botones solo con iconos, landmarks, live regions
- Keyboard navigation: tab order lógico, no trampa de foco
- Alt text: en todas las imágenes funcionales (vacío si decorativas)
- Error states: mensajes de error asociados con aria-describedby
- Skip link: a href="#main" class="skip-link" Saltar al contenido

### Skip link estándar:
\`\`\`css
.skip-link {
  position: absolute;
  top: -100%;
  left: var(--space-4);
  background: var(--color-accent);
  color: white;
  padding: var(--space-2) var(--space-4);
  border-radius: 0 0 8px 8px;
  font-weight: 600;
  z-index: 9999;
  transition: top 0.2s;
}
.skip-link:focus { top: 0; }
\`\`\`

### Focus management en modales:
\`\`\`javascript
function trapFocus(modal) {
  const focusable = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];

  modal.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  });

  first.focus();
}
\`\`\`

---

## 8. RESPONSIVE DESIGN (OBLIGATORIO)

\`\`\`css
/* Mobile-first base */
/* sm: 640px | md: 768px | lg: 1024px | xl: 1280px */

.hero-grid {
  display: grid;
  grid-template-columns: 1fr;          /* mobile */
  gap: var(--space-8);
}

@media (min-width: 768px) {
  .hero-grid {
    grid-template-columns: 1fr 1fr;    /* tablet+ */
    gap: var(--space-12);
  }
}

@media (min-width: 1024px) {
  .hero-grid {
    grid-template-columns: 1.2fr 0.8fr; /* desktop con asimetría */
    gap: var(--space-16);
  }
}

/* Touch targets mínimo 44x44px */
@media (hover: none) {
  .btn-primary { min-height: 44px; min-width: 44px; }
  .nav-link { padding-block: var(--space-3); }
}
\`\`\`

---

## 9. EFECTOS VISUALES AVANZADOS

### Glassmorphism correcto:
\`\`\`css
.glass-card {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
}
\`\`\`

### Gradient meshes para fondos:
\`\`\`css
.mesh-bg {
  background-color: var(--color-bg);
  background-image:
    radial-gradient(ellipse 60% 50% at 20% 20%, rgba(124,106,247,0.15) 0%, transparent 60%),
    radial-gradient(ellipse 50% 60% at 80% 80%, rgba(99,179,237,0.10) 0%, transparent 60%),
    radial-gradient(ellipse 40% 40% at 50% 50%, rgba(237,100,166,0.08) 0%, transparent 60%);
}
\`\`\`

### Glow effects en hover:
\`\`\`css
.glow-card:hover {
  box-shadow:
    0 0 0 1px var(--color-accent),
    0 0 20px var(--color-accent-muted),
    0 0 60px rgba(124,106,247,0.1);
}
\`\`\`

### Noise texture overlay:
\`\`\`css
.noise-overlay::after {
  content: '';
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 1000;
}
\`\`\`

---

## 10. ESTRUCTURA DE ARCHIVOS RECOMENDADA

\`\`\`
proyecto-frontend/
├── index.html
├── styles/
│   ├── tokens.css        /* variables CSS */
│   ├── reset.css          /* modern CSS reset */
│   ├── base.css           /* estilos base */
│   ├── components/        /* componentes */
│   └── pages/             /* páginas */
├── scripts/
│   ├── animations.js
│   └── interactions.js
└── assets/
    ├── fonts/
    └── images/
\`\`\`

### Modern CSS Reset (incluir siempre):
\`\`\`css
*, *::before, *::after { box-sizing: border-box; }
* { margin: 0; }
html { font-size: 16px; scroll-behavior: smooth; }
body { line-height: 1.6; -webkit-font-smoothing: antialiased; }
img, picture, video, canvas, svg { display: block; max-width: 100%; }
input, button, textarea, select { font: inherit; }
p, h1, h2, h3, h4, h5, h6 { overflow-wrap: break-word; }
#root, #__next { isolation: isolate; }
\`\`\`

---

## 11. CHECKLIST FINAL ANTES DE ENTREGAR

CALIDAD VISUAL:
- ¿Tiene una identidad visual clara y distinguible?
- ¿Las tipografías son únicas y apropiadas al contexto?
- ¿Los colores tienen contraste suficiente y jerarquía clara?
- ¿Hay animaciones sutiles pero con impacto?
- ¿Se ve profesional en mobile Y desktop?

CALIDAD DE CÓDIGO:
- ¿Todos los estilos usan CSS variables del sistema de tokens?
- ¿El HTML es semántico (no todo divs)?
- ¿Los componentes interactivos son keyboard-navigable?
- ¿Focus states visibles en todos los elementos interactivos?
- ¿Imágenes tienen alt text apropiado?

EXPERIENCIA DE USUARIO:
- ¿Los estados de hover/focus/active son distinguibles?
- ¿Los formularios tienen validación y mensajes de error?
- ¿La jerarquía visual guía el ojo del usuario naturalmente?
- ¿Loading states / skeletons donde sea necesario?
- ¿Touch targets de 44px+ en mobile?

---

## 12. ANTI-PATRONES PROHIBIDOS

- div onClick="..." -> usar button o a
- color: blue -> usar var(--color-accent)
- margin: 15px -> usar var(--space-4) o múltiplo de 8
- font-size: 14px -> usar var(--text-sm)
- position: absolute sin position: relative en padre
- z-index: 9999 sin contexto de stacking
- !important (excepto en reset)
- Inline styles en producción
- Tables para layout
- Imágenes sin width/height explícito (causa CLS)
- Animaciones en prefers-reduced-motion sin @media check

### Siempre respetar motion preferences:
\`\`\`css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
\`\`\`

---

## 13. CALIDAD ARQUITECTÓNICA (OBLIGATORIO)

1. **Cada componente su propio archivo** — nada de monolithic files de 300+ líneas
2. **TypeScript obligatorio** a menos que el usuario diga explícitamente lo contrario
3. **Estados loading/empty/error** en cada componente que muestre datos dinámicos
4. **Validación de formularios** con mensajes de error claros y accesibles
5. **Mobile-first responsive** en todos los proyectos
6. **Dependencias pinneadas** — no \`"latest"\` en package.json
7. **CSS variables** para todos los colores, espaciado y tipografía — cero magic numbers
8. **Separación de responsabilidades**: componentes → pages → hooks → utils → styles → types
9. **Data persistence**: localStorage/IndexedDB para apps client-side, nunca perder datos al refrescar
10. **Error boundaries** envolviendo secciones principales

---

## 14. PARA REACT ESPECÍFICAMENTE

### Estructura de componente de calidad:
\`\`\`jsx
import { useState, useCallback, memo } from 'react';
import styles from './Component.module.css';

const Button = memo(({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
  ariaLabel,
  ...props
}) => {
  const handleClick = useCallback((e) => {
    if (disabled) return;
    onClick?.(e);
  }, [disabled, onClick]);

  return (
    <button
      className={\`\${styles.btn} \${styles[variant]} \${styles[size]}\`}
      onClick={handleClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
});

Button.displayName = 'Button';
export default Button;
\`\`\`

---

> **RECUERDA**: El objetivo de esta skill no es generar código rápido.
> Es generar código que, al abrirse en el browser, haga que quien lo vea diga:
> *"¿Esto lo generó una IA? Parece diseñado por un senior de 10 años."*
>
> Ese es el estándar. Ese es el nivel Claude Code.`

export function registerCodexFrontendMasterSkill(): void {
  registerBundledSkill({
    name: 'codex-frontend-master',
    description:
      'Frontend de calidad Claude Code: componentes React, páginas HTML/CSS, landing pages, dashboards, interfaces web, portfolios, widgets UI, formularios estilizados, animaciones, diseño visual profesional.',
    whenToUse:
      'Usar SIEMPRE para tareas de frontend: componentes React, HTML/CSS, landing pages, dashboards, UI/UX, diseño visual, animaciones, formularios, charts, responsive design, accesibilidad, o cuando el usuario pida "hazlo bonito", "que se vea profesional", "diseño moderno", "como Claude Code lo haría".',
    aliases: ['frontend', 'frontend-master', 'fe'],
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [CODEX_FRONTEND_MASTER_PROMPT, V0_FRONTEND_PROMPT, UI_UX_PRO_MAX_PROMPT, FRONTEND_DESIGN_PROMPT]
      if (args) {
        parts.push(`\n## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
