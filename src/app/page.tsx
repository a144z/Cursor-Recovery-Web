"use client"

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react"
import { Check, Copy, Search, Download, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface ConversationMessage {
  id: string
  role: "user" | "assistant" | "system"
  text: string
  timestamp?: string
}

interface ExtractionResponse {
  filename: string
  extractedAt: string
  messages: ConversationMessage[]
  raw: Record<string, unknown>
  tables: string[]
  error?: string
  details?: string
}

interface ConversationExtraction {
  messages: ConversationMessage[]
  raw: Record<string, unknown>
  tables: string[]
}

export default function HomePage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExtractionResponse | null>(null)
  
  // Filter states
  const [searchQuery, setSearchQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState<"all" | "user" | "assistant">("all")
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [visibleMessageId, setVisibleMessageId] = useState<string | null>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const searchInputRef = useRef<HTMLInputElement>(null)

  const extractFile = useCallback(async (file: File) => {
    setIsExtracting(true)
    setError(null)
    try {
      // Dynamically import client-side conversation extraction
      const { loadDatabase, extractConversation } = await import("@/lib/conversation-client")
      
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer()
      
      if (arrayBuffer.byteLength === 0) {
        throw new Error("Uploaded file is empty")
      }

      // Load database and extract conversation - all in the browser!
      const db = await loadDatabase(arrayBuffer)
      let result: ConversationExtraction
      
      try {
        result = extractConversation(db)
      } finally {
        // Always close the database to free memory
        db.close()
      }

      // Format the result to match the expected interface
      const payload: ExtractionResponse = {
        filename: file.name,
        extractedAt: new Date().toISOString(),
        messages: result.messages,
        raw: result.raw,
        tables: result.tables,
      }

      setResult(payload)
      setSearchQuery("") // Reset search on new extraction
      setRoleFilter("all")
    } catch (ex) {
      setResult(null)
      setError((ex as Error).message)
      console.error("Extraction error:", ex)
    } finally {
      setIsExtracting(false)
    }
  }, [])

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target
    setResult(null)
    setError(null)
    const file = files && files.length ? files[0] : null
    setSelectedFile(file)
    
    // Auto-extract when file is selected
    if (file) {
      extractFile(file)
    }
  }, [extractFile])

  const handleDownload = useCallback(
    (mode: "conversation" | "raw") => {
      if (!result) return

      const data =
        mode === "conversation"
          ? result.messages
          : {
              filename: result.filename,
              extractedAt: result.extractedAt,
              tables: result.tables,
              raw: result.raw,
              messages: result.messages, // Include messages in raw for completeness
            }

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json"
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${result.filename.replace(/\.vscdb(\.backup)?$/i, "")}-${mode}.json`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    },
    [result]
  )

  // Sort messages by timestamp (chronological order)
  const sortedMessages = useMemo(() => {
    if (!result || !result.messages.length) return []
    
    return [...result.messages].sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        const timeA = new Date(a.timestamp).getTime()
        const timeB = new Date(b.timestamp).getTime()
        if (timeA !== timeB) {
          return timeA - timeB
        }
        if (a.role === "user" && b.role === "assistant") return -1
        if (a.role === "assistant" && b.role === "user") return 1
        return a.id.localeCompare(b.id)
      }
      if (a.timestamp && !b.timestamp) return -1
      if (!a.timestamp && b.timestamp) return 1
      return a.id.localeCompare(b.id)
    })
  }, [result])

  // Search results for dropdown (optimized with early exit)
  const searchResults = useMemo(() => {
    const trimmedQuery = searchQuery.trim()
    if (!trimmedQuery || !sortedMessages.length) return []
    
    const query = trimmedQuery.toLowerCase()
    const results: Array<{
      message: ConversationMessage
      matchIndex: number
      snippet: string
    }> = []
    const maxResults = 10
    
    // Early exit when we have enough results
    for (const msg of sortedMessages) {
      if (results.length >= maxResults) break
      
      const text = msg.text.toLowerCase()
      const matchIndex = text.indexOf(query)
      if (matchIndex !== -1) {
        // Get context snippet (50 chars before and after)
        const start = Math.max(0, matchIndex - 50)
        const end = Math.min(msg.text.length, matchIndex + query.length + 50)
        const snippet = msg.text.substring(start, end)
        results.push({ message: msg, matchIndex: start + matchIndex, snippet })
      }
    }
    
    return results
  }, [sortedMessages, searchQuery])

  // Filter messages based on search query and role filter (optimized)
  const filteredMessages = useMemo(() => {
    if (!sortedMessages.length) return []
    const trimmedQuery = searchQuery.trim()
    const hasSearch = trimmedQuery.length > 0
    const hasRoleFilter = roleFilter !== "all"
    
    // Early exit if no filters
    if (!hasSearch && !hasRoleFilter) return sortedMessages
    const query = hasSearch ? trimmedQuery.toLowerCase() : null
    
    // Single pass filtering
    return sortedMessages.filter((msg) => {
      // Role filter
      if (hasRoleFilter && msg.role !== roleFilter) return false
      
      // Search filter
      if (hasSearch && query) {
        // Use indexOf instead of includes for better performance
        return msg.text.toLowerCase().indexOf(query) !== -1
      }
      
      return true
    })
  }, [sortedMessages, searchQuery, roleFilter])

  // Scroll to message and highlight it
  const scrollToMessage = useCallback((messageId: string) => {
    const element = messageRefs.current.get(messageId)
    if (element) {
      setHighlightedMessageId(messageId)
      element.scrollIntoView({ behavior: "smooth", block: "center" })
      setShowSearchResults(false)
      searchInputRef.current?.blur()
      
      // Remove highlight after 2 seconds
      setTimeout(() => {
        setHighlightedMessageId(null)
      }, 2000)
    }
  }, [])

  const conversationSummary = useMemo(() => {
    if (!result || !result.messages.length) return null
    const userMessages = result.messages.filter((message) => message.role === "user").length
    const assistantMessages = result.messages.filter((message) => message.role === "assistant").length
    return `${result.messages.length} messages — ${userMessages} user, ${assistantMessages} assistant`
  }, [result])

  // Track visible message using Intersection Observer (optimized)
  useEffect(() => {
    if (!result?.messages.length) {
      setVisibleMessageId(null)
      return
    }

    let rafId: number | null = null
    let currentVisibleId: string | null = null

    const observer = new IntersectionObserver(
      (entries) => {
        // Cancel any pending update
        if (rafId) cancelAnimationFrame(rafId)
        
        // Batch updates using requestAnimationFrame
        rafId = requestAnimationFrame(() => {
          // Find the entry with the highest intersection ratio (most visible)
          let maxRatio = 0
          let bestEntry: IntersectionObserverEntry | null = null
          
          for (const entry of entries) {
            if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
              maxRatio = entry.intersectionRatio
              bestEntry = entry
            }
          }
          
          // If equal ratios, prefer the one closer to top
          if (bestEntry) {
            const messageId = bestEntry.target.getAttribute("data-message-id")
            if (messageId && messageId !== currentVisibleId) {
              currentVisibleId = messageId
              setVisibleMessageId(messageId)
            }
          }
        })
      },
      {
        root: null,
        rootMargin: "-100px 0px -50% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1.0] // Reduced thresholds for better performance
      }
    )

    // Observe all message elements (only once)
    const elements = Array.from(messageRefs.current.values())
    elements.forEach((element) => {
      if (element) observer.observe(element)
    })

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [result?.messages.length]) // Only recreate when message count changes, not filtered list

  // Get visible message for copy button
  const visibleMessage = useMemo(() => {
    if (!visibleMessageId || !result) return null
    return result.messages.find((msg) => msg.id === visibleMessageId)
  }, [visibleMessageId, result])

  const [copiedVisible, setCopiedVisible] = useState(false)

  // Handle copy for visible message
  const handleCopyVisible = useCallback(async () => {
    if (!visibleMessage) return
    try {
      await navigator.clipboard.writeText(visibleMessage.text)
      setCopiedVisible(true)
      setTimeout(() => setCopiedVisible(false), 2000)
    } catch (error) {
      console.error("Failed to copy:", error)
    }
  }, [visibleMessage])

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* A single, consolidated top bar */}
      <div className="w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-20 items-center gap-4">
            {/* Left side: Upload */}
            <div className="flex items-center gap-2">
              <Input
                id="db-file"
                type="file"
                accept=".vscdb,.vscdb.backup"
                onChange={handleFileChange}
                disabled={isExtracting}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => document.getElementById("db-file")?.click()}
                disabled={isExtracting}
                className="flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                <span className="hidden md:inline">
                  {selectedFile ? selectedFile.name : "Choose File"}
                </span>
                <span className="md:hidden">Upload</span>
                {isExtracting && <span className="ml-2 text-xs text-muted-foreground">(Parsing...)</span>}
              </Button>
            </div>
            
            {/* Center: Search (only when results are available) */}
            {result && result.messages.length > 0 && (
              <div className="relative mx-4 flex-1">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground z-10" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search messages..."
                  value={searchQuery}
                  onChange={(e) => {
                    const value = e.target.value
                    setSearchQuery(value)
                    if (value.trim()) {
                      setShowSearchResults(true)
                    } else {
                      setShowSearchResults(false)
                      setHighlightedMessageId(null)
                    }
                  }}
                  onFocus={() => {
                    if (searchQuery.trim() && searchResults.length > 0) {
                      setShowSearchResults(true)
                    }
                  }}
                  onBlur={() => {
                    // Delay to allow click on dropdown items
                    setTimeout(() => setShowSearchResults(false), 200)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowSearchResults(false)
                      setSearchQuery("")
                      setHighlightedMessageId(null)
                    }
                  }}
                  className="h-12 w-full pl-12 pr-4 text-base rounded-full"
                />
                {/* Search Results Dropdown */}
                {showSearchResults && searchQuery.trim() && searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-popover border rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
                    <div className="p-2">
                      <div className="text-xs font-semibold text-muted-foreground px-2 py-1 mb-1">
                        {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                      </div>
                      {searchResults.map((result, index) => {
                        const query = searchQuery.toLowerCase()
                        const snippetLower = result.snippet.toLowerCase()
                        const matchIndex = snippetLower.indexOf(query)
                        const beforeMatch = result.snippet.substring(0, matchIndex)
                        const match = result.snippet.substring(matchIndex, matchIndex + searchQuery.length)
                        const afterMatch = result.snippet.substring(matchIndex + searchQuery.length)
                        
                        return (
                          <button
                            key={`${result.message.id}-${index}`}
                            onMouseDown={(e) => {
                              e.preventDefault() // Prevent input blur
                            }}
                            onClick={() => scrollToMessage(result.message.id)}
                            className="w-full text-left px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={result.message.role === "user" ? "secondary" : "default"} className="text-xs">
                                {result.message.role === "user" ? "You" : "AI"}
                              </Badge>
                              {result.message.timestamp && (
                                <span className="text-xs text-muted-foreground">
                                  {new Date(result.message.timestamp).toLocaleString()}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {beforeMatch.length > 0 && <span>...{beforeMatch}</span>}
                              <span className="bg-yellow-200 dark:bg-yellow-900 font-semibold">{match}</span>
                              {afterMatch.length > 0 && <span>{afterMatch}...</span>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Right side: Filters & Downloads */}
            <div className="flex items-center gap-2 ml-auto">
              {result && result.messages.length > 0 && (
                <>
                  <Select
                    value={roleFilter}
                    onValueChange={(value) => setRoleFilter(value as "all" | "user" | "assistant")}
                  >
                    <SelectTrigger className="h-12 w-[140px]">
                      <SelectValue placeholder="Filter by role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="assistant">AI</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    onClick={() => handleDownload("conversation")}
                    disabled={!result.messages.length}
                    className="flex items-center gap-2 h-12 rounded-full"
                  >
                    <Download className="h-4 w-4" />
                    <span className="hidden sm:inline">Chat</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    onClick={() => handleDownload("raw")}
                    className="flex items-center gap-2 h-12 rounded-full"
                  >
                    <Download className="h-4 w-4" />
                    <span className="hidden sm:inline">Raw</span>
                  </Button>
                </>
              )}
            </div>
          </div>
          {/* Bottom row for errors or summary */}
          {(error || conversationSummary) && (
            <div className="pb-2 text-center text-xs">
              {error && <p className="text-destructive">{error}</p>}
              {!error && conversationSummary && <p className="text-muted-foreground">{conversationSummary}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Full Screen Conversation Area */}
      <div className="flex-1 overflow-hidden">
        {!result ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-4">
              <h1 className="text-2xl font-semibold">Cursor Recovery Web</h1>
              <p className="text-muted-foreground max-w-md">
                Upload a Cursor <code className="rounded bg-muted px-1 py-0.5 text-sm">.vscdb</code> database
                to recover composer chat conversations directly in the browser.
              </p>
            </div>
          </div>
        ) : !result.messages.length ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-2">
              <p className="text-muted-foreground">No conversation data detected.</p>
              <p className="text-sm text-muted-foreground">
                Check raw data export for manual inspection.
              </p>
              {result.filename && (
                <p className="text-xs text-muted-foreground mt-4">
                  File: {result.filename} • Tables: {result.tables.join(", ") || "None"}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="relative h-full">
            <ScrollArea className="h-full">
              <div className="container mx-auto max-w-4xl px-4 py-6">
              <div className="space-y-4">
                {filteredMessages.length === 0 ? (
                  <div className="flex h-64 items-center justify-center">
                    <div className="text-center space-y-2">
                      <p className="text-muted-foreground">No messages match your filters.</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSearchQuery("")
                          setRoleFilter("all")
                        }}
                      >
                        Clear filters
                      </Button>
                    </div>
                  </div>
                ) : (
                  filteredMessages.map((message) => (
                    <ConversationBubble
                      key={message.id}
                      ref={(el) => {
                        if (el) {
                          messageRefs.current.set(message.id, el)
                        } else {
                          messageRefs.current.delete(message.id)
                        }
                      }}
                      message={message}
                      searchQuery={searchQuery}
                      isHighlighted={highlightedMessageId === message.id}
                    />
                  ))
                )}
              </div>
            </div>
          </ScrollArea>
          </div>
        )}
        
        {/* Fixed Copy Button - Always visible at viewport top-right */}
        {visibleMessage && (
          <Button
            variant="default"
            size="icon"
            onClick={handleCopyVisible}
            className="fixed right-6 top-28 z-50 h-12 w-12 rounded-full shadow-lg hover:shadow-xl transition-all bg-primary hover:bg-primary/90"
            aria-label="Copy visible message"
            title="Copy visible message"
          >
            {copiedVisible ? (
              <Check className="h-5 w-5" />
            ) : (
              <Copy className="h-5 w-5" />
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

interface ConversationBubbleProps {
  message: ConversationMessage
  searchQuery?: string
  isHighlighted?: boolean
}

const ConversationBubble = React.forwardRef<HTMLDivElement, ConversationBubbleProps>(
  ({ message, searchQuery = "", isHighlighted = false }, ref) => {
    const isUser = message.role === "user"
    const alignment = isUser ? "items-end" : "items-start"

    // Memoized formatted timestamp
    const formattedTimestamp = useMemo(() => {
      return message.timestamp ? new Date(message.timestamp).toLocaleString() : null
    }, [message.timestamp])

    // Optimized text highlighting (memoized)
    const highlightedText = useMemo(() => {
      const trimmedQuery = searchQuery.trim()
      if (!trimmedQuery) return message.text
      
      const query = trimmedQuery.toLowerCase()
      const text = message.text
      const textLower = text.toLowerCase()
      
      // Find all matches (more efficient than regex split)
      const matches: Array<{ start: number; end: number }> = []
      let searchIndex = 0
      
      while (true) {
        const index = textLower.indexOf(query, searchIndex)
        if (index === -1) break
        matches.push({ start: index, end: index + query.length })
        searchIndex = index + 1
      }
      
      if (matches.length === 0) return message.text
      
      // Build highlighted parts
      const parts: React.ReactNode[] = []
      let lastIndex = 0
      
      matches.forEach((match, matchIndex) => {
        // Add text before match
        if (match.start > lastIndex) {
          parts.push(<span key={`text-${matchIndex}`}>{text.substring(lastIndex, match.start)}</span>)
        }
        
        // Add highlighted match
        parts.push(
          <mark
            key={`match-${matchIndex}`}
            className="bg-yellow-200 dark:bg-yellow-900 font-semibold rounded px-0.5"
          >
            {text.substring(match.start, match.end)}
          </mark>
        )
        
        lastIndex = match.end
      })
      
      // Add remaining text
      if (lastIndex < text.length) {
        parts.push(<span key="text-end">{text.substring(lastIndex)}</span>)
      }
      
      return parts.length > 0 ? parts : message.text
    }, [message.text, searchQuery])

    return (
      <div 
        ref={ref} 
        data-message-id={message.id}
        className={cn("group relative flex flex-col gap-2", alignment)}
      >
        <div className="flex items-center gap-2">
          <Badge variant={isUser ? "secondary" : "default"} className="text-xs">
            {isUser ? "You" : "AI"}
          </Badge>
          {formattedTimestamp && (
            <span className="text-xs text-muted-foreground">
              {formattedTimestamp}
            </span>
          )}
        </div>
        <div
          className={cn(
            "relative max-w-3xl rounded-lg border shadow-sm transition-all duration-300",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground",
            isHighlighted && "ring-4 ring-yellow-400 dark:ring-yellow-600 ring-offset-2"
          )}
        >
          <div className="p-4">
            <p 
              className="whitespace-pre-wrap"
              style={{ overflowWrap: 'break-word' }}
            >
              {highlightedText}
            </p>
          </div>
          
        </div>
      </div>
    )
  }
)

ConversationBubble.displayName = "ConversationBubble"
