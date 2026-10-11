import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '../utils/logger.js';

/**
 * Charge dynamiquement tous les événements depuis le dossier /events
 * @param {import('discord.js').Client} client
 */
export async function loadEvents(client) {
  const eventsPath = path.resolve('src/events');
  if (!fs.existsSync(eventsPath)) return;

  const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const fileUrl = pathToFileURL(filePath).href;

    try {
      const eventModule = await import(fileUrl);
      const event = eventModule.default || eventModule;

      if (!event.name) {
        logger.warn(`[EVENT-LOADER] L'événement dans ${file} ne possède pas de propriété 'name'. Ignoré.`);
        continue;
      }

      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
      } else {
        client.on(event.name, (...args) => event.execute(...args));
      }

      logger.info(`[EVENT-LOADER] Événement enregistré : ${event.name} (${file})`);
    } catch (err) {
      logger.error(`[EVENT-LOADER] Erreur lors du chargement de l'événement ${file} :`, err);
    }
  }
}
