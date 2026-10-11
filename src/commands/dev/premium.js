import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { databaseService, SAAS_LIMITS } from '../../services/databaseService.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Commande secrète développeur : active ou désactive le statut Premium d\'un serveur')
    .addStringOption(option =>
      option
        .setName('guild_id')
        .setDescription('L\'identifiant unique (ID) du serveur Discord')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('active')
        .setDescription('Activer (true) ou désactiver (false) le statut Premium (défaut: true)')
        .setRequired(false)
    ),

  /**
   * Exécute la commande développeur /premium
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    const callerId = interaction.user.id;

    // Vérification stricte des droits développeur / propriétaire du bot
    const isOwner = callerId === config.discord.ownerId ||
                    interaction.client.application?.owner?.id === callerId;

    if (!isOwner) {
      logger.warn(`[SAAS-SECURITY] Tentative non autorisée d'accès à /premium par ${interaction.user.tag} (${callerId})`);
      return interaction.reply({
        content: '⛔ **Accès refusé** : Cette commande secrète est strictement réservée au développeur et propriétaire du bot.',
        ephemeral: true
      });
    }

    const targetGuildId = interaction.options.getString('guild_id').trim();
    const shouldActivate = interaction.options.getBoolean('active') ?? true;

    // Mise à jour en base de données
    databaseService.setGuildPremium(targetGuildId, shouldActivate);

    // Tentative de récupération du nom de la guilde depuis le cache Discord
    const targetGuild = interaction.client.guilds.cache.get(targetGuildId);
    const targetName = targetGuild ? targetGuild.name : 'Serveur inconnu';

    const newLimit = shouldActivate ? SAAS_LIMITS.PREMIUM : SAAS_LIMITS.FREE;

    const embed = new EmbedBuilder()
      .setColor(shouldActivate ? 0xFEE75C : 0xED4245)
      .setTitle(`🌟 Monétisation SaaS : ${shouldActivate ? 'Serveur Passé Premium' : 'Premium Révoqué'}`)
      .setDescription(`Le statut SaaS du serveur **${targetName}** a été mis à jour avec succès.`)
      .addFields(
        { name: '🏰 Serveur', value: `\`${targetName}\` (\`${targetGuildId}\`)`, inline: false },
        { name: '💎 Statut', value: shouldActivate ? '✅ **PREMIUM ACTIF**' : '❌ **GRATUIT (FREEMIUM)**', inline: true },
        { name: '⚡ Quota Quotidien', value: `\`${newLimit.toLocaleString('fr-FR')} tokens / jour\``, inline: true }
      )
      .setFooter({ text: `Action exécutée par le développeur ${interaction.user.tag}` })
      .setTimestamp();

    logger.info(`[SAAS-MONETIZATION] Serveur ${targetGuildId} (${targetName}) passé à Premium=${shouldActivate} par ${interaction.user.tag}`);

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }
};
