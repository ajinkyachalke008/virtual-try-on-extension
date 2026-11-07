# OpenWear - All-in-One AI Virtual Try-On & Studio Extension 👗✨

OpenWear is an advanced AI virtual fitting room extension built with **Plasmo**, **Decart Lucy VTON** (`lucy-vton-latest`), and an in-browser **Photorealistic Studio Engine**. It turns any e-commerce page into your personal fitting studio: try on clothing live via your webcam, try on curated model presets or uploaded photos without a camera, manage your personal fashion wardrobe, and export HD Lookbook snapshots.

---

## 🌟 Key Features

- **Dual-Engine Virtual Fitting Studio**:
  - **🎥 Live Cam Mode**: Realtime low-latency video try-on powered by Decart's `lucy-vton-latest` WebRTC stream.
  - **📷 Photo Studio Mode**: Try on apparel without a camera using 4 diverse preset models (Elena, Marcus, Alex, Maya) or your own photo upload. Supports both **Canvas-to-WebRTC Stream Bridge** and **Instant Photorealistic Composite Preview**.
  - **⇄ Before/After Comparison Slider**: Drag handle to smoothly compare the original model against the tried-on garment.
- **👗 My Wardrobe Collection**:
  - Persistent collection stored in `chrome.storage.local`.
  - Scrapes item title, price tag, store domain, and product category (`Tops`, `Bottoms`, `Dresses`, `Outerwear`).
  - 1-click try-on and instant outfit swapping.
- **📸 Lookbook & Snapshot Studio**:
  - 1-click camera snapshot on live video and photo try-on viewports.
  - Generates branded 1080×1350 social Lookbook polaroid cards with garment tags and date stamps.
  - 1-click HD PNG download and local lookbook gallery.
- **🛍️ Smart Dual Hover Scraper**:
  - Automatically identifies clothing photos on shopping sites (Amazon, Zara, Myntra, ASOS, H&M, etc.).
  - Floating action pill: **"👗 Try On"**, **"➕ Wardrobe"**, and **"🖥️ Cast TV"**.
- **🖥️ In-Store Smart Mirror Kiosk & Dual-Screen Sync**:
  - Fullscreen 100% edge-to-edge mirror display (`tabs/kiosk.html`) built for 32"–55" retail displays.
  - Dual-screen real-time sync: laptop acts as the associate console, casting outfits to the TV mirror instantly.
  - Photobooth 3-2-1 countdown flash & "Scan QR to Take Photo Home" modal for in-store shoppers.
  - Remote controller console in the extension popup for wireless TV control.
- **Side Panel Drawer & Native SidePanel**:
  - Zero CSS leaking via Shadow DOM (`openwear-fitting-room`).
  - Full-featured companion in Chrome's native Side Panel (`sidepanel.html`).
- **In-App API Key Management**:
  - Realtime validation and storage synchronization for Decart Lucy VTON keys.

---

## 🛠️ Tech Stack

- **Framework**: [Plasmo](https://docs.plasmo.com/) (Manifest V3)
- **Frontend**: React 18, TypeScript, TailwindCSS
- **Realtime AI**: [@decartai/sdk](https://docs.platform.decart.ai/) + LiveKit WebRTC
- **Package Manager**: pnpm

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (`npm i -g pnpm`)
- [Decart Platform API Key](https://platform.decart.ai/)

### Installation

```bash
# Clone the repository
git clone https://github.com/ajinkyachalke008/virtual-try-on-extension.git
cd virtual-try-on-extension

# Install dependencies
pnpm install

# Build extension for production
pnpm build
```

---

## 📦 Loading the Extension into Browser

1. Open **Google Chrome** or **Microsoft Edge**.
2. Navigate to `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** (top-left button).
5. Select the `build/chrome-mv3-prod` folder inside this project.
6. Navigate to any clothing website or open the included `test-page.html`.
7. Click the floating **👗** button in the bottom right corner and start trying on clothes!

---

## 🧪 Testing

```bash
# Run Comprehensive End-to-End Test (All 4 Tabs, Presets, Wardrobe & Hover Buttons)
node test-e2e-studio.js

# Test Decart WebRTC Signaling & Ephemeral Token Generation
node test-decart-ws.js

# Run Automated Edge Browser Test
node test-full-edge.js
```

---

## 📄 License

MIT License. Built with ❤️ using Plasmo & Decart AI.
