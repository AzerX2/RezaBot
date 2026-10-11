import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { actionTicketManager } from '../../services/actionTicketManager.js';
import { logger } from '../../utils/logger.js';

/**
 * Outil Atomique 3 : stageDelete
 * Prend un tableau d'ID et un type ('channel' | 'category' | 'role' | 'any').
 * Ne supprime rien, mais génère l'intention de suppression pour le système de
 * confirmation par boutons (Human-in-the-loop).
 * 
 * @param {Object} discordContext - { guild, channel, client }
 */
export function createStageDeleteTool(discordContext = {}) {
  return tool(
    async ({ ids, type = 'channel' }) => {
      logger.info(`[TOOL:stageDelete] Préparation de suppression pour les IDs :`, ids);
      const { guild } = discordContext;

      try {
        // Bouclier Anti-Boucle : vérification stricte du format des IDs
        if (!ids) {
          return "Erreur : Fournis un tableau d'ID valide (ex: [\"123456789\", \"987654321\"]).";
        }

        let parsedIds = [];
        if (Array.isArray(ids)) {
          parsedIds = ids
            .map(id => (typeof id === 'string' ? id.trim() : (typeof id === 'number' ? String(id) : (id?.id ? String(id.id) : ''))))
            .filter(Boolean);
        } else if (typeof ids === 'string' && ids.trim()) {
          parsedIds = [ids.trim()];
        } else if (typeof ids === 'object' && ids?.id) {
          parsedIds = [String(ids.id).trim()];
        }

        if (parsedIds.length === 0) {
          return "Erreur : Fournis un tableau d'ID valide (ex: [\"123456789\", \"987654321\"]).";
        }

        const resolvedEntities = [];

        for (const rawId of parsedIds) {
          const cleanId = String(rawId).replace(/[<#>]/g, '').trim();
          if (!cleanId) continue;
          let name = null;
          let finalId = null;

          if (guild?.channels?.cache) {
            const rawChannels = typeof guild.channels.cache.values === 'function'
              ? Array.from(guild.channels.cache.values())
              : Object.values(guild.channels.cache);
            const chan = (typeof guild.channels.cache.get === 'function' && guild.channels.cache.get(cleanId)) ||
                         rawChannels.find(c => c && c.name && c.name.toLowerCase() === cleanId.toLowerCase()) ||
                         (typeof guild.channels.fetch === 'function' ? await guild.channels.fetch(cleanId).catch(() => null) : null);
            if (chan) {
              name = chan.name;
              finalId = chan.id;
            }
          }

          if (!finalId && guild?.roles?.cache) {
            const rawRoles = typeof guild.roles.cache.values === 'function'
              ? Array.from(guild.roles.cache.values())
              : Object.values(guild.roles.cache);
            const role = (typeof guild.roles.cache.get === 'function' && guild.roles.cache.get(cleanId)) ||
                         rawRoles.find(r => r && r.name && r.name.toLowerCase() === cleanId.toLowerCase()) ||
                         (typeof guild.roles.fetch === 'function' ? await guild.roles.fetch(cleanId).catch(() => null) : null);
            if (role) {
              name = role.name;
              finalId = role.id;
            }
          }

          if (!finalId && (!guild || !guild.channels?.cache)) {
            finalId = cleanId;
            name = cleanId;
          }

          if (finalId) {
            resolvedEntities.push({ id: finalId, name, type });
          }
        }

        if (resolvedEntities.length === 0) {
          return "Erreur : Aucune entité correspondante trouvée sur ce serveur pour les ID fournis.";
        }

        // Génération du ticket d'action
        const ticket = actionTicketManager.createTicket({
          type: 'delete_channels',
          channels: resolvedEntities,
          reason: 'Suppression demandée par administrateur',
          guildId: guild?.id
        });

        // Attachement au contexte Discord pour déclencher les boutons dans messageCreate
        discordContext.pendingAction = ticket;

        return "L'action est mise en attente de confirmation par l'utilisateur.";
      } catch (err) {
        logger.error('[TOOL:stageDelete] Erreur lors de la préparation de la suppression :', err);
        return `Échec lors de la préparation de la suppression : ${err.message}`;
      }
    },
    {
      name: 'stage_delete',
      description: 'Prépare la suppression d\'une ou plusieurs entités (salons, catégories, rôles) à partir de leurs IDs et génère un ticket pour validation humaine obligatoire via boutons Discord.',
      schema: z.object({
        ids: z.union([z.array(z.string()), z.string()]).nullable().optional().describe('Tableau des IDs des entités à supprimer (obtenus via searchEntities)'),
        type: z.enum(['channel', 'category', 'role', 'any']).nullable().optional().default('channel').describe('Type des entités à supprimer')
      })
    }
  );
}

export const stageDeleteTool = createStageDeleteTool();
