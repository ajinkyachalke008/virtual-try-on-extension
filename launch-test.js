/**
 * OpenWear Interactive Test Launcher
 *
 * Starts a local HTTP web server and launches Edge/Chrome with the
 * OpenWear extension loaded automatically so you can immediately test
 * the Virtual Fitting Room, Photo Studio, Wardrobe, and Lookbook!
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8090;
const EXT_PATH = path.join(__dirname, 'build', 'chrome-mv3-prod');
const USER_PROFILE = path.join(__dirname, '.openwear_interactive_profile');

// 1. Locate browser executable
let browserPath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if (!fs.existsSync(browserPath)) {
  browserPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

if (!fs.existsSync(browserPath)) {
  console.error('❌ Could not find Edge or Chrome executable at standard paths.');
  process.exit(1);
}

// 2. HTTP Server to serve test-page.html & assets
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  let filePath = path.join(__dirname, reqPath === '/' ? 'test-page.html' : reqPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const testUrl = `http://127.0.0.1:${PORT}/test-page.html`;
  console.log(`\n============================================================`);
  console.log(`👗 OpenWear Interactive Test Server running on:`);
  console.log(`   👉 ${testUrl}`);
  console.log(`   Extension: ${EXT_PATH}`);
  console.log(`============================================================\n`);

  // 3. Launch browser with extension loaded and all 3 views opened in tabs
  const browserArgs = [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    `--user-data-dir=${USER_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    testUrl,
    'chrome-extension://elpahjlgnahkngohpdommkddpccnchoj/sidepanel.html',
    'chrome-extension://elpahjlgnahkngohpdommkddpccnchoj/popup.html',
  ];

  console.log(`🚀 Launching browser window...`);
  const browserProc = spawn(browserPath, browserArgs, {
    detached: true,
    stdio: 'ignore',
  });

  browserProc.unref();

  console.log(`\n✨ Browser opened! Press Ctrl+C in this terminal when finished testing.`);
});

