const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { authenticate, authorize } = require("../middleware/auth");
const { query } = require("../config/database");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// Get all team members
router.get("/", authenticate, async (req, res) => {
  try {
    const { businessId } = req.user;
    const result = await query(
      `SELECT id, email, first_name, last_name, role, is_active, last_login, created_at
             FROM users
             WHERE business_id = $1
             ORDER BY created_at ASC`,
      [businessId],
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get team error:", error);
    res.status(500).json({ error: "Failed to get team members" });
  }
});

// Invite team member (Owner only)
router.post("/invite", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { email, role } = req.body;
    const { businessId } = req.user;

    if (!email || !role) {
      return res.status(400).json({ error: "Email and role required" });
    }

    // Check if user already exists
    const existingUser = await query("SELECT id FROM users WHERE email = $1", [
      email.toLowerCase(),
    ]);

    if (existingUser.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "User already exists with this email" });
    }

    // Check for pending invitation
    const pendingInvite = await query(
      "SELECT id FROM invitations WHERE email = $1 AND expires_at > NOW()",
      [email.toLowerCase()],
    );

    if (pendingInvite.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "An invitation has already been sent to this email" });
    }

    // Create invitation token
    const token = crypto.randomBytes(32).toString("hex");

    // Store invitation
    await query(
      `INSERT INTO invitations (business_id, email, role, token, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')`,
      [businessId, email.toLowerCase(), role, token],
    );

    // Get business info for email
    const business = await query("SELECT name FROM businesses WHERE id = $1", [
      businessId,
    ]);

    const businessName = business.rows[0].name;
    const inviteLink = `${process.env.CLIENT_URL || "http://localhost:3000"}/accept-invitation?token=${token}&email=${encodeURIComponent(email)}`;

    // Send invitation email
    await resend.emails.send({
      from: `"${businessName}" <onboarding@resend.dev>`,
      to: [email],
      subject: `Invitation to join ${businessName} on BiasharaPro`,
      html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>You're Invited!</title>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 500px; margin: 0 auto; padding: 20px; }
                        .header { background: #10b981; color: white; padding: 20px; text-align: center; }
                        .content { padding: 20px; }
                        .button { display: inline-block; padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                        .footer { text-align: center; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 20px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>You're Invited!</h1>
                        </div>
                        <div class="content">
                            <p>You've been invited to join <strong>${businessName}</strong> on BiasharaPro as a <strong>${role}</strong>.</p>
                            <p>Click the button below to accept the invitation and create your account:</p>
                            <p style="text-align: center;">
                                <a href="${inviteLink}" class="button">Accept Invitation</a>
                            </p>
                            <p>This invitation expires in 7 days.</p>
                            <p>If you didn't expect this invitation, you can ignore this email.</p>
                        </div>
                        <div class="footer">
                            <p>BiasharaPro - Business Management for Kenyan SMEs</p>
                        </div>
                    </div>
                </body>
                </html>
            `,
    });

    res.json({
      success: true,
      message: `Invitation sent to ${email}`,
      data: { token },
    });
  } catch (error) {
    console.error("Invite error:", error);
    res.status(500).json({ error: "Failed to send invitation" });
  }
});

// Remove team member (Owner only)
router.delete("/:id", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId, id: currentUserId } = req.user;

    if (id === currentUserId) {
      return res.status(400).json({ error: "Cannot remove yourself" });
    }

    const result = await query(
      "DELETE FROM users WHERE id = $1 AND business_id = $2 RETURNING email",
      [id, businessId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Team member not found" });
    }

    res.json({
      success: true,
      message: `Team member removed successfully`,
      data: { email: result.rows[0].email },
    });
  } catch (error) {
    console.error("Remove member error:", error);
    res.status(500).json({ error: "Failed to remove team member" });
  }
});

// Update team member role (Owner only)
router.put("/:id/role", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const { businessId, id: currentUserId } = req.user;

    if (!role || !["owner", "accountant", "cashier", "viewer"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    if (id === currentUserId) {
      return res.status(400).json({ error: "Cannot change your own role" });
    }

    const result = await query(
      "UPDATE users SET role = $1 WHERE id = $2 AND business_id = $3 RETURNING email, role",
      [role, id, businessId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Team member not found" });
    }

    res.json({
      success: true,
      message: `Role updated successfully`,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Update role error:", error);
    res.status(500).json({ error: "Failed to update role" });
  }
});

// Get invitation details (for registration page)
router.get("/invite/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const invitation = await query(
      `SELECT i.*, b.name as business_name 
             FROM invitations i
             JOIN businesses b ON i.business_id = b.id
             WHERE i.token = $1 AND i.expires_at > NOW()`,
      [token],
    );

    if (invitation.rows.length === 0) {
      return res.status(404).json({ error: "Invitation not found or expired" });
    }

    res.json({
      success: true,
      data: {
        email: invitation.rows[0].email,
        role: invitation.rows[0].role,
        businessName: invitation.rows[0].business_name,
        businessId: invitation.rows[0].business_id,
      },
    });
  } catch (error) {
    console.error("Get invitation error:", error);
    res.status(500).json({ error: "Failed to get invitation" });
  }
});

// Accept invitation (create user account)
router.post("/accept", async (req, res) => {
  try {
    const { token, firstName, lastName, password } = req.body;

    if (!token || !firstName || !lastName || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Start transaction
    await query("BEGIN");

    // Get invitation
    const invitation = await query(
      `SELECT i.*, b.name as business_name 
       FROM invitations i
       JOIN businesses b ON i.business_id = b.id
       WHERE i.token = $1 AND i.expires_at > NOW()`,
      [token],
    );

    if (invitation.rows.length === 0) {
      await query("ROLLBACK");
      return res.status(404).json({ error: "Invitation not found or expired" });
    }

    const invite = invitation.rows[0];

    // Check if user already exists
    const existingUser = await query("SELECT id FROM users WHERE email = $1", [
      invite.email,
    ]);

    if (existingUser.rows.length > 0) {
      await query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "User already exists with this email" });
    }

    // Hash password
    const bcrypt = require("bcrypt");
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const newUser = await query(
      `INSERT INTO users (business_id, email, first_name, last_name, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, email, first_name, last_name, role`,
      [
        invite.business_id,
        invite.email,
        firstName,
        lastName,
        passwordHash,
        invite.role,
      ],
    );

    // Delete the invitation
    await query("DELETE FROM invitations WHERE token = $1", [token]);

    await query("COMMIT");

    // Generate JWT token
    const jwt = require("jsonwebtoken");
    const authToken = jwt.sign(
      { 
        userId: newUser.rows[0].id, 
        businessId: invite.business_id, 
        role: invite.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      message: "Account created successfully",
      data: {
        user: newUser.rows[0],
        business: { id: invite.business_id, name: invite.business_name },
        token: authToken,
      },
    });
  } catch (error) {
    await query("ROLLBACK");
    console.error("Accept invitation error:", error);
    res.status(500).json({ error: "Failed to create account" });
  }
});
    // Delete invitation
    await query("DELETE FROM invitations WHERE token = $1", [token]);

    await query("COMMIT");

    // Generate JWT token
    const authToken = jwt.sign(
      {
        userId: newUser.rows[0].id,
        businessId: invite.business_id,
        role: invite.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      success: true,
      message: "Account created successfully",
      data: {
        user: newUser.rows[0],
        business: { id: invite.business_id, name: invite.business_name },
        token: authToken,
      },
    });
  } catch (error) {
    await query("ROLLBACK");
    console.error("Accept invitation error:", error);
    res.status(500).json({ error: "Failed to create account" });
  }
});

module.exports = router;
