import { useState, useEffect, useCallback } from "react"
import {
  DEFAULT_API_KEY,
  getStoredApiKey,
  setStoredApiKey,
  validateApiKey,
} from "~lib/decart"
import { getWardrobeItems } from "~lib/wardrobe"
import { getLookbookItems } from "~lib/lookbook"
import "./style.css"

function Popup() {
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    valid: boolean
    error?: string
  } | null>(null)
  const [wardrobeCount, setWardrobeCount] = useState<number>(0)
  const [lookbookCount, setLookbookCount] = useState<number>(0)

  useEffect(() => {
    getStoredApiKey().then((key) => {
      setApiKey(key || DEFAULT_API_KEY)
      if (key) {
        validateApiKey(key).then(setValidationResult)
      }
    })
    getWardrobeItems().then((items) => setWardrobeCount(items.length))
    getLookbookItems().then((items) => setLookbookCount(items.length))
  }, [])

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return
    setIsValidating(true)
    const result = await validateApiKey(apiKey.trim())
    setIsValidating(false)
    setValidationResult(result)

    await setStoredApiKey(apiKey.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [apiKey])

  const handleResetDefault = useCallback(async () => {
    setApiKey(DEFAULT_API_KEY)
    await setStoredApiKey(DEFAULT_API_KEY)
    setIsValidating(true)
    const result = await validateApiKey(DEFAULT_API_KEY)
    setIsValidating(false)
    setValidationResult(result)
  }, [])

  const handleOpenRoomOnTab = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: "OPENWEAR_OPEN_ROOM_ONLY",
      })
      window.close()
    }
  }, [])

  const handleOpenSidePanel = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id && (chrome as any).sidePanel?.open) {
      await (chrome as any).sidePanel.open({ tabId: tab.id })
      window.close()
    }
  }, [])

  return (
    <div
      style={{
        width: 380,
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        background: "linear-gradient(145deg, #0d0e12 0%, #13151b 50%, #161822 100%)",
        color: "#fff",
        padding: 0,
        margin: 0,
        userSelect: "none",
      }}>
      {/* Header */}
      <div
        style={{
          padding: "20px 22px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "linear-gradient(135deg, #00FF88, #00CC6A)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              boxShadow: "0 4px 16px rgba(0, 255, 136, 0.3)",
            }}>
            👗
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
                OpenWear
              </h1>
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 7px",
                  borderRadius: 9999,
                  background: "rgba(0, 255, 136, 0.15)",
                  color: "#00FF88",
                  fontWeight: 700,
                  border: "1px solid rgba(0, 255, 136, 0.3)",
                }}>
                PRO VTON
              </span>
            </div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", margin: "2px 0 0" }}>
              Virtual Fitting Room & Studio Engine
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "18px 22px" }}>
        {/* Quick Launch Action Buttons */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            onClick={handleOpenRoomOnTab}
            style={{
              flex: 1.2,
              padding: "12px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg, #00FF88, #00CC6A)",
              color: "#000",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              boxShadow: "0 4px 18px rgba(0, 255, 136, 0.25)",
            }}>
            <span>👗</span>
            <span>Open Fitting Room</span>
          </button>
          <button
            onClick={handleOpenSidePanel}
            title="Open docked in Chrome Side Panel"
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 10,
              border: "1px solid rgba(255, 255, 255, 0.12)",
              background: "rgba(255, 255, 255, 0.06)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}>
            <span>🪟</span>
            <span>Side Panel</span>
          </button>
        </div>

        {/* Quick Metrics Row */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div
            style={{
              flex: 1,
              background: "rgba(255, 255, 255, 0.04)",
              borderRadius: 10,
              padding: "10px 12px",
              border: "1px solid rgba(255, 255, 255, 0.06)",
            }}>
            <div style={{ fontSize: 10, color: "rgba(255, 255, 255, 0.5)", textTransform: "uppercase" }}>
              My Wardrobe
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#00FF88", marginTop: 2 }}>
              {wardrobeCount} <span style={{ fontSize: 11, color: "#aaa", fontWeight: 400 }}>items</span>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              background: "rgba(255, 255, 255, 0.04)",
              borderRadius: 10,
              padding: "10px 12px",
              border: "1px solid rgba(255, 255, 255, 0.06)",
            }}>
            <div style={{ fontSize: 10, color: "rgba(255, 255, 255, 0.5)", textTransform: "uppercase" }}>
              Saved Looks
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginTop: 2 }}>
              {lookbookCount} <span style={{ fontSize: 11, color: "#aaa", fontWeight: 400 }}>looks</span>
            </div>
          </div>
        </div>

        {/* API Key Label & Status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.7)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}>
            Decart API Key
          </label>
          <span
            style={{
              fontSize: 11,
              color: validationResult?.valid ? "#00FF88" : "#ff6464",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}>
            <span>●</span>
            <span>
              {isValidating
                ? "Checking..."
                : validationResult?.valid
                  ? "Connected"
                  : "Invalid / Not Checked"}
            </span>
          </span>
        </div>

        {/* API Key Input */}
        <div style={{ position: "relative", marginBottom: 12 }}>
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="dct_..."
            style={{
              width: "100%",
              padding: "11px 40px 11px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "#fff",
              fontSize: 12,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "monospace",
            }}
          />
          <button
            onClick={() => setShowKey(!showKey)}
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
              fontSize: 14,
            }}>
            {showKey ? "🙈" : "👁️"}
          </button>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            onClick={handleSave}
            disabled={isValidating}
            style={{
              flex: 1,
              padding: "10px",
              borderRadius: 8,
              border: "1px solid rgba(0, 255, 136, 0.4)",
              background: "rgba(0, 255, 136, 0.12)",
              color: "#00FF88",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
            }}>
            {saved ? "✓ Saved" : isValidating ? "Testing..." : "Save Key"}
          </button>
          <button
            onClick={handleResetDefault}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "rgba(255,255,255,0.6)",
              fontSize: 12,
              cursor: "pointer",
            }}>
            Reset
          </button>
        </div>

        {/* Guide */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.03)",
            borderRadius: 10,
            padding: "12px 14px",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            fontSize: 11,
            lineHeight: 1.6,
            color: "rgba(255, 255, 255, 0.7)",
          }}>
          <div style={{ color: "#fff", fontWeight: 600, marginBottom: 4 }}>
            OpenWear Studio Features:
          </div>
          <div>🎥 <strong>Live Cam</strong>: Realtime video try-on with Decart Lucy VTON</div>
          <div>📷 <strong>Photo Studio</strong>: Try-on using 4 preset models or your photos</div>
          <div>👗 <strong>My Wardrobe</strong>: Save garments with price from any web shop</div>
          <div>📸 <strong>Lookbook</strong>: Save snapshots & export shareable polaroid cards</div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "12px 22px 16px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: 10,
          color: "rgba(255,255,255,0.35)",
          display: "flex",
          justifyContent: "space-between",
        }}>
        <span>OpenWear Virtual Fitting Studio</span>
        <a
          href="https://platform.decart.ai"
          target="_blank"
          rel="noreferrer"
          style={{ color: "#00FF88", textDecoration: "none" }}>
          platform.decart.ai
        </a>
      </div>
    </div>
  )
}

export default Popup
