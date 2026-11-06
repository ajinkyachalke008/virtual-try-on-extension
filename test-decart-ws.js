/**
 * OpenWear Decart authentication smoke test.
 *
 * This test deliberately does not open a raw WebSocket. The supported
 * realtime transport is managed by @decartai/sdk and LiveKit/WebRTC.
 *
 * Usage (PowerShell):
 *   $env:DECART_API_KEY = "your-permanent-Decart-key"
 *   node test-decart-ws.js
 *
 * The key is read from the environment and is never printed.
 */

const { createDecartClient } = require("@decartai/sdk");

async function main() {
  const apiKey = process.env.DECART_API_KEY?.trim();

  if (!apiKey) {
    console.error("DECART_API_KEY is not set. Provide your own key through the environment.");
    process.exitCode = 1;
    return;
  }

  const client = createDecartClient({ apiKey });
  const tokenResponse = await client.tokens.create({ expiresIn: 300 });
  const ephemeralToken = tokenResponse?.apiKey || tokenResponse?.token;

  console.log("TOKEN_CREATED:", Boolean(ephemeralToken));
  if (!ephemeralToken) {
    throw new Error("Decart did not return an ephemeral client token.");
  }

  console.log("TOKEN_TYPE:", ephemeralToken.startsWith("ek_") ? "ephemeral" : "returned-by-SDK");
  console.log("AUTH_SMOKE_TEST: PASS");
  console.log("This validates token creation only; browser camera, WebRTC and model output require an extension runtime test.");
}

main().catch((error) => {
  console.error("AUTH_SMOKE_TEST: FAIL");
  console.error(error?.message || error);
  process.exitCode = 1;
});
