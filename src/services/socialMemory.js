import cron from 'node-cron';
import OpenAI from 'openai';
import { Document } from '@langchain/core/documents';
import { ragService } from './ragService.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Service d'extraction et de gestion de la mémoire sociale individuelle.
 * Extrait les faits personnels des utilisateurs de façon asynchrone (job nocturne)
 * et les indexe dans ChromaDB sans impacter les coûts d'API quotidiens.
 */
export class SocialMemoryService {
  constructor() {
    this.client = null;
    this.cronTask = null;
    this.openai = new OpenAI({
      apiKey: config.ai.openaiApiKey
    });
  }

  /**
   * Initialise le service et planifie le Cron Job nocturne (tous les soirs à 3h du matin)
   * @param {import('discord.js').Client} client
   * @param {string} cronExpression - Par défaut: '0 3 * * *' (3h du matin)
   */
  init(client, cronExpression = '0 3 * * *') {
    this.client = client;

    try {
      this.cronTask = cron.schedule(cronExpression, async () => {
        logger.info('[SOCIAL-MEMORY] Démarrage du cron job nocturne d\'extraction de faits personnels...');
        await this.processAllGuilds();
      });

      logger.info(`[SOCIAL-MEMORY] Scheduler de mémoire sociale initialisé (Expression: "${cronExpression}").`);
    } catch (err) {
      logger.error('[SOCIAL-MEMORY] Échec d\'initialisation du cron job :', err);
    }
  }

  /**
   * Traite l'ensemble des serveurs connectés au bot
   */
  async processAllGuilds() {
    if (!this.client || !this.client.isReady?.()) {
      logger.warn('[SOCIAL-MEMORY] Client Discord non disponible ou non prêt.');
      return;
    }

    const guilds = this.client.guilds.cache;
    for (const [guildId, guild] of guilds) {
      try {
        await this.processGuild(guild);
      } catch (err) {
        logger.error(`[SOCIAL-MEMORY] Erreur lors du traitement de la guilde ${guild.name || guildId} :`, err);
      }
    }
  }

  /**
   * Récupère jusqu'à 300 messages de la journée sur les salons textuels d'un serveur
   * @param {import('discord.js').Guild} guild
   * @param {number} limit - Nombre maximum de messages (défaut: 300)
   * @returns {Promise<Array<import('discord.js').Message>>}
   */
  async fetchDailyMessages(guild, limit = 300) {
    if (!guild || !guild.channels?.cache) return [];

    const textChannels = Array.from(guild.channels.cache.values()).filter(c => {
      return typeof c.isTextBased === 'function' && c.isTextBased() && !c.isVoiceBased?.();
    });

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const allMessages = [];

    for (const channel of textChannels) {
      if (allMessages.length >= limit) break;
      if (!channel.messages?.fetch) continue;

      try {
        const remaining = limit - allMessages.length;
        const fetchLimit = Math.min(Math.max(remaining, 10), 100);
        const fetched = await channel.messages.fetch({ limit: fetchLimit });
        const list = (fetched instanceof Map || typeof fetched.values === 'function')
          ? Array.from(fetched.values())
          : (Array.isArray(fetched) ? fetched : []);

        for (const msg of list) {
          if (allMessages.length >= limit) break;
          if (msg.author?.bot) continue;

          const text = msg.content?.trim();
          if (!text || text.startsWith('!') || text.startsWith('/')) continue;
          if (text.length < 8) continue;

          const ts = msg.createdTimestamp || (msg.createdAt ? msg.createdAt.getTime() : Date.now());
          if (ts >= oneDayAgo) {
            allMessages.push(msg);
          }
        }
      } catch (err) {
        logger.debug(`[SOCIAL-MEMORY] Erreur fetch salon #${channel.name || 'salon'} : ${err.message}`);
      }
    }

    return allMessages.sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0));
  }

  /**
   * Analyse le texte des conversations et extrait les faits avérés sur les utilisateurs
   * @param {string} conversationsText
   * @returns {Promise<Array<{userId: string, username: string, fact: string}>>}
   */
  async extractUserFacts(conversationsText) {
    if (!conversationsText || conversationsText.trim().length === 0) return [];

    const prompt = `Analyse ces conversations. Extrais uniquement des faits avérés sur les utilisateurs. Par exemple : leurs passions, les jeux auxquels ils jouent, leur métier, ou des anecdotes marquantes. Format JSON : [{ "userId": "...", "username": "...", "fact": "..." }].`;

    try {
      const response = await this.openai.chat.completions.create({
        model: config.ai.microModel || 'gpt-4.1-nano',
        temperature: 0.2,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: conversationsText }
        ]
      });

      const raw = response.choices[0]?.message?.content?.trim() || '[]';
      const cleanJson = raw.replace(/^```json|^```|```$/gm, '').trim();
      const parsed = JSON.parse(cleanJson);
      const facts = Array.isArray(parsed) ? parsed : (parsed.facts || parsed.user_facts || []);

      return facts.filter(f => f && f.userId && f.fact);
    } catch (err) {
      logger.error('[SOCIAL-MEMORY] Erreur lors de l\'extraction LLM des faits :', err.message);
      return [];
    }
  }

  /**
   * Sauvegarde les faits extraits dans ChromaDB avec les métadonnées type: 'user_fact' et userId
   * @param {Array<{userId: string, username?: string, fact: string}>} facts
   * @param {string} guildId
   * @returns {Promise<Array<Document>>}
   */
  async saveUserFacts(facts, guildId) {
    if (!facts || facts.length === 0 || !guildId) return [];

    const targetGuildId = String(guildId);
    const documents = facts.map(f => new Document({
      pageContent: f.fact,
      metadata: {
        type: 'user_fact',
        userId: String(f.userId),
        username: f.username || '',
        guildId: targetGuildId,
        createdAt: new Date().toISOString()
      }
    }));

    await ragService.ingestDocuments(documents, targetGuildId);
    logger.info(`[SOCIAL-MEMORY] ${documents.length} fait(s) sauvegardé(s) dans ChromaDB pour le serveur ${targetGuildId}.`);
    return documents;
  }

  /**
   * Pipeline complet pour un serveur donné (récupère 300 messages, extrait et sauvegarde)
   * @param {import('discord.js').Guild} guild
   */
  async processGuild(guild) {
    if (!guild || !guild.id) return { count: 0, facts: [] };

    logger.info(`[SOCIAL-MEMORY] Récupération des messages de la journée pour ${guild.name} (${guild.id})...`);
    const messages = await this.fetchDailyMessages(guild, 300);

    if (messages.length < 3) {
      logger.info(`[SOCIAL-MEMORY] Pas assez de messages récents pour ${guild.name} (${messages.length} messages trouvés).`);
      return { count: 0, facts: [] };
    }

    const conversationsText = messages
      .map(m => `[userId: ${m.author?.id || 'inconnu'} | username: ${m.author?.username || 'Membre'}]: ${m.content}`)
      .join('\n');

    const facts = await this.extractUserFacts(conversationsText);
    if (facts.length > 0) {
      await this.saveUserFacts(facts, guild.id);
    }

    return { count: facts.length, facts };
  }

  /**
   * Interroge ChromaDB pour retrouver les faits mémorisés sur un utilisateur spécifique
   * @param {string} userId - ID Discord de l'utilisateur
   * @param {string} guildId - ID du serveur
   * @param {number} limit - Nombre max de faits à retourner
   * @returns {Promise<Array<string>>}
   */
  async getUserFacts(userId, guildId, limit = 5) {
    if (!userId || !guildId) return [];

    try {
      const vectorStore = await ragService.getVectorStore();
      const results = await vectorStore.similaritySearch(
        "passions jeux métier faits anecdotes profil personnalité",
        limit,
        { userId: String(userId) }
      );

      const facts = results
        .filter(d => (!d.metadata?.guildId || d.metadata.guildId === String(guildId)) && d.metadata?.type === 'user_fact')
        .map(d => d.pageContent);

      return facts;
    } catch (err) {
      logger.warn(`[SOCIAL-MEMORY] Erreur recherche faits pour ${userId} : ${err.message}`);
      return [];
    }
  }
}

export const socialMemoryService = new SocialMemoryService();
