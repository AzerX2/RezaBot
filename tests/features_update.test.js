import { describe, it, expect, vi, beforeEach } from 'vitest';
import messageCreateEvent from '../src/events/messageCreate.js';
import rezasetupCommand from '../src/commands/admin/rezasetup.js';
import premiumCommand from '../src/commands/dev/premium.js';
import { databaseService, SAAS_LIMITS } from '../src/services/databaseService.js';
import { aiService } from '../src/services/aiService.js';
import { createDeleteChannelTool } from '../src/tools/index.js';
import { config } from '../src/config.js';
import { MockMessage, MockUser, MockChannel, MockGuild, MockClient } from './mocks/discord.mock.js';

describe('Suite de tests : SaaS Freemium, Quotas Stricts & Rôles Dynamiques', () => {
  let client;
  let guild;
  let channel;
  let author;

  beforeEach(() => {
    vi.restoreAllMocks();

    client = new MockClient();
    guild = new MockGuild({ id: 'guild-test-saas', name: 'Serveur SaaS' });
    channel = new MockChannel({ id: 'chan-main', name: 'general' });
    guild.addChannel(channel);

    author = new MockUser({ id: 'user-lucas', username: 'Lucas' });
  });

  describe('1. Écoute active du prénom (reza / rezabot)', () => {
    it('doit déclencher le Concierge si le message contient le mot exact "reza"', async () => {
      vi.spyOn(databaseService, 'getGuildSettings').mockReturnValue({
        guildId: guild.id,
        botMode: 'active',
        serverVibe: 'friendly',
        bot_role: 'member',
        is_premium: false,
        daily_token_quota: 20000,
        tokens_used_today: 100,
        last_reset_date: new Date().toISOString().slice(0, 10)
      });

      vi.spyOn(databaseService, 'checkTokenQuota').mockReturnValue({ allowed: true, isPremium: false });
      vi.spyOn(databaseService, 'trackTokenUsage').mockImplementation(() => {});
      vi.spyOn(aiService, 'askConcierge').mockResolvedValue('Bonjour Lucas !');

      const message = new MockMessage({
        id: 'msg-reza-trigger',
        content: 'Salut reza peux-tu me renseigner sur le projet ?',
        author,
        channel,
        guild,
        client
      });

      await messageCreateEvent.execute(message);

      expect(channel.sendTyping).toHaveBeenCalled();
      expect(aiService.askConcierge).toHaveBeenCalledTimes(1);
      expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: 'Bonjour Lucas !'
      }));
    });

    it('doit déclencher le Concierge avec "rezabot" insensible à la casse', async () => {
      vi.spyOn(databaseService, 'getGuildSettings').mockReturnValue({
        guildId: guild.id,
        botMode: 'active',
        serverVibe: 'friendly',
        bot_role: 'member',
        is_premium: false,
        daily_token_quota: 20000,
        tokens_used_today: 0,
        last_reset_date: null
      });

      vi.spyOn(databaseService, 'checkTokenQuota').mockReturnValue({ allowed: true, isPremium: false });
      vi.spyOn(databaseService, 'trackTokenUsage').mockImplementation(() => {});
      vi.spyOn(aiService, 'askConcierge').mockResolvedValue('Bien sûr !');

      const message = new MockMessage({
        id: 'msg-rezabot-trigger',
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

  describe('2. Quotas SaaS Stricts (20k Gratuit vs 500k Premium)', () => {
    it('doit bloquer l\'IA avec le message Freemium exact lorsque la limite gratuite (20k) est atteinte', async () => {
      vi.spyOn(databaseService, 'getGuildSettings').mockReturnValue({
        guildId: guild.id,
        botMode: 'active',
        serverVibe: 'friendly',
        bot_role: 'member',
        is_premium: false,
        daily_token_quota: 20000,
        tokens_used_today: 20000,
        last_reset_date: new Date().toISOString().slice(0, 10)
      });

      vi.spyOn(databaseService, 'checkTokenQuota').mockReturnValue({
        allowed: false,
        isPremium: false,
        currentUsed: 20000,
        remaining: 0,
        maxDaily: 20000
      });

      const askConciergeSpy = vi.spyOn(aiService, 'askConcierge');

      const message = new MockMessage({
        id: 'msg-quota-blocked',
        content: 'Reza, raconte-moi une histoire',
        author,
        channel,
        guild,
        client
      });

      await messageCreateEvent.execute(message);

      // Aucune requête IA ne doit être lancée
      expect(askConciergeSpy).not.toHaveBeenCalled();
      // Message exact exigé
      expect(message.reply).toHaveBeenCalledWith(
        "J'ai atteint ma limite d'énergie gratuite pour aujourd'hui sur ce serveur (20k tokens). À demain, ou demandez à l'admin de passer Premium ! ⚡"
      );
    });

    it('les serveurs standards ont 20 000 tokens et les premium ont 500 000 tokens', () => {
      const gFree = 'guild-free-check';
      databaseService.setGuildSettings(gFree, { is_premium: false });
      const freeSettings = databaseService.getGuildSettings(gFree);
      expect(freeSettings.is_premium).toBe(false);
      expect(freeSettings.daily_token_quota).toBe(SAAS_LIMITS.FREE);

      const gPrem = 'guild-prem-check';
      databaseService.setGuildPremium(gPrem, true);
      const premSettings = databaseService.getGuildSettings(gPrem);
      expect(premSettings.is_premium).toBe(true);
      expect(premSettings.daily_token_quota).toBe(SAAS_LIMITS.PREMIUM);
    });
  });

  describe('3. Commande /rezasetup (Réservée aux administrateurs, rôle unique)', () => {
    it('doit permettre de configurer le rôle sans proposer de configuration de quota', async () => {
      const interaction = {
        guild,
        user: { tag: 'Admin#0001' },
        options: {
          getString: vi.fn((name) => (name === 'role' ? 'moderator' : null))
        },
        reply: vi.fn().mockResolvedValue(true)
      };

      await rezasetupCommand.execute(interaction);

      const settings = databaseService.getGuildSettings(guild.id);
      expect(settings.bot_role).toBe('moderator');
      // Le quota reste fixé par le SaaS
      expect(settings.daily_token_quota).toBe(SAAS_LIMITS.FREE);

      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const callArgs = interaction.reply.mock.calls[0][0];
      expect(callArgs.embeds[0].data.title).toContain('Configuration RezaBot');
    });
  });

  describe('4. Commande secrète développeur /premium', () => {
    it('doit refuser l\'accès à un utilisateur qui n\'est pas le créateur du bot', async () => {
      config.discord.ownerId = 'dev-owner-id-123';

      const interaction = {
        user: { id: 'impostor-id-999', tag: 'Hacker#0000' },
        client: { application: { owner: { id: 'dev-owner-id-123' } } },
        options: {
          getString: vi.fn(() => 'guild-victim'),
          getBoolean: vi.fn(() => true)
        },
        reply: vi.fn().mockResolvedValue(true)
      };

      await premiumCommand.execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Accès refusé'),
        ephemeral: true
      }));
    });

    it('doit passer le serveur en Premium lorsque le créateur du bot l\'exécute', async () => {
      config.discord.ownerId = 'dev-owner-id-123';

      const targetId = 'guild-happy-customer';
      const interaction = {
        user: { id: 'dev-owner-id-123', tag: 'BossDev#0001' },
        client: {
          guilds: { cache: new Map([[targetId, { name: 'Super Communaute' }]]) },
          application: { owner: { id: 'dev-owner-id-123' } }
        },
        options: {
          getString: vi.fn(() => targetId),
          getBoolean: vi.fn(() => true)
        },
        reply: vi.fn().mockResolvedValue(true)
      };

      await premiumCommand.execute(interaction);

      const settings = databaseService.getGuildSettings(targetId);
      expect(settings.is_premium).toBe(true);
      expect(settings.daily_token_quota).toBe(SAAS_LIMITS.PREMIUM);

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        ephemeral: true
      }));
    });
  });

  describe('5. Sécurité : Confirmation obligatoire avant suppression de salon', () => {
    it('deleteChannelTool doit refuser la suppression si confirmed !== true', async () => {
      const mockChannel = { id: 'chan-to-del', name: 'vieux-salon', delete: vi.fn() };
      const mockGuildWithChan = {
        channels: {
          cache: new Map([[mockChannel.id, mockChannel]]),
          fetch: vi.fn().mockResolvedValue(mockChannel)
        },
        members: {
          me: { permissions: { has: () => true } }
        }
      };

      const tool = createDeleteChannelTool({ guild: mockGuildWithChan });

      // Appel sans confirmation
      const unconfirmedResult = await tool.invoke({ channelId: mockChannel.id, confirmed: false });
      expect(unconfirmedResult).toContain('Confirmation requise');
      expect(mockChannel.delete).not.toHaveBeenCalled();

      // Appel avec confirmation explicite
      const confirmedResult = await tool.invoke({ channelId: mockChannel.id, confirmed: true });
      expect(confirmedResult).toContain('a été supprimé définitivement');
      expect(mockChannel.delete).toHaveBeenCalled();
    });
  });
});
