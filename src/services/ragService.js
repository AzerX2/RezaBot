import { Chroma } from '@langchain/community/vectorstores/chroma';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Service de gestion de la mémoire à long terme (RAG) avec ChromaDB et LangChain.
 */
class RAGService {
  constructor() {
    this.collectionName = config.rag.collectionName;
    this.chromaUrl = process.env.CHROMA_URL || config.rag.chromaUrl || 'http://localhost:8000';
    this._vectorStore = null;

    // Initialisation des embeddings OpenAI (text-embedding-3-small par défaut)
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: config.ai.openaiApiKey,
      modelName: 'text-embedding-3-small'
    });
  }

  /**
   * Obtient ou instancie le VectorStore Chroma de LangChain.
   * @returns {Promise<Chroma>}
   */
  async getVectorStore() {
    if (!this._vectorStore) {
      try {
        this._vectorStore = new Chroma(this.embeddings, {
          collectionName: this.collectionName,
          url: this.chromaUrl
        });
      } catch (err) {
        logger.error(`[RAG-SERVICE] Échec d'initialisation du VectorStore Chroma (${this.chromaUrl}) :`, err);
        throw err;
      }
    }
    return this._vectorStore;
  }

  /**
   * Ingestion d'un tableau de Documents LangChain avec étanchéité multi-serveur (Multi-tenancy).
   * 
   * @param {Array<import('@langchain/core/documents').Document>} documents
   * @param {string} guildId - Identifiant unique de la guilde Discord (obligatoire)
   * @returns {Promise<{success: boolean, count: number, guildId: string}>}
   */
  async ingestDocuments(documents, guildId) {
    if (!guildId) {
      throw new Error("[RAG-SERVICE] Le paramètre 'guildId' est obligatoire pour garantir l'étanchéité des données.");
    }

    if (!documents || documents.length === 0) {
      throw new Error("Aucun document fourni pour l'ingestion.");
    }

    const targetGuildId = String(guildId);
    logger.info(`[RAG-SERVICE] Ingestion de ${documents.length} document(s) pour la guilde '${targetGuildId}'...`);

    // Injection obligatoire du guildId dans les métadonnées de chaque document
    const tenantDocuments = documents.map(doc => ({
      ...doc,
      metadata: {
        ...(doc.metadata || {}),
        guildId: targetGuildId
      }
    }));

    try {
      const vectorStore = await this.getVectorStore();
      await vectorStore.addDocuments(tenantDocuments);

      logger.info(`[RAG-SERVICE] Ingestion réussie : ${documents.length} document(s) indexé(s) pour la guilde ${targetGuildId}.`);

      return {
        success: true,
        count: documents.length,
        guildId: targetGuildId
      };
    } catch (error) {
      logger.error(`[RAG-SERVICE] Erreur lors de l'ingestion ChromaDB pour la guilde ${targetGuildId} :`, error);
      throw error;
    }
  }

  /**
   * Recherche de similarité sémantique strictement isolée par serveur.
   * Ne remonte QUE les connaissances associées au guildId passé en paramètre.
   * 
   * @param {string} query - Question de l'utilisateur
   * @param {string} guildId - Identifiant unique de la guilde Discord (obligatoire)
   * @param {number} topK - Nombre d'extraits pertinents à récupérer
   * @returns {Promise<Array<string>>} Extraits textuels pertinents du serveur
   */
  async searchContext(query, guildId, topK = config.rag.topK) {
    if (!guildId) {
      logger.warn("[RAG-SERVICE] Appel de searchContext sans guildId. Recherche annulée par sécurité d'étanchéité.");
      return [];
    }

    const targetGuildId = String(guildId);

    try {
      const vectorStore = await this.getVectorStore();
      
      // Filtre de métadonnées ChromaDB strict : n'interroge que les vecteurs du serveur en cours
      const filter = { guildId: targetGuildId };
      const results = await vectorStore.similaritySearch(query, topK, filter);

      if (!results || results.length === 0) {
        logger.debug(`[RAG-SERVICE] Aucun contexte trouvé pour la guilde ${targetGuildId}.`);
        return [];
      }

      return results.map((doc, idx) => {
        const sourceTitle = doc.metadata?.title ? `[${doc.metadata.title}] ` : '';
        return `Extrait ${idx + 1} ${sourceTitle}: ${doc.pageContent}`;
      });
    } catch (error) {
      logger.warn(`[RAG-SERVICE] Erreur lors de la recherche contextuelle pour la guilde ${targetGuildId} : ${error.message}`);
      return [];
    }
  }

  /**
   * Enregistre un message dans la mémoire RAG en Mode Observation.
   * Étiqueté systématiquement avec le tag 'observation_log'.
   * 
   * @param {string} guildId
   * @param {string} authorName
   * @param {string} content
   * @param {string} channelName
   */
  async recordObservation(guildId, authorName, content, channelName = 'general') {
    if (!guildId || !content || content.trim().length < 5) return;

    try {
      const doc = new Document({
        pageContent: `[#${channelName}] ${authorName}: ${content}`,
        metadata: {
          guildId: String(guildId),
          tag: 'observation_log',
          author: authorName,
          channel: channelName,
          timestamp: new Date().toISOString()
        }
      });

      const vectorStore = await this.getVectorStore();
      await vectorStore.addDocuments([doc]);
      logger.debug(`[RAG-OBSERVATION] Message enregistré pour observation (Guild: ${guildId}).`);
    } catch (err) {
      logger.warn(`[RAG-OBSERVATION] Impossible d'enregistrer le message d'observation : ${err.message}`);
    }
  }

  /**
   * Récupère tous les logs d'observation d'un serveur pour effectuer le Vibe Check
   * @param {string} guildId
   * @param {number} limit
   * @returns {Promise<Array<string>>}
   */
  async getObservationLogs(guildId, limit = 40) {
    if (!guildId) return [];

    try {
      const targetGuildId = String(guildId);
      const vectorStore = await this.getVectorStore();

      // Recherche large de logs d'observation pour ce serveur
      const results = await vectorStore.similaritySearch(
        "messages discussions interactions ambiance humour ton",
        limit,
        { guildId: targetGuildId }
      );

      // On priorise les documents portant l'étiquette 'observation_log'
      const logs = results
        .filter(d => !d.metadata?.tag || d.metadata.tag === 'observation_log')
        .map(d => d.pageContent);

      return logs;
    } catch (err) {
      logger.error(`[RAG-OBSERVATION] Erreur lors de la récupération des logs d'observation :`, err);
      return [];
    }
  }

  /**
   * Récupère les faits mémorisés sur un utilisateur dans ChromaDB avec filtre sur userId et guildId
   * @param {string} userId - Identifiant Discord de l'utilisateur
   * @param {string} guildId - Identifiant du serveur
   * @param {number} limit - Nombre maximal de faits à remonter
   * @returns {Promise<Array<string>>}
   */
  async getUserFacts(userId, guildId, limit = 5) {
    if (!userId || !guildId) return [];

    try {
      const vectorStore = await this.getVectorStore();
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
      logger.warn(`[RAG-USER-FACTS] Erreur lors de la récupération des faits pour ${userId} :`, err.message);
      return [];
    }
  }
}

export const ragService = new RAGService();
