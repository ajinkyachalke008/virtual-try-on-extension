/**
 * OpenWear Side Panel
 *
 * Provides the virtual fitting room inside Chrome's native Side Panel.
 * Runs in the chrome-extension:// origin with full unrestricted camera permissions.
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
import "./style.css"

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timeoutId)
        reject(error)
      }
    )
  })
}

function SidePanel() {
  const [isDragOver, setIsDragOver] = useState(false)
  const [garmentImage, setGarmentImage] = useState<string | null>(null)
  const [garmentInfo, setGarmentInfo] = useState<string>("")
  const [isScanning, setIsScanning] = useState(false)
  const [statusText, setStatusText] = useState("Step into the frame")
  const [error, setError] = useState<string | null>(null)
  const [hasResult, setHasResult] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionRef = useRef<DecartSession | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const remoteStreamTimeoutRef = useRef<number | null>(null)
  const hasRemoteStreamRef = useRef(false)

  // Start Camera on Mount
  useEffect(() => {
    let active = true

    async function initCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
          },
          audio: false,
        })
        if (!active) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch (err: any) {
        setError(`Camera error: ${err.message}`)
      }
    }

    initCamera()

    return () => {
      active = false
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
      if (remoteStreamTimeoutRef.current !== null) {
        clearTimeout(remoteStreamTimeoutRef.current)
        remoteStreamTimeoutRef.current = null
      }
      if (sessionRef.current) {
        sessionRef.current.disconnect()
        sessionRef.current = null
      }
    }
  }, [])

  const executeTryOn = useCallback(
    async (blob: Blob, imageBase64: string, title: string) => {
      console.log("GARMENT_BLOB_SIZE:", blob.size)
      if (blob.size === 0) {
        setIsScanning(false)
        setError("The garment image is empty. Choose another image or check the image source.")
        return
      }
      if (blob.type && !blob.type.startsWith("image/")) {
        setIsScanning(false)
        setError(`Unsupported garment file type: ${blob.type}`)
        return
      }

      setGarmentImage(imageBase64)
      setGarmentInfo(title)
      setIsScanning(true)
      setStatusText("Connecting to Decart and preparing garment...")
      setError(null)

      try {
        const apiKey = await getStoredApiKey()
        if (!apiKey) {
          throw new Error("No Decart API key found. Enter your own key in the OpenWear popup.")
        }

        const localStream = streamRef.current
        if (!localStream || !localStream.getVideoTracks().some((track) => track.readyState === "live")) {
          throw new Error("Camera stream is not available or has no live video track.")
        }

        const category = detectCategory(title)

        if (sessionRef.current) {
          await withTimeout(
            applyTryOn(sessionRef.current.realtimeClient, blob, category, title),
            35000,
            "Decart did not acknowledge the garment update within 35 seconds."
          )
          setIsScanning(false)
          setHasResult(true)
          setStatusText("Live Try-On Active ✨")
          return
        }

        hasRemoteStreamRef.current = false
        const connectPromise = connectRealtime(
          apiKey,
          localStream,
          (remoteStream) => {
            console.log("REMOTE_STREAM_RECEIVED:", Boolean(remoteStream))
            hasRemoteStreamRef.current = true
            if (remoteStreamTimeoutRef.current !== null) {
              clearTimeout(remoteStreamTimeoutRef.current)
              remoteStreamTimeoutRef.current = null
            }
            if (videoRef.current) {
              videoRef.current.srcObject = remoteStream
              videoRef.current.play().catch((playError) => {
                console.error("[OpenWear SidePanel] Remote video playback failed:", playError)
              })
            }
            setIsScanning(false)
            setHasResult(true)
            setStatusText("Live Try-On Active ✨")
          }
        )

        let session: DecartSession
        try {
          session = await withTimeout(
            connectPromise,
            45000,
            "Decart realtime connection timed out after 45 seconds."
          )
        } catch (connectError) {
          void connectPromise.then((lateSession) => lateSession.disconnect()).catch(() => {})
          throw connectError
        }

        sessionRef.current = session

        // First garment must be sent explicitly after the realtime connection is established.
        await withTimeout(
          applyTryOn(session.realtimeClient, blob, category, title),
          35000,
          "Decart did not acknowledge the garment image within 35 seconds."
        )

        if (!hasRemoteStreamRef.current) {
          setStatusText("Garment sent — waiting for the transformed video stream...")
          remoteStreamTimeoutRef.current = window.setTimeout(() => {
            remoteStreamTimeoutRef.current = null
            setIsScanning(false)
            setHasResult(false)
            setError("Decart connected but no transformed video stream arrived. Check WebRTC connectivity and API-key access.")
            setStatusText("No transformed stream received")
            sessionRef.current?.disconnect()
            sessionRef.current = null
          }, 30000)
        } else {
          setIsScanning(false)
          setHasResult(true)
          setStatusText("Live Try-On Active ✨")
        }
      } catch (err: any) {
        if (remoteStreamTimeoutRef.current !== null) {
          clearTimeout(remoteStreamTimeoutRef.current)
          remoteStreamTimeoutRef.current = null
        }
        sessionRef.current?.disconnect()
        sessionRef.current = null
        console.error("[OpenWear SidePanel] Error:", err)
        setIsScanning(false)
        setHasResult(false)
        setError(`Try-on error: ${err?.message || "Failed"}`)
        setStatusText("Try-on failed")
      }
    },
    []
  )

  const handleGarmentSource = useCallback(
    async (source: string, title = "Garment") => {
      if (source.startsWith("data:image/")) {
        const blob = dataUrlToBlob(source)
        await executeTryOn(blob, source, title)
        return
      }

      setStatusText("Fetching garment via background proxy...")
      try {
        const res = await chrome.runtime.sendMessage({
          type: "FETCH_BLOB",
          url: source,
        })
        if (!res?.success || !res.base64) {
          throw new Error(res?.error || "Fetch failed")
        }
        const blob = dataUrlToBlob(res.base64)
        await executeTryOn(blob, res.base64, title)
      } catch (err: any) {
        setIsScanning(false)
        setError(err.message)
      }
    },
    [executeTryOn]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      if (e.dataTransfer.files?.length > 0) {
        const file = e.dataTransfer.files[0]
        if (file.type.startsWith("image/")) {
          const reader = new FileReader()
          reader.onloadend = () => {
            executeTryOn(file, reader.result as string, file.name.replace(/\.[^/.]+$/, ""))
          }
          reader.readAsDataURL(file)
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
    [handleGarmentSource, executeTryOn]
  )

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0d0e12",
        color: "#fff",
        fontFamily: "'Inter', sans-serif",
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}>
      {/* Header */}
      <div
        style={{
          padding: "16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
        <span style={{ fontSize: 20 }}>👗</span>
        <div>
          <h2 style={{ fontSize: 16, margin: 0, fontWeight: 700 }}>
            OpenWear Side Panel
          </h2>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
            Decart Lucy VTON Realtime
          </span>
        </div>
      </div>

      {/* Stage */}
      <div style={{ flex: 1, position: "relative", padding: "16px" }}>
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 16,
            overflow: "hidden",
            background: "#000",
            border: "1px solid rgba(255,255,255,0.1)",
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
              transform: "scaleX(-1)",
              display: "block",
            }}
          />

          {isScanning && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                height: 4,
                top: "50%",
                background: "#00FF88",
                boxShadow: "0 0 20px #00FF88",
                zIndex: 20,
              }}
            />
          )}

          {isDragOver && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,255,136,0.2)",
                border: "3px dashed #00FF88",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 30,
              }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                Drop clothing here!
              </span>
            </div>
          )}

          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.75)",
              color: "#00FF88",
              padding: "6px 16px",
              borderRadius: 9999,
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}>
            {statusText}
          </div>
        </div>
      </div>

      {/* Sample Outfits */}
      <div style={{ padding: "0 16px 16px" }}>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
          QUICK TRY-ON (CLEAN GARMENTS)
        </div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
          {SAMPLE_GARMENTS.map((g) => (
            <div
              key={g.id}
              onClick={() => handleGarmentSource(g.imageUrl, g.name)}
              style={{
                minWidth: 70,
                textAlign: "center",
                cursor: "pointer",
                padding: 4,
                borderRadius: 8,
                background: "rgba(255,255,255,0.05)",
              }}>
              <img
                src={g.imageUrl}
                alt={g.name}
                style={{ width: 62, height: 62, borderRadius: 6, objectFit: "cover" }}
              />
              <div
                style={{
                  fontSize: 10,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                {g.name}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SidePanel
