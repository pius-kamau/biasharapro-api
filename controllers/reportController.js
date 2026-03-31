const { query } = require('../config/database');
const reportService = require('../services/reportService');

// Generate Sales Report
const getSalesReport = async (req, res) => {
    try {
        const { businessId } = req.user;
        const { startDate, endDate, format = 'json' } = req.query;
        
        let dateFilter = '';
        let params = [businessId];
        
        if (startDate && endDate) {
            dateFilter = ' AND created_at BETWEEN $2 AND $3';
            params.push(startDate, endDate);
        }
        
        const result = await query(
            `SELECT invoice_number, customer_name, total_amount, vat_amount, status, created_at
             FROM invoices
             WHERE business_id = $1 ${dateFilter}
             ORDER BY created_at DESC`,
            params
        );
        
        const businessInfo = await query(
            'SELECT name, email, kra_pin FROM businesses WHERE id = $1',
            [businessId]
        );
        
        if (format === 'excel') {
            const buffer = await reportService.generateExcelReport(result.rows, 'sales', businessInfo.rows[0].name);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=sales_report_${Date.now()}.xlsx`);
            return res.send(buffer);
        } else if (format === 'pdf') {
            const buffer = await reportService.generatePDFReport(result.rows, 'sales', businessInfo.rows[0].name, businessInfo.rows[0]);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=sales_report_${Date.now()}.pdf`);
            return res.send(buffer);
        }
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length,
            total: result.rows.reduce((sum, i) => sum + parseFloat(i.total_amount), 0)
        });
        
    } catch (error) {
        console.error('Sales report error:', error);
        res.status(500).json({ error: 'Failed to generate sales report', details: error.message });
    }
};

// Generate Inventory Report
const getInventoryReport = async (req, res) => {
    try {
        const { businessId } = req.user;
        const { format = 'json' } = req.query;
        
        const result = await query(
            `SELECT id, name, sku, buying_price, selling_price, stock_quantity, reorder_level
             FROM products
             WHERE business_id = $1
             ORDER BY name`,
            [businessId]
        );
        
        const businessInfo = await query(
            'SELECT name, email, kra_pin FROM businesses WHERE id = $1',
            [businessId]
        );
        
        if (format === 'excel') {
            const buffer = await reportService.generateExcelReport(result.rows, 'inventory', businessInfo.rows[0].name);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=inventory_report_${Date.now()}.xlsx`);
            return res.send(buffer);
        } else if (format === 'pdf') {
            const buffer = await reportService.generatePDFReport(result.rows, 'inventory', businessInfo.rows[0].name, businessInfo.rows[0]);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=inventory_report_${Date.now()}.pdf`);
            return res.send(buffer);
        }
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
        
    } catch (error) {
        console.error('Inventory report error:', error);
        res.status(500).json({ error: 'Failed to generate inventory report', details: error.message });
    }
};

// Generate Invoices Report
const getInvoicesReport = async (req, res) => {
    try {
        const { businessId } = req.user;
        const { startDate, endDate, format = 'json' } = req.query;
        
        let dateFilter = '';
        let params = [businessId];
        
        if (startDate && endDate) {
            dateFilter = ' AND created_at BETWEEN $2 AND $3';
            params.push(startDate, endDate);
        }
        
        const result = await query(
            `SELECT invoice_number, customer_name, total_amount, amount_paid, status, created_at
             FROM invoices
             WHERE business_id = $1 ${dateFilter}
             ORDER BY created_at DESC`,
            params
        );
        
        const businessInfo = await query(
            'SELECT name, email, kra_pin FROM businesses WHERE id = $1',
            [businessId]
        );
        
        if (format === 'excel') {
            const buffer = await reportService.generateExcelReport(result.rows, 'invoices', businessInfo.rows[0].name);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=invoices_report_${Date.now()}.xlsx`);
            return res.send(buffer);
        } else if (format === 'pdf') {
            const buffer = await reportService.generatePDFReport(result.rows, 'invoices', businessInfo.rows[0].name, businessInfo.rows[0]);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=invoices_report_${Date.now()}.pdf`);
            return res.send(buffer);
        }
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
        
    } catch (error) {
        console.error('Invoices report error:', error);
        res.status(500).json({ error: 'Failed to generate invoices report', details: error.message });
    }
};

// Generate Products Report
const getProductsReport = async (req, res) => {
    try {
        const { businessId } = req.user;
        const { format = 'json' } = req.query;
        
        const result = await query(
            `SELECT name, sku, selling_price, stock_quantity, reorder_level
             FROM products
             WHERE business_id = $1
             ORDER BY name`,
            [businessId]
        );
        
        const businessInfo = await query(
            'SELECT name, email, kra_pin FROM businesses WHERE id = $1',
            [businessId]
        );
        
        if (format === 'excel') {
            const buffer = await reportService.generateExcelReport(result.rows, 'products', businessInfo.rows[0].name);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=products_report_${Date.now()}.xlsx`);
            return res.send(buffer);
        }
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
        
    } catch (error) {
        console.error('Products report error:', error);
        res.status(500).json({ error: 'Failed to generate products report', details: error.message });
    }
};

module.exports = {
    getSalesReport,
    getInventoryReport,
    getInvoicesReport,
    getProductsReport
};