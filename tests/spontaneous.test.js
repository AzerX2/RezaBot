import { describe, it, expect, vi, beforeEach } from 'vitest';
import messageCreateEvent from '../src/events/messageCreate.js';
import { aiService } from '../src/services/aiService.js';
import { databaseService } from '../src/services/databaseService.js';
import { config } from '../src/config.js';
import { MockMessage, MockChannel, MockGuild, MockUser, MockClient } from './mocks/discord.mock.js';

describe('Suite de tests : Intervention Spontanée & Filtres Probabilistes', () => {
  let mockClient;
  let mockGuild;
  let mockChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = new MockClient();
    mockGuild = new MockGuild({ id: 'guild-spont', name: 'Serveur Chill' });
    mockChannel = new MockChannel({ id: 'chan-spont', name: 'general-chat' });
    mockGuild.addChannel(mockChannel);
  });

  describe('1. aiService.spontaneousReply', () => {
    it('doit utiliser le prompt système strict et le modèle ultra-économique', async () => {
      const mockCompletion = {
        choices: [
          {
            message: {
              content: 'Grave abusé, même moi j\'aurais pas fait ça haha'
            }
          }
        ]
      };

      const createSpy = vi.spyOn(aiService.client.chat.completions, 'create')
        .mockResolvedValue(mockCompletion);

      const fakeDiscussion = [
        { role: 'user', content: 'Le boss m\'a encore saoulé', name: 'Lucas' },
        { role: 'user', content: 'Laisse tomber c\'est un classique', name: 'Max' }
      ];

      const reply = await aiService.spontaneousReply(fakeDiscussion);

      expect(createSpy).toHaveBeenCalledTimes(1);
      const callArgs = createSpy.mock.calls[0][0];

      expect(callArgs.model).toBe(config.ai.fastModel || config.ai.tierEconomy || 'gpt-4o-mini');
      expect(callArgs.messages[0].content).toContain('Tu interviens de manière spontanée dans cette discussion');
      expect(callArgs.messages[0].content).toContain('Règle absolue : adopte EXACTEMENT le même ton');
      expect(callArgs.messages[0].content).toContain('Ne sois pas poli, ne dis pas bonjour');
      expect(reply).toBe('Grave abusé, même moi j\'aurais pas fait ça haha');
    });

    it('doit retourner null si le contexte est vide', async () => {
      const reply = await aiService.spontaneousReply([]);
      expect(reply).toBeNull();
    });
  });

  describe('2. Déclencheur Spontané dans messageCreate.js (0 token avant filtre)', () => {
    it('ne doit PAS déclencher d\'intervention si le message est une commande', async () => {
      const spontaneousSpy = vi.spyOn(aiService, 'spontaneousReply').mockResolvedValue('Un mot');
      const user = new MockUser({ id: 'u1', username: 'Player1' });

      const msg = new MockMessage({
        id: 'cmd-1',
        content: '!help',
        author: user,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      await messageCreateEvent.execute(msg);
      expect(spontaneousSpy).not.toHaveBeenCalled();
    });

    it('ne doit PAS déclencher si le salon n\'est pas actif (< 3 personnes dans les 5 min)', async () => {
      const spontaneousSpy = vi.spyOn(aiService, 'spontaneousReply').mockResolvedValue('Un mot');
      const user1 = new MockUser({ id: 'u1', username: 'Player1' });

      // Seulement 2 messages dans le salon
      const m1 = { id: 'm1', createdTimestamp: Date.now() - 60000, author: { id: 'u1' }, content: 'Coucou' };
      const m2 = { id: 'm2', createdTimestamp: Date.now() - 30000, author: { id: 'u1' }, content: 'Quelqu\'un là ?' };

      mockChannel.messages.fetch = vi.fn().mockResolvedValue(new Map([['m1', m1], ['m2', m2]]));

      const msg = new MockMessage({
        id: 'm3',
        content: 'Je me sens seul',
        author: user1,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      // Même avec Math.random à 0.01
      vi.spyOn(Math, 'random').mockReturnValue(0.01);

      await messageCreateEvent.execute(msg);
      expect(spontaneousSpy).not.toHaveBeenCalled();
    });

    it('doit déclencher à 2% de chances sur un salon actif sans mot-clé émotionnel', async () => {
      const spontaneousSpy = vi.spyOn(aiService, 'spontaneousReply').mockResolvedValue('Je valide fort !');
      const user3 = new MockUser({ id: 'u3', username: 'Player3' });

      // 3 messages de 3 auteurs différents dans les 5 dernières minutes
      const m1 = { id: 'm1', createdTimestamp: Date.now() - 100000, author: { id: 'u1', username: 'P1' }, content: 'Je test le build' };
      const m2 = { id: 'm2', createdTimestamp: Date.now() - 50000, author: { id: 'u2', username: 'P2' }, content: 'Prends plutôt l\'armure' };
      const m3 = { id: 'm3', createdTimestamp: Date.now() - 10000, author: { id: 'u3', username: 'P3' }, content: 'Bien vu les gars' };

      mockChannel.messages.fetch = vi.fn().mockResolvedValue(new Map([['m1', m1], ['m2', m2], ['m3', m3]]));

      const msg = new MockMessage({
        id: 'm3',
        content: 'Bien vu les gars',
        author: user3,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      // Tirage inférieur à 0.02 (ex: 0.015)
      vi.spyOn(Math, 'random').mockReturnValue(0.015);

      await messageCreateEvent.execute(msg);

      expect(spontaneousSpy).toHaveBeenCalledTimes(1);
      expect(mockChannel.sendTyping).toHaveBeenCalled();
      expect(mockChannel.send).toHaveBeenCalledWith('Je valide fort !');
    });

    it('ne doit PAS déclencher si le tirage dépasse 0.02 sur un message standard', async () => {
      const spontaneousSpy = vi.spyOn(aiService, 'spontaneousReply').mockResolvedValue('Je valide');
      const user3 = new MockUser({ id: 'u3', username: 'Player3' });

      const m1 = { id: 'm1', createdTimestamp: Date.now() - 100000, author: { id: 'u1' }, content: 'A' };
      const m2 = { id: 'm2', createdTimestamp: Date.now() - 50000, author: { id: 'u2' }, content: 'B' };
      const m3 = { id: 'm3', createdTimestamp: Date.now() - 10000, author: { id: 'u3' }, content: 'C' };

      mockChannel.messages.fetch = vi.fn().mockResolvedValue(new Map([['m1', m1], ['m2', m2], ['m3', m3]]));

      const msg = new MockMessage({
        id: 'm3',
        content: 'Message normal',
        author: user3,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      // Tirage à 0.03 (> 0.02)
      vi.spyOn(Math, 'random').mockReturnValue(0.03);

      await messageCreateEvent.execute(msg);
      expect(spontaneousSpy).not.toHaveBeenCalled();
    });

    it('doit déclencher avec un seuil élevé de 10% si un mot-clé émotionnel est présent (ex: "j\'en peux plus", "qui joue ?")', async () => {
      const spontaneousSpy = vi.spyOn(aiService, 'spontaneousReply').mockResolvedValue('Moi je suis chaud pour une game !');
      const user3 = new MockUser({ id: 'u3', username: 'GamerGuy' });

      const m1 = { id: 'm1', createdTimestamp: Date.now() - 100000, author: { id: 'u1' }, content: 'Fini les devoirs' };
      const m2 = { id: 'm2', createdTimestamp: Date.now() - 50000, author: { id: 'u2' }, content: 'Pareil enfin libre' };
      const m3 = { id: 'm3', createdTimestamp: Date.now() - 10000, author: { id: 'u3' }, content: 'qui joue ?' };

      mockChannel.messages.fetch = vi.fn().mockResolvedValue(new Map([['m1', m1], ['m2', m2], ['m3', m3]]));

      const msg = new MockMessage({
        id: 'm3',
        content: 'qui joue ?',
        author: user3,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      // Tirage à 0.08 (échec pour 0.02, mais succès pour 0.10)
      vi.spyOn(Math, 'random').mockReturnValue(0.08);

      await messageCreateEvent.execute(msg);

      expect(spontaneousSpy).toHaveBeenCalledTimes(1);
      expect(mockChannel.send).toHaveBeenCalledWith('Moi je suis chaud pour une game !');
    });

    it('doit décompter les tokens consommés après une intervention spontanée', async () => {
      vi.spyOn(aiService, 'spontaneousReply').mockResolvedValue('C\'est carré !');
      const trackSpy = vi.spyOn(databaseService, 'trackTokenUsage');

      const user3 = new MockUser({ id: 'u3', username: 'P3' });
      const m1 = { id: 'm1', createdTimestamp: Date.now() - 100000, author: { id: 'u1' }, content: 'A' };
      const m2 = { id: 'm2', createdTimestamp: Date.now() - 50000, author: { id: 'u2' }, content: 'B' };
      const m3 = { id: 'm3', createdTimestamp: Date.now() - 10000, author: { id: 'u3' }, content: 'incroyable' };

      mockChannel.messages.fetch = vi.fn().mockResolvedValue(new Map([['m1', m1], ['m2', m2], ['m3', m3]]));

      const msg = new MockMessage({
        id: 'm3',
        content: 'c\'est incroyable !',
        author: user3,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      vi.spyOn(Math, 'random').mockReturnValue(0.05);

      await messageCreateEvent.execute(msg);

      expect(trackSpy).toHaveBeenCalledWith(mockGuild.id, expect.any(Number));
    });
  });
});
