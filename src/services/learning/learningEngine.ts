import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'

const VECTOR_SIZE = 64
const MAX_MEMORIES = 250
const STATE_VERSION = 1

export type LearningMemory = {
  id: string
  text: string
  tags: string[]
  embedding: number[]
  createdAt: number
  lastAccessedAt?: number
  accessCount: number
}

export type LearningSkillStats = {
  usageCount: number
  lastUsedAt: number
  positiveSignals: number
  negativeSignals: number
  queryEmbedding: number[]
}

export type LearningState = {
  version: number
  profile: {
    preferredSkills: string[]
    avoidedSkills: string[]
    notes: string[]
    updatedAt: number
  }
  skillStats: Record<string, LearningSkillStats>
  memories: LearningMemory[]
}

export type SkillSuggestion = {
  command: Command
  score: number
  reasons: string[]
}

function emptyState(): LearningState {
  return {
    version: STATE_VERSION,
    profile: {
      preferredSkills: [],
      avoidedSkills: [],
      notes: [],
      updatedAt: Date.now(),
    },
    skillStats: {},
    memories: [],
  }
}

export function getLearningDir(cwd = getCwd()): string {
  return join(cwd, '.axolot', 'learning')
}

export function getLearningStatePath(cwd = getCwd()): string {
  return join(getLearningDir(cwd), 'state.json')
}

export function loadLearningState(cwd = getCwd()): LearningState {
  const statePath = getLearningStatePath(cwd)
  if (!existsSync(statePath)) return emptyState()

  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf-8'))
    return normalizeState(parsed)
  } catch (e) {
    logForDebugging(
      `Failed to load learning state ${statePath}: ${e instanceof Error ? e.message : String(e)}`,
      { level: 'warn' },
    )
    return emptyState()
  }
}

export function saveLearningState(state: LearningState, cwd = getCwd()): void {
  const dir = getLearningDir(cwd)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(getLearningStatePath(cwd), JSON.stringify(state, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
}

export function recordSkillLearning(
  skillName: string,
  query = '',
  cwd = getCwd(),
): void {
  const state = loadLearningState(cwd)
  const now = Date.now()
  const existing = state.skillStats[skillName]
  const queryEmbedding = embedText(query || skillName)

  state.skillStats[skillName] = existing
    ? {
        usageCount: existing.usageCount + 1,
        lastUsedAt: now,
        positiveSignals: existing.positiveSignals + 1,
        negativeSignals: existing.negativeSignals,
        queryEmbedding: blendVectors(existing.queryEmbedding, queryEmbedding),
      }
    : {
        usageCount: 1,
        lastUsedAt: now,
        positiveSignals: 1,
        negativeSignals: 0,
        queryEmbedding,
      }

  if (!state.profile.preferredSkills.includes(skillName)) {
    state.profile.preferredSkills = [
      skillName,
      ...state.profile.preferredSkills,
    ].slice(0, 10)
  }
  state.profile.updatedAt = now
  saveLearningState(state, cwd)
}

export function addLearningMemory(
  text: string,
  tags: string[] = [],
  cwd = getCwd(),
): LearningMemory {
  const state = loadLearningState(cwd)
  const now = Date.now()
  const memory: LearningMemory = {
    id: `lm_${now}_${Math.random().toString(36).slice(2, 8)}`,
    text: text.trim(),
    tags: tags.map(t => t.trim()).filter(Boolean),
    embedding: embedText(text),
    createdAt: now,
    accessCount: 0,
  }
  state.memories = [memory, ...state.memories].slice(0, MAX_MEMORIES)
  saveLearningState(state, cwd)
  return memory
}

export function retrieveLearningMemories(
  query: string,
  cwd = getCwd(),
  limit = 5,
): LearningMemory[] {
  const state = loadLearningState(cwd)
  const queryEmbedding = embedText(query)
  return state.memories
    .map(memory => ({
      memory,
      score: cosineSimilarity(queryEmbedding, memory.embedding),
    }))
    .filter(item => item.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.memory)
}

export function suggestSkillsForQuery(
  query: string,
  commands: Command[],
  cwd = getCwd(),
  limit = 5,
): SkillSuggestion[] {
  const state = loadLearningState(cwd)
  const queryEmbedding = embedText(query)
  const lowerQuery = query.toLowerCase()

  return commands
    .filter(cmd => cmd.type === 'prompt' && !cmd.isHidden)
    .map(command => {
      const name = getCommandName(command)
      const stats = state.skillStats[name]
      const description = [
        name,
        command.description,
        command.whenToUse,
        ...(command.aliases ?? []),
      ]
        .filter(Boolean)
        .join(' ')
      const staticScore = cosineSimilarity(queryEmbedding, embedText(description))
      const learnedScore = stats
        ? cosineSimilarity(queryEmbedding, stats.queryEmbedding)
        : 0
      const usageScore = stats ? decayedUsage(stats) : 0
      const exactScore =
        lowerQuery.includes(name.toLowerCase()) ||
        command.aliases?.some(alias => lowerQuery.includes(alias.toLowerCase()))
          ? 0.35
          : 0
      const avoidedPenalty = state.profile.avoidedSkills.includes(name)
        ? 0.5
        : 0
      const preferredBoost = state.profile.preferredSkills.includes(name)
        ? 0.08
        : 0
      const score =
        staticScore * 0.55 +
        learnedScore * 0.3 +
        Math.min(usageScore, 5) * 0.03 +
        exactScore +
        preferredBoost -
        avoidedPenalty
      const reasons = [
        staticScore > 0.12 ? 'matches request text' : null,
        learnedScore > 0.12 ? 'similar to prior usage' : null,
        usageScore > 0 ? 'used recently' : null,
        exactScore > 0 ? 'explicit name or alias match' : null,
      ].filter((r): r is string => r !== null)

      return { command, score, reasons }
    })
    .filter(item => item.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function getCommandName(command: Command): string {
  return command.name
}

export function buildLearningSystemSection(cwd = getCwd()): string | null {
  const state = loadLearningState(cwd)
  const preferred = state.profile.preferredSkills.slice(0, 8)
  const notes = state.profile.notes.slice(0, 6)
  const topSkills = Object.entries(state.skillStats)
    .sort((a, b) => decayedUsage(b[1]) - decayedUsage(a[1]))
    .slice(0, 8)
    .map(([name, stats]) => `${name} (${stats.usageCount})`)

  if (preferred.length === 0 && notes.length === 0 && topSkills.length === 0) {
    return null
  }

  const lines = ['## Learning Profile']
  if (preferred.length) lines.push(`Preferred skills: ${preferred.join(', ')}`)
  if (topSkills.length) lines.push(`Frequent skills: ${topSkills.join(', ')}`)
  if (notes.length) lines.push(`Notes: ${notes.join(' | ')}`)
  lines.push(
    'Use this as a soft routing prior only. Explicit user instructions and current task evidence win.',
  )
  return lines.join('\n')
}

function normalizeState(value: unknown): LearningState {
  const base = emptyState()
  if (!value || typeof value !== 'object') return base
  const raw = value as Partial<LearningState>
  return {
    version: STATE_VERSION,
    profile: {
      preferredSkills: Array.isArray(raw.profile?.preferredSkills)
        ? raw.profile.preferredSkills.filter(isString).slice(0, 20)
        : [],
      avoidedSkills: Array.isArray(raw.profile?.avoidedSkills)
        ? raw.profile.avoidedSkills.filter(isString).slice(0, 20)
        : [],
      notes: Array.isArray(raw.profile?.notes)
        ? raw.profile.notes.filter(isString).slice(0, 50)
        : [],
      updatedAt:
        typeof raw.profile?.updatedAt === 'number'
          ? raw.profile.updatedAt
          : Date.now(),
    },
    skillStats:
      raw.skillStats && typeof raw.skillStats === 'object'
        ? raw.skillStats
        : {},
    memories: Array.isArray(raw.memories)
      ? raw.memories.filter(isLearningMemory).slice(0, MAX_MEMORIES)
      : [],
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isLearningMemory(value: unknown): value is LearningMemory {
  return (
    typeof value === 'object' &&
    value !== null &&
    isString((value as LearningMemory).id) &&
    isString((value as LearningMemory).text) &&
    Array.isArray((value as LearningMemory).embedding)
  )
}

function decayedUsage(stats: LearningSkillStats): number {
  const daysSinceUse = (Date.now() - stats.lastUsedAt) / 86_400_000
  return stats.usageCount * Math.max(Math.pow(0.5, daysSinceUse / 7), 0.1)
}

function blendVectors(a: number[], b: number[]): number[] {
  const out = new Array(VECTOR_SIZE).fill(0)
  for (let i = 0; i < VECTOR_SIZE; i++) {
    out[i] = (a[i] ?? 0) * 0.75 + (b[i] ?? 0) * 0.25
  }
  return normalizeVector(out)
}

export function embedText(text: string): number[] {
  const vector = new Array(VECTOR_SIZE).fill(0)
  const tokens = tokenize(text)
  for (const token of tokens) {
    const idx = Math.abs(hashString(token)) % VECTOR_SIZE
    vector[idx] += 1
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]}_${tokens[i + 1]}`
    const idx = Math.abs(hashString(bigram)) % VECTOR_SIZE
    vector[idx] += 0.6
  }
  return normalizeVector(vector)
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 1)
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash | 0
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  if (norm === 0) return vector
  return vector.map(v => Number((v / norm).toFixed(6)))
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < VECTOR_SIZE; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0)
  }
  return dot
}
