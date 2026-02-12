# Casino iPhone 17 Pro Max — OAuth automatique (1/10000000)

Ce backend génère automatiquement un token Admin API via `grant_type=client_credentials`
(Dev Dashboard: client id / client secret) et le renouvelle automatiquement.

## Variables Render
- SHOP_MYSHOPIFY_DOMAIN = jouetmalins.myshopify.com
- CLIENT_ID = client id (Dev Dashboard)
- CLIENT_SECRET = client secret (shpss_...)
- PROXY_SECRET = même valeur que CLIENT_SECRET
- PLAY_COST=1
- WIN_ODDS=10000000
- JACKPOT_ADD_CENTS=10

## App Proxy (Dev Dashboard)
- Préfixe : apps
- Sous-chemin : casino
- URL du proxy : https://casino-jouetmalins.onrender.com/proxy/casino

## Metafields
Shop:
- casino.jackpot_cents (number_integer)
- casino.last_winner (single_line_text_field)
- casino.iphone_variant_id (single_line_text_field) -> 52775374225751
Customer:
- casino.credits (number_integer)

## Test
- https://casino-jouetmalins.onrender.com/health -> {"ok": true}
- Jouer depuis le site (connecté) -> /apps/casino/balance et /apps/casino/play
