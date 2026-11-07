/**
 * OpenWear Smart Mirror - In-Store Kiosk Fullscreen Mode
 *
 * Designed for 32"-55" Big Screen TVs / Smart Mirrors in retail stores.
 * Features:
 * - 100% Edge-to-Edge Camera Mirror View
 * - One-click Camera Source Switching (Laptop Webcam, Phone / Iriun Webcam, USB Camera)
 * - Large Touch & TV-Remote Friendly Outfit Carousel
 * - Keyboard / Remote Shortcuts (Arrows: navigate, Enter: wear, Space: photo, F: fullscreen, H: hide UI)
 * - Photobooth 3-2-1 Countdown & Flash Snapshot
 * - "Scan QR to Take Photo Home" Modal for shoppers
 * - Custom Store Garment Uploader for shopkeepers
 */

import React, { useState, useEffect, useRef, useCallback } from "react"
import {
  connectRealtime,
  applyTryOn,
  buildDetailedPrompt,
  detectCategory,
  dataUrlToBlob,
  getStoredApiKey,
  SAMPLE_GARMENTS,
  type DecartSession,
  type SampleGarment,
  type GarmentCategory,
} from "~lib/decart"
import { getWardrobeItems, type WardrobeItem } from "~lib/wardrobe"
import {
  saveLookbookItem,
  captureFrameFromVideo,
  generateBrandedLookCard,
  downloadImage,
} from "~lib/lookbook"
import { listenKioskAction, type KioskAction } from "~lib/kiosk-sync"

export default function KioskPage() {
  // Remote Controller Sync
  const [remoteMessage, setRemoteMessage] = useState<string | null>(null)
  const remoteTimerRef = useRef<number | null>(null)

  // Video and Stream State
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionRef = useRef<DecartSession | null>(null)

  // Camera Devices
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("")
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  // Garment & Try-On State
  const [outfits, setOutfits] = useState<Array<SampleGarment | WardrobeItem>>([])
  const [selectedOutfitIndex, setSelectedOutfitIndex] = useState<number>(0)
  const [activeGarment, setActiveGarment] = useState<{ src: string; title: string; category: GarmentCategory } | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [isWearingLive, setIsWearingLive] = useState(false)
  const [statusText, setStatusText] = useState("")

  // UI Modes
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hideUI, setHideUI] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [storeName, setStoreName] = useState("Boutique Collection")

  // Countdown & Snapshot
  const [countdown, setCountdown] = useState<number | null>(null)
  const [showFlash, setShowFlash] = useState(false)
  const [lastSnapshot, setLastSnapshot] = useState<string | null>(null)
  const [showQRModal, setShowQRModal] = useState(false)

  // Clock
  const [currentTime, setCurrentTime] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Update Clock
  useEffect(() => {
    const update = () => {
      const now = new Date()
      setCurrentTime(
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      )
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [])

  // Enumerate Connected Cameras (Laptop, Iriun, USB)
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cams = devices.filter((d) => d.kind === "videoinput")
      setVideoDevices(cams)

      // Auto-prefer Iriun / phone webcam if detected
      if (!selectedDeviceId && cams.length > 0) {
        const iriun = cams.find((c) => /iriun|droidcam|phone|wireless/i.test(c.label))
        setSelectedDeviceId(iriun ? iriun.deviceId : cams[0].deviceId)
      }
    } catch (e) {
      console.warn("Could not list video devices:", e)
    }
  }, [selectedDeviceId])

  // Start Camera Feed with Chosen Device
  const startCamera = useCallback(
    async (deviceId?: string) => {
      setCameraError(null)
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
        }

        const constraints: MediaStreamConstraints = {
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            facingMode: deviceId ? undefined : "user",
          },
          audio: false,
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        setIsCameraActive(true)
        await refreshDevices()
      } catch (err: any) {
        console.error("Camera access failed:", err)
        setCameraError(
          err.message || "Failed to start camera. Check permissions or select another camera."
        )
      }
    },
    [refreshDevices]
  )

  // Initialize Camera & Outfits on Mount
  useEffect(() => {
    startCamera()
    getWardrobeItems().then((items) => {
      const combined = [...SAMPLE_GARMENTS, ...items]
      setOutfits(combined)
    })

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
      if (sessionRef.current) {
        sessionRef.current.disconnect()
      }
    }
  }, [])

  // Live Try-On Execution
  const applyOutfit = useCallback(
    async (garmentSrc: string, title: string) => {
      if (!streamRef.current) {
        setCameraError("Camera stream not available. Please allow camera access.")
        return
      }

      const category = detectCategory(title)
      setActiveGarment({ src: garmentSrc, title, category })
      setIsScanning(true)
      setStatusText("Fitting outfit on screen...")

      try {
        const permanentKey = await getStoredApiKey()
        if (!permanentKey) {
          throw new Error("No Decart API key configured.")
        }

        // Convert data URL or fetch blob
        const blob = garmentSrc.startsWith("data:")
          ? dataUrlToBlob(garmentSrc)
          : await (await fetch(garmentSrc)).blob()

        // Fast swap if session active
        if (sessionRef.current?.realtimeClient?.isConnected?.()) {
          await applyTryOn(sessionRef.current.realtimeClient, blob, category, title)
          setTimeout(() => {
            setIsScanning(false)
            setIsWearingLive(true)
            setStatusText("")
          }, 1200)
          return
        }

        // New Realtime WebRTC connection
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
            setIsWearingLive(true)
            setStatusText("")
          },
          { image: blob, prompt }
        )
        sessionRef.current = session
      } catch (err: any) {
        console.error("Kiosk try-on failed:", err)
        setIsScanning(false)
        setStatusText("")
        setCameraError(err.message || "Try-on connection error")
      }
    },
    []
  )

  // Clear Try-on & Revert to Normal Mirror Feed
  const clearOutfit = useCallback(() => {
    setActiveGarment(null)
    setIsWearingLive(false)
    if (sessionRef.current) {
      sessionRef.current.disconnect()
      sessionRef.current = null
    }
    if (streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current
    }
  }, [])

  // 3-2-1 Countdown Photobooth Snapshot
  const triggerCountdownSnapshot = useCallback(() => {
    if (countdown !== null) return
    setCountdown(3)

    const timer1 = setTimeout(() => setCountdown(2), 1000)
    const timer2 = setTimeout(() => setCountdown(1), 2000)
    const timer3 = setTimeout(async () => {
      setCountdown(null)
      setShowFlash(true)
      setTimeout(() => setShowFlash(false), 300)

      // Capture frame
      if (videoRef.current) {
        const frame = captureFrameFromVideo(videoRef.current)
        if (frame) {
          setLastSnapshot(frame)
          setShowQRModal(true)

          // Save to Lookbook
          await saveLookbookItem({
            resultImage: frame,
            garmentTitle: activeGarment?.title || "Store Outfit",
            garmentCategory: activeGarment?.category || "upper_body",
            storeName,
            mode: "live_video",
          })
        }
      }
    }, 3000)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }, [countdown, activeGarment, storeName])

  // Fullscreen Toggle
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(console.warn)
      setIsFullscreen(true)
    } else {
      document.exitFullscreen().catch(console.warn)
      setIsFullscreen(false)
    }
  }, [])

  // Remote Toast Notification on TV
  const showRemoteNotice = useCallback((msg: string) => {
    setRemoteMessage(msg)
    if (remoteTimerRef.current) clearTimeout(remoteTimerRef.current)
    remoteTimerRef.current = window.setTimeout(() => setRemoteMessage(null), 3600)
  }, [])

  // Subscribe to Remote Actions from Laptop Controller
  useEffect(() => {
    const unsubscribe = listenKioskAction((action: KioskAction) => {
      console.log("[OpenWear Kiosk TV] Received remote command from laptop:", action)

      if (action.type === "APPLY_GARMENT") {
        showRemoteNotice(`📲 Outfit selected from Laptop: ${action.title}`)
        applyOutfit(action.garmentSrc, action.title)
      } else if (action.type === "CLEAR_GARMENT") {
        showRemoteNotice("🔄 Outfit cleared from Laptop")
        clearOutfit()
      } else if (action.type === "TRIGGER_SNAPSHOT") {
        showRemoteNotice("📸 Photo requested from Laptop!")
        triggerCountdownSnapshot()
      } else if (action.type === "NAVIGATE_OUTFIT") {
        if (action.direction === "next") {
          setSelectedOutfitIndex((prev) => (prev + 1) % (outfits.length || 1))
        } else {
          setSelectedOutfitIndex((prev) => (prev - 1 + outfits.length) % (outfits.length || 1))
        }
      } else if (action.type === "TOGGLE_FULLSCREEN") {
        toggleFullscreen()
      }
    })

    return () => {
      unsubscribe()
      if (remoteTimerRef.current) clearTimeout(remoteTimerRef.current)
    }
  }, [applyOutfit, clearOutfit, triggerCountdownSnapshot, toggleFullscreen, outfits.length, showRemoteNotice])

  // TV Remote & Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault()
        setSelectedOutfitIndex((prev) => (prev + 1) % (outfits.length || 1))
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        setSelectedOutfitIndex((prev) => (prev - 1 + outfits.length) % (outfits.length || 1))
      } else if (e.key === "Enter") {
        e.preventDefault()
        const target = outfits[selectedOutfitIndex]
        if (target) {
          applyOutfit(target.imageUrl, "name" in target ? target.name : target.title)
        }
      } else if (e.key === " " || e.key.toLowerCase() === "c") {
        e.preventDefault()
        triggerCountdownSnapshot()
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault()
        toggleFullscreen()
      } else if (e.key.toLowerCase() === "h") {
        e.preventDefault()
        setHideUI((prev) => !prev)
      } else if (e.key === "Escape") {
        setShowQRModal(false)
        setShowSettings(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [outfits, selectedOutfitIndex, applyOutfit, triggerCountdownSnapshot, toggleFullscreen])

  const selectedOutfit = outfits[selectedOutfitIndex]

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "#000",
        color: "#fff",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        overflow: "hidden",
        userSelect: "none",
      }}>
      <style>{`
        @keyframes openwearLaserSweep {
          0% { top: 0%; opacity: 0.9; }
          50% { top: 96%; opacity: 1; }
          100% { top: 0%; opacity: 0.9; }
        }
        @keyframes openwearPulseScale {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @keyframes openwearCountPop {
          0% { transform: translate(-50%, -50%) scale(0.4); opacity: 0; }
          60% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 0.9; }
        }
      `}</style>

      {/* 1. Fullscreen Mirror Video Stream */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center center",
          transform: "scaleX(-1)",
          display: "block",
          zIndex: 1,
        }}
      />

      {/* Flash overlay for Photobooth */}
      {showFlash && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "#fff",
            zIndex: 100,
            pointerEvents: "none",
            transition: "opacity 0.25s ease-out",
          }}
        />
      )}

      {/* 2. Laser Scanning Grid Animation */}
      {isScanning && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 15,
            pointerEvents: "none",
            backgroundImage:
              "linear-gradient(rgba(0, 255, 136, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 136, 0.15) 1px, transparent 1px)",
            backgroundSize: "36px 36px",
          }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              height: 4,
              background: "linear-gradient(90deg, transparent, #00FF88 30%, #ffffff 50%, #00FF88 70%, transparent)",
              boxShadow: "0 0 25px #00FF88, 0 0 50px #00FF88",
              animation: "openwearLaserSweep 2.2s infinite ease-in-out",
            }}
          />
        </div>
      )}

      {/* 3. 3-2-1 Photobooth Countdown */}
      {countdown !== null && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 90,
            fontSize: "12vw",
            fontWeight: 900,
            color: "#00FF88",
            textShadow: "0 0 60px rgba(0, 255, 136, 0.8), 0 0 100px rgba(0,0,0,0.9)",
            animation: "openwearCountPop 0.85s ease-out",
            pointerEvents: "none",
          }}>
          {countdown}
        </div>
      )}

      {/* Remote Message Banner from Laptop */}
      {remoteMessage && (
        <div
          style={{
            position: "absolute",
            top: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(10, 10, 14, 0.94)",
            border: "1.5px solid #00FF88",
            boxShadow: "0 10px 40px rgba(0, 255, 136, 0.4)",
            color: "#fff",
            padding: "10px 24px",
            borderRadius: 9999,
            fontSize: 15,
            fontWeight: 700,
            zIndex: 105,
            display: "flex",
            alignItems: "center",
            gap: 10,
            backdropFilter: "blur(16px)",
            pointerEvents: "none",
          }}>
          <span>⚡</span>
          <span>{remoteMessage}</span>
        </div>
      )}

      {/* 4. Top Store Header Bar (Auto-hideable with 'H') */}
      {!hideUI && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "20px 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(180deg, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0) 100%)",
            zIndex: 30,
          }}>
          {/* Brand & Store Name */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 32 }}>👗</span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h1
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    margin: 0,
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                  }}>
                  {storeName}
                </h1>
                <span
                  style={{
                    background: "rgba(0, 255, 136, 0.15)",
                    border: "1px solid rgba(0, 255, 136, 0.3)",
                    color: "#00FF88",
                    padding: "3px 8px",
                    borderRadius: 9999,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                  }}>
                  ● LAPTOP SYNC ACTIVE
                </span>
              </div>
              <span style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.65)", fontWeight: 500 }}>
                OpenWear Smart Virtual Fitting Mirror
              </span>
            </div>
          </div>

          {/* Clock & Action Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#00FF88",
                background: "rgba(0, 0, 0, 0.5)",
                padding: "6px 16px",
                borderRadius: 9999,
                border: "1px solid rgba(0, 255, 136, 0.3)",
              }}>
              {currentTime}
            </div>

            {/* Quick Camera Switcher Pill */}
            {videoDevices.length > 1 && (
              <select
                value={selectedDeviceId}
                onChange={(e) => {
                  setSelectedDeviceId(e.target.value)
                  startCamera(e.target.value)
                }}
                style={{
                  background: "rgba(20, 20, 26, 0.8)",
                  color: "#fff",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  padding: "8px 14px",
                  borderRadius: 10,
                  fontSize: 13,
                  cursor: "pointer",
                  outline: "none",
                }}>
                {videoDevices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    📷 {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            )}

            {/* Snapshot Button */}
            <button
              onClick={triggerCountdownSnapshot}
              title="Capture Photo (Spacebar)"
              style={{
                background: "linear-gradient(135deg, #00FF88, #00cc6a)",
                color: "#000",
                border: "none",
                borderRadius: 12,
                padding: "10px 18px",
                fontSize: 14,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                boxShadow: "0 4px 20px rgba(0, 255, 136, 0.35)",
              }}>
              <span>📸</span>
              <span>Photo</span>
            </button>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              title="Toggle Fullscreen (F)"
              style={{
                background: "rgba(255, 255, 255, 0.12)",
                color: "#fff",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: 14,
                cursor: "pointer",
              }}>
              {isFullscreen ? "🗗" : "⛶"}
            </button>

            {/* Settings */}
            <button
              onClick={() => setShowSettings((p) => !p)}
              style={{
                background: "rgba(255, 255, 255, 0.12)",
                color: "#fff",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: 14,
                cursor: "pointer",
              }}>
              ⚙️
            </button>
          </div>
        </div>
      )}

      {/* 5. Camera Error Banner */}
      {cameraError && (
        <div
          style={{
            position: "absolute",
            top: 90,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(220, 38, 38, 0.95)",
            color: "#fff",
            padding: "12px 24px",
            borderRadius: 12,
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
          }}>
          <span>⚠️ {cameraError}</span>
          <button
            onClick={() => startCamera(selectedDeviceId)}
            style={{
              background: "#fff",
              color: "#000",
              border: "none",
              padding: "6px 12px",
              borderRadius: 6,
              fontWeight: 700,
              cursor: "pointer",
            }}>
            Retry Camera
          </button>
        </div>
      )}

      {/* 6. Active Wearing Badge & Remove Garment */}
      {isWearingLive && activeGarment && !hideUI && (
        <div
          style={{
            position: "absolute",
            top: 90,
            left: 32,
            background: "rgba(10, 10, 14, 0.85)",
            backdropFilter: "blur(16px)",
            border: "1.5px solid rgba(0, 255, 136, 0.4)",
            borderRadius: 16,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            zIndex: 30,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}>
          <img
            src={activeGarment.src}
            alt={activeGarment.title}
            style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
              {activeGarment.title}
            </div>
            <div style={{ fontSize: 11, color: "#00FF88", fontWeight: 600 }}>
              ● Wearing Live on Mirror
            </div>
          </div>
          <button
            onClick={clearOutfit}
            title="Take off garment"
            style={{
              background: "rgba(255, 255, 255, 0.1)",
              border: "none",
              color: "#fff",
              borderRadius: "50%",
              width: 28,
              height: 28,
              cursor: "pointer",
              marginLeft: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
            ✕
          </button>
        </div>
      )}

      {/* 7. Bottom In-Store Outfits Carousel */}
      {!hideUI && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "24px 32px 32px",
            background: "linear-gradient(0deg, rgba(0, 0, 0, 0.92) 0%, rgba(0, 0, 0, 0.6) 70%, transparent 100%)",
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}>
          {/* Shelf Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#00FF88",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}>
                IN-STORE COLLECTION
              </span>
              <span style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.5)" }}>
                • Use Arrow Keys or Tap to Try On
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  color: "#00FF88",
                  padding: "6px 14px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}>
                + Upload Store Garment
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    const reader = new FileReader()
                    reader.onloadend = () => {
                      const base64 = reader.result as string
                      const title = file.name.replace(/\.[^/.]+$/, "")
                      const newOutfit: WardrobeItem = {
                        id: "upload-" + Date.now(),
                        title,
                        imageUrl: base64,
                        category: detectCategory(title),
                        addedAt: Date.now(),
                        storeName,
                      }
                      setOutfits((prev) => [newOutfit, ...prev])
                      applyOutfit(base64, title)
                    }
                    reader.readAsDataURL(file)
                  }
                }}
              />
              <button
                onClick={() => setHideUI(true)}
                title="Hide buttons for clean mirror view (Press H)"
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255, 255, 255, 0.5)",
                  fontSize: 12,
                  cursor: "pointer",
                }}>
                Hide UI [H]
              </button>
            </div>
          </div>

          {/* Carousel Cards */}
          <div
            style={{
              display: "flex",
              gap: 14,
              overflowX: "auto",
              paddingBottom: 6,
              scrollbarWidth: "none",
            }}>
            {outfits.map((item, idx) => {
              const title = "name" in item ? item.name : item.title
              const price = "price" in item ? item.price : undefined
              const badge = "badge" in item ? item.badge : item.category.replace("_", " ")
              const isSelected = selectedOutfitIndex === idx
              const isActive = activeGarment?.title === title && isWearingLive

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setSelectedOutfitIndex(idx)
                    applyOutfit(item.imageUrl, title)
                  }}
                  style={{
                    minWidth: 150,
                    maxWidth: 150,
                    background: isSelected
                      ? "rgba(0, 255, 136, 0.18)"
                      : "rgba(255, 255, 255, 0.06)",
                    border: isActive
                      ? "2.5px solid #00FF88"
                      : isSelected
                        ? "2px solid rgba(0, 255, 136, 0.7)"
                        : "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: 16,
                    padding: 8,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    transform: isSelected ? "translateY(-6px) scale(1.03)" : "none",
                    boxShadow: isSelected
                      ? "0 10px 30px rgba(0, 255, 136, 0.25)"
                      : "0 4px 15px rgba(0,0,0,0.4)",
                  }}>
                  <div style={{ position: "relative", width: "100%", height: 120, marginBottom: 8 }}>
                    <img
                      src={item.imageUrl}
                      alt={title}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        borderRadius: 10,
                      }}
                    />
                    {isActive && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: 6,
                          left: "50%",
                          transform: "translateX(-50%)",
                          background: "#00FF88",
                          color: "#000",
                          fontSize: 9,
                          fontWeight: 800,
                          padding: "2px 8px",
                          borderRadius: 9999,
                          whiteSpace: "nowrap",
                        }}>
                        WEARING
                      </div>
                    )}
                  </div>

                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#fff",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      width: "100%",
                    }}>
                    {title}
                  </span>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                      marginTop: 4,
                    }}>
                    <span style={{ fontSize: 10, color: "#00FF88", textTransform: "capitalize" }}>
                      {badge}
                    </span>
                    {price && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>
                        {price}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 8. Show UI Floating Button when hidden */}
      {hideUI && (
        <button
          onClick={() => setHideUI(false)}
          style={{
            position: "absolute",
            bottom: 24,
            right: 24,
            background: "rgba(0, 0, 0, 0.7)",
            color: "#00FF88",
            border: "1px solid rgba(0, 255, 136, 0.4)",
            padding: "8px 16px",
            borderRadius: 9999,
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            zIndex: 40,
            backdropFilter: "blur(8px)",
          }}>
          👗 Show Outfits [H]
        </button>
      )}

      {/* 9. "Scan QR to Take Photo Home" Modal */}
      {showQRModal && lastSnapshot && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.85)",
            backdropFilter: "blur(20px)",
            zIndex: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}>
          <div
            style={{
              background: "#0f1015",
              border: "1.5px solid rgba(0, 255, 136, 0.35)",
              borderRadius: 24,
              padding: "32px 40px",
              maxWidth: 580,
              width: "100%",
              textAlign: "center",
              boxShadow: "0 25px 80px rgba(0, 0, 0, 0.8)",
            }}>
            <h2 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 8px", color: "#fff" }}>
              📸 Your Look is Ready!
            </h2>
            <p style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.65)", margin: "0 0 24px" }}>
              Scan the QR code with your phone camera to download this photo and share on Instagram or WhatsApp!
            </p>

            <div
              style={{
                display: "flex",
                gap: 24,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 24,
              }}>
              <img
                src={lastSnapshot}
                alt="Snapshot Preview"
                style={{
                  width: 170,
                  height: 220,
                  objectFit: "cover",
                  borderRadius: 14,
                  border: "2px solid rgba(255, 255, 255, 0.2)",
                }}
              />

              {/* In-Store QR Code Generator */}
              <div
                style={{
                  background: "#fff",
                  padding: 14,
                  borderRadius: 16,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                    window.location.origin
                  )}`}
                  alt="QR Code"
                  style={{ width: 170, height: 170, display: "block" }}
                />
                <span style={{ fontSize: 10, fontWeight: 700, color: "#000", marginTop: 6 }}>
                  SCAN TO DOWNLOAD
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={() => downloadImage(lastSnapshot, "my-store-look.png")}
                style={{
                  background: "linear-gradient(135deg, #00FF88, #00cc6a)",
                  color: "#000",
                  border: "none",
                  padding: "12px 24px",
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}>
                💾 Save Photo to PC
              </button>
              <button
                onClick={() => setShowQRModal(false)}
                style={{
                  background: "rgba(255, 255, 255, 0.1)",
                  color: "#fff",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  padding: "12px 24px",
                  borderRadius: 12,
                  fontSize: 14,
                  cursor: "pointer",
                }}>
                ✕ Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 10. Store Settings Modal */}
      {showSettings && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.8)",
            backdropFilter: "blur(14px)",
            zIndex: 110,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
          <div
            style={{
              background: "#111218",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: 20,
              padding: 28,
              maxWidth: 420,
              width: "100%",
            }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>
              Store Kiosk Settings
            </h3>
            <label style={{ fontSize: 12, color: "#aaa", display: "block", marginBottom: 6 }}>
              Store or Boutique Name
            </label>
            <input
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="e.g. Zara Mumbai / Fashion House"
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid rgba(255, 255, 255, 0.2)",
                background: "rgba(255, 255, 255, 0.05)",
                color: "#fff",
                fontSize: 13,
                marginBottom: 18,
                outline: "none",
                boxSizing: "border-box",
              }}
            />

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  flex: 1,
                  background: "#00FF88",
                  color: "#000",
                  border: "none",
                  padding: "10px 0",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                }}>
                Save & Return
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
