const { query } = require('../config/database');

// Create a new product
const createProduct = async (req, res) => {
    try {
        const { businessId } = req.user;
        const { name, sku, description, buyingPrice, sellingPrice, stockQuantity, reorderLevel } = req.body;

        // Validate required fields
        if (!name || !sellingPrice) {
            return res.status(400).json({ error: 'Name and selling price are required' });
        }

        // Create product
        const result = await query(
            `INSERT INTO products (business_id, name, sku, description, buying_price, selling_price, stock_quantity, reorder_level)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, name, sku, selling_price, stock_quantity`,
            [businessId, name, sku, description, buyingPrice || 0, sellingPrice, stockQuantity || 0, reorderLevel || 5]
        );

        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Create product error:', error);
        
        // Check for duplicate SKU
        if (error.code === '23505') { // PostgreSQL unique violation
            return res.status(409).json({ error: 'Product with this SKU already exists' });
        }
        
        res.status(500).json({ 
            error: 'Failed to create product', 
            details: process.env.NODE_ENV === 'development' ? error.message : undefined 
        });
    }
};

// Get all products for a business
const getProducts = async (req, res) => {
    try {
        const { businessId } = req.user;
        
        const result = await query(
            `SELECT id, name, sku, description, buying_price, selling_price, stock_quantity, reorder_level, created_at
             FROM products
             WHERE business_id = $1
             ORDER BY created_at DESC`,
            [businessId]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({ 
            error: 'Failed to get products', 
            details: process.env.NODE_ENV === 'development' ? error.message : undefined 
        });
    }
};

// Get single product by ID
const getProductById = async (req, res) => {
    try {
        const { businessId } = req.user;
        const { id } = req.params;
        
        const result = await query(
            `SELECT id, name, sku, description, buying_price, selling_price, stock_quantity, reorder_level, created_at
             FROM products
             WHERE id = $1 AND business_id = $2`,
            [id, businessId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Get product error:', error);
        res.status(500).json({ 
            error: 'Failed to get product', 
            details: process.env.NODE_ENV === 'development' ? error.message : undefined 
        });
    }
};
// Update product
const updateProduct = async (req, res) => {
    try {
        const { businessId } = req.user;
        const { id } = req.params;
        const { name, sku, description, buyingPrice, sellingPrice, stockQuantity, reorderLevel } = req.body;

        // Check if product exists and belongs to this business
        const existingProduct = await query(
            'SELECT id FROM products WHERE id = $1 AND business_id = $2',
            [id, businessId]
        );

        if (existingProduct.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Build dynamic update query
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramCount++}`);
            values.push(name);
        }
        if (sku !== undefined) {
            updates.push(`sku = $${paramCount++}`);
            values.push(sku);
        }
        if (description !== undefined) {
            updates.push(`description = $${paramCount++}`);
            values.push(description);
        }
        if (buyingPrice !== undefined) {
            updates.push(`buying_price = $${paramCount++}`);
            values.push(buyingPrice);
        }
        if (sellingPrice !== undefined) {
            updates.push(`selling_price = $${paramCount++}`);
            values.push(sellingPrice);
        }
        if (stockQuantity !== undefined) {
            updates.push(`stock_quantity = $${paramCount++}`);
            values.push(stockQuantity);
        }
        if (reorderLevel !== undefined) {
            updates.push(`reorder_level = $${paramCount++}`);
            values.push(reorderLevel);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(id, businessId);

        const queryText = `
            UPDATE products 
            SET ${updates.join(', ')}
            WHERE id = $${paramCount} AND business_id = $${paramCount + 1}
            RETURNING id, name, sku, selling_price, stock_quantity
        `;

        const result = await query(queryText, values);

        res.json({
            success: true,
            message: 'Product updated successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Update product error:', error);
        
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Product with this SKU already exists' });
        }
        
        res.status(500).json({ 
            error: 'Failed to update product', 
            details: process.env.NODE_ENV === 'development' ? error.message : undefined 
        });
    }
};
// Check and send low stock alerts
const checkLowStockAndAlert = async (businessId) => {
    try {
        const result = await query(
            `SELECT name, sku, stock_quantity, reorder_level 
             FROM products 
             WHERE business_id = $1 AND stock_quantity <= reorder_level`,
            [businessId]
        );
        
        if (result.rows.length > 0) {
            const business = await query(
                'SELECT name, email FROM businesses WHERE id = $1',
                [businessId]
            );
            await emailService.sendLowStockAlert(business.rows[0], result.rows);
        }
    } catch (error) {
        console.error('Low stock check error:', error);
    }
};

// Call this after any stock update
// In updateProduct, updateStock, etc.
// Delete product
const deleteProduct = async (req, res) => {
    try {
        const { businessId } = req.user;
        const { id } = req.params;

        const result = await query(
            'DELETE FROM products WHERE id = $1 AND business_id = $2 RETURNING id, name',
            [id, businessId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json({
            success: true,
            message: 'Product deleted successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ 
            error: 'Failed to delete product', 
            details: process.env.NODE_ENV === 'development' ? error.message : undefined 
        });
    }
};

module.exports = { 
    createProduct, 
    getProducts, 
    getProductById, 
    updateProduct,   
    deleteProduct    
};