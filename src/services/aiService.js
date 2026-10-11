import OpenAI from 'openai';
import { ChatOpenAI } from '@langchain/openai';
import { createOpenAIToolsAgent, AgentExecutor } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { conciergeTools } from '../tools/index.js';
import { cacheService } from './cacheService.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Service IA centralisant tous les appels aux modèles OpenAI.
 * Gère le rate-limiting, la modération contextuelle et le concierge RAG.
 */
class AIService {
  constructor() {
    this.client = new OpenAI({
      apiKey: config.ai.openaiApiKey
    });

    // Prompt système définissant la personnalité du Concierge RezaBot
    this.conciergeSystemPrompt = `Tu es RezaBot, membre actif et concierge intelligent de ce serveur Discord.
Ton rôle est d'aider les membres avec chaleur, dynamisme et bienveillance.
Règles de communication :
- Sois concis, clair et adapté au ton d'une communauté Discord (utilise quelques émojis pertinents, du markdown Discord propre : **gras**, listes à puces, \`code\` si pertinent).
- Base tes réponses en priorité sur le contexte fourni (FAQ, docs internes du serveur).
- Si le contexte ne contient pas l'information requise, réponds honnêtement que tu ne possèdes pas encore cette donnée dans la mémoire du serveur, sans inventer de fausses règles.
- Reste toujours respectueux, poli et empathique.`;

    // Prompt système pour la modération contextuelle invisible
    this.moderationSystemPrompt = `Tu es un filtre de modération contextuelle bienveillant pour une communauté Discord.
Ton objectif est de détecter les VRAIES dérives toxiques (harcèlement ciblé, insultes dégradantes gratuites, menaces, incitation à la haine, discrimination).

CRITÈRES MAJEURS DE DISTINCTION :
1. Ignore le second degré, le chambrage amical, le sarcasme bon enfant et l'argot courant de gamers/jeunes.
2. Détecte uniquement l'hostilité réelle, les attaques personnelles blessantes ou le comportement destructeur pour la communauté.

Réponds TOUJOURS au format JSON strict avec la structure suivante :
{
  "isToxic": true | false,
  "severity": "none" | "low" | "medium" | "high",
  "reason": "Explication brève en français de la dérive observée",
  "friendlyTip": "Court message pédagogique et bienveillant destiné à l'auteur pour l'inviter à apaiser le ton"
}`;
  }

  /**
   * Wrapper sécurisé avec retry exponentiel pour prévenir les crashs liés aux Rate Limits (HTTP 429)
   * @param {Function} apiCall - Fonction asynchrone exécutant l'appel OpenAI
   * @param {number} maxRetries - Nombre maximum d'essais (défaut: 2)
   */
  async _executeWithRetry(apiCall, maxRetries = 2) {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        return await apiCall();
      } catch (error) {
        attempt++;
        const isRateLimit = error?.status === 429 || error?.code === 'rate_limit_exceeded';
        const isServerIssue = error?.status >= 500;

        if ((isRateLimit || isServerIssue) && attempt <= maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 500);
          logger.warn(`[AI-SERVICE] Erreur API OpenAI (${error.status || error.code}). Nouvelle tentative dans ${delayMs}ms (Essai ${attempt}/${maxRetries})...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          logger.error(`[AI-SERVICE] Échec de l'appel OpenAI après ${attempt} tentative(s) :`, error.message);
          throw error;
        }
      }
    }
  }

  /**
   * Analyse contextuelle d'un message Discord pour détecter la toxicité.
   * Utilise le modèle rapide (ex: gpt-4o-mini) pour une latence minimale.
   * 
   * @param {string} content - Contenu textuel du message
   * @param {Object} authorContext - Informations sur l'auteur (username, etc.)
   * @param {Object} guildContext - Contexte multi-serveur (guildId, botMode, serverVibe, etc.)
   * @returns {Promise<{isToxic: boolean, severity: string, reason: string, friendlyTip: string}|null>}
   */
  async moderateMessage(content, authorContext = {}, guildContext = {}) {
    // Évite d'analyser des messages trop courts ou de la ponctuation
    if (!content || content.trim().length < 4) {
      return { isToxic: false, severity: 'none', reason: '', friendlyTip: '' };
    }

    const botMode = guildContext.botMode || 'standard';
    const serverVibe = guildContext.serverVibe || 'friendly';
    const guildInfo = guildContext.guildId ? `[Serveur: ${guildContext.guildName || guildContext.guildId} | Vibe: ${serverVibe} | Mode: ${botMode}]` : '';

    const overridesPrompt = (guildContext.overrideRules && guildContext.overrideRules.length > 0)
      ? `\n\nEXCEPTIONS APPRISES SUR CE SERVEUR (TOLÉRANCE CONFIRMÉE PAR LES MODÉRATEURS) :\n${guildContext.overrideRules.join('\n')}\nSi le message correspond à ces exceptions, réponds avec "isToxic": false.`
      : '';

    try {
      const response = await this._executeWithRetry(async () => {
        return await this.client.chat.completions.create({
          model: config.ai.tierEconomy, // Modèle ultra-low-cost pour les tâches de fond
          temperature: 0.1, // Déterministe pour la modération
          max_tokens: config.ai.maxTokensModeration,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: this.moderationSystemPrompt },
            {
              role: 'user',
              content: `${guildInfo}\nAuteur: "${authorContext.username || 'Membre'}"\nMessage: """${content}"""${overridesPrompt}`
            }
          ]
        });
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      return {
        isToxic: Boolean(parsed.isToxic),
        severity: parsed.severity || 'low',
        reason: parsed.reason || 'Comportement inapproprié',
        friendlyTip: parsed.friendlyTip || 'Merci de veiller à préserver un climat respectueux sur le serveur.'
      };
    } catch (error) {
      logger.error('[AI-SERVICE] Erreur lors de l\'analyse de modération :', error.message);
      // En cas de panne de l'API OpenAI, on ne bloque pas les messages Discord
      return null;
    }
  }

  /**
   * Construit le prompt système dynamique intégrant le serverVibe de la base de données
   * @param {string} serverVibe
   * @returns {string}
   */
  getDynamicConciergePrompt(serverVibe = 'friendly') {
    return `Tu es RezaBot, membre actif et concierge intelligent de ce serveur Discord.
Le ton et l'ambiance spécifiques de ce serveur sont : "${serverVibe}".
Adapte ton langage, ton niveau d'humour et tes tournures de phrases en conséquence afin de t'intégrer parfaitement à cette communauté.

Règles de communication :
- Sois concis, clair et fidèle au ton du serveur (utilise quelques émojis pertinents, du markdown Discord propre : **gras**, listes à puces, \`code\` si pertinent).
- Base tes réponses en priorité sur le contexte fourni (FAQ, docs internes du serveur).
- Si le contexte ne contient pas l'information requise, réponds honnêtement que tu ne possèdes pas encore cette donnée dans la mémoire du serveur, sans inventer de fausses règles.
- Reste toujours respectueux, poli et empathique.`;
  }

  /**
   * Répond à une question posée au bot avec injection de contexte RAG (Concierge).
   * 
   * @param {string} userQuestion - Question de l'utilisateur
   * @param {string} authorName - Pseudo de l'utilisateur Discord
   * @param {Array<string>} contextSnippets - Extraits documentaires issus de la base vectorielle (ChromaDB)
   * @param {Object} guildContext - Contexte multi-serveur (guildId, serverVibe, etc.)
   * @returns {Promise<string>} Réponse formatée
   */
  /**
   * Répond à une question posée au bot via un Agent LangChain (Function Calling / OpenAI Tools).
   * L'agent décide dynamiquement s'il doit appeler un outil (Recherche Web, Heure Serveur)
   * ou formuler sa réponse à partir du contexte RAG interne.
   * 
   * @param {string} userQuestion - Question de l'utilisateur
   * @param {string} authorName - Pseudo de l'utilisateur Discord
   * @param {Array<string>} contextSnippets - Extraits documentaires issus de la base vectorielle (ChromaDB)
   * @param {Object} guildContext - Contexte multi-serveur (guildId, serverVibe, etc.)
   * @returns {Promise<string>} Réponse formatée
   */
  async askConcierge(userQuestion, authorName, contextSnippets = [], guildContext = {}) {
    const guildId = guildContext.guildId || 'global';
    const guildName = guildContext.guildName || 'ce serveur';
    const serverVibe = guildContext.serverVibe || 'friendly';

    // =========================================================================
    // FINOPS 1 : VÉRIFICATION DU CACHE SÉMANTIQUE (Similarité > 0.95 = 0 token)
    // =========================================================================
    const cacheResult = await cacheService.get(userQuestion, guildId);
    if (cacheResult.hit) {
      logger.info(`[CONCIERGE] Réponse servie depuis le cache sémantique pour @${authorName} (Économie de tokens)`);
      return cacheResult.response;
    }

    const dynamicPrompt = this.getDynamicConciergePrompt(serverVibe);
    const formattedContext = contextSnippets.length > 0
      ? `\n\n--- INFORMATIONS ET FAQ DU SERVEUR [${guildName}] (CONSIGNE RAG) ---\n${contextSnippets.join('\n---\n')}\n--- FIN DU CONTEXTE ---`
      : `\n\n(Aucun document interne trouvé sur ce sujet pour le serveur ${guildName})`;

    try {
      // 1. Initialisation du modèle ChatOpenAI - Tier Agentic avec limite de tokens stricte
      const llm = new ChatOpenAI({
        apiKey: config.ai.openaiApiKey,
        model: config.ai.tierAgentic,
        temperature: 0.7,
        maxTokens: config.ai.maxTokensAgentic
      });

      // 2. Instructions système de l'agent
      const systemMessage = `${dynamicPrompt}${formattedContext}
Tu as à ta disposition des outils (Function Calling) :
- search_web : pour chercher des informations récentes, faits d'actualité ou définitions si le contexte RAG ne suffit pas.
- get_server_time : pour donner l'heure exacte et la date.
Règle : Si le contexte RAG ou tes connaissances suffisent à répondre précisément, réponds directement sans appeler d'outil inutilement.`;

      // 3. Template structuré
      const promptTemplate = ChatPromptTemplate.fromMessages([
        ['system', systemMessage],
        ['human', '{input}'],
        new MessagesPlaceholder('agent_scratchpad')
      ]);

      // 4. Instanciation de l'Agent OpenAI Tools
      const agent = await createOpenAIToolsAgent({
        llm,
        tools: conciergeTools,
        prompt: promptTemplate
      });

      // 5. Exécuteur de l'Agent
      const executor = new AgentExecutor({
        agent,
        tools: conciergeTools,
        maxIterations: 3,
        verbose: false
      });

      const userInput = `L'utilisateur @${authorName} sur le serveur "${guildName}" te demande : "${userQuestion}"`;
      const result = await executor.invoke({ input: userInput });
      const finalAnswer = (result.output || '').trim();

      // Enregistrement dans le cache sémantique pour les questions futures similaires
      if (finalAnswer) {
        await cacheService.set(userQuestion, finalAnswer, guildId, cacheResult.queryEmbedding);
      }

      return finalAnswer;
    } catch (agentError) {
      logger.warn(`[AI-AGENT] Échec de l'AgentExecutor (${agentError.message}). Repli vers complétion directe...`);

      // Fallback résilient en mode Economy
      try {
        const response = await this._executeWithRetry(async () => {
          return await this.client.chat.completions.create({
            model: config.ai.tierEconomy,
            temperature: 0.7,
            max_tokens: config.ai.maxTokensEconomy,
            messages: [
              { role: 'system', content: dynamicPrompt },
              {
                role: 'user',
                content: `L'utilisateur @${authorName} sur le serveur "${guildName}" te demande : "${userQuestion}"${formattedContext}`
              }
            ]
          });
        });

        const fallbackAnswer = response.choices[0].message.content.trim();
        await cacheService.set(userQuestion, fallbackAnswer, guildId, cacheResult.queryEmbedding);
        return fallbackAnswer;
      } catch (fallbackError) {
        logger.error('[AI-SERVICE] Erreur critique lors de la réponse Concierge :', fallbackError.message);
        return "Désolé, je rencontre actuellement une difficulté technique avec mon service d'intelligence artificielle. Réessaie dans un instant !";
      }
    }
  }

  /**
   * Synthèse comportementale pour la fin du Mode Observation (Vibe Check).
   * Analyse l'échantillon de messages collectés et définit le ton du serveur.
   * 
   * @param {Array<string>} observationSnippets
   * @param {string} guildName
   * @returns {Promise<{serverVibe: string, analysis: string}>}
   */
  async analyzeServerVibe(observationSnippets, guildName = 'Serveur') {
    if (!observationSnippets || observationSnippets.length === 0) {
      return {
        serverVibe: 'Détendue, amicale et bienveillante (profil par défaut)',
        analysis: 'Échantillon de messages trop faible lors de la période d\'observation.'
      };
    }

    const corpus = observationSnippets.slice(0, 45).join('\n');

    try {
      const response = await this._executeWithRetry(async () => {
        return await this.client.chat.completions.create({
          model: config.ai.tierEconomy, // Tier Economy pour l'analyse d'observation
          temperature: 0.3,
          max_tokens: config.ai.maxTokensEconomy,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `Tu es un expert en dynamique communautaire Discord.
Analyse les messages observés ci-dessous sur le serveur "${guildName}".
Définis le ton précis et l'ambiance du serveur (ex: sérieux/pro, chambrage amical/gaming avec fort second degré, entraide technique/codeurs, chill/discussions informelles).

Réponds obligatoirement au format JSON strict :
{
  "serverVibe": "Une formule courte et descriptive (10 à 15 mots max) caractérisant l'ambiance et le style de communication",
  "analysis": "Un résumé synthétique en 2-3 phrases des codes sociaux et expressions remarqués"
}`
            },
            {
              role: 'user',
              content: `Voici l'échantillon des échanges observés :\n\n${corpus}`
            }
          ]
        });
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      return {
        serverVibe: parsed.serverVibe || 'Ambiance détendue et collaborative',
        analysis: parsed.analysis || 'Communauté équilibrée et active.'
      };
    } catch (error) {
      logger.error('[AI-SERVICE] Erreur lors du Vibe Check :', error.message);
      return {
        serverVibe: 'Ambiance conviviale et bienveillante',
        analysis: 'Analyse standard appliquée.'
      };
    }
  }

  /**
   * Génère un résumé TL;DR structuré en 3 points clés à partir d'un ensemble de messages.
   * 
   * @param {Array<{author: string, content: string, timestamp: string}>} messagesList
   * @returns {Promise<string>}
   */
  async summarizeChat(messagesList) {
    if (!messagesList || messagesList.length === 0) {
      return "Aucun message à résumer dans ce salon.";
    }

    const transcript = messagesList
      .map(m => `[${m.timestamp}] ${m.author}: ${m.content}`)
      .join('\n');

    try {
      const response = await this._executeWithRetry(async () => {
        return await this.client.chat.completions.create({
          model: config.ai.tierEconomy, // Tier Economy pour la synthèse de salon
          temperature: 0.3,
          max_tokens: config.ai.maxTokensEconomy,
          messages: [
            {
              role: 'system',
              content: `Tu es un synthétiseur expert pour Discord.
À partir du flux de messages fourni, produis un résumé TL;DR ultra-clair structuré exactement ainsi :
**📌 Résumé Express du salon (100 derniers messages) :**
1. **[Titre Point 1]** : Explication concise en une phrase.
2. **[Titre Point 2]** : Explication concise en une phrase.
3. **[Titre Point 3]** : Explication concise en une phrase.

Termine par une phrase courte sur l'ambiance générale du salon.`
            },
            {
              role: 'user',
              content: `Voici l'historique récent :\n\n${transcript}`
            }
          ]
        });
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error('[AI-SERVICE] Erreur lors du TL;DR :', error.message);
      throw error;
    }
  }

  /**
   * Génère un message d'accueil court, chaleureux, légèrement fun et unique
   * pour un nouveau membre arrivant sur le serveur.
   * Utilise le modèle rapide et économique (ex: gpt-4o-mini).
   * 
   * @param {string} username - Pseudo du nouvel arrivant
   * @param {number} timeoutMs - Délai maximal en ms (défaut: 4500ms)
   * @returns {Promise<string|null>} Message généré ou null en cas d'échec/délai
   */
  async generateWelcomeMessage(username, timeoutMs = 4500) {
    const welcomeCall = (async () => {
      const response = await this._executeWithRetry(async () => {
        return await this.client.chat.completions.create({
          model: config.ai.fastModel,
          temperature: 0.95, // Température haute pour assurer l'originalité à chaque membre
          max_tokens: 120,
          messages: [
            {
              role: 'system',
              content: `Tu es RezaBot, l'hôte d'accueil dynamique, chaleureux et légèrement taquin de ce serveur Discord.
Ton objectif : accueillir un nouveau membre avec un message très court (1 à 2 phrases percutantes maximum), bienveillant, original et fun.
Directives strictes :
- Évite absolument les formules banales et répétitives (ex: "Bienvenue parmi nous, installe-toi confortablement").
- Varie les métaphores (cookies de bienvenue, café virtuel, équipement de héros, salon VIP, etc.).
- Utilise 1 ou 2 émojis bien placés.
- Adresse-toi directement à la personne avec son pseudo "${username}".
- Ne génère pas de mention Discord brute (@ ou <@id>), écris simplement son pseudo.`
            },
            {
              role: 'user',
              content: `Nouveau membre : "${username}". Rédige son mot de bienvenue personnalisé.`
            }
          ]
        });
      }, 1);

      return response.choices[0].message.content.trim();
    })();

    // Timeout pour garantir la réactivité de l'accueil
    const timeoutGuard = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Délai dépassé pour la génération du mot d\'accueil')), timeoutMs);
    });

    try {
      return await Promise.race([welcomeCall, timeoutGuard]);
    } catch (error) {
      logger.warn(`[AI-SERVICE] Échec de la génération IA de bienvenue pour ${username} (${error.message}).`);
      return null;
    }
  }

  /**
   * Génère un message d'accroche naturel et contextuel (Icebreaker)
   * pour relancer l'activité d'un salon inactif depuis plus de 6 heures.
   * 
   * @param {string} guildId
   * @param {Object} serverContext - { guildName, serverVibe, botMode }
   * @param {Array<string>} popularContextSnippets - Extraits issus de ChromaDB
   * @returns {Promise<string>}
   */
  async generateIcebreaker(guildId, serverContext = {}, popularContextSnippets = []) {
    const guildName = serverContext.guildName || 'la communauté';
    const serverVibe = serverContext.serverVibe || 'friendly';

    const formattedContext = (popularContextSnippets && popularContextSnippets.length > 0)
      ? `\n\n--- SUJETS POPULAIRES ET ÉCHANGES RÉCENTS SUR CE SERVEUR ---\n${popularContextSnippets.join('\n---\n')}\n--- FIN DES SUJETS ---`
      : '\n\n(Aucun historique de sujet spécifique trouvé : lance un sujet sympa et fédérateur en accord avec le vibe du serveur)';

    try {
      const response = await this._executeWithRetry(async () => {
        return await this.client.chat.completions.create({
          model: config.ai.chatModel,
          temperature: 0.85,
          max_tokens: 220,
          messages: [
            {
              role: 'system',
              content: `Tu es RezaBot, membre actif et animateur bienveillant de ce serveur Discord.
L'ambiance et le ton du serveur sont : "${serverVibe}".
Le salon actuel est silencieux depuis plusieurs heures. Ton rôle est de relancer la discussion de façon TOTALEMENT NATURELLE, vivante et spontanée (comme un membre passionné qui partage une pensée ou une question ouverte).

RÈGLES CRUCIALES :
- Ne dis JAMAIS que le salon est mort ou inactif (ne dis pas "C'est bien calme ici !", "Personne ne parle ?").
- Fais référence à un sujet, projet, débat ou centre d'intérêt récurrent du serveur parmi ceux fournis en contexte (ex: "Au fait, suite à nos discussions sur [Sujet], je suis tombé sur [anecdote/nouveauté]. Vous en pensez quoi ?").
- Termine par une question ouverte stimulante et facile à répondre.
- Longueur : 2 à 3 phrases maximum, avec du markdown Discord naturel.`
            },
            {
              role: 'user',
              content: `Génère une relance naturelle pour relancer l'échange sur le serveur "${guildName}".${formattedContext}`
            }
          ]
        });
      });

      return response.choices[0].message.content.trim();
    } catch (err) {
      logger.error(`[AI-SERVICE] Erreur lors de la génération de l'icebreaker pour guild ${guildId} :`, err);
      return "Au fait, vous travaillez ou vous jouez sur quoi de beau en ce moment ? J'ai envie de découvrir vos projets récents ! 👀";
    }
  }
}

export const aiService = new AIService();
