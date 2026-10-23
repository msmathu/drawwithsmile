import { Router } from 'express';
import { ApiController, type ApiDeps } from '../controllers/api.controller.js';
import { asyncHandler, requireSession, sessionRateLimit } from '../middleware/http.js';

export function apiRoutes(deps: ApiDeps): Router {
  const controller = new ApiController(deps);
  const router = Router();

  router.get('/health', controller.health);
  router.post('/session', sessionRateLimit, controller.session);
  router.get('/meta', controller.meta);
  router.get('/rooms', controller.rooms);
  router.get('/leaderboard', asyncHandler(controller.leaderboard));
  router.get('/me/stats', requireSession(deps.sessions), asyncHandler(controller.myStats));

  return router;
}
