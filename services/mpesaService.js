const axios = require('axios');
const crypto = require('crypto');

class MpesaService {
    constructor() {
        this.consumerKey = process.env.MPESA_CONSUMER_KEY;
        this.consumerSecret = process.env.MPESA_CONSUMER_SECRET;
        this.passkey = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
        this.shortcode = process.env.MPESA_SHORTCODE || '174379';
        this.environment = process.env.MPESA_ENVIRONMENT || 'sandbox';
        
        this.baseUrl = this.environment === 'production'
            ? 'https://api.safaricom.co.ke'
            : 'https://sandbox.safaricom.co.ke';
    }

    async getAccessToken() {
        const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
        
        try {
            const response = await axios.get(
                `${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
                {
                    headers: {
                        Authorization: `Basic ${auth}`,
                    },
                }
            );
            return response.data.access_token;
        } catch (error) {
            console.error('M-Pesa token error:', error.response?.data || error.message);
            throw new Error('Failed to get M-Pesa access token');
        }
    }

    async stkPush(phoneNumber, amount, accountReference, transactionDesc) {
        try {
            const token = await this.getAccessToken();
            
            // Generate timestamp in format YYYYMMDDHHMMSS
            const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
            
            // Generate password: shortcode + passkey + timestamp
            const passwordString = `${this.shortcode}${this.passkey}${timestamp}`;
            const password = Buffer.from(passwordString).toString('base64');
            
            const payload = {
                BusinessShortCode: this.shortcode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: "CustomerPayBillOnline",
                Amount: Math.round(amount),
                PartyA: phoneNumber,
                PartyB: this.shortcode,
                PhoneNumber: phoneNumber,
                CallBackURL: `${process.env.APP_URL}/api/mpesa/callback`,
                AccountReference: accountReference.substring(0, 12),
                TransactionDesc: transactionDesc.substring(0, 13)
            };
            
            console.log('STK Push Payload:', JSON.stringify(payload, null, 2));
            
            const response = await axios.post(
                `${this.baseUrl}/mpesa/stkpush/v1/processrequest`,
                payload,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            
            return {
                success: true,
                checkoutRequestId: response.data.CheckoutRequestID,
                responseCode: response.data.ResponseCode,
                responseDescription: response.data.ResponseDescription,
                customerMessage: response.data.CustomerMessage
            };
        } catch (error) {
            console.error('STK Push error details:', error.response?.data);
            return {
                success: false,
                error: error.response?.data?.errorMessage || error.message,
                responseCode: error.response?.data?.ResponseCode || '500'
            };
        }
    }
}

module.exports = new MpesaService();