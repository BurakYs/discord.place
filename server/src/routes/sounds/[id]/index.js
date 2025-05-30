const useRateLimiter = require('@/utils/useRateLimiter');
const { param, matchedData } = require('express-validator');
const Sound = require('@/schemas/Sound');
const checkAuthentication = require('@/utils/middlewares/checkAuthentication');
const idValidation = require('@/utils/validations/sounds/id');
const validateRequest = require('@/utils/middlewares/validateRequest');
const sendLog = require('@/utils/sendLog');

const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const S3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  }
});

module.exports = {
  get: [
    useRateLimiter({ maxRequests: 20, perMinutes: 1 }),
    param('id')
      .isString().withMessage('ID must be a string.')
      .custom(idValidation),
    validateRequest,
    async (request, response) => {
      const { id } = matchedData(request);

      const sound = await Sound.findOne({ id });
      if (!sound) return response.sendError('Sound not found.', 404);

      const permissions = {
        canDelete: request.user && (
          request.user.id == sound.publisher.id ||
          (request.member && config.permissions.canDeleteSoundsRoles.some(role => request.member.roles.cache.has(role)))
        ),
        canApprove: request.user && request.member && config.permissions.canApproveSoundsRoles.some(role => request.member.roles.cache.has(role))
      };

      if (!sound.approved && !permissions.canApprove && !permissions.canDelete) return response.sendError('You can\'t view this sound until confirmed.', 404);

      const publiclySafe = sound.toPubliclySafe({ isLiked: request.user && sound.likers.includes(request.user.id) });
      Object.assign(publiclySafe, { permissions });

      return response.json(publiclySafe);
    }
  ],
  delete: [
    useRateLimiter({ maxRequests: 2, perMinutes: 1 }),
    checkAuthentication,
    param('id')
      .isString().withMessage('ID must be a string.')
      .custom(idValidation),
    validateRequest,
    async (request, response) => {
      const { id } = matchedData(request);

      const sound = await Sound.findOne({ id });
      if (!sound) return response.sendError('Sound not found.', 404);

      const canDelete = request.user.id === sound.publisher.id || config.permissions.canDeleteSoundsRoles.some(role => request.member.roles.cache.has(role));
      if (!canDelete) return response.sendError('You are not allowed to delete this sound.', 403);

      const command = new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `sounds/${sound.id}.mp3`
      });

      S3.send(command).catch(() => null);

      await sound.deleteOne();

      sendLog(
        'soundDeleted',
        [
          { type: 'user', name: 'User', value: request.user.id },
          { type: 'text', name: 'Sound', value: `${sound.name} (${sound.id})` }
        ],
        [
          { label: 'View User', url: `${config.frontendUrl}/profile/u/${request.user.id}` }
        ]
      );

      return response.status(204).end();
    }
  ]
};