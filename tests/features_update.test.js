import { describe, it, expect, vi, beforeEach } from 'vitest';
import messageCreateEvent from '../src/events/messageCreate.js';
import rezasetupCommand from '../src/commands/admin/rezasetup.js';
import { databaseService } from '../src/services/databaseService.js';
import { aiService } from '../src/services/aiService.js';
import { MockMessage, MockUser, MockChannel, MockGuild, MockClient } from './mocks/discord.mock.js';

describe('Suite de tests : Écoute du prénom, Quotas & Setup des Rôles', () => {
  let client;
  let guild;
  let channel;
  let author;

  beforeEach(() => {
    vi.restoreAllMocks();

    client = new MockClient();
    guild = new MockGuild({ id: 'guild-test-quota', name: 'Serveur Alpha' });
    channel = new MockChannel({ id: 'chan-main', name: 'general' });
    guild.addChannel(channel);

    author = new MockUser({ id: 'user-chatty', username: 'Lucas' });
  });

  describe('1. Écoute active du prénom (reza / rezabot)', () => {
    it('doit déclencher le Concierge si le message contient le mot "reza" sans mention @', async () => {
      vi.spyOn(databaseService, 'getGuildSettings').mockReturnValue({
        guildId: guild.id,
        botMode: 'active',
        serverVibe: 'friendly',
        bot_role: 'member',
        daily_token_quota: 50000,
        tokens_used_today: 100,
        last_reset_date: new Date().toISOString().slice(0, 10)
      });

      vi.spyOn(databaseService, 'checkTokenQuota').mockReturnValue({ allowed: true });
      vi.spyOn(databaseService, 'trackTokenUsage').mockImplementation(() => {});
      vi.spyOn(aiService, 'askConcierge').mockResolvedValue('Je suis là pour t\'aider !');

      const message = new MockMessage({
        id: 'msg-name-1',
        content: 'Salut reza peux-tu me renseigner ?',
        author,
        channel,
        guild,
        client
      });

      await messageCreateEvent.execute(message);

      expect(channel.sendTyping).toHaveBeenCalled();
      expect(aiService.askConcierge).toHaveBeenCalledTimes(1);
      expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Je suis là pour t\'aider !'
      }));
    });

    it('doit déclencher le Concierge avec "rezabot" insensible à la casse', async () => {
      vi.spyOn(databaseService, 'getGuildSettings').mockReturnValue({
        guildId: guild.id,
        botMode: 'active',
        serverVibe: 'friendly',
        bot_role: 'member',
        daily_token_quota: 50000,
        tokens_used_today: 0,
        last_reset_date: null
      });

      vi.spyOn(databaseService, 'checkTokenQuota').mockReturnValue({ allowed: true });
      vi.spyOn(databaseService, 'trackTokenUsage').mockImplementation(() => {});
      vi.spyOn(aiService, 'askConcierge').mockResolvedValue('Bien sûr !');

      const message = new MockMessage({
        id: 'msg-name-2',
        content: 'Dis REZABOT comment tu vas ?',
        author,
        channel,
        guild,
        client
      });

      await messageCreateEvent.execute(message);

      expect(aiService.askConcierge).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. Quotas de tokens & Blocage FinOps', () => {
    it('doit bloquer l\'appel IA et renvoyer le message courtois exact si le quota est épuisé', async () => {
      vi.spyOn(databaseService, 'getGuildSettings').mockReturnValue({
        guildId: guild.id,
        botMode: 'active',
        serverVibe: 'friendly',
        bot_role: 'member',
        daily_token_quota: 50000,
        tokens_used_today: 50000,
        last_reset_date: new Date().toISOString().slice(0, 10)
      });

      // Simulation du quota atteint
      vi.spyOn(databaseService, 'checkTokenQuota').mockReturnValue({
        allowed: false,
        currentUsed: 50000,
        remaining: 0,
        maxDaily: 50000
      });

      const askConciergeSpy = vi.spyOn(aiService, 'askConcierge');

      const message = new MockMessage({
        id: 'msg-quota-exceeded',
        content: 'Reza, raconte-moi une longue histoire',
        author,
        channel,
        guild,
        client
      });

      await messageCreateEvent.execute(message);

      // Aucune requête IA ne doit être lancée
      expect(askConciergeSpy).not.toHaveBeenCalled();
      expect(message.reply).toHaveBeenCalledWith("J'ai épuisé mon énergie pour aujourd'hui sur ce serveur, à demain ! ⚡");
    });

    it('trackTokenUsage doit incrémenter correctement la consommation en base', () => {
      const gId = 'test-guild-tracker';
      databaseService.setGuildSettings(gId, {
        daily_token_quota: 50000,
        tokens_used_today: 1000,
        last_reset_date: new Date().toISOString().slice(0, 10)
      });

      databaseService.trackTokenUsage(gId, 500);

      const updated = databaseService.getGuildSettings(gId);
      expect(updated.tokens_used_today).toBe(1500);
    });
  });

  describe('3. Commande /rezasetup', () => {
    it('doit mettre à jour le rôle et le quota et répondre avec un embed', async () => {
      const interaction = {
        guild,
        user: { tag: 'Admin#0001' },
        options: {
          getString: vi.fn((name) => (name === 'role' ? 'moderator' : null)),
          getInteger: vi.fn((name) => (name === 'quota' ? 80000 : null))
        },
        reply: vi.fn().mockResolvedValue(true)
      };

      await rezasetupCommand.execute(interaction);

      const settings = databaseService.getGuildSettings(guild.id);
      expect(settings.bot_role).toBe('moderator');
      expect(settings.daily_token_quota).toBe(80000);

      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const callArgs = interaction.reply.mock.calls[0][0];
      expect(callArgs.embeds).toBeDefined();
      expect(callArgs.embeds[0].data.title).toContain('Configuration RezaBot');
    });
  });
});
