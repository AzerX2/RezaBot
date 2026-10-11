import { Events, ActivityType } from 'discord.js';
import { activityService } from '../services/activityService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    logger.info(`[BOT] Connecté avec succès en tant que ${client.user.tag} (ID: ${client.user.id})`);
    
    // Définition de l'activité du bot
    client.user.setActivity('veiller sur le serveur & vos questions', {
      type: ActivityType.Custom
    });

    // Lancement du scheduler d'activité autonome (Icebreakers après 6h d'inactivité)
    activityService.init(client);
  }
};
