/**
 * Gestionnaire en mémoire des tickets d'action agentiques en attente de validation humaine.
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
    return this.tickets.get(ticketId);
  }

  /**
   * Supprime un ticket après exécution ou annulation
   * @param {string} ticketId
   * @returns {boolean}
   */
  deleteTicket(ticketId) {
    return this.tickets.delete(ticketId);
  }
}

export const actionTicketManager = new ActionTicketManager();
