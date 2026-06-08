<div align="right">
  <a href="README.md">English</a> |
  <a href="README_zh.md">简体中文</a> |
  <a href="README_ru.md">Русский</a> |
  <a href="README_es.md">Español</a> |
  <strong>Français</strong> |
  <a href="README_ar.md">العربية</a>
</div>

<p align="center">
  <img src="icon.svg" width="128" height="128" alt="RSS Reader Logo">
</p>

<h1 align="center">RSS Reader</h1>

<p align="center">
  <strong>Un lecteur RSS de bureau local-first avec des outils d'IA optionnels.</strong>
</p>

<p align="center">
  <a href="https://github.com/JinxinWonderWorld/RSS-Reader/releases"><img src="https://img.shields.io/github/v/release/JinxinWonderWorld/RSS-Reader?color=blue&label=T%C3%A9l%C3%A9charger" alt="Releases"></a>
  <img src="https://img.shields.io/badge/Version-0.2.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/Platform-macOS-lightgrey" alt="Platform">
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Built_with-Tauri_2-24C8DB?logo=tauri&logoColor=white" alt="Tauri"></a>
</p>

<p align="center">
  <a href="#aperçu">Aperçu</a> •
  <a href="#fonctionnalités">Fonctionnalités</a> •
  <a href="#nouveautés-de-020">Nouveautés</a> •
  <a href="#téléchargement">Téléchargement</a> •
  <a href="#développement">Développement</a> •
  <a href="#architecture">Architecture</a>
</p>

---

<p align="center">
  <img src="imgs/screenshot.png" alt="RSS Reader screenshot" width="800">
</p>

## Aperçu

RSS Reader est une application de bureau Tauri 2 pour lire les flux RSS, Atom et JSON. Elle stocke les données localement dans SQLite, réduit le coût des mises à jour avec des requêtes conditionnelles et ajoute des workflows d'IA optionnels pour les résumés, la traduction et la notation des articles.

L'application suit le comportement natif de macOS : `Command+W` ferme la fenêtre tout en gardant l'application active dans le Dock, et `Command+Q` quitte réellement l'application.

## Fonctionnalités

### Lecture et gestion des flux
- Abonnement aux flux RSS, Atom et JSON.
- Import et export des abonnements avec OPML.
- Vues pour tous les articles, les non lus, les favoris étoilés et les favoris.
- Organisation des articles par flux, étiquettes et groupes.
- Recherche locale en texte intégral.
- Listes virtualisées pour les grandes collections d'articles.

### Performance et tâches d'arrière-plan
- Stockage local des articles, flux, règles et paramètres.
- Utilisation de `ETag` et `Last-Modified` pour ignorer les flux inchangés.
- Rafraîchissement des flux en Rust avec une concurrence limitée.
- Planificateur léger en arrière-plan quand la fenêtre principale est fermée.
- Pause des tâches lourdes d'interface et d'IA quand aucune fenêtre n'est ouverte.
- Chargement à la demande du rendu d'article, du nettoyage HTML, du Markdown et de la coloration du code.
- Proxy `rss-media://` borné pour les médias qui nécessitent du cache ou des requêtes Range.
- Chargement des vidéos intégrées uniquement après une action de l'utilisateur.

### Outils d'IA optionnels
- Configuration de profils compatibles OpenAI ou Anthropic.
- Génération de résumés pour un article.
- Traduction du contenu des articles.
- Génération de synthèses par lot pour plusieurs articles.
- Règles d'automatisation et notation IA pour classer ou mettre en avant des articles.
- Les clés API restent dans les paramètres locaux de l'application.

### Expérience de bureau
- Comportement natif du menu macOS pour fermer, rouvrir, masquer et quitter.
- Raccourcis clavier avec interrupteur d'activation dans les paramètres.
- Thèmes clair, sombre et système.
- Menus contextuels et actions par lot pour les articles.
- Interface en anglais, chinois, russe, espagnol, français et arabe.

## Nouveautés de 0.2.0

- Cycle de vie macOS standard : `Command+W` ferme la fenêtre, `Command+Q` quitte l'application.
- Consommation réduite en état masqué grâce à la destruction du WebView quand la fenêtre est fermée.
- Rafraîchissement et nettoyage d'arrière-plan gérés par Rust.
- Récupération conditionnelle des flux avec `ETag` et `Last-Modified`.
- Rendu d'article différé et chargement média plus léger.
- Nouvel interrupteur pour les raccourcis clavier dans les paramètres.
- Corrections pour la restauration de route, la navigation depuis les paramètres, les compteurs de flux et la synchronisation de l'état lu.

## Téléchargement

Les builds prêts à l'emploi sont publiés sur la page [GitHub Releases](https://github.com/JinxinWonderWorld/RSS-Reader/releases).

La cible de version actuelle est macOS. La configuration Tauri conserve la prise en charge de Windows et Linux, mais les tests de publication se concentrent actuellement sur macOS.

## Développement

### Prérequis
- [Node.js](https://nodejs.org/) 18 ou plus récent
- [Rust](https://www.rust-lang.org/tools/install) 1.70 ou plus récent

### Démarrage rapide

```bash
git clone https://github.com/JinxinWonderWorld/RSS-Reader.git
cd RSS-Reader
npm install
npm run tauri:dev
```

### Commandes utiles

| Commande | Description |
| --- | --- |
| `npm run dev` | Lancer uniquement le frontend Vite |
| `npm run build` | Vérifier les types et compiler le frontend |
| `npm run tauri:dev` | Lancer l'application Tauri complète en développement |
| `npm run tauri:build` | Compiler le bundle de publication |
| `npm test -- --run` | Exécuter les tests frontend |
| `npm run lint` | Exécuter ESLint |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Exécuter les tests Rust |

## Architecture

- `src-tauri/src/app_runtime.rs`: état runtime, planification d'arrière-plan et garde-fous de nettoyage.
- `src-tauri/src/window_lifecycle.rs`: fermeture, réouverture et restauration de l'état de fenêtre macOS.
- `src-tauri/src/feed/`: récupération des flux, requêtes conditionnelles et parsing.
- `src-tauri/src/db/`: schéma SQLite et accès aux données.
- `src-tauri/src/media_protocol.rs`: proxy média borné et réponses Range.
- `src-tauri/src/ai.rs`: résumés IA, traduction, synthèses par lot et traitement de file.
- `src/services/runtime.ts`: pont frontend vers les commandes runtime Rust.
- `src/stores/`: stores Zustand pour flux, paramètres, règles, état UI et historique de recherche.
- `src/components/`: composants React et rendu d'article chargé à la demande.
