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
 * Outil 3 : timeoutUser (Rôle Modérateur & Administrateur)
 * Met un membre en sourdine temporaire (timeout) sur le serveur.
 */
export function createTimeoutUserTool(discordContext = {}) {
  return tool(
    async ({ userId, durationMinutes = 10, reason = 'Modération automatique par RezaBot' }) => {
      logger.info(`[TOOL:timeoutUser] Demande de timeout pour ${userId} (${durationMinutes}min, Raison: ${reason})`);
      const { guild } = discordContext;
      if (!guild) {
        return `Simulation de timeout réussie : l'utilisateur ${userId} recevrait un timeout de ${durationMinutes} minute(s) pour le motif : "${reason}".`;
      }

      try {
        const cleanedId = String(userId).replace(/[<@!>]/g, '').trim();
        const member = guild.members?.cache?.get(cleanedId) ||
                       await guild.members?.fetch(cleanedId).catch(() => null);

        if (!member) {
          return `Impossible d'appliquer le timeout : le membre "${userId}" est introuvable sur ce serveur.`;
        }

        if (member.moderatable === false) {
          return `Impossible de sanctionner <@${cleanedId}> : les permissions du bot sont insuffisantes (rôle trop élevé).`;
        }

        const durationMs = Math.min(Math.max(1, durationMinutes), 40320) * 60 * 1000;
        await member.timeout(durationMs, reason);
        return `✅ L'utilisateur <@${cleanedId}> (${member.user?.tag || cleanedId}) a été mis en sourdine (timeout) pour une durée de ${durationMinutes} minute(s). Raison : ${reason}`;
      } catch (err) {
        logger.error('[TOOL:timeoutUser] Erreur lors de l\'exécution du timeout :', err);
        return `Échec de la mise en sourdine de l'utilisateur : ${err.message}`;
      }
    },
    {
      name: 'timeout_user',
      description: 'Exclut temporairement (timeout / sourdine) un membre du serveur Discord pour une durée déterminée avec une raison justifiée.',
      schema: z.object({
        userId: z.string().describe('ID Discord ou mention de l\'utilisateur à mettre en sourdine (ex: "123456789" ou "<@123456789>")'),
        durationMinutes: z.number().default(10).describe('Durée de l\'exclusion en minutes (ex: 5, 10, 60)'),
        reason: z.string().optional().describe('Raison ou motif de la sanction')
      })
    }
  );
}

/**
 * Outil 4 : deleteMessage (Rôle Modérateur & Administrateur)
 * Supprime un message spécifique par son identifiant.
 */
export function createDeleteMessageTool(discordContext = {}) {
  return tool(
    async ({ messageId, channelId, reason = 'Suppression par RezaBot' }) => {
      logger.info(`[TOOL:deleteMessage] Demande de suppression du message ${messageId}`);
      const { guild, channel: currentChannel } = discordContext;

      try {
        let targetChannel = currentChannel;
        if (channelId && guild) {
          targetChannel = guild.channels?.cache?.get(channelId) ||
                          await guild.channels?.fetch(channelId).catch(() => null);
        }

        if (!targetChannel || typeof targetChannel.messages?.fetch !== 'function') {
          return `Salon introuvable pour supprimer le message ${messageId}.`;
        }

        const targetMessage = await targetChannel.messages.fetch(messageId).catch(() => null);
        if (!targetMessage) {
          return `Message "${messageId}" introuvable ou déjà supprimé.`;
        }

        await targetMessage.delete();
        return `✅ Le message ${messageId} a été supprimé avec succès du salon #${targetChannel.name || 'salon'}. Motif : ${reason}`;
      } catch (err) {
        logger.error('[TOOL:deleteMessage] Erreur suppression message :', err);
        return `Échec de la suppression du message : ${err.message}`;
      }
    },
    {
      name: 'delete_message',
      description: 'Supprime un message spécifique par son ID dans un salon textuel Discord.',
      schema: z.object({
        messageId: z.string().describe('ID du message Discord à supprimer'),
        channelId: z.string().optional().describe('ID du salon où réside le message (optionnel, prend le salon actuel par défaut)'),
        reason: z.string().optional().describe('Raison de la suppression')
      })
    }
  );
}

/**
 * Outil 5 : createChannel (Rôle Administrateur uniquement)
 * Crée un nouveau salon sur le serveur Discord.
 */
export function createCreateChannelTool(discordContext = {}) {
  return tool(
    async ({ name, type = 'text', reason = 'Création demandée à RezaBot' }) => {
      logger.info(`[TOOL:createChannel] Demande de création de salon "${name}" (Type: ${type})`);
      const { guild } = discordContext;
      if (!guild || !guild.channels?.create) {
        return `Simulation : le salon #${name} (type: ${type}) aurait été créé avec succès.`;
      }

      try {
        const cleanName = name.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
        const channelType = type === 'voice' ? 2 : 0; // 0 = GuildText, 2 = GuildVoice

        const created = await guild.channels.create({
          name: cleanName || name,
          type: channelType,
          reason
        });

        return `✅ Le salon <#${created.id}> (#${created.name}) a été créé avec succès sur le serveur. Type : ${type}.`;
      } catch (err) {
        logger.error('[TOOL:createChannel] Erreur création salon :', err);
        return `Échec de la création du salon : ${err.message}`;
      }
    },
    {
      name: 'create_channel',
      description: 'Crée un nouveau salon textuel ou vocal sur le serveur Discord si l\'administrateur le demande explicitement.',
      schema: z.object({
        name: z.string().describe('Nom du nouveau salon (ex: "annonces-projets", "vocal-chill")'),
        type: z.enum(['text', 'voice']).default('text').describe('Type de salon ("text" pour textuel, "voice" pour vocal)'),
        reason: z.string().optional().describe('Motif de création')
      })
    }
  );
}

/**
 * Outil 6 : deleteChannel (Rôle Administrateur uniquement)
 * Supprime un salon existant par son ID ou nom.
 */
export function createDeleteChannelTool(discordContext = {}) {
  return tool(
    async ({ channelId, reason = 'Suppression demandée à RezaBot' }) => {
      logger.info(`[TOOL:deleteChannel] Demande de suppression du salon "${channelId}"`);
      const { guild } = discordContext;
      if (!guild) {
        return `Simulation : le salon "${channelId}" aurait été supprimé avec succès.`;
      }

      try {
        const cleanId = channelId.replace(/[<#>]/g, '').trim();
        const targetChannel = guild.channels?.cache?.get(cleanId) ||
                              guild.channels?.cache?.find(c => c.name.toLowerCase() === cleanId.toLowerCase()) ||
                              await guild.channels?.fetch(cleanId).catch(() => null);

        if (!targetChannel) {
          return `Salon "${channelId}" introuvable sur le serveur.`;
        }

        const channelName = targetChannel.name;
        await targetChannel.delete(reason);
        return `✅ Le salon #${channelName} (${cleanId}) a été supprimé définitivement du serveur. Raison : ${reason}`;
      } catch (err) {
        logger.error('[TOOL:deleteChannel] Erreur suppression salon :', err);
        return `Échec de la suppression du salon : ${err.message}`;
      }
    },
    {
      name: 'delete_channel',
      description: 'Supprime un salon sur le serveur Discord si explicitement demandé par l\'administrateur.',
      schema: z.object({
        channelId: z.string().describe('ID, mention (<#id>) ou nom exact du salon à supprimer'),
        reason: z.string().optional().describe('Raison de la suppression')
      })
    }
  );
}

// Outils statiques par défaut
export const timeoutUserTool = createTimeoutUserTool();
export const deleteMessageTool = createDeleteMessageTool();
export const createChannelTool = createCreateChannelTool();
export const deleteChannelTool = createDeleteChannelTool();

/**
 * Retourne les outils adaptés selon le rôle accordé au bot sur le serveur :
 * - member : recherche web + heure serveur
 * - moderator : + timeoutUser, deleteMessage
 * - admin : + timeoutUser, deleteMessage, createChannel, deleteChannel
 * 
 * @param {string} role - 'member' | 'moderator' | 'admin'
 * @param {Object} discordContext - { guild, channel, client }
 * @returns {Array} Liste des outils LangChain
 */
export function getToolsForRole(role = 'member', discordContext = {}) {
  const baseTools = [searchWebTool, getServerTimeTool];

  if (role === 'moderator') {
    return [
      ...baseTools,
      createTimeoutUserTool(discordContext),
      createDeleteMessageTool(discordContext)
    ];
  }

  if (role === 'admin') {
    return [
      ...baseTools,
      createTimeoutUserTool(discordContext),
      createDeleteMessageTool(discordContext),
      createCreateChannelTool(discordContext),
      createDeleteChannelTool(discordContext)
    ];
  }

  return baseTools;
}

/**
 * Ensemble des outils par défaut fournis à l'Agent LangChain
 */
export const conciergeTools = [searchWebTool, getServerTimeTool];
