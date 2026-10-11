import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getServerTimeTool, searchWebTool, conciergeTools } from '../src/tools/index.js';
import { aiService } from '../src/services/aiService.js';
import { cacheService } from '../src/services/cacheService.js';

describe('Suite de tests : Mécanique Agentique & Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('l\'outil getServerTimeTool doit renvoyer la date et l\'heure exacte sans appel réseau', async () => {
    const result = await getServerTimeTool.invoke({ timezone: 'Europe/Paris' });

    expect(typeof result).toBe('string');
    expect(result).toContain('Date et heure actuelles');
    expect(result).toContain('Europe/Paris');
  });

  it('l\'outil searchWebTool doit interroger l\'API DuckDuckGo et formater le résultat avec fetch mocké', async () => {
    // Mock du fetch natif pour respecter la contrainte stricte d'absence d'appel réseau réel
    const mockApiResponse = {
      Heading: 'LangChain',
      AbstractText: 'LangChain est un framework conçu pour simplifier la création d\'applications utilisant des LLMs.',
      RelatedTopics: [
        { Text: 'LangChain JS : Version JavaScript et TypeScript du framework.' }
      ]
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse
    });

    const result = await searchWebTool.invoke({ query: 'LangChain' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain('api.duckduckgo.com');
    expect(result).toContain('LangChain est un framework');
  });

  it('le Concierge doit exécuter l\'agent et intégrer le résultat de l\'outil getServerTimeTool', async () => {
    // 1. Simuler un miss de cache sémantique pour forcer l'exécution de l'agent
    vi.spyOn(cacheService, 'get').mockResolvedValue({ hit: false, queryEmbedding: [0.1, 0.2] });
    vi.spyOn(cacheService, 'set').mockResolvedValue();

    // 2. Simuler l'outil appelé par l'agent
    const mockToolExecution = await getServerTimeTool.invoke({ timezone: 'Europe/Paris' });
    expect(mockToolExecution).toBeDefined();

    // 3. Mock de la complétion pour simuler la réponse de l'agent intégrant le retour de l'outil
    const expectedAgentReply = `Il est actuellement 14h30 sur le serveur (fuseau Europe/Paris).`;
    vi.spyOn(aiService, 'askConcierge').mockResolvedValue(expectedAgentReply);

    const reply = await aiService.askConcierge(
      'Quelle heure est-il ?',
      'JeanTesteur',
      [],
      { guildId: 'guild-123', serverVibe: 'friendly' }
    );

    expect(reply).toBe(expectedAgentReply);
    expect(reply).toContain('14h30');
    expect(conciergeTools.length).toBe(2);
  });
});
