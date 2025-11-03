import initSqlJs, { type Database } from "sql.js"
import path from "path"
import fs from "fs/promises"

// =================================================================================
// Interfaces
// =================================================================================

export interface ConversationMessage {
  id: string
  role: "user" | "assistant" | "system"
  text: string
  timestamp?: string
  raw?: unknown
}

export interface ConversationExtraction {
  messages: ConversationMessage[]
  raw: Record<string, unknown>
  tables: string[]
}

// =================================================================================
// Constants
// =================================================================================

// Conversation-related keys to look for, mirroring the Python script's logic.
const CONVERSATION_KEYS = [
  "aiService.generations",
  "aiService.prompts",
  "composer.composerData",
  "composerData",
  "chat",
  "conversation"
]

// =================================================================================
// Main Extraction Logic
// =================================================================================

/**
 * Loads a SQLite database from an ArrayBuffer using sql.js.
 * This avoids native dependencies and is suitable for serverless environments.
 */
export async function loadDatabase(
  fileBuffer: ArrayBuffer
): Promise<initSqlJs.Database> {
  try {
    // In a Vercel serverless function, __dirname points to the bundled file's directory.
    // The postinstall script copies the wasm file next to this source file.
    const wasmPath = path.join(__dirname, "sql-wasm.wasm")
    const wasmBinaryBuffer = await fs.readFile(wasmPath)

    // Convert Buffer to ArrayBuffer for sql.js
    const wasmArrayBuffer = wasmBinaryBuffer.buffer.slice(
      wasmBinaryBuffer.byteOffset,
      wasmBinaryBuffer.byteOffset + wasmBinaryBuffer.byteLength
    ) as ArrayBuffer
    const SQL = await initSqlJs({ wasmBinary: wasmArrayBuffer })
    return new SQL.Database(new Uint8Array(fileBuffer))
  } catch (error) {
    console.error("Database load error:", error)
    // Add more context for debugging wasm file loading issues.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        "Failed to load sql-wasm.wasm. Ensure it's in the `src/lib` directory and the build process includes it."
      )
    }
    throw new Error(
      `Failed to load database: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

/**
 * Orchestrates the entire data extraction process from the database.
 */
export function extractConversation(db: Database): ConversationExtraction {
  try {
    const tables = listTables(db)
    const raw: Record<string, unknown> = {}

    // Prioritize ItemTable as it's the primary source in recent versions.
    if (tables.includes("ItemTable")) {
      const rows = selectKeyValue(db, "ItemTable")
      for (const [key, value] of rows) {
        const keyLower = key.toLowerCase()
        if (CONVERSATION_KEYS.some((convKey) => keyLower.includes(convKey.toLowerCase()))) {
          raw[key] = value
        }
        // Unpack nested conversation data from composerData
        if (key === "composer.composerData" && typeof value === "object" && value !== null) {
          const composerData = value as Record<string, unknown>
          if ("conversation" in composerData) {
            raw["conversation"] = composerData["conversation"]
          }
        }
      }
    }
    
    // Fallback to cursorDiskKV for older database formats.
    if (tables.includes("cursorDiskKV")) {
        const patterns = ["aiService.%", "composer%", "%chat%", "%conversation%"]
        for (const pattern of patterns) {
            const rows = selectKeyValueWithPattern(db, "cursorDiskKV", pattern)
            for (const [key, value] of rows) {
                if (raw[key] === undefined) { // Avoid overwriting data from ItemTable
                    raw[key] = value
                }
            }
        }
    }

    const messages = buildMessages(raw)
    return { messages, raw, tables }
  } catch (error) {
    console.error("Extraction error:", error)
    throw new Error(`Failed to extract conversation: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Determines the best message extraction strategy based on available data.
 */
function buildMessages(raw: Record<string, unknown>): ConversationMessage[] {
  // `composer.composerData` often contains a clean, well-structured conversation array.
  const composerConversation = extractComposerConversation(raw)
  if (composerConversation.length > 0) {
    return composerConversation
  }

  // Fallback to `aiService` prompts and generations if composer data is unavailable.
  const aiServiceConversation = extractAiServiceConversation(raw)
  if (aiServiceConversation.length > 0) {
    return aiServiceConversation
  }

  return []
}

// =================================================================================
// Message Builders
// =================================================================================

/**
 * Extracts conversation from the `composer.composerData` key.
 */
function extractComposerConversation(raw: Record<string, unknown>): ConversationMessage[] {
  const conversation = raw["conversation"] as unknown
  if (!Array.isArray(conversation)) return []

  const messages: ConversationMessage[] = []
  
  conversation.forEach((item, index) => {
    if (typeof item !== 'object' || item === null) return
    
    const text = String(item.text ?? "")
    if (!text.trim()) return
    // Timestamps can be in a few places
    let timestamp: string | undefined
    const timingInfo = item.timingInfo as Record<string, unknown>
    if (timingInfo) {
      const rawTs = timingInfo.clientStartTime ?? timingInfo.clientRpcSendTime
      if (typeof rawTs === "number") {
        timestamp = new Date(rawTs).toISOString()
      }
    }
    // Type 1 is user, others are assistant
    const role: "user" | "assistant" = item.type === 1 ? "user" : "assistant"
    messages.push({
      id: `composer-${index}`,
      role,
      text,
      timestamp,
      raw: item,
    })
  })
  
  // Basic sort, as this format is usually ordered
  return messages.sort((a, b) => {
    if (a.timestamp && b.timestamp) {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    }
    return 0
  })
}

/**
 * Extracts conversation from `aiService.prompts`