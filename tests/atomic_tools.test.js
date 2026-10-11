import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  createSearchEntitiesTool,
  searchEntitiesTool,
  createCreateChannelTool,
  createChannelTool,
  createStageDeleteTool,
  stageDeleteTool,
  createStageRenameTool,
  stageRenameTool,
  getToolsForRole
} from '../src/tools/index.js';
import { actionTicketManager } from '../src/services/actionTicketManager.js';
import { aiService } from '../src/services/aiService.js';
import { MockGuild, MockChannel } from './mocks/discord.mock.js';

describe('Suite de tests : Architecture d\'Outils Atomiques (Micro-services)', () => {
  let mockGuild;
  let textChan;
  let voiceChan;
  let catChan;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockGuild = new MockGuild({ id: 'guild-atomic', name: 'Serveur Atomique' });

    textChan = new MockChannel({ id: 'c-text-1', name: 'general', type: ChannelType.GuildText });
    textChan.isTextBased = () => true;
    textChan.isVoiceBased = () => false;

    voiceChan = new MockChannel({ id: 'c-voice-1', name: 'vocal-salon', type: ChannelType.GuildVoice });
    voiceChan.isTextBased = () => false;
    voiceChan.isVoiceBased = () => true;

    catChan = new MockChannel({ id: 'c-cat-1', name: 'espace-chill', type: ChannelType.GuildCategory });
    catChan.isTextBased = () => false;
    catChan.isVoiceBased = () => false;
    textChan.parentId = catChan.id;

    mockGuild.addChannel(textChan);
    mockGuild.addChannel(voiceChan);
    mockGuild.addChannel(catChan);

    // Simulation des rôles
    mockGuild.roles = {
      cache: new Map([
        ['r-admin', { id: 'r-admin', name: 'Admin' }],
        ['r-mod', { id: 'r-mod', name: 'Modérateur' }],
        ['r-everyone', { id: 'r-everyone', name: '@everyone' }]
      ])
    };
  });

  describe('1. searchEntities (Lecture seule & Recherche universelle)', () => {
    it('doit trouver les salons textuels, vocaux, catégories et rôles avec schéma strict', async () => {
      const searchTool = createSearchEntitiesTool({ guild: mockGuild });
      const rawRes = await searchTool.invoke({ name: '' });
      const res = JSON.parse(rawRes);

      expect(Array.isArray(res)).toBe(true);
      const textItem = res.find(item => item.id === 'c-text-1');
      expect(textItem).toMatchObject({
        type: 'text',
        id: 'c-text-1',
        name: 'general'
      });

      const voiceItem = res.find(item => item.id === 'c-voice-1');
      expect(voiceItem).toMatchObject({
        type: 'voice',
        id: 'c-voice-1',
        name: 'vocal-salon'
      });

      const catItem = res.find(item => item.id === 'c-cat-1');
      expect(catItem).toMatchObject({
        type: 'category',
        id: 'c-cat-1',
        name: 'espace-chill'
      });
      expect(catItem.childrenIds).toContain('c-text-1');

      const roleItem = res.find(item => item.id === 'r-mod');
      expect(roleItem).toMatchObject({
        type: 'role',
        id: 'r-mod',
        name: 'Modérateur'
      });
      // Ne doit pas inclure @everyone
      expect(res.find(item => item.name === '@everyone')).toBeUndefined();
    });

    it('doit filtrer correctement par mot-clé (insensible à la casse)', async () => {
      const searchTool = createSearchEntitiesTool({ guild: mockGuild });
      const rawRes = await searchTool.invoke({ name: 'VOCAL' });
      const res = JSON.parse(rawRes);

      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('c-voice-1');
      expect(res[0].name).toBe('vocal-salon');
    });

    it('doit intercepter les erreurs d\'API et retourner un texte explicatif à l\'IA sans crasher', async () => {
      const brokenGuild = {
        channels: {
          get cache() {
            throw new Error('Discord API connection timeout');
          }
        }
      };
      const searchTool = createSearchEntitiesTool({ guild: brokenGuild });
      const result = await searchTool.invoke({ name: 'test' });

      expect(result).toContain('Échec : Erreur lors de la recherche des entités');
      expect(result).toContain('Discord API connection timeout');
    });
  });

  describe('2. createChannel (Création immédiate sans validation humaine)', () => {
    it('doit créer un salon textuel immédiatement et formater le nom', async () => {
      const createdMock = { id: 'new-c-1', name: 'annonces-projets' };
      mockGuild.channels.create = vi.fn().mockResolvedValue(createdMock);
      mockGuild.members = {
        me: {
          permissions: {
            has: vi.fn().mockReturnValue(true)
          }
        }
      };

      const createTool = createCreateChannelTool({ guild: mockGuild });
      const res = await createTool.invoke({ name: 'Annonces Projets', type: 'text' });

      expect(mockGuild.channels.create).toHaveBeenCalledWith({
        name: 'annonces-projets',
        type: ChannelType.GuildText,
        reason: 'Création demandée par RezaBot'
      });
      expect(res).toContain('✅ Le salon <#new-c-1>');
      expect(res).toContain('créé avec succès');
    });

    it('doit refuser et retourner une explication si le bot n\'a pas la permission ManageChannels', async () => {
      mockGuild.members = {
        me: {
          permissions: {
            has: vi.fn().mockReturnValue(false)
          }
        }
      };

      const createTool = createCreateChannelTool({ guild: mockGuild });
      const res = await createTool.invoke({ name: 'vip', type: 'text' });

      expect(res).toContain("Échec : Je n'ai pas la permission Discord de créer des salons (ManageChannels).");
    });

    it('doit intercepter une DiscordAPIError (50013) et retourner le texte clair', async () => {
      mockGuild.members = {
        me: {
          permissions: {
            has: vi.fn().mockReturnValue(true)
          }
        }
      };
      const apiErr = new Error('Missing Permissions');
      apiErr.code = 50013;
      mockGuild.channels.create = vi.fn().mockRejectedValue(apiErr);

      const createTool = createCreateChannelTool({ guild: mockGuild });
      const res = await createTool.invoke({ name: 'secret', type: 'text' });

      expect(res).toContain("Échec : Je n'ai pas la permission Discord de créer ce salon.");
    });
  });

  describe('3. stageDelete (Human-in-the-loop : préparation avec validation par boutons)', () => {
    it('doit préparer la suppression avec un tableau d\'IDs et générer un ticket', async () => {
      const discordContext = { guild: mockGuild };
      const stageTool = createStageDeleteTool(discordContext);

      const res = await stageTool.invoke({ ids: ['c-text-1'], type: 'channel' });

      expect(res).toBe("L'action est mise en attente de confirmation par l'utilisateur.");
      expect(discordContext.pendingAction).toBeDefined();
      expect(discordContext.pendingAction.type).toBe('delete_channels');
      expect(discordContext.pendingAction.channels[0].id).toBe('c-text-1');
    });

    it('doit rejeter les IDs vides avec un message d\'erreur clair pour l\'IA', async () => {
      const stageTool = createStageDeleteTool({ guild: mockGuild });
      const res = await stageTool.invoke({ ids: [] });

      expect(res).toContain("Erreur : Fournis un tableau d'ID valide");
    });

    it('doit retourner une erreur si aucune entité ne correspond sur le serveur', async () => {
      mockGuild.channels.fetch = vi.fn().mockResolvedValue(null);
      const stageTool = createStageDeleteTool({ guild: mockGuild });
      const res = await stageTool.invoke({ ids: ['inexistant-999'] });

      expect(res).toContain("Erreur : Aucune entité correspondante trouvée");
    });
  });

  describe('4. stageRename (Human-in-the-loop : préparation de renommage)', () => {
    it('doit préparer le renommage d\'un salon et générer un ticket', async () => {
      const discordContext = { guild: mockGuild };
      const renameTool = createStageRenameTool(discordContext);

      const res = await renameTool.invoke({ id: 'c-text-1', newName: 'general-discussions' });

      expect(res).toContain("L'action de renommage du salon #general en \"general-discussions\" est mise en attente");
      expect(discordContext.pendingAction).toBeDefined();
      expect(discordContext.pendingAction.type).toBe('rename_channel');
      expect(discordContext.pendingAction.channelId).toBe('c-text-1');
      expect(discordContext.pendingAction.newName).toBe('general-discussions');
    });

    it('doit refuser un appel avec des paramètres invalides ou vides', async () => {
      const renameTool = createStageRenameTool({ guild: mockGuild });
      const res = await renameTool.invoke({ id: '', newName: '' });

      expect(res).toContain("Erreur : Fournis un ID et un nouveau nom valides.");
    });
  });

  describe('5. Intégration du System Prompt & Méthodologie Obligatoire', () => {
    it('le prompt système doit contenir la directive stricte en 4 étapes', () => {
      const prompt = aiService.getDynamicConciergePrompt('formal', 'admin');

      expect(prompt).toContain('METHODOLOGIE OBLIGATOIRE :');
      expect(prompt).toContain('1. Si l\'utilisateur demande une action sur un élément existant, utilise TOUJOURS searchEntities en premier pour trouver l\'ID.');
      expect(prompt).toContain('2. N\'invente jamais d\'ID.');
      expect(prompt).toContain('3. Une fois l\'ID trouvé, utilise l\'outil d\'action approprié.');
      expect(prompt).toContain('4. Si une action nécessite une confirmation, dis à l\'utilisateur que tu as préparé l\'action et qu\'il doit cliquer sur le bouton.');
    });

    it('getToolsForRole(\'admin\') doit inclure tous les outils atomiques', () => {
      const tools = getToolsForRole('admin');
      const names = tools.map(t => t.name);

      expect(names).toContain('search_entities');
      expect(names).toContain('create_channel');
      expect(names).toContain('stage_delete');
      expect(names).toContain('stage_rename');
    });
  });
});
