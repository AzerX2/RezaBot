import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder
} from 'discord.js';
import { databaseService } from '../../services/databaseService.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('config-channels')
    .setDescription('Configure dynamiquement les salons de RezaBot pour votre serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('logs')
        .setDescription('Salon privé pour les alertes de modération et faux positifs')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addChannelOption((option) =>
      option
        .setName('welcome')
        .setDescription('Salon public pour les messages d\'accueil personnalisés par l\'IA')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addChannelOption((option) =>
      option
        .setName('main')
        .setDescription('Salon principal pour les animations et relances automatiques')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  /**
   * Exécution de la commande /config-channels
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: 'Cette commande doit être exécutée au sein d\'un serveur Discord.',
        ephemeral: true
      });
      return;
    }

    const guildId = interaction.guildId;
    const guildName = interaction.guild.name;

    const logChannel = interaction.options.getChannel('logs');
    const welcomeChannel = interaction.options.getChannel('welcome');
    const mainChannel = interaction.options.getChannel('main');

    // Récupération de la configuration existante
    const currentSettings = databaseService.getGuildSettings(guildId);
    const updates = {};
    const changes = [];

    if (logChannel) {
      updates.logChannelId = logChannel.id;
      changes.push(`• **Logs de modération :** <#${logChannel.id}>`);
    }
    if (welcomeChannel) {
      updates.welcomeChannelId = welcomeChannel.id;
      changes.push(`• **Accueil des membres :** <#${welcomeChannel.id}>`);
    }
    if (mainChannel) {
      updates.mainChannelId = mainChannel.id;
      changes.push(`• **Salon principal / animation :** <#${mainChannel.id}>`);
    }

    // Si des modifications ont été fournies, on met à jour la base SQLite
    if (Object.keys(updates).length > 0) {
      databaseService.setGuildSettings(guildId, updates);
      logger.info(`[CONFIG-CHANNELS] Salons mis à jour pour ${guildName} (${guildId}) :`, updates);
    }

    // Récupération des paramètres à jour
    const updated = databaseService.getGuildSettings(guildId);

    const embed = new EmbedBuilder()
      .setColor(0x5865F2) // Blurple Discord
      .setTitle(`⚙️ Configuration des Salons - ${guildName}`)
      .setDescription(
        changes.length > 0
          ? `✅ **Modifications enregistrées avec succès pour ce serveur !**\n\n${changes.join('\n')}`
          : `Voici la configuration actuelle des salons pour votre serveur :`
      )
      .addFields(
        {
          name: '🛡️ Alertes & Logs Modération',
          value: updated.logChannelId ? `<#${updated.logChannelId}>` : '*Non configuré (aucun log envoyé)*',
          inline: true
        },
        {
          name: '👋 Accueil IA des Nouveaux',
          value: updated.welcomeChannelId ? `<#${updated.welcomeChannelId}>` : '*Non configuré (système par défaut)*',
          inline: true
        },
        {
          name: '💬 Salon Principal / Relance',
          value: updated.mainChannelId ? `<#${updated.mainChannelId}>` : '*Non configuré (détection automatique)*',
          inline: true
        }
      )
      .setFooter({ text: 'Chaque serveur gère ses propres salons indépendamment en base de données.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
