const { query } = require('../config/database');

// Get main dashboard stats
const getDashboardStats = async (req, res) => {
    try {
        const { businessId } = req.user;
        
        // 1. Total Revenue from paid invoices
        const revenueResult = await query(
            `SELECT COALESCE(SUM(total_amount), 0) as total_revenue
             FROM invoices 
             WHERE business_id = $1 AND status = 'paid'`,
            [businessId]
        );
        
        // 2. Monthly Revenue (current month)
        const monthlyResult = await query(
            `SELECT COALESCE(SUM(total_amount), 0) as monthly_revenue,
                    COUNT(*) as invoice_count
             FROM invoices 
             WHERE business_id = $1 
               AND status = 'paid'
               AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
               AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)`,
            [businessId]
        );
        
        // 3. Weekly Revenue (current week)
        const weeklyResult = await query(
            `SELECT COALESCE(SUM(total_amount), 0) as weekly_revenue,
                    COUNT(*) as invoice_count
             FROM invoices 
             WHERE business_id = $1 
               AND status = 'paid'
               AND EXTRACT(WEEK FROM created_at) = EXTRACT(WEEK FROM CURRENT_DATE)
               AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)`,
            [businessId]
        );
        
        // 4. Outstanding Payments
        const outstandingResult = await query(
            `SELECT COALESCE(SUM(total_amount - amount_paid), 0) as total_outstanding,
                    COUNT(*) as outstanding_invoices
             FROM invoices 
             WHERE business_id = $1 
               AND status IN ('sent', 'draft') 
               AND total_amount > amount_paid`,
            [businessId]
        );
        
        // 5. Total Products
        const productsResult = await query(
            `SELECT COUNT(*) as total_products,
                    SUM(CASE WHEN stock_quantity <= reorder_level THEN 1 ELSE 0 END) as low_stock_count,
                    COALESCE(SUM(stock_quantity * buying_price), 0) as inventory_value
             FROM products 
             WHERE business_id = $1`,
            [businessId]
        );
        
        // 6. Total Customers (unique)
        const customersResult = await query(
            `SELECT COUNT(DISTINCT customer_email) as total_customers
             FROM invoices 
             WHERE business_id = $1 AND customer_email IS NOT NULL`,
            [businessId]
        );
        
        res.json({
            success: true,
            data: {
                revenue: {
                    total: parseFloat(revenueResult.rows[0].total_revenue) || 0,
                    monthly: parseFloat(monthlyResult.rows[0].monthly_revenue) || 0,
                    weekly: parseFloat(weeklyResult.rows[0].weekly_revenue) || 0
                },
                invoices: {
                    monthly_count: parseInt(monthlyResult.rows[0].invoice_count) || 0,
                    weekly_count: parseInt(weeklyResult.rows[0].invoice_count) || 0,
                    outstanding_amount: parseFloat(outstandingResult.rows[0].total_outstanding) || 0,
                    outstanding_count: parseInt(outstandingResult.rows[0].outstanding_invoices) || 0
                },
                inventory: {
                    total_products: parseInt(productsResult.rows[0].total_products) || 0,
                    low_stock_count: parseInt(productsResult.rows[0].low_stock_count) || 0,
                    inventory_value: parseFloat(productsResult.rows[0].inventory_value) || 0
                },
                customers: {
                    total: parseInt(customersResult.rows[0].total_customers) || 0
                }
            }
        });
        
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats', details: error.message });
    }
};

// Get top selling products
const getTopProducts = async (req, res) => {
    try {
        const { businessId } = req.user;
        const { limit = 10 } = req.query;
        
        const result = await query(
            `SELECT 
                p.id,
                p.name,
                p.sku,
                p.selling_price,
                p.stock_quantity,
                COALESCE(SUM(ii.quantity), 0) as total_sold,
                COALESCE(SUM(ii.total), 0) as total_revenue
             FROM products p
             LEFT JOIN invoice_items ii ON p.id = ii.product_id
             LEFT JOIN invoices i ON ii.invoice_id = i.id AND i.status = 'paid'
             WHERE p.business_id = $1
             GROUP BY p.id
             ORDER BY total_sold DESC
             LIMIT $2`,
            [businessId, limit]
        );
        
        res.json({
            success: true,
            data: result.rows
        });
        
    } catch (error) {
        console.error('Top products error:', error);
        res.status(500).json({ error: 'Failed to fetch top products' });
    }
};

// Get sales chart data
const getSalesChart = async (req, res) => {
    try {
        const { businessId } = req.user;
        const { days = 7 } = req.query;
        
        const result = await query(
            `SELECT 
                DATE(created_at) as date,
                COUNT(*) as invoice_count,
                COALESCE(SUM(total_amount), 0) as total_sales
             FROM invoices 
             WHERE business_id = $1 
               AND status = 'paid'
               AND created_at >= CURRENT_DATE - ($2 || ' days')::INTERVAL
             GROUP BY DATE(created_at)
             ORDER BY date ASC`,
            [businessId, days]
        );
        
        res.json({
            success: true,
            data: result.rows
        });
        
    } catch (error) {
        console.error('Sales chart error:', error);
        res.status(500).json({ error: 'Failed to fetch sales chart' });
    }
};

// Get low stock products
const getLowStock = async (req, res) => {
    try {
        const { businessId } = req.user;
        
        const result = await query(
            `SELECT id, name, sku, stock_quantity, reorder_level, selling_price
             FROM products 
             WHERE business_id = $1 
               AND stock_quantity <= reorder_level
             ORDER BY stock_quantity ASC`,
            [businessId]
        );
        
        res.json({
            success: true,
            data: result.rows
        });
        
    } catch (error) {
        console.error('Low stock error:', error);
        res.status(500).json({ error: 'Failed to fetch low stock' });
    }
};

// Get recent transactions
const getRecentTransactions = async (req, res) => {
    try {
        const { businessId } = req.user;
        
        const result = await query(
            `SELECT id, invoice_number, customer_name, total_amount, status, created_at
             FROM invoices 
             WHERE business_id = $1
             ORDER BY created_at DESC
             LIMIT 10`,
            [businessId]
        );
        
        res.json({
            success: true,
            data: result.rows
        });
        
    } catch (error) {
        console.error('Recent transactions error:', error);
        res.status(500).json({ error: 'Failed to fetch recent transactions' });
    }
};

module.exports = {
    getDashboardStats,
    getSalesChart,
    getTopProducts,
    getLowStock,
    getRecentTransactions
};