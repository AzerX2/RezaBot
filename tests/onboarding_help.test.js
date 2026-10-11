import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits, ButtonStyle } from 'discord.js';
import guildCreateEvent, { findBestWelcomeChannel, buildWelcomeEmbed } from '../src/events/guildCreate.js';
import helpCommand from '../src/commands/utility/help.js';
import tldrCommand from '../src/commands/utility/tldr.js';
import { aiService } from '../src/services/aiService.js';
import { MockGuild, MockChannel, MockClient } from './mocks/discord.mock.js';

describe('Suite de tests : Onboarding & Menu d\'Aide Statique (Zero Waste)', () => {
  let mockClient;
  let mockGuild;
  let systemChannel;
  let generalChannel;
  let restrictedChannel;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockClient = new MockClient();
    mockGuild = new MockGuild({ id: 'guild-onboarding-99', name: 'Nouveau Serveur' });

    systemChannel = new MockChannel({ id: 'chan-sys', name: 'salon-systeme' });
    generalChannel = new MockChannel({ id: 'chan-gen', name: 'general' });
    restrictedChannel = new MockChannel({ id: 'chan-rest', name: 'staff-secret' });
  });

  describe('1. Événement d\'arrivée et recherche du meilleur salon (guildCreate)', () => {
    it('doit choisir en priorité le systemChannel si accessible', () => {
      mockGuild.systemChannel = systemChannel;
      mockGuild.addChannel(systemChannel);
      mockGuild.addChannel(generalChannel);

      const best = findBestWelcomeChannel(mockGuild);
      expect(best).toBe(systemChannel);
      expect(best.id).toBe('chan-sys');
    });

    it('doit basculer sur le premier salon textuel avec ViewChannel et SendMessages si systemChannel est absent ou restreint', () => {
      // Pas de systemChannel
      mockGuild.systemChannel = null;

      // Salon restreint où le bot n'a pas les permissions
      restrictedChannel.permissionsFor = () => ({
        has: (perm) => perm !== PermissionFlagsBits.SendMessages
      });

      mockGuild.addChannel(restrictedChannel);
      mockGuild.addChannel(generalChannel);

      const best = findBestWelcomeChannel(mockGuild);
      expect(best).toBe(generalChannel);
      expect(best.id).toBe('chan-gen');
    });

    it('buildWelcomeEmbed doit générer un embed complet, chaleureux et conforme', () => {
      const embed = buildWelcomeEmbed();

      expect(embed.data.title).toBe('👋 Salut ! Je suis RezaBot, votre nouvelle IA résidente.');
      expect(embed.data.description).toContain('Discussions naturelles & Mémoire');
      expect(embed.data.description).toContain('Connaissance RAG locale');
      expect(embed.data.description).toContain('Résumés intelligents');

      const adminField = embed.data.fields.find(f => f.name.includes('Pour les Admins'));
      expect(adminField).toBeDefined();
      expect(adminField.value).toContain('/rezasetup');

      const helpField = embed.data.fields.find(f => f.name.includes('Pour commencer'));
      expect(helpField).toBeDefined();
      expect(helpField.value).toContain('/help');
    });

    it('guildCreate.execute doit envoyer le message d\'accueil sans aucun appel IA', async () => {
      const askConciergeSpy = vi.spyOn(aiService, 'askConcierge');
      const createCompletionSpy = vi.spyOn(aiService.client.chat.completions, 'create');

      mockGuild.systemChannel = generalChannel;
      mockGuild.addChannel(generalChannel);

      await guildCreateEvent.execute(mockGuild);

      expect(generalChannel.send).toHaveBeenCalledTimes(1);
      const sentPayload = generalChannel.send.mock.calls[0][0];

      expect(sentPayload.embeds).toBeDefined();
      expect(sentPayload.embeds[0].data.title).toContain('RezaBot');

      // 0 appel IA (Zero Waste garanti)
      expect(askConciergeSpy).not.toHaveBeenCalled();
      expect(createCompletionSpy).not.toHaveBeenCalled();
    });
  });

  describe('2. Commande Slash d\'aide (/help)', () => {
    it('la commande doit avoir le nom "help" et une description claire', () => {
      expect(helpCommand.data.name).toBe('help');
      expect(helpCommand.data.description).toBeDefined();
    });

    it('doit répondre avec un EmbedBuilder structuré en 4 champs exigés et des boutons d\'action', async () => {
      const askConciergeSpy = vi.spyOn(aiService, 'askConcierge');
      const createCompletionSpy = vi.spyOn(aiService.client.chat.completions, 'create');

      const interaction = {
        client: mockClient,
        user: { id: 'user-77', username: 'Lucas' },
        reply: vi.fn().mockResolvedValue(true)
      };

      await helpCommand.execute(interaction);

      // 0 appel IA
      expect(askConciergeSpy).not.toHaveBeenCalled();
      expect(createCompletionSpy).not.toHaveBeenCalled();

      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const replyData = interaction.reply.mock.calls[0][0];

      // Vérification de l'Embed
      expect(replyData.embeds).toBeDefined();
      const embed = replyData.embeds[0];
      expect(embed.data.title).toContain('Guide d\'utilisation de RezaBot');

      const fields = embed.data.fields;
      expect(fields.length).toBeGreaterThanOrEqual(4);

      // Champ 1 : Comment me parler
      const speakField = fields.find(f => f.name.includes('Comment me parler'));
      expect(speakField).toBeDefined();
      expect(speakField.value).toContain('@RezaBot');
      expect(speakField.value).toContain('reza');

      // Champ 2 : Commandes Publiques
      const publicField = fields.find(f => f.name.includes('Commandes Publiques'));
      expect(publicField).toBeDefined();
      expect(publicField.value).toContain('/tldr');

      // Champ 3 : Commandes Admin
      const adminField = fields.find(f => f.name.includes('Commandes Admin'));
      expect(adminField).toBeDefined();
      expect(adminField.value).toContain('/rezasetup');
      expect(adminField.value).toContain('/sync-memory');

      // Champ 4 : Capacités passives
      const passiveField = fields.find(f => f.name.includes('Capacités passives'));
      expect(passiveField).toBeDefined();
      expect(passiveField.value).toMatch(/retient|retiens/i);

      // Vérification des boutons
      expect(replyData.components).toBeDefined();
      const row = replyData.components[0];
      expect(row.components.length).toBeGreaterThanOrEqual(2);

      const inviteBtn = row.components.find(b => b.data.label.includes('Inviter'));
      expect(inviteBtn).toBeDefined();
      expect(inviteBtn.data.style).toBe(ButtonStyle.Link);
      expect(inviteBtn.data.url).toContain('discord.com/api/oauth2/authorize');

      const supportBtn = row.components.find(b => b.data.label.includes('Soutien') || b.data.label.includes('GitHub'));
      expect(supportBtn).toBeDefined();
      expect(supportBtn.data.style).toBe(ButtonStyle.Link);
      expect(supportBtn.data.url).toBeDefined();
    });
  });

  describe('3. Commande Slash de résumé (/tldr)', () => {
    it('la commande doit avoir le nom "tldr" et l\'option "limit"', () => {
      expect(tldrCommand.data.name).toBe('tldr');
      expect(tldrCommand.data.description).toBeDefined();
      expect(tldrCommand.data.options).toBeDefined();
    });

    it('doit récupérer les messages, appeler summarizeChat et renvoyer un embed', async () => {
      const summarizeSpy = vi.spyOn(aiService, 'summarizeChat')
        .mockResolvedValue('📌 1. Point 1\n2. Point 2\n3. Point 3');

      const messagesMap = new Map([
        ['m1', { id: 'm1', createdTimestamp: 100, author: { username: 'Jean', bot: false }, content: 'On valide le design.' }],
        ['m2', { id: 'm2', createdTimestamp: 200, author: { username: 'Sam', bot: false }, content: 'Oui tout est bon.' }],
        ['m3', { id: 'm3', createdTimestamp: 300, author: { username: 'Alex', bot: false }, content: 'Super, je merge la PR.' }]
      ]);

      const interaction = {
        guild: mockGuild,
        channel: {
          name: 'dev-chat',
          messages: {
            fetch: vi.fn().mockResolvedValue(messagesMap)
          }
        },
        options: {
          getInteger: vi.fn().mockReturnValue(50)
        },
        deferReply: vi.fn().mockResolvedValue(true),
        editReply: vi.fn().mockResolvedValue(true)
      };

      await tldrCommand.execute(interaction);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(summarizeSpy).toHaveBeenCalledTimes(1);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: expect.stringContaining('Résumé TL;DR')
              })
            })
          ])
        })
      );
    });
  });
});

