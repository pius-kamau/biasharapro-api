// middleware/subscriptionLimits.js
const { query } = require("../config/database");

const checkPlanLimit = async (req, res, next) => {
  try {
    const { businessId } = req.user;

    // Get business subscription plan
    const result = await query(
      "SELECT subscription_plan FROM businesses WHERE id = $1",
      [businessId],
    );

    const plan = result.rows[0]?.subscription_plan || "starter";

    // Check product limits
    if (req.path.includes("/products") && req.method === "POST") {
      const productCount = await query(
        "SELECT COUNT(*) FROM products WHERE business_id = $1",
        [businessId],
      );

      const limits = {
        starter: 500,
        business: Infinity,
        enterprise: Infinity,
      };

      if (productCount.rows[0].count >= limits[plan]) {
        return res.status(403).json({
          error: `Your ${plan} plan allows only ${limits[plan]} products. Upgrade to add more.`,
        });
      }
    }

    // Check invoice limits (monthly)
    if (req.path.includes("/invoices") && req.method === "POST") {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const invoiceCount = await query(
        `SELECT COUNT(*) FROM invoices 
                 WHERE business_id = $1 
                 AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)`,
        [businessId],
      );

      const limits = {
        starter: 100,
        business: Infinity,
        enterprise: Infinity,
      };

      if (invoiceCount.rows[0].count >= limits[plan]) {
        return res.status(403).json({
          error: `Your ${plan} plan allows only ${limits[plan]} invoices per month. Upgrade to create more.`,
        });
      }
    }

    // Check team member limits
    if (req.path.includes("/team") && req.method === "POST") {
      const userCount = await query(
        "SELECT COUNT(*) FROM users WHERE business_id = $1",
        [businessId],
      );

      const limits = {
        starter: 1,
        business: 5,
        enterprise: Infinity,
      };

      if (userCount.rows[0].count >= limits[plan]) {
        return res.status(403).json({
          error: `Your ${plan} plan allows only ${limits[plan]} team members. Upgrade to add more.`,
        });
      }
    }

    next();
  } catch (error) {
    console.error("Plan limit check error:", error);
    next();
  }
};

module.exports = { checkPlanLimit };
