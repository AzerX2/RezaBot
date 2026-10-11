import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { databaseService } from '../../services/databaseService.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('rezasetup')
    .setDescription('Configure le rôle du bot et le quota de tokens IA sur ce serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option
        .setName('role')
        .setDescription('Comportement et autorité du bot sur ce serveur')
        .setRequired(false)
        .addChoices(
          { name: 'Membre', value: 'member' },
          { name: 'Modérateur', value: 'moderator' },
          { name: 'Administrateur', value: 'admin' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('quota')
        .setDescription('Limite maximale de tokens IA consommables par jour sur ce serveur (ex: 50000)')
        .setRequired(false)
        .setMinValue(1000)
        .setMaxValue(1000000)
    ),

  /**
   * Exécute la commande /rezasetup
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: 'Cette commande ne peut être exécutée que dans un serveur.',
        ephemeral: true
      });
    }

    const guildId = interaction.guild.id;
    const guildName = interaction.guild.name;

    const newRole = interaction.options.getString('role');
    const newQuota = interaction.options.getInteger('quota');

    const updates = {};
    if (newRole) {
      updates.bot_role = newRole;
      updates.botRole = newRole;
    }

    if (newQuota !== null) {
      updates.daily_token_quota = newQuota;
      updates.dailyTokenQuota = newQuota;
    }

    if (Object.keys(updates).length > 0) {
      databaseService.setGuildSettings(guildId, updates);
      logger.info(`[REZA-SETUP] Guilde "${guildName}" (${guildId}) configurée par ${interaction.user.tag} :`, updates);
    }

    const updatedSettings = databaseService.getGuildSettings(guildId);

    const roleDetails = {
      member: {
        label: '👤 Membre',
        description: 'Discussions amicales, sans autorité. Outils : Recherche Web, Heure Serveur.'
      },
      moderator: {
        label: '🛡️ Modérateur',
        description: 'Garant de la paix. Outils : Timeout temporaire (timeout_user) et suppression de messages (delete_message).'
      },
      admin: {
        label: '👑 Administrateur',
        description: 'Gérant du serveur. Outils : Modération + Création (create_channel) et suppression de salons (delete_channel).'
      }
    };

    const activeRoleInfo = roleDetails[updatedSettings.bot_role] || roleDetails.member;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`⚙️ Configuration RezaBot : ${guildName}`)
      .setDescription('Les paramètres de permissions et de quota IA du serveur ont été appliqués avec succès.')
      .addFields(
        {
          name: '🎭 Rôle & Droits du Bot',
          value: `**${activeRoleInfo.label}**\n*${activeRoleInfo.description}*`,
          inline: false
        },
        {
          name: '⚡ Quota Quotidien de Tokens IA',
          value: `\`${updatedSettings.daily_token_quota.toLocaleString('fr-FR')} tokens / jour\``,
          inline: true
        },
        {
          name: '📊 Consommation du Jour',
          value: `\`${updatedSettings.tokens_used_today.toLocaleString('fr-FR')} / ${updatedSettings.daily_token_quota.toLocaleString('fr-FR')} tokens\``,
          inline: true
        },
        {
          name: '📌 Ambiance & Mode',
          value: `Vibe : \`${updatedSettings.serverVibe}\` | Mode : \`${updatedSettings.botMode}\``,
          inline: false
        }
      )
      .setFooter({ text: 'RezaBot • Administration Multi-Serveur' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
