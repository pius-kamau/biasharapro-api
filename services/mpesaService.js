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
        status: business.subscription_status || "trial",
        trial_days_left: trialDaysLeft,
        trial_ends_at: business.trial_ends_at,
        current_plan: business.subscription_plan || "starter",
      },
    });
  } catch (error) {
    console.error("Subscription info error:", error);
    res.status(500).json({ error: "Failed to get subscription info" });
  }
});

// Initiate subscription payment - COMPLETE BYPASS
router.post("/pay", authenticate, async (req, res) => {
  console.log("🔥🔥🔥 PAYMENT ENDPOINT HIT 🔥🔥🔥");

  try {
    const { businessId } = req.user;
    const { plan, amount, phoneNumber } = req.body;

    console.log("=== SUBSCRIPTION PAYMENT ===");
    console.log("Business ID:", businessId);
    console.log("Plan:", plan);
    console.log("Amount:", amount);
    console.log("Phone:", phoneNumber);

    // Validate required fields
    if (!plan || !amount || !phoneNumber) {
      console.log("❌ Missing fields");
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Format phone number (SAME as invoice payment)
    let formattedPhone = phoneNumber.toString().trim();
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "254" + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith("+")) {
      formattedPhone = formattedPhone.substring(1);
    } else if (!formattedPhone.startsWith("254")) {
      formattedPhone = "254" + formattedPhone;
    }

    console.log("Formatted phone:", formattedPhone);

    // FORCE BYPASS - Create subscription record without checking status
    const subscription = await query(
      `INSERT INTO subscriptions (business_id, plan, amount, status, payment_method)
             VALUES ($1, $2, $3, 'pending', 'mpesa')
             RETURNING id`,
      [businessId, plan, amount],
    );

    console.log("Subscription created with ID:", subscription.rows[0].id);

    const accountReference = `SUB-${subscription.rows[0].id}`;
    const transactionDesc = `${plan} subscription`;
    const callbackURL =
      "https://biasharapro-api.onrender.com/api/mpesa/callback";

    console.log("Callback URL:", callbackURL);
    console.log("Calling M-Pesa STK Push...");

    // Initiate M-Pesa
    const result = await mpesaService.stkPush(
      formattedPhone,
      Math.round(parseFloat(amount)),
      accountReference,
      transactionDesc,
      callbackURL,
    );

    console.log("M-Pesa result:", result);

    if (!result.success) {
      await query(`UPDATE subscriptions SET status = 'failed' WHERE id = $1`, [
        subscription.rows[0].id,
      ]);
      console.log("❌ M-Pesa failed:", result.error);
      return res.status(400).json({ error: result.error });
    }

    // Update subscription with payment reference
    await query(
      `UPDATE subscriptions 
             SET payment_reference = $1
             WHERE id = $2`,
      [result.checkoutRequestId, subscription.rows[0].id],
    );

    console.log("✅ Payment initiated successfully");
    res.json({
      success: true,
      message: "Payment initiated successfully",
      data: {
        checkoutRequestId: result.checkoutRequestId,
        subscriptionId: subscription.rows[0].id,
      },
    });
  } catch (error) {
    console.error("❌ Subscription payment error:", error);
    res.status(500).json({
      error: error.message || "Failed to process payment",
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Check payment status
router.get("/status/:checkoutRequestId", authenticate, async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;
    const { businessId } = req.user;

    const subscription = await query(
      `SELECT status FROM subscriptions 
             WHERE payment_reference = $1 AND business_id = $2`,
      [checkoutRequestId, businessId],
    );

    if (subscription.rows.length === 0) {
      return res.json({ success: true, status: "pending" });
    }

    res.json({
      success: true,
      status:
        subscription.rows[0].status === "active" ? "completed" : "pending",
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({ error: "Failed to check status" });
  }
});

module.exports = router;
