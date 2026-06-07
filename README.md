# Claudex

Claudex es una TUI de IA para terminal con proveedores directos. Esta version esta pensada para instalarse con un solo comando, abrir `claudex`, escoger proveedor/modelo desde `/model` y trabajar sin depender de un gateway externo como backend.

## Instalacion Rapida

Instalacion oficial desde npm:

```sh
npm install -g claudex-ai
claudex
```

Instalacion por `curl`:

```sh
curl -fsSL https://raw.githubusercontent.com/JaredBautist/CLAUDEX/main/scripts/install.sh | bash
claudex
```

Tambien puedes instalar directo desde GitHub:

```sh
npm install -g github:JaredBautist/CLAUDEX
claudex
```

El nombre del paquete npm es `claudex-ai`, pero el comando global instalado es siempre:

```sh
claudex
```

## Requisitos

- Node.js 20 o superior.
- npm 9 o superior.
- Cuenta, OAuth o API key del proveedor que quieras usar.

Claudex incluye Bun como dependencia npm para poder abrir la TUI desde una instalacion global. Si el usuario ya tiene `bun` instalado en el sistema, Claudex tambien puede usarlo como fallback.

## Proveedores

Soporte directo actual:

- Claude / Anthropic
- OpenAI / ChatGPT
- Gemini / Google

Desde la TUI usa:

```text
/model
```

Ese comando sirve para elegir proveedor, iniciar sesion o seleccionar modelo.

## Skills Incluidas

Claudex incluye skills internas listas para usar desde la TUI. Se invocan con `/<skill-name>` y algunas estan siempre activas en el system prompt (no requieren invocacion explicita).

### Frontend (Siempre Activos)

Los estandares de calidad frontend estan embebidos directamente en el system prompt — el modelo los tiene disponibles desde el turno 1 sin necesidad de invocar el skill:

- **`/codex-frontend-master`**: Estandares de frontend de calidad Claude Code: tipografia, color, animaciones, accesibilidad, SDD frontend, responsive, glassmorphism, scroll reveal, checklist de calidad.
- **`/frontend-design`**: Skill oficial de Claude Code para diseño frontend distintivo. Instalado en `.claude/skills/` (como Claude Code) — disponible por defecto para todos los usuarios. Design thinking, tipografía única, motion, composición espacial, backgrounds, anti-cliché de IA.
- **`/ui-ux-pro-max`**: Inteligencia de diseno UI/UX: branding por contexto (SaaS, editorial, lujo, gaming, salud), checklist de implementacion, calidad visual.

Los tres se cargan automaticamente al iniciar la sesion. Incluye todos los estandares de:
- Tipografia (Cormorant, Playfair, Bebas Neue, DM Serif, Satoshi, Cabinet Grotesk, etc. — NUNCA Space Grotesk, Inter o Roboto)
- Paletas de color (Dark Premium, Light Editorial, Corporate Luxury)
- Sistema de espaciado 8px grid
- Animaciones (fade + slide, shimmer, scroll reveal)
- Accesibilidad WCAG 2.2 AA
- Glassmorphism, gradient meshes, noise textures
- Anti-patrones prohibidos

### Calidad de Codigo

- **`/verify`**: Verifica que los cambios funcionen — detecta el tipo de proyecto y ejecuta lint → typecheck → test → build automaticamente.
- **`/review`**: Code review a nivel PR: seguridad (inyeccion, auth, secretos), calidad (edge cases, errores,性能), mantenibilidad, dependencias.
- **`/test`**: Escribe y ejecuta tests — analiza el codigo, identifica el framework, genera tests unit/integration/e2e con objetivos de cobertura.
- **`/refactor`**: Refactoring multi-step seguro: analiza → planifica → ejecuta paso a paso → valida. Incluye patrones (extract module, split function, migrate pattern) y anti-patrones.

### Especificacion y Proyecto

- **`/spec`**: Spec-Driven Development — crea y gestiona `.claudex/` con requirements, design, tasks y session memory. Usa `/spec init` para arrancar un nuevo proyecto, `/spec update` para sincronizar specs con el codigo real.

### Diseno y Documentacion

- **`/architecture`**: Diseno de sistemas, Architecture Decision Records (ADRs), analisis de trade-offs, diagramas mermaid. Checklist de escalabilidad, reliability, seguridad, costo, performance.
- **`/docs`**: Genera y actualiza documentacion: README, API docs, changelogs (keepachangelog), contributing guides.
- **`/commit`**: Genera mensajes Conventional Commit y mantiene CHANGELOG basado en el diff del repo.

### Productividad

- **`/simplify`**: Revision paralela de codigo con 3 agentes (reuso, calidad, eficiencia).
- **`/debug`**: Diagnostico de sesiones — lee logs de debug y resuelve problemas de la TUI.
- **`/remember`**: Revision y promocion de memoria (CLAUDE.md).
- **`/onboard`**: Guia interactiva de primeros pasos — configuracion de provider, autenticacion, seleccion de modelo, descubrimiento de skills.
- **`/instructions`**: Gestiona reglas personalizadas del proyecto en `.claudex/instructions/`. Se cargan automaticamente cada turno.
- **`/session`**: Persiste y restaura estado de sesion en `.claudex/session.json`. Usa `/session save` al terminar, `/session resume` al retomar.
- **`/self-test`**: Ejecuta quality checks sobre Claudex mismo (typecheck, build, analisis de codigo).
- **`/batch`**: Orquestacion de trabajo en paralelo a gran escala.
- **`/stuck`**: Investigacion diagnostica a nivel proceso.
- **`/update-config`**: Gestion de configuracion y hooks.

### Sistema de Archivos de Proyecto (`.claudex/`)

Claudex usa un directorio `.claudex/` en la raiz del proyecto para persistir configuracion y contexto entre sesiones:

```
.claudex/
  SPEC.md                    # Especificacion del proyecto (requisitos, diseño, tareas)
  session.json               # Estado de sesion (task actual, archivos, progreso)
  instructions/               # Reglas personalizadas del proyecto
    coding-style.md           # (ejemplo) Convenciones de codigo
    api-conventions.md        # (ejemplo) Reglas de API
  memory/                     # Registros de sesion
    YYYY-MM-DD.md             # Diario de sesion
    MEMORY.md                 # Memoria curada del proyecto
```

Este directorio se auto-descubre al iniciar sesion. No requiere configuracion manual.

### Como Usar

Los skills se pueden invocar directamente o con contexto. El modelo detecta automaticamente cuando debe ejecutar un skill (obligatorio segun el system prompt).

**Skills de especificacion y proyecto:**

```text
/spec init                              # Inicializa .claudex/ con SPEC.md
/spec add-requirement "login con OAuth" # Agrega requisito
/spec task "implementar API REST"       # Agrega tarea
/spec done "implementar API REST"       # Marca tarea completada
/spec update                            # Sincroniza specs con el codigo real
```

**Skills de codigo (ejecucion obligatoria cuando corresponda):**

```text
/review revisa este PR y busca problemas de seguridad
/test genera tests para el modulo de autenticacion
/architecture disena el sistema de pagos
/refactor extrae el modulo de pagos a su propio servicio
/docs genera documentacion para la API REST
/commit                                # Genera mensaje Conventional Commit
```

**Skills de proyecto y configuracion:**

```text
/instructions add coding-style "Usar functional components con hooks"
/instructions list
/session save                          # Guarda estado actual
/session resume                        # Restaura sesion anterior
/onboard                               # Guia de primeros pasos
/self-test                             # Verifica Claudex mismo
```

## Modelo Y Esfuerzo

En una instalacion nueva, Claudex no asume que ya tienes un proveedor real configurado. La TUI debe guiarte desde:

```text
Select your provider and model
```

Usa `/model` para escoger proveedor/modelo y autenticarte cuando haga falta.

Para controlar consumo de tokens y profundidad de respuesta, usa `/effort` dentro de la TUI:

```text
/effort normal
/effort low
/effort medium
/effort high
/effort max
/effort auto
```

`normal` equivale a `medium`, que es el valor recomendado por defecto para no arrancar siempre en alto consumo. `auto` deja que el proveedor/modelo decida cuando aplique.

## Uso

Abrir la TUI:

```sh
claudex
```

Enviar un prompt directo sin abrir la TUI:

```sh
claudex chat "explica este proyecto"
```

Configurar proveedor con API key:

```sh
claudex auth claude
claudex auth openai
claudex auth gemini
```

Guardar una key sin prompt interactivo:

```sh
claudex key openai "$OPENAI_API_KEY"
```

Cambiar proveedor/modelo activo:

```sh
claudex use claude claude-3-5-sonnet-latest
claudex use openai gpt-5.5
claudex use gemini gemini-2.5-pro
```

Ejecutar con override temporal:

```sh
claudex -p openai -m gpt-4o-mini chat "resume el repo"
```

## Configuracion Local

Claudex guarda la configuracion del usuario fuera del repo:

```text
~/.config/claudex/direct-providers.json
~/.config/claudex/claude-runtime/
```

Tambien puedes usar variables de entorno:

```sh
ANTHROPIC_API_KEY=...
ANTHROPIC_AUTH_TOKEN=...
OPENAI_API_KEY=...
GEMINI_API_KEY=...
```

## Desarrollo

Instalar dependencias:

```sh
npm install
```

Ejecutar desde el repo:

```sh
npm start
```

Abrir la TUI desde el codigo fuente:

```sh
node src/direct/chat.js
```

Empaquetar localmente:

```sh
npm pack
```

Probar el paquete local:

```sh
npm install -g ./claudex-ai-0.1.2.tgz
claudex --help
claudex
```

## Publicacion En Npm

El nombre `claudex` ya existe en npm, por eso este proyecto publica como paquete `claudex-ai`:

```json
{
  "name": "claudex-ai",
  "bin": {
    "claudex": "src/direct/chat.js"
  }
}
```

Dry-run antes de publicar:

```sh
npm publish --dry-run --access public --tag next
```

Publicar una nueva version:

```sh
npm login
npm publish --access public
```

El paquete actual ya esta publicado en npm. Cualquier usuario instala:

```sh
npm install -g claudex-ai
claudex
```

## Troubleshooting

Si `claudex` no aparece despues de instalar:

```sh
npm bin -g
npm prefix -g
```

Asegurate de que el directorio global de npm este en tu `PATH`.

Si la TUI no abre, verifica:

```sh
node --version
npm --version
claudex --help
```

Si cambias de proveedor y no hay credenciales guardadas:

```sh
claudex auth openai
claudex use openai gpt-4o-mini
claudex
```
