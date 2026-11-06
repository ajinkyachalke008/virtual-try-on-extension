/**
 * Background Service Worker for OpenWear
 *
 * Responsibilities:
 * 1. FETCH_BLOB / FETCH_IMAGE_BASE64 CORS proxy: fetches cross-origin images,
 *    converts to Blob and base64, and returns size + base64 data URL.
 * 2. Context menus: "Try On with OpenWear 👗" on any image and page.
 * 3. Message relay between content script and extension.
 */

import {
  getStoredApiKey,
  setStoredApiKey,
  validateApiKey,
} from "~lib/decart"

// --- Context Menus ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "openwear-tryon-image",
      title: "Try On with OpenWear 👗",
      contexts: ["image"],
    })

    chrome.contextMenus.create({
      id: "openwear-open-room",
      title: "Open Virtual Fitting Room 👗",
      contexts: ["page", "selection"],
    })
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return

  if (info.menuItemId === "openwear-tryon-image" && info.srcUrl) {
    try {
      const result = await fetchImageBlobAndBase64(info.srcUrl)
      await sendTabMessageWithFallback(tab.id, {
        type: "OPENWEAR_TRYON",
        imageBase64: result.base64,
        size: result.size,
        sourceUrl: info.srcUrl,
      })
    } catch (err) {
      console.error("[OpenWear] Context menu image fetch failed:", err)
    }
  } else if (info.menuItemId === "openwear-open-room") {
    await sendTabMessageWithFallback(tab.id, {
      type: "OPENWEAR_OPEN_ROOM_ONLY",
    })
  }
})

// --- Message Handlers ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Support both FETCH_BLOB and FETCH_IMAGE_BASE64
  if (message.type === "FETCH_BLOB" || message.type === "FETCH_IMAGE_BASE64") {
    fetchImageBlobAndBase64(message.url)
      .then((data) => {
        sendResponse({ success: true, ...data })
      })
      .catch((err) => {
        console.error("[OpenWear Background] Image fetch failed:", err)
        sendResponse({ success: false, error: err?.message || "Fetch failed", size: 0 })
      })
    return true // async response
  }

  if (message.type === "GET_API_KEY") {
    getStoredApiKey()
      .then((apiKey) => sendResponse({ apiKey }))
      .catch(() => sendResponse({ apiKey: "" }))
    return true
  }

  if (message.type === "SET_API_KEY") {
    setStoredApiKey(message.apiKey || "")
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err?.message }))
    return true
  }

  if (message.type === "VALIDATE_API_KEY") {
    validateApiKey(message.apiKey || "")
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ valid: false, error: err?.message }))
    return true
  }

  if (message.type === "OPEN_SIDEPANEL" && sender.tab?.id) {
    if ((chrome as any).sidePanel?.open) {
      ;(chrome as any).sidePanel
        .open({ tabId: sender.tab.id })
        .then(() => sendResponse({ success: true }))
        .catch((e: any) => sendResponse({ success: false, error: e.message }))
      return true
    }
    sendResponse({ success: false, error: "Sidepanel API not supported" })
  }
})

// --- CORS Image Fetcher: URL -> Blob -> Base64 ---
async function fetchImageBlobAndBase64(url: string): Promise<{
  base64: string
  size: number
  mimeType: string
}> {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("No image URL provided.")
  }

  // Only accept image data URLs or ordinary HTTP(S) URLs. Never let this
  // extension background worker fetch arbitrary schemes such as file:, chrome:, or javascript:.
  if (url.startsWith("data:image/")) {
    const commaIndex = url.indexOf(",")
    if (commaIndex < 0) throw new Error("Invalid image data URL.")
    const header = url.slice(0, commaIndex)
    const mimeType = header.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64$/)?.[1]
    if (!mimeType) throw new Error("Only base64-encoded image data URLs are supported.")
    const binary = atob(url.slice(commaIndex + 1))
    const size = binary.length
    if (size === 0) throw new Error("The supplied image data is empty.")
    return { base64: url, size, mimeType }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error("The image source is not a valid URL.")
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("Only HTTP and HTTPS image URLs are supported.")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(parsedUrl.href, {
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Image request failed with HTTP ${response.status}.`)
    }

    const blob = await response.blob()
    const mimeType = blob.type || response.headers.get("content-type")?.split(";")[0] || ""
    if (blob.size === 0) throw new Error("The image server returned an empty file.")
    if (!mimeType.toLowerCase().startsWith("image/")) {
      throw new Error(`The source did not return an image (received ${mimeType || "unknown content type"}).`)
    }

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        if (typeof reader.result === "string" && reader.result.startsWith("data:image/")) {
          resolve(reader.result)
        } else {
          reject(new Error("Image conversion did not produce a valid image data URL."))
        }
      }
      reader.onerror = () => reject(reader.error || new Error("Failed to read image blob."))
      reader.readAsDataURL(blob)
    })

    return { base64, size: blob.size, mimeType }
  } finally {
    clearTimeout(timeout)
  }
}

async function sendTabMessageWithFallback(tabId: number, message: any) {
  try {
    await chrome.tabs.sendMessage(tabId, message)
  } catch (err) {
    console.warn("[OpenWear] Tabs sendMessage retry:", err)
  }
}

export {}
