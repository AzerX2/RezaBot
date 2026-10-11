import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { actionTicketManager } from '../../services/actionTicketManager.js';
import { logger } from '../../utils/logger.js';

/**
 * Outil Atomique 4 : stageRename
 * Prend un ID et un nouveau nom. Prépare l'action de renommage pour validation
 * humaine (Human-in-the-loop).
 * 
 * @param {Object} discordContext - { guild, channel, client }
 */
export function createStageRenameTool(discordContext = {}) {
  return tool(
    async ({ id, newName }) => {
      logger.info(`[TOOL:stageRename] Préparation du renommage pour l'entité "${id}" en "${newName}"`);
      const { guild } = discordContext;

      try {
        if (!id || !newName || !String(id).trim() || !String(newName).trim()) {
          return "Erreur : Fournis un ID et un nouveau nom valides.";
        }

        const cleanId = String(id).replace(/[<#>]/g, '').trim();
        const cleanNewName = String(newName).trim();

        let entityName = null;
        let finalId = null;

        if (guild?.channels?.cache) {
          const rawChannels = typeof guild.channels.cache.values === 'function'
            ? Array.from(guild.channels.cache.values())
            : Object.values(guild.channels.cache);
          const chan = (typeof guild.channels.cache.get === 'function' && guild.channels.cache.get(cleanId)) ||
                       rawChannels.find(c => c && c.name && c.name.toLowerCase() === cleanId.toLowerCase()) ||
                       (typeof guild.channels.fetch === 'function' ? await guild.channels.fetch(cleanId).catch(() => null) : null);
          if (chan) {
            entityName = chan.name;
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
            entityName = role.name;
            finalId = role.id;
          }
        }

        if (!finalId && (!guild || !guild.channels?.cache)) {
          finalId = cleanId;
          entityName = cleanId;
        }

        if (!finalId) {
          return `Erreur : L'entité avec l'ID "${cleanId}" est introuvable sur ce serveur.`;
        }

        // Génération du ticket d'action
        const ticket = actionTicketManager.createTicket({
          type: 'rename_channel',
          channelId: finalId,
          channelName: entityName,
          newName: cleanNewName,
          channels: [{ id: finalId, name: entityName }],
          reason: `Renommage de #${entityName} en "${cleanNewName}"`,
          guildId: guild?.id
        });

        // Attachement au contexte Discord pour déclencher les boutons dans messageCreate
        discordContext.pendingAction = ticket;

        return `L'action de renommage du salon #${entityName} en "${cleanNewName}" est mise en attente de confirmation par l'utilisateur.`;
      } catch (err) {
        logger.error('[TOOL:stageRename] Erreur lors de la préparation du renommage :', err);
        return `Échec lors de la préparation du renommage : ${err.message}`;
      }
    },
    {
      name: 'stage_rename',
      description: 'Prépare le renommage d\'un salon, d\'une catégorie ou d\'un rôle existant à partir de son ID et génère un ticket pour validation humaine via boutons Discord.',
      schema: z.object({
        id: z.string().describe('ID Discord de l\'entité à renommer (obtenu via searchEntities)'),
        newName: z.string().describe('Nouveau nom souhaité pour l\'entité')
      })
    }
  );
}

export const stageRenameTool = createStageRenameTool();
