import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Service d'extraction de connaissance froide (Knowledge Mining) à partir de messages Discord.
 * Découpe les flux en lots de 100 messages et utilise le modèle gpt-4o-mini pour extraire des fiches d'information.
 */
class KnowledgeExtractor {
  constructor() {
    this.client = new OpenAI({
      apiKey: config.ai.openaiApiKey
    });
    this.batchSize = 100;
  }

  /**
   * Traite un lot unique de messages pour en extraire des pépites de connaissance.
   * Protégé contre les erreurs pour ne pas bloquer les autres lots.
   * 
   * @param {Array<{author: string, content: string, createdAt: Date}>} batch
   * @param {string} guildName
   * @param {string} channelName
   * @returns {Promise<Array<{title: string, category: string, content: string, tags: Array<string>}>>}
   */
  async _extractFromSingleBatch(batch, guildName = 'Serveur', channelName = 'salon') {
    if (!batch || batch.length === 0) return [];

    const transcript = batch
      .map(m => `[${new Date(m.createdAt).toLocaleDateString('fr-FR')}] ${m.author}: ${m.content}`)
      .join('\n');

    try {
      const response = await this.client.chat.completions.create({
        model: config.ai.tierEconomy, // gpt-4o-mini : ultra économique et performant pour l'extraction
        temperature: 0.2, // Faible température pour favoriser l'exactitude factuelle
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Tu es un ingénieur de la connaissance expert en extraction d'informations communautaires.
Analyse ces messages Discord provenant du salon #${channelName} sur le serveur "${guildName}".
Extrais-en UNIQUEMENT :
1. Les faits durables et vérifiés.
2. Les règles ou consensus implicites du serveur.
3. Les réponses réutilisables à des questions techniques ou organisationnelles.
4. Les habitudes pérennes et projets actifs de la communauté.

RÈGLE STRICTE : Ignore totalement le bavardage éphémère, les salutations ("bonjour", "bonne nuit"), les vannes sans fond et les conversations banales sans valeur durable.

Réponds TOUJOURS au format JSON strict avec la structure suivante :
{
  "knowledgeCards": [
    {
      "title": "Titre clair et précis de la fiche d'information",
      "category": "Technique | Règle implicite | Solution FAQ | Projet | Habitude",
      "content": "Explication claire, concise et autosuffisante du fait ou de la solution (2 à 4 phrases)",
      "tags": ["mot-cle1", "mot-cle2"]
    }
  ]
}
Si aucune information durable n'est identifiable dans ce lot, renvoie exactement {"knowledgeCards": []}.`
          },
          {
            role: 'user',
            content: `Voici l'historique des échanges à analyser (${batch.length} messages) :\n\n${transcript}`
          }
        ]
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      const cards = Array.isArray(parsed.knowledgeCards) ? parsed.knowledgeCards : [];
      return cards.filter(c => c && c.title && c.content);
    } catch (error) {
      logger.error(`[KNOWLEDGE-EXTRACTOR] Échec d'extraction pour un lot de #${channelName} :`, error.message);
      // Renvoie un tableau vide pour permettre la poursuite des autres lots
      return [];
    }
  }

  /**
   * Orchestre l'extraction complète par découpage en lots de 100 messages.
   * 
   * @param {Array<{author: string, content: string, createdAt: Date}>} messages
   * @param {Object} context - { guildName, channelName }
   * @param {Function} [onProgress] - Callback de progression ({ currentBatch, totalBatches, cardsCount })
   * @returns {Promise<Array<{title: string, category: string, content: string, tags: Array<string>}>>}
   */
  async extractKnowledge(messages, context = {}, onProgress = null) {
    if (!messages || messages.length === 0) {
      logger.info('[KNOWLEDGE-EXTRACTOR] Aucun message fourni pour l\'extraction.');
      return [];
    }

    const { guildName = 'Serveur', channelName = 'general' } = context;

    // Découpage en tranches de 100 messages
    const batches = [];
    for (let i = 0; i < messages.length; i += this.batchSize) {
      batches.push(messages.slice(i, i + this.batchSize));
    }

    const totalBatches = batches.length;
    logger.info(`[KNOWLEDGE-EXTRACTOR] Démarrage de l'analyse sur ${messages.length} messages répartis en ${totalBatches} lot(s) de 100...`);

    const allCards = [];

    for (let i = 0; i < totalBatches; i++) {
      const currentBatchIndex = i + 1;
      const batch = batches[i];

      try {
        logger.info(`[KNOWLEDGE-EXTRACTOR] Traitement du lot ${currentBatchIndex}/${totalBatches} (${batch.length} messages)...`);
        const extractedCards = await this._extractFromSingleBatch(batch, guildName, channelName);

        if (extractedCards.length > 0) {
          allCards.push(...extractedCards);
          logger.info(`[KNOWLEDGE-EXTRACTOR] Lot ${currentBatchIndex}/${totalBatches} : +${extractedCards.length} fiche(s) de connaissance.`);
        } else {
          logger.info(`[KNOWLEDGE-EXTRACTOR] Lot ${currentBatchIndex}/${totalBatches} : aucun fait durable identifié.`);
        }
      } catch (batchError) {
        // Sécurité résiliente : le crash d'un lot n'arrête pas les lots suivants
        logger.error(`[KNOWLEDGE-EXTRACTOR] Erreur non gérée sur le lot ${currentBatchIndex}/${totalBatches} (continuation...) :`, batchError);
      }

      // Notification de progression pour l'UI Discord
      if (typeof onProgress === 'function') {
        try {
          await onProgress({
            currentBatch: currentBatchIndex,
            totalBatches,
            cardsCount: allCards.length
          });
        } catch (progressErr) {
          logger.warn(`[KNOWLEDGE-EXTRACTOR] Erreur callback progression : ${progressErr.message}`);
        }
      }
    }

    logger.info(`[KNOWLEDGE-EXTRACTOR] Extraction globale achevée : ${allCards.length} fiche(s) validée(s) au total.`);
    return allCards;
  }
}

export const knowledgeExtractor = new KnowledgeExtractor();
