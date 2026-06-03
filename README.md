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

Claudex incluye skills internas listas para usar desde la TUI. Para frontend, UI y UX viene integrada:

```text
/ui-ux-pro-max
```

Esta skill se tiene en cuenta para construir, revisar y mejorar interfaces: landing pages, dashboards, SaaS, admin panels, e-commerce, portfolios, componentes, responsive design, accesibilidad, colores, tipografia, animaciones, formularios y charts.

Tambien puedes invocarla con contexto:

```text
/ui-ux-pro-max revisa este dashboard y mejora la jerarquia visual
```

La integracion esta inspirada en `nextlevelbuilder/ui-ux-pro-max-skill` y adaptada como prompt interno bundled para que cualquier instalacion global de Claudex la tenga disponible sin instalar plugins aparte.

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
