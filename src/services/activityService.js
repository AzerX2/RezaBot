import cron from 'node-cron';
import { PermissionFlagsBits } from 'discord.js';
import { databaseService } from './databaseService.js';
import { aiService } from './aiService.js';
import { logger } from '../utils/logger.js';

/**
 * Service autonome (Cron/Scheduler) vérifiant périodiquement l'activité des serveurs.
 * Relance naturellement la discussion si un salon principal est inactif depuis plus de 6 heures.
 */
class ActivityService {
  constructor() {
    this.client = null;
    this.cronTask = null;
    // Seuil d'inactivité : 6 heures en millisecondes
    this.INACTIVITY_THRESHOLD_MS = 6 * 60 * 60 * 1000;
  }

  /**
   * Initialise et démarre le planificateur cron
   * @param {import('discord.js').Client} client
   */
  init(client) {
    this.client = client;

    // Exécution toutes les heures au début de l'heure (ex: 13:00, 14:00, 15:00)
    this.cronTask = cron.schedule('0 * * * *', async () => {
      logger.info('[ACTIVITY-CRON] Exécution de la vérification horaire d\'activité...');
      await this.checkAllGuildsActivity();
    });

    logger.info('[ACTIVITY-SERVICE] Scheduler d\'activité démarré (planifié toutes les heures).');
  }

  /**
   * Vérifie l'inactivité sur l'ensemble des serveurs Discord connectés
   */
  async checkAllGuildsActivity() {
    if (!this.client || !this.client.isReady()) {
      logger.warn('[ACTIVITY-SERVICE] Le client Discord n\'est pas encore prêt.');
      return;
    }

    const guilds = this.client.guilds.cache;

    for (const [guildId, guild] of guilds) {
      try {
        await this._checkSingleGuildActivity(guild);
      } catch (err) {
        logger.error(`[ACTIVITY-SERVICE] Erreur lors de la vérification du serveur ${guild.name} (${guildId}) :`, err);
      }
    }
  }

  /**
   * Analyse l'activité d'une guilde spécifique
   * @param {import('discord.js').Guild} guild
   */
  async _checkSingleGuildActivity(guild) {
    const guildSettings = databaseService.getGuildSettings(guild.id);

    // Ne jamais relancer les serveurs en cours d'observation (le bot doit rester silencieux)
    if (guildSettings.botMode === 'observing') {
      logger.debug(`[ACTIVITY] Serveur ${guild.name} en mode observing, ignoré.`);
      return;
    }

    // Cooldown : éviter d'envoyer deux relances consécutives en moins de 6 heures
    if (guildSettings.lastIcebreakerAt) {
      const lastSentTime = new Date(guildSettings.lastIcebreakerAt).getTime();
      if (Date.now() - lastSentTime < this.INACTIVITY_THRESHOLD_MS) {
        return;
      }
    }

    // 1. Détermination du salon principal
    const channel = await this._resolveMainChannel(guild, guildSettings);
    if (!channel) {
      logger.debug(`[ACTIVITY] Aucun salon principal accessible sur ${guild.name}.`);
      return;
    }

    // 2. Récupération du dernier message posté dans le salon
    let lastMessage = null;
    try {
      const messages = await channel.messages.fetch({ limit: 1 });
      lastMessage = messages.first() || null;
    } catch (fetchErr) {
      logger.warn(`[ACTIVITY] Impossible de lire les messages de #${channel.name} sur ${guild.name} : ${fetchErr.message}`);
      return;
    }

    const now = Date.now();
    let isInactive = false;

    if (!lastMessage) {
      // Aucun message dans le salon : salon vide
      isInactive = true;
    } else {
      const lastMessageAgeMs = now - lastMessage.createdTimestamp;
      if (lastMessageAgeMs >= this.INACTIVITY_THRESHOLD_MS) {
        isInactive = true;
      }
    }

    if (!isInactive) {
      logger.debug(`[ACTIVITY] Salon #${channel.name} actif sur ${guild.name}.`);
      return;
    }

    logger.info(`[ACTIVITY] Salon #${channel.name} inactif depuis plus de 6h sur ${guild.name}. Déclenchement de l'Icebreaker IA...`);

    // 3. Récupération des sujets populaires depuis la mémoire RAG
    let popularContext = [];
    if (this.client.ragService) {
      try {
        popularContext = await this.client.ragService.searchContext(
          "Quels sont les sujets les plus populaires, débats récents et centres d'intérêt de ce serveur ?",
          guild.id,
          4
        );
      } catch (ragErr) {
        logger.warn(`[ACTIVITY] Échec recherche RAG pour sujets populaires : ${ragErr.message}`);
      }
    }

    // 4. Génération de l'accroche contextuelle par l'IA
    const icebreakerMessage = await aiService.generateIcebreaker(
      guild.id,
      {
        guildName: guild.name,
        serverVibe: guildSettings.serverVibe,
        botMode: guildSettings.botMode
      },
      popularContext
    );

    // 5. Envoi du message dans le salon principal
    await channel.send(icebreakerMessage);

    // 6. Enregistrement de l'horodatage en base de données pour le cooldown
    databaseService.setGuildSettings(guild.id, {
      lastIcebreakerAt: new Date().toISOString()
    });

    logger.info(`[ACTIVITY] ✅ Relance d'activité envoyée dans #${channel.name} sur ${guild.name} !`);
  }

  /**
   * Résout le salon principal pour envoyer la relance
   * @param {import('discord.js').Guild} guild
   * @param {Object} guildSettings
   * @returns {Promise<import('discord.js').TextChannel|null>}
   */
  async _resolveMainChannel(guild, guildSettings) {
    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!me) return null;

    // Priorité 1 : Salon principal configuré dans la DB (mainChannelId)
    if (guildSettings.mainChannelId) {
      const dbChannel = guild.channels.cache.get(guildSettings.mainChannelId) ||
                        await guild.channels.fetch(guildSettings.mainChannelId).catch(() => null);
      if (dbChannel && dbChannel.isTextBased() && dbChannel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) {
        return dbChannel;
      }
    }

    // Priorité 2 : Salon système officiel du serveur Discord
    if (guild.systemChannel && guild.systemChannel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) {
      return guild.systemChannel;
    }

    // Priorité 3 : Salon nommé 'général', 'general' ou 'discussions'
    const commonNames = ['général', 'general', 'discussion', 'discussions', 'chat'];
    const preferredChannel = guild.channels.cache.find(c =>
      c.isTextBased() &&
      commonNames.includes(c.name.toLowerCase()) &&
      c.permissionsFor(me).has(PermissionFlagsBits.SendMessages)
    );

    if (preferredChannel) return preferredChannel;

    // Priorité 4 : Premier salon textuel accessible
    return guild.channels.cache.find(c =>
      c.isTextBased() &&
      c.permissionsFor(me).has(PermissionFlagsBits.SendMessages)
    ) || null;
  }
}

export const activityService = new ActivityService();
