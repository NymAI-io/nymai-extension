import cssText from "data-text:../style.css"
import type { PlasmoCSConfig } from "plasmo"
import { useEffect, useState, useRef } from "react"

export const config: PlasmoCSConfig = {
    matches: ["<all_urls>"]
}

export const getStyle = () => {
    const style = document.createElement("style")
    style.textContent = cssText
    return style
}

// --- Types ---

type AuthenticityLabel = 'real' | 'fake' | 'uncertain'
type CredibilityLabel = 'true' | 'false' | 'misleading' | 'satire' | 'uncertain'

interface AuthenticityVerdict {
    status: AuthenticityLabel
    confidence: number
    explanation: string
}

interface CredibilityVerdict {
    status: CredibilityLabel
    confidence: number
    explanation: string
}

interface UnifiedVerdict {
    authenticity: AuthenticityVerdict
    credibility: CredibilityVerdict
    summary: string
}

// --- Components ---

const Badge = ({ label, color }: { label: string; color: string }) => (
    <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${color} bg-opacity-10 border border-opacity-20`}>
        {label}
    </span>
)

const Spinner = () => (
    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
)

const Inspector = () => {
    // State
    const [selectionMode, setSelectionMode] = useState(false)
    const [loading, setLoading] = useState(false)
    const [verdict, setVerdict] = useState<UnifiedVerdict | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [scanType, setScanType] = useState<'credibility' | 'authenticity'>('credibility')

    // Refs for cleanup
    const highlightedElementRef = useRef<HTMLElement | null>(null)
    const originalBorderRef = useRef<string>("")

    // --- Message Listener ---
    useEffect(() => {
        const messageListener = (request: any, sender: any, sendResponse: any) => {
            if (request.action === "activate-selection-mode") {
                console.log("Inspector: Activating selection mode", request.scanType)
                setSelectionMode(true)
                setScanType(request.scanType || 'credibility')
                setVerdict(null)
                setError(null)
                setLoading(false)
            } else if (request.action === "NYMAI_SCAN_COMPLETE" && request.data) {
                console.log("Inspector: Received verdict", request.data)
                setLoading(false)
                // Handle potentially wrapped data
                const payload = request.data.verdict || request.data
                setVerdict(payload)
            } else if (request.action === "NYMAI_SCAN_ERROR") {
                console.log("Inspector: Received error", request.error)
                setLoading(false)
                setError(request.error || "Scan failed")
            }
        }

        chrome.runtime.onMessage.addListener(messageListener)
        return () => chrome.runtime.onMessage.removeListener(messageListener)
    }, [])

    // --- Selection Mode Logic ---
    useEffect(() => {
        if (!selectionMode) {
            // Cleanup when exiting selection mode
            if (highlightedElementRef.current) {
                highlightedElementRef.current.style.outline = originalBorderRef.current
                highlightedElementRef.current = null
            }
            document.body.style.cursor = 'default'
            return
        }

        // Apply crosshair cursor
        document.body.style.cursor = 'crosshair !important'

        const handleMouseOver = (e: MouseEvent) => {
            e.stopPropagation()
            const target = e.target as HTMLElement

            // Skip our own UI elements
            if (target.closest('.nymai-inspector-ui')) return

            // Restore previous element style
            if (highlightedElementRef.current && highlightedElementRef.current !== target) {
                highlightedElementRef.current.style.outline = originalBorderRef.current
            }

            // Highlight new element
            if (highlightedElementRef.current !== target) {
                highlightedElementRef.current = target
                originalBorderRef.current = target.style.outline
                target.style.outline = '2px solid #4fd1c5' // Teal highlight
            }
        }

        const handleClick = async (e: MouseEvent) => {
            e.preventDefault()
            e.stopPropagation()

            const target = e.target as HTMLElement

            // Skip our own UI elements
            if (target.closest('.nymai-inspector-ui')) return

            console.log("Inspector: Element selected", target)

            // Extract content
            let contentType = 'text'
            let contentData = ''

            if (target.tagName === 'IMG') {
                contentType = 'image'
                contentData = (target as HTMLImageElement).src
            } else if (target.tagName === 'VIDEO') {
                contentType = 'video'
                contentData = (target as HTMLVideoElement).src
            } else {
                contentType = 'text'
                contentData = target.innerText || target.textContent || ''
            }

            if (!contentData) {
                console.warn("Inspector: No content found")
                return
            }

            // Cleanup highlight
            if (highlightedElementRef.current) {
                highlightedElementRef.current.style.outline = originalBorderRef.current
                highlightedElementRef.current = null
            }
            document.body.style.cursor = 'default'

            // Update state
            setSelectionMode(false)
            setLoading(true)

            // Send to background
            try {
                await chrome.runtime.sendMessage({
                    action: 'precision-path-scan',
                    scanType: scanType,
                    content: {
                        content_type: contentType,
                        content_data: contentData
                    }
                })
            } catch (err) {
                console.error("Inspector: Failed to send scan request", err)
                setLoading(false)
                setError("Failed to start scan")
            }
        }

        // Add listeners
        document.addEventListener('mouseover', handleMouseOver, true)
        document.addEventListener('click', handleClick, true)

        // Cleanup
        return () => {
            document.removeEventListener('mouseover', handleMouseOver, true)
            document.removeEventListener('click', handleClick, true)
            document.body.style.cursor = 'default'
            if (highlightedElementRef.current) {
                highlightedElementRef.current.style.outline = originalBorderRef.current
            }
        }
    }, [selectionMode, scanType])


    // --- Render Helpers ---

    const getAuthColor = (status: AuthenticityLabel) => {
        switch (status) {
            case 'real': return 'text-emerald-400 border-emerald-400 bg-emerald-400'
            case 'fake': return 'text-rose-400 border-rose-400 bg-rose-400'
            case 'uncertain': return 'text-amber-400 border-amber-400 bg-amber-400'
            default: return 'text-gray-400 border-gray-400 bg-gray-400'
        }
    }

    const getCredColor = (status: CredibilityLabel) => {
        switch (status) {
            case 'true': return 'text-emerald-400 border-emerald-400 bg-emerald-400'
            case 'false':
            case 'misleading': return 'text-rose-400 border-rose-400 bg-rose-400'
            case 'satire': return 'text-purple-400 border-purple-400 bg-purple-400'
            case 'uncertain': return 'text-amber-400 border-amber-400 bg-amber-400'
            default: return 'text-gray-400 border-gray-400 bg-gray-400'
        }
    }

    // --- Main Render ---

    if (!loading && !verdict && !error) return null

    return (
        <div className="nymai-inspector-ui fixed top-4 right-4 z-[2147483647] font-sans antialiased animate-fade-slide-in">

            {/* Loading State */}
            {loading && (
                <div className="flex items-center gap-3 px-4 py-3 bg-zinc-950/90 backdrop-blur-md border border-zinc-800 rounded-lg shadow-xl">
                    <Spinner />
                    <span className="text-sm font-medium text-zinc-200">Analyzing content...</span>
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="w-[320px] bg-zinc-950/95 backdrop-blur-xl border border-rose-900/50 rounded-xl shadow-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-rose-900/30 bg-rose-950/10 flex justify-between items-center">
                        <span className="text-sm font-semibold text-rose-400">Analysis Failed</span>
                        <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-300">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 18 18" /></svg>
                        </button>
                    </div>
                    <div className="p-4">
                        <p className="text-sm text-zinc-300">{error}</p>
                    </div>
                </div>
            )}

            {/* Result Card */}
            {verdict && !loading && (
                <div className="w-[480px] bg-zinc-950/95 backdrop-blur-xl border border-zinc-800 rounded-xl shadow-2xl overflow-hidden text-zinc-100">

                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 bg-zinc-900/30">
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500" />
                            <span className="text-sm font-semibold tracking-tight text-zinc-300">NymAI Analysis</span>
                        </div>
                        <button
                            onClick={() => setVerdict(null)}
                            className="text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 18 18" /></svg>
                        </button>
                    </div>

                    {/* Summary Section */}
                    <div className="px-6 py-5 border-b border-zinc-800/50">
                        <p className="text-lg font-medium leading-snug text-white">
                            {verdict.summary}
                        </p>
                    </div>

                    {/* The Grid (Dual-Stat) */}
                    <div className="grid grid-cols-2 divide-x divide-zinc-800/50">

                        {/* Left: Authenticity */}
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Media Check</span>
                                <Badge label={verdict.authenticity.status} color={getAuthColor(verdict.authenticity.status)} />
                            </div>
                            <div className="min-h-[60px]">
                                <p className="text-sm text-zinc-400 leading-relaxed line-clamp-4">
                                    {verdict.authenticity.explanation}
                                </p>
                            </div>
                            {/* Confidence Bar */}
                            <div className="w-full bg-zinc-800 rounded-full h-1 mt-2">
                                <div
                                    className={`h-1 rounded-full ${getAuthColor(verdict.authenticity.status).split(' ')[2]}`}
                                    style={{ width: `${verdict.authenticity.confidence}%` }}
                                />
                            </div>
                        </div>

                        {/* Right: Credibility */}
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Fact Check</span>
                                <Badge label={verdict.credibility.status} color={getCredColor(verdict.credibility.status)} />
                            </div>
                            <div className="min-h-[60px]">
                                <p className="text-sm text-zinc-400 leading-relaxed line-clamp-4">
                                    {verdict.credibility.explanation}
                                </p>
                            </div>
                            {/* Confidence Bar */}
                            <div className="w-full bg-zinc-800 rounded-full h-1 mt-2">
                                <div
                                    className={`h-1 rounded-full ${getCredColor(verdict.credibility.status).split(' ')[2]}`}
                                    style={{ width: `${verdict.credibility.confidence}%` }}
                                />
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <div className="px-4 py-2 bg-zinc-900/50 border-t border-zinc-800/50 flex justify-end">
                        <span className="text-[10px] text-zinc-600">Powered by NymAI</span>
                    </div>

                </div>
            )}
        </div>
    )
}

export default Inspector
