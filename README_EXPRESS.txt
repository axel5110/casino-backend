MODE EXPRESS (TEST) — Désactiver la vérification HMAC webhook

1) Sur Render, ajoute:
   DISABLE_HMAC=true

2) Vérifie que ALLOWED_SHOP=mf1uqz-ab.myshopify.com (important)
   Ainsi seuls les webhooks de ce shop passent.

3) Fais un achat test puis ouvre:
   /debug/lastwebhook

⚠️ IMPORTANT: Ce mode est moins sécurisé. À désactiver dès que possible.
