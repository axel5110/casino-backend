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

// ===== ENV =====
const CLIENT_ID = process.env.CLIENT_ID || "";           // Dev Dashboard "ID client"
const CLIENT_SECRET = process.env.CLIENT_SECRET || "";   // Dev Dashboard "Secret"
const PROXY_SECRET = process.env.PROXY_SECRET || CLIENT_SECRET; // HMAC (App Proxy + Webhooks)
const APP_URL_RAW = process.env.APP_URL || "";
const APP_URL = normalizeBaseUrl(APP_URL_RAW);
               // https://casino-jouetmalins.onrender.com
const ALLOWED_SHOP_RAW = process.env.ALLOWED_SHOP || "";
const ALLOWED_SHOP = String(ALLOWED_SHOP_RAW).trim().toLowerCase();     // ex: jouetmalins.myshopify.com
const SCOPES = process.env.SCOPES || "read_customers,write_customers,read_orders,write_orders";
const PLAY_VARIANT_ID = String(process.env.PLAY_VARIANT_ID || "52772073636183");

const TOKENS_FILE = path.join(__dirname, "tokens.json");

function normalizeBaseUrl(url){
  const u = String(url || "").trim();
  if(!u) return "";
  return u.endsWith("/") ? u.slice(0,-1) : u;
}

function normalizeShop(shop){ return String(shop||"").trim().toLowerCase(); }


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

// ===== Health / Debug =====
app.get("/", (req, res) => res.status(200).send("ok"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));
app.get("/debug/env", (req,res)=>res.status(200).json({ APP_URL_RAW, APP_URL, ALLOWED_SHOP_RAW, ALLOWED_SHOP, SCOPES, PLAY_VARIANT_ID }));
app.get("/admin/status", (req, res) => {
  const shop = normalizeShop(req.query.shop || ALLOWED_SHOP || "");
  if (!shop) return res.status(400).json({ ok: false, error: "missing_shop" });
  return res.json({ ok: true, shop, hasToken: !!getToken(shop) });
});

// ===== OAuth HMAC verify =====
function verifyOAuthHmac(query) {
  const provided = String(query.hmac || query.signature || "");
  if (!provided || !CLIENT_SECRET) return false;

  const { hmac, signature, ...rest } = query;
  const keys = Object.keys(rest).sort();
  const message = keys.map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`).join("&");
  const digest = crypto.createHmac("sha256", CLIENT_SECRET).update(message).digest("hex");
  return safeEqual(digest, provided);
}


app.get("/oauth/debug", (req, res) => {
  const redirectUri = `${APP_URL}/auth/callback`;
  return res.json({
    ok: true,
    APP_URL_RAW,
    APP_URL,
    redirectUri,
    note: "La redirectUri doit être whitelistée dans l'app (Dev Dashboard) exactement."
  });
});

app.get("/oauth/start-jouetmalins", (req,res)=>res.redirect("/oauth/start"));

app.get("/oauth/start", (req, res) => {
  let shop = normalizeShop(req.query.shop || "");
  // Si ALLOWED_SHOP est défini, on force toujours ce shop (évite les erreurs de boutique)
  if (ALLOWED_SHOP) shop = ALLOWED_SHOP;
  if (!shop) return res.status(400).send("missing shop (ALLOWED_SHOP vide)");
  /* shop forcé via ALLOWED_SHOP */
  if (!CLIENT_ID || !CLIENT_SECRET || !APP_URL) return res.status(500).send("missing env CLIENT_ID/CLIENT_SECRET/APP_URL (check APP_URL without trailing slash)");

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${APP_URL}/auth/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${encodeURIComponent(SCOPES)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  return res.redirect(installUrl);
});

async function handleOAuthCallback(req, res) {
  try {
    let shop = normalizeShop(req.query.shop || "");
  // Si ALLOWED_SHOP est défini, on force toujours ce shop (évite les erreurs de boutique)
  if (ALLOWED_SHOP) shop = ALLOWED_SHOP;
    const code = String(req.query.code || "");
    if (!shop || !code) return res.status(400).send("missing shop/code");
    /* shop forcé via ALLOWED_SHOP */
    if (!verifyOAuthHmac(req.query)) return res.status(401).send("bad hmac");

    const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code })
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) return res.status(500).send("no access_token returned");

    setToken(shop, tokenData.access_token);
    return res.status(200).send(`✅ OAuth OK. Token saved for ${shop}. Tu peux fermer cette page.`);
  } catch {
    return res.status(500).send("oauth failed");
  }
}

app.get("/oauth/callback", handleOAuthCallback);
// Compat si tu as mis /auth/callback dans Shopify
app.get("/auth/callback", handleOAuthCallback);

// ===== App Proxy signature verify =====
function verifyAppProxy(query) {
  const signature = String(query.signature || "");
  if (!signature || !PROXY_SECRET) return false;

  const { signature: _sig, ...rest } = query;
  const keys = Object.keys(rest).sort();
  const message = keys.map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`).join("");
  const digest = crypto.createHmac("sha256", PROXY_SECRET).update(message).digest("hex");
  return safeEqual(digest, signature);
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
  const q = `query($id:ID!) { customer(id:$id) { metafield(namespace:"casino", key:"plays") { value } } }`;
  const d = await shopifyGraphQL(shop, accessToken, q, { id: customerGid });
  const v = d.customer?.metafield?.value;
  return v ? parseInt(v, 10) : 0;
}

async function setCustomerPlays(shop, accessToken, customerGid, plays) {
  const m = `mutation($input:CustomerInput!) { customerUpdate(input:$input) { userErrors { field message } } }`;
  const input = {
    id: customerGid,
    metafields: [{ namespace: "casino", key: "plays", type: "number_integer", value: String(plays) }]
  };
  const d = await shopifyGraphQL(shop, accessToken, m, { input });
  const errs = d.customerUpdate?.userErrors || [];
  if (errs.length) throw new Error(JSON.stringify(errs));
}

async function findCustomerIdByEmail(shop, accessToken, email) {
  const q = `query($query:String!) {
    customers(first: 1, query: $query) { edges { node { id } } }
  }`;
  const query = `email:${email}`;
  const d = await shopifyGraphQL(shop, accessToken, q, { query });
  const edge = d.customers?.edges?.[0];
  const gid = edge?.node?.id || null;
  return gid;
}


let LAST_WEBHOOK = { at: null, shop: null, ok: null, note: null, qty: 0, email: null, customerId: null };

// IMPORTANT: webhook must read RAW body, so we declare it BEFORE express.json
app.get("/debug/lastwebhook", (req,res)=>res.status(200).json(LAST_WEBHOOK));
app.get("/webhooks/orders_paid", (req, res) => res.status(200).send("ok"));
app.post("/webhooks/orders_paid", express.raw({ type: "*/*" }), async (req, res) => {
  // Trace every webhook hit (even if HMAC fails)
  LAST_WEBHOOK = { at: new Date().toISOString(), shop: null, ok: false, note: "hit", qty: 0, email: null, customerId: null };
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const h = String(req.get("X-Shopify-Hmac-Sha256") || "");
    const digest = crypto.createHmac("sha256", PROXY_SECRET).update(raw).digest("base64");
    if (!safeEqual(digest, h)) {
      LAST_WEBHOOK = { at: new Date().toISOString(), shop: String(req.get("X-Shopify-Shop-Domain")||ALLOWED_SHOP||""), ok: false, note: "bad_hmac", qty: 0, email: null, customerId: null };
      return res.status(401).send("bad hmac");
    }

    const shop = String(req.get("X-Shopify-Shop-Domain") || ALLOWED_SHOP || "");
    if (!shop) { LAST_WEBHOOK = { at: new Date().toISOString(), shop: null, ok:false, note:"no_shop_header", qty:0, email:null, customerId:null }; return res.status(200).send("no shop"); }
    if (ALLOWED_SHOP && shop !== ALLOWED_SHOP) return res.status(200).send("ok");

    const accessToken = getToken(shop);
    if (!accessToken) return res.status(200).send("not installed");

    const order = JSON.parse(raw.toString("utf8") || "{}");
    const customerId = order?.customer?.id || null;
    const email = order?.email || order?.customer?.email || null;

    let qty = 0;
    for (const li of (order.line_items || [])) {
      if (String(li.variant_id) === PLAY_VARIANT_ID) qty += (li.quantity || 0);
    }
    if (qty <= 0) {
      LAST_WEBHOOK = { at: new Date().toISOString(), shop, ok: false, note: "no_matching_variant", qty: 0, email, customerId };
      return res.status(200).send("no plays");
    }

    let customerGid = customerId ? `gid://shopify/Customer/${customerId}` : null;
    if (!customerGid && email) {
      customerGid = await findCustomerIdByEmail(shop, accessToken, email);
    }
    if (!customerGid) {
      LAST_WEBHOOK = { at: new Date().toISOString(), shop, ok: false, note: "no_customer_id_or_email_match", qty, email, customerId };
      return res.status(200).send("no customer");
    }

    const plays = await getCustomerPlays(shop, accessToken, customerGid);
    await setCustomerPlays(shop, accessToken, customerGid, plays + qty);
    LAST_WEBHOOK = { at: new Date().toISOString(), shop, ok: true, note: "credited", qty, email, customerId };

    return res.status(200).send("ok");
  } catch {
    try {
      LAST_WEBHOOK = { at: new Date().toISOString(), shop: String(req.get("X-Shopify-Shop-Domain") || ALLOWED_SHOP || ""), ok: false, note: "exception", qty: 0, email: null, customerId: null };
    } catch {}
    return res.status(200).send("ok");
  }
});

// JSON parsing for proxy endpoints
app.use(express.json());

async function handleProxyStatus(req, res) {
  try {
    if (!verifyAppProxy(req.query)) return res.status(401).json({ ok: false, error: "bad_signature" });
    const shop = String(req.query.shop || "");
    if (ALLOWED_SHOP && shop !== ALLOWED_SHOP) return res.status(403).json({ ok: false, error: "shop_not_allowed" });

    const accessToken = getToken(shop);
    if (!accessToken) return res.json({ ok: false, error: "not_installed", plays: 0 });

    const cid = req.query.logged_in_customer_id;
    if (!cid) return res.json({ ok: true, plays: 0, loggedIn: false });

    const customerGid = `gid://shopify/Customer/${cid}`;
    const plays = await getCustomerPlays(shop, accessToken, customerGid);
    return res.json({ ok: true, plays, loggedIn: true });
  } catch {
    return res.status(500).json({ ok: false, error: "status_failed" });
  }
}

async function handleProxyConsume(req, res) {
  try {
    if (!verifyAppProxy(req.query)) return res.status(401).json({ ok: false, error: "bad_signature" });
    const shop = String(req.query.shop || "");
    if (ALLOWED_SHOP && shop !== ALLOWED_SHOP) return res.status(403).json({ ok: false, error: "shop_not_allowed" });

    const accessToken = getToken(shop);
    if (!accessToken) return res.json({ ok: false, error: "not_installed" });

    const cid = req.query.logged_in_customer_id;
    if (!cid) return res.status(401).json({ ok: false, error: "not_logged_in" });

    const customerGid = `gid://shopify/Customer/${cid}`;
    const plays = await getCustomerPlays(shop, accessToken, customerGid);
    if (plays <= 0) return res.json({ ok: false, error: "no_plays" });

    await setCustomerPlays(shop, accessToken, customerGid, plays - 1);
    return res.json({ ok: true, plays: plays - 1 });
  } catch {
    return res.status(500).json({ ok: false, error: "consume_failed" });
  }
}

// Both proxy paths supported
app.get("/apps/casino/status", handleProxyStatus);
app.post("/apps/casino/consume", handleProxyConsume);
app.get("/proxy/casino/status", handleProxyStatus);
app.post("/proxy/casino/consume", handleProxyConsume);

app.listen(PORT, () => console.log("casino-backend on", PORT));
