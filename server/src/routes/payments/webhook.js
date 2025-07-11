/* eslint no-redeclare: 0 */

const crypto = require('crypto');
const Plan = require('@/schemas/LemonSqueezy/Plan');
const User = require('@/schemas/User');
const Profile = require('@/schemas/Profile');
const Server = require('@/schemas/Server');
const ServerVoteTripleEnabled = require('@/schemas/Server/Vote/TripleEnabled');
const Bot = require('@/schemas/Bot');
const BotVoteTripleEnabled = require('@/schemas/Bot/Vote/TripleEnabled');
const { StandedOutServer, StandedOutBot } = require('@/schemas/StandedOut');
const Discord = require('discord.js');
const decrypt = require('@/utils/encryption/decrypt');
const getImageFromHash = require('@/utils/getImageFromHash');
const getUserHashes = require('@/utils/getUserHashes');
const validateRequest = require('@/utils/middlewares/validateRequest');
const sendLog = require('@/utils/sendLog');
const sendPortalMessage = require('@/utils/sendPortalMessage');

module.exports = {
  post: [
    validateRequest,
    async (request, response) => {
      const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;

      const signature = request.headers['x-signature'];
      if (!signature) return response.sendError('Signature not found.', 400);

      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(request.body);
      const calculatedSignature = hmac.digest('hex');

      if (calculatedSignature !== signature) return response.sendError('Invalid signature.', 401);

      await response.send('OK');

      const body = JSON.parse(request.body.toString('utf-8'));

      const colors = {
        tripledVote: '#f97316',
        standedOut: '#166534',
        premium: '#a855f7'
      };

      function sendPurchaseMessage(color, text, iconUrl, message) {
        var embeds = [
          new Discord.EmbedBuilder()
            .setColor(color)
            .setAuthor({ name: text, iconURL: iconUrl || 'https://cdn.discordapp.com/embed/avatars/0.png' })
            .setFooter({ text: message })
        ];

        sendPortalMessage({ embeds });
      }

      switch (body.meta.event_name) {
        case 'order_created':
          var token = body.meta.custom_data?.token;
          if (!token) return logger.warn('[Lemon Squeezy] Token not found in custom data:', `\n${JSON.stringify(body, null, 2)}`);

          var type = body.meta.custom_data?.type;
          if (type && type !== 'server' && type !== 'bot') return logger.warn('[Lemon Squeezy] Invalid type in custom data:', `\n${JSON.stringify(body, null, 2)}`);

          var base64DecodedToken = Buffer.from(token, 'base64').toString('utf-8');

          var [iv, encryptedText, tag] = base64DecodedToken.split(':');
          if (!iv || !encryptedText || !tag) return logger.warn('[Lemon Squeezy] Invalid token:', `\n${JSON.stringify(body, null, 2)}`);

          var decryptedData = decrypt({ iv, encryptedText, tag }, process.env.PAYMENTS_CUSTOM_DATA_ENCRYPT_SECRET_KEY);
          if (!decryptedData) return logger.warn('[Lemon Squeezy] Error decrypting token:', `\n${JSON.stringify(body, null, 2)}`);

          var isTripledVoteProduct = body.data.attributes.first_order_item.variant_id == config.lemonSqueezy.variantIds.tripledVotes.servers || body.data.attributes.first_order_item.variant_id == config.lemonSqueezy.variantIds.tripledVotes.bots;
          if (isTripledVoteProduct) {
            if (type === 'server') {
              var guild = client.guilds.cache.get(decryptedData);
              if (!guild) return logger.warn('[Lemon Squeezy] Guild not found:', `\n${JSON.stringify(body, null, 2)}`);

              var server = await Server.findOne({ id: decryptedData });
              if (!server) return logger.warn('[Lemon Squeezy] Server not found:', `\n${JSON.stringify(body, null, 2)}`);

              var isTripledVoteEnabled = await ServerVoteTripleEnabled.findOne({ id: decryptedData });
              if (isTripledVoteEnabled) return logger.warn('[Lemon Squeezy] Tripled vote is already enabled for this server:', `\n${JSON.stringify(body, null, 2)}`);

              await new ServerVoteTripleEnabled({ id: decryptedData }).save();

              sendPurchaseMessage(colors.tripledVote, guild.name, guild.iconURL(), 'Purchased tripled votes.');
            }

            if (type === 'bot') {
              var bot = await Bot.findOne({ id: decryptedData });
              if (!bot) return logger.warn('[Lemon Squeezy] Bot not found:', `\n${JSON.stringify(body, null, 2)}`);

              var isTripledVoteEnabled = await BotVoteTripleEnabled.findOne({ id: decryptedData });
              if (isTripledVoteEnabled) return logger.warn('[Lemon Squeezy] Tripled vote is already enabled for this bot:', `\n${JSON.stringify(body, null, 2)}`);

              await new BotVoteTripleEnabled({ id: decryptedData }).save();

              var userHashes = await getUserHashes(bot.id);

              sendPurchaseMessage(colors.tripledVote, bot.data.tag || decryptedData, getImageFromHash(bot.id, userHashes.avatar), 'Purchased tripled votes.');
            }
          }

          var isStandedOutProduct = body.data.attributes.first_order_item.variant_id == config.lemonSqueezy.variantIds.standedOut.servers || body.data.attributes.first_order_item.variant_id == config.lemonSqueezy.variantIds.standedOut.bots;
          if (isStandedOutProduct) {
            if (type === 'server') {
              var guild = client.guilds.cache.get(decryptedData);
              if (!guild) return logger.warn('[Lemon Squeezy] Guild not found:', `\n${JSON.stringify(body, null, 2)}`);

              var server = await Server.findOne({ id: decryptedData });
              if (!server) return logger.warn('[Lemon Squeezy] Server not found:', `\n${JSON.stringify(body, null, 2)}`);

              var isStandedOut = await StandedOutServer.findOne({ identifier: decryptedData });
              if (isStandedOut) return logger.warn('[Lemon Squeezy] This server is already standed out:', `\n${JSON.stringify(body, null, 2)}`);

              await new StandedOutServer({ identifier: decryptedData }).save();

              sendPurchaseMessage(colors.standedOut, guild.name, guild.iconURL(), 'Purchased standed out.');
            }

            if (type === 'bot') {
              var bot = await Bot.findOne({ id: decryptedData });
              if (!bot) return logger.warn('[Lemon Squeezy] Bot not found:', `\n${JSON.stringify(body, null, 2)}`);

              var isStandedOut = await StandedOutBot.findOne({ identifier: decryptedData });
              if (isStandedOut) return logger.warn('[Lemon Squeezy] This bot is already standed out:', `\n${JSON.stringify(body, null, 2)}`);

              await new StandedOutBot({ identifier: decryptedData }).save();

              var userHashes = await getUserHashes(bot.id);

              sendPurchaseMessage(colors.standedOut, bot.data.tag || decryptedData, getImageFromHash(bot.id, userHashes.avatar), 'Purchased standed out.');
            }
          }

          if (!isTripledVoteProduct && !isStandedOutProduct) {
            var user_id = decryptedData;

            var user = await User.findOne({ id: user_id });
            if (!user) return logger.warn('[Lemon Squeezy] User not found:', `\n${JSON.stringify(body, null, 2)}`);

            if (user.subscription?.createdAt) return logger.warn('[Lemon Squeezy] User already has a subscription:', `\n${JSON.stringify(body, null, 2)}`);

            var plan = await Plan.findOne({ id: body.data.attributes.first_order_item.product_id });
            if (!plan) return logger.warn('[Lemon Squeezy] Plan not found:', `\n${JSON.stringify(body, null, 2)}`);

            user.subscription = {
              id: body.data.id,
              orderId: body.data.attributes.order_number,
              productId: body.data.attributes.first_order_item.product_id,
              planId: plan.id,
              createdAt: new Date(body.data.attributes.created_at)
            };

            await user.save();

            var guild = client.guilds.cache.get(config.guildId);
            var member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);

            if (member) {
              await member.roles.add(config.roles.premium);
              sendPurchaseMessage(colors.premium, `@${member.user.username}`, member.user.displayAvatarURL(), 'Purchased premium.');
            } else {
              sendPurchaseMessage(colors.premium, user.id, null, 'Purchased premium.');
            }
          }

          break;
        case 'order_refunded':
          var user = await User.findOne({ 'subscription.orderId': body.data.attributes.order_number });
          if (!user) return logger.warn('[Lemon Squeezy] User not found:', `\n${JSON.stringify(body, null, 2)}`);

          user.subscription = null;

          await user.save();

          var profile = await Profile.findOne({ id: user.id });
          if (profile) {
            profile.preferredHost = 'discord.place/p',

            await profile.save();
          }

          var guild = client.guilds.cache.get(config.guildId);
          var member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);

          if (member && member.roles.cache.has(config.roles.premium)) await member.roles.remove(config.roles.premium);

          sendLog(
            'orderRefunded',
            [
              { type: 'user', name: 'User', value: user.id },
              { type: 'text', name: 'Order ID', value: body.data.attributes.order_number }
            ],
            [
              { label: 'View User', url: `${config.frontendUrl}/profile/u/${user.id}` }
            ]
          );

          break;
        case 'subscription_expired':
          var user = await User.findOne({ 'subscription.id': body.data.attributes.order_id });
          if (!user) return logger.warn('[Lemon Squeezy] User not found:', `\n${JSON.stringify(body, null, 2)}`);

          user.oldSubscriptions.push({
            id: user.subscription.id,
            orderId: user.subscription.orderId,
            productId: user.subscription.productId,
            planId: user.subscription.planId,
            createdAt: user.subscription.createdAt,
            expiredAt: new Date(body.data.attributes.ends_at)
          });

          user.subscription = null;

          await user.save();

          var profile = await Profile.findOne({ id: user.id });
          if (profile) {
            profile.preferredHost = 'discord.place/p',

            await profile.save();
          }

          var guild = client.guilds.cache.get(config.guildId);
          var member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);

          if (member && member.roles.cache.has(config.roles.premium)) await member.roles.remove(config.roles.premium);

          sendLog(
            'subscriptionExpired',
            [
              { type: 'user', name: 'User', value: user.id }
            ],
            [
              { label: 'View User', url: `${config.frontendUrl}/profile/u/${user.id}` }
            ]
          );

          break;
      }
    }
  ]
};
