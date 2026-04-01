const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { query } = require("../config/database");

// Get dashboard stats
const getDashboardStats = async (req, res) => {
  try {
    const { businessId } = req.user;

    // Revenue stats
    const revenueResult = await query(
      `SELECT COALESCE(SUM(total_amount), 0) as total_revenue
             FROM invoices WHERE business_id = $1 AND status = 'paid'`,
      [businessId],
    );

    const monthlyResult = await query(
      `SELECT COALESCE(SUM(total_amount), 0) as monthly_revenue
             FROM invoices 
             WHERE business_id = $1 AND status = 'paid'
               AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)`,
      [businessId],
    );

    // Invoice stats
    const invoicesResult = await query(
      `SELECT COUNT(*) as monthly_count
             FROM invoices 
             WHERE business_id = $1 
               AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)`,
      [businessId],
    );

    // Inventory stats
    const productsResult = await query(
      `SELECT COUNT(*) as total_products,
                    SUM(CASE WHEN stock_quantity <= reorder_level THEN 1 ELSE 0 END) as low_stock_count,
                    COALESCE(SUM(stock_quantity * buying_price), 0) as inventory_value
             FROM products WHERE business_id = $1`,
      [businessId],
    );

    // Customer count
    const customersResult = await query(
      `SELECT COUNT(DISTINCT customer_email) as total_customers
             FROM invoices WHERE business_id = $1 AND customer_email IS NOT NULL`,
      [businessId],
    );

    res.json({
      success: true,
      data: {
        revenue: {
          total: parseFloat(revenueResult.rows[0].total_revenue) || 0,
          monthly: parseFloat(monthlyResult.rows[0].monthly_revenue) || 0,
          weekly: parseFloat(monthlyResult.rows[0].monthly_revenue) / 4 || 0,
        },
        invoices: {
          monthly_count: parseInt(invoicesResult.rows[0].monthly_count) || 0,
          outstanding_count: 0,
          outstanding_amount: 0,
        },
        inventory: {
          total_products: parseInt(productsResult.rows[0].total_products) || 0,
          low_stock_count:
            parseInt(productsResult.rows[0].low_stock_count) || 0,
          inventory_value:
            parseFloat(productsResult.rows[0].inventory_value) || 0,
        },
        customers: {
          total: parseInt(customersResult.rows[0].total_customers) || 0,
        },
      },
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
};

// Get recent activity
const getRecentActivity = async (req, res) => {
  try {
    const { businessId } = req.user;
    const result = await query(
      `(SELECT 'invoice' as type, invoice_number as reference, total_amount, created_at as date
              FROM invoices 
              WHERE business_id = $1
              ORDER BY created_at DESC LIMIT 5)
              UNION ALL
              (SELECT 'payment' as type, transaction_reference as reference, amount, transaction_date as date
               FROM transactions 
               WHERE business_id = $1 AND status = 'completed'
               ORDER BY transaction_date DESC LIMIT 5)
              ORDER BY date DESC LIMIT 10`,
      [businessId],
    );

    const activities = result.rows.map((row) => ({
      description:
        row.type === "invoice"
          ? `Invoice ${row.reference} - KES ${parseFloat(row.total_amount).toLocaleString()}`
          : `Payment of KES ${parseFloat(row.amount).toLocaleString()} received`,
      type: row.type,
      date: row.date,
      reference: row.reference,
    }));

    res.json({ success: true, data: activities });
  } catch (error) {
    console.error("Recent activity error:", error);
    res.status(500).json({ error: "Failed to fetch recent activity" });
  }
};

// Get low stock products
const getLowStock = async (req, res) => {
  try {
    const { businessId } = req.user;
    const result = await query(
      `SELECT id, name, sku, stock_quantity, reorder_level, selling_price
             FROM products
             WHERE business_id = $1 AND stock_quantity <= reorder_level
             ORDER BY stock_quantity ASC`,
      [businessId],
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Low stock error:", error);
    res.status(500).json({ error: "Failed to fetch low stock" });
  }
};

// Get sales chart data
const getSalesChart = async (req, res) => {
  try {
    const { businessId } = req.user;
    const { days = 30 } = req.query;

    const result = await query(
      `SELECT DATE(created_at) as date,
                    COALESCE(SUM(total_amount), 0) as total_sales
             FROM invoices 
             WHERE business_id = $1 
               AND status = 'paid'
               AND created_at >= CURRENT_DATE - ($2 || ' days')::INTERVAL
             GROUP BY DATE(created_at)
             ORDER BY date ASC`,
      [businessId, days],
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Sales chart error:", error);
    res.status(500).json({ error: "Failed to fetch sales chart" });
  }
};

// Get top products
const getTopProducts = async (req, res) => {
  try {
    const { businessId } = req.user;
    const { limit = 5 } = req.query;

    const result = await query(
      `SELECT p.id, p.name, p.sku, COALESCE(SUM(ii.quantity), 0) as total_sold,
                    COALESCE(SUM(ii.total), 0) as total_revenue
             FROM products p
             LEFT JOIN invoice_items ii ON p.id = ii.product_id
             LEFT JOIN invoices i ON ii.invoice_id = i.id AND i.status = 'paid'
             WHERE p.business_id = $1
             GROUP BY p.id
             ORDER BY total_sold DESC
             LIMIT $2`,
      [businessId, limit],
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Top products error:", error);
    res.status(500).json({ error: "Failed to fetch top products" });
  }
};

// Routes
router.get("/stats", authenticate, getDashboardStats);
router.get("/recent-activity", authenticate, getRecentActivity);
router.get("/low-stock", authenticate, getLowStock);
router.get("/sales-chart", authenticate, getSalesChart);
router.get("/top-products", authenticate, getTopProducts);

module.exports = router;
