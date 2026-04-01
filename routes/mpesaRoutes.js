const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const mpesaService = require("../services/mpesaService");
const { query } = require("../config/database");

// Initiate STK Push payment for an invoice
router.post("/pay/:invoiceId", authenticate, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { phoneNumber } = req.body;
    const { businessId } = req.user;

    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    // Get invoice details
    const invoice = await query(
      "SELECT invoice_number, total_amount, amount_paid FROM invoices WHERE id = $1 AND business_id = $2",
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
    } else if (formattedPhone.startsWith("+254")) {
      formattedPhone = formattedPhone.substring(1);
    } else if (!formattedPhone.startsWith("254")) {
      formattedPhone = "254" + formattedPhone;
    }

    // Initiate STK Push
    const result = await mpesaService.stkPush(
      formattedPhone,
      amountDue,
      invoiceData.invoice_number,
      `Pay ${invoiceData.invoice_number}`,
    );

    if (!result.success) {
      return res.status(400).json({
        error: "Failed to initiate payment",
        details: result.error,
      });
    }

    // Store transaction
    await query(
      `INSERT INTO transactions (business_id, invoice_id, amount, payment_method, status, mpesa_receipt_number, mpesa_phone, transaction_reference)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        businessId,
        invoiceId,
        amountDue,
        "mpesa",
        "pending",
        result.checkoutRequestId,
        formattedPhone,
        result.checkoutRequestId,
      ],
    );

    res.json({
      success: true,
      message:
        "STK Push initiated. Please check your phone to complete payment.",
      data: {
        checkoutRequestId: result.checkoutRequestId,
        amount: amountDue,
        phoneNumber: formattedPhone,
        customerMessage: result.customerMessage,
      },
    });
  } catch (error) {
    console.error("STK Push error:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to initiate payment" });
  }
});

// M-Pesa Callback with Idempotency
router.post("/callback", async (req, res) => {
  try {
    const callbackData = req.body;
    console.log(
      "M-Pesa Callback received:",
      JSON.stringify(callbackData, null, 2),
    );

    const stkCallback = callbackData.Body?.stkCallback;

    if (!stkCallback) {
      return res.json({ ResultCode: 0, ResultDesc: "Success" });
    }

    const { ResultCode, ResultDesc, CheckoutRequestID, CallbackMetadata } =
      stkCallback;

    // IDEMPOTENCY CHECK - Critical for preventing double payments
    const isProcessed =
      await redisService.isTransactionProcessed(CheckoutRequestID);

    if (isProcessed) {
      console.log(
        `⚠️ Duplicate callback received for ${CheckoutRequestID} - ignoring`,
      );
      return res.json({ ResultCode: 0, ResultDesc: "Already processed" });
    }

    if (ResultCode === 0) {
      // Payment successful
      const metadata = {};
      if (CallbackMetadata?.Item) {
        CallbackMetadata.Item.forEach((item) => {
          metadata[item.Name] = item.Value;
        });
      }

      const mpesaReceipt = metadata.MpesaReceiptNumber;
      const amount = metadata.Amount;

      console.log(`✅ Payment successful: ${mpesaReceipt} - KES ${amount}`);

      // Find pending transaction
      const transaction = await query(
        `SELECT id, invoice_id, amount FROM transactions 
                 WHERE mpesa_receipt_number = $1 AND status = 'pending'`,
        [CheckoutRequestID],
      );

      if (transaction.rows.length === 0) {
        console.log(`⚠️ No pending transaction found for ${CheckoutRequestID}`);
        return res.json({ ResultCode: 0, ResultDesc: "Success" });
      }

      const {
        id: transactionId,
        invoice_id,
        amount: expectedAmount,
      } = transaction.rows[0];

      // Verify amount matches
      if (Math.abs(amount - expectedAmount) > 0.01) {
        console.error(
          `❌ Amount mismatch: expected ${expectedAmount}, got ${amount}`,
        );
        await query(
          `UPDATE transactions SET status = 'failed', notes = $1 WHERE id = $2`,
          [
            `Amount mismatch: expected ${expectedAmount}, got ${amount}`,
            transactionId,
          ],
        );
        return res.json({ ResultCode: 0, ResultDesc: "Success" });
      }

      // Update transaction
      await query(
        `UPDATE transactions 
                 SET status = 'completed', 
                     mpesa_receipt_number = $1,
                     transaction_date = CURRENT_TIMESTAMP
                 WHERE id = $2`,
        [mpesaReceipt, transactionId],
      );

      // Update invoice - WITH SAFETY CHECK
      const invoiceUpdate = await query(
        `UPDATE invoices 
                 SET amount_paid = amount_paid + $1,
                     status = CASE 
                         WHEN amount_paid + $1 >= total_amount THEN 'paid'
                         ELSE status
                     END
                 WHERE id = $2
                 RETURNING id, total_amount, amount_paid`,
        [amount, invoice_id],
      );

      console.log(`✅ Invoice ${invoice_id} updated: paid ${amount}`);

      // MARK AS PROCESSED - This prevents duplicate processing
      await redisService.markTransactionProcessed(
        CheckoutRequestID,
        { receipt: mpesaReceipt, amount, invoice_id },
        86400, // 24 hours
      );
    } else {
      // Payment failed
      console.log(`❌ Payment failed: ${ResultDesc}`);

      // Update transaction as failed
      await query(
        `UPDATE transactions 
                 SET status = 'failed', 
                     notes = $1
                 WHERE mpesa_receipt_number = $2`,
        [ResultDesc, CheckoutRequestID],
      );

      // Mark as processed (so we don't retry)
      await redisService.markTransactionProcessed(
        CheckoutRequestID,
        { status: "failed", reason: ResultDesc },
        3600,
      );
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

    const result = await query(
      "SELECT * FROM transactions WHERE mpesa_receipt_number = $1",
      [checkoutRequestId],
    );

    res.json({
      success: true,
      data: result.rows[0] || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test STK Push directly
router.post("/test-stk", async (req, res) => {
  try {
    const { phoneNumber, amount } = req.body;

    if (!phoneNumber || !amount) {
      return res
        .status(400)
        .json({ error: "Phone number and amount required" });
    }

    let formattedPhone = phoneNumber.toString().trim();
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "254" + formattedPhone.substring(1);
    } else if (!formattedPhone.startsWith("254")) {
      formattedPhone = "254" + formattedPhone;
    }

    const result = await mpesaService.stkPush(
      formattedPhone,
      amount,
      "TEST001",
      "Test Payment",
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
