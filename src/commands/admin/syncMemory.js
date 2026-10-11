import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder
} from 'discord.js';
import { Document } from '@langchain/core/documents';
import { fetchChannelHistory } from '../../utils/historyScraper.js';
import { knowledgeExtractor } from '../../services/knowledgeExtractor.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('sync-memory')
    .setDescription('Aspire et extrait les connaissances d\'un salon pour enrichir la mémoire RAG du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Le salon textuel à analyser et indexer')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription('Nombre maximal de messages bruts à explorer (défaut: 1000, max: 5000)')
        .setMinValue(50)
        .setMaxValue(5000)
        .setRequired(false)
    ),

  /**
   * Exécution de la commande /sync-memory
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

    const targetChannel = interaction.options.getChannel('channel');
    const requestedLimit = interaction.options.getInteger('limit') || 1000;
    const guildId = interaction.guildId;
    const guildName = interaction.guild.name;

    // 1. Accusé de réception immédiat avec réponse différée
    await interaction.deferReply();

    // Vérification des permissions du bot dans le salon ciblé
    const me = interaction.guild.members.me;
    const channelPerms = targetChannel.permissionsFor(me);
    if (!channelPerms || !channelPerms.has(PermissionFlagsBits.ViewChannel) || !channelPerms.has(PermissionFlagsBits.ReadMessageHistory)) {
      await interaction.editReply({
        content: `❌ RezaBot ne dispose pas des permissions requises (**Voir le salon** et **Lire l'historique des messages**) dans <#${targetChannel.id}>.`
      });
      return;
    }

    let lastEditTime = 0;
    const safeUpdateReply = async (statusText) => {
      const now = Date.now();
      // Temporisation de 3 secondes pour respecter les rate-limits de editReply
      if (now - lastEditTime >= 3000) {
        lastEditTime = now;
        await interaction.editReply({ content: statusText }).catch(() => {});
      }
    };

    try {
      logger.info(`[SYNC-MEMORY] Lancement par ${interaction.user.tag} sur #${targetChannel.name} (Objectif: ${requestedLimit} msgs)...`);

      await interaction.editReply({
        content: `⏳ **Étape 1/3 : Aspiration de l'historique...**\nRecherche des messages dans <#${targetChannel.id}> (objectif : jusqu'à ${requestedLimit} messages)...`
      });

      // 2. Étape 1 : Moissonnage et filtrage du bruit
      const filteredMessages = await fetchChannelHistory(
        targetChannel,
        requestedLimit,
        async ({ fetchedRaw, retainedFiltered, targetLimit }) => {
          await safeUpdateReply(
            `🔄 **Étape 1/3 : Aspiration en cours...**\n` +
            `• Messages bruts explorés : **${fetchedRaw}/${targetLimit}**\n` +
            `• Messages retenus (bruit et bots éliminés) : **${retainedFiltered}**`
          );
        }
      );

      if (filteredMessages.length === 0) {
        await interaction.editReply({
          content: `⚠️ Aucun message informatif exploitable n'a été trouvé dans <#${targetChannel.id}> après filtrage du bruit.`
        });
        return;
      }

      await interaction.editReply({
        content: `🧠 **Étape 2/3 : Extraction de la connaissance par l'IA...**\nAnalyse sémantique de **${filteredMessages.length}** messages filtrés (par lots de 100)...`
      });

      // 3. Étape 2 : Extraction par lot avec LLM (gpt-4o-mini)
      const extractedCards = await knowledgeExtractor.extractKnowledge(
        filteredMessages,
        {
          guildName,
          channelName: targetChannel.name
        },
        async ({ currentBatch, totalBatches, cardsCount }) => {
          await safeUpdateReply(
            `🧠 **Étape 2/3 : Analyse IA en cours...**\n` +
            `• Lot en cours d'analyse : **${currentBatch}/${totalBatches}**\n` +
            `• Fiches de connaissance extraites : **${cardsCount}**`
          );
        }
      );

      if (extractedCards.length === 0) {
        await interaction.editReply({
          content: `ℹ️ L'analyse de <#${targetChannel.id}> n'a révélé aucun fait durable, consensus ou règle implicite pérenne.`
        });
        return;
      }

      await interaction.editReply({
        content: `💾 **Étape 3/3 : Vectorisation & Injection RAG...**\nCalcul des embeddings et insertion de **${extractedCards.length}** fiche(s) dans ChromaDB...`
      });

      // 4. Étape 3 : Conversion en Documents LangChain et ingestion ChromaDB
      const documentsToIngest = extractedCards.map((card, idx) => {
        const pageContent = `[${(card.category || 'FAQ').toUpperCase()}] ${card.title} :\n${card.content}`;
        return new Document({
          pageContent,
          metadata: {
            guildId,
            type: 'extracted_knowledge',
            category: card.category || 'Connaissance',
            title: card.title || `Fiche #${idx + 1}`,
            sourceChannel: targetChannel.name,
            channelId: targetChannel.id,
            tags: Array.isArray(card.tags) ? card.tags.join(', ') : (card.tags || ''),
            extractedAt: new Date().toISOString()
          }
        });
      });

      if (interaction.client.ragService) {
        await interaction.client.ragService.ingestDocuments(documentsToIngest, guildId);
      } else {
        throw new Error('Le service RAG n\'est pas initialisé sur le client Discord.');
      }

      // 5. Compte-rendu final sous forme d'Embed riche
      const previewExamples = extractedCards
        .slice(0, 4)
        .map((c, i) => `**${i + 1}. [${c.category}] ${c.title}**\n> *${c.content.slice(0, 150)}${c.content.length > 150 ? '...' : ''}*`)
        .join('\n\n');

      const completionEmbed = new EmbedBuilder()
        .setColor(0x00E676) // Vert succès vif
        .setTitle(`📚 Mémoire Synchronisée avec Succès !`)
        .setDescription(
          `L'aspiration et l'extraction de connaissances sur <#${targetChannel.id}> sont terminées !\n` +
          `RezaBot a assimilé ces données et les utilisera désormais lors de ses échanges Concierge.`
        )
        .addFields(
          {
            name: '📊 Statistiques d\'Extraction',
            value:
              `• **Messages bruts explorés :** \`${filteredMessages.length}\`\n` +
              `• **Pépites de connaissance créées :** \`${extractedCards.length}\`\n` +
              `• **Modèle d'extraction :** \`gpt-4o-mini\` (FinOps Tier Economy)`,
            inline: false
          },
          {
            name: '✨ Exemples de Connaissances Mémorisées',
            value: previewExamples || 'Fiches indexées dans la base vectorielle.',
            inline: false
          }
        )
        .setFooter({ text: `Indexé dans ChromaDB pour le serveur ${guildName}` })
        .setTimestamp();

      await interaction.editReply({
        content: null,
        embeds: [completionEmbed]
      });

      logger.info(`[SYNC-MEMORY] Terminé avec succès pour guild ${guildId} : ${extractedCards.length} documents ajoutés au RAG.`);
    } catch (error) {
      logger.error(`[SYNC-MEMORY] Erreur critique lors de la synchronisation de <#${targetChannel.id}> :`, error);
      await interaction.editReply({
        content: `❌ Une erreur critique est survenue lors de la synchronisation : \`${error.message}\``
      });
    }
  }
};
