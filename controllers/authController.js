const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query, getClient } = require('../config/database');

// Generate JWT Token
const generateToken = (userId, businessId, role) => {
    return jwt.sign(
        { userId, businessId, role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );
};

// Register new business and owner
const register = async (req, res) => {
    let client;
    
    try {
        const {
            businessName,
            kraPin,
            businessEmail,
            businessPhone,
            ownerFirstName,
            ownerLastName,
            ownerEmail,
            ownerPhone,
            password,
            industry,
            location
        } = req.body;

        // Validate required fields
        if (!businessName || !kraPin || !ownerEmail || !password) {
            return res.status(400).json({ 
                error: 'Missing required fields: businessName, kraPin, ownerEmail, password' 
            });
        }

        // Check if business already exists
        const existingBusiness = await query(
            'SELECT id FROM businesses WHERE kra_pin = $1 OR email = $2',
            [kraPin, businessEmail]
        );
        
        if (existingBusiness.rows.length > 0) {
            return res.status(409).json({ error: 'Business already registered' });
        }

        // Check if owner email already exists
        const existingUser = await query(
            'SELECT id FROM users WHERE email = $1',
            [ownerEmail]
        );
        
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Get a database client for transaction
        client = await getClient();
        
        // Start transaction
        await client.query('BEGIN');

        // Create business
        const businessResult = await client.query(
            `INSERT INTO businesses (name, kra_pin, email, phone, industry, location, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [businessName, kraPin, businessEmail, businessPhone, industry, location, 'active']
        );

        const businessId = businessResult.rows[0].id;

        // Create owner user
        const userResult = await client.query(
            `INSERT INTO users (business_id, email, phone, first_name, last_name, password_hash, role)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [businessId, ownerEmail, ownerPhone, ownerFirstName, ownerLastName, passwordHash, 'owner']
        );

        const userId = userResult.rows[0].id;

        // Commit transaction
        await client.query('COMMIT');

        // Generate token
        const token = generateToken(userId, businessId, 'owner');

        res.status(201).json({
            success: true,
            message: 'Business registered successfully',
            data: {
                token,
                user: {
                    id: userId,
                    email: ownerEmail,
                    firstName: ownerFirstName,
                    lastName: ownerLastName,
                    role: 'owner'
                },
                business: {
                    id: businessId,
                    name: businessName,
                    kraPin: kraPin,
                    email: businessEmail
                }
            }
        });

    } catch (error) {
        // Rollback transaction if it was started
        if (client) {
            await client.query('ROLLBACK');
            client.release();
        }
        console.error('Registration error:', error);
        res.status(500).json({ 
            error: 'Registration failed', 
            details: process.env.NODE_ENV === 'development' ? error.message : undefined 
        });
    }
};

// Login user
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Find user
        const userResult = await query(
            `SELECT u.*, b.name as business_name, b.status as business_status 
             FROM users u
             JOIN businesses b ON u.business_id = b.id
             WHERE u.email = $1 AND u.is_active = true`,
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = userResult.rows[0];

        // Check if business is active
        if (user.business_status !== 'active') {
            return res.status(403).json({ error: 'Business account is not active' });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Update last login
        await query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );

        // Generate token
        const token = generateToken(user.id, user.business_id, user.role);

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    role: user.role,
                    businessId: user.business_id,
                    businessName: user.business_name
                }
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            error: 'Login failed', 
            details: process.env.NODE_ENV === 'development' ? error.message : undefined 
        });
    }
};

// Get current user profile
const getProfile = async (req, res) => {
    try {
        const result = await query(
            `SELECT u.id, u.email, u.phone, u.first_name, u.last_name, u.role, u.is_active,
                    b.id as business_id, b.name as business_name, b.kra_pin, b.industry, 
                    b.location, b.status as business_status, b.subscription_tier
             FROM users u
             JOIN businesses b ON u.business_id = b.id
             WHERE u.id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Failed to get profile' });
    }
};
module.exports = {
    register,
    login,
    getProfile  // Add this
};