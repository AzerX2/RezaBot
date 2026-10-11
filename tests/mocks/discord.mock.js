import { vi } from 'vitest';

/**
 * Mock d'un utilisateur Discord (User)
 */
export class MockUser {
  constructor({ id = 'user-123', username = 'JeanTesteur', bot = false } = {}) {
    this.id = id;
    this.username = username;
    this.tag = `${username}#0001`;
    this.bot = bot;
    this.send = vi.fn().mockResolvedValue({ id: 'dm-123' });
  }
}

/**
 * Mock d'un salon textuel Discord (TextChannel)
 */
export class MockChannel {
  constructor({ id = 'channel-123', name = 'general', isText = true } = {}) {
    this.id = id;
    this.name = name;
    this._isText = isText;
    this.send = vi.fn().mockResolvedValue({ id: 'channel-msg-123' });
    this.sendTyping = vi.fn().mockResolvedValue(true);
    this.messages = {
      fetch: vi.fn().mockResolvedValue(new Map())
    };
  }

  isTextBased() {
    return this._isText;
  }

  permissionsFor() {
    return {
      has: () => true
    };
  }
}

/**
 * Mock d'un serveur Discord (Guild)
 */
export class MockGuild {
  constructor({ id = 'guild-123', name = 'Test Server' } = {}) {
    this.id = id;
    this.name = name;
    this.channelsMap = new Map();

    this.channels = {
      cache: {
        get: (channelId) => this.channelsMap.get(channelId),
        find: (predicate) => Array.from(this.channelsMap.values()).find(predicate),
        values: () => this.channelsMap.values()
      },
      fetch: vi.fn(async (channelId) => this.channelsMap.get(channelId) || null)
    };

    this.members = {
      me: {
        id: 'bot-999',
        permissionsFor: () => ({ has: () => true })
      },
      fetchMe: vi.fn().mockResolvedValue({
        id: 'bot-999',
        permissionsFor: () => ({ has: () => true })
      })
    };

    this.systemChannel = null;
  }

  addChannel(channel) {
    this.channelsMap.set(channel.id, channel);
    return channel;
  }
}

/**
 * Mock du Client Discord
 */
export class MockClient {
  constructor() {
    this.user = {
      id: 'bot-999',
      username: 'RezaBot',
      tag: 'RezaBot#0000',
      bot: true
    };
    this.commands = new Map();
    this.ragService = {
      searchContext: vi.fn().mockResolvedValue([]),
      ingestDocuments: vi.fn().mockResolvedValue({ success: true, count: 1 }),
      recordObservation: vi.fn().mockResolvedValue(true),
      getObservationLogs: vi.fn().mockResolvedValue([]),
      getUserFacts: vi.fn().mockResolvedValue([])
    };
    this.databaseService = {
      getGuildSettings: vi.fn().mockReturnValue({
        guildId: 'guild-123',
        logChannelId: 'mod-log-123',
        botMode: 'active',
        serverVibe: 'friendly'
      }),
      setGuildSettings: vi.fn(),
      checkTokenQuota: vi.fn().mockReturnValue({ allowed: true, remaining: 50000 }),
      consumeTokens: vi.fn()
    };
  }
}

/**
 * Mock d'un message Discord (Message)
 */
export class MockMessage {
  constructor({
    id = 'msg-123',
    content = 'Message de test',
    author = new MockUser(),
    channel = new MockChannel(),
    guild = new MockGuild(),
    client = new MockClient(),
    mentionedBot = false
  } = {}) {
    this.id = id;
    this.content = content;
    this.author = author;
    this.channel = channel;
    this.guild = guild;
    this.client = client;
    this.url = `https://discord.com/channels/${guild.id}/${channel.id}/${id}`;

    this.member = {
      displayName: author.username,
      user: author
    };

    this.mentions = {
      has: (userId) => mentionedBot && userId === client.user.id,
      everyone: false
    };

    this.reply = vi.fn().mockResolvedValue({ id: 'reply-msg-123' });
  }
}
