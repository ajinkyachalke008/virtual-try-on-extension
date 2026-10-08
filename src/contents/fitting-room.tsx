/**
 * OpenWear Fitting Room - Side Panel Drawer
 *
 * Implements Decart Lucy VTON Realtime Virtual Try-On:
 * 1. Background image proxy via FETCH_BLOB
 * 2. Ephemeral token generation -> realtime.connect
 * 3. Garment setImage with 20-30 word descriptive prompt
 * 4. onRemoteStream handler: videoRef.current.srcObject = remoteStream, setIsScanning(false), setHasResult(true)
 * 5. Person mask with 2s automatic fallback
 * 6. Laser scanning animation with 1.2s forwards fill
 */

import type { PlasmoCSConfig } from "plasmo"
import { useState, useEffect, useRef, useCallback } from "react"
import {
  connectRealtime,
  applyTryOn,
  buildDetailedPrompt,
  detectCategory,
  dataUrlToBlob,
  getStoredApiKey,
  setStoredApiKey,
  validateApiKey,
  SAMPLE_GARMENTS,
  type DecartSession,
  type SampleGarment,
} from "~lib/decart"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
}

export const getShadowHostId = () => "openwear-fitting-room"

const FRAME_MARGIN = 0.15

type DrawerState =
  | "closed"
  | "initializing"
  | "positioning"
  | "ready"
  | "scanning"
  | "tryon"

function FittingRoom() {
  // --- States ---
  const [drawerState, setDrawerState] = useState<DrawerState>("closed")
  const [personCentered, setPersonCentered] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [garmentImage, setGarmentImage] = useState<string | null>(null)
  const [garmentInfo, setGarmentInfo] = useState<string>("")
  const [isScanning, setIsScanning] = useState(false)
  const [hasResult, setHasResult] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [statusText, setStatusText] = useState("")
  const [showSettings, setShowSettings] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [keySaved, setKeySaved] = useState(false)
  const [keyValidating, setKeyValidating] = useState(false)
  const [isDemoMode, setIsDemoMode] = useState(false)

  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionRef = useRef<DecartSession | null>(null)
  const personCheckRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fallbackTimerRef = useRef<number | null>(null)

  // Load API key on mount
  useEffect(() => {
    getStoredApiKey().then(setApiKey)
  }, [])

  // Auto-dismiss toast
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 4000)
  }, [])

  // --- Start Camera Feed ---
  const startCamera = useCallback(async () => {
    setError(null)
    setStatusText("Initializing camera...")

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Camera API is restricted on this webpage origin. Click 'Use Demo Model' below to test try-on."
      )
      return false
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
          frameRate: { ideal: 30 },
        },
        audio: false,
      })
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      setDrawerState("positioning")
      setStatusText("Position yourself in frame")
      startPersonDetection()
      return true
    } catch (err: any) {
      console.warn("[OpenWear] Camera access denied or failed:", err)
      const msg =
        err.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera or click 'Use Demo Model'."
          : err.name === "SecurityError"
            ? "Camera is blocked by this website's Permissions-Policy. Use 'Demo Model'."
            : `Camera error: ${err.message || "Failed to start camera"}`
      setError(msg)
      return false
    }
  }, [])

  // --- Person Detection with 2-second Automatic Fallback ---
  const startPersonDetection = useCallback(() => {
    // Fallback: If body segmentation / heuristic takes >2s, automatically allow drop
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current)
    fallbackTimerRef.current = window.setTimeout(() => {
      setPersonCentered(true)
      setDrawerState((prev) => (prev === "positioning" ? "ready" : prev))
      setStatusText("Ready! Drag clothes to try on")
    }, 2000)

    let frameCount = 0
    const check = () => {
      if (!videoRef.current || !canvasRef.current) {
        personCheckRef.current = requestAnimationFrame(check)
        return
      }

      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas.getContext("2d", { willReadFrequently: true })

      if (!ctx || video.readyState < 2) {
        personCheckRef.current = requestAnimationFrame(check)
        return
      }

      frameCount++
      if (frameCount % 4 === 0) {
        canvas.width = 160
        canvas.height = 120
        ctx.drawImage(video, 0, 0, 160, 120)

        const w = 160
        const h = 120
        const cx = Math.floor(w * FRAME_MARGIN)
        const cy = Math.floor(h * FRAME_MARGIN)
        const cw = Math.floor(w * (1 - 2 * FRAME_MARGIN))
        const ch = Math.floor(h * (1 - 2 * FRAME_MARGIN))

        try {
          const imageData = ctx.getImageData(cx, cy, cw, ch)
          const data = imageData.data
          let sum = 0
          let sumSq = 0
          let count = 0
          for (let i = 0; i < data.length; i += 16) {
            const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
            sum += luma
            sumSq += luma * luma
            count++
          }

          const mean = sum / count
          const variance = sumSq / count - mean * mean
          if (variance > 280 && mean > 15 && mean < 245) {
            setPersonCentered(true)
            setDrawerState((prev) => (prev === "positioning" ? "ready" : prev))
            setStatusText("Ready! Drag clothes to try on")
          }
        } catch {}
      }

      personCheckRef.current = requestAnimationFrame(check)
    }

    personCheckRef.current = requestAnimationFrame(check)
  }, [])

  // --- Open Drawer ---
  const openDrawer = useCallback(async () => {
    setDrawerState("initializing")
    setError(null)
    setHasResult(false)
    const success = await startCamera()
    if (!success) {
      setDrawerState("positioning")
    }
  }, [startCamera])

  // --- Close Drawer ---
  const closeDrawer = useCallback(() => {
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (sessionRef.current) {
      sessionRef.current.disconnect()
      sessionRef.current = null
    }
    if (personCheckRef.current) cancelAnimationFrame(personCheckRef.current)

    setDrawerState("closed")
    setGarmentImage(null)
    setGarmentInfo("")
    setIsScanning(false)
    setHasResult(false)
    setPersonCentered(false)
    setError(null)
    setStatusText("")
    setShowSettings(false)
    setIsDemoMode(false)
  }, [])

  // --- Demo Mode (Synthetic Mannequin Stream) ---
  const activateDemoMode = useCallback(() => {
    setIsDemoMode(true)
    setError(null)
    setPersonCentered(true)
    setDrawerState("ready")
    setStatusText("Demo Model Ready — Drag clothes to try on")

    const canvas = document.createElement("canvas")
    canvas.width = 640
    canvas.height = 800
    const ctx = canvas.getContext("2d")

    let angle = 0
    const drawDemo = () => {
      if (!ctx) return
      angle += 0.02
      const grad = ctx.createLinearGradient(0, 0, 0, 800)
      grad.addColorStop(0, "#12141c")
      grad.addColorStop(1, "#181b26")
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 640, 800)

      ctx.fillStyle = "#e2e8f0"
      ctx.beginPath()
      ctx.arc(320, 160 + Math.sin(angle) * 3, 62, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillRect(306, 218, 28, 42)

      ctx.beginPath()
      ctx.ellipse(320, 390 + Math.sin(angle) * 2, 108, 138, 0, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = "rgba(0, 255, 136, 0.25)"
      ctx.beginPath()
      ctx.ellipse(320, 720, 160, 35, 0, 0, Math.PI * 2)
      ctx.fill()

      if (isDemoMode) {
        requestAnimationFrame(drawDemo)
      }
    }
    drawDemo()

    try {
      const demoStream = canvas.captureStream(30)
      streamRef.current = demoStream
      if (videoRef.current) {
        videoRef.current.srcObject = demoStream
        videoRef.current.play().catch(() => {})
      }
    } catch (e) {
      console.warn("[OpenWear] Demo stream error:", e)
    }
  }, [isDemoMode])

  // --- Main Virtual Try-On Execution ---
  const processTryOn = useCallback(
    async (blob: Blob, base64: string, title: string) => {
      console.log("GARMENT_BLOB_SIZE:", blob.size)
      if (blob.size === 0) {
        showToast("Error: Image blob is empty (0 bytes). Check CORS or network.")
        setIsScanning(false)
        return
      }

      setGarmentImage(base64)
      setGarmentInfo(title)
      setDrawerState("scanning")
      setIsScanning(true)
      setStatusText("Scanning garment & establishing Decart connection...")
      setError(null)

      try {
        const permanentKey = await getStoredApiKey()
        if (!permanentKey) {
          throw new Error("No Decart API key configured. Enter your key in Settings ⚙️.")
        }

        if (!streamRef.current) {
          throw new Error("Camera stream not available. Please allow camera or activate Demo Mode.")
        }

        const category = detectCategory(title)

        // If an active session already exists, swap outfit immediately
        if (sessionRef.current?.realtimeClient?.isConnected?.()) {
          setStatusText("Switching outfit via Decart Lucy...")
          await applyTryOn(sessionRef.current.realtimeClient, blob, category, title)
          // Scanning will be cleared when the new stream renders or after short delay
          setTimeout(() => {
            setIsScanning(false)
            setHasResult(true)
            setStatusText("Try-On Complete ✨")
          }, 1200)
          return
        }

        // Build prompt and establish Realtime WebRTC connection using ephemeral token
        const prompt = buildDetailedPrompt(category, title)
        const session = await connectRealtime(
          permanentKey,
          streamRef.current,
          (remoteStream: MediaStream) => {
            // STEP 2 d: onRemoteStream attaches stream, ends scanning, sets result
            if (videoRef.current) {
              videoRef.current.srcObject = remoteStream
              videoRef.current.play().catch(console.error)
            }
            setIsScanning(false)
            setHasResult(true)
            setStatusText("Try-On Complete ✨")
          },
          { image: blob, prompt }
        )
        sessionRef.current = session
      } catch (err: any) {
        console.error("[OpenWear] Try-on failed:", err)
        // STEP 2 e: If setImage/connect fails, stop scanning and show toast
        setIsScanning(false)
        setError(err?.message || "Virtual try-on failed.")
        showToast(err?.message || "Virtual try-on error")
        setStatusText("Try-on failed")
      }
    },
    [showToast]
  )

  // --- Convert URL / Image Source to Blob using Background Proxy ---
  const handleGarmentSource = useCallback(
    async (source: string, title = "Garment") => {
      // 1. If it's already a base64 data URL
      if (source.startsWith("data:image/")) {
        try {
          const blob = dataUrlToBlob(source)
          await processTryOn(blob, source, title)
        } catch (e: any) {
          showToast("Failed to parse image data: " + e.message)
        }
        return
      }

      // 2. Otherwise fetch via background FETCH_BLOB proxy
      setStatusText("Fetching garment via background proxy...")
      try {
        const response = await chrome.runtime.sendMessage({
          type: "FETCH_BLOB",
          url: source,
        })

        if (!response?.success || !response.base64) {
          throw new Error(response?.error || "CORS proxy failed to fetch garment image")
        }

        const blob = dataUrlToBlob(response.base64)
        console.log("GARMENT_BLOB_SIZE:", blob.size)
        await processTryOn(blob, response.base64, title)
      } catch (err: any) {
        console.error("[OpenWear] Garment fetch error:", err)
        showToast("Could not load image: " + err.message)
        setIsScanning(false)
      }
    },
    [processTryOn, showToast]
  )

  // --- Drag and Drop Handlers ---
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      // Fallback: If still in positioning, promote to ready
      setPersonCentered(true)
      setDrawerState((prev) => (prev === "positioning" ? "ready" : prev))

      // 1. Check for local desktop files
      if (e.dataTransfer.files?.length > 0) {
        const file = e.dataTransfer.files[0]
        if (file.type.startsWith("image/")) {
          const base64 = await fileToBase64(file)
          const title = file.name.replace(/\.[^/.]+$/, "")
          await processTryOn(file, base64, title)
          return
        }
      }

      // 2. Check for HTML dragged from browser
      const html = e.dataTransfer.getData("text/html")
      if (html) {
        const match = html.match(/src=["']([^"']+)["']/)
        if (match?.[1]) {
          const title = match[1].split("/").pop()?.split("?")[0] || "Garment"
          await handleGarmentSource(match[1], title)
          return
        }
      }

      // 3. Plain text / URI
      const text = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text/uri-list")
      if (text && (text.startsWith("http") || text.startsWith("data:image"))) {
        const title = text.split("/").pop()?.split("?")[0] || "Garment"
        await handleGarmentSource(text, title)
      }
    },
    [handleGarmentSource, processTryOn]
  )

  // --- Listen to Hover Button and Context Menu Messages ---
  useEffect(() => {
    const handleWindowMsg = (event: MessageEvent) => {
      if (event.data?.type === "OPENWEAR_OPEN_FITTING_ROOM") {
        if (drawerState === "closed") {
          openDrawer().then(() => {
            if (event.data.imageBase64) {
              const title = event.data.sourceUrl?.split("/").pop()?.split("?")[0] || "Garment"
              setTimeout(() => {
                handleGarmentSource(event.data.imageBase64, title)
              }, 1000)
            }
          })
        } else if (event.data.imageBase64) {
          const title = event.data.sourceUrl?.split("/").pop()?.split("?")[0] || "Garment"
          handleGarmentSource(event.data.imageBase64, title)
        }
      }
    }

    const handleRuntimeMsg = (message: any) => {
      if (message.type === "OPENWEAR_TRYON") {
        if (drawerState === "closed") {
          openDrawer().then(() => {
            if (message.imageBase64) {
              const title = message.sourceUrl?.split("/").pop()?.split("?")[0] || "Garment"
              setTimeout(() => {
                handleGarmentSource(message.imageBase64, title)
              }, 1000)
            }
          })
        } else if (message.imageBase64) {
          const title = message.sourceUrl?.split("/").pop()?.split("?")[0] || "Garment"
          handleGarmentSource(message.imageBase64, title)
        }
      } else if (message.type === "OPENWEAR_OPEN_ROOM_ONLY") {
        if (drawerState === "closed") {
          openDrawer()
        }
      }
    }

    window.addEventListener("message", handleWindowMsg)
    chrome.runtime.onMessage.addListener(handleRuntimeMsg)

    return () => {
      window.removeEventListener("message", handleWindowMsg)
      chrome.runtime.onMessage.removeListener(handleRuntimeMsg)
    }
  }, [drawerState, openDrawer, handleGarmentSource])

  // --- Save API Key from Drawer ---
  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) return
    setKeyValidating(true)
    const check = await validateApiKey(apiKey.trim())
    setKeyValidating(false)

    if (check.valid) {
      await setStoredApiKey(apiKey.trim())
      setKeySaved(true)
      setTimeout(() => setKeySaved(false), 2000)
      setError(null)
      showToast("API Key validated & saved! ✓")
    } else {
      setError(`API key error: ${check.error}`)
    }
  }

  // --- File input upload ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      const base64 = await fileToBase64(file)
      await processTryOn(file, base64, file.name.replace(/\.[^/.]+$/, ""))
    }
  }

  // ==========================================
  // RENDER: Floating Action Button (Closed)
  // ==========================================
  if (drawerState === "closed") {
    return (
      <>
        <style>{`
          @keyframes openwearGlow {
            0%, 100% { box-shadow: 0 4px 20px rgba(0, 255, 136, 0.4), 0 0 0 2px rgba(0, 255, 136, 0.2); }
            50% { box-shadow: 0 6px 30px rgba(0, 255, 136, 0.65), 0 0 0 5px rgba(0, 255, 136, 0.3); }
          }
        `}</style>
        <button
          onClick={openDrawer}
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 2147483647,
            width: 58,
            height: 58,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #00FF88 0%, #00CC6A 100%)",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            animation: "openwearGlow 2.8s infinite ease-in-out",
            transition: "transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
            userSelect: "none",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.1)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
          title="Open OpenWear Virtual Fitting Room">
          👗
        </button>
      </>
    )
  }

  // ==========================================
  // RENDER: Active Sliding Drawer Panel
  // ==========================================
  return (
    <>
      <style>{`
        @keyframes openwearSlideIn {
          from { transform: translateX(100%); opacity: 0.7; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes openwearLaserSweep {
          0% { top: 0%; opacity: 0.2; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes openwearGridLines {
          0% { background-position: 0 0; }
          100% { background-position: 0 48px; }
        }
        @keyframes openwearPulseMask {
          0%, 100% { transform: scale(1); opacity: 0.85; }
          50% { transform: scale(1.02); opacity: 1; }
        }
        .openwear-laser-beam {
          position: absolute;
          left: 0;
          right: 0;
          height: 4px;
          background: linear-gradient(90deg, transparent 4%, #00FF88 50%, transparent 96%);
          box-shadow: 0 0 16px #00FF88, 0 0 32px rgba(0, 255, 136, 0.8);
          animation: openwearLaserSweep 1.2s ease-in-out forwards;
          z-index: 50;
        }
      `}</style>

      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: 440,
          maxWidth: "100vw",
          height: "100vh",
          zIndex: 2147483647,
          background: "linear-gradient(180deg, #0d0f15 0%, #090a0e 100%)",
          color: "#ffffff",
          boxShadow: "-12px 0 50px rgba(0, 0, 0, 0.75)",
          display: "flex",
          flexDirection: "column",
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          animation: "openwearSlideIn 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
          overflow: "hidden",
          borderLeft: "1px solid rgba(255, 255, 255, 0.08)",
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            background: "rgba(255, 255, 255, 0.02)",
          }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                background: "linear-gradient(135deg, #00FF88, #00CC6A)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                boxShadow: "0 2px 10px rgba(0, 255, 136, 0.3)",
              }}>
              👗
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <h2
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    margin: 0,
                    color: "#fff",
                    letterSpacing: "-0.01em",
                  }}>
                  OpenWear
                </h2>
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 7px",
                    borderRadius: 9999,
                    background: "rgba(0, 255, 136, 0.15)",
                    color: "#00FF88",
                    fontWeight: 600,
                  }}>
                  Lucy VTON
                </span>
              </div>
              <p
                style={{
                  fontSize: 11,
                  color: "rgba(255, 255, 255, 0.5)",
                  margin: 0,
                }}>
                Your Virtual Fitting Room
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={{
                background: showSettings
                  ? "rgba(0, 255, 136, 0.2)"
                  : "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                color: showSettings ? "#00FF88" : "#aaa",
                width: 32,
                height: 32,
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
              }}
              title="Decart API Settings">
              ⚙️
            </button>
            <button
              onClick={closeDrawer}
              style={{
                background: "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                color: "#aaa",
                width: 32,
                height: 32,
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
              }}>
              ✕
            </button>
          </div>
        </div>

        {/* Settings Drawer Accordion */}
        {showSettings && (
          <div
            style={{
              padding: "14px 20px",
              background: "rgba(255, 255, 255, 0.04)",
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "rgba(255, 255, 255, 0.7)",
                marginBottom: 6,
              }}>
              Decart API Key (Platform Lucy VTON)
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="dct_..."
                style={{
                  flex: 1,
                  background: "rgba(0, 0, 0, 0.4)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "#fff",
                  fontSize: 12,
                  fontFamily: "monospace",
                  outline: "none",
                }}
              />
              <button
                onClick={handleSaveApiKey}
                disabled={keyValidating}
                style={{
                  background: keySaved
                    ? "#00FF88"
                    : "linear-gradient(135deg, #00FF88, #00CC6A)",
                  color: "#000",
                  fontWeight: 700,
                  fontSize: 12,
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 14px",
                  cursor: "pointer",
                }}>
                {keyValidating ? "..." : keySaved ? "Saved!" : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Toast Alert */}
        {toastMessage && (
          <div
            style={{
              margin: "8px 16px 0",
              padding: "10px 14px",
              borderRadius: 8,
              background: "rgba(255, 80, 80, 0.9)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
            <span>⚠️ {toastMessage}</span>
            <button
              onClick={() => setToastMessage(null)}
              style={{
                background: "none",
                border: "none",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 700,
              }}>
              ✕
            </button>
          </div>
        )}

        {/* Main Stage: Camera & Try-On Output */}
        <div
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            padding: "14px 16px 8px",
            display: "flex",
            flexDirection: "column",
          }}>
          <div
            style={{
              position: "relative",
              width: "100%",
              flex: 1,
              minHeight: 340,
              borderRadius: 16,
              overflow: "hidden",
              background: "#000",
              border: `1px solid ${
                personCentered
                  ? "rgba(0, 255, 136, 0.35)"
                  : "rgba(255, 255, 255, 0.1)"
              }`,
            }}>
            {/* Live Video Feed (switches to remote stream upon tryon) */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)",
                display: "block",
              }}
            />

            {/* Hidden canvas for image analysis */}
            <canvas ref={canvasRef} style={{ display: "none" }} />

            {/* Person Silhouette Guide Overlay (visible until result ready) */}
            {!hasResult && (drawerState === "positioning" || drawerState === "ready") && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}>
                <div
                  style={{
                    position: "relative",
                    width: "56%",
                    height: "76%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  }}>
                  {/* Head Oval */}
                  <div
                    style={{
                      width: 110,
                      height: 140,
                      borderRadius: "50%",
                      border: `2px dashed ${
                        personCentered ? "#00FF88" : "rgba(255, 255, 255, 0.4)"
                      }`,
                      background: personCentered
                        ? "rgba(0, 255, 136, 0.04)"
                        : "transparent",
                      boxShadow: personCentered
                        ? "0 0 20px rgba(0, 255, 136, 0.3)"
                        : "none",
                      transition: "all 0.3s ease",
                    }}
                  />
                  {/* Shoulders & Torso */}
                  <div
                    style={{
                      width: "100%",
                      height: "60%",
                      marginTop: -15,
                      borderRadius: "60px 60px 20px 20px",
                      border: `2px ${personCentered ? "solid" : "dashed"} ${
                        personCentered ? "#00FF88" : "rgba(255, 255, 255, 0.4)"
                      }`,
                      borderTop: "none",
                      background: personCentered
                        ? "rgba(0, 255, 136, 0.06)"
                        : "transparent",
                      boxShadow: personCentered
                        ? "0 0 25px rgba(0, 255, 136, 0.25)"
                        : "none",
                      animation: personCentered
                        ? "openwearPulseMask 2.4s infinite ease-in-out"
                        : "none",
                      transition: "all 0.3s ease",
                    }}
                  />
                </div>
              </div>
            )}

            {/* High-Tech Holographic Laser Scan Filter (1.2s forwards fill) */}
            {isScanning && (
              <>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundImage:
                      "linear-gradient(rgba(0, 255, 136, 0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 136, 0.12) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                    animation: "openwearGridLines 1s linear infinite",
                    pointerEvents: "none",
                    zIndex: 40,
                  }}
                />
                <div className="openwear-laser-beam" />
              </>
            )}

            {/* Drag & Drop Hover Overlay */}
            {isDragOver && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0, 255, 136, 0.18)",
                  border: "3px dashed #00FF88",
                  borderRadius: 16,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 60,
                  backdropFilter: "blur(4px)",
                }}>
                <span style={{ fontSize: 36, marginBottom: 6 }}>✨</span>
                <div
                  style={{
                    background: "#00FF88",
                    color: "#000",
                    padding: "9px 20px",
                    borderRadius: 9999,
                    fontSize: 14,
                    fontWeight: 700,
                    boxShadow: "0 4px 18px rgba(0, 255, 136, 0.45)",
                  }}>
                  Drop clothing to try on!
                </div>
              </div>
            )}

            {/* Status Pills */}
            <div
              style={{
                position: "absolute",
                bottom: 14,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 35,
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}>
              {!hasResult && drawerState === "positioning" && !personCentered && (
                <div
                  style={{
                    background: "rgba(255, 160, 0, 0.9)",
                    color: "#000",
                    padding: "6px 14px",
                    borderRadius: 9999,
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}>
                  Position in frame
                </div>
              )}
              {!hasResult && drawerState === "positioning" && (
                <button
                  onClick={() => {
                    setPersonCentered(true)
                    setDrawerState("ready")
                  }}
                  style={{
                    background: "rgba(0, 255, 136, 0.2)",
                    border: "1px solid #00FF88",
                    color: "#00FF88",
                    padding: "6px 14px",
                    borderRadius: 9999,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}>
                  I'm Ready ✓
                </button>
              )}
              {!hasResult && drawerState === "ready" && !garmentImage && (
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.78)",
                    border: "1px solid rgba(0, 255, 136, 0.4)",
                    color: "#00FF88",
                    padding: "7px 16px",
                    borderRadius: 9999,
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    backdropFilter: "blur(10px)",
                  }}>
                  Drag & Drop any clothing image here
                </div>
              )}
              {statusText && (isScanning || hasResult) && (
                <div
                  style={{
                    background: isScanning ? "#00FF88" : "rgba(0, 0, 0, 0.8)",
                    color: isScanning ? "#000" : "#fff",
                    border: isScanning ? "none" : "1px solid rgba(0, 255, 136, 0.4)",
                    padding: "7px 16px",
                    borderRadius: 9999,
                    fontSize: 12,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    backdropFilter: "blur(10px)",
                    boxShadow: "0 4px 15px rgba(0,0,0,0.3)",
                  }}>
                  {statusText}
                </div>
              )}
            </div>
          </div>

          {/* Diagnostic Error Banner */}
          {error && (
            <div
              style={{
                marginTop: 10,
                padding: "10px 14px",
                borderRadius: 10,
                background: "rgba(255, 80, 80, 0.12)",
                border: "1px solid rgba(255, 80, 80, 0.3)",
                color: "#ff8888",
                fontSize: 12,
                lineHeight: 1.4,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}>
              <div>⚠️ {error}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={startCamera}
                  style={{
                    background: "rgba(255, 255, 255, 0.1)",
                    border: "1px solid rgba(255, 255, 255, 0.2)",
                    color: "#fff",
                    borderRadius: 6,
                    padding: "5px 10px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}>
                  Retry Camera
                </button>
                <button
                  onClick={activateDemoMode}
                  style={{
                    background: "rgba(0, 255, 136, 0.2)",
                    border: "1px solid #00FF88",
                    color: "#00FF88",
                    borderRadius: 6,
                    padding: "5px 10px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}>
                  Use Demo Model
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Currently Trying On Preview Card */}
        {garmentImage && (
          <div
            style={{
              padding: "10px 16px",
              margin: "0 16px 8px",
              borderRadius: 12,
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}>
            <img
              src={garmentImage}
              alt="Garment"
              style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                objectFit: "cover",
                border: "1px solid rgba(0, 255, 136, 0.3)",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                {garmentInfo || "Custom Garment"}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: hasResult ? "#00FF88" : "#888",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  marginTop: 2,
                }}>
                <span>●</span>
                <span>{hasResult ? "Live Try-On Active" : isScanning ? "Scanning..." : "Applying..."}</span>
              </div>
            </div>
            <button
              onClick={() => {
                setGarmentImage(null)
                setHasResult(false)
                if (streamRef.current && videoRef.current) {
                  videoRef.current.srcObject = streamRef.current
                }
              }}
              style={{
                background: "none",
                border: "none",
                color: "#666",
                cursor: "pointer",
                fontSize: 14,
              }}>
              ✕
            </button>
          </div>
        )}

        {/* 1-Click Sample Outfits Carousel (Clean white-background garments) */}
        <div style={{ padding: "0 16px 12px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "rgba(255, 255, 255, 0.6)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}>
              Instant Try-On Outfits
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: "none",
                border: "none",
                color: "#00FF88",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
              }}>
              + Upload Photo
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 4,
            }}>
            {SAMPLE_GARMENTS.map((item: SampleGarment) => (
              <div
                key={item.id}
                onClick={() => handleGarmentSource(item.imageUrl, item.name)}
                style={{
                  minWidth: 90,
                  maxWidth: 90,
                  padding: "6px",
                  borderRadius: 10,
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  cursor: "pointer",
                  transition: "transform 0.15s, border-color 0.15s",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)"
                  e.currentTarget.style.borderColor = "rgba(0, 255, 136, 0.5)"
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)"
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)"
                }}>
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: 6,
                    objectFit: "cover",
                    marginBottom: 4,
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#eee",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    width: "100%",
                  }}>
                  {item.name}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    color: "#00FF88",
                    marginTop: 1,
                  }}>
                  {item.badge}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 16px 14px",
            borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            fontSize: 10,
            color: "rgba(255, 255, 255, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
          <span>Realtime VTON by Decart AI</span>
          <span>Drag clothes from any tab</span>
        </div>
      </div>
    </>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default FittingRoom
