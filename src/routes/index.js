'use strict';
/**
 * Routes Index — aggregates all route modules and registers them with Express.
 *
 * Each route module exports registerRoutes(app, deps) where deps contains
 * shared services (sessionMgr, locks, config helpers, etc.).
 *
 * To add a new feature:
 *   1. Create src/routes/myFeatureRoutes.js
 *   2. Import it here
 *   3. Add registerRoutes(app, deps) call below
 */

const configRoutes    = require('./configRoutes');
const sessionRoutes   = require('./sessionRoutes');
const gameRoutes      = require('./gameRoutes');
const shopRoutes      = require('./shopRoutes');
const gachaRoutes     = require('./gachaRoutes');
const characterRoutes = require('./characterRoutes');
const worldRoutes     = require('./worldRoutes');
const presetRoutes    = require('./presetRoutes');
const logRoutes       = require('./logRoutes');

function registerAllRoutes(app, deps) {
  configRoutes.registerRoutes(app, deps);
  sessionRoutes.registerRoutes(app, deps);
  gameRoutes.registerRoutes(app, deps);
  shopRoutes.registerRoutes(app, deps);
  gachaRoutes.registerRoutes(app, deps);
  characterRoutes.registerRoutes(app, deps);
  worldRoutes.registerRoutes(app, deps);
  presetRoutes.registerRoutes(app, deps);
  logRoutes.registerRoutes(app, deps);
}

module.exports = { registerAllRoutes };
