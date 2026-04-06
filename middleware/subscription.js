const { query } = require("../config/database");

const checkSubscription = async (req, res, next) => {
  try {
    const { businessId } = req.user;

    // Get business subscription info
    const result = await query(
      `SELECT subscription_status, trial_ends_at, subscription_plan 
             FROM businesses 
             WHERE id = $1`,
      [businessId],
    );

    if (result.rows.length === 0) {
      return next();
    }

    const business = result.rows[0];

    // Check if trial has expired
    if (business.subscription_status === "trial" && business.trial_ends_at) {
      const trialEnd = new Date(business.trial_ends_at);
      const now = new Date();

      if (now > trialEnd) {
        // Trial expired - update status
        await query(
          `UPDATE businesses 
                     SET subscription_status = 'expired' 
                     WHERE id = $1`,
          [businessId],
        );

        return res.status(403).json({
          error:
            "Your free trial has expired. Please subscribe to continue using BiasharaPro.",
          code: "TRIAL_EXPIRED",
          redirect: "/subscription",
        });
      }

      // Calculate days remaining
      const daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
      res.setHeader("X-Trial-Days-Remaining", daysRemaining);
    }

    // Check if subscription is expired
    if (business.subscription_status === "expired") {
      return res.status(403).json({
        error: "Your subscription has expired. Please renew to continue.",
        code: "SUBSCRIPTION_EXPIRED",
        redirect: "/subscription",
      });
    }

    next();
  } catch (error) {
    console.error("Subscription check error:", error);
    next();
  }
};

module.exports = { checkSubscription };
