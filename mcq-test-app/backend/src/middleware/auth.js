// ============================================================================
// Admin authentication middleware
// ============================================================================
const { verifyToken } = require('../utils/jwt');
const { ApiError } = require('./errorHandler');

/** Protects admin-only routes. Expects `Authorization: Bearer <token>`. */
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new ApiError(401, 'Authentication required. Please log in again.');
  }

  try {
    const payload = verifyToken(token);
    req.admin = payload;
    next();
  } catch (err) {
    throw new ApiError(401, 'Your session has expired. Please log in again.');
  }
}

module.exports = { requireAdmin };
