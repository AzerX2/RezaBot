import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../utils/logger.js';

/**
 * Outil Atomique 2 : createChannel
 * Prend un nom et un type ('text' | 'voice').
 * Exécute la création immédiatement (pas besoin de confirmation humaine pour une création)
 * et retourne un succès.
 * 
 * @param {Object} discordContext - { guild, channel, client }
 */
export function createCreateChannelTool(discordContext = {}) {
  return tool(
    async ({ name, type = 'text' }) => {
      logger.info(`[TOOL:createChannel] Demande de création immédiate de salon "${name}" (Type: ${type})`);
      const { guild } = discordContext;
      if (!guild) {
        return `Simulation : Le salon #${name} (type: ${type}) a été créé avec succès.`;
      }

      try {
        // Vérification des permissions Discord natives du bot
        if (guild.members?.me?.permissions && !guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return "Échec : Je n'ai pas la permission Discord de créer des salons (ManageChannels).";
        }

        if (!guild.channels?.create) {
          return `Simulation : Le salon #${name} (type: ${type}) a été créé avec succès.`;
        }

        const effectiveType = type || 'text';
        const cleanName = effectiveType === 'voice'
          ? name.trim()
          : name.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');

        const channelType = effectiveType === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;

        const created = await guild.channels.create({
          name: cleanName || name,
          type: channelType,
          reason: 'Création demandée par RezaBot'
        });

        return `✅ Le salon <#${created.id}> (#${created.name}) a été créé avec succès sur le serveur. Type : ${effectiveType}.`;
      } catch (err) {
        logger.error('[TOOL:createChannel] Erreur lors de la création du salon :', err);
        if (err.code === 50013) {
          return "Échec : Je n'ai pas la permission Discord de créer ce salon.";
        }
        return `Échec lors de la création du salon : ${err.message}`;
      }
    },
    {
      name: 'create_channel',
      description: 'Crée un nouveau salon textuel ou vocal sur le serveur Discord immédiatement sans confirmation humaine requise.',
      schema: z.object({
        name: z.string().describe('Nom du nouveau salon (ex: "annonces-projets", "vocal-chill")'),
        type: z.enum(['text', 'voice']).nullable().optional().default('text').describe('Type de salon ("text" pour textuel, "voice" pour vocal)')
      })
    }
  );
}

export const createChannelTool = createCreateChannelTool();
