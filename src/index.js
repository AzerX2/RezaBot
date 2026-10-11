import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { config, validateConfig } from './config.js';
import { logger } from './utils/logger.js';
import { loadEvents } from './handlers/eventHandler.js';
import { loadCommands } from './handlers/commandHandler.js';

import { ragService } from './services/ragService.js';
import { databaseService } from './services/databaseService.js';

// Validation préalable des variables d'environnement
validateConfig();

/**
 * Initialisation du Client Discord avec les Intents requis pour :
 * - La réception des messages de guildes
 * - L'accès au contenu des messages (Privileged Intent: MessageContent)
 * - L'envoi et la gestion des messages privés (DirectMessages)
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,       // Privileged Intent : requis pour guildMemberAdd
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,     // Privileged Intent : requis pour lire le contenu
    GatewayIntentBits.DirectMessages      // Pour les avertissements en MP
  ],
  partials: [
    Partials.Channel,                     // Nécessaire pour gérer correctement les DMs
    Partials.Message,
    Partials.User
  ]
});

// Registre des commandes Slash et Services
client.commands = new Collection();
client.ragService = ragService;
client.databaseService = databaseService;

/**
 * Démarrage et amorçage du bot
 */
async function bootstrap() {
  try {
    logger.info('[BOOTSTRAP] Initialisation de RezaBot...');

    // Chargement dynamique des gestionnaires d'événements et de commandes
    await loadEvents(client);
    await loadCommands(client);

    // Connexion à la Gateway Discord
    if (!config.discord.token) {
      logger.error('[BOOTSTRAP] Erreur critique : DISCORD_TOKEN est manquant dans le fichier .env');
      process.exit(1);
    }

    await client.login(config.discord.token);
  } catch (error) {
    logger.error('[BOOTSTRAP] Échec critique du démarrage du bot :', error);
    process.exit(1);
  }
}

// =========================================================================
// Gestion globale des exceptions pour garantir la robustesse de production
// =========================================================================
process.on('unhandledRejection', (reason, promise) => {
  logger.error('[ANTI-CRASH] Rejet de promesse non intercepté :', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('[ANTI-CRASH] Exception non interceptée :', error);
});

// Arrêt gracieux lors d'un signal système
const gracefulShutdown = () => {
  logger.info('[SHUTDOWN] Arrêt gracieux de RezaBot en cours...');
  client.destroy();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Lancement
bootstrap();
