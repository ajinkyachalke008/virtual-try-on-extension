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
  DEFAULT_API_KEY,
  getStoredApiKey,
  setStoredApiKey,
  validateApiKey,
} from "~lib/decart"

// --- Context Menus ---
chrome.runtime.onInstalled.addListener(async () => {
  const currentKey = await getStoredApiKey()
  if (!currentKey) {
    await setStoredApiKey(DEFAULT_API_KEY)
  }

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
      .catch(() => sendResponse({ apiKey: DEFAULT_API_KEY }))
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
  if (!url) throw new Error("No URL provided")

  // Handle data URLs directly
  if (url.startsWith("data:image/")) {
    const parts = url.split(",")
    const mimeMatch = parts[0].match(/:(.*?);/)
    const mimeType = mimeMatch ? mimeMatch[1] : "image/png"
    const binary = atob(parts[1] || "")
    const size = binary.length
    return {
      base64: url,
      size,
      mimeType,
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`)
    }

    const blob = await response.blob()
    const mimeType = blob.type || "image/png"
    const size = blob.size

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result)
        } else {
          reject(new Error("FileReader did not return a string"))
        }
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })

    return {
      base64,
      size,
      mimeType,
    }
  } catch (err) {
    clearTimeout(timeout)
    throw err
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
