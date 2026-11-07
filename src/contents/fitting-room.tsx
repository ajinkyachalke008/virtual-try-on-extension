/**
 * OpenWear Fitting Room - Side Panel Drawer
 *
 * All-in-One AI Virtual Fitting Room:
 * 1. 🎥 Live Cam: Decart Lucy VTON Realtime WebRTC low-latency streaming
 * 2. 📷 Photo Studio: Dual-engine try-on on 4 preset models or custom photos
 * 3. 👗 My Wardrobe: Persistent wardrobe management with category filters
 * 4. 📸 Lookbook: HD snapshot capture, social cards, and download studio
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
  type GarmentCategory,
} from "~lib/decart"
import {
  getWardrobeItems,
  saveWardrobeItem,
  deleteWardrobeItem,
  type WardrobeItem,
} from "~lib/wardrobe"
import {
  getLookbookItems,
  saveLookbookItem,
  deleteLookbookItem,
  captureFrameFromVideo,
  captureFrameFromCanvas,
  generateBrandedLookCard,
  downloadImage,
  type LookbookItem,
} from "~lib/lookbook"
import {
  PRESET_MODELS,
  createPhotoMediaStream,
  renderPhotorealisticTryOn,
  renderComparisonSplit,
  renderBaseModel,
  type PresetModel,
} from "~lib/photo-tryon"
import {
  activateSplitLayout,
  deactivateSplitLayout,
} from "~lib/layout-manager"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
}

export const getShadowHostId = () => "openwear-fitting-room"

type TabType = "live_cam" | "photo_studio" | "wardrobe" | "lookbook"
type DrawerState = "closed" | "initializing" | "positioning" | "ready" | "scanning" | "tryon"
type PhotoEngineMode = "direct_composite" | "webrtc_stream"

function FittingRoom() {
  // --- Navigation & Core Drawer States ---
  const [activeTab, setActiveTab] = useState<TabType>("live_cam")
  const [drawerState, setDrawerState] = useState<DrawerState>("closed")
  const [personCentered, setPersonCentered] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [garmentImage, setGarmentImage] = useState<string | null>(null)
  const [garmentInfo, setGarmentInfo] = useState<string>("")
  const [garmentPrice, setGarmentPrice] = useState<string | null>(null)
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

  // --- Wardrobe & Lookbook Collections ---
  const [wardrobeItems, setWardrobeItems] = useState<WardrobeItem[]>([])
  const [wardrobeFilter, setWardrobeFilter] = useState<string>("all")
  const [lookbookItems, setLookbookItems] = useState<LookbookItem[]>([])

  // --- Photo Studio States ---
  const [selectedModel, setSelectedModel] = useState<PresetModel>(PRESET_MODELS[0])
  const [customPhotoUrl, setCustomPhotoUrl] = useState<string | null>(null)
  const [photoEngineMode, setPhotoEngineMode] = useState<PhotoEngineMode>("direct_composite")
  const [photoTryOnResult, setPhotoTryOnResult] = useState<string | null>(null)
  const [isPhotoRendering, setIsPhotoRendering] = useState(false)
  const [splitPercent, setSplitPercent] = useState<number>(50)
  const [showSplitCompare, setShowSplitCompare] = useState<boolean>(false)

  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const photoCanvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const photoStreamStopRef = useRef<(() => void) | null>(null)
  const sessionRef = useRef<DecartSession | null>(null)
  const personCheckRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const photoModelInputRef = useRef<HTMLInputElement>(null)
  const fallbackTimerRef = useRef<number | null>(null)

  // Load API key, Wardrobe, and Lookbook on Mount
  useEffect(() => {
    getStoredApiKey().then(setApiKey)
    getWardrobeItems().then(setWardrobeItems)
    getLookbookItems().then(setLookbookItems)

    return () => {
      deactivateSplitLayout()
    }
  }, [])

  const refreshWardrobe = useCallback(async () => {
    const items = await getWardrobeItems()
    setWardrobeItems(items)
  }, [])

  const refreshLookbook = useCallback(async () => {
    const items = await getLookbookItems()
    setLookbookItems(items)
  }, [])

  // Auto-render base model on canvas in photo studio
  useEffect(() => {
    if (activeTab === "photo_studio" && photoCanvasRef.current && !photoTryOnResult) {
      renderBaseModel(photoCanvasRef.current, customPhotoUrl || selectedModel.imageUrl).catch(console.warn)
    }
  }, [activeTab, selectedModel, customPhotoUrl, photoTryOnResult])

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 4000)
  }, [])

  // --- Start Camera Feed for Live Cam ---
  const startCamera = useCallback(async () => {
    setError(null)
    setStatusText("Initializing camera...")

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera API is restricted on this webpage. Switch to Photo Studio 📷 to test try-on.")
      return false
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
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

      // Fallback timer: auto-center after 2 seconds
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = window.setTimeout(() => {
        setPersonCentered(true)
        setDrawerState("ready")
        setStatusText("")
      }, 2000)

      return true
    } catch (err: any) {
      console.warn("[OpenWear] Camera error:", err)
      setError(`Camera error: ${err.message || "Permission denied"}. Use Photo Studio 📷 for instant try-on.`)
      return false
    }
  }, [])

  // --- Stop Live Camera ---
  const stopCamera = useCallback(() => {
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current)
    if (personCheckRef.current) cancelAnimationFrame(personCheckRef.current)

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    if (sessionRef.current) {
      sessionRef.current.disconnect()
      sessionRef.current = null
    }
  }, [])

  // --- Open Drawer (Activates True 70:30 Desktop Split Layout) ---
  const openDrawer = useCallback(async () => {
    activateSplitLayout()
    setDrawerState("initializing")
    if (activeTab === "live_cam") {
      const ok = await startCamera()
      if (!ok) {
        setDrawerState("ready")
      }
    } else {
      setDrawerState("ready")
    }
  }, [activeTab, startCamera])

  // --- Close Drawer (Restores Webpage 100% Layout & Styles) ---
  const closeDrawer = useCallback(() => {
    deactivateSplitLayout()
    stopCamera()
    if (photoStreamStopRef.current) {
      photoStreamStopRef.current()
      photoStreamStopRef.current = null
    }
    setDrawerState("closed")
    setGarmentImage(null)
    setHasResult(false)
    setIsScanning(false)
    setError(null)
  }, [stopCamera])

  // --- Switch Tabs ---
  const handleTabSwitch = useCallback(
    async (tab: TabType) => {
      setActiveTab(tab)
      setError(null)

      if (tab === "live_cam") {
        if (!streamRef.current && drawerState !== "closed") {
          await startCamera()
        }
      } else if (tab === "wardrobe") {
        await refreshWardrobe()
      } else if (tab === "lookbook") {
        await refreshLookbook()
      }
    },
    [drawerState, startCamera, refreshWardrobe, refreshLookbook]
  )

  // --- Live WebRTC Try-On Processor ---
  const processLiveTryOn = useCallback(
    async (blob: Blob, base64: string, title = "Garment") => {
      setGarmentImage(base64)
      setGarmentInfo(title)
      setDrawerState("scanning")
      setIsScanning(true)
      setStatusText("Scanning garment & connecting Decart Lucy...")
      setError(null)

      try {
        const permanentKey = await getStoredApiKey()
        if (!permanentKey) {
          throw new Error("No Decart API key configured. Enter your key in Settings ⚙️.")
        }

        if (!streamRef.current) {
          throw new Error("Camera stream not available. Switch to Photo Studio 📷 or allow camera.")
        }

        const category = detectCategory(title)

        // If an active session already exists, swap outfit immediately
        if (sessionRef.current?.realtimeClient?.isConnected?.()) {
          setStatusText("Applying outfit...")
          await applyTryOn(sessionRef.current.realtimeClient, blob, category, title)
          setTimeout(() => {
            setIsScanning(false)
            setHasResult(true)
            setStatusText("")
          }, 1200)
          return
        }

        // Connect Realtime WebRTC
        const prompt = buildDetailedPrompt(category, title)
        const session = await connectRealtime(
          permanentKey,
          streamRef.current,
          (remoteStream: MediaStream) => {
            if (videoRef.current) {
              videoRef.current.srcObject = remoteStream
              videoRef.current.play().catch(console.error)
            }
            setIsScanning(false)
            setHasResult(true)
            setStatusText("")
          },
          { image: blob, prompt }
        )
        sessionRef.current = session
      } catch (err: any) {
        console.error("[OpenWear] Live try-on failed:", err)
        setIsScanning(false)
        let msg = err?.message || "Virtual try-on failed."
        if (
          msg.includes("Stale connect attempt") ||
          msg.includes("Insufficient credits") ||
          msg.includes("1008") ||
          msg.includes("closed")
        ) {
          msg = "Decart API Key has Insufficient Credits. Please enter a new API key in Settings ⚙️."
        }
        setError(msg)
        showToast(msg)
        setStatusText("API Credits Exhausted")
      }
    },
    [showToast]
  )

  // --- Photo Studio Try-On Processor ---
  const processPhotoTryOn = useCallback(
    async (garmentSrc: string, title = "Garment") => {
      setGarmentImage(garmentSrc)
      setGarmentInfo(title)
      setIsPhotoRendering(true)
      setError(null)

      const category = detectCategory(title)
      const currentModelSrc = customPhotoUrl || selectedModel.imageUrl

      try {
        if (photoEngineMode === "direct_composite") {
          // Direct Photorealistic Composite
          if (!photoCanvasRef.current) throw new Error("Photo studio canvas not available")
          const resultDataUrl = await renderPhotorealisticTryOn(
            photoCanvasRef.current,
            currentModelSrc,
            garmentSrc,
            category,
            customPhotoUrl ? undefined : selectedModel.torsoAnchor
          )
          setPhotoTryOnResult(resultDataUrl)
          setHasResult(true)
          setStatusText("")
        } else {
          // WebRTC Stream Bridge into Decart Lucy
          const permanentKey = await getStoredApiKey()
          if (!permanentKey) {
            throw new Error("Decart API Key required for WebRTC stream mode. Set in ⚙️.")
          }

          if (photoStreamStopRef.current) {
            photoStreamStopRef.current()
          }

          const { stream, stop } = await createPhotoMediaStream(currentModelSrc)
          photoStreamStopRef.current = stop

          const blob = garmentSrc.startsWith("data:")
            ? dataUrlToBlob(garmentSrc)
            : await (await fetch(garmentSrc)).blob()

          const prompt = buildDetailedPrompt(category, title)
          const session = await connectRealtime(
            permanentKey,
            stream,
            (remoteStream: MediaStream) => {
              if (videoRef.current) {
                videoRef.current.srcObject = remoteStream
                videoRef.current.play().catch(console.error)
              }
              setHasResult(true)
              setIsPhotoRendering(false)
              setStatusText("")
            },
            { image: blob, prompt }
          )
          sessionRef.current = session
        }
      } catch (err: any) {
        console.error("[OpenWear] Photo try-on error:", err)
        setError(err.message || "Failed to render photo try-on")
        showToast(err.message || "Photo try-on error")
      } finally {
        setIsPhotoRendering(false)
      }
    },
    [customPhotoUrl, selectedModel, photoEngineMode, showToast]
  )

  // --- Unified Garment Router ---
  const handleGarmentSource = useCallback(
    async (source: string, title = "Garment", price?: string) => {
      if (price) setGarmentPrice(price)

      // 1. Convert source to base64 via background proxy to bypass all CORS
      let base64 = source
      if (!source.startsWith("data:image/")) {
        setStatusText("Fetching garment via background proxy...")
        try {
          const response = await chrome.runtime.sendMessage({
            type: "FETCH_BLOB",
            url: source,
          })
          if (response?.success && response.base64) {
            base64 = response.base64
          }
        } catch (err) {
          console.warn("[OpenWear] Background proxy fetch fallback:", err)
        }
      }

      // 2. Route based on active tab
      if (activeTab === "photo_studio") {
        await processPhotoTryOn(base64, title)
        return
      }

      // Live cam mode (or fallback to live cam)
      try {
        const blob = dataUrlToBlob(base64)
        await processLiveTryOn(blob, base64, title)
      } catch (e: any) {
        showToast("Failed to parse image data: " + e.message)
      }
    },
    [activeTab, processPhotoTryOn, processLiveTryOn, showToast]
  )

  // --- Snapshot Trigger ---
  const handleCaptureSnapshot = useCallback(async () => {
    let capturedDataUrl: string | null = null

    if (activeTab === "live_cam" && videoRef.current) {
      capturedDataUrl = captureFrameFromVideo(videoRef.current, { mirror: true })
    } else if (activeTab === "photo_studio") {
      if (photoTryOnResult) {
        capturedDataUrl = photoTryOnResult
      } else if (photoCanvasRef.current) {
        capturedDataUrl = captureFrameFromCanvas(photoCanvasRef.current)
      } else if (videoRef.current) {
        capturedDataUrl = captureFrameFromVideo(videoRef.current)
      }
    }

    if (!capturedDataUrl) {
      showToast("No active try-on output to capture")
      return
    }

    const category = detectCategory(garmentInfo)
    const newLook = await saveLookbookItem({
      garmentTitle: garmentInfo || "Custom Look",
      garmentCategory: category,
      garmentImageUrl: garmentImage || undefined,
      resultImage: capturedDataUrl,
      mode: activeTab === "live_cam" ? "live_video" : "photo_studio",
      storeName: window.location.hostname.replace(/^www\./i, ""),
      storeUrl: window.location.href,
    })

    await refreshLookbook()
    showToast("📸 Snapshot saved to Lookbook!")
  }, [activeTab, garmentInfo, garmentImage, photoTryOnResult, refreshLookbook, showToast])

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
      setPersonCentered(true)
      setDrawerState((prev) => (prev === "positioning" ? "ready" : prev))

      if (e.dataTransfer.files?.length > 0) {
        const file = e.dataTransfer.files[0]
        if (file.type.startsWith("image/")) {
          const base64 = await fileToBase64(file)
          const title = file.name.replace(/\.[^/.]+$/, "")
          await handleGarmentSource(base64, title)
          return
        }
      }

      const html = e.dataTransfer.getData("text/html")
      if (html) {
        const match = html.match(/src=["']([^"']+)["']/)
        if (match?.[1]) {
          const title = match[1].split("/").pop()?.split("?")[0] || "Garment"
          await handleGarmentSource(match[1], title)
          return
        }
      }

      const text = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text/uri-list")
      if (text && (text.startsWith("http") || text.startsWith("data:image"))) {
        const title = text.split("/").pop()?.split("?")[0] || "Garment"
        await handleGarmentSource(text, title)
      }
    },
    [handleGarmentSource]
  )

  // --- Listen to Hover Button and Extension Messages ---
  useEffect(() => {
    const handleWindowMsg = (event: MessageEvent) => {
      if (event.data?.type === "OPENWEAR_OPEN_FITTING_ROOM") {
        if (drawerState === "closed") {
          openDrawer().then(() => {
            if (event.data.imageBase64) {
              const title = event.data.title || event.data.sourceUrl?.split("/").pop()?.split("?")[0] || "Garment"
              setTimeout(() => {
                handleGarmentSource(event.data.imageBase64, title, event.data.price)
              }, 800)
            }
          })
        } else if (event.data.imageBase64) {
          const title = event.data.title || event.data.sourceUrl?.split("/").pop()?.split("?")[0] || "Garment"
          handleGarmentSource(event.data.imageBase64, title, event.data.price)
        }
      } else if (event.data?.type === "OPENWEAR_WARDROBE_UPDATED") {
        refreshWardrobe()
      }
    }

    const handleRuntimeMsg = (message: any) => {
      if (message.type === "OPENWEAR_TRYON") {
        if (drawerState === "closed") {
          openDrawer().then(() => {
            if (message.imageBase64) {
              const title = message.title || message.sourceUrl?.split("/").pop()?.split("?")[0] || "Garment"
              setTimeout(() => {
                handleGarmentSource(message.imageBase64, title, message.price)
              }, 800)
            }
          })
        } else if (message.imageBase64) {
          const title = message.title || message.sourceUrl?.split("/").pop()?.split("?")[0] || "Garment"
          handleGarmentSource(message.imageBase64, title, message.price)
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
  }, [drawerState, openDrawer, handleGarmentSource, refreshWardrobe])

  // --- Save API Key Handler ---
  const handleSaveApiKey = useCallback(async () => {
    if (!apiKey.trim()) return
    setKeyValidating(true)
    const res = await validateApiKey(apiKey.trim())
    setKeyValidating(false)

    if (res.valid) {
      await setStoredApiKey(apiKey.trim())
      setKeySaved(true)
      showToast("Decart API Key verified and saved! ✓")
      setTimeout(() => setKeySaved(false), 2000)
      setShowSettings(false)
    } else {
      showToast(res.error || "Invalid Decart API Key")
    }
  }, [apiKey, showToast])

  // Floating Action Button when Drawer is Closed
  if (drawerState === "closed") {
    return (
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 2147483647,
          fontFamily: "'Inter', -apple-system, sans-serif",
        }}>
        <button
          onClick={openDrawer}
          style={{
            width: 58,
            height: 58,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #00FF88, #00CC6A)",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            boxShadow: "0 8px 30px rgba(0, 255, 136, 0.45), 0 0 15px rgba(0, 255, 136, 0.3)",
            transition: "transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
          title="Open OpenWear Virtual Fitting Room">
          👗
        </button>
      </div>
    )
  }

  // Filtered wardrobe
  const displayedWardrobe = wardrobeItems.filter((item) =>
    wardrobeFilter === "all" ? true : item.category === wardrobeFilter
  )

  return (
    <>
      <style>{`
        @keyframes openwearLaserSweep {
          0% { top: 0%; opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes openwearPulseMask {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.015); }
        }
        .openwear-laser-beam {
          position: absolute;
          left: 0;
          right: 0;
          height: 3px;
          background: #00FF88;
          box-shadow: 0 0 15px #00FF88, 0 0 30px #00FF88;
          animation: openwearLaserSweep 1.2s ease-in-out infinite;
          z-index: 45;
          pointer-events: none;
        }

        /* Responsive 70:30 Desktop Split Layout Shell */
        .openwear-drawer-shell {
          position: fixed;
          top: 0;
          right: 0;
          height: 100vh;
          background: linear-gradient(180deg, #0e1017 0%, #13151f 50%, #151824 100%);
          color: #ffffff;
          z-index: 2147483647;
          box-shadow: -12px 0 45px rgba(0, 0, 0, 0.75);
          display: flex;
          flex-direction: column;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          border-left: 1px solid rgba(255, 255, 255, 0.08);
          user-select: none;
          box-sizing: border-box;
          transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @media (min-width: 1200px) {
          .openwear-drawer-shell {
            width: 30vw !important;
            max-width: 30vw !important;
            min-width: 360px !important;
          }
        }

        @media (min-width: 960px) and (max-width: 1199px) {
          .openwear-drawer-shell {
            width: 380px !important;
            max-width: 420px !important;
            min-width: 360px !important;
          }
        }

        @media (max-width: 959px) {
          .openwear-drawer-shell {
            width: min(100vw, 440px) !important;
          }
        }
      `}</style>

      {/* Main Drawer Shell (30% on Desktop >= 1200px) */}
      <div
        className="openwear-drawer-shell"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}>
        {/* Top Header */}
        <div
          style={{
            padding: "16px 18px 12px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>👗</span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
                  OpenWear
                </h2>
              </div>
              <p style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.5)", margin: "2px 0 0" }}>
                Virtual Fitting Room
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => {
                chrome.runtime.sendMessage({ type: "OPEN_KIOSK" })
              }}
              style={{
                background: "rgba(0, 255, 136, 0.12)",
                border: "1px solid rgba(0, 255, 136, 0.3)",
                color: "#00FF88",
                width: 32,
                height: 32,
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
              }}
              title="Launch Big Screen Store Kiosk (TV Mirror Mode)">
              🖥️
            </button>
            <button
              onClick={() => {
                chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" })
              }}
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
              }}
              title="Open Side Panel">
              🪟
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={{
                background: showSettings ? "rgba(0, 255, 136, 0.15)" : "rgba(255, 255, 255, 0.06)",
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
              title="Settings">
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

        {/* 4-Tab Navigation Bar */}
        <div
          style={{
            display: "flex",
            padding: "8px 12px",
            background: "rgba(0, 0, 0, 0.25)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            gap: 6,
          }}>
          {[
            { id: "live_cam", label: "🎥 Live Cam" },
            { id: "photo_studio", label: "📷 Photo Studio" },
            { id: "wardrobe", label: `👗 Wardrobe (${wardrobeItems.length})` },
            { id: "lookbook", label: `📸 Lookbook (${lookbookItems.length})` },
          ].map((tab) => {
            const isSel = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => handleTabSwitch(tab.id as TabType)}
                style={{
                  flex: 1,
                  padding: "7px 4px",
                  borderRadius: 8,
                  border: isSel ? "1px solid rgba(0, 255, 136, 0.4)" : "1px solid transparent",
                  background: isSel ? "rgba(0, 255, 136, 0.14)" : "transparent",
                  color: isSel ? "#00FF88" : "rgba(255, 255, 255, 0.65)",
                  fontSize: 11,
                  fontWeight: isSel ? 700 : 500,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                }}>
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Settings Drawer Accordion */}
        {showSettings && (
          <div
            style={{
              padding: "14px 18px",
              background: "rgba(0, 0, 0, 0.45)",
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255, 255, 255, 0.7)", marginBottom: 6 }}>
              Decart Lucy VTON API Key
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
                  background: keySaved ? "#00FF88" : "linear-gradient(135deg, #00FF88, #00CC6A)",
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
              margin: "8px 14px 0",
              padding: "9px 13px",
              borderRadius: 8,
              background: toastMessage.includes("saved") || toastMessage.includes("verified")
                ? "rgba(0, 204, 106, 0.95)"
                : "rgba(255, 80, 80, 0.95)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
            <span>{toastMessage}</span>
            <button
              onClick={() => setToastMessage(null)}
              style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
              ✕
            </button>
          </div>
        )}

        {/* TAB 1: 🎥 LIVE CAM VIEWPORT */}
        {activeTab === "live_cam" && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: "12px 16px 8px",
              overflow: "hidden",
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
                  personCentered ? "rgba(0, 255, 136, 0.35)" : "rgba(255, 255, 255, 0.1)"
                }`,
              }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "center top",
                  transform: "scaleX(-1)",
                  display: "block",
                }}
              />
              <canvas ref={canvasRef} style={{ display: "none" }} />

              {/* Silhouette Guide Overlay */}
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
                    <div
                      style={{
                        width: 100,
                        height: 130,
                        borderRadius: "50%",
                        border: `2px dashed ${personCentered ? "#00FF88" : "rgba(255, 255, 255, 0.4)"}`,
                        boxShadow: personCentered ? "0 0 20px rgba(0, 255, 136, 0.3)" : "none",
                        transition: "all 0.3s ease",
                      }}
                    />
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
                        animation: personCentered ? "openwearPulseMask 2.4s infinite ease-in-out" : "none",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Laser Scan Animation */}
              {isScanning && (
                <>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backgroundImage:
                        "linear-gradient(rgba(0, 255, 136, 0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 136, 0.12) 1px, transparent 1px)",
                      backgroundSize: "24px 24px",
                      pointerEvents: "none",
                      zIndex: 40,
                    }}
                  />
                  <div className="openwear-laser-beam" />
                </>
              )}

              {/* Drag & Drop Overlay */}
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
                      padding: "8px 18px",
                      borderRadius: 9999,
                      fontSize: 13,
                      fontWeight: 700,
                    }}>
                    Drop clothing to try on!
                  </div>
                </div>
              )}

              {/* Floating Snapshot Button */}
              {hasResult && (
                <button
                  onClick={handleCaptureSnapshot}
                  title="Capture Snapshot to Lookbook"
                  style={{
                    position: "absolute",
                    top: 14,
                    right: 14,
                    zIndex: 50,
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: "rgba(0, 0, 0, 0.75)",
                    border: "1px solid rgba(0, 255, 136, 0.5)",
                    color: "#00FF88",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    cursor: "pointer",
                    boxShadow: "0 4px 15px rgba(0, 255, 136, 0.3)",
                  }}>
                  📸
                </button>
              )}

              {/* Transient Scanning Pill - Completely hidden during active wearing */}
              {!hasResult && isScanning && statusText && (
                <div
                  style={{
                    position: "absolute",
                    bottom: 12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 35,
                    pointerEvents: "none",
                  }}>
                  <div
                    style={{
                      background: "#00FF88",
                      color: "#000",
                      padding: "6px 14px",
                      borderRadius: 9999,
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      boxShadow: "0 2px 10px rgba(0, 255, 136, 0.4)",
                    }}>
                    {statusText}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: 📷 PHOTO STUDIO VIEWPORT */}
        {activeTab === "photo_studio" && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: "10px 16px 8px",
              overflowY: "auto",
            }}>
            {/* Model Preset Selection Bar */}
            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255, 255, 255, 0.65)" }}>
                  SELECT MODEL OR UPLOAD PHOTO
                </span>
                <button
                  onClick={() => photoModelInputRef.current?.click()}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#00FF88",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: 0,
                  }}>
                  + Upload Mine
                </button>
                <input
                  ref={photoModelInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      const base64 = await fileToBase64(file)
                      setCustomPhotoUrl(base64)
                      showToast("Custom photo loaded! Select garment to try on.")
                    }
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                {PRESET_MODELS.map((model) => {
                  const isSel = !customPhotoUrl && selectedModel.id === model.id
                  return (
                    <div
                      key={model.id}
                      onClick={() => {
                        setCustomPhotoUrl(null)
                        setSelectedModel(model)
                        if (garmentImage) processPhotoTryOn(garmentImage, garmentInfo)
                      }}
                      style={{
                        minWidth: 80,
                        maxWidth: 80,
                        padding: 4,
                        borderRadius: 8,
                        background: isSel ? "rgba(0, 255, 136, 0.15)" : "rgba(255, 255, 255, 0.04)",
                        border: isSel ? "1.5px solid #00FF88" : "1px solid rgba(255, 255, 255, 0.08)",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        textAlign: "center",
                      }}>
                      <img
                        src={model.imageUrl}
                        alt={model.name}
                        style={{ width: 72, height: 72, borderRadius: 6, objectFit: "cover" }}
                      />
                      <span style={{ fontSize: 10, fontWeight: 600, marginTop: 3 }}>{model.name}</span>
                      <span style={{ fontSize: 8, color: isSel ? "#00FF88" : "#888" }}>{model.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Engine Mode Toggle */}
            <div
              style={{
                display: "flex",
                background: "rgba(0, 0, 0, 0.35)",
                padding: 3,
                borderRadius: 8,
                marginBottom: 8,
              }}>
              <button
                onClick={() => setPhotoEngineMode("direct_composite")}
                style={{
                  flex: 1,
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: "none",
                  background:
                    photoEngineMode === "direct_composite" ? "rgba(0, 255, 136, 0.2)" : "transparent",
                  color: photoEngineMode === "direct_composite" ? "#00FF88" : "#888",
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                }}>
                ⚡ Instant Composite
              </button>
              <button
                onClick={() => setPhotoEngineMode("webrtc_stream")}
                style={{
                  flex: 1,
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: "none",
                  background:
                    photoEngineMode === "webrtc_stream" ? "rgba(0, 255, 136, 0.2)" : "transparent",
                  color: photoEngineMode === "webrtc_stream" ? "#00FF88" : "#888",
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                }}>
                🌐 Decart Lucy WebRTC
              </button>
            </div>

            {/* Photo Studio Stage */}
            <div
              style={{
                position: "relative",
                width: "100%",
                flex: 1,
                minHeight: 330,
                borderRadius: 16,
                overflow: "hidden",
                background: "#08090d",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
              {/* Photo Canvas Engine */}
              <canvas
                ref={photoCanvasRef}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  display: photoEngineMode === "direct_composite" ? "block" : "none",
                }}
              />

              {/* WebRTC Stream Video (if in webrtc_stream mode) */}
              {photoEngineMode === "webrtc_stream" && (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    display: "block",
                  }}
                />
              )}

              {/* Floating Action Buttons */}
              <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 6, zIndex: 30 }}>
                {hasResult && (
                  <button
                    onClick={() => {
                      const next = !showSplitCompare
                      setShowSplitCompare(next)
                      if (next && photoCanvasRef.current && photoTryOnResult) {
                        renderComparisonSplit(
                          photoCanvasRef.current,
                          customPhotoUrl || selectedModel.imageUrl,
                          photoTryOnResult,
                          splitPercent
                        )
                      }
                    }}
                    title="Toggle Before / After Comparison"
                    style={{
                      background: showSplitCompare ? "#00FF88" : "rgba(0, 0, 0, 0.7)",
                      color: showSplitCompare ? "#000" : "#fff",
                      border: "1px solid rgba(255, 255, 255, 0.2)",
                      borderRadius: 8,
                      padding: "6px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}>
                    ⇄ Compare
                  </button>
                )}
                <button
                  onClick={handleCaptureSnapshot}
                  title="Capture to Lookbook"
                  style={{
                    background: "rgba(0, 0, 0, 0.7)",
                    color: "#00FF88",
                    border: "1px solid rgba(0, 255, 136, 0.4)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}>
                  📸 Snapshot
                </button>
              </div>

              {/* Compare Slider Track */}
              {showSplitCompare && hasResult && (
                <div
                  style={{
                    position: "absolute",
                    bottom: 12,
                    left: 20,
                    right: 20,
                    zIndex: 35,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "rgba(0, 0, 0, 0.75)",
                    padding: "6px 12px",
                    borderRadius: 9999,
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                  }}>
                  <span style={{ fontSize: 10, color: "#aaa" }}>Before</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={splitPercent}
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      setSplitPercent(val)
                      if (photoCanvasRef.current && photoTryOnResult) {
                        renderComparisonSplit(
                          photoCanvasRef.current,
                          customPhotoUrl || selectedModel.imageUrl,
                          photoTryOnResult,
                          val
                        )
                      }
                    }}
                    style={{ flex: 1, accentColor: "#00FF88" }}
                  />
                  <span style={{ fontSize: 10, color: "#00FF88" }}>After</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: 👗 MY WARDROBE VIEWPORT */}
        {activeTab === "wardrobe" && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: "12px 16px",
              overflowY: "auto",
            }}>
            {/* Category Filters */}
            <div style={{ display: "flex", gap: 5, overflowX: "auto", paddingBottom: 8, marginBottom: 8 }}>
              {["all", "upper_body", "lower_body", "dress", "outerwear"].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setWardrobeFilter(cat)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 9999,
                    border: wardrobeFilter === cat ? "1px solid #00FF88" : "1px solid rgba(255, 255, 255, 0.1)",
                    background: wardrobeFilter === cat ? "rgba(0, 255, 136, 0.15)" : "rgba(255, 255, 255, 0.04)",
                    color: wardrobeFilter === cat ? "#00FF88" : "#ccc",
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                    textTransform: "capitalize",
                    whiteSpace: "nowrap",
                  }}>
                  {cat.replace("_", " ")}
                </button>
              ))}
            </div>

            {/* Wardrobe Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 10,
              }}>
              {displayedWardrobe.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: "rgba(255, 255, 255, 0.04)",
                    borderRadius: 12,
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}>
                  <div style={{ position: "relative", width: "100%", height: 130, background: "#161822" }}>
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    {item.price && (
                      <span
                        style={{
                          position: "absolute",
                          top: 8,
                          left: 8,
                          background: "rgba(0, 0, 0, 0.8)",
                          color: "#00FF88",
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                        }}>
                        {item.price}
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        const updated = await deleteWardrobeItem(item.id)
                        setWardrobeItems(updated)
                        showToast("Garment removed from wardrobe")
                      }}
                      title="Delete Garment"
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        background: "rgba(0, 0, 0, 0.6)",
                        border: "none",
                        color: "#ff6666",
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                      }}>
                      ✕
                    </button>
                  </div>
                  <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#fff",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                      {item.title}
                    </div>
                    <span style={{ fontSize: 9, color: "rgba(255, 255, 255, 0.45)" }}>
                      {item.storeName || "OpenWear Wardrobe"}
                    </span>
                    <button
                      onClick={() => {
                        handleGarmentSource(item.imageUrl, item.title, item.price)
                        // If on wardrobe tab, automatically switch to active studio
                        setActiveTab("live_cam")
                      }}
                      style={{
                        marginTop: "auto",
                        background: "linear-gradient(135deg, rgba(0, 255, 136, 0.2), rgba(0, 204, 106, 0.15))",
                        border: "1px solid rgba(0, 255, 136, 0.4)",
                        color: "#00FF88",
                        borderRadius: 6,
                        padding: "6px 0",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}>
                      Try On 👗
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: 📸 LOOKBOOK VIEWPORT */}
        {activeTab === "lookbook" && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: "12px 16px",
              overflowY: "auto",
            }}>
            {lookbookItems.length === 0 ? (
              <div
                style={{
                  margin: "auto",
                  textAlign: "center",
                  color: "rgba(255, 255, 255, 0.45)",
                  padding: 24,
                }}>
                <span style={{ fontSize: 36, display: "block", marginBottom: 8 }}>📸</span>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>No looks saved yet</p>
                <p style={{ fontSize: 11 }}>
                  Try on any outfit and click the 📸 Snapshot button to save your favorite styles!
                </p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                {lookbookItems.map((look) => (
                  <div
                    key={look.id}
                    style={{
                      background: "rgba(255, 255, 255, 0.04)",
                      borderRadius: 12,
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                    }}>
                    <div style={{ width: "100%", height: 160, background: "#0a0b0f" }}>
                      <img
                        src={look.resultImage}
                        alt={look.garmentTitle}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </div>
                    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#fff",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                        {look.garmentTitle}
                      </span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => downloadImage(look.resultImage, `openwear-${look.id}.png`)}
                          style={{
                            flex: 1,
                            background: "rgba(0, 255, 136, 0.15)",
                            border: "1px solid rgba(0, 255, 136, 0.35)",
                            color: "#00FF88",
                            borderRadius: 6,
                            padding: "5px 0",
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}>
                          Download
                        </button>
                        <button
                          onClick={async () => {
                            const cardUrl = await generateBrandedLookCard(look)
                            downloadImage(cardUrl, `openwear-card-${look.id}.png`)
                          }}
                          style={{
                            flex: 1,
                            background: "rgba(255, 255, 255, 0.08)",
                            border: "1px solid rgba(255, 255, 255, 0.12)",
                            color: "#fff",
                            borderRadius: 6,
                            padding: "5px 0",
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}>
                          Card 🎴
                        </button>
                        <button
                          onClick={async () => {
                            const updated = await deleteLookbookItem(look.id)
                            setLookbookItems(updated)
                            showToast("Look deleted")
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#ff6666",
                            cursor: "pointer",
                            fontSize: 12,
                            padding: "0 4px",
                          }}>
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* BOTTOM SECTION: Currently Active Garment Banner */}
        {garmentImage && (activeTab === "live_cam" || activeTab === "photo_studio") && (
          <div
            style={{
              padding: "8px 14px",
              margin: "0 16px 8px",
              borderRadius: 12,
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}>
            <img
              src={garmentImage}
              alt="Garment"
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                objectFit: "cover",
                border: "1px solid rgba(0, 255, 136, 0.3)",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#fff",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                {garmentInfo || "Garment"}
              </div>
              <div style={{ fontSize: 10, color: "#00FF88" }}>
                {garmentPrice ? `${garmentPrice} • ` : ""}
                {hasResult ? (activeTab === "live_cam" ? "Wearing Live" : "Active on Model") : "Applying..."}
              </div>
            </div>
            <button
              onClick={() => {
                setGarmentImage(null)
                setHasResult(false)
                setPhotoTryOnResult(null)
                if (streamRef.current && videoRef.current) {
                  videoRef.current.srcObject = streamRef.current
                }
              }}
              style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 13 }}>
              ✕
            </button>
          </div>
        )}

        {/* BOTTOM SECTION: 1-Click Sample Outfits Carousel */}
        {(activeTab === "live_cam" || activeTab === "photo_studio") && (
          <div style={{ padding: "0 16px 10px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(255, 255, 255, 0.55)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}>
                1-Click Outfits
              </span>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: "none",
                  border: "none",
                  color: "#00FF88",
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                }}>
                + Upload Garment
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    const base64 = await fileToBase64(file)
                    const title = file.name.replace(/\.[^/.]+$/, "")
                    await handleGarmentSource(base64, title)
                  }
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2 }}>
              {SAMPLE_GARMENTS.map((item: SampleGarment) => (
                <div
                  key={item.id}
                  onClick={() => handleGarmentSource(item.imageUrl, item.name)}
                  style={{
                    minWidth: 84,
                    maxWidth: 84,
                    padding: "5px",
                    borderRadius: 8,
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                  }}>
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    style={{ width: 70, height: 70, borderRadius: 6, objectFit: "cover", marginBottom: 3 }}
                  />
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      color: "#eee",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      width: "100%",
                    }}>
                    {item.name}
                  </span>
                  <span style={{ fontSize: 8, color: "#00FF88" }}>{item.badge}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom Drawer Footer */}
        <div
          style={{
            padding: "8px 16px 12px",
            borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            fontSize: 10,
            color: "rgba(255, 255, 255, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
          <span>OpenWear Virtual Fitting Room</span>
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
