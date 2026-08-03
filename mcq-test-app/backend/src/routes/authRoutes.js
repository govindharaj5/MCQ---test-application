const express = require('express');
const { login, me, changePassword } = require('../controllers/authController');
const { requireAdmin } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/login', loginLimiter, login);
router.get('/me', requireAdmin, me);
router.put('/change-password', requireAdmin, changePassword);

module.exports = router;
