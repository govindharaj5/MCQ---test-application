// ============================================================================
// Auth controller — admin login / session verification / password change
// ============================================================================
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const { signToken } = require('../utils/jwt');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { isNonEmptyString } = require('../utils/validators');

/** POST /api/auth/login */
const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
    throw new ApiError(400, 'Username and password are required.');
  }

  const admin = Admin.findByUsername(username.trim());
  if (!admin) {
    throw new ApiError(401, 'Invalid username or password.');
  }

  const passwordMatches = bcrypt.compareSync(password, admin.password_hash);
  if (!passwordMatches) {
    throw new ApiError(401, 'Invalid username or password.');
  }

  const token = signToken({ id: admin.id, username: admin.username });
  res.json({
    success: true,
    data: { token, admin: { id: admin.id, username: admin.username } },
  });
});

/** GET /api/auth/me — lets the frontend verify a stored token is still valid. */
const me = asyncHandler(async (req, res) => {
  const admin = Admin.findById(req.admin.id);
  if (!admin) throw new ApiError(401, 'Session no longer valid.');
  res.json({ success: true, data: { admin } });
});

/** PUT /api/auth/change-password */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!isNonEmptyString(currentPassword) || !isNonEmptyString(newPassword)) {
    throw new ApiError(400, 'Current and new password are required.');
  }
  if (newPassword.length < 6) {
    throw new ApiError(400, 'New password must be at least 6 characters.');
  }

  const admin = Admin.findByUsername(req.admin.username);
  const matches = bcrypt.compareSync(currentPassword, admin.password_hash);
  if (!matches) throw new ApiError(401, 'Current password is incorrect.');

  const newHash = bcrypt.hashSync(newPassword, 10);
  Admin.updatePassword(admin.id, newHash);

  res.json({ success: true, message: 'Password updated successfully.' });
});

module.exports = { login, me, changePassword };
