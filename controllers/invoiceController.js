const { query, getClient } = require("../config/database");
const emailService = require("../services/emailService");

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

    console.log("Creating invoice for:", customerName, "Email:", customerEmail);

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
        console.log("Sending invoice email to:", invoiceData.customer_email);
        await emailService.sendInvoiceEmail(invoiceData, businessInfo.rows[0]);
        console.log("✅ Invoice email sent to:", invoiceData.customer_email);
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
        console.log("Sending receipt email to:", invoice.customer_email);
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
    res.status(500).json({
      error: "Failed to record payment",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  createInvoice,
  getInvoices,
  getInvoiceById,
  recordPayment,
};
