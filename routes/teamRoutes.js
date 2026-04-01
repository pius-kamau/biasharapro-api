const express = require("express");
const router = express.Router();
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

// Invite team member
router.post("/invite", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { email, role } = req.body;
    const { businessId } = req.user;

    if (!email || !role) {
      return res.status(400).json({ error: "Email and role required" });
    }

    // Check if user already exists
    const existingUser = await query("SELECT id FROM users WHERE email = $1", [
      email,
    ]);

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Create invitation token
    const token = require("crypto").randomBytes(32).toString("hex");

    // Store invitation (you'll need an invitations table)
    await query(
      `INSERT INTO invitations (business_id, email, role, token, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')`,
      [businessId, email, role, token],
    );

    // Get business info for email
    const business = await query("SELECT name FROM businesses WHERE id = $1", [
      businessId,
    ]);

    // Send invitation email
    const inviteLink = `${process.env.CLIENT_URL}/register?token=${token}&email=${email}`;

    await resend.emails.send({
      from: `"${business.rows[0].name}" <onboarding@resend.dev>`,
      to: [email],
      subject: `Invitation to join ${business.rows[0].name} on BiasharaPro`,
      html: `
                <h1>You've been invited!</h1>
                <p>You've been invited to join ${business.rows[0].name} on BiasharaPro as a ${role}.</p>
                <p><a href="${inviteLink}">Click here to accept the invitation</a></p>
                <p>This link expires in 7 days.</p>
            `,
    });

    res.json({ success: true, message: "Invitation sent successfully" });
  } catch (error) {
    console.error("Invite error:", error);
    res.status(500).json({ error: "Failed to send invitation" });
  }
});

// Remove team member
router.delete("/:id", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId, id: currentUserId } = req.user;

    if (id === currentUserId) {
      return res.status(400).json({ error: "Cannot remove yourself" });
    }

    await query("DELETE FROM users WHERE id = $1 AND business_id = $2", [
      id,
      businessId,
    ]);

    res.json({ success: true, message: "Team member removed" });
  } catch (error) {
    console.error("Remove member error:", error);
    res.status(500).json({ error: "Failed to remove team member" });
  }
});

module.exports = router;
