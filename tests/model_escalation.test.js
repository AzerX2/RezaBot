import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '../src/config.js';
import { aiService } from '../src/services/aiService.js';
import { socialMemoryService } from '../src/services/socialMemory.js';
import messageCreateEvent from '../src/events/messageCreate.js';
import { MockMessage, MockChannel, MockGuild, MockUser, MockClient } from './mocks/discord.mock.js';

describe('Suite de tests : Escalade de modèles à 3 niveaux & Compression Contextuelle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Configuration des modèles à 3 niveaux (Micro, Fast, Chat)', () => {
    it('doit exposer les 3 modèles avec leurs valeurs par défaut appropriées', () => {
      expect(config.ai.chatModel).toBeDefined();
      expect(config.ai.chatModel).toMatch(/gpt-5\.4-mini|gpt-4o/);

      expect(config.ai.fastModel).toBeDefined();
      expect(config.ai.fastModel).toMatch(/gpt-5\.4-nano|gpt-4o-mini/);

      expect(config.ai.microModel).toBeDefined();
      expect(config.ai.microModel).toBe('gpt-4.1-nano');
    });
  });

  describe('2. Méthode compressContext(messages) dans aiService', () => {
    it('doit renvoyer une chaîne vide si aucun message n\'est fourni', async () => {
      const emptyResult = await aiService.compressContext([]);
      expect(emptyResult).toBe('');

      const nullResult = await aiService.compressContext(null);
      expect(nullResult).toBe('');
    });

    it('doit appeler microModel avec le prompt système strict de compression', async () => {
      const mockCompletion = {
        choices: [
          {
            message: {
              content: 'Alice a validé le ticket #42 pour le frontend. Bob déploie.'
            }
          }
        ]
      };

      const createSpy = vi.spyOn(aiService.client.chat.completions, 'create')
        .mockResolvedValue(mockCompletion);

      const messagesToCompress = [
        { role: 'user', name: 'Alice', content: 'Bonjour tout le monde ! J\'ai validé le ticket #42 pour le frontend.' },
        { role: 'assistant', name: 'RezaBot', content: 'Parfait, merci Alice.' },
        { role: 'user', name: 'Bob', content: 'Super, je lance le déploiement sur staging tout de suite.' }
      ];

      const result = await aiService.compressContext(messagesToCompress);

      expect(createSpy).toHaveBeenCalledTimes(1);
      const callArgs = createSpy.mock.calls[0][0];

      // Vérification du modèle Micro
      expect(callArgs.model).toBe(config.ai.microModel || 'gpt-4.1-nano');

      // Vérification du prompt système strict
      const systemMsg = callArgs.messages.find(m => m.role === 'system');
      expect(systemMsg).toBeDefined();
      expect(systemMsg.content).toBe(
        "Tu es un compresseur de texte. Résume cet historique de discussion en gardant uniquement les faits, les entités (noms, projets) et l'intention, en un minimum de mots. Ignore les formules de politesse."
      );

      // Vérification du contenu transmis
      const userMsg = callArgs.messages.find(m => m.role === 'user');
      expect(userMsg.content).toContain('Alice: Bonjour tout le monde');
      expect(userMsg.content).toContain('Bob: Super, je lance le déploiement');

      expect(result).toBe('Alice a validé le ticket #42 pour le frontend. Bob déploie.');
    });
  });

  describe('3. Attribution stricte des modèles par fonction', () => {
    it('moderateMessage doit utiliser fastModel', async () => {
      const mockModResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({ isToxic: false, severity: 'none', reason: '', friendlyTip: '' })
            }
          }
        ]
      };

      const createSpy = vi.spyOn(aiService.client.chat.completions, 'create')
        .mockResolvedValue(mockModResponse);

      await aiService.moderateMessage('Bonjour les amis, comment ça va ?', { username: 'Jean' });

      expect(createSpy).toHaveBeenCalledTimes(1);
      const callArgs = createSpy.mock.calls[0][0];
      expect(callArgs.model).toBe(config.ai.fastModel || 'gpt-5.4-nano');
    });

    it('spontaneousReply doit utiliser fastModel', async () => {
      const mockSpontResponse = {
        choices: [
          {
            message: {
              content: 'Grave d\'accord avec toi !'
            }
          }
        ]
      };

      const createSpy = vi.spyOn(aiService.client.chat.completions, 'create')
        .mockResolvedValue(mockSpontResponse);

      const reply = await aiService.spontaneousReply([
        { role: 'user', name: 'Lucas', content: 'Le nouveau jeu est incroyable !' }
      ]);

      expect(createSpy).toHaveBeenCalledTimes(1);
      const callArgs = createSpy.mock.calls[0][0];
      expect(callArgs.model).toBe(config.ai.fastModel || 'gpt-5.4-nano');
      expect(reply).toBe('Grave d\'accord avec toi !');
    });

    it('socialMemory (extractUserFacts) doit utiliser microModel', async () => {
      const mockExtraction = [
        { userId: 'u123', username: 'Lucas', fact: 'Apprend Rust' }
      ];

      const createSpy = vi.spyOn(socialMemoryService.openai.chat.completions, 'create')
        .mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify(mockExtraction)
              }
            }
          ]
        });

      await socialMemoryService.extractUserFacts('Lucas: Je me suis mis à coder en Rust hier soir.');

      expect(createSpy).toHaveBeenCalledTimes(1);
      const callArgs = createSpy.mock.calls[0][0];
      expect(callArgs.model).toBe(config.ai.microModel || 'gpt-4.1-nano');
    });
  });

  describe('4. Intégration de la compression de contexte dans messageCreate', () => {
    it('doit compresser l\'historique avant d\'appeler askConcierge pour diviser les tokens', async () => {
      const mockClient = new MockClient();
      const mockGuild = new MockGuild({ id: 'g-compress', name: 'Serveur Compression' });
      const mockChannel = new MockChannel({ id: 'c-compress', name: 'general' });
      mockGuild.addChannel(mockChannel);

      const triggeringUser = new MockUser({ id: 'u-sam', username: 'Sam' });
      const triggeringMessage = new MockMessage({
        id: 'msg-target',
        content: 'Reza résume notre plan ?',
        author: triggeringUser,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      // Simulation de l'historique récent du salon
      const m1 = { id: 'm1', createdTimestamp: 10, author: { id: 'u1', username: 'Alex' }, content: 'On lance la v2 demain ?' };
      const m2 = { id: 'm2', createdTimestamp: 20, author: { id: mockClient.user.id }, content: 'Oui tout est prêt.' };
      const m3 = { id: 'msg-target', createdTimestamp: 30, author: { id: 'u-sam', username: 'Sam' }, content: 'Reza résume notre plan ?' };

      const channelMap = new Map([
        ['m1', m1],
        ['m2', m2],
        ['msg-target', m3]
      ]);

      mockChannel.messages.fetch = vi.fn().mockResolvedValue(channelMap);

      const compressSpy = vi.spyOn(aiService, 'compressContext')
        .mockResolvedValue('Plan v2 validé pour demain.');
      const askConciergeSpy = vi.spyOn(aiService, 'askConcierge')
        .mockResolvedValue('Voici le résumé du plan...');

      await messageCreateEvent.execute(triggeringMessage);

      // Vérifier que compressContext a été appelé avec les messages récents
      expect(compressSpy).toHaveBeenCalledTimes(1);
      const passedToCompress = compressSpy.mock.calls[0][0];
      expect(passedToCompress).toHaveLength(2); // m1 et m2 (hors triggeringMessage m3)

      // Vérifier que askConcierge a reçu le contexte ultra-dense
      expect(askConciergeSpy).toHaveBeenCalledTimes(1);
      const passedHistoryToConcierge = askConciergeSpy.mock.calls[0][5];
      expect(passedHistoryToConcierge).toHaveLength(1);
      expect(passedHistoryToConcierge[0].content).toContain('Plan v2 validé pour demain.');
    });
  });
});
