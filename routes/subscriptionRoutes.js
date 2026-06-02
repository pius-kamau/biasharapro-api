// Initiate subscription payment - NO SUBSCRIPTION CHECK (allow expired users to pay)
router.post("/pay", authenticate, async (req, res) => {
  console.log("🔥🔥🔥 PAYMENT ENDPOINT HIT 🔥🔥🔥");
  console.log("Request body:", req.body);
  console.log("User:", req.user);

  try {
    const { businessId } = req.user;
    const { plan, amount, phoneNumber } = req.body;

    console.log("=== SUBSCRIPTION PAYMENT ===");
    console.log("Business ID:", businessId);
    console.log("Plan:", plan);
    console.log("Amount:", amount);
    console.log("Phone:", phoneNumber);

    if (!plan || !amount || !phoneNumber) {
      console.log("❌ Missing fields");
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
    console.log("Formatted phone:", formattedPhone);

    // Check business exists
    const businessCheck = await query(
      `SELECT id, name, subscription_status FROM businesses WHERE id = $1`,
      [businessId],
    );
    console.log("Business check:", businessCheck.rows[0]);

    // Create subscription record
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
    res
      .status(500)
      .json({ error: error.message || "Failed to process payment" });
  }
});
