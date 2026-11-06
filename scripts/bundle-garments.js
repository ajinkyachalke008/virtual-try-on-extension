const https = require('https');
const fs = require('fs');
const path = require('path');

const garments = [
  { id: 'GARMENT_BOMBER_BASE64', url: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&auto=format&fit=crop&q=80' },
  { id: 'GARMENT_HOODIE_BASE64', url: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=400&auto=format&fit=crop&q=80' },
  { id: 'GARMENT_DRESS_BASE64', url: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=400&auto=format&fit=crop&q=80' },
  { id: 'GARMENT_DENIM_BASE64', url: 'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=400&auto=format&fit=crop&q=80' },
  { id: 'GARMENT_TEE_BASE64', url: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=400&auto=format&fit=crop&q=80' },
  { id: 'GARMENT_PANTS_BASE64', url: 'https://images.unsplash.com/photo-1506630448388-4e683c67ddb0?w=400&auto=format&fit=crop&q=80' },
];

function fetchBase64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve('data:image/jpeg;base64,' + buf.toString('base64'));
      });
      res.on('error', reject);
    });
  });
}

(async () => {
  let content = '// Bundled local base64 images for sample garments - 100% offline & zero CORS\n';
  for (const g of garments) {
    console.log('Fetching', g.id);
    const b64 = await fetchBase64(g.url);
    content += `export const ${g.id} = "${b64}";\n`;
  }
  const targetPath = path.join(__dirname, '..', 'src', 'lib', 'preset-garments-data.ts');
  fs.writeFileSync(targetPath, content);
  console.log('Successfully wrote to', targetPath);
})();

