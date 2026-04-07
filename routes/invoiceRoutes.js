const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { query } = require("../config/database");

// Get all invoices
router.get("/", authenticate, async (req, res) => {
  try {
    const { businessId } = req.user;
    const result = await query(
      `SELECT id, invoice_number, customer_name, total_amount, amount_paid, status, created_at
       FROM invoices
       WHERE business_id = $1
       ORDER BY created_at DESC`,
      [businessId],
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get invoices error:", error);
    res.status(500).json({ error: "Failed to get invoices" });
  }
});

// Get single invoice
router.get("/:id", authenticate, async (req, res) => {
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
      `SELECT product_name, quantity, unit_price, total
       FROM invoice_items
       WHERE invoice_id = $1`,
      [id],
    );

    invoiceResult.rows[0].items = itemsResult.rows;
    res.json({ success: true, data: invoiceResult.rows[0] });
  } catch (error) {
    console.error("Get invoice error:", error);
    res.status(500).json({ error: "Failed to get invoice" });
  }
});

// Create invoice
router.post(
  "/",
  authenticate,
  authorize("owner", "accountant", "cashier"),
  async (req, res) => {
    try {
      const { businessId } = req.user;
      const { customerName, items } = req.body;

      if (!customerName || !items || items.length === 0) {
        return res
          .status(400)
          .json({ error: "Customer name and items required" });
      }

      let subtotal = 0;
      for (const item of items) {
        subtotal += item.quantity * item.unitPrice;
      }
      const vatAmount = subtotal * 0.16;
      const totalAmount = subtotal + vatAmount;
      const invoiceNumber = `INV-${Date.now()}`;

      const result = await query(
        `INSERT INTO invoices (business_id, invoice_number, customer_name, subtotal, vat_amount, total_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id, invoice_number`,
        [
          businessId,
          invoiceNumber,
          customerName,
          subtotal,
          vatAmount,
          totalAmount,
        ],
      );

      res.status(201).json({
        success: true,
        message: "Invoice created successfully",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Create invoice error:", error);
      res.status(500).json({ error: "Failed to create invoice" });
    }
  },
);

// Record payment
router.post(
  "/:id/pay",
  authenticate,
  authorize("owner", "accountant", "cashier"),
  async (req, res) => {
    try {
      const { businessId } = req.user;
      const { id } = req.params;
      const { amount } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Valid amount required" });
      }

      const invoiceResult = await query(
        "SELECT total_amount, amount_paid FROM invoices WHERE id = $1 AND business_id = $2",
        [id, businessId],
      );

      if (invoiceResult.rows.length === 0) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      const invoice = invoiceResult.rows[0];
      const newAmountPaid =
        parseFloat(invoice.amount_paid) + parseFloat(amount);
      const newStatus =
        newAmountPaid >= invoice.total_amount ? "paid" : "pending";

      await query(
        `UPDATE invoices 
       SET amount_paid = $1, status = $2 
       WHERE id = $3`,
        [newAmountPaid, newStatus, id],
      );

      res.json({
        success: true,
        message: `Payment of ${amount} recorded successfully`,
      });
    } catch (error) {
      console.error("Record payment error:", error);
      res.status(500).json({ error: "Failed to record payment" });
    }
  },
);

// Delete invoice
router.delete("/:id", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { businessId } = req.user;
    const { id } = req.params;

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

// Get transactions (NEW ENDPOINT)
router.get("/transactions", authenticate, async (req, res) => {
  try {
    const { businessId } = req.user;
    const result = await query(
      `SELECT t.*, i.invoice_number, i.customer_name
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

module.exports = router;
