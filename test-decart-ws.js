const { createDecartClient } = require('@decartai/sdk');

const API_KEY = "dct_extention1_ywgiZVVTOoNqPCqsABCxXKLUtsguIYdrVDIWRiycHcBEwqnAgaEvRSJuoBcUHBBx";

async function test() {
  console.log("Creating ephemeral token...");
  const client = createDecartClient({ apiKey: API_KEY });
  const tokenRes = await client.tokens.create();
  console.log("Token response:", tokenRes);
  const token = tokenRes.apiKey || tokenRes.token;

  const wsUrl = `wss://api3.decart.ai/v1/stream?api_key=${encodeURIComponent(token)}&model=lucy-vton-latest`;
  console.log("Connecting WebSocket to:", wsUrl);

  const ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    console.log("WS OPENED! Sending livekit_join...");
    ws.send(JSON.stringify({
      type: "livekit_join",
      passthrough: false,
    }));
  };

  ws.onmessage = (e) => {
    console.log("WS MESSAGE:", e.data);
  };

  ws.onerror = (e) => {
    console.log("WS ERROR:", e.message || e);
  };

  ws.onclose = (e) => {
    console.log(`WS CLOSED: code=${e.code}, reason="${e.reason}"`);
  };

  await new Promise(r => setTimeout(r, 6000));
}

test().catch(console.error);
