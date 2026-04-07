// Force IPv4 for all network connections
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { query } = require("./config/database");

// Import routes
const authRoutes = require("./routes/authRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const productRoutes = require("./routes/productRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const mpesaRoutes = require("./routes/mpesaRoutes");
const reportRoutes = require("./routes/reportRoutes");
const teamRoutes = require("./routes/teamRoutes");
const adminRoutes = require("./routes/adminRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const { checkSubscription } = require("./middleware/subscription");

// Import middleware
const rateLimiter = require("./middleware/rateLimiter");
const { authenticate } = require("./middleware/auth");
const { checkSubscription } = require("./middleware/subscription");

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy (required for rate limiting behind Render's load balancer)
app.set("trust proxy", 1);

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
// HEALTH CHECK ROUTE (No rate limit)
// =====================================================
app.get("/", (req, res) => {
  res.json({
    message: "BiasharaPro API is running!",
    version: "1.0.0",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// =====================================================
// DATABASE TEST ROUTE (No rate limit)
// =====================================================
app.get("/api/test-db", async (req, res) => {
  try {
    const result = await query("SELECT NOW() as current_time");
    res.json({
      success: true,
      message: "Database connected successfully",
      currentTime: result.rows[0].current_time,
    });
  } catch (error) {
    console.error("Database test error:", error);
    res.status(500).json({
      success: false,
      error: "Database connection failed",
      details: error.message,
    });
  }
});

// =====================================================
// RATE LIMITING (Applied to API routes)
// =====================================================
// Apply general rate limiting to all API routes
app.use("/api/", rateLimiter.apiLimiter);
app.use("/api/", rateLimiter.slowDownLimiter);

// =====================================================
// API ROUTES (Public - No Auth)
// =====================================================
app.use("/api/auth", authRoutes);

// =====================================================
// API ROUTES (Protected - With Auth & Subscription Check)
// =====================================================
// Products routes
app.use("/api/products", authenticate, checkSubscription, productRoutes);

// Invoices routes
app.use("/api/invoices", authenticate, checkSubscription, invoiceRoutes);

// Dashboard routes
app.use("/api/dashboard", authenticate, checkSubscription, dashboardRoutes);

// M-Pesa routes (payment routes need auth but subscription check is skipped for payment)
app.use("/api/mpesa", authenticate, mpesaRoutes);

// Reports routes
app.use("/api/reports", authenticate, checkSubscription, reportRoutes);

// Team routes
app.use("/api/team", authenticate, checkSubscription, teamRoutes);

// Admin routes (no subscription check for admin)
app.use("/api/admin", authenticate, adminRoutes);

// Subscription routes (no subscription check - they need to access even when expired)
app.use("/api/subscription", authenticate, subscriptionRoutes);

// Specific route limiters (applied after routes are defined)
app.use("/api/auth/login", rateLimiter.authLimiter);
app.use("/api/auth/register", rateLimiter.authLimiter);
app.use("/api/mpesa/pay", rateLimiter.mpesaLimiter);
app.use("/api/invoices", rateLimiter.invoiceSlowDown);

// Keep-alive route
app.get("/api/keep-alive", async (req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "alive", timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: "error", error: error.message });
  }
});

// =====================================================
// DEBUG ROUTES (Temporary - Remove after testing)
// =====================================================
app.get("/api/debug/users", async (req, res) => {
  try {
    const result = await query(
      "SELECT id, email, first_name, last_name, role FROM users",
    );
    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/debug/businesses", async (req, res) => {
  try {
    const result = await query(
      "SELECT id, name, email, kra_pin, status FROM businesses",
    );
    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// M-PESA WEBHOOK CALLBACK (Public - No Auth, No Rate Limit)
// =====================================================
app.post("/api/mpesa/callback", express.json(), async (req, res) => {
  try {
    const callbackData = req.body;
    console.log(
      "M-Pesa Callback received:",
      JSON.stringify(callbackData, null, 2),
    );

    const stkCallback = callbackData.Body?.stkCallback;

    if (stkCallback) {
      const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } =
        stkCallback;

      if (ResultCode === 0) {
        const metadata = {};
        if (CallbackMetadata?.Item) {
          CallbackMetadata.Item.forEach((item) => {
            metadata[item.Name] = item.Value;
          });
        }

        console.log(`✅ Payment successful for ${CheckoutRequestID}`);
        console.log(`   Receipt: ${metadata.MpesaReceiptNumber}`);
        console.log(`   Amount: ${metadata.Amount}`);

        // Check if this is a subscription payment or invoice payment
        const subscription = await query(
          `SELECT id, business_id, plan FROM subscriptions WHERE payment_reference = $1`,
          [CheckoutRequestID],
        );

        if (subscription.rows.length > 0) {
          // Handle subscription payment
          const { id, business_id, plan } = subscription.rows[0];

          await query(
            `UPDATE subscriptions 
             SET status = 'active', 
                 expires_at = NOW() + INTERVAL '30 days',
                 payment_reference = $1
             WHERE id = $2`,
            [metadata.MpesaReceiptNumber, id],
          );

          await query(
            `UPDATE businesses 
             SET subscription_status = 'active',
                 subscription_plan = $1,
                 last_payment_date = CURRENT_TIMESTAMP,
                 payment_due_date = CURRENT_TIMESTAMP + INTERVAL '30 days'
             WHERE id = $2`,
            [plan, business_id],
          );

          console.log(`✅ Subscription activated for business ${business_id}`);
        } else {
          // Handle invoice payment
          const transaction = await query(
            `UPDATE transactions 
             SET status = 'completed', 
                 mpesa_receipt_number = $1,
                 transaction_date = CURRENT_TIMESTAMP
             WHERE mpesa_receipt_number = $2
             RETURNING invoice_id, amount`,
            [metadata.MpesaReceiptNumber, CheckoutRequestID],
          );

          if (transaction.rows.length > 0) {
            const { invoice_id, amount } = transaction.rows[0];
            await query(
              `UPDATE invoices 
               SET amount_paid = amount_paid + $1,
                   status = CASE 
                       WHEN amount_paid + $1 >= total_amount THEN 'paid'
                       ELSE status
                   END
               WHERE id = $2`,
              [amount, invoice_id],
            );
            console.log(
              `✅ Invoice ${invoice_id} updated with payment of ${amount}`,
            );
          }
        }
      } else {
        console.log(`❌ Payment failed: ${ResultDesc}`);

        // Update transaction or subscription as failed
        await query(
          `UPDATE transactions 
           SET status = 'failed', 
               notes = $1
           WHERE mpesa_receipt_number = $2`,
          [ResultDesc, CheckoutRequestID],
        );

        await query(
          `UPDATE subscriptions 
           SET status = 'failed'
           WHERE payment_reference = $1`,
          [CheckoutRequestID],
        );
      }
    }

    res.json({ ResultCode: 0, ResultDesc: "Success" });
  } catch (error) {
    console.error("Callback error:", error);
    res.json({ ResultCode: 1, ResultDesc: "Failed" });
  }
});

// Test rate limiting endpoint
app.get("/api/test-rate-limit", (req, res) => {
  res.json({
    message: "Rate limit test",
    timestamp: new Date().toISOString(),
    remaining: req.rateLimit?.remaining,
  });
});

// =====================================================
// ERROR HANDLING
// =====================================================
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error("Error:", err.stack);
  res.status(500).json({
    error: "Something went wrong!",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// =====================================================
// START SERVER - Bind to 0.0.0.0 for Render
// =====================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔗 Health check: https://biasharapro-api.onrender.com/`);
  console.log(
    `🗄️  Database test: https://biasharapro-api.onrender.com/api/test-db`,
  );
  console.log(
    `🔐 Register: POST https://biasharapro-api.onrender.com/api/auth/register`,
  );
  console.log(
    `🔐 Login: POST https://biasharapro-api.onrender.com/api/auth/login`,
  );
  console.log(
    `📦 Products: GET/POST https://biasharapro-api.onrender.com/api/products`,
  );
});
