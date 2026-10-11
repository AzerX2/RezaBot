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
  createStageCategoryCreationTool,
  stageCategoryCreationTool,
  getToolsForRole
} from '../src/tools/index.js';
import { actionTicketManager } from '../src/services/actionTicketManager.js';
import { databaseService } from '../src/services/databaseService.js';
import { aiService } from '../src/services/aiService.js';
import messageCreateEvent from '../src/events/messageCreate.js';
import interactionCreateEvent from '../src/events/interactionCreate.js';
import { MockGuild, MockChannel, MockMessage, MockUser, MockClient } from './mocks/discord.mock.js';

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

  describe('5. stageCategoryCreation (Préparation création catégorie et salons enfants)', () => {
    it('doit préparer la création de catégorie, enregistrer le ticket et retourner l\'ID du ticket', async () => {
      const discordContext = { guild: mockGuild };
      const categoryTool = createStageCategoryCreationTool(discordContext);

      const res = await categoryTool.invoke({
        categoryName: 'Pôle Développement',
        channels: ['annonces-dev', 'code-review', 'chat-tech']
      });

      expect(res).toContain('Action mise en attente. ID du ticket:');
      expect(discordContext.pendingAction).toBeDefined();
      expect(discordContext.pendingAction.type).toBe('create_category');
      expect(discordContext.pendingAction.categoryName).toBe('Pôle Développement');
      expect(discordContext.pendingAction.channels).toEqual(['annonces-dev', 'code-review', 'chat-tech']);

      const ticketId = discordContext.pendingAction.id;
      expect(actionTicketManager.getTicket(ticketId)).toBeDefined();
    });

    it('doit rejeter un appel sans nom de catégorie', async () => {
      const categoryTool = createStageCategoryCreationTool({ guild: mockGuild });
      const res = await categoryTool.invoke({ categoryName: '', channels: ['chan-1'] });

      expect(res).toContain('Erreur : Le nom de la catégorie (categoryName) est obligatoire.');
    });
  });

  describe('6. Intégration du System Prompt (Règles strictes 1 & 2)', () => {
    it('le prompt système doit contenir la directive stricte en 4 étapes et les règles 1 et 2', () => {
      const prompt = aiService.getDynamicConciergePrompt('formal', 'admin');

      expect(prompt).toContain('METHODOLOGIE OBLIGATOIRE :');
      expect(prompt).toContain('1. Si l\'utilisateur demande une action sur un élément existant, utilise TOUJOURS searchEntities en premier pour trouver l\'ID.');
      expect(prompt).toContain('2. N\'invente jamais d\'ID.');
      expect(prompt).toContain('3. Une fois l\'ID trouvé, utilise l\'outil d\'action approprié.');
      expect(prompt).toContain('4. Si une action nécessite une confirmation, dis à l\'utilisateur que tu as préparé l\'action et qu\'il doit cliquer sur le bouton.');

      // RÈGLE 1 & RÈGLE 2
      expect(prompt).toContain("RÈGLE 1 : Ne montre JAMAIS d'ID Discord (ex: 883823...) à l'utilisateur. Utilise uniquement les noms des salons (ex: #support).");
      expect(prompt).toContain("RÈGLE 2 : Si un outil retourne 'Action mise en attente', tu DOIS répondre EXACTEMENT par : '[ACTION_PENDING] J'ai préparé l'action. Clique sur le bouton ci-dessous pour confirmer.' Ne dis JAMAIS que c'est fait.");
    });

    it('getToolsForRole(\'admin\') doit inclure tous les outils atomiques y compris stage_category_creation', () => {
      const tools = getToolsForRole('admin');
      const names = tools.map(t => t.name);

      expect(names).toContain('search_entities');
      expect(names).toContain('create_channel');
      expect(names).toContain('stage_delete');
      expect(names).toContain('stage_rename');
      expect(names).toContain('stage_category_creation');
    });
  });

  describe('7. Interception UI dans messageCreate.js ([ACTION_PENDING] & Boutons)', () => {
    it('doit intercepter [ACTION_PENDING], nettoyer la chaîne et attacher les boutons Confirmer/Annuler', async () => {
      const mockClient = new MockClient();
      const mockChannel = new MockChannel({ id: 'c-test-msg', name: 'general' });
      const user = new MockUser({ id: 'u-admin', username: 'BossAdmin' });

      const msg = new MockMessage({
        id: 'msg-action-pending',
        content: 'Reza crée la catégorie Projets avec dev et test',
        author: user,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      vi.spyOn(aiService, 'askConcierge').mockImplementation(async (q, a, c, g, discordCtx) => {
        discordCtx.pendingAction = actionTicketManager.createTicket({
          type: 'create_category',
          categoryName: 'Projets',
          channels: ['dev', 'test'],
          guildId: mockGuild.id
        });
        return "[ACTION_PENDING] J'ai préparé l'action. Clique sur le bouton ci-dessous pour confirmer.";
      });

      await messageCreateEvent.execute(msg);

      expect(msg.reply).toHaveBeenCalledTimes(1);
      const replyCall = msg.reply.mock.calls[0][0];

      // Vérifie que [ACTION_PENDING] a été nettoyé
      expect(replyCall.content).not.toContain('[ACTION_PENDING]');
      expect(replyCall.content).toBe("J'ai préparé l'action. Clique sur le bouton ci-dessous pour confirmer.");

      // Vérifie les boutons
      expect(replyCall.components).toBeDefined();
      expect(replyCall.components).toHaveLength(1);
      const buttons = replyCall.components[0].components;
      expect(buttons[0].data.label).toBe('Confirmer');
      expect(buttons[0].data.custom_id).toContain('confirm_action_');
      expect(buttons[1].data.label).toBe('Annuler');
      expect(buttons[1].data.custom_id).toContain('cancel_action_');
    });
  });

  describe('8. Confirmation native dans interactionCreate.js (Exécution 0 IA)', () => {
    it('doit créer la catégorie et les salons enfants puis afficher le message de succès', async () => {
      const ticket = actionTicketManager.createTicket({
        type: 'create_category',
        categoryName: 'Espace Gaming',
        channels: ['general-gaming', 'vocal-discord'],
        guildId: mockGuild.id
      });

      const createdCat = { id: 'new-cat-99', name: 'Espace Gaming' };
      mockGuild.channels.create = vi.fn().mockImplementation(async ({ name, type }) => {
        if (type === ChannelType.GuildCategory) {
          return createdCat;
        }
        return { id: `chan-${name}`, name };
      });

      const mockInteraction = {
        isButton: () => true,
        customId: `confirm_action_${ticket.id}`,
        memberPermissions: { has: vi.fn().mockReturnValue(true) },
        reply: vi.fn().mockResolvedValue(true),
        update: vi.fn().mockResolvedValue(true),
        guild: mockGuild,
        user: { tag: 'Admin#0001' }
      };

      await interactionCreateEvent.execute(mockInteraction);

      // Vérifie la création de la catégorie
      expect(mockGuild.channels.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Espace Gaming',
        type: ChannelType.GuildCategory
      }));

      // Vérifie la création des 2 salons enfants
      expect(mockGuild.channels.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'general-gaming',
        type: ChannelType.GuildText,
        parent: 'new-cat-99'
      }));
      expect(mockGuild.channels.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'vocal-discord',
        type: ChannelType.GuildText,
        parent: 'new-cat-99'
      }));

      // Vérifie la suppression des boutons et le message de confirmation exact
      expect(mockInteraction.update).toHaveBeenCalledWith({
        content: '✅ La catégorie et les salons ont été créés avec succès !',
        embeds: [],
        components: []
      });

      // Le ticket doit être supprimé après exécution
      expect(actionTicketManager.getTicket(ticket.id)).toBeUndefined();
    });
  });
});
