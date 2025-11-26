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

            {/* Result Sidebar - Slide In */}
            {verdict && !loading && (
                <div className="fixed top-0 right-0 h-screen w-[400px] z-[2147483647] bg-zinc-950 border-l border-zinc-800 shadow-2xl overflow-y-auto animate-slide-in-right">

                    {/* Header */}
                    <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
                        <div className="flex items-center gap-3">
                            <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500" />
                            <span className="text-base font-semibold tracking-tight text-white">Analysis Report</span>
                        </div>
                        <button
                            onClick={() => setVerdict(null)}
                            className="p-2 -mr-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 rounded-full transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 18 18" /></svg>
                        </button>
                    </div>

                    <div className="p-6 space-y-8">

                        {/* Hero Section: Authenticity */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Authenticity</h3>
                                <Badge label={verdict.authenticity.status} color={getAuthColor(verdict.authenticity.status)} />
                            </div>

                            <div className="relative pt-2">
                                <div className="flex items-end justify-between mb-2">
                                    <span className="text-3xl font-bold text-white">{verdict.authenticity.confidence}%</span>
                                    <span className="text-sm text-zinc-400 mb-1">Confidence</span>
                                </div>
                                <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${getAuthColor(verdict.authenticity.status).split(' ')[2]}`}
                                        style={{ width: `${verdict.authenticity.confidence}%` }}
                                    />
                                </div>
                            </div>

                            <p className="text-sm text-zinc-300 leading-relaxed">
                                {verdict.authenticity.explanation}
                            </p>
                        </div>

                        <div className="h-px bg-zinc-900" />

                        {/* Hero Section: Credibility */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Credibility</h3>
                                <Badge label={verdict.credibility.status} color={getCredColor(verdict.credibility.status)} />
                            </div>

                            <div className="relative pt-2">
                                <div className="flex items-end justify-between mb-2">
                                    <span className="text-3xl font-bold text-white">{verdict.credibility.confidence}%</span>
                                    <span className="text-sm text-zinc-400 mb-1">Confidence</span>
                                </div>
                                <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${getCredColor(verdict.credibility.status).split(' ')[2]}`}
                                        style={{ width: `${verdict.credibility.confidence}%` }}
                                    />
                                </div>
                            </div>

                            <p className="text-sm text-zinc-300 leading-relaxed">
                                {verdict.credibility.explanation}
                            </p>
                        </div>

                        <div className="h-px bg-zinc-900" />

                        {/* Summary */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Executive Summary</h3>
                            <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
                                <p className="text-sm text-zinc-300 leading-relaxed">
                                    {verdict.summary}
                                </p>
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <div className="sticky bottom-0 p-4 bg-zinc-950 border-t border-zinc-800">
                        <div className="flex items-center justify-between text-xs text-zinc-600">
                            <span>Powered by NymAI</span>
                            <span>v0.0.1</span>
                        </div>
                    </div>

                </div>
            )}
        </div>
    )
}

export default Inspector
