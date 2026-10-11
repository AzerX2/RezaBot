import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { aiService } from '../../services/aiService.js';
import { databaseService } from '../../services/databaseService.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('end-observation')
    .setDescription('Termine la période d\'observation, calibre l\'ambiance du serveur et active RezaBot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  /**
   * Exécution de la commande /end-observation
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

    // Différer la réponse car l'analyse IA nécessite quelques secondes
    await interaction.deferReply();

    const guildId = interaction.guildId;
    const guildName = interaction.guild.name;

    try {
      logger.info(`[OBSERVATION-END] Clôture du mode observation demandée par ${interaction.user.tag} sur ${guildName}...`);

      // 1. Récupération des logs d'observation depuis la base vectorielle ChromaDB
      let observationLogs = [];
      if (interaction.client.ragService) {
        observationLogs = await interaction.client.ragService.getObservationLogs(guildId, 50);
      }

      logger.info(`[OBSERVATION-END] ${observationLogs.length} messages d'observation récupérés pour analyse.`);

      // 2. Synthèse comportementale par le modèle IA (Vibe Check)
      const { serverVibe, analysis } = await aiService.analyzeServerVibe(observationLogs, guildName);

      // 3. Sauvegarde en base de données : botMode = 'active' et mise à jour du serverVibe
      databaseService.setGuildSettings(guildId, {
        botMode: 'active',
        serverVibe: serverVibe
      });

      // 4. Construction de l'Embed de résultat pour les administrateurs et la communauté
      const embed = new EmbedBuilder()
        .setColor(0x00FA9A) // Vert vif dynamique
        .setTitle(`🎓 Fin d'Observation & Vibe Check Validé !`)
        .setDescription(
          `RezaBot a terminé sa période d'apprentissage sur **${guildName}** !\n` +
          `Il a assimilé les codes de votre communauté et passe dès à présent en mode **Actif**.`
        )
        .addFields(
          {
            name: '🎭 Profil d\'Ambiance Détecté (Server Vibe)',
            value: `**« ${serverVibe} »**`,
            inline: false
          },
          {
            name: '🧠 Analyse Comportementale',
            value: analysis,
            inline: false
          },
          {
            name: '📊 Données Observées',
            value: `\`${observationLogs.length}\` message(s) analysé(s)`,
            inline: true
          },
          {
            name: '⚡ Nouveau Statut',
            value: '`Actif` (Concierge & Modération opérationnels)',
            inline: true
          }
        )
        .setFooter({ text: 'RezaBot adaptera désormais son ton et sa tolérance à ce profil d\'ambiance.' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      logger.info(`[OBSERVATION-END] RezaBot est désormais actif sur ${guildName} avec le vibe: "${serverVibe}".`);
    } catch (error) {
      logger.error(`[OBSERVATION-END] Erreur lors de la clôture de l'observation sur ${guildId} :`, error);
      await interaction.editReply({
        content: `❌ Une erreur est survenue lors de l'analyse comportementale : ${error.message}`
      });
    }
  }
};
