const express = require('express');
const router = express.Router();
const { register, login, getProfile } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');  // Add this line
const emailService = require('../services/emailService');  // Add this line

// Public routes
router.post('/register', register);
router.post('/login', login);

// Protected routes
router.get('/profile', authenticate, getProfile);

// Test email
router.post('/test-email', authenticate, async (req, res) => {
    try {
        const { businessId } = req.user;
        const result = await query('SELECT * FROM businesses WHERE id = $1', [businessId]);
        const business = result.rows[0];
        
        const emailResult = await emailService.sendWelcomeEmail(
            { email: business.email, first_name: business.name },
            business
        );
        
        res.json({ 
            success: true, 
            message: 'Test email sent',
            result: emailResult 
        });
    } catch (error) {
        console.error('Test email error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;