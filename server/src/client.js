// Modules
const Discord = require('discord.js');
const { CronJob } = require('cron');
const syncLemonSqueezyPlans = require('@/utils/payments/syncLemonSqueezyPlans');
const updateMonthlyVotes = require('@/utils/updateMonthlyVotes');
const updateClientActivity = require('@/utils/updateClientActivity');
const syncMemberRoles = require('@/utils/syncMemberRoles');
const sleep = require('@/utils/sleep');

// Schemas
const Server = require('@/schemas/Server');
const VoteReminderMetadata = require('@/schemas/Server/Vote/Metadata');
const VoteReminder = require('@/schemas/Server/Vote/Reminder');
const ReminderMetadata = require('@/schemas/Reminder/Metadata');
const Reminder = require('@/schemas/Reminder');
const DashboardData = require('@/schemas/Dashboard/Data');
const Profile = require('@/schemas/Profile');
const Bot = require('@/schemas/Bot');
const Emoji = require('@/schemas/Emoji');
const EmojiPack = require('@/schemas/Emoji/Pack');
const Template = require('@/schemas/Template');
const Sound = require('@/schemas/Sound');
const Theme = require('@/schemas/Theme');
const User = require('@/schemas/User');
const BotVoteTripledEnabled = require('@/schemas/Bot/Vote/TripleEnabled');
const ServerVoteTripledEnabled = require('@/schemas/Server/Vote/TripleEnabled');
const { StandedOutBot, StandedOutServer } = require('@/schemas/StandedOut');
const Reward = require('@/schemas/Server/Vote/Reward');
const localizationInitialize = require('@/utils/localization/initialize');
const mongoose = require('mongoose');
const sendHeartbeat = require('@/utils/sendHeartbeat');

// S3 Setup
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const S3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  }
});

module.exports = class Client {
  constructor() {
    return this;
  }

  create() {
    this.client = new Discord.Client({
      intents: [
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMembers,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.GuildInvites
      ],
      presence: {
        status: config.botPresenceStatus
      }
    });

    this.client.currentlyUploadingEmojiPack = new Discord.Collection();
    this.client.languageCache = new Discord.Collection();
    this.client.applicationsEntitlementsScopeCallbackError = new Discord.Collection();
    this.client.testVoteWebhooksDelivering = new Discord.Collection();

    return this;
  }

  async start(token, options = {}) {
    while (mongoose.connection.readyState !== mongoose.STATES.connected) await sleep(1000);

    localizationInitialize();

    global.client = this.client;

    this.client.login(token).catch(error => {
      logger.error('Client failed to login:', error);
      process.exit(1);
    });

    this.client.rest.on(Discord.RESTEvents.RateLimited, rateLimitInfo => {
      logger.warn(`Rate limited: ${rateLimitInfo.route} ${rateLimitInfo.method} ${rateLimitInfo.retryAfter}ms ${rateLimitInfo.global ? '(global)' : ''} ${rateLimitInfo.hash} ${rateLimitInfo.url}`);
    });

    this.client.once('ready', async () => {
      if (!client.guilds.cache.get(config.guildId)) {
        logger.error(`Guild with ID ${config.guildId} not found. You can change this guild ID in the config file.`);
        process.exit(1);
      }

      await client.guilds.cache.get(config.guildId).members.fetch();

      logger.info(`Client logged in as ${this.client.user.tag}`);

      const CommandsHandler = require('@/src/bot/handlers/commands.js');
      const commandsHandler = new CommandsHandler();
      commandsHandler.fetchCommands();

      if (options.registerCommands) {
        commandsHandler.registerCommands().then(() => process.exit(0)).catch(error => {
          logger.error('Failed to register commands:', error);
          process.exit(1);
        });
      }

      if (options.unregisterCommands) {
        commandsHandler.unregisterCommands().then(() => process.exit(0)).catch(error => {
          logger.error('Failed to unregister commands:', error);
          process.exit(1);
        });
      }

      client.commands = commandsHandler.commands;

      const EventsHandler = require('@/src/bot/handlers/events.js');
      const eventsHandler = new EventsHandler();
      if (options.startup.listenEvents) {
        eventsHandler.fetchEvents();
        eventsHandler.listenEvents();
      }

      if (options.startup.checkDeletedInviteCodes) this.checkDeletedInviteCodes();
      if (options.startup.checkDeletedRewardsRoles) this.checkDeletedRewardsRoles();
      if (options.startup.updateClientActivity) updateClientActivity();
      if (options.startup.checkVoteReminderMetadatas) this.checkVoteReminderMetadatas();
      if (options.startup.checkReminerMetadatas) this.checkReminerMetadatas();
      if (options.startup.checkExpiredPremiums) this.checkExpiredPremiums();
      if (options.startup.updateBotStats) this.updateBotStats();
      if (options.startup.createNewDashboardData) this.createNewDashboardData();
      if (options.startup.syncMemberRoles) syncMemberRoles();
      if (options.startup.syncLemonSqueezyPlans) this.syncLemonSqueezyPlans();
      if (options.startup.saveMonthlyVotes) this.saveMonthlyVotes();
      if (options.startup.saveDailyProfileStats) this.saveDailyProfileStats();
      if (options.startup.checkExpiredProducts) this.checkExpiredProducts();
      if (options.startup.checkBucketAvailability) this.checkBucketAvailability();

      if (options.startup.listenCrons) {
        new CronJob('0 * * * *', () => {
          this.checkVoteReminderMetadatas();
          this.checkReminerMetadatas();
          this.checkExpiredPremiums();
          this.checkDeletedInviteCodes();
          this.checkDeletedRewardsRoles();
          updateClientActivity();
          syncMemberRoles();
          this.syncLemonSqueezyPlans();
        }, null, true);

        new CronJob('59 23 * * *', () => {
          const today = new Date();
          const nextDay = new Date(today);
          nextDay.setDate(today.getDate() + 1);

          if (nextDay.getDate() === 1) {
            logger.info('Reached the end of the month. Saving monthly votes.');

            this.saveMonthlyVotes();
          }
        }, null, true);

        new CronJob('0 0 * * *', () => {
          this.checkVoteReminderMetadatas();
          this.updateBotStats();
          this.createNewDashboardData();
          this.saveDailyProfileStats();
        }, null, true);

        new CronJob('*/10 * * * *', this.checkBucketAvailability, null, true);
      }
    });
  }

  async checkDeletedInviteCodes() {
    const servers = await Server.find({ 'invite_code.type': 'Invite' });
    for (const server of servers) {
      const guild = client.guilds.cache.get(server.id);
      if (!guild) continue;

      const invite = await guild.invites.fetch().catch(() => null);
      if (!invite || !invite.find(invite => invite.code === server.invite_code.code)) {
        await server.updateOne({ $set: { invite_code: { type: 'Deleted' } } });

        logger.info(`Invite code ${server.invite_code.code} for server ${server.id} was deleted.`);
      }
    }
  }

  async checkDeletedRewardsRoles() {
    const rewards = await Reward.find();

    const serversToCheck = new Set(rewards.map(reward => reward.guild.id));

    const deleteServerOperations = [];
    const deleteRoleOperations = [];

    for (const serverId of serversToCheck) {
      const guild = client.guilds.cache.get(serverId);
      if (!guild) deleteServerOperations.push({
        deleteMany: {
          filter: { 'guild.id': serverId }
        }
      });
    }

    for (const reward of rewards) {
      const guild = client.guilds.cache.get(reward.guild.id);
      if (guild) {
        const role = guild.roles.cache.get(reward.role.id);
        if (!role) deleteRoleOperations.push({
          deleteOne: {
            filter: { 'role.id': reward.role.id }
          }
        });
      }
    }

    if (deleteServerOperations.length > 0) await Reward.bulkWrite(deleteServerOperations);
    if (deleteRoleOperations.length > 0) await Reward.bulkWrite(deleteRoleOperations);

    if (deleteServerOperations.length > 0 || deleteRoleOperations.length > 0) {
      logger.info(`Deleted vote rewards that associated with deleted servers or roles. (Operations: ${deleteServerOperations.length + deleteRoleOperations.length})`);
    }
  }

  async saveMonthlyVotes() {
    try {
      await updateMonthlyVotes();

      logger.info('Monthly votes saved.');
    } catch (error) {
      logger.error('Failed to save monthly votes:', error);
    }
  }

  async checkVoteReminderMetadatas() {
    const reminders = await VoteReminder.find();
    VoteReminderMetadata.deleteMany({ documentId: { $nin: reminders.map(reminder => reminder.id) } })
      .then(deleted => {
        if (deleted.deletedCount <= 0) return;

        logger.info(`Deleted ${deleted.deletedCount} vote reminder metadata.`);
      })
      .catch(error => logger.error('Failed to delete vote reminder metadata:', error));
  }

  async checkReminerMetadatas() {
    const reminders = await Reminder.find();
    ReminderMetadata.deleteMany({ documentId: { $nin: reminders.map(reminder => reminder.id) } })
      .then(deleted => {
        if (deleted.deletedCount <= 0) return;

        logger.info(`Deleted ${deleted.deletedCount} reminder metadata.`);
      })
      .catch(error => logger.error('Failed to delete reminder metadata:', error));
  }

  async updateBotStats() {
    const bot = await Bot.findOne({ id: client.user.id });
    if (!bot) return logger.error(`${client.user.id} bot not found in the Bot collection. Skipping update bot stats.`);

    await Bot.updateOne({ id: client.user.id }, {
      $set: {
        command_count: {
          value: client.commands.size,
          updatedAt: new Date()
        },
        server_count: {
          value: client.guilds.cache.size,
          updatedAt: new Date()
        }
      }
    });

    logger.info('Updated bot stats.');
  }

  async checkExpiredPremiums() {
    User.updateMany({ 'subscription.expiresAt': { $lt: new Date() } }, {
      $set: {
        subscription: null
      }
    }).then(updated => {
      if (updated.modifiedCount <= 0) return;

      logger.info(`Deleted ${updated.modifiedCount} expired premiums.`);
    }).catch(error => logger.error('Failed to delete expired premiums:', error));
  }

  async createNewDashboardData() {
    const emojiPacks = await EmojiPack.find();

    const totalServers = await Server.countDocuments();
    const totalProfiles = await Profile.countDocuments();
    const totalBots = await Bot.countDocuments();
    const totalEmojis = (await Emoji.countDocuments()) + emojiPacks.reduce((acc, pack) => acc + pack.emoji_ids.length, 0);
    const totalTemplates = await Template.countDocuments();
    const totalSounds = await Sound.countDocuments();
    const totalThemes = await Theme.countDocuments();

    await new DashboardData({
      servers: totalServers,
      profiles: totalProfiles,
      bots: totalBots,
      emojis: totalEmojis,
      templates: totalTemplates,
      sounds: totalSounds,
      themes: totalThemes,
      users: client.guilds.cache.map(guild => guild.memberCount).reduce((a, b) => a + b, 0),
      guilds: client.guilds.cache.size
    }).save();

    logger.info('Created new dashboard data.');
  }

  async syncLemonSqueezyPlans() {
    if (!process.env.LEMON_SQUEEZY_API_KEY) return logger.warn('[Lemon Squeezy] API key is not defined. Please define LEMON_SQUEEZY_API_KEY in your environment variables.');

    return syncLemonSqueezyPlans()
      .catch(error => logger.error('There was an error while syncing Lemon Squeezy plans:', error));
  }

  async saveDailyProfileStats() {
    const updatedProfiles = await Profile.updateMany({}, [
      {
        $set: {
          dailyStats: {
            $let: {
              vars: {
                updatedDailyStats: {
                  $concatArrays: [
                    {
                      $ifNull: ['$dailyStats', []] // If dailyLikes doesn't exist, use an empty array
                    },
                    [
                      {
                        likes: '$likes_count',
                        views: '$views',
                        createdAt: new Date()
                      }
                    ]
                  ]
                }
              },
              in: {
                $slice: ['$$updatedDailyStats', -7] // Keep only the last 7 elements
              }
            }
          }
        }
      }
    ]);

    logger.info(`Saved daily stats for ${updatedProfiles.modifiedCount} profiles.`);
  }

  async checkExpiredProducts() {
    const expiredBotTripledVotes = await deleteExpiredProducts(BotVoteTripledEnabled, 86400000);
    const expiredServerTripledVotes = await deleteExpiredProducts(ServerVoteTripledEnabled, 86400000);
    const expiredStandedOutBots = await deleteExpiredProducts(StandedOutBot, 43200000);
    const expiredStandedOutServers = await deleteExpiredProducts(StandedOutServer, 43200000);

    function deleteExpiredProducts(Model, expireTime) {
      return Model.deleteMany({ createdAt: { $lt: new Date(Date.now() - expireTime) } });
    }

    if (expiredBotTripledVotes.deletedCount > 0) logger.info(`Deleted ${expiredBotTripledVotes.deletedCount} expired bot tripled votes.`);
    if (expiredServerTripledVotes.deletedCount > 0) logger.info(`Deleted ${expiredServerTripledVotes.deletedCount} expired server tripled votes.`);
    if (expiredStandedOutBots.deletedCount > 0) logger.info(`Deleted ${expiredStandedOutBots.deletedCount} expired standed out bots.`);
    if (expiredStandedOutServers.deletedCount > 0) logger.info(`Deleted ${expiredStandedOutServers.deletedCount} expired standed out servers.`);
  }

  async checkBucketAvailability() {
    try {
      const command = new HeadBucketCommand({ Bucket: process.env.S3_BUCKET_NAME });

      await S3.send(command);

      await sendHeartbeat(process.env.HEARTBEAT_ID_S3_BUCKET_AVAILABILITY, 0);
    } catch (error) {
      logger.error('Failed to check S3 bucket availability:', error);

      await sendHeartbeat(process.env.HEARTBEAT_ID_S3_BUCKET_AVAILABILITY, 1);
    }
  }
};