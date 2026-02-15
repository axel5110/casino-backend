import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// === OAuth / App credentials (Dev Dashboard) ===
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const PROXY_SECRET = process.env.PROXY_SECRET || CLIENT_SECRET;

const PLAY_VARIANT_ID = process.env.PLAY_VARIANT_ID || "52772073636183";
const SCOPES = process.env.SCOPES || "read_customers,write_customers,read_orders,write_orders";
const APP_URL = process.env.APP_URL; // ex: https://tonservice.onrender.com
const ALLOWED_SHOP = process.env.ALLOWED_SHOP || ""; // ex: jouetmalins.myshopify.com

app.use(express.json());

const TOKENS_FILE = path.join(__dirname, "tokens.json");

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); } catch { return {}; }
}
function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}
function getToken(shop) {
  const tokens = loadTokens();
  return tokens[shop] || null;
}
function setToken(shop, token) {
  const tokens = loadTokens();
  tokens[shop] = token;
  saveTokens(tokens);
}
function safeEqual(a, b) {
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
}

// App Proxy signature verification
function verifyAppProxy(query) {
  const { signature, ...rest } = query;
  if (!signature || !PROXY_SECRET) return false;
  const keys = Object.keys(rest).sort();
  const message = keys.map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`).join("");
  const digest = crypto.createHmac("sha256", PROXY_SECRET).update(message).digest("hex");
  return safeEqual(digest, signature);
}

// Webhook HMAC verification (base64)
function verifyWebhook(rawBody, hmacHeader) {
  if (!PROXY_SECRET) return false;
  const digest = crypto.createHmac("sha256", PROXY_SECRET).update(rawBody).digest("base64");
  return safeEqual(digest, hmacHeader || "");
}

async function shopifyGraphQL(shop, accessToken, query, variables) {
  const r = await fetch(`https://${shop}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await r.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function getCustomerPlays(shop, accessToken, customerGid) {
  const q = `query($id:ID!) {
    customer(id:$id) {
      metafield(namespace:"casino", key:"plays") { value }
    }
  }`;
  const d = await shopifyGraphQL(shop, accessToken, q, { id: customerGid });
  const v = d.customer?.metafield?.value;
  return v ? parseInt(v, 10) : 0;
}

async function setCustomerPlays(shop, accessToken, customerGid, plays) {
  const m = `mutation($input:CustomerInput!) {
    customerUpdate(input:$input) {
      userErrors { field message }
    }
  }`;
  const input = {
    id: customerGid,
    metafields: [{
      namespace: "casino",
      key: "plays",
      type: "number_integer",
      value: String(plays)
    }]
  };
  const d = await shopifyGraphQL(shop, accessToken, m, { input });
  const errs = d.customerUpdate?.userErrors || [];
  if (errs.length) throw new Error(JSON.stringify(errs));
}

// ======== OAuth (one-time) ========
function verifyOAuthHmac(query) {
  const { hmac, signature, ...rest } = query;
  const provided = (hmac || signature || "").toString();
  if (!provided || !CLIENT_SECRET) return false;
  const keys = Object.keys(rest).sort();
  const message = keys.map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`).join("&");
  const digest = crypto.createHmac("sha256", CLIENT_SECRET).update(message).digest("hex");
  return safeEqual(digest, provided);
}

app.get("/auth/start", (req, res) => {
  // alias pour compatibilité (certaines configs utilisent /auth/*)
  req.url = req.originalUrl.replace("/auth/start","/oauth/start");
  return res.redirect(req.url);
});

app.get("/oauth/start", (req, res) => {

  const shop = (req.query.shop || "").toString().trim();
  if (!shop) return res.status(400).send("missing shop");
  if (ALLOWED_SHOP && shop !== ALLOWED_SHOP) return res.status(403).send("shop not allowed");
  if (!CLIENT_ID || !CLIENT_SECRET || !APP_URL) return res.status(500).send("missing CLIENT_ID/CLIENT_SECRET/APP_URL");
  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${APP_URL}/oauth/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${encodeURIComponent(SCOPES)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.redirect(installUrl);
});

async function handleOAuthCallback(req, res) {
try {
    const shop = (req.query.shop || "").toString();
    const code = (req.query.code || "").toString();
    if (!shop || !code) return res.status(400).send("missing shop/code");
    if (ALLOWED_SHOP && shop !== ALLOWED_SHOP) return res.status(403).send("shop not allowed");
    if (!verifyOAuthHmac(req.query)) return res.status(401).send("bad hmac");

    const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code })
}

app.get("/oauth/callback", async (req, res) => {
  return handleOAuthCallback(req, res);
});

app.get("/auth/callback", async (req, res) => {
  // alias compat
  return handleOAuthCallback(req, res);
});


app.get("/admin/status", (req, res) => {
  const shop = (req.query.shop || ALLOWED_SHOP || "").toString();
  if (!shop) return res.send("Add ?shop=jouetmalins.myshopify.com");
  res.json({ shop, hasToken: !!getToken(shop) });
});

// ======== App Proxy ========
async function handleProxyStatus(req, res) {
try {
    if (!verifyAppProxy(req.query)) return res.status(401).json({ ok: false, error: "bad_signature"
}

async function handleProxyConsume(req, res) {
try {
    if (!verifyAppProxy(req.query)) return res.status(401).json({ ok: false, error: "bad_signature"
}

app.get("/apps/casino/status", async (req, res) => handleProxyStatus(req, res));
app.post("/apps/casino/consume", async (req, res) => handleProxyConsume(req, res));

// Compat si ton App Proxy URL pointe vers /proxy/casino (comme dans ta config)
app.get("/proxy/casino/status", async (req, res) => handleProxyStatus(req, res));
app.post("/proxy/casino/consume", async (req, res) => handleProxyConsume(req, res));


// ======== Webhook Order paid ========
app.post("/webhooks/orders_paid", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const raw = req.body;
    const h = req.get("X-Shopify-Hmac-Sha256") || "";
    if (!verifyWebhook(raw, h)) return res.status(401).send("bad hmac");

    const shop = (req.get("X-Shopify-Shop-Domain") || ALLOWED_SHOP || "").toString();
    if (!shop) return res.status(200).send("no shop");
    if (ALLOWED_SHOP && shop !== ALLOWED_SHOP) return res.status(200).send("ok");

    const accessToken = getToken(shop);
    if (!accessToken) return res.status(200).send("not installed");

    const order = JSON.parse(raw.toString("utf8"));
    const customerId = order?.customer?.id;
    if (!customerId) return res.status(200).send("no customer");

    let qty = 0;
    for (const li of (order.line_items || [])) {
      if (String(li.variant_id) === String(PLAY_VARIANT_ID)) qty += (li.quantity || 0);
    }
    if (qty <= 0) return res.status(200).send("no plays");

    const customerGid = `gid://shopify/Customer/${customerId}`;
    const plays = await getCustomerPlays(shop, accessToken, customerGid);
    await setCustomerPlays(shop, accessToken, customerGid, plays + qty);

    return res.status(200).send("ok");
  } catch (e) {
    return res.status(200).send("ok");
  }
});

app.get("/", (req, res) => res.send("ok"));
app.listen(PORT, () => console.log("casino-backend on", PORT));
