import { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { aiService } from '../services/aiService.js';
import { databaseService } from '../services/databaseService.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.MessageCreate,
  once: false,

  /**
   * Exécution de l'événement messageCreate avec étanchéité multi-serveur
   * @param {import('discord.js').Message} message
   */
  async execute(message) {
    // 1. Ignorer les messages de bots et les messages privés hors guilde
    if (message.author.bot || !message.guild) return;

    const content = message.content?.trim();
    if (!content) return;

    const guildId = message.guild.id;
    const guildName = message.guild.name;

    // Récupération des paramètres spécifiques à cette guilde (Multi-tenancy)
    const guildSettings = databaseService.getGuildSettings(guildId);
    const guildContext = {
      guildId,
      guildName,
      botMode: guildSettings.botMode,
      serverVibe: guildSettings.serverVibe,
      bot_role: guildSettings.bot_role || guildSettings.botRole || 'member'
    };

    // =========================================================================
    // CAS 0 : MODE OBSERVATION (Apprentissage silencieux de l'ambiance)
    // =========================================================================
    if (guildSettings.botMode === 'observing') {
      if (message.client.ragService) {
        // Enregistre discrètement le message dans le RAG sans jamais intervenir
        message.client.ragService.recordObservation(
          guildId,
          message.author.username,
          content,
          message.channel.name || 'salon'
        ).catch(() => {});
      }
      // En mode observation, le bot reste 100% silencieux (pas de réponse, pas de modération)
      return;
    }

    const botUser = message.client.user;
    const isBotMentioned = botUser && message.mentions.has(botUser.id) && !message.mentions.everyone;
    const nameRegex = /\b(reza|rezabot)\b/i;
    const isNameCalled = nameRegex.test(content);

    // =========================================================================
    // CAS 1 : INTERACTION CONCIERGE (Mention @RezaBot OU écoute active de son prénom)
    // =========================================================================
    if (isBotMentioned || isNameCalled) {
      try {
        await message.channel.sendTyping();

        // Nettoyage de la mention et du prénom dans le texte pour ne garder que la question
        let cleanQuestion = content;
        if (botUser) {
          cleanQuestion = cleanQuestion.replace(new RegExp(`<@!?${botUser.id}>`, 'g'), '');
        }
        cleanQuestion = cleanQuestion.replace(/\b(reza|rezabot)\b/gi, '').trim();

        if (!cleanQuestion) {
          await message.reply(`Bonjour ! Tu m'as appelé sur **${guildName}**, comment puis-je t'aider aujourd'hui ? 😊`);
          return;
        }

        // =====================================================================
        // FINOPS : VÉRIFICATION DU QUOTA QUOTIDIEN DE TOKENS
        // =====================================================================
        const quotaCheck = databaseService.checkTokenQuota(guildId, 450);
        if (!quotaCheck.allowed) {
          await message.reply("J'ai épuisé mon énergie pour aujourd'hui sur ce serveur, à demain ! ⚡");
          return;
        }

        // Récupération du contexte RAG strictement isolé pour CE serveur (guildId)
        let ragContext = [];
        if (message.client.ragService) {
          try {
            ragContext = await message.client.ragService.searchContext(cleanQuestion, guildId);
          } catch (ragErr) {
            logger.warn(`[RAG] Recherche contextuelle échouée pour guild ${guildId} : ${ragErr.message}`);
          }
        }

        // Contexte Discord pour les outils fonctionnels (modération, admin)
        const discordContext = {
          guild: message.guild,
          channel: message.channel,
          client: message.client
        };

        // Appel Concierge avec cache sémantique, agentique et contexte
        const answer = await aiService.askConcierge(
          cleanQuestion,
          message.member?.displayName || message.author.username,
          ragContext,
          guildContext,
          discordContext
        );

        // Décompte FinOps des tokens consommés (~1 token pour 3.5 caractères)
        const estimatedTokens = Math.ceil((cleanQuestion.length + (answer?.length || 0)) / 3.5);
        databaseService.trackTokenUsage(guildId, estimatedTokens);

        await message.reply({
          content: answer,
          allowedMentions: { repliedUser: true }
        });
        return; // Ne pas exécuter la modération standard sur une question directe au bot
      } catch (err) {
        logger.error(`[CONCIERGE] Erreur lors de la réponse au membre ${message.author.tag} sur guild ${guildId} :`, err);
        await message.reply("Désolé, j'ai eu un trou de mémoire temporaire en traitant ta demande !").catch(() => {});
        return;
      }
    }

    // =========================================================================
    // CAS 2 : MODÉRATION CONTEXTUELLE INVISIBLE MULTI-SERVEUR
    // =========================================================================
    (async () => {
      try {
        // Recherche des règles d'exception déjà apprises pour ce serveur
        let overrideRules = [];
        if (message.client.ragService) {
          try {
            const hits = await message.client.ragService.searchContext(content, guildId, 3);
            overrideRules = hits.filter(h => h.includes("Règle d'exception"));
          } catch {}
        }

        // Transmission systématique du contexte de la guilde et des exceptions
        const modResult = await aiService.moderateMessage(
          content,
          {
            username: message.author.username,
            id: message.author.id
          },
          {
            ...guildContext,
            overrideRules
          }
        );

        // Si aucune toxicité n'est détectée ou si l'API n'a pas répondu
        if (!modResult || !modResult.isToxic) return;

        logger.warn(`[MODERATION] Message toxique sur '${guildName}' (${guildId}) de ${message.author.tag} : ${modResult.reason}`);

        // A. Avertissement bienveillant envoyé en message privé (MP)
        try {
          const userWarningEmbed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle(`🌱 Rappel bienveillant - ${guildName}`)
            .setDescription(
              `Bonjour **${message.author.username}**,\n\n` +
              `Nous avons remarqué un message récent de ta part sur **${guildName}** qui semble déroger à l'ambiance sereine du serveur :\n` +
              `> *« ${content.length > 200 ? content.slice(0, 197) + '...' : content} »*\n\n` +
              `**Conseil :** ${modResult.friendlyTip}\n\n` +
              `*Ce message est automatique et privé pour t'aider à garder un échange constructif avec les autres membres.*`
            )
            .setFooter({ text: 'Merci de contribuer à une communauté agréable pour tous !' })
            .setTimestamp();

          await message.author.send({ embeds: [userWarningEmbed] });
        } catch {
          logger.info(`[MODERATION] Impossible d'envoyer un MP à ${message.author.tag} (MP fermés).`);
        }

        // B. Log de l'incident pour les modérateurs avec boutons d'apprentissage interactif
        const logChannelId = guildSettings.logChannelId;
        if (logChannelId) {
          const logChannel = message.guild.channels.cache.get(logChannelId) ||
                             await message.guild.channels.fetch(logChannelId).catch(() => null);

          if (logChannel && logChannel.isTextBased()) {
            const severityColor = modResult.severity === 'high' ? 0xFF0000 : 0xFF7F50;

            const adminLogEmbed = new EmbedBuilder()
              .setColor(severityColor)
              .setTitle(`🛡️ Incident IA : ${modResult.severity.toUpperCase()} [${guildName}]`)
              .addFields(
                { name: 'Auteur', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
                { name: 'Salon', value: `<#${message.channel.id}>`, inline: true },
                { name: 'Sévérité', value: `\`${modResult.severity}\``, inline: true },
                { name: 'Raison détectée', value: modResult.reason },
                { name: 'Contenu du message', value: `\`\`\`${content.slice(0, 1000)}\`\`\`` },
                { name: 'Lien direct', value: `[Accéder au message](${message.url})` }
              )
              .setFooter({ text: 'Utilisez les boutons ci-dessous pour valider ou corriger le comportement de l\'IA.' })
              .setTimestamp();

            // Boutons interactifs pour la boucle de rétroaction (Feedback Loop)
            const actionRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`mod_validate_${message.id}`)
                .setLabel('Valider la sanction')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`mod_false_positive_${message.id}`)
                .setLabel('Faux Positif (Apprendre à l\'IA)')
                .setEmoji('❌')
                .setStyle(ButtonStyle.Danger)
            );

            await logChannel.send({
              embeds: [adminLogEmbed],
              components: [actionRow]
            });
          }
        }
      } catch (modErr) {
        logger.error(`[MODERATION] Erreur non gérée sur guild ${guildId} :`, modErr);
      }
    })();
  }
};
