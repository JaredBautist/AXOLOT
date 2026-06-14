# Arquitectura tecnica

## Objetivo

Eliminar OpenClaw como backend obligatorio y mover Axolot hacia una arquitectura directa: la CLI/TUI debe hablar con los SDKs oficiales de cada proveedor, con streaming nativo y cancelacion real via `AbortController`.

La regla de diseno nueva es: la TUI no debe levantar servidores intermedios para chatear. La seleccion de proveedor vive en una capa limpia de estrategia/fabrica, y cada proveedor maneja su SDK oficial.

La integracion OpenClaw queda como camino legado/transitorio, no como arquitectura objetivo.

## Componentes

### 1) Proveedores directos (`src/direct/providers.js`)

Responsabilidades:

- Implementar una interfaz comun: `streamResponse(prompt, model, onChunk, options)`.
- Usar streaming nativo de cada SDK:
  - Anthropic: `messages.create(..., stream: true)`.
  - OpenAI: `chat.completions.create(..., stream: true)`.
  - Gemini: `generateContentStream(...)`.
- Escribir cada token/chunk inmediatamente al callback.
- Aceptar `AbortController.signal` para cortar la request HTTP real.

### 2) Configuracion local (`src/direct/config.js`)

Responsabilidades:

- Guardar API keys locales por proveedor con `conf`.
- Leer keys desde variables de entorno cuando existan:
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `GEMINI_API_KEY`
- Guardar proveedor activo.
- Guardar modelo default por proveedor.

### 3) Chat directo (`src/direct/chat.js`)

Responsabilidades:

- Exponer comandos:
  - `key <provider> <apiKey>`
  - `use <provider> [model]`
  - `chat [prompt...]`
- Validar API key antes de cargar SDKs pesados.
- Importar proveedores de forma dinamica para mejorar startup.
- Renderizar streaming con `process.stdout.write(chunk)`.
- Capturar `Ctrl+C` y abortar la request de red.

### 4) Launcher legado (`scripts/run-axolot-linux.sh`)

Responsabilidades:

- Resolver ejecutables (`bun`, `openclaw`) desde PATH.
- Leer configuracion local de OpenClaw desde `~/.openclaw/openclaw.json` para evitar llamadas lentas al CLI en el arranque.
- Exponer comandos rapidos:
  - `axolot --login <proveedor>` para OAuth/login del proveedor.
  - `axolot --key <proveedor>` para guardar API key local.
  - `axolot --use <proveedor> <modelo>` para cambiar modelo y arrancar.
  - `axolot --model <provider/model>` para setear un ref completo.
- Levantar OpenClaw gateway si no esta activo.
- Cerrar proxies previos de Axolot del mismo repo.
- Levantar proxy Bun (`src/tools/openclaw-proxy.ts`).
- Exportar variables de compatibilidad Anthropic para la TUI.
- Lanzar la TUI con permisos y workspace actual.

### 5) Gestor de proveedores legado

OpenClaw funciona como estrategia/fabrica de proveedores en el modo legado. Axolot solo maneja refs normalizadas:

- `openai/gpt-5.5`
- `openai-codex/gpt-5.5`
- `anthropic/claude-sonnet-4-5`
- `google/gemini-2.5-pro`
- `openrouter/tencent/hy3-preview:free`
- `ollama/qwen2.5-coder:7b`

La autenticacion se guarda fuera del repo, en el estado local de OpenClaw (`~/.openclaw/...`). Asi se puede cambiar de IA sin reconfigurar Axolot desde cero.

### 6) TUI (`/model`)

El comando `/model` mantiene la experiencia rapida:

- Muestra proveedores comunes primero.
- Al elegir proveedor ofrece `Sign in / OAuth`, `Paste API key` o `Enter model name`.
- No carga el catalogo completo de modelos al abrir, porque `openclaw models list` puede tardar varios segundos.
- Carga modelos detectados solo bajo demanda con `Show detected models`.

### 7) Proxy legado (`src/tools/openclaw-proxy.ts`)

Responsabilidades:

- Exponer endpoint con forma Anthropic (`/v1/messages`).
- Convertir mensajes Anthropic a formato OpenAI Chat Completions.
- Reenviar al upstream OpenClaw.
- Reconvertir respuesta a stream SSE estilo Anthropic.
- Mapear tool calls entre formatos.
- Redactar secretos en logs.
- Enforce de seguridad local-only por defecto para evitar exfiltracion accidental de token.

### 8) TUI legacy (`src/dev-entry.ts` -> `src/main.tsx`)

- Entrypoint del cliente CLI.
- Consume endpoints Anthropic-style.
- Opera contra el proxy local.

## Flujo de datos

### Directo

1. Usuario ejecuta `node src/direct/chat.js chat "..."`.
2. `chat.js` lee proveedor/modelo/key desde `conf` o env vars.
3. `providers.js` instancia el SDK oficial.
4. El SDK abre streaming nativo con `stream: true`.
5. Cada chunk se escribe directo en `stdout`.
6. `Ctrl+C` aborta la request HTTP.

### Legado

1. Usuario ejecuta `axolot`.
2. El launcher inicia gateway/proxy.
3. TUI envia request a `ANTHROPIC_API_URL` (proxy local).
4. Proxy adapta payload y consulta OpenClaw.
5. OpenClaw usa el proveedor/modelo configurado.
6. Proxy traduce respuesta y la TUI la renderiza.

## Puertos

- Modo directo: no usa puertos ni servidor local.
- Modo legado: OpenClaw gateway `18789`; proxy local `8787` con fallback.

## Decisiones clave

- Priorizar streaming nativo directo para bajar time-to-first-token.
- Mantener contrato Anthropic en frontend solo mientras se migra la TUI completa.
- Aislar configuracion en `.axolot_tmp` para no contaminar configuracion global.
- Mantener API keys fuera del repo mediante `conf` o variables de entorno.
- Evitar llamadas lentas al CLI de OpenClaw durante arranque normal.
- No cargar catalogos grandes de modelos hasta que el usuario lo pida.
- Cargar skills por pack para balancear cobertura técnica vs costo de tokens.

## Contexto del proyecto

Axolot brilla porque puede leer archivos locales y usar herramientas contra el workspace. Para multiples proveedores conviene conservar esa ventaja con herramientas y lectura selectiva, no pegando todo el directorio al prompt.

No recomendado:

- Inyectar todos los archivos con `fs.readFileSync` en cada `sendMessage()`.
- Leer `node_modules`, `.git`, builds, logs o archivos binarios.
- Mandar secretos locales al modelo por accidente.

Recomendado:

- Dar al modelo un resumen del arbol (`rg --files`, filtrado por `.gitignore`).
- Leer archivos bajo demanda con herramientas.
- Inyectar solo archivos relevantes para la pregunta.
- Mantener allowlist/denylist de rutas.
- Resumir archivos grandes antes de enviarlos.

## Riesgos actuales

- Proxy tiene varias rutas fallback; conviene testear solo rutas soportadas por la version de OpenClaw objetivo.
- Si desactivas `AXOLOT_UPSTREAM_LOCAL_ONLY`, revisa bien el host upstream antes de usar tokens productivos.
- Algunos proveedores requieren configuracion adicional en OpenClaw antes de que `--login` o `--key` sean suficientes.

## Mejoras tecnicas recomendadas

1. Agregar tests de regresion del adaptador de mensajes y tool calls.
2. Instrumentar proxy con logs json y niveles (`info/warn/error`).
3. Agregar tests de seguridad para validacion local-only y sanitizacion de logs.
4. Agregar un indice ligero de workspace para contexto selectivo.
