import express from "express";
import crypto from "crypto";

const app = express();
// Page simple pour éviter "Not found" quand Shopify ouvre l'app
app.get("/", (req, res) => {
  res.status(200).send("Casino backend OK ✅");
});

// Healthcheck pratique (Render / test)
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

const {
  SHOP_DOMAIN,
  ADMIN_TOKEN,
  PROXY_SECRET,
  PLAY_COST = "1",
  WIN_ODDS = "10000",
  JACKPOT_ADD_CENTS = "10"
} = process.env;

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

async function shopifyGraphQL(query, variables) {
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

function sendJson(res, obj) {
  res.set("Content-Type", "application/json");
  res.send(JSON.stringify(obj));
}

function gid(type, id){ return `gid://shopify/${type}/${id}`; }

function customerIdFromProxy(req) {
  const cid = req.query.logged_in_customer_id;
  if (!cid) return null;
  return gid("Customer", cid);
}

async function getCustomerCredits(customerId) {
  const q = `query($id: ID!){ customer(id:$id){ metafield(namespace:"casino", key:"credits"){ value } } }`;
  const data = await shopifyGraphQL(q, { id: customerId });
  const v = data.customer?.metafield?.value ?? "0";
  return parseInt(v, 10) || 0;
}

async function setCustomerCredits(customerId, credits) {
  const m = `mutation($input: MetafieldsSetInput!){ metafieldsSet(metafields: [$input]){ userErrors{ message } } }`;
  const input = {
    ownerId: customerId,
    namespace: "casino",
    key: "credits",
    type: "number_integer",
    value: String(Math.max(0, credits|0))
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
  const m = `mutation($input: MetafieldsSetInput!){ metafieldsSet(metafields: [$input]){ userErrors{ message } } }`;
  const input = { ownerId: shopId, namespace:"casino", key, type, value: String(value) };
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

// App Proxy endpoints
app.get("/proxy/casino/balance", async (req, res) => {
  if (!verifyAppProxy(req)) return res.status(401).send("Invalid signature");

  const st = await getShopState();
  const customerId = customerIdFromProxy(req);

  if (!customerId) {
    return sendJson(res, { ok:true, loggedIn:false, credits:0, jackpotCents: st.jackpot, lastWinner: st.lastWinner });
  }

  const credits = await getCustomerCredits(customerId);
  return sendJson(res, { ok:true, loggedIn:true, credits, jackpotCents: st.jackpot, lastWinner: st.lastWinner });
});

app.get("/proxy/casino/play", async (req, res) => {
  if (!verifyAppProxy(req)) return res.status(401).send("Invalid signature");

  const customerId = customerIdFromProxy(req);
  if (!customerId) return sendJson(res, { ok:false, error:"NOT_LOGGED_IN" });

  const cost = parseInt(PLAY_COST, 10) || 1;
  const odds = parseInt(WIN_ODDS, 10) || 10000;
  const addCents = parseInt(JACKPOT_ADD_CENTS, 10) || 0;

  const st = await getShopState();
  if (!st.iphoneVariantId) return sendJson(res, { ok:false, error:"IPHONE_VARIANT_ID_MISSING" });

  const credits = await getCustomerCredits(customerId);
  if (credits < cost) return sendJson(res, { ok:false, error:"NO_CREDITS", credits, jackpotCents: st.jackpot, lastWinner: st.lastWinner });

  // Debit
  await setCustomerCredits(customerId, credits - cost);

  // Jackpot +
  const jackpotCents = st.jackpot + addCents;
  await setShopMetafield(st.shopId, "jackpot_cents", "number_integer", String(jackpotCents));

  // 1 chance sur odds
  const win = (crypto.randomInt(1, odds + 1) === 1);

  if (!win) {
    return sendJson(res, { ok:true, win:false, credits: credits - cost, jackpotCents, lastWinner: st.lastWinner });
  }

  const claimUrl = await createDraftOrderFreeIphone(customerId, gid("ProductVariant", st.iphoneVariantId));

  // Reset jackpot + last winner
  await setShopMetafield(st.shopId, "jackpot_cents", "number_integer", "0");
  await setShopMetafield(st.shopId, "last_winner", "single_line_text_field", `Gagnant - ${new Date().toISOString().slice(0,10)}`);

  return sendJson(res, { ok:true, win:true, credits: credits - cost, jackpotCents:0, lastWinner:`Gagnant - ${new Date().toISOString().slice(0,10)}`, claimUrl });
});

app.listen(3000, ()=> console.log("Casino proxy running on :3000"));
