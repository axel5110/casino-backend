Cette version met à jour /debug/lastwebhook dès que Shopify touche /webhooks/orders_paid :
- note:"hit" -> reçu
- note:"bad_hmac" -> reçu mais secret PROXY_SECRET incorrect
- note:"no_matching_variant" -> reçu mais mauvais variant
- note:"credited" -> crédit OK
