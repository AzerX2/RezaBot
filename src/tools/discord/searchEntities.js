import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ChannelType } from 'discord.js';
import { logger } from '../../utils/logger.js';

/**
 * Outil Atomique 1 : searchEntities
 * Outil de lecture seule. Cherche dans le serveur et retourne une liste stricte
 * de { type: 'category|text|voice|role', id: '...', name: '...' }
 * 
 * @param {Object} discordContext - { guild, channel, client }
 */
export function createSearchEntitiesTool(discordContext = {}) {
  return tool(
    async ({ name = '' }) => {
      logger.info(`[TOOL:searchEntities] Recherche d'entités avec le nom : "${name}"`);
      const { guild } = discordContext;
      if (!guild) {
        return JSON.stringify([{ type: 'text', id: 'fake-chan-id', name: name || 'general' }]);
      }

      try {
        const q = String(name || '').toLowerCase().trim();
        const results = [];

        // 1. Recherche parmi les salons et catégories
        if (guild.channels?.cache) {
          const rawChannels = typeof guild.channels.cache.values === 'function'
            ? Array.from(guild.channels.cache.values())
            : (guild.channelsMap ? Array.from(guild.channelsMap.values()) : Object.values(guild.channels.cache));

          for (const c of rawChannels) {
            if (!c) continue;
            const match = !q || (c.name && c.name.toLowerCase().includes(q)) || c.id === q;
            if (!match) continue;

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
                  : (typeof child.isVoiceBased === 'function' && child.isVoiceBased() ? 'voice' : 'text')
              }));

              results.push({
                type: 'category',
                id: c.id,
                name: c.name,
                childrenIds: childrenSummary.map(ch => ch.id),
                children: childrenSummary
              });
            } else {
              const type = typeof c.isVoiceBased === 'function' && c.isVoiceBased()
                ? 'voice'
                : (c.type === 'voice' ? 'voice' : 'text');

              const item = {
                type,
                id: c.id,
                name: c.name
              };
              if (c.parentId) {
                item.parentId = c.parentId;
              }
              results.push(item);
            }
          }
        }

        // 2. Recherche parmi les rôles du serveur
        if (guild.roles?.cache) {
          const rawRoles = typeof guild.roles.cache.values === 'function'
            ? Array.from(guild.roles.cache.values())
            : Object.values(guild.roles.cache);

          for (const r of rawRoles) {
            if (!r || r.name === '@everyone') continue;
            const match = !q || (r.name && r.name.toLowerCase().includes(q)) || r.id === q;
            if (match) {
              results.push({
                type: 'role',
                id: r.id,
                name: r.name
              });
            }
          }
        }

        const capped = results.slice(0, 20);
        return JSON.stringify(capped);
      } catch (err) {
        logger.error('[TOOL:searchEntities] Erreur lors de la recherche des entités :', err);
        return `Échec : Erreur lors de la recherche des entités (${err.message}).`;
      }
    },
    {
      name: 'search_entities',
      description: 'Recherche des entités (salons textuels, salons vocaux, catégories, rôles) sur le serveur par nom ou mot-clé. Retourne une liste stricte de { type: \'category|text|voice|role\', id, name }. Outil de lecture seule obligatoire avant toute action sur un élément existant.',
      schema: z.object({
        name: z.string().nullable().optional().describe('Nom ou mot-clé de l\'entité (salon, catégorie, rôle) recherchée sur le serveur')
      })
    }
  );
}

export const searchEntitiesTool = createSearchEntitiesTool();
