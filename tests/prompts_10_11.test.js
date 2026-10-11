import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { createSearchChannelsTool, createStageChannelDeletionTool } from '../src/tools/index.js';
import { actionTicketManager } from '../src/services/actionTicketManager.js';
import { aiService } from '../src/services/aiService.js';
import messageCreateEvent from '../src/events/messageCreate.js';
import interactionCreateEvent from '../src/events/interactionCreate.js';
import { MockMessage, MockChannel, MockGuild, MockUser, MockClient } from './mocks/discord.mock.js';

describe('Suite de tests : Prompts 10 & 11 (Mémoire Conversationnelle & Agentic Human-in-the-Loop)', () => {
  let mockClient;
  let mockGuild;
  let mockChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = new MockClient();
    mockGuild = new MockGuild({ id: 'guild-mega', name: 'Serveur Mega Test' });
    mockChannel = new MockChannel({ id: 'chan-general', name: 'general' });
    mockGuild.addChannel(mockChannel);
  });

  // ===========================================================================
  // PROMPT 10 : MÉMOIRE CONVERSATIONNELLE À COURT TERME
  // ===========================================================================
  describe('Prompt 10 : Mémoire conversationnelle & Compréhension implicite', () => {
    it('le prompt système doit contenir la consigne sur les références implicites', () => {
      const prompt = aiService.getDynamicConciergePrompt('chill', 'member');
      expect(prompt).toContain("Utilise l'historique récent de la conversation pour comprendre les références implicites (comme 'il', 'ça', 'le dernier').");
    });

    it('messageCreate doit récupérer les 6 messages et formater l\'historique pour askConcierge', async () => {
      const user = new MockUser({ id: 'user-bob', username: 'Bob' });
      const triggeringMessage = new MockMessage({
        id: 'msg-now',
        content: 'Reza que dit-il ?',
        author: user,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient,
        mentionedBot: false
      });

      // Simulation de l'historique dans le salon (les 6 derniers messages)
      const msg1 = { id: 'm1', createdTimestamp: 100, author: { id: 'user-alice', username: 'Alice' }, member: { displayName: 'Alice' }, content: 'J\'aime le café.' };
      const msg2 = { id: 'm2', createdTimestamp: 200, author: { id: mockClient.user.id }, member: { displayName: 'RezaBot' }, content: 'Super choix !' };
      const msg3 = { id: 'm3', createdTimestamp: 300, author: { id: 'user-bob', username: 'Bob' }, member: { displayName: 'Bob' }, content: 'Et moi j\'aime le thé.' };
      const msgCurrent = { id: 'msg-now', createdTimestamp: 400, author: { id: 'user-bob' }, content: 'Reza que dit-il ?' };

      const messageMap = new Map([
        ['m1', msg1],
        ['m2', msg2],
        ['m3', msg3],
        ['msg-now', msgCurrent]
      ]);

      mockChannel.messages.fetch = vi.fn().mockResolvedValue(messageMap);

      const compressSpy = vi.spyOn(aiService, 'compressContext').mockResolvedValue('Alice café, Bob thé.');
      const askConciergeSpy = vi.spyOn(aiService, 'askConcierge').mockResolvedValue('Alice a dit qu\'elle aime le café.');

      await messageCreateEvent.execute(triggeringMessage);

      expect(mockChannel.messages.fetch).toHaveBeenCalledWith({ limit: 6 });
      expect(compressSpy).toHaveBeenCalledTimes(1);

      // Vérifier que compressContext a reçu l'historique complet des 3 messages
      const rawPassedToCompress = compressSpy.mock.calls[0][0];
      expect(rawPassedToCompress).toHaveLength(3);
      expect(rawPassedToCompress[0]).toEqual({
        role: 'user',
        content: "J'aime le café.",
        name: 'Alice'
      });
      expect(rawPassedToCompress[1]).toEqual({
        role: 'assistant',
        content: 'Super choix !',
        name: 'RezaBot'
      });
      expect(rawPassedToCompress[2]).toEqual({
        role: 'user',
        content: "Et moi j'aime le thé.",
        name: 'Bob'
      });

      // Vérifier le 6ème argument passé à askConcierge (conversationHistory compressé)
      expect(askConciergeSpy).toHaveBeenCalled();
      const passedHistory = askConciergeSpy.mock.calls[0][5];
      expect(passedHistory).toBeDefined();
      expect(passedHistory[0].content).toContain('Alice café, Bob thé.');
    });
  });

  // ===========================================================================
  // PROMPT 11 : RECHERCHE AUTONOME & STAGING TICKET
  // ===========================================================================
  describe('Prompt 11 : Outils searchChannelsTool et stageChannelDeletionTool', () => {
    it('searchChannelsTool doit retrouver les salons correspondants sans demander d\'ID', async () => {
      const chanSupport = new MockChannel({ id: 'chan-supp-123', name: 'support' });
      const chanMooxy = new MockChannel({ id: 'chan-mooxy-456', name: 'mooxy-world' });
      mockGuild.addChannel(chanSupport);
      mockGuild.addChannel(chanMooxy);

      const tool = createSearchChannelsTool({ guild: mockGuild });
      const rawResult = await tool.invoke({ query: 'mooxy' });
      const channels = JSON.parse(rawResult);

      expect(channels).toHaveLength(1);
      expect(channels[0]).toEqual({
        id: 'chan-mooxy-456',
        name: 'mooxy-world',
        type: 'text'
      });
    });

    it('stageChannelDeletionTool doit créer un ticket et retourner la phrase de mise en attente', async () => {
      const chanSupport = new MockChannel({ id: 'chan-supp-123', name: 'support' });
      const chanMooxy = new MockChannel({ id: 'chan-mooxy-456', name: 'mooxy-world' });
      mockGuild.addChannel(chanSupport);
      mockGuild.addChannel(chanMooxy);

      const discordContext = { guild: mockGuild };
      const tool = createStageChannelDeletionTool(discordContext);

      const result = await tool.invoke({
        channelIds: ['chan-supp-123', 'chan-mooxy-456'],
        reason: 'Nettoyage des anciens salons'
      });

      expect(result).toBe("L'action est mise en attente de confirmation par l'utilisateur.");
      expect(discordContext.pendingAction).toBeDefined();
      expect(discordContext.pendingAction.type).toBe('delete_channels');
      expect(discordContext.pendingAction.channels).toHaveLength(2);

      const ticketInManager = actionTicketManager.getTicket(discordContext.pendingAction.id);
      expect(ticketInManager).toBeDefined();
      expect(ticketInManager.channels[0].name).toBe('support');
    });

    it('messageCreate doit afficher l\'EmbedBuilder et les boutons Confirmer/Annuler si une action est mise en attente', async () => {
      const user = new MockUser({ id: 'admin-1', username: 'SuperAdmin' });
      const msg = new MockMessage({
        id: 'msg-cmd-del',
        content: 'Reza supprime les salons support et mooxy-world',
        author: user,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      vi.spyOn(aiService, 'askConcierge').mockImplementation(async (q, a, c, g, discordCtx) => {
        discordCtx.pendingAction = actionTicketManager.createTicket({
          type: 'delete_channels',
          channels: [{ id: 'c1', name: 'support' }, { id: 'c2', name: 'mooxy-world' }],
          reason: 'Nettoyage automatique',
          guildId: mockGuild.id
        });
        return "J'ai préparé la suppression.";
      });

      await messageCreateEvent.execute(msg);

      expect(msg.reply).toHaveBeenCalledTimes(1);
      const replyPayload = msg.reply.mock.calls[0][0];

      // Vérification de l'embed
      expect(replyPayload.embeds).toBeDefined();
      expect(replyPayload.embeds).toHaveLength(1);
      const embed = replyPayload.embeds[0].data;
      expect(embed.description).toContain("⚠️ Action requise : Je m'apprête à supprimer les salons : #support, #mooxy-world. Es-tu sûr ?");

      // Vérification des boutons
      expect(replyPayload.components).toBeDefined();
      expect(replyPayload.components).toHaveLength(1);
      const buttons = replyPayload.components[0].components;
      expect(buttons).toHaveLength(2);
      expect(buttons[0].data.label).toBe('Confirmer');
      expect(buttons[0].data.custom_id).toContain('confirm_action_');
      expect(buttons[1].data.label).toBe('Annuler');
      expect(buttons[1].data.custom_id).toContain('cancel_action_');
    });
  });

  // ===========================================================================
  // INTERACTIONCREATE : BOUTONS CONFIRMER / ANNULER
  // ===========================================================================
  describe('interactionCreate : Validation humaine par boutons interactifs', () => {
    it('doit refuser l\'interaction si l\'utilisateur n\'a pas la permission Administrateur', async () => {
      const ticket = actionTicketManager.createTicket({
        type: 'delete_channels',
        channels: [{ id: 'chan-1', name: 'general' }]
      });

      const mockInteraction = {
        isButton: () => true,
        isChatInputCommand: () => false,
        customId: `confirm_action_${ticket.id}`,
        memberPermissions: {
          has: (perm) => perm !== PermissionFlagsBits.Administrator
        },
        reply: vi.fn().mockResolvedValue(true),
        update: vi.fn().mockResolvedValue(true),
        guild: mockGuild,
        user: { tag: 'UserSimple#0001' }
      };

      await interactionCreateEvent.execute(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('Seul un administrateur'),
        ephemeral: true
      });
      expect(mockInteraction.update).not.toHaveBeenCalled();
    });

    it('doit annuler l\'action et éditer le message avec "❌ Action annulée" si l\'admin clique Annuler', async () => {
      const ticket = actionTicketManager.createTicket({
        type: 'delete_channels',
        channels: [{ id: 'chan-1', name: 'general' }]
      });

      const mockInteraction = {
        isButton: () => true,
        isChatInputCommand: () => false,
        customId: `cancel_action_${ticket.id}`,
        memberPermissions: {
          has: (perm) => perm === PermissionFlagsBits.Administrator
        },
        reply: vi.fn().mockResolvedValue(true),
        update: vi.fn().mockResolvedValue(true),
        guild: mockGuild,
        user: { tag: 'Admin#0001' }
      };

      await interactionCreateEvent.execute(mockInteraction);

      expect(mockInteraction.update).toHaveBeenCalledWith({
        content: '❌ Action annulée',
        embeds: [],
        components: []
      });
      expect(actionTicketManager.getTicket(ticket.id)).toBeUndefined();
    });

    it('doit supprimer les salons et éditer le message avec "✅ Fait !" si l\'admin clique Confirmer', async () => {
      const chanToDelete = new MockChannel({ id: 'chan-to-del-99', name: 'old-chat' });
      chanToDelete.delete = vi.fn().mockResolvedValue(true);
      mockGuild.addChannel(chanToDelete);

      const ticket = actionTicketManager.createTicket({
        type: 'delete_channels',
        channels: [{ id: 'chan-to-del-99', name: 'old-chat' }],
        reason: 'Demande de l\'administrateur'
      });

      const mockInteraction = {
        isButton: () => true,
        isChatInputCommand: () => false,
        customId: `confirm_action_${ticket.id}`,
        memberPermissions: {
          has: (perm) => perm === PermissionFlagsBits.Administrator
        },
        reply: vi.fn().mockResolvedValue(true),
        update: vi.fn().mockResolvedValue(true),
        guild: mockGuild,
        user: { tag: 'Admin#0001' }
      };

      await interactionCreateEvent.execute(mockInteraction);

      expect(chanToDelete.delete).toHaveBeenCalledWith('Demande de l\'administrateur');
      expect(mockInteraction.update).toHaveBeenCalledWith({
        content: '✅ Fait !',
        embeds: [],
        components: []
      });
      expect(actionTicketManager.getTicket(ticket.id)).toBeUndefined();
    });
  });
});
