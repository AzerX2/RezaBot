import { Events } from 'discord.js';
import { databaseService } from '../services/databaseService.js';
import { logger } from '../utils/logger.js';

/**
 * 10 phrases d'accroche d'accueil stylisées, drôles et variées (Zero Waste FinOps : 0 appel API).
 */
export const welcomeMessages = [
  (mention) => `👋 Bienvenue ${mention} ! Prends un cookie 🍪 et installe-toi confortablement parmi nous.`,
  (mention) => `🚨 Alerte générale : ${mention} vient d'atterrir sur le serveur ! Faites place à la légende. ✨`,
  (mention) => `🎉 Un sauvage ${mention} apparaît ! Préparez vos meilleures blagues et votre plus beau café ☕.`,
  (mention) => `🚀 Bienvenue à bord, ${mention} ! Attache ta ceinture, l'aventure commence maintenant.`,
  (mention) => `👀 Tiens tiens tiens... C'est ${mention} qui nous rejoint ! On espère que tu as pensé aux pizzas 🍕.`,
  (mention) => `✨ Nouveau joueur dans la partie : ${mention} rejoint l'arène ! Bienvenue chez toi. 🎮`,
  (mention) => `🥳 Bienvenue ${mention} ! Ne fais pas attention au bazar, on rangeait juste la table pour toi.`,
  (mention) => `🔥 Coucou ${mention} ! Content de te voir ici, viens nous dire ce qui t'amène dans le général !`,
  (mention) => `🌟 Un nouveau membre d'exception repéré : bienvenue ${mention} ! Installe-toi au calme. 🛋️`,
  (mention) => `💥 Boom ! ${mention} débarque en force. Bienvenue dans la bande, fais comme chez toi ! 🎉`
];

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

      // 3. Sélection aléatoire d'un message stylisé (Zero Waste : 0 token API)
      const randomIndex = Math.floor(Math.random() * welcomeMessages.length);
      const chosenTemplate = welcomeMessages[randomIndex];
      const memberMention = `<@${member.id}>`;
      const finalMessage = typeof chosenTemplate === 'function'
        ? chosenTemplate(memberMention)
        : String(chosenTemplate).replace(/{mention}/g, memberMention).replace(/{name}/g, member.displayName || member.user.username);

      // 4. Envoi du message d'accueil dans le salon configuré
      await channel.send({
        content: finalMessage,
        allowedMentions: { users: [member.id] }
      });

      logger.info(`[WELCOME] Message d'accueil envoyé pour ${member.user.tag} (Template #${randomIndex + 1}, 0 token consommé).`);
    } catch (error) {
      logger.error(`[WELCOME] Erreur lors de l'envoi du message de bienvenue pour ${member.user.tag} :`, error);
    }
  }
};
