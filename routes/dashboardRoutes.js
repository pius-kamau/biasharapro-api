const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
    getDashboardStats,
    getSalesChart,
    getTopProducts,
    getLowStock,
    getRecentTransactions
} = require('../controllers/dashboardController');

router.use(authenticate);

router.get('/stats', getDashboardStats);
router.get('/sales-chart', getSalesChart);
router.get('/top-products', getTopProducts);
router.get('/low-stock', getLowStock);
router.get('/recent-transactions', getRecentTransactions);

module.exports = router;