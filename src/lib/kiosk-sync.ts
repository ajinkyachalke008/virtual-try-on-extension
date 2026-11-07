/**
 * OpenWear Kiosk Synchronizer
 *
 * Realtime communication bridge between Laptop Controller (browsing shopping
 * websites or managing store collection) and Big Screen TV Mirror (kiosk.html).
 *
 * Dual-channel architecture:
 * 1. BroadcastChannel: 0ms latency for intra-browser communication
 * 2. Chrome Runtime Messaging: cross-context bridge from content scripts on external shopping stores
 */

export type KioskAction =
  | {
      type: "APPLY_GARMENT"
      garmentSrc: string
      title: string
      category?: string
      price?: string
    }
  | {
      type: "CLEAR_GARMENT"
    }
  | {
      type: "TRIGGER_SNAPSHOT"
    }
  | {
      type: "NAVIGATE_OUTFIT"
      direction: "next" | "prev"
    }
  | {
      type: "TOGGLE_FULLSCREEN"
    }
  | {
      type: "PING"
    }
  | {
      type: "PONG"
    }

const CHANNEL_NAME = "openwear_kiosk_sync_channel"

let broadcastChannelInstance: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
    return null
  }
  if (!broadcastChannelInstance) {
    try {
      broadcastChannelInstance = new BroadcastChannel(CHANNEL_NAME)
    } catch (e) {
      console.warn("[OpenWear Sync] BroadcastChannel initialization failed:", e)
    }
  }
  return broadcastChannelInstance
}

/**
 * Broadcast an action from Laptop controller to TV Mirror.
 */
export function broadcastKioskAction(action: KioskAction): void {
  // 1. Send via BroadcastChannel
  try {
    const channel = getChannel()
    if (channel) {
      channel.postMessage(action)
    }
  } catch (e) {
    console.warn("[OpenWear Sync] Broadcast error:", e)
  }

  // 2. Send via Chrome Runtime to cross context boundaries
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "BROADCAST_KIOSK_ACTION",
        action,
      }).catch(() => {})
    }
  } catch (e) {
    // Ignore runtime disconnected warnings
  }
}

/**
 * Listen for actions on the TV Mirror screen.
 */
export function listenKioskAction(
  callback: (action: KioskAction) => void
): () => void {
  // 1. Subscribe to BroadcastChannel
  const channel = getChannel()
  const handleBroadcastMessage = (event: MessageEvent) => {
    if (event.data && typeof event.data === "object" && "type" in event.data) {
      callback(event.data as KioskAction)
    }
  }

  if (channel) {
    channel.addEventListener("message", handleBroadcastMessage)
  }

  // 2. Subscribe to Chrome Runtime Messages
  const handleRuntimeMessage = (
    message: any,
    _sender: any,
    sendResponse: (res?: any) => void
  ) => {
    if (message?.type === "KIOSK_REMOTE_ACTION" && message.action) {
      callback(message.action as KioskAction)
      sendResponse?.({ received: true })
    }
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(handleRuntimeMessage)
  }

  // Unsubscribe cleanup
  return () => {
    if (channel) {
      channel.removeEventListener("message", handleBroadcastMessage)
    }
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage)
    }
  }
}
