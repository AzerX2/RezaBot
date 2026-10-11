import { Events, PermissionFlagsBits } from 'discord.js';
import { databaseService } from '../services/databaseService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.GuildCreate,
  once: false,

  /**
   * Événement déclenché lorsque le bot rejoint un nouveau serveur Discord
   * @param {import('discord.js').Guild} guild
   */
  async execute(guild) {
    logger.info(`[GUILD-CREATE] RezaBot a rejoint le serveur : ${guild.name} (ID: ${guild.id}).`);

    try {
      // 1. Enregistrement du serveur avec botMode = 'observing'
      databaseService.setGuildSettings(guild.id, {
        botMode: 'observing',
        serverVibe: 'en_cours_d_apprentissage'
      });

      // 2. Recherche du salon textuel principal pour le message d'introduction
      const me = guild.members.me || await guild.members.fetchMe().catch(() => null);

      let targetChannel = null;

      // Priorité au salon système officiel du serveur
      if (guild.systemChannel && me && guild.systemChannel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) {
        targetChannel = guild.systemChannel;
      } else {
        // Sinon, premier salon textuel où le bot a la permission d'écrire
        targetChannel = guild.channels.cache.find(
          c => c.isTextBased() && me && c.permissionsFor(me).has(PermissionFlagsBits.SendMessages)
        );
      }

      if (targetChannel) {
        await targetChannel.send(
          "Bonjour ! Je suis en mode observation pour les prochains jours afin de comprendre votre ambiance. Je serai silencieux, mais j'apprends ! 🧠👀"
        );
        logger.info(`[GUILD-CREATE] Message d'observation envoyé dans #${targetChannel.name} sur ${guild.name}.`);
      } else {
        logger.warn(`[GUILD-CREATE] Aucun salon accessible pour envoyer le message d'accueil sur ${guild.name}.`);
      }
    } catch (error) {
      logger.error(`[GUILD-CREATE] Erreur lors de l'initialisation du serveur ${guild.id} :`, error);
    }
  }
};
