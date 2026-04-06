const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { query, getClient } = require("../config/database");
const etimsService = require("../services/etimsService");
const emailService = require("../services/emailService");

// Generate Invoice Email HTML
const generateInvoiceEmailHTML = (invoice, business) => {
  const itemsHtml = invoice.items
    .map(
      (item) => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${item.product_name}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: center;">${item.quantity}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">KES ${item.unit_price.toLocaleString()}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">KES ${item.total.toLocaleString()}</td>
         </tr>
    `,
    )
    .join("");

  const balance = invoice.total_amount - invoice.amount_paid;

  return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Invoice ${invoice.invoice_number}</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #1e293b; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; }
                .invoice-details { background: #f8fafc; padding: 15px; margin: 20px 0; border-radius: 8px; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th { background: #f1f5f9; padding: 10px; text-align: left; }
                .total { font-size: 18px; font-weight: bold; text-align: right; margin-top: 20px; }
                .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
                .status-paid { color: #10b981; }
                .status-pending { color: #f59e0b; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>INVOICE</h1>
                    <p>${business.name}</p>
                </div>
                <div class="content">
                    <div class="invoice-details">
                        <p><strong>Invoice #:</strong> ${invoice.invoice_number}</p>
                        <p><strong>Date:</strong> ${new Date(invoice.created_at).toLocaleDateString()}</p>
                        <p><strong>Customer:</strong> ${invoice.customer_name}</p>
                        ${invoice.customer_email ? `<p><strong>Email:</strong> ${invoice.customer_email}</p>` : ""}
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th style="text-align: center;">Qty</th>
                                <th style="text-align: right;">Unit Price</th>
                                <th style="text-align: right;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                        </tbody>
                    </table>

                    <div class="total">
                        <p>Subtotal: KES ${invoice.subtotal.toLocaleString()}</p>
                        <p>VAT (16%): KES ${invoice.vat_amount.toLocaleString()}</p>
                        <p><strong>Total: KES ${invoice.total_amount.toLocaleString()}</strong></p>
                        <p>Amount Paid: KES ${invoice.amount_paid.toLocaleString()}</p>
                        <p><strong>Balance Due: KES ${balance.toLocaleString()}</strong></p>
                        <p class="${balance === 0 ? "status-paid" : "status-pending"}">Status: ${balance === 0 ? "PAID" : "PENDING"}</p>
                    </div>

                    ${
                      invoice.etims_reference
                        ? `
                    <div style="background: #fef3c7; padding: 12px; border-radius: 8px; margin: 20px 0; text-align: center;">
                        <p style="color: #92400e;">✓ KRA eTIMS Verified</p>
                        <p style="font-size: 11px;">Reference: ${invoice.etims_reference}</p>
                    </div>
                    `
                        : ""
                    }
                </div>
                <div class="footer">
                    <p>${business.name} | KRA PIN: ${business.kra_pin}</p>
                    <p>Thank you for your business!</p>
                </div>
            </div>
        </body>
        </html>
    `;
};

// Generate unique invoice number
async function generateInvoiceNumber(businessId) {
  const result = await query(
    `SELECT COUNT(*) as count FROM invoices 
         WHERE business_id = $1 
         AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)`,
    [businessId],
  );
  const count = parseInt(result.rows[0].count) + 1;
  const year = new Date().getFullYear();
  return `INV-${year}-${count.toString().padStart(4, "0")}`;
}

// Create new invoice
const createInvoice = async (req, res) => {
  let client;
  try {
    const { businessId } = req.user;
    const { customerName, customerPhone, customerEmail, items, notes } =
      req.body;

    if (!customerName || !items || items.length === 0) {
      return res
        .status(400)
        .json({ error: "Customer name and at least one item required" });
    }

    let subtotal = 0;
    let vatAmount = 0;
    const invoiceItems = [];

    for (const item of items) {
      const productResult = await query(
        "SELECT name, selling_price, stock_quantity FROM products WHERE id = $1 AND business_id = $2",
        [item.productId, businessId],
      );

      if (productResult.rows.length === 0) {
        return res
          .status(404)
          .json({ error: `Product ${item.productId} not found` });
      }

      const product = productResult.rows[0];

      if (product.stock_quantity < item.quantity) {
        return res.status(400).json({
          error: `Insufficient stock for ${product.name}. Available: ${product.stock_quantity}`,
        });
      }

      const unitPrice = item.unitPrice || product.selling_price;
      const itemTotal = item.quantity * unitPrice;
      const itemVat = (itemTotal * (item.vatRate || 16)) / 100;

      subtotal += itemTotal;
      vatAmount += itemVat;

      invoiceItems.push({
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: unitPrice,
        vatRate: item.vatRate || 16,
        vatAmount: itemVat,
        total: itemTotal,
      });
    }

    const totalAmount = subtotal + vatAmount;
    const invoiceNumber = await generateInvoiceNumber(businessId);

    client = await getClient();
    await client.query("BEGIN");

    const invoiceResult = await client.query(
      `INSERT INTO invoices (business_id, invoice_number, customer_name, customer_phone, customer_email, subtotal, vat_amount, total_amount, notes, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING id, invoice_number, total_amount, created_at, customer_email`,
      [
        businessId,
        invoiceNumber,
        customerName,
        customerPhone,
        customerEmail,
        subtotal,
        vatAmount,
        totalAmount,
        notes,
        "pending",
      ],
    );

    const invoiceId = invoiceResult.rows[0].id;

    for (const item of invoiceItems) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, product_name, quantity, unit_price, vat_rate, vat_amount, total)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          invoiceId,
          item.productId,
          item.productName,
          item.quantity,
          item.unitPrice,
          item.vatRate,
          item.vatAmount,
          item.total,
        ],
      );

      await client.query(
        "UPDATE products SET stock_quantity = stock_quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [item.quantity, item.productId],
      );
    }

    await client.query("COMMIT");

    // Send email
    try {
      const businessInfo = await query(
        "SELECT name, email, kra_pin FROM businesses WHERE id = $1",
        [businessId],
      );

      const invoiceData = invoiceResult.rows[0];
      if (invoiceData.customer_email) {
        await emailService.sendInvoiceEmail(invoiceData, businessInfo.rows[0]);
      }
    } catch (emailError) {
      console.error("Failed to send invoice email:", emailError.message);
    }

    res.status(201).json({
      success: true,
      message: "Invoice created successfully",
      data: {
        id: invoiceId,
        invoiceNumber: invoiceNumber,
        totalAmount: totalAmount,
        customerEmail: customerEmail,
        items: invoiceItems,
      },
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
    console.error("Create invoice error:", error);
    res.status(500).json({ error: "Failed to create invoice" });
  }
};

// Get all invoices
const getInvoices = async (req, res) => {
  try {
    const { businessId } = req.user;
    const result = await query(
      `SELECT id, invoice_number, customer_name, customer_email, total_amount, amount_paid, status, created_at
             FROM invoices
             WHERE business_id = $1
             ORDER BY created_at DESC`,
      [businessId],
    );
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("Get invoices error:", error);
    res.status(500).json({ error: "Failed to get invoices" });
  }
};

// Get single invoice
const getInvoiceById = async (req, res) => {
  try {
    const { businessId } = req.user;
    const { id } = req.params;

    const invoiceResult = await query(
      `SELECT * FROM invoices WHERE id = $1 AND business_id = $2`,
      [id, businessId],
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const itemsResult = await query(
      `SELECT id, product_name, quantity, unit_price, vat_rate, vat_amount, total
             FROM invoice_items
             WHERE invoice_id = $1`,
      [id],
    );

    const invoice = invoiceResult.rows[0];
    invoice.items = itemsResult.rows;
    res.json({ success: true, data: invoice });
  } catch (error) {
    console.error("Get invoice error:", error);
    res.status(500).json({ error: "Failed to get invoice" });
  }
};

// Record payment
const recordPayment = async (req, res) => {
  try {
    const { businessId } = req.user;
    const { id } = req.params;
    const { amount, paymentMethod, reference } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Valid amount required" });
    }

    const invoiceResult = await query(
      "SELECT * FROM invoices WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.status === "cancelled") {
      return res.status(400).json({ error: "Cannot pay cancelled invoice" });
    }

    const newAmountPaid = parseFloat(invoice.amount_paid) + parseFloat(amount);

    if (newAmountPaid > invoice.total_amount) {
      return res.status(400).json({
        error: `Payment exceeds balance. Remaining: KSh ${(invoice.total_amount - invoice.amount_paid).toFixed(2)}`,
      });
    }

    const newStatus =
      newAmountPaid >= invoice.total_amount ? "paid" : "pending";

    await query(
      `UPDATE invoices 
             SET amount_paid = $1, status = $2, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $3`,
      [newAmountPaid, newStatus, id],
    );

    // Send receipt email
    try {
      const businessInfo = await query(
        "SELECT name, email, kra_pin FROM businesses WHERE id = $1",
        [businessId],
      );
      if (invoice.customer_email) {
        await emailService.sendReceiptEmail(invoice, businessInfo.rows[0], {
          amount: amount,
          payment_method: paymentMethod || "cash",
          mpesa_receipt_number: reference,
        });
      }
    } catch (emailError) {
      console.error("Failed to send receipt email:", emailError.message);
    }

    res.json({
      success: true,
      message: `Payment of KSh ${amount} recorded successfully`,
      data: {
        invoiceId: id,
        amountPaid: newAmountPaid,
        remainingBalance: invoice.total_amount - newAmountPaid,
        status: newStatus,
      },
    });
  } catch (error) {
    console.error("Record payment error:", error);
    res.status(500).json({ error: "Failed to record payment" });
  }
};

// Submit to eTIMS
const submitToETIMS = async (req, res) => {
  const client = await getClient();
  try {
    const { id } = req.params;
    const { businessId } = req.user;

    const invoiceResult = await client.query(
      `SELECT i.*, b.kra_pin as business_kra, b.name as business_name, b.email as business_email, b.phone as business_phone
             FROM invoices i
             JOIN businesses b ON i.business_id = b.id
             WHERE i.id = $1 AND i.business_id = $2`,
      [id, businessId],
    );

    if (invoiceResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Invoice not found" });
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.etims_status === "submitted") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invoice already submitted" });
    }

    const itemsResult = await client.query(
      `SELECT ii.*, p.name as product_name, p.sku
             FROM invoice_items ii
             LEFT JOIN products p ON ii.product_id = p.id
             WHERE ii.invoice_id = $1`,
      [id],
    );

    const items = itemsResult.rows;
    const etimsResult = await etimsService.submitInvoice(
      invoice,
      {
        kra_pin: invoice.business_kra,
        name: invoice.business_name,
        email: invoice.business_email,
        phone: invoice.business_phone,
      },
      items,
    );

    if (etimsResult.success) {
      await client.query(
        `UPDATE invoices 
                 SET etims_invoice_number = $1,
                     etims_reference = $2,
                     etims_qr_code = $3,
                     etims_submitted_at = CURRENT_TIMESTAMP,
                     etims_status = 'submitted'
                 WHERE id = $4`,
        [
          etimsResult.etimsInvoiceNumber,
          etimsResult.etimsReference,
          etimsResult.qrCode,
          id,
        ],
      );
      await client.query("COMMIT");
      res.json({
        success: true,
        message: "Invoice submitted to KRA eTIMS successfully",
        data: etimsResult,
      });
    } else {
      await client.query(
        `UPDATE invoices 
                 SET etims_status = 'failed',
                     etims_retry_count = etims_retry_count + 1,
                     etims_error_message = $1
                 WHERE id = $2`,
        [etimsResult.error, id],
      );
      await client.query("COMMIT");
      res.status(500).json({
        success: false,
        error: "eTIMS submission failed",
        details: etimsResult.error,
      });
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("eTIMS error:", error);
    res.status(500).json({ error: "Failed to submit to eTIMS" });
  } finally {
    client.release();
  }
};

// Get eTIMS status
const getETIMSStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId } = req.user;
    const result = await query(
      `SELECT etims_invoice_number, etims_reference, etims_qr_code, 
                    etims_submitted_at, etims_status, etims_error_message, etims_retry_count
             FROM invoices 
             WHERE id = $1 AND business_id = $2`,
      [id, businessId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Get eTIMS status error:", error);
    res.status(500).json({ error: "Failed to get eTIMS status" });
  }
};

// Retry eTIMS
const retryETIMS = async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId } = req.user;
    const invoiceCheck = await query(
      `SELECT etims_status, etims_retry_count FROM invoices WHERE id = $1 AND business_id = $2`,
      [id, businessId],
    );
    if (invoiceCheck.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    const invoice = invoiceCheck.rows[0];
    if (invoice.etims_status === "submitted") {
      return res.status(400).json({ error: "Invoice already submitted" });
    }
    if (invoice.etims_retry_count >= 3) {
      return res.status(400).json({ error: "Maximum retry attempts reached" });
    }
    req.params.id = id;
    await submitToETIMS(req, res);
  } catch (error) {
    console.error("Retry eTIMS error:", error);
    res.status(500).json({ error: "Failed to retry eTIMS submission" });
  }
};

// =====================================================
// ROUTES - CORRECT ORDER (Specific routes FIRST)
// =====================================================

// SPECIFIC ROUTES (no parameters) - MUST come first
router.get("/transactions", authenticate, async (req, res) => {
  try {
    const { businessId } = req.user;
    const result = await query(
      `SELECT t.*, i.invoice_number 
       FROM transactions t
       LEFT JOIN invoices i ON t.invoice_id = i.id
       WHERE t.business_id = $1
       ORDER BY t.created_at DESC`,
      [businessId],
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get transactions error:", error);
    res.status(500).json({ error: "Failed to get transactions" });
  }
});

// GET all invoices
router.get("/", authenticate, getInvoices);

// POST create invoice
router.post("/", authenticate, authorize("owner", "accountant", "cashier"), createInvoice);

// POST email invoice
router.post("/:id/email", authenticate, authorize("owner", "accountant"), async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    const { businessId } = req.user;

    if (!email) {
      return res.status(400).json({ error: "Email address required" });
    }

    const invoiceResult = await query(
      `SELECT i.*, b.name as business_name, b.email as business_email, b.kra_pin
       FROM invoices i
       JOIN businesses b ON i.business_id = b.id
       WHERE i.id = $1 AND i.business_id = $2`,
      [id, businessId],
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const invoice = invoiceResult.rows[0];
    const itemsResult = await query(
      `SELECT product_name, quantity, unit_price, total
       FROM invoice_items
       WHERE invoice_id = $1`,
      [id],
    );
    invoice.items = itemsResult.rows;

    const html = generateInvoiceEmailHTML(invoice, {
      name: invoice.business_name,
      email: invoice.business_email,
      kra_pin: invoice.kra_pin,
    });

    const { Resend } = require("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      from: `"${invoice.business_name}" <onboarding@resend.dev>`,
      to: [email],
      subject: `Invoice ${invoice.invoice_number} from ${invoice.business_name}`,
      html: html,
    });

    if (error) {
      console.error("Resend error:", error);
      return res.status(500).json({ error: "Failed to send email" });
    }

    res.json({ success: true, message: "Invoice emailed successfully", data: { messageId: data.id } });
  } catch (error) {
    console.error("Email invoice error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// POST record payment
router.post("/:id/pay", authenticate, authorize("owner", "accountant", "cashier"), recordPayment);

// eTIMS routes
router.post("/:id/etims", authenticate, authorize("owner", "accountant"), submitToETIMS);
router.get("/:id/etims", authenticate, getETIMSStatus);
router.post("/:id/etims/retry", authenticate, authorize("owner", "accountant"), retryETIMS);

// DELETE invoice
router.delete("/:id", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId } = req.user;

    const invoice = await query(
      "SELECT status FROM invoices WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (invoice.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (invoice.rows[0].status === "paid") {
      return res.status(400).json({ error: "Cannot delete paid invoice" });
    }

    await query("DELETE FROM invoice_items WHERE invoice_id = $1", [id]);
    await query("DELETE FROM invoices WHERE id = $1", [id]);

    res.json({ success: true, message: "Invoice deleted successfully" });
  } catch (error) {
    console.error("Delete invoice error:", error);
    res.status(500).json({ error: "Failed to delete invoice" });
  }
});

// GET single invoice (MUST be LAST - catches all /:id routes)
router.get("/:id", authenticate, getInvoiceById);

module.exports = router;
