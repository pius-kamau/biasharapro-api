const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth"); // Add authorize here
const { query } = require("../config/database");
const {
  createProduct,
  getProducts,
  getProductById,
  updateProduct, // Add this
  deleteProduct, // Add this
} = require("../controllers/productController");

const router = express.Router();

// All product routes require authentication
router.use(authenticate);

// Routes
router.post("/", createProduct); // Create product
router.get("/", getProducts); // Get all products
router.get("/:id", getProductById); // Get single product
router.put("/:id", updateProduct); // Update product (ADD THIS)
router.delete("/:id", deleteProduct); // Delete product (ADD THIS)

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
