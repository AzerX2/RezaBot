import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

/**
 * Outil 1 : searchWebTool
 * Effectue une recherche sur le Web via l'API gratuite DuckDuckGo Instant Answer
 * pour répondre aux questions d'actualité, de définitions ou d'informations récentes.
 */
export const searchWebTool = tool(
  async ({ query }) => {
    logger.info(`[TOOL:searchWeb] Recherche Web lancée pour la requête : "${query}"`);
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'RezaBot-Discord/1.0 (Mozilla/5.0)' }
      });

      if (!res.ok) {
        return `Recherche Web pour "${query}" : Impossible de joindre l'API (HTTP ${res.status}).`;
      }

      const data = await res.json();
      let snippets = [];

      if (data.AbstractText) {
        snippets.push(`Extrait principal (${data.Heading || 'Sujet'}) : ${data.AbstractText}`);
      }

      if (Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, 3)) {
          if (topic.Text) {
            snippets.push(`- ${topic.Text}`);
          }
        }
      }

      if (snippets.length === 0) {
        return `Recherche Web DuckDuckGo pour "${query}" : Aucun résumé direct trouvé. Synthèse des résultats disponibles : sujet lié à "${data.Heading || query}".`;
      }

      return snippets.join('\n');
    } catch (err) {
      logger.error(`[TOOL:searchWeb] Erreur lors de la recherche :`, err);
      return `Erreur lors de la recherche Web pour "${query}" : ${err.message}`;
    }
  },
  {
    name: 'search_web',
    description: 'Recherche des informations récentes, faits d\'actualité, définitions ou données en direct sur le Web.',
    schema: z.object({
      query: z.string().describe('La requête de recherche concise et précise en français ou anglais')
    })
  }
);

/**
 * Outil 2 : getServerTimeTool
 * Retourne l'heure exacte, la date actuelle et le fuseau horaire du serveur.
 */
export const getServerTimeTool = tool(
  async ({ timezone = 'Europe/Paris' }) => {
    logger.info(`[TOOL:getServerTime] Consultation de l'heure exacte (Fuseau: ${timezone})`);
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('fr-FR', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'long'
      });

      const formattedDate = formatter.format(now);
      return `Date et heure actuelles (${timezone}) : ${formattedDate} (ISO: ${now.toISOString()})`;
    } catch {
      const fallback = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
      return `Date et heure actuelles (Europe/Paris) : ${fallback}`;
    }
  },
  {
    name: 'get_server_time',
    description: 'Retourne la date précise, le jour de la semaine et l\'heure exacte actuelle.',
    schema: z.object({
      timezone: z.string().optional().describe('Le fuseau horaire IANA souhaité, par exemple "Europe/Paris" ou "UTC"')
    })
  }
);

/**
 * Ensemble des outils fournis à l'Agent LangChain
 */
export const conciergeTools = [searchWebTool, getServerTimeTool];
