import { describe, it, expect, vi, beforeEach } from 'vitest';
import messageCreateEvent from '../src/events/messageCreate.js';
import { aiService } from '../src/services/aiService.js';
import { databaseService } from '../src/services/databaseService.js';
import { MockMessage, MockUser, MockChannel, MockGuild, MockClient } from './mocks/discord.mock.js';

describe('Suite de tests : Modération Contextuelle IA', () => {
  let client;
  let guild;
  let textChannel;
  let logChannel;
  let author;

  beforeEach(() => {
    vi.clearAllMocks();

    client = new MockClient();
    guild = new MockGuild({ id: 'guild-test-456', name: 'Communaute Gaming' });

    textChannel = new MockChannel({ id: 'chan-chat', name: 'general' });
    logChannel = new MockChannel({ id: 'mod-log-chan', name: 'mod-logs' });

    guild.addChannel(textChannel);
    guild.addChannel(logChannel);

    author = new MockUser({ id: 'bad-user-99', username: 'ToxicPlayer' });

    // Mock des paramètres en base de données pour associer le salon de logs
    vi.spyOn(databaseService, 'getGuildSettings').mockReturnValue({
      guildId: guild.id,
      logChannelId: logChannel.id,
      botMode: 'active',
      serverVibe: 'gaming'
    });
  });

  it('doit envoyer un MP bienveillant et logger l\'incident pour les admins si le message est toxique', async () => {
    // 1. Mock de l'API OpenAI simulant la détection de toxicité
    const mockOpenAIResponse = {
      isToxic: true,
      severity: 'high',
      reason: 'Attaque personnelle dégradante et gratuite',
      friendlyTip: 'Merci de rester courtois et de respecter les autres membres.'
    };

    vi.spyOn(aiService, 'moderateMessage').mockResolvedValue(mockOpenAIResponse);

    const message = new MockMessage({
      id: 'msg-toxic-001',
      content: 'T\'es vraiment un bon à rien dégage du serveur',
      author,
      channel: textChannel,
      guild,
      client
    });

    // 2. Exécution de l'événement messageCreate
    await messageCreateEvent.execute(message);

    // Attente brève car la modération s'exécute en IIFE asynchrone d'arrière-plan
    await new Promise((r) => setTimeout(r, 50));

    // 3. Vérifications : Le membre doit avoir reçu un MP d'avertissement
    expect(aiService.moderateMessage).toHaveBeenCalledTimes(1);
    expect(author.send).toHaveBeenCalledTimes(1);

    // Vérification : Le salon de log doit avoir reçu un embed avec les boutons interactifs
    expect(logChannel.send).toHaveBeenCalledTimes(1);
    const logCallArgs = logChannel.send.mock.calls[0][0];
    expect(logCallArgs).toHaveProperty('embeds');
    expect(logCallArgs).toHaveProperty('components');
    expect(logCallArgs.embeds[0].data.title).toContain('HIGH');
  });

  it('ne doit PAS modérer ni envoyer d\'avertissement pour du sarcasme ou chambrage amical (Faux Positif évité)', async () => {
    // 1. Mock de l'API OpenAI indiquant que c'est du second degré non toxique
    const mockBanterResponse = {
      isToxic: false,
      severity: 'none',
      reason: 'Chambrage bon enfant entre amis de jeu',
      friendlyTip: ''
    };

    vi.spyOn(aiService, 'moderateMessage').mockResolvedValue(mockBanterResponse);

    const message = new MockMessage({
      id: 'msg-banter-002',
      content: 'Haha t\'as encore raté ton tir t\'es trop nul mon pote 😂',
      author,
      channel: textChannel,
      guild,
      client
    });

    // 2. Exécution de l'événement messageCreate
    await messageCreateEvent.execute(message);
    await new Promise((r) => setTimeout(r, 50));

    // 3. Vérifications : Aucune action intrusive de modération ne doit avoir eu lieu
    expect(aiService.moderateMessage).toHaveBeenCalledTimes(1);
    expect(author.send).not.toHaveBeenCalled();
    expect(logChannel.send).not.toHaveBeenCalled();
  });
});
