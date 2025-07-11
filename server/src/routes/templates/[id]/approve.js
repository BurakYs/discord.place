const checkAuthentication = require('@/utils/middlewares/checkAuthentication');
const useRateLimiter = require('@/utils/useRateLimiter');
const { param, matchedData } = require('express-validator');
const Template = require('@/schemas/Template');
const Discord = require('discord.js');
const DashboardData = require('@/schemas/Dashboard/Data');
const validateRequest = require('@/utils/middlewares/validateRequest');
const sendLog = require('@/utils/sendLog');
const sendPortalMessage = require('@/utils/sendPortalMessage');

module.exports = {
  post: [
    useRateLimiter({ maxRequests: 10, perMinutes: 1 }),
    checkAuthentication,
    param('id'),
    validateRequest,
    async (request, response) => {
      const { id } = matchedData(request);

      const canApprove = request.member && config.permissions.canApproveTemplatesRoles.some(roleId => request.member.roles.cache.has(roleId));
      if (!canApprove) return response.sendError('You are not allowed to approve this template.', 403);

      const template = await Template.findOne({ id });
      if (!template) return response.sendError('Template not found.', 404);

      if (template.approved === true) return response.sendError('Template is already approved.', 400);

      await template.updateOne({ approved: true });

      await DashboardData.findOneAndUpdate({}, { $inc: { templates: 1 } }, { sort: { createdAt: -1 } });

      const guild = client.guilds.cache.get(config.guildId);

      const publisher = await client.users.fetch(template.user.id).catch(() => null);
      const isPublisherFoundInGuild = guild.members.cache.has(publisher.id) || await guild.members.fetch(publisher.id).then(() => true).catch(() => false);

      if (isPublisherFoundInGuild) {
        const dmChannel = publisher.dmChannel || await publisher.createDM().catch(() => null);
        if (dmChannel) dmChannel.send({ content: `### Congratulations!\nYour template **${template.name}** (ID: ${template.id}) has been approved by <@${request.user.id}>.` }).catch(() => null);
      }

      const embeds = [
        new Discord.EmbedBuilder()
          .setColor(Discord.Colors.Green)
          .setAuthor({ name: `Template Approved | ${template.name}`, iconURL: publisher?.displayAvatarURL?.() || 'https://cdn.discordapp.com/embed/avatars/0.png' })
          .setTimestamp()
          .setFields([
            {
              name: 'Reviewer',
              value: `<@${request.user.id}>`
            }
          ])
      ];

      const components = [
        new Discord.ActionRowBuilder()
          .addComponents(
            new Discord.ButtonBuilder()
              .setStyle(Discord.ButtonStyle.Link)
              .setURL(`${config.frontendUrl}/templates/${id}/preview`)
              .setLabel('View Template on discord.place')
          )
      ];

      sendPortalMessage({ embeds, components });

      sendLog(
        'templateApproved',
        [
          { type: 'user', name: 'Moderator', value: request.user.id },
          { type: 'text', name: 'Template', value: `${template.name} (${template.id})` }
        ],
        [
          { label: 'View User', url: `${config.frontendUrl}/profile/u/${template.user.id}` },
          { label: 'View Moderator', url: `${config.frontendUrl}/profile/u/${request.user.id}` },
          { label: 'Preview Template', url: `${config.frontendUrl}/templates/${id}/preview` }
        ]
      );

      return response.status(204).end();
    }
  ]
};