import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Charge les Slash Commands dans la collection client.commands
 * et les enregistre auprès de l'API REST Discord.
 * 
 * @param {import('discord.js').Client} client
 */
export async function loadCommands(client) {
  const commandsPath = path.resolve('src/commands');
  if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath, { recursive: true });
  }

  const slashCommandsData = [];
  const commandFolders = fs.readdirSync(commandsPath);

  for (const folderOrFile of commandFolders) {
    const itemPath = path.join(commandsPath, folderOrFile);
    const isDir = fs.statSync(itemPath).isDirectory();

    const files = isDir
      ? fs.readdirSync(itemPath).filter(f => f.endsWith('.js')).map(f => path.join(itemPath, f))
      : (folderOrFile.endsWith('.js') ? [itemPath] : []);

    for (const filePath of files) {
      const fileUrl = pathToFileURL(filePath).href;
      try {
        const cmdModule = await import(fileUrl);
        const command = cmdModule.default || cmdModule;

        if ('data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
          slashCommandsData.push(command.data.toJSON());
          logger.info(`[COMMAND-LOADER] Commande chargée : /${command.data.name}`);
        } else {
          logger.warn(`[COMMAND-LOADER] La commande ${filePath} manque de "data" ou "execute".`);
        }
      } catch (err) {
        logger.error(`[COMMAND-LOADER] Erreur chargement commande ${filePath} :`, err);
      }
    }
  }

  // Déploiement auprès de Discord REST API si des commandes sont présentes
  if (slashCommandsData.length > 0 && config.discord.token && config.discord.clientId) {
    try {
      const rest = new REST().setToken(config.discord.token);
      logger.info(`[REST] Déploiement de ${slashCommandsData.length} commande(s) Slash...`);

      if (config.discord.guildId) {
        // Enregistrement rapide sur le serveur de test
        await rest.put(
          Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
          { body: slashCommandsData }
        );
        logger.info(`[REST] Commandes enregistrées sur la guilde de test (${config.discord.guildId}).`);
      } else {
        // Enregistrement global
        await rest.put(
          Routes.applicationCommands(config.discord.clientId),
          { body: slashCommandsData }
        );
        logger.info('[REST] Commandes enregistrées globalement.');
      }
    } catch (restErr) {
      logger.error('[REST] Échec de l\'enregistrement des Slash Commands :', restErr);
    }
  }
}
