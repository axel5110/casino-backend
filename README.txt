DEPLOIEMENT RENDER (repo axel5110/casino-backend)

1) Mets ces fichiers à la racine du repo:
- package.json
- server.js

2) Render (Web Service):
- Root Directory: (vide)
- Build: npm install
- Start: npm start

3) Variables Render:
ALLOWED_SHOP, APP_URL, CLIENT_ID, CLIENT_SECRET, PROXY_SECRET, PLAY_VARIANT_ID, SCOPES

4) OAuth (1 fois):
https://casino-jouetmalins.onrender.com/oauth/start?shop=jouetmalins.myshopify.com

Tests:
/health
/admin/status?shop=jouetmalins.myshopify.com
