/**
 * OpenWear Hover Button - Content Script UI
 *
 * Appears floating near the top of clothing/product photos on any shopping site.
 * Offers dual actions:
 * 1. 👗 Try On (opens fitting room with that garment)
 * 2. ➕ Save to Wardrobe (persists to user's wardrobe collection)
 */

import type { PlasmoCSConfig } from "plasmo"
import { useState, useEffect, useRef, useCallback } from "react"
import { detectCategory } from "~lib/decart"
import { saveWardrobeItem } from "~lib/wardrobe"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
}

export const getShadowHostId = () => "openwear-hover-button"

const MIN_IMG_DIM = 80

interface ScrapedMetadata {
  title: string
  price?: string
  storeName: string
  storeUrl: string
}

function scrapeProductMetadata(img: HTMLImageElement): ScrapedMetadata {
  const storeName = window.location.hostname.replace(/^www\./i, "")
  const storeUrl = window.location.href

  // 1. Try finding product title
  let title = img.getAttribute("alt") || img.getAttribute("title") || ""

  // If alt is generic or empty, traverse up to container
  const container = img.closest(
    "article, [data-testid*='product'], .product, .card, li, .product-card, div[class*='product']"
  )

  if (container) {
    if (!title || title.length < 5 || title.toLowerCase().includes("image")) {
      const heading = container.querySelector(
        "h1, h2, h3, h4, .title, .product-title, [class*='title'], [class*='name']"
      )
      if (heading && heading.textContent) {
        title = heading.textContent.trim()
      }
    }
  }

  // Fallback to page title or default
  if (!title || title.length < 3) {
    const pageH1 = document.querySelector("h1")
    if (pageH1?.textContent) {
      title = pageH1.textContent.trim()
    } else {
      title = document.title.split(/[-|–]/)[0].trim() || "Designer Garment"
    }
  }

  // 2. Try finding product price
  let price: string | undefined
  const priceRegex = /([$₹€£]\s*[\d,]+(\.\d{2})?|\b[\d,]+(\.\d{2})?\s*(USD|EUR|GBP|INR)\b)/i

  if (container) {
    const priceEl = container.querySelector(
      ".price, [class*='price'], [data-testid*='price']"
    )
    if (priceEl && priceEl.textContent) {
      const match = priceEl.textContent.match(priceRegex)
      if (match) price = match[0].trim()
    }

    if (!price && container.textContent) {
      const match = container.textContent.match(priceRegex)
      if (match) price = match[0].trim()
    }
  }

  // Global document price fallback
  if (!price) {
    const priceEl = document.querySelector(".price, [class*='price']")
    if (priceEl && priceEl.textContent) {
      const match = priceEl.textContent.match(priceRegex)
      if (match) price = match[0].trim()
    }
  }

  return {
    title: title.slice(0, 80),
    price,
    storeName,
    storeUrl,
  }
}

function findCandidateImage(
  target: HTMLElement,
  clientX: number,
  clientY: number
): HTMLImageElement | null {
  if (target.tagName === "IMG") {
    return target as HTMLImageElement
  }

  const innerImg = target.querySelector("img")
  if (innerImg) {
    return innerImg as HTMLImageElement
  }

  const container = target.closest(
    "a, article, figure, [data-testid*='product'], .product, .card, li"
  )
  if (container) {
    const containerImg = container.querySelector("img")
    if (containerImg) return containerImg as HTMLImageElement
  }

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
  const [metadata, setMetadata] = useState<ScrapedMetadata>({
    title: "Garment",
    storeName: "",
    storeUrl: "",
  })
  const [isHovered, setIsHovered] = useState(false)
  const [loading, setLoading] = useState(false)
  const [savedToast, setSavedToast] = useState(false)
  const timeoutRef = useRef<number | null>(null)
  const lastTargetRef = useRef<HTMLImageElement | null>(null)

  const isValidProductPhoto = useCallback((img: HTMLImageElement): boolean => {
    const rect = img.getBoundingClientRect()
    if (rect.width < MIN_IMG_DIM || rect.height < MIN_IMG_DIM) {
      return false
    }

    if (
      img.complete &&
      (img.naturalWidth < MIN_IMG_DIM || img.naturalHeight < MIN_IMG_DIM)
    ) {
      return false
    }

    const aspect = rect.width / rect.height
    if (aspect > 3.2 || aspect < 0.25) return false

    const src = img.currentSrc || img.src || ""
    if (
      src.includes("data:image/svg") ||
      src.includes("icon") ||
      src.includes("logo")
    ) {
      if (rect.width < 120 && rect.height < 120) return false
    }

    return true
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target) return

      if (
        target.id === "openwear-hover-button" ||
        target.closest?.("#openwear-hover-button")
      ) {
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
      const bestSrc =
        img.currentSrc ||
        img.src ||
        img.getAttribute("data-src") ||
        img.getAttribute("data-lazy-src") ||
        ""

      if (bestSrc) {
        setPosition({
          x: Math.max(16, rect.left + rect.width / 2),
          y: Math.max(16, rect.top + 16),
        })
        setTargetSrc(bestSrc)
        setMetadata(scrapeProductMetadata(img))
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

  // --- 1. Try On Button Click ---
  const handleTryOnClick = useCallback(
    async (e: React.MouseEvent) => {
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

        // Notify in-page fitting room drawer
        window.postMessage(
          {
            type: "OPENWEAR_OPEN_FITTING_ROOM",
            imageBase64: imageBase64 || targetSrc,
            sourceUrl: targetSrc,
            title: metadata.title,
            price: metadata.price,
            storeName: metadata.storeName,
          },
          "*"
        )

        setVisible(false)
      } catch (err) {
        console.error("[OpenWear] Hover try-on error:", err)
        window.postMessage(
          {
            type: "OPENWEAR_OPEN_FITTING_ROOM",
            imageBase64: targetSrc,
            sourceUrl: targetSrc,
            title: metadata.title,
          },
          "*"
        )
      } finally {
        setLoading(false)
      }
    },
    [targetSrc, loading, metadata]
  )

  // --- 2. Save to Wardrobe Click ---
  const handleSaveToWardrobe = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (!targetSrc) return
      const category = detectCategory(metadata.title)

      try {
        await saveWardrobeItem({
          title: metadata.title,
          category,
          imageUrl: targetSrc,
          price: metadata.price,
          storeName: metadata.storeName,
          storeUrl: metadata.storeUrl,
        })

        // Notify fitting room to refresh wardrobe
        window.postMessage(
          {
            type: "OPENWEAR_WARDROBE_UPDATED",
          },
          "*"
        )

        setSavedToast(true)
        setTimeout(() => setSavedToast(false), 2200)
      } catch (err) {
        console.error("[OpenWear] Save to wardrobe error:", err)
      }
    },
    [targetSrc, metadata]
  )

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
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(10, 10, 14, 0.92)",
          padding: "4px 6px",
          borderRadius: 9999,
          border: "1px solid rgba(255, 255, 255, 0.16)",
          boxShadow:
            "0 8px 32px rgba(0, 0, 0, 0.5), 0 0 14px rgba(0, 255, 136, 0.25)",
          backdropFilter: "blur(14px)",
          userSelect: "none",
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
        {/* Try On Button */}
        <button
          onClick={handleTryOnClick}
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 13px",
            background: "linear-gradient(135deg, rgba(0, 255, 136, 0.2), rgba(0, 204, 106, 0.1))",
            color: "#ffffff",
            border: "1px solid rgba(0, 255, 136, 0.35)",
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 600,
            fontFamily:
              "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            cursor: loading ? "wait" : "pointer",
            transition: "all 0.15s ease",
            whiteSpace: "nowrap",
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.96)")}
          onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#00FF88",
              boxShadow: "0 0 8px #00FF88",
              display: "inline-block",
              animation: "openwearPulse 1.6s infinite ease-in-out",
            }}
          />
          <span style={{ fontSize: 13 }}>👗</span>
          <span>{loading ? "Scanning..." : "Try On"}</span>
          {metadata.price && (
            <span
              style={{
                background: "rgba(0, 255, 136, 0.2)",
                color: "#00FF88",
                padding: "2px 6px",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                marginLeft: 2,
              }}>
              {metadata.price}
            </span>
          )}
        </button>

        {/* Save to Wardrobe Button */}
        <button
          onClick={handleSaveToWardrobe}
          title="Save to My Wardrobe"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "7px 11px",
            background: savedToast
              ? "rgba(0, 255, 136, 0.9)"
              : "rgba(255, 255, 255, 0.08)",
            color: savedToast ? "#000" : "#ffffff",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 600,
            fontFamily:
              "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            cursor: "pointer",
            transition: "all 0.18s ease",
            whiteSpace: "nowrap",
          }}>
          <span>{savedToast ? "✓" : "➕"}</span>
          <span>{savedToast ? "Saved!" : "Wardrobe"}</span>
        </button>
      </div>
    </>
  )
}

export default HoverButton
