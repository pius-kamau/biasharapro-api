const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const {
    getSalesReport,
    getInventoryReport,
    getInvoicesReport,
    getProductsReport
} = require('../controllers/reportController');

// All report routes require authentication
router.use(authenticate);

// Report endpoints
router.get('/sales', authorize('owner', 'accountant'), getSalesReport);
router.get('/inventory', authorize('owner', 'accountant'), getInventoryReport);
router.get('/invoices', authorize('owner', 'accountant'), getInvoicesReport);
router.get('/products', authorize('owner', 'accountant'), getProductsReport);

module.exports = router;