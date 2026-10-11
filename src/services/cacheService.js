import { OpenAIEmbeddings } from '@langchain/openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Service de Cache Sémantique en mémoire (FinOps).
 * Permet de court-circuiter les appels LLM coûteux en réutilisant les réponses
 * à des questions au sens équivalent (Similarité Cosinus >= 0.95).
 */
class SemanticCacheService {
  constructor() {
    // Liste des entrées en mémoire : Array<{ query, embedding, response, guildId, timestamp }>
    this.entries = [];
    this.maxEntries = 1000;
    this.ttlMs = 24 * 60 * 60 * 1000; // 24 heures

    // Modèle d'embeddings ultra-léger et économique
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: config.ai.openaiApiKey,
      modelName: 'text-embedding-3-small'
    });

    this.stats = {
      hits: 0,
      misses: 0,
      estimatedTokensSaved: 0
    };
  }

  /**
   * Calcule la similarité cosinus entre deux vecteurs d'embeddings
   * @param {Array<number>} vecA
   * @param {Array<number>} vecB
   * @returns {number} Score entre -1 et 1 (1 = sémantiquement identique)
   */
  _cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dot / denominator;
  }

  /**
   * Nettoie les entrées expirées du cache
   */
  _cleanup() {
    const now = Date.now();
    this.entries = this.entries.filter(e => now - e.timestamp < this.ttlMs);

    if (this.entries.length > this.maxEntries) {
      // Éviction FIFO des plus anciennes entrées
      this.entries = this.entries.slice(this.entries.length - this.maxEntries);
    }
  }

  /**
   * Recherche si une question sémantiquement quasi-identique existe en cache
   * 
   * @param {string} query - Question posée par l'utilisateur
   * @param {string} guildId - Identifiant de la guilde pour l'étanchéité
   * @param {number} threshold - Seuil de similarité (défaut: 0.95)
   * @returns {Promise<{hit: boolean, response?: string, similarity?: number, queryEmbedding: Array<number>}>}
   */
  async get(query, guildId, threshold = config.ai.similarityCacheThreshold) {
    if (!query || query.trim().length < 3) {
      return { hit: false, queryEmbedding: null };
    }

    this._cleanup();

    try {
      // 1. Calcul du vecteur d'embedding de la question entrante
      const queryEmbedding = await this.embeddings.embedQuery(query);

      // 2. Filtrage strict par guildId (multi-tenancy)
      const targetGuildId = String(guildId);
      const guildEntries = this.entries.filter(e => e.guildId === targetGuildId);

      let bestMatch = null;
      let highestSimilarity = -1;

      for (const entry of guildEntries) {
        const sim = this._cosineSimilarity(queryEmbedding, entry.embedding);
        if (sim > highestSimilarity) {
          highestSimilarity = sim;
          bestMatch = entry;
        }
      }

      // 3. Vérification du seuil FinOps (> 0.95)
      if (bestMatch && highestSimilarity >= threshold) {
        this.stats.hits++;
        this.stats.estimatedTokensSaved += 600; // ~600 tokens économisés par hit
        logger.info(`[SEMANTIC-CACHE] 🎯 HIT ! Similarité: ${(highestSimilarity * 100).toFixed(2)}% (Seuil: ${threshold * 100}%) pour "${query}"`);
        return {
          hit: true,
          response: bestMatch.response,
          similarity: highestSimilarity,
          queryEmbedding
        };
      }

      this.stats.misses++;
      return {
        hit: false,
        similarity: highestSimilarity > 0 ? highestSimilarity : 0,
        queryEmbedding
      };
    } catch (err) {
      logger.warn(`[SEMANTIC-CACHE] Échec de la recherche en cache (${err.message}). Appel LLM standard maintenu.`);
      return { hit: false, queryEmbedding: null };
    }
  }

  /**
   * Enregistre une réponse générée dans le cache sémantique
   * 
   * @param {string} query
   * @param {string} response
   * @param {string} guildId
   * @param {Array<number>} [queryEmbedding]
   */
  async set(query, response, guildId, queryEmbedding = null) {
    if (!query || !response || !guildId) return;

    try {
      const embedding = queryEmbedding || await this.embeddings.embedQuery(query);

      this.entries.push({
        query,
        embedding,
        response,
        guildId: String(guildId),
        timestamp: Date.now()
      });

      logger.debug(`[SEMANTIC-CACHE] Nouvelle entrée indexée en cache pour la guilde ${guildId} (Total: ${this.entries.length}).`);
    } catch (err) {
      logger.warn(`[SEMANTIC-CACHE] Impossible de stocker en cache : ${err.message}`);
    }
  }

  /**
   * Statistiques d'optimisation FinOps
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total === 0 ? 0 : ((this.stats.hits / total) * 100).toFixed(1);
    return {
      entriesCount: this.entries.length,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: `${hitRate}%`,
      estimatedTokensSaved: this.stats.estimatedTokensSaved
    };
  }
}

export const cacheService = new SemanticCacheService();
