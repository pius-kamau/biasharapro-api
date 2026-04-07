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
    } else if (formattedPhone.startsWith("+")) {
      formattedPhone = formattedPhone.substring(1);
    } else if (!formattedPhone.startsWith("254")) {
      formattedPhone = "254" + formattedPhone;
    }

    // Create subscription record
    const subscription = await query(
      `INSERT INTO subscriptions (business_id, plan, amount, status, payment_method)
             VALUES ($1, $2, $3, 'pending', 'mpesa')
             RETURNING id`,
      [businessId, plan, amount],
    );

    const accountReference = `SUB-${subscription.rows[0].id}`;
    const transactionDesc = `${plan} subscription`;

    // Get callback URL from environment
    const callbackURL = `${process.env.BASE_URL}/api/subscription/callback`;

    console.log("Subscription Callback URL:", callbackURL);

    // Initiate M-Pesa STK Push
    const mpesaResponse = await mpesaService.stkPush(
      formattedPhone,
      Math.round(parseFloat(amount)),
      accountReference,
      transactionDesc,
      callbackURL,
    );

    if (!mpesaResponse.success) {
      await query(`UPDATE subscriptions SET status = 'failed' WHERE id = $1`, [
        subscription.rows[0].id,
      ]);
      return res.status(400).json({
        error: mpesaResponse.error || "Failed to initiate payment",
      });
    }

    // Update subscription with checkout request ID
    await query(
      `UPDATE subscriptions 
             SET payment_reference = $1
             WHERE id = $2`,
      [mpesaResponse.checkoutRequestId, subscription.rows[0].id],
    );

    // Return the checkoutRequestId in the data object (matches invoice payment structure)
    res.json({
      success: true,
      message:
        "M-Pesa payment initiated. Check your phone for the STK push prompt.",
      data: {
        checkoutRequestId: mpesaResponse.checkoutRequestId,
        subscriptionId: subscription.rows[0].id,
        merchantRequestId: mpesaResponse.merchantRequestId,
      },
    });
  } catch (error) {
    console.error("Subscription payment error:", error);
    res.status(500).json({ error: "Failed to process payment" });
  }
});

// Check subscription payment status
router.get("/status/:checkoutRequestId", authenticate, async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;
    const { businessId } = req.user;

    const subscription = await query(
      `SELECT status, plan, amount 
             FROM subscriptions 
             WHERE payment_reference = $1 AND business_id = $2`,
      [checkoutRequestId, businessId],
    );

    if (subscription.rows.length === 0) {
      return res.json({
        success: true,
        status: "pending",
        message: "Payment still processing",
      });
    }

    const sub = subscription.rows[0];

    res.json({
      success: true,
      status: sub.status === "active" ? "completed" : "pending",
      subscriptionId: sub.id,
      plan: sub.plan,
      amount: sub.amount,
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({ error: "Failed to check payment status" });
  }
});

// M-Pesa callback for subscriptions
router.post("/callback", express.json(), async (req, res) => {
  try {
    console.log(
      "Subscription callback received:",
      JSON.stringify(req.body, null, 2),
    );

    const stkCallback = req.body.Body?.stkCallback;

    if (stkCallback) {
      const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } =
        stkCallback;

      if (ResultCode === 0) {
        // Payment successful
        const metadata = {};
        if (CallbackMetadata?.Item) {
          CallbackMetadata.Item.forEach((item) => {
            metadata[item.Name] = item.Value;
          });
        }

        console.log(
          `✅ Subscription payment successful for ${CheckoutRequestID}`,
        );
        console.log(`   Receipt: ${metadata.MpesaReceiptNumber}`);
        console.log(`   Amount: ${metadata.Amount}`);

        // Get subscription
        const subscription = await query(
          `SELECT id, business_id, plan FROM subscriptions WHERE payment_reference = $1`,
          [CheckoutRequestID],
        );

        if (subscription.rows.length > 0) {
          const { id, business_id, plan } = subscription.rows[0];

          // Update subscription status
          await query(
            `UPDATE subscriptions 
                         SET status = 'active', 
                             expires_at = NOW() + INTERVAL '30 days'
                         WHERE id = $1`,
            [id],
          );

          // Update business subscription status
          await query(
            `UPDATE businesses 
                         SET subscription_status = 'active',
                             subscription_plan = $1,
                             last_payment_date = CURRENT_TIMESTAMP,
                             payment_due_date = CURRENT_TIMESTAMP + INTERVAL '30 days'
                         WHERE id = $2`,
            [plan, business_id],
          );

          console.log(
            `✅ Subscription activated for business ${business_id} with plan ${plan}`,
          );
        }
      } else {
        console.log(`❌ Subscription payment failed: ${ResultDesc}`);

        // Update subscription as failed
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
    console.error("Subscription callback error:", error);
    res.json({ ResultCode: 1, ResultDesc: "Failed" });
  }
});

// Simulate payment for testing (remove in production)
router.post("/simulate/:subscriptionId", authenticate, async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const { businessId } = req.user;

    const subscription = await query(
      `SELECT plan, business_id FROM subscriptions WHERE id = $1 AND business_id = $2`,
      [subscriptionId, businessId],
    );

    if (subscription.rows.length === 0) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    const { plan } = subscription.rows[0];

    await query(
      `UPDATE subscriptions 
             SET status = 'active', 
                 expires_at = NOW() + INTERVAL '30 days'
             WHERE id = $1`,
      [subscriptionId],
    );

    await query(
      `UPDATE businesses 
             SET subscription_status = 'active',
                 subscription_plan = $1,
                 last_payment_date = CURRENT_TIMESTAMP,
                 payment_due_date = CURRENT_TIMESTAMP + INTERVAL '30 days'
             WHERE id = $2`,
      [plan, businessId],
    );

    res.json({
      success: true,
      message: "Subscription activated successfully!",
    });
  } catch (error) {
    console.error("Simulate error:", error);
    res.status(500).json({ error: "Failed to activate subscription" });
  }
});

module.exports = router;
