/**
 * OpenWear Wardrobe Management
 *
 * Provides persistent garment collection storage via chrome.storage.local
 * with fallback to window.localStorage. Supports category tagging,
 * pricing/store attribution, and 1-click try-on triggers.
 */

import type { GarmentCategory } from "./decart"
import {
  GARMENT_BOMBER_BASE64,
  GARMENT_HOODIE_BASE64,
  GARMENT_DRESS_BASE64,
  GARMENT_DENIM_BASE64,
  GARMENT_TEE_BASE64,
  GARMENT_PANTS_BASE64,
} from "./preset-garments-data"

export interface WardrobeItem {
  id: string
  title: string
  category: GarmentCategory
  imageUrl: string
  price?: string
  storeUrl?: string
  storeName?: string
  addedAt: number
  notes?: string
}

const STORAGE_KEY = "openwear_wardrobe_items"

export const DEFAULT_WARDROBE_ITEMS: WardrobeItem[] = [
  {
    id: "wardrobe-bomber-jacket",
    title: "Black Leather Bomber Jacket",
    category: "outerwear",
    imageUrl: GARMENT_BOMBER_BASE64,
    price: "$189.00",
    storeName: "Boutique Noir",
    storeUrl: "https://boutiquenoir.demo",
    addedAt: 1700000001000,
  },
  {
    id: "wardrobe-streetwear-hoodie",
    title: "Heavyweight Streetwear Hoodie",
    category: "upper_body",
    imageUrl: GARMENT_HOODIE_BASE64,
    price: "$75.00",
    storeName: "Urban Stitch",
    storeUrl: "https://urbanstitch.demo",
    addedAt: 1700000002000,
  },
  {
    id: "wardrobe-silk-dress",
    title: "Emerald Silk Slip Midi Dress",
    category: "dress",
    imageUrl: GARMENT_DRESS_BASE64,
    price: "$145.00",
    storeName: "Maison Soie",
    storeUrl: "https://maisonsoie.demo",
    addedAt: 1700000003000,
  },
  {
    id: "wardrobe-denim-jacket",
    title: "Classic Washed Denim Jacket",
    category: "outerwear",
    imageUrl: GARMENT_DENIM_BASE64,
    price: "$98.00",
    storeName: "Heritage Denim",
    storeUrl: "https://heritagedenim.demo",
    addedAt: 1700000004000,
  },
  {
    id: "wardrobe-white-tee",
    title: "Tailored Organic Cotton T-Shirt",
    category: "upper_body",
    imageUrl: GARMENT_TEE_BASE64,
    price: "$38.00",
    storeName: "Clean Basics",
    storeUrl: "https://cleanbasics.demo",
    addedAt: 1700000005000,
  },
  {
    id: "wardrobe-linen-pants",
    title: "Relaxed Wide-Leg Linen Trousers",
    category: "lower_body",
    imageUrl: GARMENT_PANTS_BASE64,
    price: "$85.00",
    storeName: "Coast Line",
    storeUrl: "https://coastline.demo",
    addedAt: 1700000006000,
  },
]

/**
 * Retrieve all wardrobe items. If empty, initializes with default staples.
 */
export async function getWardrobeItems(): Promise<WardrobeItem[]> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const res = await chrome.storage.local.get(STORAGE_KEY)
      if (res && Array.isArray(res[STORAGE_KEY]) && res[STORAGE_KEY].length > 0) {
        return res[STORAGE_KEY]
      }
      // Initialize defaults
      await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_WARDROBE_ITEMS })
      return DEFAULT_WARDROBE_ITEMS
    }

    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_WARDROBE_ITEMS))
      return DEFAULT_WARDROBE_ITEMS
    }
  } catch (err) {
    console.warn("[OpenWear Wardrobe] Error reading storage:", err)
  }
  return DEFAULT_WARDROBE_ITEMS
}

/**
 * Save or update an item in the wardrobe. Prevents duplicate image URLs.
 */
export async function saveWardrobeItem(
  item: Omit<WardrobeItem, "id" | "addedAt"> & { id?: string; addedAt?: number }
): Promise<WardrobeItem> {
  const current = await getWardrobeItems()
  const now = Date.now()
  const finalItem: WardrobeItem = {
    id: item.id || `wardrobe_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: item.title || "Untitled Garment",
    category: item.category || "upper_body",
    imageUrl: item.imageUrl,
    price: item.price,
    storeUrl: item.storeUrl,
    storeName: item.storeName,
    addedAt: item.addedAt || now,
    notes: item.notes,
  }

  // Remove existing item with identical imageUrl if present to update it
  const filtered = current.filter(
    (x) => x.id !== finalItem.id && x.imageUrl !== finalItem.imageUrl
  )
  const updated = [finalItem, ...filtered]

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: updated })
    } else if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    }
  } catch (err) {
    console.warn("[OpenWear Wardrobe] Error saving item:", err)
  }

  return finalItem
}

/**
 * Delete an item from the wardrobe by ID.
 */
export async function deleteWardrobeItem(id: string): Promise<WardrobeItem[]> {
  const current = await getWardrobeItems()
  const updated = current.filter((x) => x.id !== id)

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: updated })
    } else if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    }
  } catch (err) {
    console.warn("[OpenWear Wardrobe] Error deleting item:", err)
  }

  return updated
}

/**
 * Clear the entire wardrobe.
 */
export async function clearWardrobe(): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: [] })
    } else if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([]))
    }
  } catch (err) {
    console.warn("[OpenWear Wardrobe] Error clearing:", err)
  }
}

