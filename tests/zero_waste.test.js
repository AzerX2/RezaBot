import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentExecutor } from 'langchain/agents';
import guildMemberAddEvent, { welcomeMessages } from '../src/events/guildMemberAdd.js';
import messageCreateEvent, { idleResponses } from '../src/events/messageCreate.js';
import { aiService } from '../src/services/aiService.js';
import { databaseService } from '../src/services/databaseService.js';
import { MockMessage, MockChannel, MockGuild, MockUser, MockClient } from './mocks/discord.mock.js';

describe('Suite de tests : FinOps Zero Waste & Optimisation de Tokens', () => {
  let mockClient;
  let mockGuild;
  let mockChannel;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockClient = new MockClient();
    mockGuild = new MockGuild({ id: 'guild-zero-waste', name: 'Serveur FinOps' });
    mockChannel = new MockChannel({ id: 'chan-welcome', name: 'bienvenue' });
    mockGuild.addChannel(mockChannel);
  });

  describe('1. Événement d\'accueil guildMemberAdd (Zero Waste)', () => {
    it('welcomeMessages doit contenir exactement 10 phrases d\'accroche variées et stylisées', () => {
      expect(welcomeMessages).toBeDefined();
      expect(welcomeMessages).toHaveLength(10);

      // Vérifier que chaque message contient la mention du membre
      for (const item of welcomeMessages) {
        const rendered = typeof item === 'function' ? item('<@123>') : item.replace('{mention}', '<@123>');
        expect(rendered).toContain('<@123>');
      }
    });

    it('doit envoyer un message d\'accueil sans JAMAIS appeler l\'API OpenAI', async () => {
      const generateWelcomeSpy = vi.spyOn(aiService, 'generateWelcomeMessage');

      vi.spyOn(databaseService, 'getGuildSettings').mockReturnValue({
        welcomeChannelId: mockChannel.id
      });

      const fakeMember = {
        id: 'newbie-999',
        displayName: 'NewPlayer',
        guild: mockGuild,
        user: {
          id: 'newbie-999',
          username: 'NewPlayer',
          tag: 'NewPlayer#1234',
          bot: false
        }
      };

      await guildMemberAddEvent.execute(fakeMember);

      // Vérifications
      expect(generateWelcomeSpy).not.toHaveBeenCalled();
      expect(mockChannel.send).toHaveBeenCalledTimes(1);

      const sentPayload = mockChannel.send.mock.calls[0][0];
      expect(sentPayload.content).toContain('<@newbie-999>');
    });
  });

  describe('2. Gestion du ping vide sans question (messageCreate)', () => {
    it('idleResponses doit contenir des réponses vives et naturelles', () => {
      expect(idleResponses).toBeDefined();
      expect(idleResponses.length).toBeGreaterThanOrEqual(4);
      expect(idleResponses).toContain("Tu m'as appelé ?");
      expect(idleResponses).toContain("Présent !");
    });

    it('doit répondre avec une idleResponse sans appel IA si le message est juste "reza"', async () => {
      const askConciergeSpy = vi.spyOn(aiService, 'askConcierge');
      const author = new MockUser({ id: 'u-ping', username: 'Pinger' });

      const msg = new MockMessage({
        id: 'msg-empty-name',
        content: 'reza',
        author,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      await messageCreateEvent.execute(msg);

      expect(askConciergeSpy).not.toHaveBeenCalled();
      expect(mockChannel.sendTyping).not.toHaveBeenCalled();
      expect(msg.reply).toHaveBeenCalledTimes(1);

      const replyContent = msg.reply.mock.calls[0][0].content;
      expect(idleResponses).toContain(replyContent);
    });

    it('doit répondre sans appel IA si le message est une mention vide "@RezaBot"', async () => {
      const askConciergeSpy = vi.spyOn(aiService, 'askConcierge');
      const author = new MockUser({ id: 'u-ping', username: 'Pinger' });

      const msg = new MockMessage({
        id: 'msg-empty-mention',
        content: `<@${mockClient.user.id}>`,
        author,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient,
        mentionedBot: true
      });

      await messageCreateEvent.execute(msg);

      expect(askConciergeSpy).not.toHaveBeenCalled();
      expect(msg.reply).toHaveBeenCalledTimes(1);

      const replyContent = msg.reply.mock.calls[0][0].content;
      expect(idleResponses).toContain(replyContent);
    });

    it('doit répondre sans appel IA si le message est une salutation "hey @RezaBot"', async () => {
      const askConciergeSpy = vi.spyOn(aiService, 'askConcierge');
      const author = new MockUser({ id: 'u-ping', username: 'Pinger' });

      const msg = new MockMessage({
        id: 'msg-greeting-mention',
        content: `hey <@${mockClient.user.id}>`,
        author,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient,
        mentionedBot: true
      });

      await messageCreateEvent.execute(msg);

      expect(askConciergeSpy).not.toHaveBeenCalled();
      expect(msg.reply).toHaveBeenCalledTimes(1);

      const replyContent = msg.reply.mock.calls[0][0].content;
      expect(idleResponses).toContain(replyContent);
    });

    it('doit répondre sans appel IA si le message est "salut reza"', async () => {
      const askConciergeSpy = vi.spyOn(aiService, 'askConcierge');
      const author = new MockUser({ id: 'u-ping', username: 'Pinger' });

      const msg = new MockMessage({
        id: 'msg-greeting-name',
        content: 'salut reza',
        author,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      await messageCreateEvent.execute(msg);

      expect(askConciergeSpy).not.toHaveBeenCalled();
      expect(msg.reply).toHaveBeenCalledTimes(1);

      const replyContent = msg.reply.mock.calls[0][0].content;
      expect(idleResponses).toContain(replyContent);
    });

    it('DOIT appeler l\'IA si le message contient une vraie question', async () => {
      const askConciergeSpy = vi.spyOn(aiService, 'askConcierge').mockResolvedValue('Il est 15h00.');
      const author = new MockUser({ id: 'u-ping', username: 'Pinger' });

      const msg = new MockMessage({
        id: 'msg-real-question',
        content: 'reza quelle heure est-il ?',
        author,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      await messageCreateEvent.execute(msg);

      expect(askConciergeSpy).toHaveBeenCalledTimes(1);
      expect(msg.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Il est 15h00.'
      }));
      askConciergeSpy.mockRestore();
    });
  });

  describe('3. Messages d\'erreur statiques (Zero Waste Excuses)', () => {
    it('askConcierge doit retourner un message statique immédiat en cas de rate limit API (429) sur l\'agent', async () => {
      vi.spyOn(AgentExecutor.prototype, 'invoke').mockRejectedValue({
        status: 429,
        code: 'rate_limit_exceeded',
        message: 'Rate limit exceeded'
      });

      const reply = await aiService.askConcierge(
        'Comment va le projet ?',
        'Azou',
        [],
        { guildId: 'guild-zero-waste', serverVibe: 'friendly' }
      );

      expect(reply).toContain('saturé');
      expect(reply).toContain('Rate Limit API');
    });

    it('askConcierge doit retourner le message statique si le fallback échoue avec un rate limit 429', async () => {
      vi.spyOn(AgentExecutor.prototype, 'invoke').mockRejectedValue(new Error('Agent execution failed'));
      vi.spyOn(aiService, '_executeWithRetry').mockRejectedValue({
        status: 429,
        code: 'rate_limit_exceeded',
        message: 'Rate limit exceeded'
      });

      const reply = await aiService.askConcierge(
        'Comment va le projet ?',
        'Azou',
        [],
        { guildId: 'guild-zero-waste', serverVibe: 'friendly' }
      );

      expect(reply).toContain('saturé');
      expect(reply).toContain('Rate Limit API');
    });

    it('askConcierge doit retourner un message statique en cas d\'erreur technique générale sans générer d\'excuses IA', async () => {
      vi.spyOn(AgentExecutor.prototype, 'invoke').mockRejectedValue(new Error('Agent execution failed'));
      vi.spyOn(aiService, '_executeWithRetry').mockRejectedValue(new Error('Internal server error'));

      const reply = await aiService.askConcierge(
        'Comment va le projet ?',
        'Azou',
        [],
        { guildId: 'guild-zero-waste', serverVibe: 'friendly' }
      );

      expect(reply).toBe("Désolé, je rencontre actuellement une difficulté technique avec mon service d'intelligence artificielle. Réessaie dans un instant !");
    });
  });
});

