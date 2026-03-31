const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const {
  getInvoices,
  getInvoiceById,
  createInvoice,
  recordPayment,
} = require("../controllers/invoiceController");

// All invoice routes require authentication
router.use(authenticate);

// Basic routes
router.get("/", getInvoices);
router.get("/:id", getInvoiceById);
router.post("/", authorize("owner", "accountant"), createInvoice);
router.post(
  "/:id/pay",
  authorize("owner", "accountant", "cashier"),
  recordPayment,
);

module.exports = router;
