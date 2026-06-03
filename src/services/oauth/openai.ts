import { createServer } from 'http'
import { createHash, randomBytes } from 'crypto'

const OPENAI_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const SCOPES =
  'openid profile email offline_access api.connectors.read api.connectors.invoke'
const ORIGINATOR = 'codex_cli_rs'
const CALLBACK_PORT = 1455
const CALLBACK_PORT_FALLBACK = 1457
const CALLBACK_PATH = '/auth/callback'
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`
const TIMEOUT_MS = 5 * 60 * 1000

function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function generateCodeVerifier(): string {
  return base64URLEncode(randomBytes(32))
}

function generateCodeChallenge(verifier: string): string {
  return base64URLEncode(createHash('sha256').update(verifier).digest())
}

function generateState(): string {
  return base64URLEncode(randomBytes(32))
}

export function isJWTExpired(token: string, marginSec = 60): boolean {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return true
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64').toString('utf-8'),
    )
    if (!payload.exp) return false
    return Date.now() / 1000 + marginSec >= payload.exp
  } catch {
    return true
  }
}

export type OpenAIOAuthResult = {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}

export class OpenAIOAuthService {
  private verifier: string
  private state: string
  private server: ReturnType<typeof createServer> | null = null
  private callbackResolve: ((code: string) => void) | null = null
  private callbackReject: ((err: Error) => void) | null = null
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.verifier = generateCodeVerifier()
    this.state = generateState()
  }

  async startFlow(
    onOpenBrowser: (url: string) => void,
  ): Promise<OpenAIOAuthResult> {
    const challenge = generateCodeChallenge(this.verifier)
    await this.startServer()

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: ORIGINATOR,
      state: this.state,
    })
    const authUrl = `${OPENAI_AUTH_URL}?${params.toString()}`

    onOpenBrowser(authUrl)

    const authCode = await this.waitForCallback()

    const tokens = await this.exchangeCode(authCode)

    this.cleanup()

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
    }
  }

  private startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer()
      this.server.on('request', this.handleRequest.bind(this))

      const tryPort = (port: number) => {
        this.server!.listen(port, '127.0.0.1', () => {
          resolve()
        })
        this.server!.once('error', (err: Error) => {
          if (
            (err as any).code === 'EADDRINUSE' &&
            port === CALLBACK_PORT
          ) {
            tryPort(CALLBACK_PORT_FALLBACK)
          } else {
            reject(
              new Error(
                `Failed to start OAuth server on port ${port}: ${err.message}`,
              ),
            )
          }
        })
      }

      tryPort(CALLBACK_PORT)
    })
  }

  private handleRequest(
    req: import('http').IncomingMessage,
    res: import('http').ServerResponse,
  ): void {
    const url = new URL(
      req.url || '',
      `http://${req.headers.host || '127.0.0.1'}`,
    )

    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404)
      res.end()
      return
    }

    const code = url.searchParams.get('code')
    const receivedState = url.searchParams.get('state')

    if (!code) {
      res.writeHead(400)
      res.end('Missing authorization code')
      this.reject(new Error('No authorization code received'))
      return
    }

    if (receivedState !== this.state) {
      res.writeHead(400)
      res.end('Invalid state parameter')
      this.reject(new Error('State mismatch - possible CSRF attack'))
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(
      '<html><body><p>Authentication successful! You can close this window.</p><script>window.close()</script></body></html>',
    )

    if (this.timeoutHandle) clearTimeout(this.timeoutHandle)
    this.resolve(code)
  }

  private waitForCallback(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.callbackResolve = resolve
      this.callbackReject = reject
      this.timeoutHandle = setTimeout(() => {
        this.reject(new Error('OAuth callback timed out after 5 minutes'))
      }, TIMEOUT_MS)
    })
  }

  private resolve(code: string): void {
    if (this.callbackResolve) {
      this.callbackResolve(code)
      this.callbackResolve = null
      this.callbackReject = null
    }
  }

  private reject(err: Error): void {
    if (this.callbackReject) {
      this.callbackReject(err)
      this.callbackResolve = null
      this.callbackReject = null
    }
  }

  private async exchangeCode(
    code: string,
  ): Promise<{
    access_token: string
    refresh_token?: string
    expires_in: number
  }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: this.verifier,
    })

    const response = await fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Token exchange failed (${response.status}): ${text}`)
    }

    return response.json()
  }

  static async refreshAccessToken(
    refreshToken: string,
  ): Promise<OpenAIOAuthResult> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    })

    const response = await fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Token refresh failed (${response.status}): ${text}`)
    }

    const data = await response.json()
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    }
  }

  cleanup(): void {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle)
    if (this.server) {
      this.server.removeAllListeners()
      this.server.close()
      this.server = null
    }
    this.callbackResolve = null
    this.callbackReject = null
  }
}
