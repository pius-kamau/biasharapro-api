const jwt = require("jsonwebtoken");
const { query } = require("../config/database");

const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await query(
      "SELECT id, business_id, role, is_active FROM users WHERE id = $1",
      [decoded.userId],
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ error: "User not found or inactive" });
    }

    req.user = {
      id: result.rows[0].id,
      businessId: result.rows[0].business_id,
      role: result.rows[0].role,
    };

    // Check subscription status (skip for admin)
    if (req.user.role !== "admin") {
      const business = await query(
        "SELECT subscription_status, trial_ends_at FROM businesses WHERE id = $1",
        [req.user.businessId],
      );

      if (business.rows.length > 0) {
        const status = business.rows[0].subscription_status;
        const trialEnds = business.rows[0].trial_ends_at;

        if (status === "expired") {
          return res.status(403).json({
            error: "Your subscription has expired. Please renew.",
            code: "SUBSCRIPTION_EXPIRED",
          });
        }

        if (
          status === "trial" &&
          trialEnds &&
          new Date(trialEnds) < new Date()
        ) {
          await query(
            "UPDATE businesses SET subscription_status = $1 WHERE id = $2",
            ["expired", req.user.businessId],
          );
          return res.status(403).json({
            error: "Your free trial has expired. Please subscribe.",
            code: "TRIAL_EXPIRED",
          });
        }
      }
    }

    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(401).json({ error: "Invalid token" });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
};

module.exports = { authenticate, authorize };
