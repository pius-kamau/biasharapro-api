const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { query } = require("../config/database");

// Get all products - All authenticated users can view
router.get("/", authenticate, async (req, res) => {
  try {
    const { businessId } = req.user;
    const result = await query(
      "SELECT * FROM products WHERE business_id = $1 ORDER BY created_at DESC",
      [businessId],
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get products error:", error);
    res.status(500).json({ error: "Failed to get products" });
  }
});

// Get single product - All authenticated users can view
router.get("/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId } = req.user;
    const result = await query(
      "SELECT * FROM products WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Get product error:", error);
    res.status(500).json({ error: "Failed to get product" });
  }
});

// Create product - Only Owner and Accountant? Actually, only Owner should add products
// Accountant should NOT add products. Let's restrict to Owner only
router.post("/", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { businessId } = req.user;
    const {
      name,
      sku,
      buyingPrice,
      sellingPrice,
      stockQuantity,
      reorderLevel,
      category,
      description,
    } = req.body;

    if (!name || !sellingPrice) {
      return res
        .status(400)
        .json({ error: "Name and selling price are required" });
    }

    const productSku = sku || `PROD-${Date.now()}`;

    const result = await query(
      `INSERT INTO products (business_id, name, sku, buying_price, selling_price, stock_quantity, reorder_level, category, description)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
      [
        businessId,
        name,
        productSku,
        buyingPrice || 0,
        sellingPrice,
        stockQuantity || 0,
        reorderLevel || 5,
        category,
        description,
      ],
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Create product error:", error);
    res.status(500).json({ error: "Failed to create product" });
  }
});

// Update product - Only Owner (Accountant should NOT edit products)
router.put("/:id", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId } = req.user;
    const {
      name,
      sku,
      buyingPrice,
      sellingPrice,
      stockQuantity,
      reorderLevel,
      category,
      description,
      isActive,
    } = req.body;

    const result = await query(
      `UPDATE products 
             SET name = COALESCE($1, name),
                 sku = COALESCE($2, sku),
                 buying_price = COALESCE($3, buying_price),
                 selling_price = COALESCE($4, selling_price),
                 stock_quantity = COALESCE($5, stock_quantity),
                 reorder_level = COALESCE($6, reorder_level),
                 category = COALESCE($7, category),
                 description = COALESCE($8, description),
                 is_active = COALESCE($9, is_active),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $10 AND business_id = $11
             RETURNING *`,
      [
        name,
        sku,
        buyingPrice,
        sellingPrice,
        stockQuantity,
        reorderLevel,
        category,
        description,
        isActive,
        id,
        businessId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Update product error:", error);
    res.status(500).json({ error: "Failed to update product" });
  }
});

// Delete product - Only Owner
router.delete("/:id", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId } = req.user;

    const product = await query(
      "SELECT id, name FROM products WHERE id = $1 AND business_id = $2",
      [id, businessId],
    );

    if (product.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    const usedInInvoices = await query(
      "SELECT id FROM invoice_items WHERE product_id = $1 LIMIT 1",
      [id],
    );

    if (usedInInvoices.rows.length > 0) {
      await query("UPDATE products SET is_active = false WHERE id = $1", [id]);
      return res.json({
        success: true,
        message: "Product deactivated (used in invoices)",
      });
    }

    await query("DELETE FROM products WHERE id = $1", [id]);
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

// Update stock - Only Owner and Accountant? Accountant might need to adjust stock
// Let's allow Accountant to update stock but not add/delete products
router.patch(
  "/:id/stock",
  authenticate,
  authorize("owner", "accountant"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { businessId } = req.user;
      const { quantity, type, reason } = req.body;

      if (!quantity || !type) {
        return res
          .status(400)
          .json({ error: "Quantity and type are required" });
      }

      const product = await query(
        "SELECT stock_quantity FROM products WHERE id = $1 AND business_id = $2",
        [id, businessId],
      );

      if (product.rows.length === 0) {
        return res.status(404).json({ error: "Product not found" });
      }

      let newStock;
      if (type === "add") {
        newStock = product.rows[0].stock_quantity + quantity;
      } else if (type === "remove") {
        if (product.rows[0].stock_quantity < quantity) {
          return res.status(400).json({ error: "Insufficient stock" });
        }
        newStock = product.rows[0].stock_quantity - quantity;
      } else {
        return res
          .status(400)
          .json({ error: 'Type must be "add" or "remove"' });
      }

      const result = await query(
        `UPDATE products SET stock_quantity = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND business_id = $3
             RETURNING *`,
        [newStock, id, businessId],
      );

      res.json({
        success: true,
        message: "Stock updated",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Update stock error:", error);
      res.status(500).json({ error: "Failed to update stock" });
    }
  },
);

module.exports = router;
