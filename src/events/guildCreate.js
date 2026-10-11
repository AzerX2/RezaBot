import { Events, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { databaseService } from '../services/databaseService.js';
import { logger } from '../utils/logger.js';

/**
 * Recherche le salon optimal pour envoyer le message de bienvenue d'onboarding :
 * 1. Vérifie guild.systemChannel et les permissions du bot.
 * 2. Sinon, cherche le premier salon textuel où le bot peut voir et écrire.
 * 
 * @param {import('discord.js').Guild} guild
 * @returns {import('discord.js').TextChannel|null}
 */
export function findBestWelcomeChannel(guild) {
  if (!guild) return null;

  const botMember = guild.members?.me || (guild.client?.user ? guild.members?.cache?.get(guild.client.user.id) : null);
  const requiredPerms = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];

  const canPostInChannel = (channel) => {
    if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased() || channel.isVoiceBased?.()) {
      return false;
    }
    if (!botMember) return true;
    const perms = channel.permissionsFor ? channel.permissionsFor(botMember) : null;
    if (!perms) return true;
    return requiredPerms.every(p => perms.has(p));
  };

  // 1. Cherche d'abord le guild.systemChannel
  if (guild.systemChannel && canPostInChannel(guild.systemChannel)) {
    return guild.systemChannel;
  }

  // 2. Sinon cherche le premier salon textuel accessible
  if (guild.channels?.cache) {
    const textChannels = Array.from(guild.channels.cache.values()).filter(c => {
      return typeof c.isTextBased === 'function' && c.isTextBased() && !c.isVoiceBased?.();
    });

    // Trie par position dans la liste des salons
    textChannels.sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0));

    for (const channel of textChannels) {
      if (canPostInChannel(channel)) {
        return channel;
      }
    }
  }

  return null;
}

/**
 * Construit le grand EmbedBuilder de bienvenue pour l'onboarding
 * @returns {EmbedBuilder}
 */
export function buildWelcomeEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('👋 Salut ! Je suis RezaBot, votre nouvelle IA résidente.')
    .setDescription(
      "Je suis un concierge intelligent et autonome conçu pour animer votre communauté, répondre à vos questions et assister la gestion de votre serveur.\n\n" +
      "**Mes capacités principales :**\n" +
      "• 💬 **Discussions naturelles & Mémoire** : Je comprends le contexte des conversations et réponds quand on me mentionne ou quand on prononce mon prénom `reza`.\n" +
      "• 📚 **Connaissance RAG locale** : J'apprends les règles et documents spécifiques à votre serveur via la mémoire vectorielle.\n" +
      "• 📝 **Résumés intelligents** : Je synthétise l'activité et participe spontanément aux débats passionnants."
    )
    .addFields(
      {
        name: '⚙️ Pour les Admins',
        value: "Utilisez la commande `/rezasetup` pour définir mon rôle (**member**, **moderator** ou **admin**) et adapter mon niveau d'autorité sur le serveur !"
      },
      {
        name: '🚀 Pour commencer',
        value: 'Tapez `/help` pour voir tout ce que je sais faire !'
      }
    )
    .setFooter({ text: 'RezaBot • 100% Intégré & Zéro Waste' })
    .setTimestamp();
}

export default {
  name: Events.GuildCreate,
  once: false,

  /**
   * Exécution de l'événement guildCreate (Onboarding statique 0 token)
   * @param {import('discord.js').Guild} guild
   */
  async execute(guild) {
    try {
      logger.info(`[ONBOARDING] RezaBot a rejoint le serveur : ${guild.name} (${guild.id})`);

      // Enregistrement par défaut dans la base SQLite si nouveau serveur
      try {
        const settings = databaseService.getGuildSettings(guild.id);
        if (!settings.welcomeChannelId && !settings.logChannelId) {
          databaseService.setGuildSettings(guild.id, {
            botMode: 'standard',
            serverVibe: 'friendly',
            bot_role: 'member'
          });
        }
      } catch {}

      const targetChannel = findBestWelcomeChannel(guild);

      if (!targetChannel) {
        logger.warn(`[ONBOARDING] Aucun salon textuel accessible trouvé sur ${guild.name} (${guild.id}).`);
        return;
      }

      const welcomeEmbed = buildWelcomeEmbed();
      await targetChannel.send({ embeds: [welcomeEmbed] });

      logger.info(`[ONBOARDING] Message d'accueil envoyé avec succès dans #${targetChannel.name || targetChannel.id} sur ${guild.name}.`);
    } catch (error) {
      logger.error(`[ONBOARDING] Erreur lors de l'onboarding sur ${guild?.name} :`, error);
    }
  }
};
