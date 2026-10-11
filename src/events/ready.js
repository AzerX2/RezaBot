import { Events, ActivityType } from 'discord.js';
import { activityService } from '../services/activityService.js';
import { socialMemoryService } from '../services/socialMemory.js';
import { analyticsService } from '../services/analyticsService.js';
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

    // Lancement du scheduler de mémoire sociale (Extraction nocturne à 3h)
    socialMemoryService.init(client);

    // Lancement du scheduler d'analytics hebdomadaire (Dimanche à 20h)
    analyticsService.init(client);
  }
};
