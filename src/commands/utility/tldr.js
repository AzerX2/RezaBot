import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { aiService } from '../../services/aiService.js';
import { databaseService } from '../../services/databaseService.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('tldr')
    .setDescription('Résume les derniers échanges de ce salon pour rattraper la discussion')
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('Nombre de messages à analyser (entre 10 et 100, défaut: 50)')
        .setMinValue(10)
        .setMaxValue(100)
        .setRequired(false)
    ),

  /**
   * Exécute la commande /tldr
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    const limit = interaction.options.getInteger('limit') || 50;
    const guildId = interaction.guild?.id || 'global';

    await interaction.deferReply();

    // 1. Vérification du quota SaaS
    const quota = databaseService.checkTokenQuota(guildId, 250);
    if (!quota.allowed) {
      await interaction.editReply({
        content: "⚡ Quota de tokens quotidien atteint sur ce serveur. Impossible de générer le résumé pour le moment."
      });
      return;
    }

    try {
      // 2. Récupération des messages récents dans le salon
      if (!interaction.channel?.messages?.fetch) {
        await interaction.editReply({
          content: "Impossible d'accéder aux messages de ce salon."
        });
        return;
      }

      const fetched = await interaction.channel.messages.fetch({ limit });
      const rawList = Array.from(fetched.values())
        .filter(m => m && !m.author?.bot && m.content?.trim() && !m.content.startsWith('/') && !m.content.startsWith('!'))
        .sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0));

      if (rawList.length < 3) {
        await interaction.editReply({
          content: "Pas assez de messages textuels récents dans ce salon pour établir un résumé pertinent."
        });
        return;
      }

      const formattedMessages = rawList.map(m => ({
        author: m.member?.displayName || m.author.username,
        content: m.content.trim(),
        timestamp: new Date(m.createdTimestamp || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      }));

      // 3. Synthèse via aiService.summarizeChat
      const summaryText = await aiService.summarizeChat(formattedMessages);

      // Décompte FinOps
      const estimatedTokens = Math.ceil(summaryText.length / 3.5);
      databaseService.trackTokenUsage(guildId, estimatedTokens);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📌 Résumé TL;DR - #${interaction.channel.name || 'salon'}`)
        .setDescription(summaryText)
        .setFooter({ text: `Analyse basée sur ${rawList.length} messages • RezaBot` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      logger.info(`[TLDR] Résumé généré pour #${interaction.channel.name} (${rawList.length} messages)`);
    } catch (err) {
      logger.error('[TLDR] Erreur lors de la génération du résumé :', err);
      await interaction.editReply({
        content: "Désolé, une erreur est survenue lors de la génération du résumé de ce salon."
      });
    }
  }
};
