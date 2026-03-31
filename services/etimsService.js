const axios = require('axios');
const crypto = require('crypto');

class ETIMSService {
    constructor() {
        this.apiKey = process.env.KRA_ETIMS_API_KEY;
        this.certPath = process.env.KRA_ETIMS_CERT_PATH;
        this.environment = process.env.KRA_ENVIRONMENT || 'sandbox';
        
        this.baseUrl = this.environment === 'production'
            ? 'https://etims.kra.go.ke/api'
            : 'https://etims-sandbox.kra.go.ke/api';
            
        console.log('eTIMS Service Initialized:');
        console.log(`  Environment: ${this.environment}`);
        console.log(`  Base URL: ${this.baseUrl}`);
    }

    // Generate invoice payload for KRA
    generateInvoicePayload(invoice, business, items) {
        return {
            invoiceNumber: invoice.invoice_number,
            invoiceDate: invoice.issue_date,
            supplier: {
                kraPin: business.kra_pin,
                name: business.name,
                email: business.email,
                phone: business.phone
            },
            customer: {
                kraPin: invoice.customer_kra || 'N/A',
                name: invoice.customer_name,
                email: invoice.customer_email,
                phone: invoice.customer_phone
            },
            items: items.map(item => ({
                itemCode: item.sku || item.product_id,
                itemName: item.product_name || item.description,
                quantity: item.quantity,
                unitPrice: item.unit_price,
                discount: item.discount || 0,
                vatRate: item.vat_rate,
                vatAmount: item.vat_amount,
                total: item.total
            })),
            subtotal: invoice.subtotal,
            vatAmount: invoice.vat_amount,
            totalAmount: invoice.total_amount,
            currency: 'KES'
        };
    }

    // Submit invoice to KRA eTIMS
    async submitInvoice(invoice, business, items) {
        try {
            const payload = this.generateInvoicePayload(invoice, business, items);
            
            console.log('Submitting invoice to KRA eTIMS...');
            console.log(`  Invoice: ${invoice.invoice_number}`);
            console.log(`  Amount: KES ${invoice.total_amount}`);
            
            // In sandbox mode, simulate submission
            if (this.environment === 'sandbox') {
                console.log('  [SANDBOX] Simulating eTIMS submission');
                
                // Simulate successful submission
                const simulatedResponse = {
                    success: true,
                    etimsReference: `KRA${Date.now()}${Math.random().toString(36).substring(7).toUpperCase()}`,
                    etimsInvoiceNumber: `INV${Date.now()}`,
                    qrCode: this.generateQRCodeData(invoice.invoice_number),
                    message: 'Invoice submitted to KRA eTIMS (Sandbox)'
                };
                
                return simulatedResponse;
            }
            
            // Production mode - actual API call
            const response = await axios({
                method: 'POST',
                url: `${this.baseUrl}/v1/invoices/submit`,
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'X-Request-ID': crypto.randomUUID()
                },
                data: payload,
                timeout: 30000
            });
            
            return {
                success: true,
                etimsReference: response.data.reference,
                etimsInvoiceNumber: response.data.invoiceNumber,
                qrCode: response.data.qrCode,
                message: 'Invoice submitted successfully'
            };
            
        } catch (error) {
            console.error('eTIMS submission error:', error.response?.data || error.message);
            
            return {
                success: false,
                error: error.response?.data?.message || error.message,
                retryable: error.response?.status >= 500
            };
        }
    }

    // Generate QR code data (for sandbox)
    generateQRCodeData(invoiceNumber) {
        // This would be a real QR code from KRA in production
        return JSON.stringify({
            invoiceNumber: invoiceNumber,
            kraVerified: true,
            timestamp: new Date().toISOString(),
            verificationUrl: `${this.baseUrl}/verify/${invoiceNumber}`
        });
    }

    // Verify invoice with KRA
    async verifyInvoice(etimsReference) {
        try {
            if (this.environment === 'sandbox') {
                return {
                    success: true,
                    verified: true,
                    message: 'Invoice verified (Sandbox)'
                };
            }
            
            const response = await axios({
                method: 'GET',
                url: `${this.baseUrl}/v1/invoices/verify/${etimsReference}`,
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            
            return {
                success: true,
                verified: response.data.verified,
                details: response.data
            };
            
        } catch (error) {
            console.error('Verification error:', error.message);
            return {
                success: false,
                verified: false,
                error: error.message
            };
        }
    }
}

module.exports = new ETIMSService();