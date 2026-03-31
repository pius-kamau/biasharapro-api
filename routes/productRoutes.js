const express = require('express');
const { authenticate } = require('../middleware/auth');
const { 
    createProduct, 
    getProducts, 
    getProductById, 
    updateProduct,    // Add this
    deleteProduct     // Add this
} = require('../controllers/productController');

const router = express.Router();

// All product routes require authentication
router.use(authenticate);

// Routes
router.post('/', createProduct);           // Create product
router.get('/', getProducts);              // Get all products
router.get('/:id', getProductById);        // Get single product
router.put('/:id', updateProduct);         // Update product (ADD THIS)
router.delete('/:id', deleteProduct);      // Delete product (ADD THIS)

module.exports = router;