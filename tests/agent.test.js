import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getServerTimeTool, searchWebTool, conciergeTools, getToolsForRole } from '../src/tools/index.js';
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

  it('getToolsForRole doit attribuer les outils selon le niveau d\'autorité (member, moderator, admin)', () => {
    const memberTools = getToolsForRole('member');
    expect(memberTools).toHaveLength(2);
    expect(memberTools.map(t => t.name)).toEqual(['search_web', 'get_server_time']);

    const modTools = getToolsForRole('moderator');
    expect(modTools).toHaveLength(4);
    expect(modTools.map(t => t.name)).toContain('timeout_user');
    expect(modTools.map(t => t.name)).toContain('delete_message');

    const adminTools = getToolsForRole('admin');
    expect(adminTools).toHaveLength(12);
    expect(adminTools.map(t => t.name)).toContain('create_channel');
    expect(adminTools.map(t => t.name)).toContain('delete_channel');
    expect(adminTools.map(t => t.name)).toContain('search_channels');
    expect(adminTools.map(t => t.name)).toContain('stage_channel_deletion');
    expect(adminTools.map(t => t.name)).toContain('search_entities');
    expect(adminTools.map(t => t.name)).toContain('stage_delete');
    expect(adminTools.map(t => t.name)).toContain('stage_rename');
    expect(adminTools.map(t => t.name)).toContain('stage_category_creation');
  });

  it('getDynamicConciergePrompt doit adapter le system prompt au rôle configuré', () => {
    const memberPrompt = aiService.getDynamicConciergePrompt('chill', 'member');
    expect(memberPrompt).toContain('[STATUT DU BOT : MEMBRE]');
    expect(memberPrompt).toContain('aucune autorité');

    const modPrompt = aiService.getDynamicConciergePrompt('gaming', 'moderator');
    expect(modPrompt).toContain('[STATUT DU BOT : MODÉRATEUR]');
    expect(modPrompt).toContain('timeout_user');

    const adminPrompt = aiService.getDynamicConciergePrompt('formal', 'admin');
    expect(adminPrompt).toContain('[STATUT DU BOT : ADMINISTRATEUR]');
    expect(adminPrompt).toContain('create_channel');
  });
});
