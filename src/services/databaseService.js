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

      try {
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA busy_timeout = 5000;');
      } catch {}

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
        bot_role TEXT DEFAULT 'member',
        daily_token_quota INTEGER DEFAULT 50000,
        tokens_used_today INTEGER DEFAULT 0,
        last_reset_date TEXT,
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
      this.db.exec("ALTER TABLE guild_settings ADD COLUMN bot_role TEXT DEFAULT 'member'");
    } catch {}
    try {
      this.db.exec('ALTER TABLE guild_settings ADD COLUMN daily_token_quota INTEGER DEFAULT 50000');
    } catch {}
    try {
      this.db.exec('ALTER TABLE guild_settings ADD COLUMN tokens_used_today INTEGER DEFAULT 0');
    } catch {}
    try {
      this.db.exec('ALTER TABLE guild_settings ADD COLUMN last_reset_date TEXT');
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

      const botRole = row.bot_role || 'member';
      const dailyQuota = Number(row.daily_token_quota ?? 50000);
      const usedToday = Number(row.tokens_used_today ?? row.daily_tokens_used ?? 0);
      const resetDate = row.last_reset_date || row.daily_tokens_reset_date || null;

      return {
        guildId: row.guildId,
        logChannelId: row.logChannelId || null,
        botMode: row.botMode || 'standard',
        serverVibe: row.serverVibe || 'friendly',
        welcomeChannelId: row.welcomeChannelId || null,
        mainChannelId: row.mainChannelId || null,
        lastIcebreakerAt: row.lastIcebreakerAt || null,
        bot_role: botRole,
        daily_token_quota: dailyQuota,
        tokens_used_today: usedToday,
        last_reset_date: resetDate,
        // Alias rétrocompatibles
        botRole,
        dailyTokenQuota: dailyQuota,
        dailyTokensUsed: usedToday,
        dailyTokensResetDate: resetDate,
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

      const botRole = settings.bot_role || settings.botRole || merged.bot_role || 'member';
      const dailyQuota = settings.daily_token_quota !== undefined
        ? Number(settings.daily_token_quota)
        : (settings.dailyTokenQuota !== undefined ? Number(settings.dailyTokenQuota) : (merged.daily_token_quota ?? 50000));
      const usedToday = settings.tokens_used_today !== undefined
        ? Number(settings.tokens_used_today)
        : (settings.dailyTokensUsed !== undefined ? Number(settings.dailyTokensUsed) : (merged.tokens_used_today ?? 0));
      const resetDate = settings.last_reset_date || settings.dailyTokensResetDate || merged.last_reset_date || null;

      const query = `
        INSERT INTO guild_settings (
          guildId, logChannelId, botMode, serverVibe, welcomeChannelId, mainChannelId, lastIcebreakerAt,
          bot_role, daily_token_quota, tokens_used_today, last_reset_date, daily_tokens_used, daily_tokens_reset_date, updatedAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(guildId) DO UPDATE SET
          logChannelId = excluded.logChannelId,
          botMode = excluded.botMode,
          serverVibe = excluded.serverVibe,
          welcomeChannelId = excluded.welcomeChannelId,
          mainChannelId = excluded.mainChannelId,
          lastIcebreakerAt = excluded.lastIcebreakerAt,
          bot_role = excluded.bot_role,
          daily_token_quota = excluded.daily_token_quota,
          tokens_used_today = excluded.tokens_used_today,
          last_reset_date = excluded.last_reset_date,
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
        botRole,
        dailyQuota,
        usedToday,
        resetDate,
        usedToday,
        resetDate
      );

      logger.info(`[DATABASE] Paramètres mis à jour pour le serveur ${guildId} (Mode: ${merged.botMode}, Vibe: ${merged.serverVibe}, Rôle: ${botRole}, Quota: ${dailyQuota})`);
    } catch (err) {
      logger.error(`[DATABASE] Erreur upsert settings pour guild ${guildId} :`, err);
    }
  }

  /**
   * Enregistre et incrémente l'utilisation des tokens pour une guilde après chaque appel API.
   * Réinitialise automatiquement le compteur chaque jour à minuit.
   * 
   * @param {string} guildId
   * @param {number} amount - Nombre de tokens à ajouter
   */
  trackTokenUsage(guildId, amount = 0) {
    if (!this.db || !guildId || amount <= 0) return;

    try {
      const today = new Date().toISOString().slice(0, 10);
      const settings = this.getGuildSettings(guildId);

      let currentUsed = settings.tokens_used_today || 0;
      if (settings.last_reset_date !== today) {
        currentUsed = 0;
      }

      const updatedTotal = currentUsed + amount;
      this.setGuildSettings(guildId, {
        tokens_used_today: updatedTotal,
        daily_tokens_used: updatedTotal,
        last_reset_date: today,
        daily_tokens_reset_date: today
      });

      logger.debug(`[TOKEN-TRACKER] Guilde ${guildId} : +${amount} tokens (Total jour : ${updatedTotal}/${settings.daily_token_quota}).`);
    } catch (err) {
      logger.error(`[TOKEN-TRACKER] Erreur consommation tokens guild ${guildId} :`, err);
    }
  }

  /**
   * Alias rétrocompatible pour tests existants
   */
  consumeTokens(guildId, tokensConsumed = 0) {
    this.trackTokenUsage(guildId, tokensConsumed);
  }

  /**
   * Vérifie le quota quotidien de tokens d'un serveur (FinOps).
   * Réinitialise automatiquement le compteur chaque jour calendaire à minuit.
   * 
   * @param {string} guildId
   * @param {number} estimatedTokens - Estimation du coût de la requête
   * @param {number} [customMaxQuota] - Quota optionnel (priorité sur la base de données)
   * @returns {{allowed: boolean, currentUsed: number, remaining: number, maxDaily: number}}
   */
  checkTokenQuota(guildId, estimatedTokens = 400, customMaxQuota = null) {
    if (!this.db || !guildId) {
      const fallbackMax = customMaxQuota || 50000;
      return { allowed: true, currentUsed: 0, remaining: fallbackMax, maxDaily: fallbackMax };
    }

    try {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const settings = this.getGuildSettings(guildId);
      const maxDailyTokens = customMaxQuota || settings.daily_token_quota || 50000;

      let currentUsed = settings.tokens_used_today || 0;
      let resetDate = settings.last_reset_date;

      // Réinitialisation automatique si nous avons changé de jour calendaire (minuit)
      if (resetDate !== today) {
        currentUsed = 0;
        this.setGuildSettings(guildId, {
          tokens_used_today: 0,
          daily_tokens_used: 0,
          last_reset_date: today,
          daily_tokens_reset_date: today
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
      return { allowed: true, currentUsed: 0, remaining: 50000, maxDaily: 50000 };
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
      bot_role: 'member', // 'member' | 'moderator' | 'admin'
      daily_token_quota: 50000,
      tokens_used_today: 0,
      last_reset_date: null,
      // Alias rétrocompatibles
      botRole: 'member',
      dailyTokenQuota: 50000,
      dailyTokensUsed: 0,
      dailyTokensResetDate: null
    };
  }
}

export const databaseService = new DatabaseService();
