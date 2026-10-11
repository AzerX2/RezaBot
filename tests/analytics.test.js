import { describe, it, expect, vi, beforeEach } from 'vitest';
import cron from 'node-cron';
import { analyticsService } from '../src/services/analyticsService.js';
import { databaseService } from '../src/services/databaseService.js';
import { config } from '../src/config.js';
import { MockGuild, MockChannel, MockClient } from './mocks/discord.mock.js';

describe('Suite de tests : Analytics & Rapport Hebdomadaire pour Administrateurs', () => {
  let mockClient;
  let mockGuild;
  let mockAdminChannel;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockClient = new MockClient();
    mockGuild = new MockGuild({ id: 'guild-analytics-101', name: 'Communaute Pro' });
    mockAdminChannel = new MockChannel({ id: 'admin-log-chan-777', name: 'admin-logs' });
    mockGuild.addChannel(mockAdminChannel);
  });

  describe('1. Planification du Cron Job hebdomadaire (Dimanche à 20h)', () => {
    it('init doit planifier le cron job avec l\'expression "0 20 * * 0"', () => {
      const scheduleSpy = vi.spyOn(cron, 'schedule').mockReturnValue({
        stop: vi.fn(),
        start: vi.fn()
      });

      analyticsService.init(mockClient);

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      const cronExpression = scheduleSpy.mock.calls[0][0];
      expect(cronExpression).toBe('0 20 * * 0');
    });
  });

  describe('2. Persistance et extraction des résumés quotidiens dans SQLite', () => {
    it('doit sauvegarder et récupérer les résumés quotidiens de la semaine', () => {
      const gId = 'guild-summaries-test';
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      databaseService.saveDailySummary(gId, 'Lundi: Discussions animées sur le lancement du projet React.', yesterday);
      databaseService.saveDailySummary(gId, 'Mardi: Débogage intensif et blagues sur le café.', today);

      const weekly = databaseService.getWeeklySummaries(gId, 7);

      expect(weekly.length).toBeGreaterThanOrEqual(2);
      const summariesText = weekly.map(w => w.summary).join(' ');
      expect(summariesText).toContain('React');
      expect(summariesText).toContain('café');
    });
  });

  describe('3. Génération du rapport via chatModel avec prompt strict', () => {
    it('generateWeeklyReport doit interroger chatModel avec le prompt Community Manager', async () => {
      const mockReportContent = `
1. Sujets les plus discutés : Refonte UI, API Discord, Docker Compose.
2. Humeur générale : Très positive et productive.
3. Membres remarquables : @Alex et @Sam pour leur aide sur les PRs.
4. Tensions : Aucune tension majeure constatée.
      `.trim();

      const createSpy = vi.spyOn(analyticsService.openai.chat.completions, 'create')
        .mockResolvedValue({
          choices: [
            {
              message: {
                content: mockReportContent
              }
            }
          ]
        });

      const summaries = [
        { date: '2026-10-05', summary: 'Discussion sur la refonte UI et Tailwind.' },
        { date: '2026-10-06', summary: 'Alex et Sam ont réglé un bug sur Docker Compose.' }
      ];

      const report = await analyticsService.generateWeeklyReport('guild-analytics-101', summaries);

      expect(createSpy).toHaveBeenCalledTimes(1);
      const callArgs = createSpy.mock.calls[0][0];

      // Vérification du chatModel
      expect(callArgs.model).toBe(config.ai.chatModel || 'gpt-5.4-mini');

      // Vérification du prompt système strict
      const systemMsg = callArgs.messages.find(m => m.role === 'system');
      expect(systemMsg.content).toBe(
        "Agis comme un Community Manager. Rédige un rapport hebdomadaire structuré pour l'administrateur : 1. Les 3 sujets les plus discutés. 2. L'humeur générale du serveur. 3. Les membres les plus actifs ou remarquables. 4. Les éventuelles tensions détectées."
      );

      // Vérification du contenu utilisateur
      const userMsg = callArgs.messages.find(m => m.role === 'user');
      expect(userMsg.content).toContain('Discussion sur la refonte UI');
      expect(userMsg.content).toContain('Alex et Sam ont réglé un bug');

      expect(report).toBe(mockReportContent);
    });
  });

  describe('4. Construction et envoi du bel EmbedBuilder dans le salon admin', () => {
    it('buildWeeklyReportEmbed doit créer un embed valide avec titre, couleur et footer', () => {
      const reportText = '1. Sujets : Node.js\n2. Humeur : Excellente';
      const embed = analyticsService.buildWeeklyReportEmbed('Mon Serveur', reportText);

      expect(embed.data.title).toContain('Mon Serveur');
      expect(embed.data.color).toBe(0x5865F2);
      expect(embed.data.description).toContain(reportText);
      expect(embed.data.footer.text).toContain('RezaBot Analytics');
    });

    it('sendWeeklyReport doit poster l\'embed dans config.discord.adminLogChannelId', async () => {
      config.discord.adminLogChannelId = mockAdminChannel.id;

      const reportText = 'Rapport hebdomadaire complet prêt.';
      const res = await analyticsService.sendWeeklyReport(mockGuild, reportText);

      expect(res.success).toBe(true);
      expect(mockAdminChannel.send).toHaveBeenCalledTimes(1);

      const sendCall = mockAdminChannel.send.mock.calls[0][0];
      expect(sendCall.embeds).toBeDefined();
      expect(sendCall.embeds[0].data.description).toContain('Rapport hebdomadaire complet');
    });

    it('sendWeeklyReport doit basculer sur guildSettings.logChannelId si adminLogChannelId global n\'est pas défini', async () => {
      config.discord.adminLogChannelId = null;

      vi.spyOn(databaseService, 'getGuildSettings').mockReturnValue({
        logChannelId: mockAdminChannel.id
      });

      const res = await analyticsService.sendWeeklyReport(mockGuild, 'Rapport fallback logChannelId');

      expect(res.success).toBe(true);
      expect(mockAdminChannel.send).toHaveBeenCalledTimes(1);
    });

    it('processGuildWeeklyReport doit exécuter tout le pipeline avec succès', async () => {
      config.discord.adminLogChannelId = mockAdminChannel.id;

      // Ajouter des résumés dans la base
      databaseService.saveDailySummary(mockGuild.id, 'Super ambiance mercredi.', '2026-10-07');

      vi.spyOn(analyticsService, 'generateWeeklyReport').mockResolvedValue('1. Sujets : Gaming\n2. Humeur : Chill');

      const result = await analyticsService.processGuildWeeklyReport(mockGuild);

      expect(result.success).toBe(true);
      expect(result.reportText).toContain('1. Sujets : Gaming');
      expect(mockAdminChannel.send).toHaveBeenCalledTimes(1);
    });
  });
});
