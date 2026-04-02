// Stub file - original was missing
export type Message = {
  role: string
  content: string
}

export type AssistantMessage = Message
export type UserMessage = Message
export type SystemMessage = Message
export type AttachmentMessage = Message & { attachments?: unknown[] }
export type ProgressMessage = Message & { progress?: number }
export type SystemLocalCommandMessage = Message & { command?: string }