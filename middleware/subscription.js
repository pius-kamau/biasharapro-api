const { query } = require("../config/database");

const checkSubscription = async (req, res, next) => {
  // Skip subscription check for payment and callback endpoints
  const skipPaths = ["/pay", "/callback", "/status"];
  if (skipPaths.some((path) => req.path.includes(path))) {
    console.log(`Skipping subscription check for: ${req.method} ${req.path}`);
    return next();
  }

  try {
    // Skip for admin users
    if (req.user && req.user.role === "admin") {
      return next();
    }

    const { businessId } = req.user;

    const result = await query(
      `SELECT subscription_status, trial_ends_at 
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
        await query(
          `UPDATE businesses SET subscription_status = 'expired' WHERE id = $1`,
          [businessId],
        );

        return res.status(403).json({
          error: "Your free trial has expired. Please subscribe to continue.",
          code: "TRIAL_EXPIRED",
          redirect: "/subscription",
        });
      }
    }

    // Check if subscription is expired
    if (business.subscription_status === "expired") {
      return res.status(403).json({
        error: "Your subscription has expired. Please renew.",
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
