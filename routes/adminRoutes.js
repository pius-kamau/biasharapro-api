const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { query } = require("../config/database");

// Get admin dashboard stats
router.get("/stats", authenticate, authorize("admin"), async (req, res) => {
  try {
    // Total businesses
    const totalBusinesses = await query("SELECT COUNT(*) FROM businesses");

    // Active businesses
    const activeBusinesses = await query(
      "SELECT COUNT(*) FROM businesses WHERE status = 'active'",
    );

    // Pending businesses
    const pendingBusinesses = await query(
      "SELECT COUNT(*) FROM businesses WHERE status = 'pending'",
    );

    // Suspended businesses
    const suspendedBusinesses = await query(
      "SELECT COUNT(*) FROM businesses WHERE status = 'suspended'",
    );

    // Total users
    const totalUsers = await query("SELECT COUNT(*) FROM users");

    // Total invoices
    const totalInvoices = await query("SELECT COUNT(*) FROM invoices");

    // Total revenue (from paid invoices)
    const totalRevenue = await query(
      "SELECT COALESCE(SUM(total_amount), 0) FROM invoices WHERE status = 'paid'",
    );

    // Monthly revenue
    const monthlyRevenue = await query(
      "SELECT COALESCE(SUM(total_amount), 0) FROM invoices WHERE status = 'paid' AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)",
    );

    res.json({
      success: true,
      data: {
        totalBusinesses: parseInt(totalBusinesses.rows[0].count),
        activeBusinesses: parseInt(activeBusinesses.rows[0].count),
        pendingBusinesses: parseInt(pendingBusinesses.rows[0].count),
        suspendedBusinesses: parseInt(suspendedBusinesses.rows[0].count),
        totalUsers: parseInt(totalUsers.rows[0].count),
        totalInvoices: parseInt(totalInvoices.rows[0].count),
        totalRevenue: parseFloat(totalRevenue.rows[0].coalesce),
        monthlyRevenue: parseFloat(monthlyRevenue.rows[0].coalesce),
      },
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    res.status(500).json({ error: "Failed to fetch admin stats" });
  }
});

// Get all businesses with details
router.get(
  "/businesses",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const result = await query(
        `SELECT b.*,
                    COUNT(DISTINCT u.id) as user_count,
                    COUNT(DISTINCT i.id) as invoice_count,
                    COALESCE(SUM(i.total_amount), 0) as total_revenue
             FROM businesses b
             LEFT JOIN users u ON b.id = u.business_id
             LEFT JOIN invoices i ON b.id = i.business_id AND i.status = 'paid'
             GROUP BY b.id
             ORDER BY b.created_at DESC`,
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Get businesses error:", error);
      res.status(500).json({ error: "Failed to fetch businesses" });
    }
  },
);

// Update business status
router.put(
  "/businesses/:id/status",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!["active", "pending", "suspended"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      await query("UPDATE businesses SET status = $1 WHERE id = $2", [
        status,
        id,
      ]);

      res.json({
        success: true,
        message: `Business status updated to ${status}`,
      });
    } catch (error) {
      console.error("Update business status error:", error);
      res.status(500).json({ error: "Failed to update business status" });
    }
  },
);

// Get single business details
router.get(
  "/businesses/:id",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const businessResult = await query(
        `SELECT b.*,
                    COUNT(DISTINCT u.id) as user_count,
                    COUNT(DISTINCT i.id) as invoice_count,
                    COALESCE(SUM(i.total_amount), 0) as total_revenue
             FROM businesses b
             LEFT JOIN users u ON b.id = u.business_id
             LEFT JOIN invoices i ON b.id = i.business_id AND i.status = 'paid'
             WHERE b.id = $1
             GROUP BY b.id`,
        [id],
      );

      if (businessResult.rows.length === 0) {
        return res.status(404).json({ error: "Business not found" });
      }

      // Get users for this business
      const usersResult = await query(
        "SELECT id, email, first_name, last_name, role, is_active FROM users WHERE business_id = $1",
        [id],
      );

      // Get recent invoices
      const invoicesResult = await query(
        "SELECT id, invoice_number, total_amount, status, created_at FROM invoices WHERE business_id = $1 ORDER BY created_at DESC LIMIT 10",
        [id],
      );

      res.json({
        success: true,
        data: {
          business: businessResult.rows[0],
          users: usersResult.rows,
          invoices: invoicesResult.rows,
        },
      });
    } catch (error) {
      console.error("Get business details error:", error);
      res.status(500).json({ error: "Failed to fetch business details" });
    }
  },
);

module.exports = router;
