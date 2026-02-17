Fix "shop not allowed":
- Normalisation (trim + lowercase) de ALLOWED_SHOP et du paramètre shop
- Ajout /debug/env pour vérifier les variables vues par Render

Après déploiement, ouvre:
/debug/env
Puis relance OAuth:
/oauth/start?shop=jouetmalins.myshopify.com
