/**
 * Decart Lucy VTON Realtime Client & Ephemeral Token Flow
 *
 * Official 3-step flow:
 * 1. Read permanent API key (DECART_API_KEY) from storage
 * 2. Generate ephemeral token via client.tokens.create()
 * 3. Connect realtime WebRTC session using ephemeral token and models.realtime("lucy-vton-latest")
 * 4. Apply garment via rtClient.setImage(blob, { prompt, enhance: false })
 *
 * API Docs: https://docs.platform.decart.ai/models/realtime/virtual-try-on
 */

import { createDecartClient, models } from "@decartai/sdk"

export const DEFAULT_API_KEY =
  "dct_extention1_ywgiZVVTOoNqPCqsABCxXKLUtsguIYdrVDIWRiycHcBEwqnAgaEvRSJuoBcUHBBx"

const OLD_EXPIRED_KEY =
  "dct_extention_YbDQJWJkiNPWInmjgPEPKRWvJGUdOITHKhgHNZHOPzDFfPUqosxbriUpTxwYKRwR"

export type GarmentCategory =
  | "upper_body"
  | "lower_body"
  | "dress"
  | "outerwear"

export interface DecartSession {
  realtimeClient: any
  disconnect: () => void
}

export interface SampleGarment {
  id: string
  name: string
  category: GarmentCategory
  prompt: string
  imageUrl: string
  badge: string
}

const VTON_MODEL = models.realtime("lucy-vton-latest")

/**
 * Retrieve the permanent Decart API key across local/sync storage.
 * Falls back to DEFAULT_API_KEY so users can immediately test without setup.
 * Automatically clears the old expired key if found in user storage.
 */
export async function getStoredApiKey(): Promise<string> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage) {
      if (chrome.storage.sync) {
        const sync = await chrome.storage.sync.get(["decart_api_key", "DECART_API_KEY"])
        let val = sync?.decart_api_key || sync?.DECART_API_KEY
        if (typeof val === "string") {
          if (val.startsWith('"') && val.endsWith('"')) {
            try { val = JSON.parse(val) } catch {}
          }
          if (val && val.trim()) {
            if (val.trim() === OLD_EXPIRED_KEY) {
              await setStoredApiKey(DEFAULT_API_KEY)
              return DEFAULT_API_KEY
            }
            return val.trim()
          }
        }
      }
      if (chrome.storage.local) {
        const local = await chrome.storage.local.get(["decart_api_key", "DECART_API_KEY"])
        const val = local?.decart_api_key || local?.DECART_API_KEY
        if (val && typeof val === "string" && val.trim()) {
          if (val.trim() === OLD_EXPIRED_KEY) {
            await setStoredApiKey(DEFAULT_API_KEY)
            return DEFAULT_API_KEY
          }
          return val.trim()
        }
      }
    }
  } catch (e) {
    console.warn("[OpenWear] Error accessing storage for API key:", e)
  }
  return DEFAULT_API_KEY
}

/**
 * Save permanent Decart API key across storage layers.
 */
export async function setStoredApiKey(key: string): Promise<void> {
  const trimmed = key.trim()
  try {
    if (typeof chrome !== "undefined" && chrome.storage) {
      if (chrome.storage.sync) {
        await chrome.storage.sync.set({ decart_api_key: trimmed, DECART_API_KEY: trimmed })
      }
      if (chrome.storage.local) {
        await chrome.storage.local.set({ decart_api_key: trimmed, DECART_API_KEY: trimmed })
      }
    }
  } catch (e) {
    console.warn("[OpenWear] Error saving API key to storage:", e)
  }
}

/**
 * Create an ephemeral token via client.tokens.create().
 * Official requirement: permanent dct_* key must NOT be passed to realtime.connect directly.
 */
export async function createEphemeralToken(permanentKey: string): Promise<string> {
  const cleanKey = permanentKey.trim() || DEFAULT_API_KEY
  const permanentClient = createDecartClient({ apiKey: cleanKey })
  const tokenRes = await permanentClient.tokens.create()
  const ephemeralKey = tokenRes?.apiKey || tokenRes?.token

  console.log("TOKEN_CREATED:", !!ephemeralKey)
  if (!ephemeralKey) {
    throw new Error("Decart server did not return a valid ephemeral client token.")
  }
  return ephemeralKey
}

/**
 * Validate permanent key by attempting to create an ephemeral token.
 */
export async function validateApiKey(
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const token = await createEphemeralToken(apiKey)
    return { valid: !!token }
  } catch (err: any) {
    return { valid: false, error: err?.message || "Failed to authenticate key" }
  }
}

/**
 * Estimate garment category from description, filename or alt text.
 */
export function detectCategory(hint?: string): GarmentCategory {
  if (!hint) return "upper_body"
  const lower = hint.toLowerCase()

  if (/dress|gown|romper|jumpsuit|sari|maxi|mini\s*dress/i.test(lower)) {
    return "dress"
  }
  if (/pant|jean|trouser|short|skirt|legging|jogger|cargo|chino/i.test(lower)) {
    return "lower_body"
  }
  if (/jacket|coat|blazer|hoodie|cardigan|parka|overcoat|windbreaker|bomber|sweater/i.test(lower)) {
    return "outerwear"
  }
  return "upper_body"
}

/**
 * Build rich 20-30 word descriptive VTON prompt following Decart's official guidance.
 * Must use "Substitute the current top/bottom/outfit with..." format.
 */
export function buildDetailedPrompt(
  category: GarmentCategory,
  description?: string
): string {
  const target =
    category === "upper_body"
      ? "top"
      : category === "lower_body"
        ? "bottom"
        : category === "dress"
          ? "outfit"
          : "outerwear"

  const cleanDesc = description && description !== "Garment" && description !== "Dropped Garment"
    ? description.trim()
    : null

  if (category === "outerwear") {
    if (cleanDesc) {
      return `Substitute the current ${target} with a ${cleanDesc}, featuring ribbed cuffs, tailored shoulder fit, premium stitching, and realistic fabric drape matching reference image.`
    }
    return `Substitute the current ${target} with a premium black leather bomber jacket with ribbed cuffs, front metallic zipper, and a relaxed tailored fit.`
  }

  if (category === "dress") {
    if (cleanDesc) {
      return `Substitute the current ${target} with an elegant ${cleanDesc}, styled with a graceful silhouette, natural waist contour, and fluid fabric drape matching reference image.`
    }
    return `Substitute the current ${target} with an elegant emerald green silk slip midi dress with delicate straps, subtle cowl neckline, and fluid silhouette.`
  }

  if (category === "lower_body") {
    if (cleanDesc) {
      return `Substitute the current ${target} with ${cleanDesc}, featuring straight leg tailored cut, natural waistband fit, and detailed fabric texture matching reference image.`
    }
    return `Substitute the current ${target} with classic vintage straight-leg washed denim jeans with brass rivets and authentic cotton denim texture.`
  }

  // Upper body (default)
  if (cleanDesc) {
    return `Substitute the current ${target} with a ${cleanDesc}, with a relaxed modern fit, clean neckline, ribbed finishes, and high-fidelity textile texture matching reference image.`
  }
  return `Substitute the current ${target} with a clean heavyweight streetwear hoodie with ribbed cuffs, drop shoulders, relaxed fit, and natural fabric texture.`
}

/**
 * Connect to Decart Realtime VTON using the 3-step ephemeral token flow.
 */
export async function connectRealtime(
  permanentKey: string,
  localStream: MediaStream,
  onRemoteStream: (stream: MediaStream) => void,
  initialGarment?: { image: Blob | string; prompt: string }
): Promise<DecartSession> {
  // Step 1 & 2: Generate ephemeral token
  const ephemeralKey = await createEphemeralToken(permanentKey)

  // Step 3: Connect realtime with ephemeral token (telemetry disabled for extension safety)
  const client = createDecartClient({ apiKey: ephemeralKey, telemetry: false })

  const connectOptions: any = {
    model: VTON_MODEL,
    mirror: "auto",
    onRemoteStream: (stream: MediaStream) => {
      console.log("REMOTE_STREAM_RECEIVED:", !!stream)
      onRemoteStream(stream)
    },
  }

  if (initialGarment?.image) {
    connectOptions.initialState = {
      image: initialGarment.image,
      prompt: {
        text: initialGarment.prompt,
        enhance: false,
      },
    }
  }

  const realtimeClient = await client.realtime.connect(localStream, connectOptions)

  return {
    realtimeClient,
    disconnect: () => {
      try {
        realtimeClient.disconnect()
      } catch (e) {
        console.warn("[OpenWear] Disconnect error:", e)
      }
    },
  }
}

/**
 * Apply garment image and prompt to realtime session via setImage.
 */
export async function applyTryOn(
  realtimeClient: any,
  garmentBlob: Blob | string,
  category: GarmentCategory,
  description?: string
): Promise<void> {
  const prompt = buildDetailedPrompt(category, description)
  console.log("[OpenWear] Calling rtClient.setImage with prompt:", prompt)

  await realtimeClient.setImage(garmentBlob, {
    prompt,
    enhance: false,
  })
}

/**
 * Convert base64 data URL to a Blob.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(",")
  if (parts.length < 2) {
    throw new Error("Invalid data URL string")
  }
  const mimeMatch = parts[0].match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : "image/png"
  const binary = atob(parts[1])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

/**
 * Curated clean-background flat-lay garments (official Decart best practice).
 */
export const SAMPLE_GARMENTS: SampleGarment[] = [
  {
    id: "sample-bomber",
    name: "Black Leather Bomber Jacket",
    category: "outerwear",
    prompt: "Substitute the current top with a premium black leather bomber jacket with ribbed cuffs, front metallic zipper, and a relaxed tailored fit.",
    imageUrl: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600&auto=format&fit=crop&q=80",
    badge: "Outerwear",
  },
  {
    id: "sample-hoodie",
    name: "Heavyweight Streetwear Hoodie",
    category: "upper_body",
    prompt: "Substitute the current top with a clean heavyweight streetwear hoodie with ribbed cuffs, drop shoulders, relaxed fit, and natural fabric texture.",
    imageUrl: "https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=600&auto=format&fit=crop&q=80",
    badge: "Streetwear",
  },
  {
    id: "sample-dress",
    name: "Emerald Silk Slip Midi Dress",
    category: "dress",
    prompt: "Substitute the current outfit with an elegant emerald green silk slip midi dress with delicate straps, subtle cowl neckline, and fluid silhouette.",
    imageUrl: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=600&auto=format&fit=crop&q=80",
    badge: "Dress",
  },
  {
    id: "sample-denim",
    name: "Classic Washed Denim Jacket",
    category: "outerwear",
    prompt: "Substitute the current top with a classic light wash vintage denim trucker jacket with brass buttons and relaxed fit.",
    imageUrl: "https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=600&auto=format&fit=crop&q=80",
    badge: "Denim",
  },
]
