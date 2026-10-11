# 🤖 RezaBot — Concierge IA Discord Intelligent, Multi-Serveur & Zero Waste

Bienvenue sur le dépôt officiel de **RezaBot**, un bot Discord nouvelle génération développé avec **Node.js 20**, **Discord.js (v14)**, **LangChain** et l'**API OpenAI**.

RezaBot combine une **architecture agentique dynamique**, une **mémoire RAG vectorielle (ChromaDB)**, une **persistance relationnelle SQLite multi-tenants**, et une politique **FinOps stricte "Zero Waste"** pour offrir une expérience communautaire ultra-fluide tout en maîtrisant les coûts de tokens.

---

## 🌟 Points Forts & Philosophie

- 🎯 **Multi-Serveur Étanche (Multi-Tenancy)** : Chaque serveur possède sa propre configuration, ses quotas, son ton d'ambiance (*vibe*), son rôle d'autorité et sa collection vectorielle isolée.
- ⚡ **FinOps "Zero Waste"** :
  - **Escalade de modèles à 3 niveaux** (Chat, Fast, Micro) selon la complexité de la tâche.
  - **Compression de contexte** via `microModel` réduisant par 3 les tokens envoyés dans le prompt final.
  - **Cache sémantique (similarité vectorielle > 0.95)** : Réponse instantanée à 0 token pour les questions récurrentes.
  - **Élimination des pings vides** et **messages d'accueil statiques** variés (0 appel IA inutile).
  - **Messages d'erreur 100% statiques** (jamais d'IA payante pour formuler des excuses).
- 🛡️ **Gouvernance & Human-in-the-Loop** :
  - Les actions sensibles (suppression de salons) passent par un système de **staging** avec tickets et **boutons interactifs Discord** pour validation obligatoire par un administrateur.
- 📊 **Analytics & Reporting Hebdomadaire** :
  - Synthèse automatisée par Cron Job tous les dimanches à 20h directement dans le salon privé des administrateurs.

---

## 🏗️ Architecture & Escalade des Modèles (3 Tiers)

Pour maximiser la réactivité et minimiser les coûts d'inférence, RezaBot route chaque requête vers le modèle optimal :

```
                        ┌────────────────────────────────────────────────────────┐
                        │                 Requête / Événement                    │
                        └──────────────────────────┬─────────────────────────────┘
                                                   │
                ┌──────────────────────────────────┼──────────────────────────────────┐
                │                                  │                                  │
                ▼                                  ▼                                  ▼
      ┌──────────────────┐               ┌──────────────────┐               ┌──────────────────┐
      │   Tier 1: CHAT   │               │   Tier 2: FAST   │               │  Tier 3: MICRO   │
      │   gpt-5.4-mini   │               │   gpt-5.4-nano   │               │   gpt-4.1-nano   │
      └─────────┬────────┘               └─────────┬────────┘               └─────────┬────────┘
                │                                  │                                  │
    • askConcierge (Questions)          • moderateMessage (Temps réel)     • compressContext (Historique)
    • LangChain Agent & Outils          • spontaneousReply (2% / 10%)      • socialMemory (Faits nocturnes)
    • Rapport Hebdomadaire CM                                              • summarizeChat (/tldr)
                                                                           • knowledgeExtractor (Mining)
```

| Niveau | Modèle par défaut | Variable `.env` | Cas d'usage |
| :--- | :--- | :--- | :--- |
| **Chat Model** | `gpt-5.4-mini` | `OPENAI_MODEL_CHAT` | Réponses complexes du Concierge, exécution d'outils (Function Calling), reporting hebdomadaire. |
| **Fast Model** | `gpt-5.4-nano` | `OPENAI_MODEL_FAST` | Modération contextuelle invisible en temps réel, interventions spontanées dans les salons actifs. |
| **Micro Model** | `gpt-4.1-nano` | `OPENAI_MODEL_MICRO` | Tâches ETL, compression dense de l'historique, extraction nocturne des faits individuels, résumés `/tldr`. |

---

## 📋 Fonctionnalités Détaillées

### 1. Concierge Intelligent & Écoute Active
- **Déclenchement hybride** : Mention `@RezaBot` ou simple prononciation de son prénom (`reza` ou `rezabot`).
- **Ping vide & Salutations** : Réponse instantanée aléatoire sans appel IA (0 token).
- **Mémoire conversationnelle courte** : Récupère les messages récents du salon, les compresse via `microModel`, et injecte ce résumé dans l'agent pour comprendre les références implicites (*"il"*, *"ça"*, *"la dernière fois"*).
- **Faits personnels (Social Memory)** : Si un membre s'adresse au bot, ses faits personnels (métier, passions, jeux) sont injectés pour personnaliser subtilement la réponse.

### 2. Mémoire RAG & Vectorielle (ChromaDB)
- Indexation multi-tenants : Les données de chaque serveur sont isolées via la métadonnée `guildId`.
- Ingestion dynamique via `/sync-memory` ou par script batch (`npm run ingest`).
- Recherche sémantique top-K (`topK: 4`) avant génération de réponse.

### 3. Agentic Workflow & Rôles Dynamiques
RezaBot adapte son prompt système et son catalogue d'outils en fonction de son rôle sur le serveur :
- 👤 **Membre (`member`)** :
  - `search_web` (Recherche Web en direct via DuckDuckGo Instant Answer).
  - `get_server_time` (Heure précise et fuseau horaire).
- 🛡️ **Modérateur (`moderator`)** :
  - Outils membres + `timeout_user` (mise en sourdine) + `delete_message` (suppression de message).
- 👑 **Administrateur (`admin`)** :
  - Outils modérateurs + gestion de salons (`create_channel`, `search_channels`, `stage_channel_deletion`, `delete_channel`).
  - **Validation Humaine Obligatoire** : Toute suppression de salon déclenche un ticket et des boutons interactifs Discord `[Confirmer 🟩]` / `[Annuler 🟥]`.

### 4. Modération Contextuelle Invisible
- Analyse automatique en tâche de fond (IIFE non-bloquante).
- Filtre bienveillant qui comprend l'argot gamer, le chambrage amical et le second degré.
- Détecte l'hostilité réelle : envoie un message privé pédagogique à l'auteur et consigne l'incident dans le salon de logs des administrateurs.

### 5. Interventions Spontanées
- Si le bot n'est pas tagué mais qu'un salon est très actif (≥ 3 messages de 3 auteurs en 5 minutes) :
  - **2% de chance** de réagir avec le ton du salon (argot, humour).
  - **10% de chance** si le message contient des expressions émotionnelles (`"j'en peux plus"`, `"qui joue ?"`, `"incroyable"`).
  - Simulation de frappe naturelle (`sendTyping`) avec délai humain.

### 6. Système SaaS & Quotas Quotidiens Stricts
- 🆓 **Serveur Standard (Gratuit)** : 20 000 tokens / jour.
- ⭐ **Serveur Premium** : 500 000 tokens / jour.
- Décompte FinOps précis après chaque appel et blocage préventif avec message explicatif en cas de dépassement.
- Réinitialisation automatique chaque jour à minuit.

### 7. Mémoire Sociale Nocturne (Extraction de Faits)
- Cron Job nocturne chaque nuit à **3h00** (`0 3 * * *`).
- Analyse jusqu'à 300 messages de la journée avec `microModel`.
- Extrait les passions, métiers et anecdotes des membres et les stocke dans ChromaDB sous le type `user_fact`.

### 8. Analytics Hebdomadaire pour Administrateurs
- Cron Job chaque dimanche à **20h00** (`0 20 * * 0`).
- Récupère les résumés quotidiens de la semaine stockés dans SQLite (`daily_summaries`).
- Formule un rapport structuré :
  1. Les 3 sujets les plus discutés.
  2. L'humeur générale du serveur.
  3. Les membres les plus actifs ou remarquables.
  4. Les éventuelles tensions détectées.
- Envoie un bel `EmbedBuilder` dans le salon privé des administrateurs (`ADMIN_LOG_CHANNEL_ID`).

### 9. Onboarding & Menu d'Aide Statique (Zero Waste)
- **Arrivée sur le serveur (`guildCreate`)** :
  - Algorithme de recherche du meilleur salon (priorité à `systemChannel`, sinon premier salon textuel autorisé).
  - Embed complet de présentation expliquant les capacités et orientant les admins vers `/rezasetup`.
- **Menu d'aide (`/help`)** :
  - Réponse statique instantanée (0 token).
  - Boutons de liens interactifs (Inviter le bot, Soutien / GitHub).

---

## 💻 Liste des Commandes Slash

| Commande | Rôle requis | Description |
| :--- | :--- | :--- |
| `/help` | Tous | Affiche le guide complet d'utilisation et les liens utiles. |
| `/tldr [limit]` | Tous | Résume les derniers messages du salon actuel (entre 10 et 100 messages). |
| `/rezasetup <role>` | Administrateur | Définit le niveau d'autorité du bot (`member`, `moderator`, `admin`). |
| `/sync-memory <texte>` | Administrateur | Indexe manuellement des règles ou informations dans la base RAG du serveur. |
| `/config-channels [logs] [welcome]` | Administrateur | Configure les salons de logs et de bienvenue du serveur. |
| `/end-observation` | Administrateur | Termine le mode observation et synthétise l'ambiance du serveur. |
| `/premium <guild_id> [action]` | Créateur du Bot | Active ou désactive le statut SaaS Premium (500k tokens) d'une guilde. |

---

## 📁 Structure du Projet

```
RezaBot/
├── .env.example               # Modèle des variables d'environnement
├── Dockerfile                 # Image Node.js 20 Alpine durcie
├── docker-compose.yml         # Orchestration bot + ChromaDB persistant
├── package.json               # Manifeste et dépendances de production
├── vitest.config.js           # Configuration de la suite de tests
├── data/
│   ├── faq.json               # Données de test pour l'ingestion RAG
│   └── rezabot.sqlite         # Base SQLite relationnelle (multi-serveurs)
├── scripts/
│   └── ingest.js              # Script autonome d'ingestion vectorielle
├── src/
│   ├── index.js               # Point d'entrée principal et initialisation
│   ├── config.js              # Configuration centralisée et validation .env
│   ├── commands/
│   │   ├── admin/             # Commandes d'administration (/rezasetup, /sync-memory, etc.)
│   │   ├── dev/               # Commandes réservées au développeur (/premium)
│   │   └── utility/           # Commandes publiques (/help, /tldr)
│   ├── events/
│   │   ├── ready.js           # Démarrage des schedulers et statut Discord
│   │   ├── messageCreate.js   # Concierge, compression, modération et interventions
│   │   ├── interactionCreate.js # Slash commands et boutons d'action
│   │   ├── guildCreate.js     # Onboarding automatique à l'arrivée
│   │   └── guildMemberAdd.js  # Messages d'accueil aléatoires Zero Waste
│   ├── handlers/
│   │   ├── commandHandler.js  # Chargement et enregistrement global des commandes
│   │   └── eventHandler.js    # Chargement dynamique des événements Discord
│   ├── services/
│   │   ├── actionTicketManager.js # Gestion des tickets de validation humaine
│   │   ├── activityService.js     # Relance autonome après inactivité (Icebreakers)
│   │   ├── aiService.js           # Cœur OpenAI, LangChain agent et 3 tiers de modèles
│   │   ├── analyticsService.js    # Cron hebdomadaire de rapport d'activité
│   │   ├── cacheService.js        # Cache sémantique vectoriel (économie de tokens)
│   │   ├── databaseService.js     # Couche SQLite multi-serveurs (WAL mode)
│   │   ├── knowledgeExtractor.js  # Mining de connaissances depuis les messages
│   │   ├── ragService.js          # Interface vectorielle ChromaDB
│   │   └── socialMemory.js        # Extraction nocturne des faits individuels
│   ├── tools/
│   │   └── index.js           # Outils LangChain (Web, heure, modération, salons)
│   └── utils/
│       └── logger.js          # Logger applicatif horodaté
└── tests/                     # 11 fichiers de tests unitaires Vitest (73 tests)
```

---

## 🚀 Installation & Démarrage

### 1. Prérequis
- [Node.js](https://nodejs.org/) v20+ (ou v22+ avec support natif SQLite)
- [Docker](https://www.docker.com/) & Docker Compose (si déploiement conteneurisé)
- Une clé d'API [OpenAI](https://platform.openai.com/)
- Une application bot sur le [Portail Développeur Discord](https://discord.com/developers/applications)

> [!IMPORTANT]
> **Privileged Gateway Intents requis** sur le Discord Developer Portal :
> - `Server Members Intent` (pour l'accueil des membres)
> - `Message Content Intent` (pour lire les messages et interagir)

### 2. Configuration du fichier `.env`

Créez votre fichier `.env` à partir du modèle :
```bash
cp .env.example .env
```

Renseignez les variables indispensables :
```env
# Discord Configuration
DISCORD_TOKEN=votre_token_bot_discord_secret
DISCORD_CLIENT_ID=votre_application_client_id
BOT_OWNER_ID=votre_id_utilisateur_discord_pour_les_commandes_dev
ADMIN_LOG_CHANNEL_ID=id_salon_logs_admin_optionnel

# OpenAI Configuration - 3 Niveaux
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL_CHAT=gpt-5.4-mini
OPENAI_MODEL_FAST=gpt-5.4-nano
OPENAI_MODEL_MICRO=gpt-4.1-nano

# ChromaDB / RAG Configuration
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION_NAME=rezabot_knowledge
```

### 3. Lancement local

```bash
# Installation des dépendances
npm install

# Ingestion optionnelle de la FAQ de départ dans ChromaDB
npm run ingest

# Démarrage en mode production
npm start

# Ou en mode développement avec rechargement à chaud
npm run dev
```

### 4. Déploiement avec Docker Compose (Recommandé)

Docker Compose lance automatiquement le bot et la base vectorielle ChromaDB avec persistance totale des données :

```bash
# Démarrer les services en arrière-plan
docker compose up -d --build

# Consulter les logs en direct
docker compose logs -f bot
```

Les données sont persistées sur l'hôte :
- `./data/` : Base de données SQLite (`rezabot.sqlite`).
- `./chroma_data/` : Base vectorielle ChromaDB.

---

## 🧪 Tests Unitaires

La suite de tests automatisée utilise **Vitest** et simule l'environnement Discord sans jamais consommer de crédits API réels :

```bash
npm test
```

**Bilan actuel : 11 suites de test, 73 tests réussis (0 échec).**
- `tests/agent.test.js` : Outils LangChain et attribution par rôle.
- `tests/analytics.test.js` : Rapport hebdomadaire, cron job et persistance.
- `tests/features_update.test.js` : Quotas SaaS Freemium et sécurité.
- `tests/model_escalation.test.js` : Escalade à 3 niveaux et compression contextuelle.
- `tests/moderation.test.js` : Détection de toxicité et consignation d'alertes.
- `tests/onboarding_help.test.js` : Accueil à l'arrivée et commande `/help` + `/tldr`.
- `tests/prompts_10_11.test.js` : Mémoire conversationnelle et validation par boutons.
- `tests/scraper.test.js` : Ingestion et recherche RAG vectorielle.
- `tests/social_memory.test.js` : Extraction de faits individuels.
- `tests/spontaneous.test.js` : Déclencheurs probabilistes sans tag.
- `tests/zero_waste.test.js` : Réponses statiques, pings vides et gestion d'erreurs 429.

---

## 🛡️ Licence

Ce projet est sous licence **MIT**. Développé avec passion pour offrir le meilleur de l'IA aux communautés Discord.
