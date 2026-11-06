/**
 * OpenWear Screen Split Layout Manager
 *
 * Implements a true 70:30 desktop screen split:
 * - 70% Left: Shopping webpage, fully usable, responsive and adapted.
 * - 30% Right: OpenWear virtual fitting room drawer.
 *
 * Preserves, stores, and restores original webpage inline styles on close.
 * Handles repeated opening/closing safely with zero style leakage.
 */

interface OriginalHostStyles {
  htmlWidth: string
  htmlMaxWidth: string
  htmlMarginRight: string
  htmlOverflowX: string
  htmlBoxSizing: string
  htmlTransition: string
  bodyWidth: string
  bodyMaxWidth: string
  bodyOverflowX: string
  bodyBoxSizing: string
}

const STYLE_ELEMENT_ID = "openwear-split-layout-styles"
const SPLIT_ACTIVE_CLASS = "openwear-split-active"

let savedHostStyles: OriginalHostStyles | null = null
let isSplitActive = false

/**
 * Split layout CSS injected into document.head when OpenWear opens.
 * Adapts desktop screens (>=1200px) to an exact 70:30 layout,
 * compact screens (960px-1199px) to a comfortable side-by-side layout,
 * and smaller screens (<960px) to an overlay drawer without crushing the host page.
 */
const SPLIT_CSS = `
:root {
  --openwear-panel-width: 30vw;
  --openwear-page-width: calc(100vw - var(--openwear-panel-width));
}

@media (min-width: 1200px) {
  :root {
    --openwear-panel-width: 30vw;
    --openwear-page-width: 70vw;
  }

  html.${SPLIT_ACTIVE_CLASS} {
    width: 70vw !important;
    max-width: 70vw !important;
    margin-right: 30vw !important;
    box-sizing: border-box !important;
    overflow-x: hidden !important;
    transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1),
                max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1),
                margin-right 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
  }

  html.${SPLIT_ACTIVE_CLASS} body {
    width: 100% !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
    overflow-x: hidden !important;
  }

  /* Ensure fixed headers and banners don't overflow underneath the 30% panel */
  html.${SPLIT_ACTIVE_CLASS} body > *:not(#openwear-fitting-room):not(#openwear-hover-button) {
    max-width: 70vw !important;
  }
}

@media (min-width: 960px) and (max-width: 1199px) {
  :root {
    --openwear-panel-width: 380px;
    --openwear-page-width: calc(100vw - 380px);
  }

  html.${SPLIT_ACTIVE_CLASS} {
    width: calc(100vw - 380px) !important;
    max-width: calc(100vw - 380px) !important;
    margin-right: 380px !important;
    box-sizing: border-box !important;
    overflow-x: hidden !important;
    transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1),
                max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1),
                margin-right 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
  }

  html.${SPLIT_ACTIVE_CLASS} body {
    width: 100% !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
    overflow-x: hidden !important;
  }

  html.${SPLIT_ACTIVE_CLASS} body > *:not(#openwear-fitting-room):not(#openwear-hover-button) {
    max-width: calc(100vw - 380px) !important;
  }
}

@media (max-width: 959px) {
  :root {
    --openwear-panel-width: min(100vw, 440px);
    --openwear-page-width: 100vw;
  }

  /* On narrow screens, keep the shopping page full width and open fitting room as overlay */
  html.${SPLIT_ACTIVE_CLASS} {
    width: 100% !important;
    max-width: 100% !important;
    margin-right: 0 !important;
  }
}
`

/**
 * Activates the true 70:30 split layout.
 * Shrinks the shopping website to the left 70% while OpenWear takes the right 30%.
 */
export function activateSplitLayout(): void {
  if (typeof document === "undefined" || isSplitActive) return
  isSplitActive = true

  const html = document.documentElement
  const body = document.body

  if (!html || !body) return

  // 1. Snapshot original inline styles before touching anything
  savedHostStyles = {
    htmlWidth: html.style.width,
    htmlMaxWidth: html.style.maxWidth,
    htmlMarginRight: html.style.marginRight,
    htmlOverflowX: html.style.overflowX,
    htmlBoxSizing: html.style.boxSizing,
    htmlTransition: html.style.transition,

    bodyWidth: body.style.width,
    bodyMaxWidth: body.style.maxWidth,
    bodyOverflowX: body.style.overflowX,
    bodyBoxSizing: body.style.boxSizing,
  }

  // 2. Inject or update the dynamic split-layout style element
  let styleEl = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement("style")
    styleEl.id = STYLE_ELEMENT_ID
    const targetParent = document.head || html
    targetParent.appendChild(styleEl)
  }
  styleEl.textContent = SPLIT_CSS

  // 3. Add the split class to trigger the CSS rules
  html.classList.add(SPLIT_ACTIVE_CLASS)

  // 4. Dispatch resize event so host website grid libraries (Masonry, React-virtual, Swiper, etc.) reflow
  window.dispatchEvent(new Event("resize"))
}

/**
 * Deactivates the split layout and completely restores the webpage's original layout and styles.
 */
export function deactivateSplitLayout(): void {
  if (typeof document === "undefined" || !isSplitActive) return
  isSplitActive = false

  const html = document.documentElement
  const body = document.body

  // 1. Remove the active split class
  if (html) {
    html.classList.remove(SPLIT_ACTIVE_CLASS)
  }

  // 2. Remove the injected stylesheet
  const styleEl = document.getElementById(STYLE_ELEMENT_ID)
  if (styleEl) {
    styleEl.remove()
  }

  // 3. Restore exact original inline styles
  if (savedHostStyles) {
    if (html) {
      html.style.width = savedHostStyles.htmlWidth
      html.style.maxWidth = savedHostStyles.htmlMaxWidth
      html.style.marginRight = savedHostStyles.htmlMarginRight
      html.style.overflowX = savedHostStyles.htmlOverflowX
      html.style.boxSizing = savedHostStyles.htmlBoxSizing
      html.style.transition = savedHostStyles.htmlTransition
    }

    if (body) {
      body.style.width = savedHostStyles.bodyWidth
      body.style.maxWidth = savedHostStyles.bodyMaxWidth
      body.style.overflowX = savedHostStyles.bodyOverflowX
      body.style.boxSizing = savedHostStyles.bodyBoxSizing
    }

    savedHostStyles = null
  }

  // 4. Dispatch resize event so host website smoothly returns to full width
  window.dispatchEvent(new Event("resize"))
}

/**
 * Returns true if the split layout is currently active on the host page.
 */
export function isSplitLayoutActive(): boolean {
  return isSplitActive
}

