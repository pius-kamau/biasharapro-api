const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { query } = require("../config/database");

// Get subscription info
router.get("/info", authenticate, async (req, res) => {
  try {
    const { businessId } = req.user;

    const result = await query(
      `SELECT subscription_status, trial_ends_at, subscription_plan 
             FROM businesses 
             WHERE id = $1`,
      [businessId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Business not found" });
    }

    const business = result.rows[0];
    const now = new Date();
    const trialEnds = business.trial_ends_at
      ? new Date(business.trial_ends_at)
      : null;
    let trialDaysLeft = 0;

    if (trialEnds && now < trialEnds) {
      trialDaysLeft = Math.ceil((trialEnds - now) / (1000 * 60 * 60 * 24));
    }

    res.json({
      success: true,
      data: {
        status: business.subscription_status || "trial",
        trial_days_left: trialDaysLeft,
        trial_ends_at: business.trial_ends_at,
        current_plan: business.subscription_plan || "starter",
      },
    });
  } catch (error) {
    console.error("Subscription info error:", error);
    res.status(500).json({ error: "Failed to get subscription info" });
  }
});

module.exports = router;
