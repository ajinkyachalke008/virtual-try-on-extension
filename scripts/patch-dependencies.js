const fs = require('fs');
const path = require('path');

function patchFile(filePath, search, replace) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(search)) {
    content = content.replace(search, replace);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[patch] Patched ${path.basename(filePath)}`);
  }
}

// 1. Patch Zod package.json for Parcel bundler compatibility
const zodPkgPath = path.join(__dirname, '..', 'node_modules', 'zod', 'package.json');
if (fs.existsSync(zodPkgPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(zodPkgPath, 'utf8'));
    if (pkg.module !== './index.cjs') {
      pkg.module = './index.cjs';
      pkg.import = './index.cjs';
      fs.writeFileSync(zodPkgPath, JSON.stringify(pkg, null, 2), 'utf8');
      console.log('[patch] Patched zod package.json entry to index.cjs');
    }
  } catch (e) {
    console.warn('[patch] Failed to patch zod package.json:', e);
  }
}

// 2. Patch Decart SDK LiveKit dynamic import to static import
const decartLiveKitPath = path.join(__dirname, '..', 'node_modules', '@decartai', 'sdk', 'dist', 'realtime', 'livekit.js');
patchFile(
  decartLiveKitPath,
  'function loadLiveKitClient() {\n\tliveKitModulePromise ??= import("livekit-client")',
  'import * as livekitModule from "livekit-client";\nfunction loadLiveKitClient() {\n\tliveKitModulePromise ??= Promise.resolve(validateLiveKitModule(livekitModule))'
);

// 3. Patch Decart SDK Error construction to return real Error instances
const decartErrorsPath = path.join(__dirname, '..', 'node_modules', '@decartai', 'sdk', 'dist', 'utils', 'errors.js');
patchFile(
  decartErrorsPath,
  'function createSDKError(code, message, data, cause) {\n\treturn {\n\t\tcode,\n\t\tmessage,\n\t\tdata,\n\t\tcause\n\t};\n}',
  'function createSDKError(code, message, data, cause) {\n\tconst err = new Error(message);\n\terr.code = code;\n\terr.data = data;\n\terr.cause = cause;\n\treturn err;\n}'
);

// 4. Patch Frame Metadata diagnostics for Chrome Extension content scripts
const decartWorkerDiagPath = path.join(__dirname, '..', 'node_modules', '@decartai', 'sdk', 'dist', 'realtime', 'browser', 'frame-metadata-diagnostics.js');
patchFile(
  decartWorkerDiagPath,
  'function isFrameMetadataRuntimeSupported() {\n\tif (typeof window === "undefined") return false;\n\ttry {',
  'function isFrameMetadataRuntimeSupported() {\n\tif (typeof window === "undefined") return false;\n\tif (typeof chrome !== "undefined" && chrome.runtime?.id) return false;\n\ttry {'
);

console.log('[patch] All OpenWear dependency patches applied successfully.');
