const axios = require("axios");

class MpesaService {
  constructor() {
    this.consumerKey = process.env.MPESA_CONSUMER_KEY;
    this.consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    this.passkey = process.env.MPESA_PASSKEY;
    this.shortcode = process.env.MPESA_SHORTCODE;
    this.environment = process.env.MPESA_ENVIRONMENT || "sandbox";

    this.baseUrl =
      this.environment === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";
  }

  async getAccessToken() {
    const auth = Buffer.from(
      `${this.consumerKey}:${this.consumerSecret}`,
    ).toString("base64");

    try {
      const response = await axios.get(
        `${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        {
          headers: {
            Authorization: `Basic ${auth}`,
          },
        },
      );
      return response.data.access_token;
    } catch (error) {
      console.error(
        "M-Pesa token error:",
        error.response?.data || error.message,
      );
      throw new Error("Failed to get M-Pesa access token");
    }
  }

  async stkPush(phoneNumber, amount, accountReference, transactionDesc) {
    const token = await this.getAccessToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, -3);
    const password = Buffer.from(
      `${this.shortcode}${this.passkey}${timestamp}`,
    ).toString("base64");

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
      TransactionDesc: transactionDesc.substring(0, 13),
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/mpesa/stkpush/v1/processrequest`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      return {
        success: true,
        checkoutRequestId: response.data.CheckoutRequestID,
        responseCode: response.data.ResponseCode,
        customerMessage: response.data.CustomerMessage,
      };
    } catch (error) {
      console.error("STK Push error:", error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errorMessage || error.message,
      };
    }
  }

  async queryStatus(checkoutRequestId) {
    const token = await this.getAccessToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, -3);
    const password = Buffer.from(
      `${this.shortcode}${this.passkey}${timestamp}`,
    ).toString("base64");

    const payload = {
      BusinessShortCode: this.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/mpesa/stkpushquery/v1/query`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return {
        success: true,
        resultCode: response.data.ResultCode,
        resultDesc: response.data.ResultDesc,
        mpesaReceiptNumber:
          response.data.ResultCode === "0"
            ? response.data.MpesaReceiptNumber
            : null,
      };
    } catch (error) {
      console.error("STK Query error:", error.response?.data || error.message);
      throw new Error("Failed to query payment status");
    }
  }
}

module.exports = new MpesaService();
