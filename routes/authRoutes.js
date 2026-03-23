const router = require('express').Router();
const { verifyToken } = require('../middleware/auth');
const auth = require('../controllers/authController');

router.post('/register', auth.register);
router.post('/login', auth.login);
router.post('/logout', auth.logout);
router.get('/me', verifyToken, auth.getMe);
router.post('/forgot-password', auth.forgotPassword);
router.post('/reset-password', auth.resetPassword);

module.exports = router;
