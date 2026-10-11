import { databaseService } from './databaseService.js';

/**
 * Gestionnaire des tickets d'action agentiques en attente de validation humaine (Mémoire + SQLite).
 */
class ActionTicketManager {
  constructor() {
    this.tickets = new Map();
  }

  /**
   * Crée et enregistre un nouveau ticket d'action
   * @param {Object} data - Données de l'action ({ type, channels, reason, guildId, ... })
   * @returns {Object} Ticket créé avec identifiant unique
   */
  createTicket(data) {
    const ticketId = Math.random().toString(36).substring(2, 10);
    const ticket = {
      id: ticketId,
      createdAt: Date.now(),
      ...data
    };
    this.tickets.set(ticketId, ticket);

    try {
      databaseService.saveActionTicket(ticket);
    } catch {}

    // Expiration automatique après 15 minutes pour libérer la mémoire
    setTimeout(() => {
      this.tickets.delete(ticketId);
    }, 15 * 60 * 1000);

    return ticket;
  }

  /**
   * Récupère un ticket par son identifiant
   * @param {string} ticketId
   * @returns {Object|undefined}
   */
  getTicket(ticketId) {
    if (this.tickets.has(ticketId)) {
      return this.tickets.get(ticketId);
    }
    try {
      const fromDb = databaseService.getActionTicket(ticketId);
      if (fromDb) {
        this.tickets.set(ticketId, fromDb);
        return fromDb;
      }
    } catch {}
    return undefined;
  }

  /**
   * Récupère le dernier ticket d'une guilde
   * @param {string} guildId
   * @returns {Object|null}
   */
  getLatestTicketForGuild(guildId) {
    if (!guildId) return null;
    const all = Array.from(this.tickets.values());
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].guildId === guildId) return all[i];
    }
    return null;
  }

  /**
   * Supprime un ticket après exécution ou annulation
   * @param {string} ticketId
   * @returns {boolean}
   */
  deleteTicket(ticketId) {
    try {
      databaseService.deleteActionTicket(ticketId);
    } catch {}
    return this.tickets.delete(ticketId);
  }
}

export const actionTicketManager = new ActionTicketManager();
