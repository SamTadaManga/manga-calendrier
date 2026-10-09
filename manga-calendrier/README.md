# Calendrier manga et anime

Site statique gratuit : calendrier des sorties manga (France) et des épisodes d'anime de la semaine, avec des articles générés chaque jour à partir des données. Aucune dépendance à installer.

## Comment ça marche

```
Google Sheets (tes sorties manga) ─┐
                                   ├─> GitHub Actions (chaque jour) ─> articles du jour ─> GitHub ─> Cloudflare Pages ─> site en ligne
API AniList (épisodes d'anime) ────┘
```

- `data/manga.csv` : tes sorties manga saisies à la main (copie de ton Google Sheets). **Elles priment toujours.**
- `data/manga-auto.csv` : sorties collectées automatiquement chaque jour sur les plannings de Glénat, Kana, Pika et Ki-oon (statut « Annoncé »). Ne le modifie pas : il est réécrit. Pour corriger une ligne, ajoute-la dans ton Google Sheets (même ISBN, ou même série + tome) : la tienne remplace l'automatique.
- `data/anime.json` : le programme anime des 8 prochains jours, mis à jour chaque jour.
- `content/articles/` : **tes** articles (fichiers `.md`). Voir `_modele-article.md`.
- `content/auto/` : les articles générés automatiquement. Ne les modifie pas : ils sont réécrits à chaque mise à jour.
- `site.config.json` : nom du site, adresse, mentions légales.
- `scripts/` : le code (récupération des données, articles du jour, construction du site).

## Mise en ligne (une seule fois)

1. **Cloudflare Pages** : dashboard Cloudflare → *Workers & Pages* → *Create* → onglet *Pages* → *Connect to Git* → choisis ce dépôt.
   - Framework preset : *None*
   - Build command : `npm run build`
   - Build output directory : `dist`
2. Une fois le site créé, note son adresse (`https://xxx.pages.dev`) et mets-la dans `site.config.json` (`siteUrl`). Le site refait une construction tout seul.
3. Complète les **mentions légales** dans `site.config.json` (nom, e-mail, directeur de publication). Vérifie aussi l'adresse de l'hébergeur sur le site de Cloudflare.
4. Onglet **Actions** de ce dépôt → *Mise à jour quotidienne* → *Run workflow* : cela remplit le calendrier anime et crée les premiers articles.

## Utilisation au quotidien

- **Sorties manga** : remplis le Google Sheets (modèle fourni). Pour une mise à jour automatique :
  1. Google Sheets → *Fichier* → *Partager* → *Publier sur le Web* → onglet *Sorties*, format *Valeurs séparées par des virgules (.csv)* → *Publier*, puis copie le lien.
  2. GitHub → *Settings* → *Secrets and variables* → *Actions* → *New repository secret* : nom `MANGA_CSV_URL`, valeur = le lien.
  Sans cela, remplace à la main le fichier `data/manga.csv` (bouton *Add file* → *Upload files*).
- **Articles** : *Add file* → *Create new file* → nom `content/articles/mon-article.md`, en copiant le modèle. `draft: false` publie ; une date future programme la publication.
- **Brouillons assistés par IA** : colle les lignes du jour et le prompt du classeur dans ton assistant, relis, puis crée le fichier.

## Articles automatiques

Chaque jour : épisodes d'anime du jour, sorties manga du jour, et le lundi les sorties de la semaine. Ils sont rédigés par modèle à partir des données, sans IA. Pour les relire avant publication, mets `"autoPublish": false` dans `site.config.json` (ils restent alors en brouillon).

## Collecte automatique des éditeurs

`scripts/collect-manga.mjs` lit chaque jour (≈ 15 requêtes, 2 s d'intervalle, robots.txt respecté) le mois en cours et les 2 suivants sur : le planning Glénat Manga, le planning Kana, le planning Pika, et l'API du planning de Ki-oon. Il n'enregistre que des faits (titre, tome, date, ISBN, prix si disponible, lien) : aucune image ni texte éditorial.
- Si un éditeur change sa page et que plus rien n'est trouvé, ses anciennes lignes sont conservées et la mise à jour continue (le journal de l'onglet *Actions* l'indique : « 0 trouvée »). Il faudra alors corriger le fichier `scripts/collectors.mjs`.
- Les dates des plannings d'éditeurs peuvent bouger : mentionne-les comme « annoncées ». Vérifie les conditions d'utilisation de chaque site si ton site devient commercial.
- Test hors ligne : `npm test`.

## Changements de date et Mon planning

- `data/changes.json` : mémoire des sorties déjà vues. Chaque nuit, la collecte la compare aux plannings des éditeurs et note les reports, avancées, nouvelles annonces et retraits (un tome n'est dit « retiré » qu'après 3 nuits d'absence). Le premier passage ne signale rien. Ne modifie pas ce fichier à la main. Page publique : `/changements/`, et un article automatique est créé les jours où quelque chose bouge.
- `/mon-planning/` : chaque lecteur suit ses séries ; la liste reste dans son navigateur (`scripts/suivi.js`).

## Couvertures et mode privé

- `"showCovers": true` dans `site.config.json` affiche les couvertures. Elles ne sont **pas copiées** : le navigateur les charge depuis les serveurs des éditeurs. Passe-le à `false` (ou supprime la ligne) pour les retirer instantanément.
- `"launched": false` rend le site invisible pour Google (noindex, robots.txt fermé, pas de sitemap). Passe-le à `true` seulement après l'autorisation des éditeurs et la vérification des mentions légales.

## Limites à connaître

- Les épisodes d'anime sont ceux de la **diffusion japonaise** (heures converties à Paris). La disponibilité en France dépend des plateformes.
- AniList : gratuit en usage non commercial, et en usage commercial sous 150 $ de revenu par mois. Au-delà, il faut une licence (voir les conditions d'utilisation d'AniList). Ne stocke pas de données en masse.
- Visuels : aucune image n'est affichée. N'ajoute que des visuels que les éditeurs t'autorisent à utiliser.
- Si la mise à jour quotidienne s'arrête (GitHub peut désactiver les tâches planifiées d'un dépôt inactif), réactive-la dans l'onglet *Actions*.

## Dépannage

- Croix rouge dans *Actions* : ouvre l'exécution pour lire le message. Le plus courant : le lien `MANGA_CSV_URL` n'est plus valide, ou AniList est momentanément indisponible. Relance avec *Run workflow*.
- Le site n'a pas changé : vérifie dans Cloudflare Pages que le dernier déploiement a réussi.

## Tester sur ton ordinateur (facultatif)

Avec Node 20 ou plus : `npm test` lance les tests, `npm run build` construit le site dans `dist/`.

## Nouveautés depuis ta dernière visite, RSS, installation mobile
- Page d'accueil : un bandeau rose « Nouveau depuis ta dernière visite » apparaît quand des changements de planning ou des articles sont parus depuis la visite précédente (la date de visite est gardée dans le navigateur, rien n'est envoyé). « Mis à jour il y a… » indique la fraîcheur des données.
- `/feed.xml` : flux RSS des articles (généré dès que `siteUrl` est renseigné).
- `manifest.webmanifest` + `sw.js` + icônes : le site peut s'installer sur l'écran d'accueil du téléphone et reste consultable hors ligne (dernière version vue).
