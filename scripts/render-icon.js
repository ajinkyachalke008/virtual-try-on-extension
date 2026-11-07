const fs = require('fs');
const puppeteer = require('puppeteer-core');

async function render() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await puppeteer.launch({ executablePath: edgePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
  const svg = fs.readFileSync('assets/logo.svg', 'utf8');
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;background:transparent;overflow:hidden;">${svg}</body></html>`);
  await page.screenshot({ path: 'assets/icon.png', omitBackground: true });
  await browser.close();
  console.log('Icon rendered successfully to assets/icon.png!');
}

render().catch(console.error);
