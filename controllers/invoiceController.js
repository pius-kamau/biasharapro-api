const { query, getClient } = require("../config/database");
const etimsService = require("../services/etimsService");
const emailService = require("../services/emailService");
const pdfService = require("../services/pdfService");

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

    // Validate
    if (!customerName || !items || items.length === 0) {
      return res
        .status(400)
        .json({ error: "Customer name and at least one item required" });
    }

    // Log the email to debug
    console.log("Creating invoice for:", customerName, "Email:", customerEmail);

    // Calculate totals
    let subtotal = 0;
    let vatAmount = 0;

    const invoiceItems = [];

    for (const item of items) {
      // Get product to verify stock and get details
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

      // Check stock
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

    // Start transaction
    client = await getClient();
    await client.query("BEGIN");

    // Create invoice - customerEmail is correctly included
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

    // Create invoice items and update stock
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

      // Reduce stock
      await client.query(
        "UPDATE products SET stock_quantity = stock_quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [item.quantity, item.productId],
      );
    }

    await client.query("COMMIT");

    // Send email with invoice (don't await to avoid blocking)
    try {
      const businessInfo = await query(
        "SELECT name, email, kra_pin FROM businesses WHERE id = $1",
        [businessId],
      );

      const invoiceData = invoiceResult.rows[0];

      // Only send email if customer email exists
      if (invoiceData.customer_email) {
        console.log("Sending invoice email to:", invoiceData.customer_email);

        // Try to generate PDF, but don't fail if it doesn't work
        let pdfBuffer = null;
        try {
          pdfBuffer = await pdfService.generateInvoicePDF(
            invoiceData,
            businessInfo.rows[0],
            invoiceItems,
          );
        } catch (pdfError) {
          console.error(
            "PDF generation error, sending without PDF:",
            pdfError.message,
          );
        }

        // Call email service WITHOUT pdfBuffer to avoid timeout
        await emailService.sendInvoiceEmail(
          invoiceData,
          businessInfo.rows[0],
          // pdfBuffer,  // COMMENTED OUT - remove PDF to fix timeout
        );
        console.log("✅ Invoice email sent to:", invoiceData.customer_email);
      } else {
        console.log("No customer email provided, skipping email");
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
    res.status(500).json({
      error: "Failed to create invoice",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get all invoices for business
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

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error("Get invoices error:", error);
    res.status(500).json({
      error: "Failed to get invoices",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get single invoice with items
const getInvoiceById = async (req, res) => {
  try {
    const { businessId } = req.user;
    const { id } = req.params;

    // Get invoice
    const invoiceResult = await query(
      `SELECT * FROM invoices WHERE id = $1 AND business_id = $2`,
      [id, businessId],
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    // Get invoice items
    const itemsResult = await query(
      `SELECT id, product_name, quantity, unit_price, vat_rate, vat_amount, total
       FROM invoice_items
       WHERE invoice_id = $1`,
      [id],
    );

    const invoice = invoiceResult.rows[0];
    invoice.items = itemsResult.rows;

    res.json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    console.error("Get invoice error:", error);
    res.status(500).json({
      error: "Failed to get invoice",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Record payment for an invoice
const recordPayment = async (req, res) => {
  try {
    const { businessId } = req.user;
    const { id } = req.params;
    const { amount, paymentMethod, reference } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Valid amount required" });
    }

    // Get invoice
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

    // Update invoice
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

      // Only send receipt if customer has email
      if (invoice.customer_email) {
        console.log("Sending receipt email to:", invoice.customer_email);
        await emailService.sendReceiptEmail(invoice, businessInfo.rows[0], {
          amount: amount,
          payment_method: paymentMethod || "cash",
          mpesa_receipt_number: reference,
        });
        console.log("✅ Receipt email sent to:", invoice.customer_email);
      } else {
        console.log("No customer email, skipping receipt email");
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
    res.status(500).json({
      error: "Failed to record payment",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Submit invoice to eTIMS
const submitToETIMS = async (req, res) => {
  const client = await getClient();

  try {
    const { id } = req.params;
    const { businessId } = req.user;

    // Get invoice with business details
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

    // Check if already submitted
    if (invoice.etims_status === "submitted") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Invoice already submitted to eTIMS",
        data: {
          etimsReference: invoice.etims_reference,
          submittedAt: invoice.etims_submitted_at,
        },
      });
    }

    // Get invoice items with product details
    const itemsResult = await client.query(
      `SELECT ii.*, p.name as product_name, p.sku
       FROM invoice_items ii
       LEFT JOIN products p ON ii.product_id = p.id
       WHERE ii.invoice_id = $1`,
      [id],
    );

    const items = itemsResult.rows;

    // Submit to eTIMS
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
      // Update invoice with eTIMS response
      await client.query(
        `UPDATE invoices 
         SET etims_invoice_number = $1,
             etims_reference = $2,
             etims_qr_code = $3,
             etims_submitted_at = CURRENT_TIMESTAMP,
             etims_status = 'submitted',
             etims_error_message = NULL
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
        data: {
          etimsReference: etimsResult.etimsReference,
          etimsInvoiceNumber: etimsResult.etimsInvoiceNumber,
          qrCode: etimsResult.qrCode,
        },
      });
    } else {
      // Update with failure
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
        retryable: etimsResult.retryable !== false,
      });
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("eTIMS submission error:", error);
    res.status(500).json({
      error: "Failed to submit to eTIMS",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    client.release();
  }
};

// Get eTIMS status for invoice
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

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Get eTIMS status error:", error);
    res.status(500).json({ error: "Failed to get eTIMS status" });
  }
};

// Retry failed eTIMS submission
const retryETIMS = async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId } = req.user;

    // Check if invoice can be retried
    const invoiceCheck = await query(
      `SELECT etims_status, etims_retry_count 
       FROM invoices 
       WHERE id = $1 AND business_id = $2`,
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

    // Call submit again
    req.params.id = id;
    await submitToETIMS(req, res);
  } catch (error) {
    console.error("Retry eTIMS error:", error);
    res.status(500).json({ error: "Failed to retry eTIMS submission" });
  }
};

module.exports = {
  createInvoice,
  getInvoices,
  getInvoiceById,
  recordPayment,
  submitToETIMS,
  getETIMSStatus,
  retryETIMS,
};
