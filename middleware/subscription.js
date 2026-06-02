const { query } = require("../config/database");

const checkSubscription = async (req, res, next) => {
  // CRITICAL: Skip ALL checks for payment and status endpoints
  // This must be the FIRST thing in this function
  const isPaymentEndpoint =
    req.path === "/pay" ||
    req.path === "/status" ||
    req.path.includes("/status") ||
    req.url === "/pay" ||
    req.url.includes("/pay");

  if (isPaymentEndpoint) {
    console.log(
      `🚫 [SUBSCRIBE] SKIPPING - Payment endpoint: ${req.method} ${req.path}`,
    );
    return next();
  }

  console.log(`🔍 [SUBSCRIBE] Checking: ${req.method} ${req.path}`);

  try {
    // Skip for admin users
    if (req.user && req.user.role === "admin") {
      console.log(`👑 [SUBSCRIBE] Admin user - skipping`);
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
    console.log(
      `📊 [SUBSCRIBE] Business ${businessId} status: ${business.subscription_status}`,
    );

    // Check if trial has expired
    if (business.subscription_status === "trial" && business.trial_ends_at) {
      const trialEnd = new Date(business.trial_ends_at);
      const now = new Date();

      if (now > trialEnd) {
        await query(
          `UPDATE businesses SET subscription_status = 'expired' WHERE id = $1`,
          [businessId],
        );
        console.log(`❌ [SUBSCRIBE] Trial expired - blocking`);
        return res.status(403).json({
          error: "Your free trial has expired. Please subscribe to continue.",
          code: "TRIAL_EXPIRED",
          redirect: "/subscription",
        });
      }
    }

    // Check if subscription is expired
    if (business.subscription_status === "expired") {
      console.log(`❌ [SUBSCRIBE] Subscription expired - blocking`);
      return res.status(403).json({
        error: "Your subscription has expired. Please renew.",
        code: "SUBSCRIPTION_EXPIRED",
        redirect: "/subscription",
      });
    }

    console.log(`✅ [SUBSCRIBE] Access granted`);
    next();
  } catch (error) {
    console.error("[SUBSCRIBE] Error:", error);
    next();
  }
};

module.exports = { checkSubscription };
