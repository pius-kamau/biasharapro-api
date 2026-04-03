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
      return res.status(400).json({ error: "Phone number required" });
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

    // Format phone number (remove 0 and add 254)
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
      `INSERT INTO transactions (business_id, invoice_id, amount, payment_method, status, mpesa_receipt_number, mpesa_phone)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        businessId,
        invoiceId,
        amountDue,
        "mpesa",
        "pending",
        result.checkoutRequestId,
        formattedPhone,
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

// M-Pesa Callback URL
router.post("/callback", async (req, res) => {
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
        // Payment successful
        const metadata = {};
        if (CallbackMetadata?.Item) {
          CallbackMetadata.Item.forEach((item) => {
            metadata[item.Name] = item.Value;
          });
        }

        console.log(`✅ Payment successful for ${CheckoutRequestID}`);
        console.log(`   Receipt: ${metadata.MpesaReceiptNumber}`);
        console.log(`   Amount: ${metadata.Amount}`);

        // Update transaction
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

          // Update invoice
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
      } else {
        console.log(`❌ Payment failed: ${ResultDesc}`);

        // Update transaction as failed
        await query(
          `UPDATE transactions 
                     SET status = 'failed', 
                         notes = $1
                     WHERE mpesa_receipt_number = $2`,
          [ResultDesc, CheckoutRequestID],
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

    const result = await mpesaService.queryStatus(checkoutRequestId);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
