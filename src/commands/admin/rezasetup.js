import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { databaseService } from '../../services/databaseService.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('rezasetup')
    .setDescription('Configure le rôle et le comportement du bot sur ce serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option
        .setName('role')
        .setDescription('Comportement et niveau d\'autorité du bot sur ce serveur')
        .setRequired(false)
        .addChoices(
          { name: 'Membre', value: 'member' },
          { name: 'Modérateur', value: 'moderator' },
          { name: 'Administrateur', value: 'admin' }
        )
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

    if (newRole) {
      databaseService.setGuildSettings(guildId, {
        bot_role: newRole,
        botRole: newRole
      });
      logger.info(`[REZA-SETUP] Guilde "${guildName}" (${guildId}) configurée par ${interaction.user.tag} (Rôle: ${newRole})`);
    }

    const updatedSettings = databaseService.getGuildSettings(guildId);

    const roleDetails = {
      member: {
        label: '👤 Membre',
        description: 'Simple participant, ton amical, aucune autorité. Outils : Recherche Web, Heure Serveur.'
      },
      moderator: {
        label: '🛡️ Modérateur',
        description: 'Garant de la paix. Outils : Timeout temporaire (timeout_user) et suppression de messages (delete_message).'
      },
      admin: {
        label: '👑 Administrateur',
        description: 'Gérant complet. Outils : Modération + Création (create_channel) et suppression de salons avec confirmation (delete_channel).'
      }
    };

    const activeRoleInfo = roleDetails[updatedSettings.bot_role] || roleDetails.member;

    const isPremium = updatedSettings.is_premium;
    const quotaText = isPremium
      ? '🌟 **Offre Premium** (`500 000 tokens / jour`)'
      : '⚡ **Offre Gratuite** (`20 000 tokens / jour`)\n*Pour passer à l\'offre Premium (500k tokens), contactez le créateur du bot.*';

    const embed = new EmbedBuilder()
      .setColor(isPremium ? 0xFEE75C : 0x5865F2)
      .setTitle(`⚙️ Configuration RezaBot : ${guildName}`)
      .setDescription('Les paramètres de comportement du bot ont été appliqués avec succès.')
      .addFields(
        {
          name: '🎭 Rôle & Droits du Bot',
          value: `**${activeRoleInfo.label}**\n*${activeRoleInfo.description}*`,
          inline: false
        },
        {
          name: '📦 Formule SaaS & Quota IA',
          value: quotaText,
          inline: false
        },
        {
          name: '📊 Consommation du Jour',
          value: `\`${updatedSettings.tokens_used_today.toLocaleString('fr-FR')} / ${updatedSettings.daily_token_quota.toLocaleString('fr-FR')} tokens\``,
          inline: true
        },
        {
          name: '📌 Ambiance & Mode',
          value: `Vibe : \`${updatedSettings.serverVibe}\` | Mode : \`${updatedSettings.botMode}\``,
          inline: true
        }
      )
      .setFooter({ text: 'RezaBot SaaS • Quotas gérés de manière centralisée' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
