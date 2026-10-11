import { describe, it, expect, vi, beforeEach } from 'vitest';
import { socialMemoryService } from '../src/services/socialMemory.js';
import { aiService } from '../src/services/aiService.js';
import { ragService } from '../src/services/ragService.js';
import { config } from '../src/config.js';
import messageCreateEvent from '../src/events/messageCreate.js';
import { MockMessage, MockChannel, MockGuild, MockUser, MockClient } from './mocks/discord.mock.js';

describe('Suite de tests : Mémoire Sociale Individuelle (Social Memory & User Facts)', () => {
  let mockClient;
  let mockGuild;
  let mockChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = new MockClient();
    mockGuild = new MockGuild({ id: 'guild-social-01', name: 'Serveur Passionnés' });
    mockChannel = new MockChannel({ id: 'chan-general', name: 'general' });
    mockGuild.addChannel(mockChannel);
  });

  describe('1. Extraction de faits personnels (socialMemoryService)', () => {
    it('fetchDailyMessages doit récupérer jusqu\'à 300 messages récents de la journée', async () => {
      const now = Date.now();
      const user1 = new MockUser({ id: 'u1', username: 'Alex' });
      const user2 = new MockUser({ id: 'u2', username: 'Azou' });

      const messagesMap = new Map();
      // Création de 15 messages récents
      for (let i = 0; i < 15; i++) {
        messagesMap.set(`m-${i}`, {
          id: `m-${i}`,
          content: i % 2 === 0 ? `J'adore jouer à Elden Ring niveau ${i}` : `Je bosse sur un projet React sympa`,
          author: i % 2 === 0 ? user1 : user2,
          createdTimestamp: now - (i * 3600000) // dans les dernières 24h
        });
      }

      mockChannel.messages.fetch = vi.fn().mockResolvedValue(messagesMap);

      const fetched = await socialMemoryService.fetchDailyMessages(mockGuild, 300);

      expect(fetched).toHaveLength(15);
      expect(mockChannel.messages.fetch).toHaveBeenCalled();
    });

    it('extractUserFacts doit appeler microModel avec le prompt strict et parser le JSON', async () => {
      const mockExtraction = [
        { userId: 'user-azou-42', username: 'Azou', fact: 'Joue activement à Valorant et main Sage' },
        { userId: 'user-bob-99', username: 'Bob', fact: 'Est développeur Python et habite à Lyon' }
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

      const conversationText = `
[userId: user-azou-42 | username: Azou]: Je suis sur Valorant avec Sage venez !
[userId: user-bob-99 | username: Bob]: Pas dispo, je finis un script Python pour mon taf à Lyon.
      `;

      const facts = await socialMemoryService.extractUserFacts(conversationText);

      expect(createSpy).toHaveBeenCalledTimes(1);
      const callArgs = createSpy.mock.calls[0][0];

      expect(callArgs.model).toBe(config.ai.microModel || 'gpt-4.1-nano');
      expect(callArgs.messages[0].content).toContain('Analyse ces conversations. Extrais uniquement des faits avérés');
      expect(callArgs.messages[0].content).toContain('leurs passions, les jeux auxquels ils jouent, leur métier');
      expect(callArgs.messages[0].content).toContain('Format JSON : [{ "userId": "...", "username": "...", "fact": "..." }]');

      expect(facts).toHaveLength(2);
      expect(facts[0].userId).toBe('user-azou-42');
      expect(facts[0].fact).toContain('Valorant');
      expect(facts[1].userId).toBe('user-bob-99');
      expect(facts[1].fact).toContain('Python');
    });

    it('saveUserFacts doit indexer les faits dans ChromaDB avec les métadonnées requises', async () => {
      const ingestSpy = vi.spyOn(ragService, 'ingestDocuments').mockResolvedValue({
        success: true,
        count: 2,
        guildId: 'guild-social-01'
      });

      const factsToSave = [
        { userId: 'user-azou-42', username: 'Azou', fact: 'Passionné de cybersécurité' },
        { userId: 'user-lucas-12', username: 'Lucas', fact: 'Prépare un marathon' }
      ];

      const docs = await socialMemoryService.saveUserFacts(factsToSave, 'guild-social-01');

      expect(ingestSpy).toHaveBeenCalledTimes(1);
      expect(docs).toHaveLength(2);

      expect(docs[0].pageContent).toBe('Passionné de cybersécurité');
      expect(docs[0].metadata.type).toBe('user_fact');
      expect(docs[0].metadata.userId).toBe('user-azou-42');
      expect(docs[0].metadata.guildId).toBe('guild-social-01');

      expect(docs[1].metadata.type).toBe('user_fact');
      expect(docs[1].metadata.userId).toBe('user-lucas-12');
    });
  });

  describe('2. Intégration Concierge & Injection des faits personnels', () => {
    it('getDynamicConciergePrompt doit intégrer la section de faits personnels utilisateur', () => {
      const userFacts = [
        'Adore jouer à Valorant avec le personnage Sage',
        'Travaille comme ingénieur devops'
      ];

      const prompt = aiService.getDynamicConciergePrompt('chill', 'member', userFacts);

      expect(prompt).toContain("Ce que tu sais sur l'utilisateur actuel : Adore jouer à Valorant avec le personnage Sage, Travaille comme ingénieur devops. Utilise ces infos subtilement si pertinent.");
    });

    it('le processus du Concierge doit interroger ChromaDB sur userId et injecter les faits pour @Azou', async () => {
      const userAzou = new MockUser({ id: 'azou-user-id-777', username: 'Azou' });

      // Mock des faits enregistrés pour Azou dans ChromaDB
      const azouFacts = [
        'Azou adore la pizza 4 fromages',
        'Azou développe des bots Discord en Node.js'
      ];

      mockClient.ragService.getUserFacts = vi.fn().mockResolvedValue(azouFacts);
      vi.spyOn(socialMemoryService, 'getUserFacts').mockResolvedValue(azouFacts);

      const askConciergeSpy = vi.spyOn(aiService, 'askConcierge').mockResolvedValue('Salut Azou ! Tout baigne avec tes bots ?');

      const message = new MockMessage({
        id: 'msg-azou-concierge',
        content: 'Reza tu me conseilles quoi à manger ce soir ?',
        author: userAzou,
        channel: mockChannel,
        guild: mockGuild,
        client: mockClient
      });

      await messageCreateEvent.execute(message);

      // Vérifier que askConcierge a été appelé avec les faits d'Azou dans guildContext
      expect(askConciergeSpy).toHaveBeenCalledTimes(1);
      const passedGuildContext = askConciergeSpy.mock.calls[0][3];

      expect(passedGuildContext).toBeDefined();
      expect(passedGuildContext.userId).toBe('azou-user-id-777');
      expect(passedGuildContext.userFacts).toEqual(azouFacts);
    });

    it('le prompt système généré dans askConcierge doit contenir la directive subtile', async () => {
      const azouFacts = ['Grand fan de League of Legends (main Thresh)'];

      const promptGenerated = aiService.getDynamicConciergePrompt('friendly', 'admin', azouFacts);

      expect(promptGenerated).toContain("Ce que tu sais sur l'utilisateur actuel : Grand fan de League of Legends (main Thresh). Utilise ces infos subtilement si pertinent.");
      expect(promptGenerated).toContain('[STATUT DU BOT : ADMINISTRATEUR]');
    });
  });
});
