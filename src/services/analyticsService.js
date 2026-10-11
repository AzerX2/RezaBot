import cron from 'node-cron';
import OpenAI from 'openai';
import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { databaseService } from './databaseService.js';
import { logger } from '../utils/logger.js';

/**
 * Service d'analyse hebdomadaire IA et de reporting pour les administrateurs.
 * Déclenché par un Cron Job chaque dimanche à 20h.
 * Synthétise les résumés quotidiens de la semaine via chatModel et publie un rapport structuré.
 */
export class AnalyticsService {
  constructor() {
    this.client = null;
    this.cronTask = null;
    this.openai = new OpenAI({
      apiKey: config.ai.openaiApiKey
    });
    this.systemPrompt = "Agis comme un Community Manager. Rédige un rapport hebdomadaire structuré pour l'administrateur : 1. Les 3 sujets les plus discutés. 2. L'humeur générale du serveur. 3. Les membres les plus actifs ou remarquables. 4. Les éventuelles tensions détectées.";
  }

  /**
   * Initialise le service et planifie le Cron Job hebdomadaire (dimanche à 20h)
   * @param {import('discord.js').Client} client
   * @param {string} [cronExpression='0 20 * * 0'] - Dimanche à 20h00
   */
  init(client, cronExpression = '0 20 * * 0') {
    this.client = client;

    try {
      this.cronTask = cron.schedule(cronExpression, async () => {
        logger.info('[ANALYTICS] Démarrage de la génération des rapports hebdomadaires d\'activité...');
        await this.processAllGuilds();
      });

      logger.info(`[ANALYTICS] Scheduler d'analytics hebdomadaire initialisé (Expression: "${cronExpression}").`);
    } catch (err) {
      logger.error('[ANALYTICS] Échec d\'initialisation du cron job hebdomadaire :', err);
    }
  }

  /**
   * Génère et distribue le rapport hebdomadaire pour toutes les guildes connectées
   */
  async processAllGuilds() {
    if (!this.client || !this.client.isReady?.()) {
      logger.warn('[ANALYTICS] Client Discord non disponible ou non prêt pour les rapports hebdomadaires.');
      return;
    }

    const guilds = this.client.guilds.cache;
    for (const [guildId, guild] of guilds) {
      try {
        await this.processGuildWeeklyReport(guild);
      } catch (err) {
        logger.error(`[ANALYTICS] Erreur lors du rapport hebdomadaire pour ${guild.name || guildId} :`, err);
      }
    }
  }

  /**
   * Pipeline complet pour un serveur : récupère les résumés de la semaine,
   * appelle le chatModel et publie l'Embed dans le salon administrateur.
   * 
   * @param {import('discord.js').Guild} guild
   * @returns {Promise<{success: boolean, reportText?: string, channelId?: string}>}
   */
  async processGuildWeeklyReport(guild) {
    if (!guild || !guild.id) return { success: false, reason: 'Guilde invalide' };

    const guildId = String(guild.id);
    const guildName = guild.name || `Serveur (${guildId})`;

    logger.info(`[ANALYTICS] Récupération des résumés d'activité de la semaine pour ${guildName}...`);

    // 1. Récupération des résumés quotidiens de la semaine depuis SQLite
    let summaries = databaseService.getWeeklySummaries(guildId, 7);

    // Fallback : si aucun résumé sur la plage stricte, tenter les derniers résumés enregistrés
    if (!summaries || summaries.length === 0) {
      summaries = databaseService.getDailySummaries(guildId, 7);
    }

    if (!summaries || summaries.length === 0) {
      logger.info(`[ANALYTICS] Aucun résumé quotidien enregistré cette semaine pour ${guildName}.`);
      return { success: false, reason: 'Aucun résumé disponible' };
    }

    // 2. Génération du rapport via le chatModel
    const reportText = await this.generateWeeklyReport(guildId, summaries);
    if (!reportText) {
      logger.warn(`[ANALYTICS] Échec de la synthèse IA du rapport pour ${guildName}.`);
      return { success: false, reason: 'Échec de génération IA' };
    }

    // 3. Envoi du rapport au salon privé des administrateurs
    const sendResult = await this.sendWeeklyReport(guild, reportText);
    return {
      success: sendResult.success,
      reportText,
      channelId: sendResult.channelId
    };
  }

  /**
   * Envoie l'ensemble des résumés quotidiens au chatModel avec le prompt strict
   * @param {string} guildId
   * @param {Array<Object|string>} summaries - Résumés quotidiens de la semaine
   * @returns {Promise<string>} Rapport rédigé par l'IA
   */
  async generateWeeklyReport(guildId, summaries = []) {
    const compiledContent = summaries.map((s, index) => {
      if (typeof s === 'string') return `[Jour ${index + 1}] : ${s}`;
      const dateLabel = s.date ? `[Date: ${s.date}]` : `[Jour ${index + 1}]`;
      return `${dateLabel} ${s.summary || ''}`;
    }).join('\n\n');

    try {
      const response = await this.openai.chat.completions.create({
        model: config.ai.chatModel || 'gpt-5.4-mini',
        temperature: 0.7,
        messages: [
          { role: 'system', content: this.systemPrompt },
          {
            role: 'user',
            content: `Voici l'ensemble des résumés quotidiens collectés tout au long de la semaine sur le serveur :\n\n${compiledContent}\n\nRédige le rapport hebdomadaire structuré pour l'administrateur :`
          }
        ]
      });

      const reportText = response.choices[0]?.message?.content?.trim() || '';
      return reportText;
    } catch (err) {
      logger.error(`[ANALYTICS] Erreur lors de l'appel chatModel pour guild ${guildId} :`, err.message);
      return '';
    }
  }

  /**
   * Construit un Embed Discord soigné et lisible pour le rapport
   * @param {string} guildName
   * @param {string} reportText
   * @returns {EmbedBuilder}
   */
  buildWeeklyReportEmbed(guildName, reportText) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2) // Blurple Discord
      .setTitle(`📊 Rapport d'activité hebdomadaire - ${guildName}`)
      .setDescription(reportText.length > 4000 ? reportText.slice(0, 3990) + '...' : reportText)
      .setTimestamp(new Date())
      .setFooter({ text: 'RezaBot Analytics • IA Community Manager' });

    return embed;
  }

  /**
   * Envoie le rapport d'activité dans le salon privé des administrateurs
   * Priorité : config.discord.adminLogChannelId, puis guildSettings.logChannelId
   * 
   * @param {import('discord.js').Guild} guild
   * @param {string} reportText
   * @returns {Promise<{success: boolean, channelId?: string}>}
   */
  async sendWeeklyReport(guild, reportText) {
    if (!guild) return { success: false };

    const guildSettings = databaseService.getGuildSettings(guild.id);
    const targetChannelId = config.discord.adminLogChannelId || guildSettings.logChannelId;

    if (!targetChannelId) {
      logger.warn(`[ANALYTICS] Aucun salon admin configuré pour le serveur ${guild.name} (${guild.id}). Rapport non envoyé.`);
      return { success: false, reason: 'Salon admin non configuré' };
    }

    let targetChannel = null;
    if (guild.channels?.cache) {
      targetChannel = guild.channels.cache.get(targetChannelId);
    }

    if (!targetChannel && guild.channels?.fetch) {
      try {
        targetChannel = await guild.channels.fetch(targetChannelId);
      } catch {}
    }

    if (!targetChannel && this.client?.channels?.cache) {
      targetChannel = this.client.channels.cache.get(targetChannelId);
    }

    if (!targetChannel || typeof targetChannel.send !== 'function') {
      logger.warn(`[ANALYTICS] Salon administrateur introuvable (${targetChannelId}) sur ${guild.name}.`);
      return { success: false, reason: 'Salon introuvable' };
    }

    try {
      const embed = this.buildWeeklyReportEmbed(guild.name, reportText);
      await targetChannel.send({ embeds: [embed] });
      logger.info(`[ANALYTICS] Rapport hebdomadaire envoyé avec succès dans #${targetChannel.name || targetChannelId} sur ${guild.name}.`);
      return { success: true, channelId: targetChannelId };
    } catch (err) {
      logger.error(`[ANALYTICS] Erreur lors de l'envoi de l'embed dans #${targetChannelId} :`, err);
      return { success: false, reason: err.message };
    }
  }
}

export const analyticsService = new AnalyticsService();
