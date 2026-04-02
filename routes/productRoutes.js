const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { query } = require("../config/database");

// Get all products
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

// Get single product
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

// Create product
router.post(
  "/",
  authenticate,
  authorize("owner", "accountant"),
  async (req, res) => {
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
  },
);

// Update product
router.put(
  "/:id",
  authenticate,
  authorize("owner", "accountant"),
  async (req, res) => {
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
  },
);

// Delete product
router.delete(
  "/:id",
  authenticate,
  authorize("owner", "accountant"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { businessId } = req.user;

      // Check if product exists
      const product = await query(
        "SELECT id, name FROM products WHERE id = $1 AND business_id = $2",
        [id, businessId],
      );

      if (product.rows.length === 0) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Check if product has been used in invoices
      const usedInInvoices = await query(
        "SELECT id FROM invoice_items WHERE product_id = $1 LIMIT 1",
        [id],
      );

      if (usedInInvoices.rows.length > 0) {
        // Soft delete - just mark inactive
        await query("UPDATE products SET is_active = false WHERE id = $1", [
          id,
        ]);
        return res.json({
          success: true,
          message: "Product deactivated (used in invoices)",
        });
      }

      // Hard delete if not used
      await query("DELETE FROM products WHERE id = $1", [id]);
      res.json({ success: true, message: "Product deleted successfully" });
    } catch (error) {
      console.error("Delete product error:", error);
      res.status(500).json({ error: "Failed to delete product" });
    }
  },
);

module.exports = router;
