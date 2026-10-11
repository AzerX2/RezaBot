import { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } from 'discord.js';
import { Document } from '@langchain/core/documents';
import { actionTicketManager } from '../services/actionTicketManager.js';
import { databaseService } from '../services/databaseService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.InteractionCreate,
  once: false,

  /**
   * Gestionnaire central des interactions Discord (Slash Commands & Boutons)
   * @param {import('discord.js').Interaction} interaction
   */
  async execute(interaction) {
    // =========================================================================
    // 1. GESTION DES BOUTONS INTERACTIFS (Feedback Loop & Modération)
    // =========================================================================
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
      return;
    }

    // =========================================================================
    // 2. GESTION DES COMMANDES SLASH
    // =========================================================================
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`[INTERACTION] Commande inconnue reçue : /${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error(`[INTERACTION] Erreur lors de l'exécution de /${interaction.commandName} :`, error);
      const errorMessage = {
        content: 'Une erreur interne est survenue lors de l\'exécution de cette commande.',
        ephemeral: true
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage).catch(() => {});
      } else {
        await interaction.reply(errorMessage).catch(() => {});
      }
    }
  }
};

/**
 * Traite les interactions de boutons (modération, apprentissage continu et validation agentique)
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleButtonInteraction(interaction) {
  const { customId } = interaction;

  // =========================================================================
  // BOUTONS D'ACTION AGENTIQUE (Prompt 11 : Validation Humaine & Suppression)
  // =========================================================================
  if (customId.startsWith('confirm_action_') || customId.startsWith('cancel_action_')) {
    // Vérification stricte des permissions Administrateur
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
                    interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

    if (!isAdmin) {
      await interaction.reply({
        content: '❌ Seul un administrateur du serveur a la permission de valider ou annuler cette action.',
        ephemeral: true
      });
      return;
    }

    const ticketId = customId.startsWith('confirm_action_')
      ? customId.replace('confirm_action_', '')
      : customId.replace('cancel_action_', '');

    const ticket = actionTicketManager.getTicket(ticketId) || databaseService.getActionTicket(ticketId);

    // 1. Bouton Annuler
    if (customId.startsWith('cancel_action_')) {
      if (ticket) {
        actionTicketManager.deleteTicket(ticketId);
        databaseService.deleteActionTicket(ticketId);
      }
      await interaction.update({
        content: '❌ Action annulée',
        embeds: [],
        components: []
      });
      logger.info(`[AGENTIC-ACTION] Action ${ticketId} annulée par l'administrateur ${interaction.user.tag}`);
      return;
    }

    // 2. Bouton Confirmer
    if (customId.startsWith('confirm_action_')) {
      if (!ticket) {
        await interaction.reply({
          content: '❌ Ce ticket d\'action a expiré ou a déjà été traité.',
          ephemeral: true
        });
        return;
      }

      // Exécution de l'action selon son type en JavaScript natif (zéro IA)
      if (ticket.type === 'create_category') {
        if (interaction.guild?.channels?.create) {
          try {
            const categoryName = ticket.categoryName || 'Nouvelle Catégorie';
            const childChannels = ticket.channels || [];

            // Crée la catégorie via l'API Discord
            const createdCategory = await interaction.guild.channels.create({
              name: categoryName,
              type: ChannelType.GuildCategory,
              reason: ticket.reason || 'Création de catégorie confirmée par administrateur'
            });

            // Boucle pour créer les salons enfants dedans
            if (Array.isArray(childChannels)) {
              for (const chanName of childChannels) {
                const cleanChanName = String(chanName).trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
                await interaction.guild.channels.create({
                  name: cleanChanName || chanName,
                  type: ChannelType.GuildText,
                  parent: createdCategory.id,
                  reason: `Création du salon enfant pour la catégorie ${categoryName}`
                });
              }
            }

            logger.info(`[AGENTIC-ACTION] Catégorie "${categoryName}" et ses salons créés avec succès sur ${interaction.guild.name}.`);
          } catch (createErr) {
            logger.error('[AGENTIC-ACTION] Erreur lors de la création de la catégorie et salons :', createErr);
          }
        }
      } else if (ticket.type === 'delete_channels') {
        if (ticket.channels && Array.isArray(ticket.channels) && interaction.guild) {
          for (const chanInfo of ticket.channels) {
            try {
              const chan = interaction.guild.channels.cache.get(chanInfo.id) ||
                           interaction.guild.channels.cache.find(c => c.name?.toLowerCase() === chanInfo.name?.toLowerCase()) ||
                           await interaction.guild.channels.fetch(chanInfo.id).catch(() => null);

              if (chan && typeof chan.delete === 'function') {
                await chan.delete(ticket.reason || 'Suppression confirmée par administrateur');
                logger.info(`[AGENTIC-ACTION] Salon #${chanInfo.name} (${chanInfo.id}) supprimé sur ${interaction.guild.name}.`);
              }
            } catch (delErr) {
              logger.error(`[AGENTIC-ACTION] Erreur lors de la suppression du salon #${chanInfo.name} :`, delErr);
            }
          }
        }
      } else if (ticket.type === 'rename_channel') {
        if (interaction.guild) {
          try {
            const targetId = ticket.channelId || ticket.channels?.[0]?.id;
            const chan = interaction.guild.channels.cache.get(targetId) ||
                         interaction.guild.channels.cache.find(c => c.name?.toLowerCase() === ticket.channelName?.toLowerCase()) ||
                         await interaction.guild.channels.fetch(targetId).catch(() => null);

            if (chan && typeof chan.setName === 'function') {
              await chan.setName(ticket.newName, ticket.reason || 'Renommage confirmé par administrateur');
              logger.info(`[AGENTIC-ACTION] Salon #${ticket.channelName || targetId} renommé en "${ticket.newName}" sur ${interaction.guild.name}.`);
            }
          } catch (renErr) {
            logger.error(`[AGENTIC-ACTION] Erreur lors du renommage du salon :`, renErr);
          }
        }
      }

      actionTicketManager.deleteTicket(ticketId);
      databaseService.deleteActionTicket(ticketId);

      const finalContent = ticket.type === 'create_category'
        ? '✅ La catégorie et les salons ont été créés avec succès !'
        : '✅ Fait !';

      await interaction.update({
        content: finalContent,
        embeds: [],
        components: []
      });
      logger.info(`[AGENTIC-ACTION] Action ${ticketId} validée et exécutée par ${interaction.user.tag}`);
      return;
    }
  }

  // Filtrage des boutons gérés par le module de modération IA
  if (!customId.startsWith('mod_validate_') && !customId.startsWith('mod_false_positive_')) {
    return;
  }

  // Vérification des permissions de modération
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      content: '❌ Vous devez avoir la permission de gérer les messages pour valider ou corriger un incident de modération.',
      ephemeral: true
    });
    return;
  }

  const originalEmbed = interaction.message.embeds[0];
  if (!originalEmbed) {
    await interaction.reply({
      content: '❌ Impossible de retrouver les données de l\'incident sur ce message.',
      ephemeral: true
    });
    return;
  }

  // =========================================================================
  // BOUTON ROUGE : FAUX POSITIF (Apprentissage continu de l'IA via ChromaDB)
  // =========================================================================
  if (customId.startsWith('mod_false_positive_')) {
    try {
      // 1. Extraction du texte original ayant été flaggé
      const contentField = originalEmbed.fields.find(f => f.name === 'Contenu du message');
      let rawText = '';
      if (contentField) {
        // Nettoyage des backticks de formatage Markdown
        rawText = contentField.value.replace(/^```|```$/g, '').trim();
      }

      if (!rawText) {
        await interaction.reply({
          content: '❌ Impossible d\'extraire le contenu du message d\'origine pour l\'apprentissage.',
          ephemeral: true
        });
        return;
      }

      logger.info(`[FEEDBACK-LOOP] Faux positif signalé par ${interaction.user.tag} sur guild ${interaction.guildId} pour : "${rawText.slice(0, 50)}..."`);

      // 2. Création du Document LangChain pour l'apprentissage de la règle d'exception
      const overrideDoc = new Document({
        pageContent: `Règle d'exception : L'expression '${rawText}' est considérée comme acceptable sur ce serveur et ne doit pas être modérée.`,
        metadata: {
          type: 'override',
          guildId: String(interaction.guildId),
          originalContent: rawText,
          moderatorId: interaction.user.id,
          moderatorTag: interaction.user.tag,
          createdAt: new Date().toISOString()
        }
      });

      // 3. Ingestion dans ChromaDB via ragService pour le serveur en cours
      if (interaction.client.ragService) {
        await interaction.client.ragService.ingestDocuments([overrideDoc], interaction.guildId);
      }

      // 4. Mise à jour visuelle du message de log
      const updatedEmbed = EmbedBuilder.from(originalEmbed)
        .setColor(0x2ECC71) // Vert validation
        .setTitle(`✅ Incident Annulé - Faux Positif [${interaction.guild?.name || 'Serveur'}]`)
        .addFields({
          name: '🧠 Apprentissage IA validé',
          value: `L'IA a mis à jour sa mémoire : **« L'IA a appris que ce comportement est toléré ici »**.\n*Signalé par <@${interaction.user.id}>*`,
          inline: false
        });

      // Remplacement des boutons par un statut figé
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_fp_archived')
          .setLabel('Faux Positif Enregistré dans la mémoire RAG')
          .setEmoji('🧠')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      await interaction.update({
        embeds: [updatedEmbed],
        components: [disabledRow]
      });

      logger.info(`[FEEDBACK-LOOP] Règle d'exception vectorisée avec succès pour le serveur ${interaction.guildId}.`);
    } catch (err) {
      logger.error(`[FEEDBACK-LOOP] Erreur lors de l'enregistrement du faux positif :`, err);
      await interaction.reply({
        content: `❌ Une erreur est survenue lors de l'enregistrement de l'exception : ${err.message}`,
        ephemeral: true
      });
    }
    return;
  }

  // =========================================================================
  // BOUTON VERT : VALIDER LA SANCTION
  // =========================================================================
  if (customId.startsWith('mod_validate_')) {
    try {
      const updatedEmbed = EmbedBuilder.from(originalEmbed)
        .setColor(0x27AE60) // Vert foncé confirmation
        .setTitle(`🛡️ Incident Confirmé par la Modération [${interaction.guild?.name || 'Serveur'}]`)
        .addFields({
          name: '👮 Décision Modérateur',
          value: `Sanction et avertissement confirmés par <@${interaction.user.id}>.`,
          inline: false
        });

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_val_archived')
          .setLabel('Sanction Validée')
          .setEmoji('🛡️')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true)
      );

      await interaction.update({
        embeds: [updatedEmbed],
        components: [disabledRow]
      });

      logger.info(`[MODERATION-VALIDATE] Sanction validée par ${interaction.user.tag} sur guild ${interaction.guildId}.`);
    } catch (err) {
      logger.error(`[MODERATION-VALIDATE] Erreur lors de la validation :`, err);
    }
  }
}
