MODE PAYANT — 1 partie = 1€ (Variant 52772073636183)

✅ Tu n'as que "ID client + Secret" (Dev Dashboard) -> on utilise OAuth automatique.

1) Metafield client
Shopify Admin -> Paramètres -> Données personnalisées -> Customers -> Ajouter une définition
- Namespace : casino
- Key : plays
- Type : Nombre -> entier

2) Déployer sur Render
- Push casino-backend/ sur GitHub
- Render -> New Web Service
- Env Vars :
  CLIENT_ID= (ton ID client)
  CLIENT_SECRET= (ton Secret)
  PROXY_SECRET= (même valeur que CLIENT_SECRET)
  APP_URL= https://TONSERVICE.onrender.com
  ALLOWED_SHOP= jouetmalins.myshopify.com
  PLAY_VARIANT_ID= 52772073636183
  SCOPES= read_customers,write_customers,read_orders,write_orders

3) Dans ton app (Dev Dashboard)
- Redirect URL : https://TONSERVICE.onrender.com/auth/callback (ou /oauth/callback)
- Scopes Admin API : read_customers,write_customers,read_orders,write_orders

4) Lancer OAuth (1 fois)
Ouvre :
https://TONSERVICE.onrender.com/oauth/start?shop=jouetmalins.myshopify.com
-> tu acceptes -> le token admin est sauvegardé dans tokens.json

5) App Proxy (Shopify Admin -> Apps -> ton app -> App proxy)
- Préfixe : apps
- Sous-chemin : casino
- URL : https://TONSERVICE.onrender.com/proxy/casino (dans ta config)

6) Webhook (Orders paid)
Shopify Admin -> ton app -> Webhooks
- Event : Orders paid
- URL : https://TONSERVICE.onrender.com/webhooks/orders_paid
- Format : JSON

7) Test
- Connecte-toi sur le site
- Achète 1 partie (1€)
- Va sur /pages/gagner-des-cadeaux : le compteur doit augmenter
- Clique "Démarrer" : consomme 1 partie


✅ COMPAT AJOUTÉE : le backend accepte aussi /oauth/callback et /proxy/casino si tu changes plus tard.
