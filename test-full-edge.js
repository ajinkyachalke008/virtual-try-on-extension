const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT_PATH = 'D:\\openwear_ext';
const USER_DATA_DIR = 'D:\\openwear_edge_profile_' + Date.now();
const PORT = 8092;

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  let filePath = path.join(__dirname, reqPath === '/' ? 'test-page.html' : reqPath);
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const contentType = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'text/plain';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, async () => {
  console.log(`Test server running on http://127.0.0.1:${PORT}`);
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: false,
    userDataDir: USER_DATA_DIR,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--no-sandbox',
    ],
  });

  const page = await browser.newPage();
  page.on('console', async msg => {
    try {
      const args = await Promise.all(msg.args().map(async a => {
        try { return await a.jsonValue(); } catch { return a.toString(); }
      }));
      console.log(`[BROWSER CONSOLE] [${msg.type()}]:`, ...args);
    } catch {
      console.log(`[BROWSER CONSOLE] [${msg.type()}]: ${msg.text()}`);
    }
  });
  page.on('pageerror', err => console.log(`[BROWSER ERROR]: ${err.toString()}`));

  console.log('Navigating to test-page.html...');
  await page.goto(`http://127.0.0.1:${PORT}/test-page.html`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));

  // Screenshot initial page with CSUI
  await page.screenshot({ path: 'step1-initial.png' });
  console.log('Saved step1-initial.png');

  // Check shadow root of openwear-fitting-room
  const status1 = await page.evaluate(() => {
    const host = document.querySelector('#openwear-fitting-room');
    if (!host) return { error: 'No #openwear-fitting-room host' };
    const shadow = host.shadowRoot;
    if (!shadow) return { error: 'No shadow root' };
    const btn = shadow.querySelector('button');
    return {
      hostFound: true,
      hasShadow: true,
      buttonText: btn ? btn.textContent.trim() : null,
    };
  });
  console.log('Step 1 Status:', status1);

  // Click the FAB button to open fitting room
  console.log('Clicking FAB button 👗...');
  await page.evaluate(() => {
    const host = document.querySelector('#openwear-fitting-room');
    const btn = host?.shadowRoot?.querySelector('button');
    if (btn) btn.click();
  });

  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: 'step2-drawer-open.png' });
  console.log('Saved step2-drawer-open.png');

  const status2 = await page.evaluate(() => {
    const host = document.querySelector('#openwear-fitting-room');
    const shadow = host?.shadowRoot;
    if (!shadow) return { error: 'No shadow root' };
    const text = shadow.textContent;
    const sampleGarments = Array.from(shadow.querySelectorAll('img[alt]')).map(img => img.alt);
    const video = shadow.querySelector('video');
    return {
      hasOpenWearText: text.includes('OpenWear'),
      hasVideo: !!video,
      videoSrcObject: !!video?.srcObject,
      sampleGarments,
    };
  });
  console.log('Step 2 Status:', status2);

  // Click the first sample garment ("Black Leather Bomber Jacket")
  console.log('Clicking first sample garment to trigger try-on...');
  const clickedGarment = await page.evaluate(() => {
    const host = document.querySelector('#openwear-fitting-room');
    const shadow = host?.shadowRoot;
    if (!shadow) return false;
    // Find sample garment card
    const items = shadow.querySelectorAll('div[style*="min-width: 90px"]');
    if (items.length > 0) {
      items[0].click();
      return true;
    }
    // Fallback: look for image with alt
    const img = shadow.querySelector('img[alt="Black Leather Bomber Jacket"]');
    if (img && img.parentElement) {
      img.parentElement.click();
      return true;
    }
    return false;
  });
  console.log('Garment clicked:', clickedGarment);

  // Wait 2 seconds and screenshot scanning
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'step3-scanning.png' });
  console.log('Saved step3-scanning.png');

  const status3 = await page.evaluate(() => {
    const host = document.querySelector('#openwear-fitting-room');
    const shadow = host?.shadowRoot;
    if (!shadow) return {};
    const text = shadow.textContent;
    return {
      statusText: text.slice(0, 300),
      hasLaserBeam: !!shadow.querySelector('.openwear-laser-beam'),
    };
  });
  console.log('Step 3 Status (Scanning):', status3);

  // Wait 18 seconds to see if try-on completes or what error occurs
  console.log('Waiting 18s for Decart realtime response...');
  await new Promise(r => setTimeout(r, 18000));
  await page.screenshot({ path: 'step4-result.png' });
  console.log('Saved step4-result.png');

  const status4 = await page.evaluate(() => {
    const host = document.querySelector('#openwear-fitting-room');
    const shadow = host?.shadowRoot;
    if (!shadow) return {};
    const text = shadow.textContent;
    const video = shadow.querySelector('video');
    return {
      hasLaserBeam: !!shadow.querySelector('.openwear-laser-beam'),
      fullTextSnippet: text.slice(0, 400),
      videoPaused: video ? video.paused : null,
      videoSrcObject: !!video?.srcObject,
    };
  });
  console.log('Step 4 Status (After wait):', status4);

  await browser.close();
  server.close();
  process.exit(0);
});
