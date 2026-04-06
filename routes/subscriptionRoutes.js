const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { query } = require("../config/database");
const mpesaService = require("../services/mpesaService");

// Get subscription info
router.get("/info", authenticate, async (req, res) => {
  try {
    const { businessId } = req.user;

    const result = await query(
      `SELECT subscription_status, trial_ends_at, subscription_plan 
             FROM businesses 
             WHERE id = $1`,
      [businessId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Business not found" });
    }

    const business = result.rows[0];
    const now = new Date();
    const trialEnds = business.trial_ends_at
      ? new Date(business.trial_ends_at)
      : null;
    let trialDaysLeft = 0;

    if (trialEnds && now < trialEnds) {
      trialDaysLeft = Math.ceil((trialEnds - now) / (1000 * 60 * 60 * 24));
    }

    res.json({
      success: true,
      data: {
        status: business.subscription_status,
        trial_days_left: trialDaysLeft,
        trial_ends_at: business.trial_ends_at,
        current_plan: business.subscription_plan,
      },
    });
  } catch (error) {
    console.error("Subscription info error:", error);
    res.status(500).json({ error: "Failed to get subscription info" });
  }
});

// Initiate subscription payment
router.post("/pay", authenticate, async (req, res) => {
  try {
    const { businessId } = req.user;
    const { plan, amount, phoneNumber } = req.body;

    if (!plan || !amount || !phoneNumber) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Format phone number
    let formattedPhone = phoneNumber.toString().trim();
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "254" + formattedPhone.substring(1);
    } else if (!formattedPhone.startsWith("254")) {
      formattedPhone = "254" + formattedPhone;
    }

    // Create subscription record
    const subscription = await query(
      `INSERT INTO subscriptions (business_id, plan, amount, status)
             VALUES ($1, $2, $3, 'pending')
             RETURNING id`,
      [businessId, plan, amount],
    );

    // Initiate M-Pesa payment
    const result = await mpesaService.stkPush(
      formattedPhone,
      amount,
      `SUB-${subscription.rows[0].id}`,
      `BiasharaPro Subscription - ${plan}`,
    );

    if (!result.success) {
      return res.status(400).json({ error: "Failed to initiate payment" });
    }

    // Store transaction reference
    await query(
      `UPDATE subscriptions 
             SET payment_reference = $1, payment_method = 'mpesa'
             WHERE id = $2`,
      [result.checkoutRequestId, subscription.rows[0].id],
    );

    res.json({
      success: true,
      message: "Payment initiated",
      data: {
        checkoutRequestId: result.checkoutRequestId,
        subscriptionId: subscription.rows[0].id,
      },
    });
  } catch (error) {
    console.error("Subscription payment error:", error);
    res.status(500).json({ error: "Failed to process payment" });
  }
});

// M-Pesa Callback for subscription
router.post("/callback", async (req, res) => {
  try {
    const callbackData = req.body;
    const stkCallback = callbackData.Body?.stkCallback;

    if (stkCallback) {
      const { ResultCode, CheckoutRequestID, CallbackMetadata } = stkCallback;

      if (ResultCode === 0) {
        const metadata = {};
        if (CallbackMetadata?.Item) {
          CallbackMetadata.Item.forEach((item) => {
            metadata[item.Name] = item.Value;
          });
        }

        // Get subscription
        const subscription = await query(
          "SELECT business_id, plan FROM subscriptions WHERE payment_reference = $1",
          [CheckoutRequestID],
        );

        if (subscription.rows.length > 0) {
          const { business_id, plan } = subscription.rows[0];

          // Update subscription
          await query(
            `UPDATE subscriptions 
                         SET status = 'active', 
                             expires_at = NOW() + INTERVAL '30 days',
                             payment_reference = $1
                         WHERE payment_reference = $2`,
            [metadata.MpesaReceiptNumber, CheckoutRequestID],
          );

          // Update business subscription
          await query(
            `UPDATE businesses 
                         SET subscription_status = 'active',
                             subscription_plan = $1,
                             last_payment_date = CURRENT_TIMESTAMP,
                             payment_due_date = CURRENT_TIMESTAMP + INTERVAL '30 days'
                         WHERE id = $2`,
            [plan, business_id],
          );
        }
      }
    }

    res.json({ ResultCode: 0, ResultDesc: "Success" });
  } catch (error) {
    console.error("Subscription callback error:", error);
    res.json({ ResultCode: 1, ResultDesc: "Failed" });
  }
});

// Check subscription payment status
router.get("/status/:checkoutRequestId", authenticate, async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;

    const subscription = await query(
      "SELECT status FROM subscriptions WHERE payment_reference = $1",
      [checkoutRequestId],
    );

    if (subscription.rows.length > 0) {
      res.json({
        success: true,
        status:
          subscription.rows[0].status === "active" ? "completed" : "pending",
      });
    } else {
      res.json({ success: true, status: "pending" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
