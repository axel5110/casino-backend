import express from "express";
import crypto from "crypto";

const app = express();

const {
  SHOP_MYSHOPIFY_DOMAIN,     // ex: jouetmalins.myshopify.com
  CLIENT_ID,                // Dev Dashboard client id
  CLIENT_SECRET,            // Dev Dashboard client secret (shpss_...)
  PROXY_SECRET,             // même valeur que CLIENT_SECRET
  PLAY_COST = "1",
  WIN_ODDS = "10000000",
  JACKPOT_ADD_CENTS = "10"
} = process.env;

// -------- Render friendly --------
app.get("/", (req, res) => res.status(200).send("Casino backend OK ✅"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

// -------- App Proxy signature verify --------
function verifyAppProxy(req) {
  const q = { ...req.query };
  const signature = q.signature;
  delete q.signature;

  const sorted = Object.keys(q)
    .sort()
    .map(k => `${k}=${Array.isArray(q[k]) ? q[k].join(",") : q[k]}`)
    .join("");

  const digest = crypto.createHmac("sha256", PROXY_SECRET).update(sorted).digest("hex");
  return digest === signature;
}

function gid(type, id) { return `gid://shopify/${type}/${id}`; }
function customerIdFromProxy(req) {
  const cid = req.query.logged_in_customer_id;
  if (!cid) return null;
  return gid("Customer", cid);
}
function sendJson(res, obj) {
  res.set("Content-Type", "application/json");
  res.send(JSON.stringify(obj));
}

// -------- AUTO TOKEN (client_credentials) --------
let cachedToken = null;
let tokenExpiresAt = 0;

async function fetchAdminToken() {
  if (!SHOP_MYSHOPIFY_DOMAIN || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing SHOP_MYSHOPIFY_DOMAIN / CLIENT_ID / CLIENT_SECRET env vars");
  }

  const url = `https://${SHOP_MYSHOPIFY_DOMAIN}/admin/oauth/access_token`;
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", CLIENT_ID);
  body.set("client_secret", CLIENT_SECRET);

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Token fetch failed (${r.status}): ${t}`);
  }

  const json = await r.json();
  cachedToken = json.access_token;

  const expiresIn = Number(json.expires_in || 3600);
  tokenExpiresAt = Date.now() + (expiresIn - 120) * 1000; // -2min safety
  return cachedToken;
}

async function getAdminToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  return await fetchAdminToken();
}

// -------- Shopify GraphQL --------
async function shopifyGraphQL(query, variables) {
  const token = await getAdminToken();
  const res = await fetch(`https://${SHOP_MYSHOPIFY_DOMAIN}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });

  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// -------- Business logic --------
async function getCustomerCredits(customerId) {
  const q = `query($id: ID!){
    customer(id:$id){
      metafield(namespace:"casino", key:"credits"){ value }
    }
  }`;
  const data = await shopifyGraphQL(q, { id: customerId });
  return parseInt(data.customer?.metafield?.value ?? "0", 10) || 0;
}

async function setCustomerCredits(customerId, credits) {
  const m = `mutation($input: MetafieldsSetInput!){
    metafieldsSet(metafields: [$input]){ userErrors{ message } }
  }`;
  const input = {
    ownerId: customerId,
    namespace: "casino",
    key: "credits",
    type: "number_integer",
    value: String(Math.max(0, credits | 0))
  };
  const data = await shopifyGraphQL(m, { input });
  const err = data.metafieldsSet.userErrors?.[0];
  if (err) throw new Error(err.message);
}

async function getShopState() {
  const q = `query{
    shop{
      id
      jackpot: metafield(namespace:"casino", key:"jackpot_cents"){ value }
      iphone: metafield(namespace:"casino", key:"iphone_variant_id"){ value }
      last: metafield(namespace:"casino", key:"last_winner"){ value }
    }
  }`;
  const data = await shopifyGraphQL(q, {});
  return {
    shopId: data.shop.id,
    jackpot: parseInt(data.shop.jackpot?.value ?? "0", 10) || 0,
    iphoneVariantId: (data.shop.iphone?.value ?? "").trim(),
    lastWinner: (data.shop.last?.value ?? "") || "—"
  };
}

async function setShopMetafield(shopId, key, type, value) {
  const m = `mutation($input: MetafieldsSetInput!){
    metafieldsSet(metafields: [$input]){ userErrors{ message } }
  }`;
  const input = { ownerId: shopId, namespace: "casino", key, type, value: String(value) };
  const data = await shopifyGraphQL(m, { input });
  const err = data.metafieldsSet.userErrors?.[0];
  if (err) throw new Error(err.message);
}

async function createDraftOrderFreeIphone(customerId, variantGid) {
  const m = `mutation($input: DraftOrderInput!){
    draftOrderCreate(input:$input){
      draftOrder{ invoiceUrl }
      userErrors{ message }
    }
  }`;
  const input = {
    customerId,
    lineItems: [{ variantId: variantGid, quantity: 1 }],
    appliedDiscount: { description: "JACKPOT", value: 100, valueType: "PERCENTAGE" },
    note: "Jackpot iPhone 17 Pro Max"
  };
  const data = await shopifyGraphQL(m, { input });
  const err = data.draftOrderCreate.userErrors?.[0];
  if (err) throw new Error(err.message);
  return data.draftOrderCreate.draftOrder.invoiceUrl;
}

// -------- App Proxy endpoints --------
app.get("/proxy/casino/balance", async (req, res) => {
  try {
    if (!verifyAppProxy(req)) return res.status(401).send("Invalid signature");

    const st = await getShopState();
    const customerId = customerIdFromProxy(req);

    if (!customerId) {
      return sendJson(res, { ok: true, loggedIn: false, credits: 0, jackpotCents: st.jackpot, lastWinner: st.lastWinner });
    }

    const credits = await getCustomerCredits(customerId);
    return sendJson(res, { ok: true, loggedIn: true, credits, jackpotCents: st.jackpot, lastWinner: st.lastWinner });
  } catch (e) {
    return sendJson(res, { ok: false, error: "SERVER_ERROR" });
  }
});

app.get("/proxy/casino/play", async (req, res) => {
  try {
    if (!verifyAppProxy(req)) return res.status(401).send("Invalid signature");

    const customerId = customerIdFromProxy(req);
    if (!customerId) return sendJson(res, { ok: false, error: "NOT_LOGGED_IN" });

    const cost = parseInt(PLAY_COST, 10) || 1;
    const odds = parseInt(WIN_ODDS, 10) || 10000000;
    const addCents = parseInt(JACKPOT_ADD_CENTS, 10) || 0;

    const st = await getShopState();
    if (!st.iphoneVariantId) return sendJson(res, { ok: false, error: "IPHONE_VARIANT_ID_MISSING" });

    const credits = await getCustomerCredits(customerId);
    if (credits < cost) {
      return sendJson(res, { ok: false, error: "NO_CREDITS", credits, jackpotCents: st.jackpot, lastWinner: st.lastWinner });
    }

    await setCustomerCredits(customerId, credits - cost);

    const jackpotCents = st.jackpot + addCents;
    await setShopMetafield(st.shopId, "jackpot_cents", "number_integer", String(jackpotCents));

    const win = (crypto.randomInt(1, odds + 1) === 1);

    if (!win) {
      return sendJson(res, { ok: true, win: false, credits: credits - cost, jackpotCents, lastWinner: st.lastWinner });
    }

    const claimUrl = await createDraftOrderFreeIphone(customerId, gid("ProductVariant", st.iphoneVariantId));

    await setShopMetafield(st.shopId, "jackpot_cents", "number_integer", "0");
    const winnerLabel = `Gagnant - ${new Date().toISOString().slice(0, 10)}`;
    await setShopMetafield(st.shopId, "last_winner", "single_line_text_field", winnerLabel);

    return sendJson(res, { ok: true, win: true, credits: credits - cost, jackpotCents: 0, lastWinner: winnerLabel, claimUrl });
  } catch (e) {
    return sendJson(res, { ok: false, error: "SERVER_ERROR" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Casino proxy running on :" + PORT));
