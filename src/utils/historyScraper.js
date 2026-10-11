import { logger } from './logger.js';

/**
 * Utilitaire de moissonnage (scraping) d'historique de salon Discord avec pagination et respect strict des Rate Limits.
 */

/**
 * Pause asynchrone en millisecondes
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Aspire l'historique d'un salon Discord en remontant le temps via pagination.
 * Applique un filtrage préalable pour éliminer le bruit (bots, commandes, messages trop courts).
 * 
 * @param {import('discord.js').TextChannel} channel - Le salon Discord à aspirer
 * @param {number} limit - Nombre total maximum de messages bruts à récupérer (défaut: 1000, max: 5000)
 * @param {Function} [onProgress] - Callback de progression ({ fetchedRaw, retainedFiltered, targetLimit })
 * @returns {Promise<Array<{id: string, author: string, content: string, createdAt: Date, timestamp: number}>>}
 */
export async function fetchChannelHistory(channel, limit = 1000, onProgress = null) {
  if (!channel || !channel.isTextBased()) {
    throw new Error('Le salon spécifié est invalide ou n\'est pas un salon textuel.');
  }

  const targetLimit = Math.min(Math.max(limit, 50), 5000);
  const filteredMessages = [];
  let lastMessageId = null;
  let totalFetchedRaw = 0;
  let hasMore = true;

  logger.info(`[SCRAPER] Démarrage de l'aspiration sur #${channel.name} (Objectif: ${targetLimit} messages bruts)...`);

  while (hasMore && totalFetchedRaw < targetLimit) {
    // Calcul de la taille du lot (max 100 imposé par l'API Discord)
    const remainingToFetch = targetLimit - totalFetchedRaw;
    const batchSize = Math.min(remainingToFetch, 100);

    const fetchOptions = { limit: batchSize };
    if (lastMessageId) {
      fetchOptions.before = lastMessageId;
    }

    try {
      const messages = await channel.messages.fetch(fetchOptions);

      if (!messages || messages.size === 0) {
        hasMore = false;
        break;
      }

      totalFetchedRaw += messages.size;
      lastMessageId = messages.last().id;

      // Filtrage strict au niveau du code
      for (const msg of messages.values()) {
        // 1. Ignorer les messages de bots
        if (msg.author?.bot) continue;

        const rawContent = (msg.cleanContent || msg.content || '').trim();

        // 2. Ignorer les messages vides ou trop courts (< 15 caractères : "ok", "lol", "salut", émojis seuls)
        if (rawContent.length < 15) continue;

        // 3. Ignorer les commandes de bots (!help, /play, .ban, etc.)
        if (/^[!/.?$#-]/.test(rawContent)) continue;

        // Message retenu
        filteredMessages.push({
          id: msg.id,
          author: msg.author.username,
          content: rawContent,
          createdAt: msg.createdAt,
          timestamp: msg.createdTimestamp
        });
      }

      // Notification de progression
      if (typeof onProgress === 'function') {
        try {
          await onProgress({
            fetchedRaw: totalFetchedRaw,
            retainedFiltered: filteredMessages.length,
            targetLimit
          });
        } catch (progressErr) {
          logger.warn(`[SCRAPER] Erreur callback progression : ${progressErr.message}`);
        }
      }

      // Si le lot renvoyé par Discord contient moins de messages que demandé, le salon est épuisé
      if (messages.size < batchSize) {
        hasMore = false;
        break;
      }

      // Respect strict du Rate Limit Discord (1500ms entre chaque requête)
      await sleep(1500);
    } catch (error) {
      logger.error(`[SCRAPER] Erreur lors de la pagination sur #${channel.name} :`, error);
      // En cas de rate limit (429), pause plus longue de sécurité
      if (error?.status === 429) {
        const retryAfter = (error?.rawError?.retry_after || 5) * 1000;
        logger.warn(`[SCRAPER] Rate limit Discord rencontré. Pause forcée de ${retryAfter}ms...`);
        await sleep(retryAfter);
      } else {
        // Interrompre la boucle sans crasher pour renvoyer ce qui a été collecté
        break;
      }
    }
  }

  logger.info(`[SCRAPER] Aspiration terminée sur #${channel.name} : ${totalFetchedRaw} analysés, ${filteredMessages.length} conservés après filtrage.`);
  return filteredMessages;
}
