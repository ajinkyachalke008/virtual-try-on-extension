const fs = require('fs');
const path = require('path');

const elena = fs.readFileSync('elena.jpg').toString('base64');
const marcus = fs.readFileSync('marcus.jpg').toString('base64');
const alex = fs.readFileSync('alex.jpg').toString('base64');
const maya = fs.readFileSync('maya.jpg').toString('base64');

const content = [
  '// Bundled local base64 images for 4 preset models - 100% offline & zero CORS',
  `export const MODEL_ELENA_BASE64 = "data:image/jpeg;base64,${elena}";`,
  `export const MODEL_MARCUS_BASE64 = "data:image/jpeg;base64,${marcus}";`,
  `export const MODEL_ALEX_BASE64 = "data:image/jpeg;base64,${alex}";`,
  `export const MODEL_MAYA_BASE64 = "data:image/jpeg;base64,${maya}";`,
  '',
].join('\n');

fs.writeFileSync(path.join(__dirname, '..', 'src', 'lib', 'preset-models-data.ts'), content, 'utf8');
console.log('Successfully written src/lib/preset-models-data.ts');

