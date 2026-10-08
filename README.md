# OpenWear - Realtime Virtual Try-On Chrome Extension 👗✨

OpenWear is an AI-powered browser extension built with **Plasmo** and **Decart Lucy VTON** (`lucy-vton-latest`). It turns any webpage into an interactive fitting room: simply drag and drop clothing images from any e-commerce site or choose from the curated wardrobe to try clothes on live via your webcam in realtime.

---

## 🌟 Key Features

- **Decart Lucy VTON Realtime WebRTC**: Direct low-latency peer-to-peer video streaming powered by Decart's `lucy-vton-latest` model.
- **Side Panel Drawer CSUI**: Injected into any webpage via Shadow DOM (`openwear-fitting-room`), ensuring zero CSS style leaking.
- **Smart Image Proxying**: Chrome background service worker fetches clothing images across CORS boundaries and feeds high-res blobs directly into Decart.
- **Holographic Laser Scanning Effect**: Animated laser sweep and grid animation while clothing is scanned onto the user.
- **Person Centering Heuristic & Fallback**: Fast silhouette positioning check with a 2-second automatic fallback to keep the experience seamless.
- **Instant Garment Wardrobe**: 4 built-in clean flat-lay garments (Bomber Jacket, Streetwear Hoodie, Silk Slip Dress, Denim Jacket) for 1-click try-on.
- **Custom Image Upload & Drag-and-Drop**: Drag clothing from any website (Zara, ASOS, H&M, Amazon, Unsplash) or upload local files.
- **In-App API Key Management**: Settings modal allows entering custom Decart API keys saved to `chrome.storage.sync`.

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
# Test Decart WebRTC Signaling & Token Generation
node test-decart-ws.js

# Run Automated End-to-End Test in Browser
node test-full-edge.js
```

---

## 📄 License

MIT License. Built with ❤️ using Plasmo & Decart AI.
