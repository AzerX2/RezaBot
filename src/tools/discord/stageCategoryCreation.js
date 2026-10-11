import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { actionTicketManager } from '../../services/actionTicketManager.js';
import { logger } from '../../utils/logger.js';

/**
 * Outil Atomique 5 : stageCategoryCreation
 * Prend un nom de catégorie (categoryName) et un tableau de chaînes (channels).
 * Ne crée rien immédiatement dans Discord.
 * Sauvegarde cette intention dans la base de données / mémoire cache avec un ticketId unique.
 * Retourne à l'Agent : "Action mise en attente. ID du ticket: {ticketId}".
 * 
 * @param {Object} discordContext - { guild, channel, client }
 */
export function createStageCategoryCreationTool(discordContext = {}) {
  return tool(
    async ({ categoryName, channels = [] }) => {
      logger.info(`[TOOL:stageCategoryCreation] Préparation création catégorie "${categoryName}" avec salons :`, channels);
      const { guild } = discordContext;

      try {
        if (!categoryName || !String(categoryName).trim()) {
          return "Erreur : Le nom de la catégorie (categoryName) est obligatoire.";
        }

        const cleanCategoryName = String(categoryName).trim();
        const cleanChannels = Array.isArray(channels)
          ? channels.map(c => String(c).trim()).filter(Boolean)
          : [];

        // Sauvegarde de l'intention dans actionTicketManager et SQLite
        const ticket = actionTicketManager.createTicket({
          type: 'create_category',
          categoryName: cleanCategoryName,
          channels: cleanChannels,
          reason: `Création de la catégorie "${cleanCategoryName}" et de ses salons (${cleanChannels.join(', ') || 'aucun'})`,
          guildId: guild?.id
        });

        // Attachement au contexte Discord pour l'interception UI
        discordContext.pendingAction = ticket;

        return `Action mise en attente. ID du ticket: ${ticket.id}`;
      } catch (err) {
        logger.error('[TOOL:stageCategoryCreation] Erreur lors de la préparation de la catégorie :', err);
        return `Échec lors de la préparation de la création de catégorie : ${err.message}`;
      }
    },
    {
      name: 'stage_category_creation',
      description: 'Prépare la création d\'une nouvelle catégorie Discord avec ses salons enfants associés. Ne crée rien immédiatement : sauvegarde l\'intention avec un ticketId pour confirmation par boutons interactifs.',
      schema: z.object({
        categoryName: z.string().describe('Nom de la catégorie à créer sur le serveur'),
        channels: z.array(z.string()).describe('Tableau des noms des salons enfants à créer dans cette catégorie')
      })
    }
  );
}

export const stageCategoryCreationTool = createStageCategoryCreationTool();
