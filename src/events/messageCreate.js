import { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { aiService } from '../services/aiService.js';
import { databaseService } from '../services/databaseService.js';
import { socialMemoryService } from '../services/socialMemory.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Réponses statiques immédiates pour les pings sans question (Zero Waste : 0 token consommé).
 */
export const idleResponses = [
  "Tu m'as appelé ?",
  "Je suis là, tu as besoin d'un truc ?",
  "Quoi encore ?",
  "Présent !",
  "Oui ? Je t'écoute !",
  "À ton service, qu'est-ce qu'il y a ?",
  "C'est moi ! Comment je peux t'aider ?",
  "Toujours fidèle au poste ! Une question ?"
];

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

    // Commande texte développeur secrète : !premium <guildId>
    if (content.startsWith('!premium')) {
      const isOwner = message.author.id === config.discord.ownerId ||
                      message.client.application?.owner?.id === message.author.id;
      if (isOwner) {
        const parts = content.trim().split(/\s+/);
        const targetGuildId = parts[1] || guildId;
        databaseService.setGuildPremium(targetGuildId, true);
        await message.reply(`🌟 Le serveur \`${targetGuildId}\` est désormais **Premium** (Quota étendu à 500 000 tokens/jour) !`);
        return;
      }
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
        // Nettoyage de la mention et du prénom dans le texte
        let cleanQuestion = content;
        if (botUser) {
          cleanQuestion = cleanQuestion.replace(new RegExp(`<@!?${botUser.id}>`, 'g'), '');
        }
        cleanQuestion = cleanQuestion.replace(/\b(reza|rezabot)\b/gi, '').trim();

        // Détection d'un ping vide ou d'une salutation sans question (Zero Waste : 0 token)
        const emptyOrGreetingRegex = /^(hey|salut|yo|coucou|bonjour|bonsoir|hello|wesh|cc|re|dis|stp|s'il te plaît)?[?!.,:;\s]*$/i;
        const isIdlePing = !cleanQuestion || emptyOrGreetingRegex.test(cleanQuestion);

        if (isIdlePing) {
          const randomIndex = Math.floor(Math.random() * idleResponses.length);
          const replyText = idleResponses[randomIndex];
          await message.reply({
            content: replyText,
            allowedMentions: { repliedUser: true }
          });
          return;
        }

        await message.channel.sendTyping();

        // =====================================================================
        // FINOPS & SAAS : VÉRIFICATION DU QUOTA QUOTIDIEN STRICT (20K FREE / 500K PREMIUM)
        // =====================================================================
        const quotaCheck = databaseService.checkTokenQuota(guildId, 450);
        if (!quotaCheck.allowed) {
          if (!quotaCheck.isPremium) {
            await message.reply("J'ai atteint ma limite d'énergie gratuite pour aujourd'hui sur ce serveur (20k tokens). À demain, ou demandez à l'admin de passer Premium ! ⚡");
          } else {
            await message.reply("J'ai épuisé mon énergie pour aujourd'hui sur ce serveur (500k tokens), à demain ! ⚡");
          }
          return;
        }

        // =====================================================================
        // HISTORIQUE CONVERSATIONNEL ET COMPRESSION CONTEXTUELLE (microModel)
        // =====================================================================
        let conversationHistory = [];
        try {
          if (message.channel?.messages?.fetch) {
            const rawMessages = await message.channel.messages.fetch({ limit: 6 });
            const list = (rawMessages instanceof Map || typeof rawMessages.values === 'function')
              ? Array.from(rawMessages.values())
              : (Array.isArray(rawMessages) ? rawMessages : []);

            const filtered = list
              .filter(m => m && m.id !== message.id && m.content?.trim())
              .sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0));

            const rawHistory = filtered.map(m => ({
              role: m.author?.id === message.client.user?.id ? 'assistant' : 'user',
              content: m.content.trim(),
              name: m.member?.displayName || m.author?.username || 'Utilisateur'
            }));

            // Avant d'envoyer l'historique au chatModel, compression via microModel (FinOps)
            if (rawHistory.length > 0) {
              try {
                const compressedSummary = await aiService.compressContext(rawHistory);
                if (compressedSummary) {
                  conversationHistory = [
                    {
                      role: 'user',
                      content: `[Historique compressé] : ${compressedSummary}`,
                      name: 'Contexte'
                    }
                  ];
                } else {
                  conversationHistory = rawHistory;
                }
              } catch (compressErr) {
                logger.warn(`[CONCIERGE] Échec compression de l'historique : ${compressErr.message}`);
                conversationHistory = rawHistory;
              }
            }
          }
        } catch (fetchErr) {
          logger.warn(`[CONCIERGE] Impossible de récupérer l'historique dans #${message.channel.name || 'salon'} : ${fetchErr.message}`);
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

        // =====================================================================
        // SOCIAL MEMORY : RÉCUPÉRATION DES FAITS PERSONNELS DE L'UTILISATEUR
        // =====================================================================
        let userFacts = [];
        try {
          if (message.client.ragService?.getUserFacts) {
            userFacts = await message.client.ragService.getUserFacts(message.author.id, guildId);
          } else if (socialMemoryService.getUserFacts) {
            userFacts = await socialMemoryService.getUserFacts(message.author.id, guildId);
          }
        } catch (memErr) {
          logger.warn(`[SOCIAL-MEMORY] Erreur récupération faits pour ${message.author.id} : ${memErr.message}`);
        }

        const enrichedGuildContext = {
          ...guildContext,
          userId: message.author.id,
          userFacts
        };

        // Contexte Discord pour les outils fonctionnels (modération, admin, staging)
        const discordContext = {
          guild: message.guild,
          channel: message.channel,
          client: message.client
        };

        // Appel Concierge avec cache sémantique, agentique, contexte et mémoire conversationnelle
        let answer = await aiService.askConcierge(
          cleanQuestion,
          message.member?.displayName || message.author.username,
          ragContext,
          enrichedGuildContext,
          discordContext,
          conversationHistory
        );

        if (!answer || typeof answer !== 'string' || !answer.trim()) {
          answer = "Désolé, je ne peux pas te répondre pour le moment en raison d'une erreur technique. Réessaie dans un instant !";
        }

        // Décompte FinOps des tokens consommés (~1 token pour 3.5 caractères)
        const estimatedTokens = Math.ceil((cleanQuestion.length + (answer?.length || 0)) / 3.5);
        databaseService.trackTokenUsage(guildId, estimatedTokens);

        // =====================================================================
        // PROMPT 11 : AGENTIC WORKFLOW & BOUTONS DE CONFIRMATION (Validation Humaine)
        // =====================================================================
        if (discordContext.pendingAction && discordContext.pendingAction.type === 'delete_channels') {
          const ticket = discordContext.pendingAction;
          const channelNames = ticket.channels.map(c => `#${c.name}`).join(', ');

          const confirmEmbed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('⚠️ Action requise')
            .setDescription(`⚠️ Action requise : Je m'apprête à supprimer les salons : ${channelNames}. Es-tu sûr ?`)
            .addFields(
              { name: 'Motif', value: ticket.reason || 'Suppression demandée', inline: true },
              { name: 'Demandé par', value: `<@${message.author.id}>`, inline: true }
            )
            .setFooter({ text: 'Validation requise par un administrateur' })
            .setTimestamp();

          const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`confirm_action_${ticket.id}`)
              .setLabel('Confirmer')
              .setEmoji('🟩')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`cancel_action_${ticket.id}`)
              .setLabel('Annuler')
              .setEmoji('🟥')
              .setStyle(ButtonStyle.Danger)
          );

          await message.reply({
            content: answer || undefined,
            embeds: [confirmEmbed],
            components: [actionRow]
          });
          return;
        }

        try {
          await message.reply({
            content: answer,
            allowedMentions: { repliedUser: true }
          });
        } catch (replyErr) {
          logger.warn(`[CONCIERGE] Échec du reply direct (${replyErr.message}), envoi direct dans le salon...`);
          await message.channel.send({
            content: `<@${message.author.id}> ${answer}`,
            allowedMentions: { users: [message.author.id] }
          }).catch(() => {});
        }
        return; // Ne pas exécuter la modération standard sur une question directe au bot
      } catch (err) {
        logger.error(`[CONCIERGE] Erreur lors de la réponse au membre ${message.author.tag} sur guild ${guildId} :`, err);
        const errorReply = "Désolé, je ne peux pas te répondre pour le moment en raison d'une erreur technique. Réessaie dans un instant !";
        await message.reply({
          content: errorReply,
          allowedMentions: { repliedUser: true }
        }).catch(async () => {
          await message.channel.send({
            content: `<@${message.author.id}> ${errorReply}`,
            allowedMentions: { users: [message.author.id] }
          }).catch(() => {});
        });
        return;
      }
    }

    // =========================================================================
    // CAS 2 : DÉCLENCHEUR SPONTANÉ (Intervention sans mention, 0 token avant filtre)
    // =========================================================================
    const isCommand = content.startsWith('!') || content.startsWith('/');
    if (!isCommand && !isBotMentioned && !isNameCalled) {
      try {
        // 1. Récupération des messages récents pour évaluer l'activité du salon
        let channelMessages = [];
        if (message.channel?.messages?.fetch) {
          try {
            const fetched = await message.channel.messages.fetch({ limit: 10 });
            channelMessages = (fetched instanceof Map || typeof fetched.values === 'function')
              ? Array.from(fetched.values())
              : (Array.isArray(fetched) ? fetched : []);
          } catch {}
        } else if (message.channel?.messages?.cache) {
          channelMessages = Array.from(message.channel.messages.cache.values());
        }

        // Assurer que le message actuel est présent
        if (!channelMessages.some(m => m.id === message.id)) {
          channelMessages.push(message);
        }

        // 2. Vérification d'activité : au moins 3 messages de 3 personnes différentes dans les 5 dernières minutes
        const now = Date.now();
        const fiveMinutesAgo = now - 5 * 60 * 1000;
        const activeRecentMessages = channelMessages.filter(m => {
          const ts = m.createdTimestamp || (m.createdAt ? m.createdAt.getTime() : now);
          return ts >= fiveMinutesAgo && !m.author?.bot;
        });

        const distinctAuthors = new Set(activeRecentMessages.map(m => m.author?.id).filter(Boolean));
        const isChannelActive = activeRecentMessages.length >= 3 && distinctAuthors.size >= 3;

        // 3. Probabilité : 2% par défaut, 10% si mots-clés émotionnels
        const emotionalKeywordsRegex = /\b(j'en peux plus|incroyable|qui joue(\s*\?)?|qui est chaud|dinguerie|abusé|c'est fou|trop drôle|mdr|ptdr|omg|let's go|chaud pour)\b/i;
        const hasEmotionalKeyword = emotionalKeywordsRegex.test(content) ||
          /j'en peux plus/i.test(content) ||
          /incroyable/i.test(content) ||
          /qui joue/i.test(content);

        const threshold = hasEmotionalKeyword ? 0.10 : 0.02;
        const roll = Math.random();

        if (isChannelActive && roll < threshold) {
          // Vérification du quota de tokens avant appel LLM
          const quotaCheck = databaseService.checkTokenQuota(guildId, 100);
          if (quotaCheck.allowed) {
            // Récupération des 10 derniers messages dans l'ordre chronologique
            const sorted10 = channelMessages
              .filter(m => m && m.content?.trim())
              .sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0))
              .slice(-10);

            const formattedContext = sorted10.map(m => ({
              role: m.author?.id === message.client.user?.id ? 'assistant' : 'user',
              content: m.content.trim(),
              name: m.member?.displayName || m.author?.username || 'Membre'
            }));

            const spontaneousReplyText = await aiService.spontaneousReply(formattedContext, guildContext);

            if (spontaneousReplyText) {
              await message.channel.sendTyping().catch(() => {});
              const typingDelay = process.env.NODE_ENV === 'test'
                ? 20
                : Math.floor(Math.random() * 2000) + 3000;
              await new Promise(resolve => setTimeout(resolve, typingDelay));

              await message.channel.send(spontaneousReplyText);

              // Décompte FinOps des tokens consommés
              const estimatedTokens = Math.ceil(spontaneousReplyText.length / 3.5);
              databaseService.trackTokenUsage(guildId, estimatedTokens);
              logger.info(`[SPONTANEOUS] Réponse spontanée envoyée sur #${message.channel.name || 'salon'} (${guildName})`);
            }
          }
        }
      } catch (spontaneousErr) {
        logger.error(`[SPONTANEOUS] Erreur lors de l'évaluation spontanée :`, spontaneousErr);
      }
    }

    // =========================================================================
    // CAS 3 : MODÉRATION CONTEXTUELLE INVISIBLE MULTI-SERVEUR
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
