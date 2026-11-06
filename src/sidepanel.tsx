/**
 * OpenWear Side Panel
 *
 * Full-featured virtual fitting room inside Chrome's native Side Panel.
 * Runs in the chrome-extension:// origin with unrestricted camera permissions.
 * Includes:
 * 1. 🎥 Live Cam: Decart Lucy VTON WebRTC streaming
 * 2. 📷 Photo Studio: Dual-mode engine on 4 preset models or custom upload
 * 3. 👗 My Wardrobe: Persistent wardrobe management
 * 4. 📸 Lookbook: HD snapshot gallery and downloads
 */

import { useState, useEffect, useRef, useCallback } from "react"
import {
  connectRealtime,
  applyTryOn,
  detectCategory,
  dataUrlToBlob,
  getStoredApiKey,
  SAMPLE_GARMENTS,
  type DecartSession,
  type SampleGarment,
} from "~lib/decart"
import {
  getWardrobeItems,
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
  renderPhotorealisticTryOn,
  renderComparisonSplit,
  createPhotoMediaStream,
  type PresetModel,
} from "~lib/photo-tryon"
import "./style.css"

type TabType = "live_cam" | "photo_studio" | "wardrobe" | "lookbook"

function SidePanel() {
  const [activeTab, setActiveTab] = useState<TabType>("live_cam")
  const [isDragOver, setIsDragOver] = useState(false)
  const [garmentImage, setGarmentImage] = useState<string | null>(null)
  const [garmentInfo, setGarmentInfo] = useState<string>("")
  const [isScanning, setIsScanning] = useState(false)
  const [statusText, setStatusText] = useState("Step into frame")
  const [error, setError] = useState<string | null>(null)
  const [hasResult, setHasResult] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Collections
  const [wardrobeItems, setWardrobeItems] = useState<WardrobeItem[]>([])
  const [wardrobeFilter, setWardrobeFilter] = useState<string>("all")
  const [lookbookItems, setLookbookItems] = useState<LookbookItem[]>([])

  // Photo Studio States
  const [selectedModel, setSelectedModel] = useState<PresetModel>(PRESET_MODELS[0])
  const [customPhotoUrl, setCustomPhotoUrl] = useState<string | null>(null)
  const [photoEngineMode, setPhotoEngineMode] = useState<"direct_composite" | "webrtc_stream">("direct_composite")
  const [photoTryOnResult, setPhotoTryOnResult] = useState<string | null>(null)
  const [splitPercent, setSplitPercent] = useState<number>(50)
  const [showSplitCompare, setShowSplitCompare] = useState<boolean>(false)

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null)
  const photoCanvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const photoStreamStopRef = useRef<(() => void) | null>(null)
  const sessionRef = useRef<DecartSession | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelFileInputRef = useRef<HTMLInputElement>(null)

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }, [])

  // Start Camera for Live Cam
  const startCamera = useCallback(async () => {
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
      setStatusText("Ready for garments")
    } catch (err: any) {
      setError(`Camera error: ${err.message}. Switch to Photo Studio 📷.`)
    }
  }, [])

  // Load Data on Mount
  useEffect(() => {
    let active = true
    getWardrobeItems().then((w) => active && setWardrobeItems(w))
    getLookbookItems().then((l) => active && setLookbookItems(l))
    startCamera()

    return () => {
      active = false
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      if (photoStreamStopRef.current) photoStreamStopRef.current()
      if (sessionRef.current) sessionRef.current.disconnect()
    }
  }, [startCamera])

  const refreshWardrobe = useCallback(async () => {
    const w = await getWardrobeItems()
    setWardrobeItems(w)
  }, [])

  const refreshLookbook = useCallback(async () => {
    const l = await getLookbookItems()
    setLookbookItems(l)
  }, [])

  // Live Try-On Processor
  const executeLiveTryOn = useCallback(
    async (blob: Blob, imageBase64: string, title: string) => {
      setGarmentImage(imageBase64)
      setGarmentInfo(title)
      setIsScanning(true)
      setStatusText("Scanning garment & connecting...")
      setError(null)

      try {
        const apiKey = await getStoredApiKey()
        if (!apiKey) throw new Error("No Decart API key found.")
        if (!streamRef.current) throw new Error("Camera stream not available.")

        const category = detectCategory(title)

        if (sessionRef.current?.realtimeClient?.isConnected?.()) {
          setStatusText("Updating garment...")
          await applyTryOn(sessionRef.current.realtimeClient, blob, category, title)
          setTimeout(() => {
            setIsScanning(false)
            setHasResult(true)
            setStatusText("Try-On Complete ✨")
          }, 1200)
          return
        }

        const session = await connectRealtime(
          apiKey,
          streamRef.current,
          (remoteStream: MediaStream) => {
            if (videoRef.current) {
              videoRef.current.srcObject = remoteStream
              videoRef.current.play().catch(console.error)
            }
            setIsScanning(false)
            setHasResult(true)
            setStatusText("Try-On Complete ✨")
          },
          { image: blob, prompt: title }
        )
        sessionRef.current = session
      } catch (err: any) {
        setIsScanning(false)
        let msg = err.message || "Failed to connect"
        if (
          msg.includes("Stale connect attempt") ||
          msg.includes("Insufficient credits") ||
          msg.includes("1008") ||
          msg.includes("closed")
        ) {
          msg = "Decart API Key has Insufficient Credits. Please provide a new key."
        }
        setError(msg)
        showToast(msg)
      }
    },
    [showToast]
  )

  // Photo Try-On Processor
  const executePhotoTryOn = useCallback(
    async (garmentSrc: string, title: string) => {
      setGarmentImage(garmentSrc)
      setGarmentInfo(title)
      setError(null)

      const category = detectCategory(title)
      const currentModelSrc = customPhotoUrl || selectedModel.imageUrl

      try {
        if (photoEngineMode === "direct_composite") {
          if (!photoCanvasRef.current) return
          const result = await renderPhotorealisticTryOn(
            photoCanvasRef.current,
            currentModelSrc,
            garmentSrc,
            category,
            customPhotoUrl ? undefined : selectedModel.torsoAnchor
          )
          setPhotoTryOnResult(result)
          setHasResult(true)
          setStatusText("Photo Try-On Complete ✨")
        } else {
          const apiKey = await getStoredApiKey()
          if (!apiKey) throw new Error("Decart API Key required.")

          if (photoStreamStopRef.current) photoStreamStopRef.current()
          const { stream, stop } = await createPhotoMediaStream(currentModelSrc)
          photoStreamStopRef.current = stop

          const blob = garmentSrc.startsWith("data:")
            ? dataUrlToBlob(garmentSrc)
            : await (await fetch(garmentSrc)).blob()

          const session = await connectRealtime(
            apiKey,
            stream,
            (remoteStream: MediaStream) => {
              if (videoRef.current) {
                videoRef.current.srcObject = remoteStream
                videoRef.current.play().catch(console.error)
              }
              setHasResult(true)
              setStatusText("WebRTC Photo Try-On Active ✨")
            },
            { image: blob, prompt: title }
          )
          sessionRef.current = session
        }
      } catch (err: any) {
        setError(err.message || "Photo try-on error")
        showToast(err.message)
      }
    },
    [customPhotoUrl, selectedModel, photoEngineMode, showToast]
  )

  // Snapshot Trigger
  const handleCaptureSnapshot = useCallback(async () => {
    let capturedUrl: string | null = null

    if (activeTab === "live_cam" && videoRef.current) {
      capturedUrl = captureFrameFromVideo(videoRef.current, { mirror: true })
    } else if (activeTab === "photo_studio") {
      if (photoTryOnResult) capturedUrl = photoTryOnResult
      else if (photoCanvasRef.current) capturedUrl = captureFrameFromCanvas(photoCanvasRef.current)
    }

    if (!capturedUrl) {
      showToast("No active try-on output to capture")
      return
    }

    await saveLookbookItem({
      garmentTitle: garmentInfo || "Custom Look",
      garmentCategory: detectCategory(garmentInfo),
      resultImage: capturedUrl,
      mode: activeTab === "live_cam" ? "live_video" : "photo_studio",
    })
    await refreshLookbook()
    showToast("📸 Snapshot saved to Lookbook!")
  }, [activeTab, garmentInfo, photoTryOnResult, refreshLookbook, showToast])

  const handleGarmentRoute = useCallback(
    async (src: string, title = "Garment") => {
      let base64 = src
      if (!src.startsWith("data:")) {
        try {
          const res = await chrome.runtime.sendMessage({ type: "FETCH_BLOB", url: src })
          if (res?.success && res.base64) {
            base64 = res.base64
          }
        } catch (e) {
          console.warn("[OpenWear Sidepanel] Proxy fetch error:", e)
        }
      }

      if (activeTab === "photo_studio") {
        await executePhotoTryOn(base64, title)
        return
      }

      try {
        const blob = dataUrlToBlob(base64)
        await executeLiveTryOn(blob, base64, title)
      } catch (err: any) {
        showToast("Error parsing garment: " + err.message)
      }
    },
    [activeTab, executePhotoTryOn, executeLiveTryOn, showToast]
  )

  const displayedWardrobe = wardrobeItems.filter((i) =>
    wardrobeFilter === "all" ? true : i.category === wardrobeFilter
  )

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "linear-gradient(180deg, #0e1017 0%, #13151f 50%, #151824 100%)",
        color: "#fff",
        fontFamily: "'Inter', -apple-system, sans-serif",
      }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 18px 12px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>👗</span>
          <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>OpenWear Studio</h1>
        </div>
        <span
          style={{
            background: "rgba(0, 255, 136, 0.15)",
            color: "#00FF88",
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 9999,
          }}>
          PRO
        </span>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          padding: "6px 10px",
          background: "rgba(0, 0, 0, 0.3)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          gap: 4,
        }}>
        {[
          { id: "live_cam", label: "🎥 Live" },
          { id: "photo_studio", label: "📷 Studio" },
          { id: "wardrobe", label: `👗 Wardrobe (${wardrobeItems.length})` },
          { id: "lookbook", label: `📸 Looks (${lookbookItems.length})` },
        ].map((t) => {
          const isSel = activeTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => {
                setActiveTab(t.id as TabType)
                if (t.id === "wardrobe") refreshWardrobe()
                if (t.id === "lookbook") refreshLookbook()
              }}
              style={{
                flex: 1,
                padding: "6px 2px",
                borderRadius: 6,
                border: isSel ? "1px solid rgba(0, 255, 136, 0.4)" : "1px solid transparent",
                background: isSel ? "rgba(0, 255, 136, 0.12)" : "transparent",
                color: isSel ? "#00FF88" : "rgba(255, 255, 255, 0.6)",
                fontSize: 11,
                fontWeight: isSel ? 700 : 500,
                cursor: "pointer",
              }}>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Toast Alert */}
      {toastMessage && (
        <div
          style={{
            margin: "6px 12px 0",
            padding: "8px 12px",
            borderRadius: 6,
            background: toastMessage.includes("saved") ? "#00CC6A" : "#ff5555",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
          }}>
          {toastMessage}
        </div>
      )}

      {/* TAB 1: Live Cam */}
      {activeTab === "live_cam" && (
        <div style={{ flex: 1, padding: 12, display: "flex", flexDirection: "column" }}>
          <div
            style={{
              position: "relative",
              flex: 1,
              borderRadius: 14,
              overflow: "hidden",
              background: "#000",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
            />
            {hasResult && (
              <button
                onClick={handleCaptureSnapshot}
                style={{
                  position: "absolute",
                  top: 10,
                  right: 10,
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.7)",
                  border: "1px solid #00FF88",
                  color: "#00FF88",
                  cursor: "pointer",
                  fontSize: 16,
                }}>
                📸
              </button>
            )}
            <div
              style={{
                position: "absolute",
                bottom: 10,
                left: "50%",
                transform: "translateX(-50%)",
                background: "rgba(0,0,0,0.8)",
                padding: "4px 12px",
                borderRadius: 9999,
                fontSize: 11,
                color: "#00FF88",
              }}>
              {statusText}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Photo Studio */}
      {activeTab === "photo_studio" && (
        <div style={{ flex: 1, padding: 12, display: "flex", flexDirection: "column", overflowY: "auto" }}>
          {/* Preset Models */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 8, paddingBottom: 2 }}>
            {PRESET_MODELS.map((m) => {
              const isSel = selectedModel.id === m.id && !customPhotoUrl
              return (
                <div
                  key={m.id}
                  onClick={() => {
                    setCustomPhotoUrl(null)
                    setSelectedModel(m)
                  }}
                  style={{
                    minWidth: 70,
                    maxWidth: 70,
                    padding: 4,
                    borderRadius: 8,
                    background: isSel ? "rgba(0, 255, 136, 0.15)" : "rgba(255,255,255,0.04)",
                    border: isSel ? "1.5px solid #00FF88" : "1px solid rgba(255,255,255,0.08)",
                    cursor: "pointer",
                    textAlign: "center",
                  }}>
                  <img src={m.imageUrl} alt={m.name} style={{ width: 62, height: 62, borderRadius: 6, objectFit: "cover" }} />
                  <span style={{ fontSize: 9, fontWeight: 600 }}>{m.name}</span>
                </div>
              )
            })}
          </div>

          <div
            style={{
              position: "relative",
              flex: 1,
              borderRadius: 14,
              overflow: "hidden",
              background: "#090a0f",
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
            <canvas ref={photoCanvasRef} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            {!hasResult && (
              <img
                src={customPhotoUrl || selectedModel.imageUrl}
                alt="Model"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            )}
            <button
              onClick={handleCaptureSnapshot}
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                background: "rgba(0,0,0,0.7)",
                border: "1px solid #00FF88",
                color: "#00FF88",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}>
              📸 Snapshot
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: Wardrobe */}
      {activeTab === "wardrobe" && (
        <div style={{ flex: 1, padding: 12, overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            {displayedWardrobe.map((item) => (
              <div
                key={item.id}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.08)",
                  overflow: "hidden",
                }}>
                <img src={item.imageUrl} alt={item.title} style={{ width: "100%", height: 110, objectFit: "cover" }} />
                <div style={{ padding: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.title}
                  </div>
                  <button
                    onClick={() => {
                      handleGarmentRoute(item.imageUrl, item.title)
                      setActiveTab("live_cam")
                    }}
                    style={{
                      marginTop: 6,
                      width: "100%",
                      background: "rgba(0, 255, 136, 0.15)",
                      border: "1px solid #00FF88",
                      color: "#00FF88",
                      borderRadius: 6,
                      padding: "4px 0",
                      fontSize: 10,
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

      {/* TAB 4: Lookbook */}
      {activeTab === "lookbook" && (
        <div style={{ flex: 1, padding: 12, overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            {lookbookItems.map((look) => (
              <div
                key={look.id}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.08)",
                  overflow: "hidden",
                }}>
                <img src={look.resultImage} alt={look.garmentTitle} style={{ width: "100%", height: 130, objectFit: "cover" }} />
                <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {look.garmentTitle}
                  </span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => downloadImage(look.resultImage, `look-${look.id}.png`)}
                      style={{
                        flex: 1,
                        background: "rgba(0, 255, 136, 0.15)",
                        border: "1px solid #00FF88",
                        color: "#00FF88",
                        borderRadius: 4,
                        padding: "3px 0",
                        fontSize: 9,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}>
                      Download
                    </button>
                    <button
                      onClick={async () => {
                        const updated = await deleteLookbookItem(look.id)
                        setLookbookItems(updated)
                      }}
                      style={{ background: "none", border: "none", color: "#ff6666", cursor: "pointer", fontSize: 11 }}>
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outfits Carousel Footer */}
      {(activeTab === "live_cam" || activeTab === "photo_studio") && (
        <div style={{ padding: "8px 12px 10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {SAMPLE_GARMENTS.map((g) => (
              <div
                key={g.id}
                onClick={() => handleGarmentRoute(g.imageUrl, g.name)}
                style={{
                  minWidth: 70,
                  maxWidth: 70,
                  padding: 4,
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  cursor: "pointer",
                  textAlign: "center",
                }}>
                <img src={g.imageUrl} alt={g.name} style={{ width: 62, height: 62, borderRadius: 6, objectFit: "cover" }} />
                <span style={{ fontSize: 8, fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {g.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default SidePanel
