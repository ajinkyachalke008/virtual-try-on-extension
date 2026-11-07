/**
 * OpenWear Lookbook & Snapshot Studio
 *
 * Captures, stores, and exports high-definition virtual try-on looks.
 * Supports branded social export cards, download triggers, and storage sync.
 */

import type { GarmentCategory } from "./decart"
import { safeLoadImage } from "./photo-tryon"

export interface LookbookItem {
  id: string
  timestamp: number
  garmentTitle: string
  garmentCategory: GarmentCategory
  garmentImageUrl?: string
  resultImage: string // Data URL
  originalPhoto?: string // Data URL or preset name
  storeUrl?: string
  storeName?: string
  mode: "live_video" | "photo_studio"
  rating?: number
}

const STORAGE_KEY = "openwear_lookbook_items"

/**
 * Retrieve saved lookbook items.
 */
export async function getLookbookItems(): Promise<LookbookItem[]> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const res = await chrome.storage.local.get(STORAGE_KEY)
      if (res && Array.isArray(res[STORAGE_KEY])) {
        return res[STORAGE_KEY]
      }
      return []
    }

    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed
      }
      return []
    }
  } catch (err) {
    console.warn("[OpenWear Lookbook] Error reading storage:", err)
  }
  return []
}

/**
 * Save a new lookbook snapshot.
 */
export async function saveLookbookItem(
  item: Omit<LookbookItem, "id" | "timestamp"> & {
    id?: string
    timestamp?: number
  }
): Promise<LookbookItem> {
  const current = await getLookbookItems()
  const now = Date.now()
  const finalItem: LookbookItem = {
    id: item.id || `look_${now}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: item.timestamp || now,
    garmentTitle: item.garmentTitle || "Custom Outfit",
    garmentCategory: item.garmentCategory || "upper_body",
    garmentImageUrl: item.garmentImageUrl,
    resultImage: item.resultImage,
    originalPhoto: item.originalPhoto,
    storeUrl: item.storeUrl,
    storeName: item.storeName,
    mode: item.mode || "live_video",
    rating: item.rating,
  }

  // Keep latest 40 looks to stay within storage limits
  const updated = [finalItem, ...current].slice(0, 40)

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: updated })
    } else if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    }
  } catch (err) {
    console.warn("[OpenWear Lookbook] Error saving look:", err)
  }

  return finalItem
}

/**
 * Delete a look from the lookbook.
 */
export async function deleteLookbookItem(id: string): Promise<LookbookItem[]> {
  const current = await getLookbookItems()
  const updated = current.filter((x) => x.id !== id)

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: updated })
    } else if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    }
  } catch (err) {
    console.warn("[OpenWear Lookbook] Error deleting look:", err)
  }

  return updated
}

/**
 * Capture high-resolution snapshot from an HTMLVideoElement.
 */
export function captureFrameFromVideo(
  video: HTMLVideoElement,
  options?: { mirror?: boolean }
): string | null {
  if (!video || !video.videoWidth || !video.videoHeight) {
    return null
  }

  const canvas = document.createElement("canvas")
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  ctx.save()
  if (options?.mirror) {
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  ctx.restore()

  return canvas.toDataURL("image/png", 0.95)
}

/**
 * Capture frame from an HTMLCanvasElement.
 */
export function captureFrameFromCanvas(canvas: HTMLCanvasElement): string | null {
  if (!canvas || !canvas.width || !canvas.height) return null
  try {
    return canvas.toDataURL("image/png", 0.95)
  } catch (err) {
    console.error("[OpenWear Lookbook] Canvas capture error:", err)
    return null
  }
}

/**
 * Generate a high-DPI branded social Lookbook Card (1080x1350 standard portrait ratio).
 */
export async function generateBrandedLookCard(
  item: LookbookItem
): Promise<string> {
  const cardWidth = 1080
  const cardHeight = 1350
  const canvas = document.createElement("canvas")
  canvas.width = cardWidth
  canvas.height = cardHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) return item.resultImage

  // 1. Sleek Dark Gradient Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, cardHeight)
  bgGrad.addColorStop(0, "#0b0c10")
  bgGrad.addColorStop(0.6, "#12141c")
  bgGrad.addColorStop(1, "#171a26")
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, cardWidth, cardHeight)

  // Subtle border glow
  ctx.strokeStyle = "rgba(0, 255, 136, 0.25)"
  ctx.lineWidth = 4
  ctx.strokeRect(16, 16, cardWidth - 32, cardHeight - 32)

  // 2. Load Main Result Image
  try {
    const mainImg = await safeLoadImage(item.resultImage)
    const imgX = 54
    const imgY = 120
    const imgW = cardWidth - 108
    const imgH = 920

    // Draw main photo with rounded clipping
    ctx.save()
    roundRect(ctx, imgX, imgY, imgW, imgH, 24)
    ctx.clip()
    drawImageProp(ctx, mainImg, imgX, imgY, imgW, imgH)
    ctx.restore()

    // Inner subtle photo border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)"
    ctx.lineWidth = 2
    roundRect(ctx, imgX, imgY, imgW, imgH, 24)
    ctx.stroke()
  } catch (e) {
    console.warn("Failed to draw main image on card:", e)
  }

  // 3. Header Branding
  ctx.font = "800 36px 'Inter', -apple-system, sans-serif"
  ctx.fillStyle = "#ffffff"
  ctx.fillText("👗 OPENWEAR", 54, 76)

  ctx.font = "600 20px 'Inter', -apple-system, sans-serif"
  ctx.fillStyle = "#00FF88"
  ctx.fillText("VIRTUAL FITTING ROOM", cardWidth - 310, 74)

  // 4. Footer Metadata Area
  const footerY = 1075

  // Garment Title
  ctx.font = "700 34px 'Inter', -apple-system, sans-serif"
  ctx.fillStyle = "#ffffff"
  const title = item.garmentTitle.length > 38 ? item.garmentTitle.slice(0, 38) + "..." : item.garmentTitle
  ctx.fillText(title, 54, footerY + 40)

  // Category Badge & Date
  const dateStr = new Date(item.timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const categoryStr = item.garmentCategory.toUpperCase().replace("_", " ")

  ctx.font = "600 22px 'Inter', -apple-system, sans-serif"
  ctx.fillStyle = "rgba(255, 255, 255, 0.65)"
  ctx.fillText(`${categoryStr}  •  ${dateStr}${item.storeName ? `  •  ${item.storeName}` : ""}`, 54, footerY + 85)

  return canvas.toDataURL("image/png", 0.95)
}

/**
 * Triggers browser download of a base64 image data URL.
 */
export function downloadImage(dataUrl: string, filename = "openwear-look.png") {
  const link = document.createElement("a")
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// --- Internal Canvas Drawing Helpers ---

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawImageProp(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  offsetX = 0.5,
  offsetY = 0.5
) {
  const iw = img.width
  const ih = img.height
  const r = Math.min(w / iw, h / ih)
  let nw = iw * r
  let nh = ih * r
  let cx = 1
  let cy = 1
  let cw = 1
  let ch = 1
  let ar = 1

  if (Math.round(nw) < w) ar = w / nw
  if (Math.abs(ar - 1) < 1e-14 && Math.round(nh) < h) ar = h / nh
  nw *= ar
  nh *= ar

  cw = iw / (nw / w)
  ch = ih / (nh / h)
  cx = (iw - cw) * offsetX
  cy = (ih - ch) * offsetY

  if (cx < 0) cx = 0
  if (cy < 0) cy = 0
  if (cw > iw) cw = iw
  if (ch > ih) ch = ih

  ctx.drawImage(img, cx, cy, cw, ch, x, y, w, h)
}

