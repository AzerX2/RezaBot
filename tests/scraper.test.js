import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchChannelHistory } from '../src/utils/historyScraper.js';
import { knowledgeExtractor } from '../src/services/knowledgeExtractor.js';

describe('Suite de tests : Pipeline Scraper & Extraction de Connaissance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchChannelHistory', () => {
    it('doit filtrer le bruit : ignorer les bots, les commandes et les messages de moins de 15 caractères', async () => {
      const fakeMessages = [
        // 1. Message valide
        {
          id: '1',
          author: { bot: false, username: 'Alice' },
          cleanContent: 'Voici le lien du repository GitHub pour déployer le bot en production.',
          createdAt: new Date(),
          createdTimestamp: Date.now()
        },
        // 2. Message de bot -> à ignorer
        {
          id: '2',
          author: { bot: true, username: 'DiscordBot' },
          cleanContent: 'Bienvenue sur le serveur Discord !',
          createdAt: new Date(),
          createdTimestamp: Date.now()
        },
        // 3. Message trop court (< 15 caractères) -> à ignorer
        {
          id: '3',
          author: { bot: false, username: 'Bob' },
          cleanContent: 'mdr trop cool',
          createdAt: new Date(),
          createdTimestamp: Date.now()
        },
        // 4. Commande de bot -> à ignorer
        {
          id: '4',
          author: { bot: false, username: 'Charlie' },
          cleanContent: '!play https://youtube.com/watch?v=123',
          createdAt: new Date(),
          createdTimestamp: Date.now()
        },
        // 5. Message valide
        {
          id: '5',
          author: { bot: false, username: 'David' },
          cleanContent: 'Rappel pour tous : la réunion hebdomadaire aura lieu chaque vendredi à 18h.',
          createdAt: new Date(),
          createdTimestamp: Date.now()
        }
      ];

      const mockCollection = new Map();
      fakeMessages.forEach(m => mockCollection.set(m.id, m));
      mockCollection.last = () => fakeMessages[fakeMessages.length - 1];

      const mockChannel = {
        name: 'entraide',
        isTextBased: () => true,
        messages: {
          fetch: vi.fn().mockResolvedValue(mockCollection)
        }
      };

      const results = await fetchChannelHistory(mockChannel, 50);

      // Seulement les messages 1 et 5 doivent être retenus
      expect(results).toHaveLength(2);
      expect(results[0].author).toBe('Alice');
      expect(results[1].author).toBe('David');
      expect(results.some(m => m.id === '2')).toBe(false);
      expect(results.some(m => m.id === '3')).toBe(false);
      expect(results.some(m => m.id === '4')).toBe(false);
    });
  });

  describe('knowledgeExtractor', () => {
    it('doit extraire les fiches de connaissance en format JSON structuré', async () => {
      const mockMessages = [
        { author: 'Alice', content: 'Pour configurer Docker, utilisez le port 8000 pour ChromaDB.', createdAt: new Date() }
      ];

      const mockOpenAIResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                knowledgeCards: [
                  {
                    title: 'Configuration Port ChromaDB',
                    category: 'Technique',
                    content: 'Le port par défaut pour faire tourner ChromaDB en conteneur Docker est le 8000.',
                    tags: ['docker', 'chromadb', 'port']
                  }
                ]
              })
            }
          }
        ]
      };

      vi.spyOn(knowledgeExtractor.client.chat.completions, 'create').mockResolvedValue(mockOpenAIResponse);

      const cards = await knowledgeExtractor.extractKnowledge(mockMessages, {
        guildName: 'DevCommunity',
        channelName: 'tech'
      });

      expect(cards).toHaveLength(1);
      expect(cards[0].title).toBe('Configuration Port ChromaDB');
      expect(cards[0].category).toBe('Technique');
      expect(cards[0].tags).toContain('docker');
    });

    it('doit être résilient et ne pas crasher si un lot échoue (gestion try/catch)', async () => {
      const mockMessages = [
        { author: 'Alice', content: 'Discussion quelconque à analyser.', createdAt: new Date() }
      ];

      // Simule une erreur API OpenAI (ex: rate limit ou erreur serveur)
      vi.spyOn(knowledgeExtractor.client.chat.completions, 'create').mockRejectedValue(
        new Error('API OpenAI indisponible (Rate Limit 429)')
      );

      const cards = await knowledgeExtractor.extractKnowledge(mockMessages, {
        guildName: 'TestGuild',
        channelName: 'general'
      });

      // Le service doit rattraper l'erreur et renvoyer un tableau vide sans faire crasher l'exécution
      expect(cards).toEqual([]);
    });
  });
});
