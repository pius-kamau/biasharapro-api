const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { query } = require("../config/database");
const mpesaService = require("../services/mpesaService");

// Initiate M-Pesa payment for invoice
router.post("/pay/:invoiceId", authenticate, async (req, res) => {
  try {
    const { businessId } = req.user;
    const { invoiceId } = req.params;
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number required" });
    }

    // Get invoice details
    const invoice = await query(
      `SELECT id, invoice_number, total_amount, amount_paid, customer_name, customer_email
             FROM invoices 
             WHERE id = $1 AND business_id = $2`,
      [invoiceId, businessId],
    );

    if (invoice.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const invoiceData = invoice.rows[0];
    const amountDue = invoiceData.total_amount - invoiceData.amount_paid;

    if (amountDue <= 0) {
      return res.status(400).json({ error: "Invoice already fully paid" });
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

    // Create transaction record
    const transaction = await query(
      `INSERT INTO transactions (business_id, invoice_id, amount, status, payment_method)
             VALUES ($1, $2, $3, 'pending', 'mpesa')
             RETURNING id`,
      [businessId, invoiceId, amountDue],
    );

    const accountReference = `INV-${invoiceData.invoice_number}`;
    const transactionDesc = `Pay ${invoiceData.invoice_number}`;

    // CRITICAL: Ensure BASE_URL is set
    const callbackURL = process.env.BASE_URL
      ? `${process.env.BASE_URL}/api/mpesa/callback`
      : "https://biasharapro-api.onrender.com/api/mpesa/callback";

    console.log("Using callback URL:", callbackURL);

    // Initiate STK Push
    const result = await mpesaService.stkPush(
      formattedPhone,
      Math.round(amountDue),
      accountReference,
      transactionDesc,
      callbackURL, // Pass callback URL explicitly
    );

    if (!result.success) {
      await query(`UPDATE transactions SET status = 'failed' WHERE id = $1`, [
        transaction.rows[0].id,
      ]);
      return res.status(400).json({ error: result.error });
    }

    // Update transaction with checkout ID
    await query(
      `UPDATE transactions SET mpesa_receipt_number = $1 WHERE id = $2`,
      [result.checkoutRequestId, transaction.rows[0].id],
    );

    res.json({
      success: true,
      message: "M-Pesa payment initiated",
      data: {
        checkoutRequestId: result.checkoutRequestId,
        transactionId: transaction.rows[0].id,
        amount: amountDue,
      },
    });
  } catch (error) {
    console.error("M-Pesa payment error:", error);
    res.status(500).json({ error: "Failed to initiate payment" });
  }
});

// M-Pesa callback endpoint
router.post("/callback", express.json(), async (req, res) => {
  try {
    console.log("M-Pesa callback received:", JSON.stringify(req.body, null, 2));

    const stkCallback = req.body.Body?.stkCallback;

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

        // Update transaction
        const transaction = await query(
          `SELECT invoice_id FROM transactions WHERE mpesa_receipt_number = $1`,
          [CheckoutRequestID],
        );

        if (transaction.rows.length > 0) {
          const { invoice_id } = transaction.rows[0];

          await query(
            `UPDATE transactions 
                         SET status = 'completed', 
                             transaction_date = CURRENT_TIMESTAMP,
                             mpesa_receipt_number = $1
                         WHERE mpesa_receipt_number = $2`,
            [metadata.MpesaReceiptNumber, CheckoutRequestID],
          );

          // Update invoice paid amount
          await query(
            `UPDATE invoices 
                         SET amount_paid = amount_paid + $1,
                             status = CASE 
                                 WHEN amount_paid + $1 >= total_amount THEN 'paid'
                                 ELSE status
                             END
                         WHERE id = $2`,
            [metadata.Amount, invoice_id],
          );

          console.log(`✅ Payment successful for invoice ${invoice_id}`);
        }
      } else {
        console.log(`❌ Payment failed: ${ResultDesc}`);
        await query(
          `UPDATE transactions SET status = 'failed' WHERE mpesa_receipt_number = $1`,
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
// Check payment status
router.get("/status/:checkoutRequestId", authenticate, async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;
    const { businessId } = req.user;

    // Find transaction by checkout request ID
    const transaction = await query(
      `SELECT t.status, t.amount, i.invoice_number
             FROM transactions t
             LEFT JOIN invoices i ON t.invoice_id = i.id
             WHERE t.mpesa_receipt_number = $1 AND t.business_id = $2`,
      [checkoutRequestId, businessId],
    );

    if (transaction.rows.length === 0) {
      return res.json({
        success: true,
        status: "pending",
        message: "Payment still processing",
      });
    }

    const tx = transaction.rows[0];

    res.json({
      success: true,
      status: tx.status === "completed" ? "completed" : "pending",
      amount: tx.amount,
      invoiceNumber: tx.invoice_number,
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({ error: "Failed to check payment status" });
  }
});
module.exports = router;
