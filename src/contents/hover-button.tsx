/**
 * OpenWear Hover Button - Content Script UI
 *
 * Appears floating near the top of clothing/product photos on any shopping site.
 * Clicking immediately opens the virtual fitting room drawer with that garment ready to try on.
 */

import type { PlasmoCSConfig } from "plasmo"
import { useState, useEffect, useRef, useCallback } from "react"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
}

export const getShadowHostId = () => "openwear-hover-button"

const MIN_IMG_DIM = 80

function findCandidateImage(target: HTMLElement, clientX: number, clientY: number): HTMLImageElement | null {
  // 1. Direct IMG element
  if (target.tagName === "IMG") {
    return target as HTMLImageElement
  }

  // 2. IMG inside hovered container
  const innerImg = target.querySelector("img")
  if (innerImg) {
    return innerImg as HTMLImageElement
  }

  // 3. Closest product card / link / figure container
  const container = target.closest("a, article, figure, [data-testid*='product'], .product, .card, li")
  if (container) {
    const containerImg = container.querySelector("img")
    if (containerImg) return containerImg as HTMLImageElement
  }

  // 4. Inspect elements under cursor directly
  try {
    const elements = document.elementsFromPoint(clientX, clientY)
    for (const el of elements) {
      if (el.tagName === "IMG") return el as HTMLImageElement
      const child = el.querySelector("img")
      if (child) return child as HTMLImageElement
    }
  } catch {}

  return null
}

function HoverButton() {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [targetSrc, setTargetSrc] = useState("")
  const [isHovered, setIsHovered] = useState(false)
  const [loading, setLoading] = useState(false)
  const timeoutRef = useRef<number | null>(null)
  const lastTargetRef = useRef<HTMLImageElement | null>(null)

  const isValidProductPhoto = useCallback((img: HTMLImageElement): boolean => {
    // Check rendered dimensions
    const rect = img.getBoundingClientRect()
    if (rect.width < MIN_IMG_DIM || rect.height < MIN_IMG_DIM) {
      return false
    }

    // Natural dimensions if loaded
    if (img.complete && (img.naturalWidth < MIN_IMG_DIM || img.naturalHeight < MIN_IMG_DIM)) {
      return false
    }

    // Aspect ratio check (clothes are typically portrait or square; banner ads are extreme aspect)
    const aspect = rect.width / rect.height
    if (aspect > 3.2 || aspect < 0.25) return false

    // Ignore transparent 1x1 tracking pixels or icons
    const src = img.currentSrc || img.src || ""
    if (src.includes("data:image/svg") || src.includes("icon") || src.includes("logo")) {
      if (rect.width < 120 && rect.height < 120) return false
    }

    return true
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target) return

      // Don't trigger if moving over our own shadow host
      if (target.id === "openwear-hover-button" || target.closest?.("#openwear-hover-button")) {
        return
      }

      const img = findCandidateImage(target, e.clientX, e.clientY)
      if (!img || !isValidProductPhoto(img)) {
        if (!isHovered && timeoutRef.current === null) {
          timeoutRef.current = window.setTimeout(() => {
            setVisible(false)
            timeoutRef.current = null
          }, 350)
        }
        return
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }

      lastTargetRef.current = img
      const rect = img.getBoundingClientRect()
      const bestSrc = img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || ""

      if (bestSrc) {
        setPosition({
          x: Math.max(16, rect.left + rect.width / 2),
          y: Math.max(16, rect.top + 16),
        })
        setTargetSrc(bestSrc)
        setVisible(true)
      }
    }

    const handleScroll = () => {
      if (visible && lastTargetRef.current) {
        const rect = lastTargetRef.current.getBoundingClientRect()
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
          setVisible(false)
        } else {
          setPosition({
            x: Math.max(16, rect.left + rect.width / 2),
            y: Math.max(16, rect.top + 16),
          })
        }
      }
    }

    window.addEventListener("mousemove", handleMouseMove, { passive: true })
    window.addEventListener("scroll", handleScroll, { passive: true })

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("scroll", handleScroll)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [isValidProductPhoto, isHovered, visible])

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!targetSrc || loading) return
    setLoading(true)

    try {
      let imageBase64 = ""

      if (targetSrc.startsWith("data:image/")) {
        imageBase64 = targetSrc
      } else {
        const response = await chrome.runtime.sendMessage({
          type: "FETCH_BLOB",
          url: targetSrc,
        })
        if (response?.success && response.base64) {
          imageBase64 = response.base64
        }
      }

      // Notify the in-page fitting room drawer
      window.postMessage(
        {
          type: "OPENWEAR_OPEN_FITTING_ROOM",
          imageBase64: imageBase64 || targetSrc,
          sourceUrl: targetSrc,
        },
        "*"
      )

      setVisible(false)
    } catch (err) {
      console.error("[OpenWear] Hover button click error:", err)
      // Fallback with URL directly
      window.postMessage(
        {
          type: "OPENWEAR_OPEN_FITTING_ROOM",
          imageBase64: targetSrc,
          sourceUrl: targetSrc,
        },
        "*"
      )
    } finally {
      setLoading(false)
    }
  }, [targetSrc, loading])

  if (!visible) return null

  return (
    <>
      <style>{`
        @keyframes openwearFadeIn {
          from {
            opacity: 0;
            transform: translate(-50%, -6px) scale(0.94);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0) scale(1);
          }
        }
        @keyframes openwearPulse {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.15); opacity: 1; }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
          transform: "translateX(-50%)",
          zIndex: 2147483647,
          pointerEvents: "auto",
          animation: "openwearFadeIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onMouseEnter={() => {
          setIsHovered(true)
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
            timeoutRef.current = null
          }
        }}
        onMouseLeave={() => {
          setIsHovered(false)
          timeoutRef.current = window.setTimeout(() => setVisible(false), 300)
        }}>
        <button
          onClick={handleClick}
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "9px 15px",
            background: "rgba(10, 10, 12, 0.92)",
            color: "#ffffff",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 600,
            fontFamily:
              "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            cursor: loading ? "wait" : "pointer",
            boxShadow:
              "0 8px 30px rgba(0, 0, 0, 0.4), 0 0 12px rgba(0, 255, 136, 0.25)",
            backdropFilter: "blur(12px)",
            transition: "all 0.18s ease",
            whiteSpace: "nowrap",
            letterSpacing: "0.01em",
            userSelect: "none",
          }}
          onMouseDown={(e) =>
            (e.currentTarget.style.transform = "scale(0.96)")
          }
          onMouseUp={(e) =>
            (e.currentTarget.style.transform = "scale(1)")
          }>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#00FF88",
              boxShadow: "0 0 8px #00FF88",
              display: "inline-block",
              animation: "openwearPulse 1.6s infinite ease-in-out",
            }}
          />
          <span style={{ fontSize: 14 }}>👗</span>
          <span>{loading ? "Scanning..." : "Try On in Fitting Room"}</span>
        </button>
      </div>
    </>
  )
}

export default HoverButton
