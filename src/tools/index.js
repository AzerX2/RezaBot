import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ChannelType } from 'discord.js';
import { actionTicketManager } from '../services/actionTicketManager.js';
import { logger } from '../utils/logger.js';
import { createSearchEntitiesTool, searchEntitiesTool } from './discord/searchEntities.js';
import { createCreateChannelTool, createChannelTool } from './discord/createChannel.js';
import { createStageDeleteTool, stageDeleteTool } from './discord/stageDelete.js';
import { createStageRenameTool, stageRenameTool } from './discord/stageRename.js';

export {
  createSearchEntitiesTool,
  searchEntitiesTool,
  createCreateChannelTool,
  createChannelTool,
  createStageDeleteTool,
  stageDeleteTool,
  createStageRenameTool,
  stageRenameTool
};

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
      timezone: z.string().nullable().optional().describe('Le fuseau horaire IANA souhaité, par exemple "Europe/Paris" ou "UTC"')
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
        // Vérification de la permission Discord native du bot
        if (guild.members?.me?.permissions && !guild.members.me.permissions.has('ModerateMembers')) {
          return `Impossible d'appliquer la sanction : le bot ne possède pas la permission Discord native "Exclure temporairement des membres" (ModerateMembers).`;
        }

        const cleanedId = String(userId).replace(/[<@!>]/g, '').trim();
        const member = guild.members?.cache?.get(cleanedId) ||
                       await guild.members?.fetch(cleanedId).catch(() => null);

        if (!member) {
          return `Impossible d'appliquer le timeout : le membre "${userId}" est introuvable sur ce serveur.`;
        }

        if (member.moderatable === false) {
          return `Impossible de sanctionner <@${cleanedId}> : les permissions du bot sont insuffisantes (rôle de l'utilisateur supérieur ou égal au rôle du bot).`;
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
        durationMinutes: z.number().nullable().optional().default(10).describe('Durée de l\'exclusion en minutes (ex: 5, 10, 60)'),
        reason: z.string().nullable().optional().describe('Raison ou motif de la sanction')
      })
    }
  );
}

/**
 * Outil 4 : deleteMessage (Rôle Modérateur & Administrateur)
 * Supprime un message spécifique par son identifiant avec vérification des permissions.
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

        // Vérification de la permission native Discord
        if (targetChannel.permissionsFor && guild?.members?.me && !targetChannel.permissionsFor(guild.members.me).has('ManageMessages')) {
          return `Impossible de supprimer le message : le bot n'a pas la permission Discord native "Gérer les messages" (ManageMessages) dans ce salon.`;
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
        channelId: z.string().nullable().optional().describe('ID du salon où réside le message (optionnel, prend le salon actuel par défaut)'),
        reason: z.string().nullable().optional().describe('Raison de la suppression')
      })
    }
  );
}



/**
 * Outil 6 : deleteChannel (Rôle Administrateur uniquement)
 * Supprime un salon existant par son ID ou nom avec exigence de confirmation explicite.
 */
/**
 * Outil 7 : searchChannelsTool (Recherche autonome des salons et catégories)
 * Permet à l'IA de trouver elle-même les IDs des salons et catégories sans demander d'ID.
 */
export function createSearchChannelsTool(discordContext = {}) {
  return tool(
    async ({ query = '' }) => {
      logger.info(`[TOOL:searchChannels] Recherche de salons ou catégories avec le terme : "${query}"`);
      const { guild } = discordContext;
      if (!guild || !guild.channels?.cache) {
        return JSON.stringify([{ id: 'fake-chan-id', name: query || 'support', type: 'text' }]);
      }

      const q = String(query || '').toLowerCase().trim();
      const rawChannels = typeof guild.channels.cache.values === 'function'
        ? Array.from(guild.channels.cache.values())
        : (guild.channelsMap ? Array.from(guild.channelsMap.values()) : Object.values(guild.channels.cache));

      const matched = rawChannels
        .filter(c => {
          if (!c) return false;
          if (!q) return true;
          return (c.name && c.name.toLowerCase().includes(q)) || c.id === q;
        })
        .slice(0, 15)
        .map(c => {
          const isCategory = c.type === ChannelType.GuildCategory ||
                             c.type === 4 ||
                             c.type === 'category' ||
                             (typeof c.isTextBased === 'function' && !c.isTextBased() && typeof c.isVoiceBased === 'function' && !c.isVoiceBased() && Boolean(c.children || rawChannels.some(other => other && other.parentId === c.id)));

          if (isCategory) {
            let childList = [];
            if (c.children?.cache) {
              const childCache = typeof c.children.cache.values === 'function'
                ? Array.from(c.children.cache.values())
                : Object.values(c.children.cache);
              childList = childCache;
            } else if (Array.isArray(c.children)) {
              childList = c.children;
            } else {
              childList = rawChannels.filter(ch => ch && ch.parentId === c.id && ch.id !== c.id);
            }

            const childrenSummary = childList.map(child => ({
              id: child.id,
              name: child.name,
              type: typeof child.isTextBased === 'function' && child.isTextBased()
                ? 'text'
                : (typeof child.isVoiceBased === 'function' && child.isVoiceBased() ? 'voice' : 'channel')
            }));

            const childrenIds = childrenSummary.map(ch => ch.id);

            return {
              id: c.id,
              name: c.name,
              type: 'category',
              childrenIds,
              children: childrenSummary
            };
          }

          const type = typeof c.isTextBased === 'function' && c.isTextBased()
            ? 'text'
            : (typeof c.isVoiceBased === 'function' && c.isVoiceBased() ? 'voice' : (c.type === 'voice' ? 'voice' : 'text'));

          const item = {
            id: c.id,
            name: c.name,
            type
          };

          if (c.parentId) {
            item.parentId = c.parentId;
          }

          return item;
        });

      return JSON.stringify(matched);
    },
    {
      name: 'search_channels',
      description: 'Recherche des salons ou catégories par nom. Retourne toujours un tableau JSON clair avec les ID. Si c\'est une catégorie, retourne aussi les salons inclus.',
      schema: z.object({
        query: z.string().nullable().optional().describe('Mot-clé ou nom du salon ou de la catégorie recherché(e)')
      })
    }
  );
}

/**
 * Outil 8 : stageChannelDeletionTool (Préparation de suppression & Ticket d'action)
 * Met en attente la suppression d'un ou plusieurs salons et génère un ticket pour validation humaine via boutons.
 */
export function createStageChannelDeletionTool(discordContext = {}) {
  return tool(
    async ({ channelIds, reason = 'Suppression demandée par administrateur' }) => {
      logger.info(`[TOOL:stageChannelDeletion] Mise en attente de suppression pour les salons :`, channelIds);
      const { guild } = discordContext;

      // Bouclier Anti-Boucle : vérification stricte du format des IDs
      if (!channelIds) {
        return "Erreur : Fournis un tableau d'ID valide (ex: [\"123456789\", \"987654321\"]).";
      }

      let ids = [];
      if (Array.isArray(channelIds)) {
        ids = channelIds
          .map(id => (typeof id === 'string' ? id.trim() : (typeof id === 'number' ? String(id) : (id?.id ? String(id.id) : ''))))
          .filter(Boolean);
      } else if (typeof channelIds === 'string' && channelIds.trim()) {
        ids = [channelIds.trim()];
      } else if (typeof channelIds === 'object' && channelIds?.id) {
        ids = [String(channelIds.id).trim()];
      }

      if (ids.length === 0) {
        return "Erreur : Fournis un tableau d'ID valide (ex: [\"123456789\", \"987654321\"]).";
      }

      const resolvedChannels = [];

      for (const rawId of ids) {
        const cleanId = String(rawId).replace(/[<#>]/g, '').trim();
        if (!cleanId) continue;
        let name = cleanId;
        let finalId = cleanId;

        if (guild?.channels?.cache) {
          const chan = guild.channels.cache.get(cleanId) ||
                       guild.channels.cache.find(c => c && c.name && c.name.toLowerCase() === cleanId.toLowerCase()) ||
                       await guild.channels.fetch(cleanId).catch(() => null);
          if (chan) {
            name = chan.name;
            finalId = chan.id;
          }
        }
        resolvedChannels.push({ id: finalId, name });
      }

      if (resolvedChannels.length === 0) {
        return "Erreur : Aucun salon valide trouvé à mettre en attente.";
      }

      // Génération du ticket d'action
      const ticket = actionTicketManager.createTicket({
        type: 'delete_channels',
        channels: resolvedChannels,
        reason,
        guildId: guild?.id
      });

      // Attachement au contexte Discord pour déclencher les boutons dans messageCreate
      discordContext.pendingAction = ticket;

      return `L'action est mise en attente de confirmation par l'utilisateur.`;
    },
    {
      name: 'stage_channel_deletion',
      description: 'Met en attente la suppression de salons Discord identifiés par leurs IDs et génère un ticket d\'action pour validation humaine via boutons Discord.',
      schema: z.object({
        channelIds: z.union([z.array(z.string()), z.string()]).nullable().optional().describe('Tableau des IDs des salons à supprimer (obtenus via search_channels)'),
        reason: z.string().nullable().optional().describe('Raison de la suppression')
      })
    }
  );
}

export function createDeleteChannelTool(discordContext = {}) {
  // Démarre la mise en attente pour garantir la validation humaine par défaut
  const stager = createStageChannelDeletionTool(discordContext);
  return tool(
    async ({ channelId, confirmed = false, reason = 'Suppression demandée à RezaBot' }) => {
      logger.info(`[TOOL:deleteChannel] Demande de suppression du salon "${channelId}" (Confirmé: ${confirmed})`);
      const { guild } = discordContext;
      if (!guild) {
        return `Simulation : le salon "${channelId}" aurait été supprimé avec succès.`;
      }

      // Si non confirmé ou par défaut, créer un ticket d'action pour boutons
      if (!confirmed) {
        await stager.invoke({ channelIds: [channelId], reason });
        return `Confirmation requise : L'action est mise en attente de confirmation par l'utilisateur.`;
      }

      // Si formellement confirmé par l'utilisateur
      if (guild.members?.me?.permissions && !guild.members.me.permissions.has('ManageChannels')) {
        return `Impossible de supprimer le salon : le bot ne possède pas la permission Discord native "Gérer les salons" (ManageChannels).`;
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
      description: 'Supprime un salon sur le serveur Discord ou le met en attente de confirmation humaine.',
      schema: z.object({
        channelId: z.string().describe('ID, mention (<#id>) ou nom exact du salon à supprimer'),
        confirmed: z.boolean().nullable().optional().default(false).describe('Doit être true UNIQUEMENT si l\'utilisateur a explicitement validé'),
        reason: z.string().nullable().optional().describe('Raison de la suppression')
      })
    }
  );
}

// Outils statiques par défaut
export const timeoutUserTool = createTimeoutUserTool();
export const deleteMessageTool = createDeleteMessageTool();
export const deleteChannelTool = createDeleteChannelTool();
export const searchChannelsTool = createSearchChannelsTool();
export const stageChannelDeletionTool = createStageChannelDeletionTool();

/**
 * Retourne les outils adaptés selon le rôle accordé au bot sur le serveur :
 * - member : recherche web + heure serveur
 * - moderator : + timeoutUser, deleteMessage
 * - admin : + timeoutUser, deleteMessage, createChannel, searchChannels, stageChannelDeletion, deleteChannel
 * 
 * @param {string} role - 'member' | 'moderator' | 'admin'
 * @param {Object} discordContext - { guild, channel, client }
 * @returns {Array} Liste des outils LangChain
 */
export function getToolsForRole(role = 'member', discordContext = {}) {
  const baseTools = [
    searchWebTool,
    getServerTimeTool
  ];

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
      createSearchChannelsTool(discordContext),
      createStageChannelDeletionTool(discordContext),
      createDeleteChannelTool(discordContext),
      createSearchEntitiesTool(discordContext),
      createStageDeleteTool(discordContext),
      createStageRenameTool(discordContext)
    ];
  }

  return baseTools;
}

/**
 * Ensemble des outils par défaut fournis à l'Agent LangChain
 */
export const conciergeTools = [searchWebTool, getServerTimeTool];

