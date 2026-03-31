require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { query } = require('./config/database');

// Import routes
const authRoutes = require('./routes/authRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const productRoutes = require('./routes/productRoutes'); 
const dashboardRoutes = require('./routes/dashboardRoutes');
const mpesaRoutes = require('./routes/mpesaRoutes');
const reportRoutes = require('./routes/reportRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// =====================================================
// HEALTH CHECK ROUTE
// =====================================================
app.get('/', (req, res) => {
    res.json({
        message: 'BiasharaPro API is running!',
        version: '1.0.0',
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// =====================================================
// DATABASE TEST ROUTE
// =====================================================
app.get('/api/test-db', async (req, res) => {
    try {
        const result = await query('SELECT NOW() as current_time');
        res.json({
            success: true,
            message: 'Database connected successfully',
            currentTime: result.rows[0].current_time
        });
    } catch (error) {
        console.error('Database test error:', error);
        res.status(500).json({
            success: false,
            error: 'Database connection failed',
            details: error.message
        });
    }
});

// =====================================================
// API ROUTES
// =====================================================
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/mpesa', mpesaRoutes);
app.use('/api/reports', reportRoutes);
// =====================================================
// DEBUG ROUTES (Temporary - Remove after testing)
// =====================================================
app.get('/api/debug/users', async (req, res) => {
    try {
        const result = await query('SELECT id, email, first_name, last_name, role FROM users');
        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/debug/businesses', async (req, res) => {
    try {
        const result = await query('SELECT id, name, email, kra_pin, status FROM businesses');
        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =====================================================
// M-PESA WEBHOOK CALLBACK (Public - No Auth)
// =====================================================
app.post('/api/mpesa/callback', express.json(), async (req, res) => {
    try {
        const callbackData = req.body;
        console.log('M-Pesa Callback received:', JSON.stringify(callbackData, null, 2));
        
        const stkCallback = callbackData.Body?.stkCallback;
        
        if (stkCallback) {
            const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } = stkCallback;
            
            if (ResultCode === 0) {
                // Payment successful
                const metadata = {};
                if (CallbackMetadata?.Item) {
                    CallbackMetadata.Item.forEach(item => {
                        metadata[item.Name] = item.Value;
                    });
                }
                
                console.log(`✅ Payment successful for ${CheckoutRequestID}`);
                console.log(`   Receipt: ${metadata.MpesaReceiptNumber}`);
                console.log(`   Amount: ${metadata.Amount}`);
                
                // Update transaction in database
                const transaction = await query(
                    `UPDATE transactions 
                     SET status = 'completed', 
                         mpesa_receipt_number = $1,
                         transaction_date = CURRENT_TIMESTAMP
                     WHERE mpesa_receipt_number = $2
                     RETURNING invoice_id, amount`,
                    [metadata.MpesaReceiptNumber, CheckoutRequestID]
                );
                
                if (transaction.rows.length > 0) {
                    const { invoice_id, amount } = transaction.rows[0];
                    
                    // Update invoice
                    await query(
                        `UPDATE invoices 
                         SET amount_paid = amount_paid + $1,
                             status = CASE 
                                 WHEN amount_paid + $1 >= total_amount THEN 'paid'
                                 ELSE status
                             END
                         WHERE id = $2`,
                        [amount, invoice_id]
                    );
                    
                    console.log(`✅ Invoice ${invoice_id} updated with payment of ${amount}`);
                }
            } else {
                console.log(`❌ Payment failed: ${ResultDesc}`);
                
                // Update transaction as failed
                await query(
                    `UPDATE transactions 
                     SET status = 'failed', 
                         notes = $1
                     WHERE mpesa_receipt_number = $2`,
                    [ResultDesc, CheckoutRequestID]
                );
            }
        }
        
        res.json({ ResultCode: 0, ResultDesc: 'Success' });
        
    } catch (error) {
        console.error('Callback error:', error);
        res.json({ ResultCode: 1, ResultDesc: 'Failed' });
    }
});
// =====================================================
// ERROR HANDLING
// =====================================================
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// =====================================================
// START SERVER
// =====================================================
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/`);
    console.log(`🗄️  Database test: http://localhost:${PORT}/api/test-db`);
    console.log(`🔐 Register: POST http://localhost:${PORT}/api/auth/register`);
    console.log(`🔐 Login: POST http://localhost:${PORT}/api/auth/login`);
    console.log(`📦 Products: GET/POST http://localhost:${PORT}/api/products`);
    console.log(`🐛 Debug users: http://localhost:${PORT}/api/debug/users`);
    console.log(`🐛 Debug businesses: http://localhost:${PORT}/api/debug/businesses`);
});