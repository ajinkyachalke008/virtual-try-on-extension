import { useState, useEffect, useCallback } from "react"
import {
  DEFAULT_API_KEY,
  getStoredApiKey,
  setStoredApiKey,
  validateApiKey,
} from "~lib/decart"
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

  useEffect(() => {
    getStoredApiKey().then((key) => {
      setApiKey(key || DEFAULT_API_KEY)
      // Check initial key validation
      if (key) {
        validateApiKey(key).then(setValidationResult)
      }
    })
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
          padding: "24px 22px 18px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "linear-gradient(135deg, #00FF88, #00CC6A)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              boxShadow: "0 4px 16px rgba(0, 255, 136, 0.3)",
            }}>
            👗
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <h1
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  margin: 0,
                  letterSpacing: "-0.02em",
                }}>
                OpenWear
              </h1>
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
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
                color: "rgba(255,255,255,0.5)",
                margin: "2px 0 0",
              }}>
              Realtime Virtual Try-On Assistant
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "20px 22px" }}>
        {/* Quick Launch Button */}
        <button
          onClick={handleOpenRoomOnTab}
          style={{
            width: "100%",
            padding: "13px",
            borderRadius: 12,
            border: "none",
            background: "linear-gradient(135deg, #00FF88, #00CC6A)",
            color: "#000",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            boxShadow: "0 4px 20px rgba(0, 255, 136, 0.25)",
            marginBottom: 18,
            transition: "transform 0.15s ease",
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
          onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}>
          <span>👗</span>
          <span>Open Fitting Room on this Page</span>
        </button>

        {/* API Key Label */}
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

        {/* Feature List Cards */}
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
            How to use OpenWear:
          </div>
          <div>1. Click the floating 👗 button on any website to open camera.</div>
          <div>2. Hover over any clothing item or right-click to try on.</div>
          <div>3. Or drag & drop any image into the fitting room drawer!</div>
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
        <span>Powered by Decart AI Lucy VTON</span>
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
