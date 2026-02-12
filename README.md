# Casino iPhone 17 Pro Max (App Proxy)

Ce dossier contient un backend Express pour Shopify App Proxy.
Domaine boutique: jouetmalins.com
Odds: 1/10000

## 1) Créer une Custom App Shopify
- Active Admin API
- Récupère:
  - ADMIN_TOKEN
  - API_SECRET_KEY (utilisé comme PROXY_SECRET)

## 2) Configurer App Proxy
- Prefix: apps
- Subpath: casino
- Proxy URL: https://TON_BACKEND/proxy/casino

## 3) Metafields Shopify à créer
Shop:
- casino.jackpot_cents (number_integer)
- casino.last_winner (single_line_text_field)
- casino.iphone_variant_id (single_line_text_field) -> mettre l'ID numérique de variante
Customer:
- casino.credits (number_integer)

## 4) Lancer en local
npm i
node index.js

## 5) Déployer
Vercel/Render/Fly/VM… (mettre les variables d'env du fichier .env.example)
