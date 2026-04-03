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
      `INSERT INTO transactions (business_id, invoice_id, amount, payment_method, status, mpesa_receipt_number, mpesa_phone, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        businessId,
        invoiceId,
        amountDue,
        "mpesa",
        "pending",
        result.checkoutRequestId,
        formattedPhone,
        "Payment initiated",
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

// M-Pesa Callback URL with detailed error handling
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

      // ResultCode 0 = Success
      // ResultCode 1032 = Request cancelled by user
      // ResultCode 1037 = Timeout
      // Other codes = Various failures

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
               transaction_date = CURRENT_TIMESTAMP,
               notes = 'Payment successful'
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
      } else if (ResultCode === 1032) {
        // Payment cancelled by user
        console.log(`❌ Payment cancelled by user: ${ResultDesc}`);

        await query(
          `UPDATE transactions 
           SET status = 'failed', 
               notes = 'User cancelled the transaction'
           WHERE mpesa_receipt_number = $1`,
          [CheckoutRequestID],
        );
      } else if (ResultCode === 1037) {
        // Payment timeout
        console.log(`⏰ Payment timeout: ${ResultDesc}`);

        await query(
          `UPDATE transactions 
           SET status = 'failed', 
               notes = 'Transaction timeout - user did not complete payment'
           WHERE mpesa_receipt_number = $1`,
          [CheckoutRequestID],
        );
      } else {
        // Other failures
        console.log(`❌ Payment failed: ${ResultCode} - ${ResultDesc}`);

        let errorNote = "Payment failed";
        if (ResultDesc && ResultDesc.toLowerCase().includes("insufficient")) {
          errorNote = "Insufficient funds in M-Pesa account";
        } else if (ResultDesc && ResultDesc.toLowerCase().includes("pin")) {
          errorNote = "Incorrect M-Pesa PIN entered";
        } else if (ResultDesc && ResultDesc.toLowerCase().includes("expired")) {
          errorNote = "M-Pesa session expired";
        } else {
          errorNote = ResultDesc || "Payment failed";
        }

        await query(
          `UPDATE transactions 
           SET status = 'failed', 
               notes = $1
           WHERE mpesa_receipt_number = $2`,
          [errorNote, CheckoutRequestID],
        );
      }
    }

    res.json({ ResultCode: 0, ResultDesc: "Success" });
  } catch (error) {
    console.error("Callback error:", error);
    res.json({ ResultCode: 1, ResultDesc: "Failed" });
  }
});

// Check payment status with detailed error messages
router.get("/status/:checkoutRequestId", authenticate, async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;

    // Check local database first for transaction status
    const transaction = await query(
      `SELECT status, notes, mpesa_receipt_number, amount, created_at 
       FROM transactions 
       WHERE mpesa_receipt_number = $1`,
      [checkoutRequestId],
    );

    if (transaction.rows.length > 0) {
      const tx = transaction.rows[0];

      let resultCode = "1";
      let resultDesc = tx.notes || "Payment pending";
      let mpesaReceiptNumber = tx.mpesa_receipt_number;

      if (tx.status === "completed") {
        resultCode = "0";
        resultDesc = "Payment successful";
      } else if (tx.status === "failed") {
        if (tx.notes && tx.notes.includes("cancelled")) {
          resultCode = "1032";
          resultDesc = "Request cancelled by user";
        } else if (tx.notes && tx.notes.includes("timeout")) {
          resultCode = "1037";
          resultDesc = "Transaction timeout";
        } else if (tx.notes && tx.notes.includes("insufficient")) {
          resultCode = "2001";
          resultDesc = "Insufficient funds";
        } else if (tx.notes && tx.notes.includes("PIN")) {
          resultCode = "2002";
          resultDesc = "Incorrect PIN entered";
        } else {
          resultCode = "1001";
          resultDesc = tx.notes || "Payment failed";
        }
      }

      return res.json({
        success: true,
        resultCode: resultCode,
        resultDesc: resultDesc,
        mpesaReceiptNumber: mpesaReceiptNumber,
      });
    }

    // If not in database yet, try to query Safaricom
    try {
      const result = await mpesaService.queryStatus(checkoutRequestId);
      return res.json({
        success: true,
        resultCode: result.resultCode || "1",
        resultDesc: result.resultDesc || "Pending",
        mpesaReceiptNumber: result.mpesaReceiptNumber,
      });
    } catch (err) {
      // If still pending, return pending status
      return res.json({
        success: true,
        resultCode: "1",
        resultDesc: "Payment pending. Waiting for confirmation.",
        mpesaReceiptNumber: null,
      });
    }
  } catch (error) {
    console.error("Status query error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
