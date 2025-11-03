import { NextResponse } from "next/server"

import { extractConversation, loadDatabase } from "@/lib/conversation"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()

    const file = formData.get("file")

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "Missing .vscdb file in request" },
        { status: 400 }
      )
    }

    if (!file.name.endsWith(".vscdb") && !file.name.endsWith(".vscdb.backup")) {
      return NextResponse.json(
        { error: "Upload must be a .vscdb or .vscdb.backup file" },
        { status: 400 }
      )
    }

    console.log(`Processing file: ${file.name}, size: ${file.size} bytes`)

    const buffer = await file.arrayBuffer()

    console.log(`File loaded, buffer size: ${buffer.byteLength} bytes`)

    if (buffer.byteLength === 0) {
      return NextResponse.json(
        { error: "Uploaded file is empty" },
        { status: 400 }
      )
    }

    let db

    try {
      console.log("Initializing database...")
      db = await loadDatabase(buffer)
      console.log("Database loaded successfully")
    } catch (dbError) {
      console.error("Database load error:", dbError)
      return NextResponse.json(
        {
          error: "Failed to load database",
          details:
            dbError instanceof Error ? dbError.message : String(dbError)
        },
        { status: 500 }
      )
    }

    let result

    try {
      console.log("Extracting conversation...")
      result = extractConversation(db)
      console.log(`Extraction complete: ${result.messages.length} messages, ${result.tables.length} tables`)
    } catch (extractError) {
      console.error("Extraction error:", extractError)
      return NextResponse.json(
        {
          error: "Failed to extract conversation",
          details:
            extractError instanceof Error
              ? extractError.message
              : String(extractError)
        },
        { status: 500 }
      )
    } finally {
      // Close database to free memory
      if (db) {
        try {
          db.close()
        } catch (closeError) {
          console.warn("Error closing database:", closeError)
        }
      }
    }

    return NextResponse.json({
      filename: file.name,
      extractedAt: new Date().toISOString(),
      ...result
    })
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json(
      {
        error: "Failed to process request",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}

