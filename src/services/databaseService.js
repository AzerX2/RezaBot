import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);

/**
 * Service de base de données relationnelle locale (SQLite) pour la gestion multi-serveur (Multi-tenancy).
 * Tente d'utiliser 'better-sqlite3' si présent, sinon bascule automatiquement sur 'node:sqlite' natif (Node.js 22+).
 */
class DatabaseService {
  constructor() {
    this.dbPath = path.resolve('data/rezabot.sqlite');
    this.db = null;
    this.driver = null;
    this._initDatabase();
  }

  /**
   * Initialisation de la connexion SQLite et création des tables
   */
  _initDatabase() {
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    try {
      // 1. Essai de chargement de better-sqlite3
      try {
        const BetterSqlite = require('better-sqlite3');
        this.db = new BetterSqlite(this.dbPath);
        this.driver = 'better-sqlite3';
      } catch {
        // 2. Bascule vers le module natif node:sqlite
        const { DatabaseSync } = require('node:sqlite');
        this.db = new DatabaseSync(this.dbPath);
        this.driver = 'node:sqlite';
      }

      this._createTables();
      logger.info(`[DATABASE] Base SQLite initialisée avec succès : ${this.dbPath} (Driver: ${this.driver})`);
    } catch (err) {
      logger.error(`[DATABASE] Échec d'initialisation de SQLite (${this.dbPath}) :`, err);
    }
  }

  /**
   * Création de la table guild_settings
   */
  _createTables() {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS guild_settings (
        guildId TEXT PRIMARY KEY,
        logChannelId TEXT,
        botMode TEXT DEFAULT 'standard',
        serverVibe TEXT DEFAULT 'friendly',
        welcomeChannelId TEXT,
        mainChannelId TEXT,
        lastIcebreakerAt DATETIME,
        daily_tokens_used INTEGER DEFAULT 0,
        daily_tokens_reset_date TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db.exec(createTableQuery);

    // Migrations idempotentes pour colonnes supplémentaires
    try {
      this.db.exec('ALTER TABLE guild_settings ADD COLUMN mainChannelId TEXT');
    } catch {}
    try {
      this.db.exec('ALTER TABLE guild_settings ADD COLUMN lastIcebreakerAt DATETIME');
    } catch {}
    try {
      this.db.exec('ALTER TABLE guild_settings ADD COLUMN daily_tokens_used INTEGER DEFAULT 0');
    } catch {}
    try {
      this.db.exec('ALTER TABLE guild_settings ADD COLUMN daily_tokens_reset_date TEXT');
    } catch {}
  }

  /**
   * Récupère la liste de toutes les guildes enregistrées en base
   * @returns {Array<Object>}
   */
  getAllGuilds() {
    if (!this.db) return [];
    try {
      const stmt = this.db.prepare('SELECT * FROM guild_settings');
      return stmt.all ? stmt.all() : [];
    } catch (err) {
      logger.error('[DATABASE] Erreur récupération de toutes les guildes :', err);
      return [];
    }
  }

  /**
   * Récupère les paramètres d'une guilde ou renvoie les valeurs par défaut
   * @param {string} guildId
   * @returns {Object} Paramètres du serveur
   */
  getGuildSettings(guildId) {
    if (!this.db || !guildId) return this._getDefaultSettings(guildId);

    try {
      const stmt = this.db.prepare('SELECT * FROM guild_settings WHERE guildId = ?');
      const row = stmt.get(String(guildId));

      if (!row) {
        return this._getDefaultSettings(guildId);
      }

      return {
        guildId: row.guildId,
        logChannelId: row.logChannelId || null,
        botMode: row.botMode || 'standard',
        serverVibe: row.serverVibe || 'friendly',
        welcomeChannelId: row.welcomeChannelId || null,
        mainChannelId: row.mainChannelId || null,
        lastIcebreakerAt: row.lastIcebreakerAt || null,
        dailyTokensUsed: Number(row.daily_tokens_used || 0),
        dailyTokensResetDate: row.daily_tokens_reset_date || null,
        updatedAt: row.updatedAt
      };
    } catch (err) {
      logger.error(`[DATABASE] Erreur lecture settings pour guild ${guildId} :`, err);
      return this._getDefaultSettings(guildId);
    }
  }

  /**
   * Crée ou met à jour les paramètres d'un serveur (Upsert)
   * @param {string} guildId
   * @param {Object} settings
   */
  setGuildSettings(guildId, settings = {}) {
    if (!this.db || !guildId) return;

    try {
      const existing = this.getGuildSettings(guildId);
      const merged = { ...existing, ...settings };

      const query = `
        INSERT INTO guild_settings (guildId, logChannelId, botMode, serverVibe, welcomeChannelId, mainChannelId, lastIcebreakerAt, daily_tokens_used, daily_tokens_reset_date, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(guildId) DO UPDATE SET
          logChannelId = excluded.logChannelId,
          botMode = excluded.botMode,
          serverVibe = excluded.serverVibe,
          welcomeChannelId = excluded.welcomeChannelId,
          mainChannelId = excluded.mainChannelId,
          lastIcebreakerAt = excluded.lastIcebreakerAt,
          daily_tokens_used = excluded.daily_tokens_used,
          daily_tokens_reset_date = excluded.daily_tokens_reset_date,
          updatedAt = CURRENT_TIMESTAMP
      `;

      const stmt = this.db.prepare(query);
      stmt.run(
        String(guildId),
        merged.logChannelId || null,
        merged.botMode || 'standard',
        merged.serverVibe || 'friendly',
        merged.welcomeChannelId || null,
        merged.mainChannelId || null,
        merged.lastIcebreakerAt || null,
        merged.dailyTokensUsed !== undefined ? merged.dailyTokensUsed : (merged.daily_tokens_used || 0),
        merged.dailyTokensResetDate || merged.daily_tokens_reset_date || null
      );

      logger.info(`[DATABASE] Paramètres mis à jour pour le serveur ${guildId} (Mode: ${merged.botMode}, Vibe: ${merged.serverVibe})`);
    } catch (err) {
      logger.error(`[DATABASE] Erreur upsert settings pour guild ${guildId} :`, err);
    }
  }

  /**
   * Vérifie le quota quotidien de tokens d'un serveur (FinOps).
   * Réinitialise automatiquement le compteur chaque jour calendaire.
   * 
   * @param {string} guildId
   * @param {number} estimatedTokens - Estimation du coût de la requête
   * @param {number} maxDailyTokens - Quota quotidien maximal (défaut: 50 000)
   * @returns {{allowed: boolean, currentUsed: number, remaining: number, maxDaily: number}}
   */
  checkTokenQuota(guildId, estimatedTokens = 400, maxDailyTokens = 50000) {
    if (!this.db || !guildId) {
      return { allowed: true, currentUsed: 0, remaining: maxDailyTokens, maxDaily: maxDailyTokens };
    }

    try {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const settings = this.getGuildSettings(guildId);

      let currentUsed = settings.dailyTokensUsed || 0;
      let resetDate = settings.dailyTokensResetDate;

      // Réinitialisation automatique si nous avons changé de jour
      if (resetDate !== today) {
        currentUsed = 0;
        this.setGuildSettings(guildId, {
          dailyTokensUsed: 0,
          dailyTokensResetDate: today
        });
      }

      const allowed = (currentUsed + estimatedTokens) <= maxDailyTokens;
      const remaining = Math.max(0, maxDailyTokens - currentUsed);

      if (!allowed) {
        logger.warn(`[TOKEN-QUOTA] Quota quotidien dépassé pour guild ${guildId} : ${currentUsed}/${maxDailyTokens} tokens utilisés.`);
      }

      return {
        allowed,
        currentUsed,
        remaining,
        maxDaily: maxDailyTokens
      };
    } catch (err) {
      logger.error(`[TOKEN-QUOTA] Erreur vérification quota pour guild ${guildId} :`, err);
      return { allowed: true, currentUsed: 0, remaining: maxDailyTokens, maxDaily: maxDailyTokens };
    }
  }

  /**
   * Incrémente les tokens consommés pour une guilde
   * @param {string} guildId
   * @param {number} tokensConsumed
   */
  consumeTokens(guildId, tokensConsumed = 0) {
    if (!this.db || !guildId || tokensConsumed <= 0) return;

    try {
      const today = new Date().toISOString().slice(0, 10);
      const settings = this.getGuildSettings(guildId);

      let currentUsed = settings.dailyTokensUsed || 0;
      if (settings.dailyTokensResetDate !== today) {
        currentUsed = 0;
      }

      const updatedTotal = currentUsed + tokensConsumed;
      this.setGuildSettings(guildId, {
        dailyTokensUsed: updatedTotal,
        dailyTokensResetDate: today
      });

      logger.debug(`[TOKEN-TRACKER] Guilde ${guildId} a consommé ${tokensConsumed} tokens (Total jour : ${updatedTotal}).`);
    } catch (err) {
      logger.error(`[TOKEN-TRACKER] Erreur consommation tokens guild ${guildId} :`, err);
    }
  }

  _getDefaultSettings(guildId) {
    return {
      guildId: String(guildId),
      logChannelId: null,
      botMode: 'standard', // 'chill' | 'standard' | 'strict'
      serverVibe: 'friendly', // 'friendly' | 'gaming' | 'tech' | 'formal'
      welcomeChannelId: null,
      mainChannelId: null,
      lastIcebreakerAt: null,
      dailyTokensUsed: 0,
      dailyTokensResetDate: null
    };
  }
}

export const databaseService = new DatabaseService();
