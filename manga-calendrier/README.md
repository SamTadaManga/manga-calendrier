# Prochain Tome : calendrier manga et anime

Site statique gratuit : calendrier des sorties manga (France) et des épisodes d'anime de la semaine, avec des articles générés chaque jour à partir des données. Aucune dépendance à installer.

## Comment ça marche

```
Google Sheets (tes sorties manga) ─┐
                                   ├─> GitHub Actions (chaque jour) ─> articles du jour ─> GitHub ─> Cloudflare Pages ─> site en ligne
API AniList (épisodes d'anime) ────┘
```

- `data/manga.csv` : tes sorties manga saisies à la main (copie de ton Google Sheets). **Elles priment toujours.**
- `data/manga-auto.csv` : sorties collectées automatiquement chaque jour sur les plannings de Glénat, Kana, Pika, Ki-oon, Akata, Delcourt (dont Tonkam), Soleil Kazé, Kurokawa, Meian, Mangetsu et Panini Manga (statut « Annoncé »). Ne le modifie pas : il est réécrit. Pour corriger une ligne, ajoute-la dans ton Google Sheets (même ISBN, ou même série + tome) : la tienne remplace l'automatique.
- `data/anime.json` : le programme anime des 8 prochains jours, mis à jour chaque jour.
- `content/articles/` : **tes** articles (fichiers `.md`). Voir `_modele-article.md`.
- `content/auto/` : les articles générés automatiquement. Ne les modifie pas : ils sont réécrits à chaque mise à jour.
- `site.config.json` : nom du site, adresse, mentions légales.
- `scripts/` : le code (récupération des données, articles du jour, construction du site).

## Mise en ligne

Le site tourne sur **Cloudflare Workers** (fichiers statiques + un petit Worker pour le compteur de clics). Le déploiement est fait par GitHub Actions (`.github/workflows/deploy.yml`, commande `wrangler deploy`), pas par Cloudflare Builds (désactivé).

1. Secrets GitHub nécessaires (*Settings → Secrets and variables → Actions*) : `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Facultatifs : `MANGA_CSV_URL`, `GOOGLE_BOOKS_API_KEY`, `DEEPL_API_KEY`, `ANTHROPIC_API_KEY`, `MYMEMORY_EMAIL`.
2. Le domaine (`siteUrl` dans `site.config.json`) est rattaché au Worker dans Cloudflare.
3. Complète les **mentions légales** dans `site.config.json`.
4. Onglet **Actions** → *Mise à jour quotidienne* → *Run workflow* pour remplir les données. Le déploiement suit tout seul à chaque mise à jour et à chaque fusion sur `main`.

## Sécurité, sauvegarde, alertes

- **Où sont les données** : tout est dans ce dépôt (`data/`, `content/`, `site.config.json`), avec l'historique git. Revenir en arrière : *Revert* sur le commit fautif, ou *Actions → Run workflow*.
- **Sauvegarde** : le workflow *Sauvegarde hebdomadaire* (dimanche) archive `data/`, `content/` et la config ; le fichier se télécharge 90 jours dans *Actions → l'exécution → Artifacts*.
- **Alertes** : si la mise à jour, le déploiement ou la sauvegarde échoue, un ticket « Alerte : … » s'ouvre dans l'onglet *Issues* (GitHub t'envoie un e-mail). Un échec répété complète le même ticket ; ferme-le quand c'est réglé. La page `/etat/` du site montre la fraîcheur de chaque source.
- **Secrets** : ne les colle jamais dans un fichier, une issue ou une conversation. Si un jeton Cloudflare a fuité : Cloudflare → *My Profile → API Tokens* → *Roll*, puis mets le nouveau dans le secret GitHub. Le rapport de clics (`/api/clics?cle=…`) est protégé par le secret `STATS_KEY` du Worker.
- **Données personnelles** : la collection, les séries suivies et les statuts restent dans le navigateur des visiteurs (aucun compte, rien n'est envoyé). Le site ne dépose pas de cookie de suivi.

## Statistiques de visite (tableau de bord privé)
- **Adresse** : https://prochaintome.fr/api/tableau — la page demande la clé `STATS_KEY` (la même que pour le rapport de clics) et la garde dans le navigateur. Fonctionne sur ordinateur et téléphone.
- **Chiffres** : visiteurs uniques, visites, pages vues, durée moyenne de visite, pages par visite, rebond, visites engagées, nouveaux visiteurs, évolution jour par jour (avec la période précédente), heures et jours de visite, pages les plus vues (temps moyen, part lue, chargement), rubriques, pages d'entrée et de sortie, canaux, sites référents, campagnes (`?utm_source=`), pays, appareils, navigateurs, systèmes, recherches tapées sur le site, pages introuvables, clics d'achat, visiteurs en ce moment.
- **Fonctionnement** : `scripts/mesure.js` envoie la page vue puis le temps passé (onglet visible) à `/api/vu` ; le Worker les range dans une base SQLite (Durable Object `Audience`, offre gratuite Cloudflare), voir `worker/audience.js`. Aucun cookie, l'adresse IP n'est jamais stockée (empreinte du jour avec une clé détruite chaque nuit), données gardées 13 mois.
- **Tes propres visites** : ouvrir le tableau de bord exclut ce navigateur des statistiques. Sur un autre appareil, ouvre une fois https://prochaintome.fr/?mesure=non (et `?mesure=oui` pour annuler).
- Cloudflare Web Analytics reste actif en parallèle (utile pour les Core Web Vitals).

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

`scripts/collect-manga.mjs` lit chaque jour (≈ 25 requêtes, 2 s d'intervalle, robots.txt respecté) le mois en cours et les 2 suivants sur : le planning Glénat Manga, le planning Kana, le planning Pika, l'API du planning de Ki-oon, le planning Akata, les pages « à paraître » mangas de Delcourt et de Soleil (même gabarit ; seules les fiches /mangas/ sont gardées) puis, pour Kazé, la boutique kazemanga.fr (prix, couverture et lien retrouvés par ISBN). Kazé, Kurokawa, Meian et Mangetsu n'ont pas de planning lisible (site en erreur, JavaScript, page vide, catalogue sans dates) : on lit leur page éditeur sur BDbase (robots.txt autorisé) puis la fiche de chaque sortie à paraître (date, ISBN, éditeur), mémorisée une semaine dans `data/bdbase-fiches.json`. Panini, lui, renvoie les robots vers une file d'attente (Queue-it) que nous ne contournons pas : ses mangas sont lus sur la page « Panini Comics » de BDbase, fiches /manga/ uniquement. Pour ces éditeurs (sauf Kazé quand le tome est dans la boutique), le lien de la sortie pointe vers la fiche BDbase. Il n'enregistre que des faits (titre, tome, date, ISBN, prix si disponible, lien) : aucune image ni texte éditorial.
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

## Vues de la page Manga
Boutons « Par jour / Par éditeur / Par série » au-dessus de la liste. Le choix est mémorisé dans le navigateur ; la recherche et les filtres d'éditeur fonctionnent dans les trois vues.

## Pages pour le référencement
Générées automatiquement à chaque build : `/sorties-manga/` (index) et `/sorties-manga/novembre-2026/` (une page par mois), `/series/` (index A à Z avec recherche) et `/serie/<nom>/` (« Prochain tome de … », avec date du prochain tome, tomes à venir et déjà parus). Toutes sont dans le sitemap et liées depuis les listes de sorties.

## Ma collection
La page `/ma-collection/` (onglet du menu) affiche tes séries avec statistiques, recherche, tri, filtres (manquants, à jour, précommandés, à acheter, à lire), progression par série et export/import CSV (`scripts/collection.js`). Les statuts par tome sont : À acheter, Précommandé, À lire, Lu. Mon planning reste accessible dans le pied de page (agenda, budget du mois, sauvegarde complète).

Bouton « Je l'ai » sur chaque tome numéroté, et « Je possède les tomes 1 à N » sur chaque page de série et dans Mon planning. Mon planning affiche les tomes déjà parus qu'il reste à acheter (pour les séries dont la collection est renseignée) et exclut les tomes possédés du budget du mois. Tout est gardé dans le navigateur (`mc-own`) ; une sauvegarde texte permet de transférer la collection d'un appareil à l'autre.

## Badges « nouveautés »
- « ★ Nouvelle série » : tome 1 annoncé dans les 14 derniers jours ou à venir (les rééditions, collectors, deluxe, intégrales, coffrets, artbooks sont exclus).
- « ★ Épisode 1 » : premier épisode d'un anime (hors films).
- Page `/nouveautes/` et section « Nouvelles séries à découvrir » sur l'accueil.

## Où regarder (streaming)
`fetch-anime.mjs` garde les liens de streaming fournis par AniList pour quelques plateformes reconnues (Crunchyroll, ADN, Netflix, Prime Video, Disney+, Wakanim). Ils apparaissent comme petits boutons sur les cartes anime. AniList ne distingue pas les pays : ces liens ne garantissent pas la disponibilité en France.
La page Anime propose aussi un filtre par plateforme (boutons colorés au-dessus de la liste, cumulables avec la recherche par titre).

## Recherche globale
Touche `/` ou loupe dans l'en-tête : séries manga, animes de la semaine et articles. L'index est `data/search.json`, généré à chaque build ; le script est `recherche.js`.

## Agenda par éditeur, signalement d'erreur, thème
- `/agenda/<editeur>.ics` : un fichier d'agenda par éditeur (liens sur la page Manga).
- « Signaler une erreur » (pied de page et pages série) : utilise `legal.contactEmail` si c'est une vraie adresse (le lien prérempli contient la page concernée). Tu peux aussi mettre `"reportUrl": "https://…"` (formulaire, page GitHub Issues) dans `site.config.json`, qui a la priorité. Sans l'un ni l'autre, le lien n'apparaît pas.
- Bouton clair/sombre dans l'en-tête : le choix est gardé dans le navigateur, sinon on suit le réglage de l'appareil.
- Mon planning : quand aucune série n'est suivie, des suggestions s'affichent.

## Dossiers éditoriaux automatiques
`scripts/dossiers-auto.mjs` (lancé chaque nuit) écrit, pour le mois en cours et le suivant, des dossiers factuels sans IA dans `content/auto/` : nouvelles séries (genres, auteur, résumé de l'éditeur), éditions spéciales, sorties par éditeur (dès 4 sorties) et sélection tournante de séries terminées. Datés du 1er du mois, ils apparaissent dans la section « Dossiers du mois » de `/articles/`. Ne les modifie pas à la main : ils sont réécrits quand les données changent.

## Articles récapitulatifs automatiques
En plus des articles du jour : le lundi, « Manga : les sorties de la semaine » (avec les nouvelles séries et le rappel des changements de la semaine passée) et « Anime : la semaine » (premiers épisodes, séries les plus suivies) ; le 1er du mois, « Manga : les sorties d'<mois> » (tomes par éditeur, nouvelles séries, lien vers la page du mois).

## Image de partage (Open Graph)
Quand un lien est collé sur Discord, X, WhatsApp, etc., l'aperçu utilise `og.png` (1200×630 : nom du site, slogan, éditeurs). Les pages série utilisent la couverture du tome si `showCovers` est activé. Pour changer le nom ou le slogan sur l'image : `pip install playwright` puis `python3 scripts/make-og.py "Nom" "slogan"` (ça réécrit `scripts/assets/og.png`). Les réseaux gardent les aperçus en cache : après un changement, retester le lien avec leurs outils de débogage.

## Pont anime → manga
- `fetch-adaptations.mjs` cherche sur AniList, pour chaque série du calendrier, une adaptation animée (relation « adaptation », titre du manga identique, accents et ponctuation ignorés) et ses plateformes de streaming. Il vérifie au plus 120 séries par exécution (celles qui ont une sortie à venir d'abord) et mémorise tout dans `data/adaptations.json` : la première fois, il faut donc quelques jours pour couvrir tout le calendrier. Une série sans adaptation est revérifiée au bout de 3 semaines, une adaptation en cours ou à venir au bout d'une semaine.
- Sous les tomes (listes) et sur la page de la série : « Adapté en anime : titre (état) » avec les boutons de plateformes, ou un lien vers la fiche AniList s'il n'y en a pas. La page de la série ajoute le prochain épisode quand il est diffusé cette semaine.
- Sur la page Anime : lien « Lire le manga » quand l'anime correspond à une série du calendrier.
- Une série dont le titre français ne figure pas parmi les titres ou synonymes AniList n'est pas reliée.
- Le fichier `update.yml` contient une étape de plus (« Adaptations animées des séries manga ») : pense à le remplacer dans `.github/workflows/`.

Dans les articles automatiques, chaque manga et chaque anime est suivi d'une ligne de liens (« Calendrier manga · Page de la série », « Page Anime · Lire le manga »). Les liens vers un jour du calendrier ne retombent sur le bon jour que pour les dates récentes (la page Manga garde 7 jours d'historique, la page Anime la semaine en cours).

## Newsletter
Le site fournit : un formulaire d'inscription (page `/newsletter/`, accueil, pied de page), une case de consentement, les mentions de données personnelles, et chaque semaine un **numéro prêt à envoyer** (page `/newsletter/`, bloc « Pour l'éditeur du site » : bouton « Copier le code de l'e-mail »). L'envoi lui-même est fait par un service tiers de ton choix : il stocke les adresses, envoie, gère le désabonnement.

1. Crée un compte chez le service (à vérifier avant de choisir : le gratuit de MailerLite couvre 250 abonnés et 2 500 e-mails par mois, celui de Buttondown 100 abonnés ; l'envoi automatique depuis un flux RSS est payant chez Buttondown, donc ici le numéro se copie à la main chaque lundi).
2. Active la **double confirmation** (l'abonné clique sur un lien reçu par e-mail) et un pied de page avec lien de désabonnement : c'est obligatoire.
3. Crée un formulaire d'inscription « HTML intégré » : dans son code, relève l'adresse `action="https://…"` et le nom du champ e-mail (`name="…"`, souvent `email` ou `fields[email]`).
4. Dans `site.config.json` :
```
"newsletter": { "formAction": "https://…adresse du formulaire…", "emailField": "email", "provider": "Nom du service" }
```
   (`"hidden": { "nom": "valeur" }` ajoute des champs cachés si le service en demande.)
5. Lance « Run workflow » : le formulaire apparaît partout et `/newsletter/` devient indexable. Tant que `formAction` est vide, rien n'est affiché (sauf la page `/newsletter/`, non indexée, utile pour préparer le numéro).

## Fidélisation (tout reste dans le navigateur)
- **Pour toi** (accueil) : les sorties de la semaine des séries et animes suivis ; sans rien suivi, une invitation à le faire.
- **Animes suivis** : bouton « Suivre » sur les épisodes ; liste dans Mon planning avec les épisodes de la semaine et les plateformes. Données : `data/anime-week.json`.
- **Agenda avec rappels** (Mon planning) : fichier .ics avec rappel la veille à 18 h et le jour même à 9 h pour les tomes, 10 minutes avant pour les épisodes. Les agendas publics (`manga.ics`, `anime.ics`, `agenda/*.ics`) n'ont pas de rappels, pour ne pas inonder d'alertes. Un agenda personnel qui se met à jour tout seul demanderait un petit serveur (Cloudflare Worker).
- **Ma collection** : tomes possédés, séries à jour, tomes à rattraper (avec le coût) et barre de progression par série.
- **Installation** : à la 3e journée de visite, une invitation à installer le site (Android/Chrome : bouton ; iPhone : explication), refusable (pas de nouvelle invitation avant 60 jours).
- **Partage par lien** : Mon planning > « Sauvegarder, transférer ou partager » : lien contenant les séries, les animes et (au choix) la collection. Le destinataire voit un encadré et choisit d'ajouter ou d'ignorer ; rien n'est importé sans son clic.

## Mes animes (épisodes vus)

La page `/mes-animes/` permet de noter les épisodes vus (« de X à Y », plages fusionnées automatiquement, bouton « +1 »). Elle reprend les animes suivis avec « Suivre » et permet d'en ajouter à la main. Les données restent dans le navigateur (`mc-vus`, `mc-anime`) ; le script est `scripts/anime-vus.js`.

## Fiches anime

Chaque anime diffusé dans la semaine a sa page `/anime/<id>-<titre>/` (plateformes de streaming, horaires, lien vers le manga). Les jaquettes et titres de la page Anime et de l'accueil y mènent au lieu d'AniList. Les fiches disparaissent quand l'anime sort du programme de la semaine.

## Polices

Titres : Dela Gothic One ; texte : Zen Kaku Gothic New (SIL OFL, voir `scripts/assets/fonts/LICENSE.txt`). Elles sont hébergées avec le site (`/fonts/`), sans requête vers un tiers. Pour changer : remplacer les `.woff` de `scripts/assets/fonts/` et les `@font-face` de `style.css`.

## Liens d'achat (ISBN) et affiliation

Chaque tome ayant un ISBN-13 valide affiche des boutons « Acheter » (« Précommander » avant la sortie), un par boutique, stylés comme les plateformes de streaming (accueil, liste des sorties, pages série) : Amazon, Cultura, BDfugue (la Fnac a été retirée : programme d'affiliation refusé). Le code est dans `scripts/shops.mjs`.

Pour remplacer un lien par un lien d'affiliation, ajouter dans `site.config.json` :

```json
"shops": {
  "amazon":  { "affiliate": "https://www.amazon.fr/dp/{isbn10}?tag=TON-CODE-21" },
  "bdfugue": { "affiliate": "https://lien-de-ton-reseau/?url={urlenc}" },
  "cultura": { "enabled": false }
}
```

Variables : `{isbn}`, `{isbn10}` (ISBN en 978 seulement), `{url}` (adresse normale), `{urlenc}` (adresse normale encodée). Seuls les liens en `https://` sont acceptés. Dès qu'un lien d'affiliation est actif, le site ajoute `rel="sponsored"`, une mention sous les tomes et un paragraphe « Liens d'affiliation » dans les mentions légales.

## Catalogue des séries (BnF) et couvertures R2

`/series/` sert aussi de catalogue : environ 8 000 séries de manga publiées en français, avec la liste de leurs tomes (numéro, année, ISBN, boutons d'achat). Pages `/serie/<nom>/` pour chaque série, pages `/series/lettre/<a-z>/` (240 séries par page) et recherche globale étendue (index `catalogue` dans `data/search.json`).

- **Données** : `data/catalogue-bnf.json`, produit à partir du fichier `resultats_bnf.csv` (catalogue général de la BnF, licence ouverte) par `node scripts/import-bnf.mjs chemin/resultats_bnf.csv`. Le script écarte les ISBN invalides et les doublons, ramène les éditeurs à un seul nom (« Pika édition » et « Pika éd. » deviennent « Pika ») et regroupe les tomes par série. Relancer le script avec un nouveau fichier remplace le catalogue.
- **Séries déjà au calendrier** : même adresse qu'avant ; la liste « Tous les tomes parus en France » vient s'ajouter. Les séries du catalogue seules n'ont pas de date de sortie à venir.
- **Couvertures** : une image par série, `<base>/<adresse-de-la-serie>.webp`, hébergée dans R2. Dans `site.config.json` : `"catalogueCovers": "https://ton-domaine-public-r2/series/"`. Sans cette ligne (ou avec `"showCovers": false`), le catalogue s'affiche sans images. Une image manquante disparaît sans casser la page.
- **Sitemap** : seules les séries de 3 tomes ou plus (et celles du calendrier) y figurent, pour ne pas inonder Google de pages très courtes ; les autres restent accessibles par les pages de lettres et la recherche.

## Analyse du site

`node scripts/analyse-site.mjs rapports dist` produit des CSV : sorties absentes du catalogue, numéros de tomes manquants, ISBN sans couverture (`2-isbn-a-couvrir.csv`), doublons, liens internes cassés. `node scripts/liens-externes.mjs rapports` teste les liens externes. Le workflow « Analyse du site et liens » lance les deux une fois par mois (ou à la demande) et publie les fichiers dans Actions > Artifacts.
