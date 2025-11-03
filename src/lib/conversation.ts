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
 * Extracts conversation from `aiService.prompts` and `aiService.generations`.
 * This handles the more complex case where user and AI messages are in separate arrays
 * and user prompts may be missing timestamps.
 */
function extractAiServiceConversation(raw: Record<string, unknown>): ConversationMessage[] {
  const prompts = raw["aiService.prompts"]
  const generations = raw["aiService.generations"]

  // Step 1: Safely extract prompts (user messages)
  const promptMessages: ConversationMessage[] = []
  if (Array.isArray(prompts)) {
    prompts.forEach((item, index) => {
      if (typeof item !== 'object' || item === null) return
      
      const text = String(item.prompt ?? item.text ?? "")
      if (!text.trim()) return
      
      const unixMs = typeof item.unixMs === 'number' ? item.unixMs : undefined
      
      promptMessages.push({
        id: `prompt-${index}`,
        role: "user" as const,
        text,
        timestamp: unixMs ? new Date(unixMs).toISOString() : undefined,
        raw: item,
      })
    })
  }

  // Step 2: Safely extract generations (assistant messages)
  const generationMessages: ConversationMessage[] = []
  if (Array.isArray(generations)) {
    generations.forEach((item, index) => {
      if (typeof item !== 'object' || item === null) return
      
      const text = String(item.textDescription ?? item.response ?? item.text ?? "")
      if (!text.trim()) return
      
      const unixMs = typeof item.unixMs === 'number' ? item.unixMs : undefined
      
      generationMessages.push({
        id: `generation-${index}`,
        role: "assistant" as const,
        text,
        timestamp: unixMs ? new Date(unixMs).toISOString() : undefined,
        raw: item,
      })
    })
  }
    
  // Step 3: Infer timestamps for prompts that are missing them
  // This is a heuristic: if a prompt at a certain index has no timestamp,
  // but the generation at the same index does, we assume the prompt came
  // just before the generation.
  promptMessages.forEach((promptMsg, index) => {
    if (!promptMsg.timestamp && index < generationMessages.length) {
      const correspondingGeneration = generationMessages[index]
      if (correspondingGeneration.timestamp) {
        const genTimestamp = new Date(correspondingGeneration.timestamp).getTime()
        promptMsg.timestamp = new Date(genTimestamp - 1).toISOString()
      }
    }
  })

  // Step 4: Combine and apply robust sorting
  const combined: ConversationMessage[] = [...promptMessages, ...generationMessages]
  if (!combined.length) return []

  combined.sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : null
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : null

    // Rule 1: Sort by timestamp if both exist
    if (timeA !== null && timeB !== null) {
      if (timeA !== timeB) {
        return timeA - timeB
      }
      // If timestamps are identical, user comes before assistant
      if (a.role === 'user' && b.role === 'assistant') return -1
      if (a.role === 'assistant' && b.role === 'user') return 1
    }

    // Rule 2: Messages with timestamps come before messages without
    if (timeA !== null && timeB === null) return -1
    if (timeA === null && timeB !== null) return 1

    // Rule 3: If both lack timestamps, maintain relative order using IDs
    // (This also handles the equal timestamp, same role case as a final tie-breaker)
    const [aType, aIndexStr] = a.id.split('-')
    const [bType, bIndexStr] = b.id.split('-')
    const aIndex = parseInt(aIndexStr, 10)
    const bIndex = parseInt(bIndexStr, 10)
 
    if (aType === bType) {
      return aIndex - bIndex
    }
    
    // If types are different and timestamps are missing, assume prompts come first
    return aType === 'prompt' ? -1 : 1
  })

  return combined
}

// =================================================================================
// Database & Decoding Utilities
// =================================================================================

function listTables(db: Database): string[] {
  try {
    const results = db.exec("SELECT name FROM sqlite_master WHERE type='table'")
    if (!results.length) return []
    return results[0].values.map((row) => String(row[0]))
  } catch (error) {
    console.error("Error listing tables:", error)
    return []
  }
}

function selectKeyValue(
  db: Database,
  table: string
): Array<[string, unknown]> {
  try {
    const stmt = db.prepare(`SELECT key, value FROM ${table}`)
    const results: Array<[string, unknown]> = []
    while (stmt.step()) {
      const row = stmt.get()
      if (row.length >= 2) {
        results.push([decodeKey(row[0]), decodeValue(row[1])])
      }
    }
    stmt.free()
    return results
  } catch (error) {
    console.error(`Error selecting from ${table}:`, error)
    return []
  }
}

function selectKeyValueWithPattern(
  db: Database,
  table: string,
  pattern: string
): Array<[string, unknown]> {
  try {
    const stmt = db.prepare(`SELECT key, value FROM ${table} WHERE key LIKE ?`)
    stmt.bind([pattern])
    const results: Array<[string, unknown]> = []
    while (stmt.step()) {
      const row = stmt.get()
      if (row.length >= 2) {
        results.push([decodeKey(row[0]), decodeValue(row[1])])
      }
    }
    stmt.free()
    return results
  } catch (error) {
    console.error(`Error selecting from ${table} with pattern ${pattern}:`, error)
    return []
  }
}

function decodeKey(value: unknown): string {
  if (typeof value === "string") return value
  if (Buffer.isBuffer(value)) return value.toString("utf-8")
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
  return String(value)
}

function decodeValue(value: unknown): unknown {
  if (value == null) return null
  let decoded: string | null = null

  // In sql.js, binary data is returned as Uint8Array
  if (value instanceof Uint8Array) {
    decoded = new TextDecoder("utf-8", { fatal: false }).decode(value)
  } else if (typeof value === "string") {
    decoded = value
  }

  if (decoded !== null) {
    return tryParseJson(decoded)
  }
  
  return value
}

function tryParseJson(value: string): unknown {
  const trimmed = value.trim()
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(value)
    } catch {
      // Not valid JSON, return as string
    }
  }
  return value
}