const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { query } = require("../config/database");

// Register new business and user
router.post("/register", async (req, res) => {
  try {
    const {
      email,
      password,
      firstName,
      lastName,
      businessName,
      kraPin,
      phone,
    } = req.body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName || !businessName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Start transaction
    await query("BEGIN");

    // Check if business exists
    const existingBusiness = await query(
      "SELECT id FROM businesses WHERE email = $1 OR kra_pin = $2",
      [email, kraPin],
    );

    if (existingBusiness.rows.length > 0) {
      await query("ROLLBACK");
      return res.status(400).json({ error: "Business already registered" });
    }

    // Create business
    const business = await query(
      `INSERT INTO businesses (name, email, kra_pin, phone, subscription_status, trial_ends_at)
             VALUES ($1, $2, $3, $4, 'trial', NOW() + INTERVAL \'14 days\')
             RETURNING id`,
      [businessName, email, kraPin, phone],
    );

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user (owner)
    const user = await query(
      `INSERT INTO users (business_id, email, first_name, last_name, password_hash, role, is_active)
             VALUES ($1, $2, $3, $4, $5, 'owner', true)
             RETURNING id, email, first_name, last_name, role`,
      [business.rows[0].id, email, firstName, lastName, hashedPassword],
    );

    await query("COMMIT");

    // Generate token
    const token = jwt.sign(
      {
        userId: user.rows[0].id,
        businessId: business.rows[0].id,
        role: user.rows[0].role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        token,
        user: user.rows[0],
        business: { id: business.rows[0].id, name: businessName, email },
      },
    });
  } catch (error) {
    await query("ROLLBACK");
    console.error("Registration error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Get user with business info
    const result = await query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.password_hash, u.role, u.is_active,
                    b.id as business_id, b.name as business_name, b.subscription_status, b.trial_ends_at
             FROM users u
             JOIN businesses b ON u.business_id = b.id
             WHERE u.email = $1`,
      [email],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ error: "Account deactivated" });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user.id, businessId: user.business_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    // Remove password hash from response
    delete user.password_hash;

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
        },
        business: {
          id: user.business_id,
          name: user.business_name,
          subscription_status: user.subscription_status,
          trial_ends_at: user.trial_ends_at,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Forgot password
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const result = await query("SELECT id, email FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      // Don't reveal that user doesn't exist for security
      return res.json({
        success: true,
        message: "If email exists, reset link sent",
      });
    }

    // Generate reset token
    const resetToken = jwt.sign(
      { userId: result.rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );

    // Store reset token in database (you'll need to add this column)
    await query(
      "UPDATE users SET reset_token = $1, reset_expires = NOW() + INTERVAL '1 hour' WHERE id = $2",
      [resetToken, result.rows[0].id],
    );

    // Send email (implement email service)
    // await sendPasswordResetEmail(email, resetToken);

    res.json({ success: true, message: "If email exists, reset link sent" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Failed to process request" });
  }
});

// Reset password
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password required" });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await query(
      "SELECT id FROM users WHERE id = $1 AND reset_token = $2 AND reset_expires > NOW()",
      [decoded.userId, token],
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await query(
      "UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2",
      [hashedPassword, result.rows[0].id],
    );

    res.json({ success: true, message: "Password reset successful" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

module.exports = router;
