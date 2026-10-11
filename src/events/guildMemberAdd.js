import { Events } from 'discord.js';
import { aiService } from '../services/aiService.js';
import { databaseService } from '../services/databaseService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.GuildMemberAdd,
  once: false,

  /**
   * Événement déclenché à l'arrivée d'un nouveau membre sur le serveur
   * @param {import('discord.js').GuildMember} member
   */
  async execute(member) {
    // 1. Ignorer les bots qui rejoignent le serveur
    if (member.user.bot || !member.guild) return;

    // Récupération de la configuration propre à ce serveur depuis la base de données
    const guildSettings = databaseService.getGuildSettings(member.guild.id);
    const channelId = guildSettings.welcomeChannelId || member.guild.systemChannelId;

    if (!channelId) {
      logger.debug(`[WELCOME] Aucun salon d'accueil configuré pour le serveur ${member.guild.name} (${member.guild.id}).`);
      return;
    }

    try {
      // 2. Récupération du salon d'accueil
      const channel = member.guild.channels.cache.get(channelId) ||
                      await member.guild.channels.fetch(channelId).catch(() => null);

      if (!channel || !channel.isTextBased()) {
        logger.warn(`[WELCOME] Le salon d'accueil (${channelId}) est introuvable ou n'est pas un salon textuel.`);
        return;
      }

      const username = member.displayName || member.user.username;
      logger.info(`[WELCOME] Nouveau membre détecté : ${member.user.tag} (${member.id}). Génération du message IA...`);

      // 3. Appel de l'IA pour générer un message unique et personnalisé
      const aiWelcomeText = await aiService.generateWelcomeMessage(username);

      // 4. Construction du message final avec gestion du fallback en cas d'échec ou délai IA
      let finalMessage;
      if (aiWelcomeText) {
        // Message personnalisé issu de l'IA avec mention directe du membre
        finalMessage = `👋 Bienvenue <@${member.id}> !\n\n${aiWelcomeText}`;
      } else {
        // Fallback classique et chaleureux en dur si l'API est indisponible ou trop lente
        finalMessage = `👋 Bienvenue sur le serveur, <@${member.id}> ! Nous sommes ravis de t'accueillir parmi nous. N'hésite pas à faire un tour sur les règles et à venir discuter dans le général ! 🎉`;
      }

      // 5. Envoi du message d'accueil dans le salon configuré
      await channel.send({
        content: finalMessage,
        allowedMentions: { users: [member.id] }
      });

      logger.info(`[WELCOME] Message d'accueil envoyé avec succès pour ${member.user.tag} (Mode: ${aiWelcomeText ? 'IA' : 'Fallback'}).`);
    } catch (error) {
      logger.error(`[WELCOME] Erreur lors de l'envoi du message de bienvenue pour ${member.user.tag} :`, error);
    }
  }
};
