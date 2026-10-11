import 'dotenv/config';

/**
 * Centralized application configuration.
 * Validates critical environment variables early on startup.
 */
export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID
  },
  ai: {
    openaiApiKey: process.env.OPENAI_API_KEY,
    // Model Routing / Tiering
    tierEconomy: process.env.OPENAI_MODEL_ECONOMY || 'gpt-4o-mini',  // Tâches de fond (Modération, TLDR, Vibe, Welcome, Icebreaker)
    tierAgentic: process.env.OPENAI_MODEL_AGENTIC || 'gpt-4o',       // Agentic Concierge & Tools
    chatModel: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
    fastModel: process.env.OPENAI_MODEL_FAST || 'gpt-4o-mini',
    // Limites de tokens strictes pour maîtriser les coûts
    maxTokensModeration: 200,
    maxTokensEconomy: 250,
    maxTokensAgentic: 450,
    maxTokensResponse: 450,
    // Quotas & Caching
    dailyTokenLimitPerGuild: parseInt(process.env.DAILY_TOKEN_LIMIT || '50000', 10),
    similarityCacheThreshold: 0.95
  },
  rag: {
    chromaUrl: process.env.CHROMA_URL || 'http://localhost:8000',
    collectionName: process.env.CHROMA_COLLECTION_NAME || 'rezabot_knowledge',
    topK: 4
  }
};

/**
 * Validates mandatory configuration keys.
 */
export function validateConfig() {
  const missing = [];
  if (!config.discord.token) missing.push('DISCORD_TOKEN');
  if (!config.ai.openaiApiKey) missing.push('OPENAI_API_KEY');

  if (missing.length > 0) {
    console.warn(`[CONFIG WARNING] Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validation / vérification du endpoint ChromaDB
  if (!config.rag.chromaUrl) {
    console.warn('[CONFIG WARNING] CHROMA_URL non configuré, fallback par défaut sur http://localhost:8000');
  }
}
