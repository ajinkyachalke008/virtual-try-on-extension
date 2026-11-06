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
 * Read the user's own Decart key from extension storage.
 * A permanent API key is never bundled into the extension source.
 */
export async function getStoredApiKey(): Promise<string> {
  try {
    if (typeof chrome === "undefined" || !chrome.storage) return ""

    const local = chrome.storage.local
      ? await chrome.storage.local.get(["decart_api_key", "DECART_API_KEY"])
      : {}
    const localValue = local?.decart_api_key || local?.DECART_API_KEY

    if (typeof localValue === "string" && localValue.trim()) {
      return localValue.trim()
    }

    // Read the old sync key once for compatibility with previous installs.
    const sync = chrome.storage.sync
      ? await chrome.storage.sync.get(["decart_api_key", "DECART_API_KEY"])
      : {}
    const syncValue = sync?.decart_api_key || sync?.DECART_API_KEY

    if (typeof syncValue === "string" && syncValue.trim()) {
      const value = syncValue.trim()
      if (chrome.storage.local) {
        await chrome.storage.local.set({ decart_api_key: value })
      }
      return value
    }
  } catch (error) {
    console.warn("[OpenWear] Could not read Decart API key from extension storage:", error)
  }

  return ""
}

/**
 * Store the user's key locally in this browser profile only.
 * Remove legacy sync copies so the permanent key is not propagated across devices.
 */
export async function setStoredApiKey(key: string): Promise<void> {
  const trimmed = key.trim()

  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    throw new Error("Chrome extension storage is unavailable.")
  }

  if (trimmed) {
    await chrome.storage.local.set({ decart_api_key: trimmed })
  } else {
    await chrome.storage.local.remove(["decart_api_key", "DECART_API_KEY"])
  }

  if (chrome.storage.sync) {
    await chrome.storage.sync.remove(["decart_api_key", "DECART_API_KEY"])
  }
}

/**
 * Create an ephemeral token via client.tokens.create().
 * Official requirement: permanent dct_* key must NOT be passed to realtime.connect directly.
 */
export async function createEphemeralToken(permanentKey: string): Promise<string> {
  const cleanKey = permanentKey.trim()
  if (!cleanKey) {
    throw new Error("Add your Decart API key in the OpenWear popup first.")
  }

  // Client tokens are short-lived. Mint immediately before the realtime connection.
  const permanentClient = createDecartClient({ apiKey: cleanKey })
  const tokenRes = await permanentClient.tokens.create({ expiresIn: 300 })
  const ephemeralKey = tokenRes?.apiKey || tokenRes?.token

  console.log("TOKEN_CREATED:", Boolean(ephemeralKey))
  if (!ephemeralKey) {
    throw new Error("Decart did not return a client token. Check the API key and account access.")
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
  onRemoteStream: (stream: MediaStream) => void
): Promise<DecartSession> {
  if (!localStream || !localStream.getVideoTracks().some((track) => track.readyState === "live")) {
    throw new Error("The camera stream is missing or has no live video track.")
  }

  // Mint immediately before connecting; never pass the permanent key to realtime.connect().
  const ephemeralKey = await createEphemeralToken(permanentKey)
  const client = createDecartClient({ apiKey: ephemeralKey, telemetry: false })

  const realtimeClient = await client.realtime.connect(localStream, {
    model: VTON_MODEL,
    mirror: "auto",
    onRemoteStream: (remoteStream: MediaStream) => {
      console.log("REMOTE_STREAM_RECEIVED:", Boolean(remoteStream))
      onRemoteStream(remoteStream)
    },
  })

  return {
    realtimeClient,
    disconnect: () => {
      try {
        realtimeClient.disconnect()
      } catch (error) {
        console.warn("[OpenWear] Disconnect error:", error)
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
