// ============================================================================
// Centralized error handling
// ============================================================================
// Controllers throw `ApiError` for expected failures (bad input, not found,
// unauthorized, conflict). Anything else (unexpected exceptions) is caught
// and reported as a generic 500 so internal details never leak to clients.
// ============================================================================

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Wraps an async route handler so thrown/rejected errors reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.statusCode ? err.message : 'Something went wrong on the server.';

  if (!err.statusCode) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  res.status(statusCode).json({ success: false, message });
}

function notFoundHandler(req, res) {
  res.status(404).json({ success: false, message: 'Route not found.' });
}

module.exports = { ApiError, asyncHandler, errorHandler, notFoundHandler };
