import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../../config.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Affiche le guide complet d\'utilisation et des commandes de RezaBot'),

  /**
   * Exécution de la commande /help (100% statique, 0 token consommé)
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2) // Blurple Discord
      .setTitle('📖 Guide d\'utilisation de RezaBot')
      .setDescription('Voici tout ce que vous devez savoir pour interagir et tirer le meilleur parti de **RezaBot** sur votre serveur !')
      .addFields(
        {
          name: '💬 Comment me parler',
          value: 'Mentionnez-moi (@RezaBot) ou dites simplement mon nom (**reza**) dans un message pour qu\'on discute !'
        },
        {
          name: '🛠️ Commandes Publiques',
          value: '• `/help` : Affiche ce menu d\'aide interactif.\n• `/tldr` : Résume les derniers échanges d\'un salon sans tout relire.'
        },
        {
          name: '🛡️ Commandes Admin',
          value: '• `/rezasetup` : Configure mon rôle (membre, modérateur, admin) et mon niveau d\'autorité.\n• `/sync-memory` : Injecte manuellement des documents et règles dans ma mémoire RAG.\n• `/config-channels` : Définit les salons de bienvenue et de logs.'
        },
        {
          name: '🧠 Capacités passives',
          value: 'Je lis discrètement les échanges, retiens le contexte du serveur et les faits de la communauté. Si une conversation devient particulièrement animée ou drôle, il m\'arrive d\'intervenir tout seul pour participer au débat ! 👀'
        }
      )
      .setFooter({ text: 'RezaBot • Concierge IA Multi-Serveurs • 0 Token Consommé' })
      .setTimestamp();

    // Boutons de liens utiles
    const clientId = config.discord.clientId || interaction.client.user?.id || '809820389554782310';
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Inviter le bot ailleurs')
        .setEmoji('🤖')
        .setStyle(ButtonStyle.Link)
        .setURL(inviteUrl),
      new ButtonBuilder()
        .setLabel('Soutien / GitHub')
        .setEmoji('⭐')
        .setStyle(ButtonStyle.Link)
        .setURL('https://github.com/AzerX2/RezaBot')
    );

    await interaction.reply({
      embeds: [embed],
      components: [row]
    });
  }
};
