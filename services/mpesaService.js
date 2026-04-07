const axios = require("axios");
const crypto = require("crypto");

const getAccessToken = async () => {
  try {
    const auth = Buffer.from(
      `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`,
    ).toString("base64");

    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      },
    );

    return response.data.access_token;
  } catch (error) {
    console.error("Get access token error:", error);
    throw error;
  }
};

const stkPush = async (
  phoneNumber,
  amount,
  accountReference,
  transactionDesc,
  callbackURL = null,
) => {
  try {
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);
    const password = Buffer.from(
      `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`,
    ).toString("base64");

    // Use provided callback URL or fallback to environment variable
    const finalCallbackURL =
      callbackURL || `${process.env.BASE_URL}/api/mpesa/callback`;

    console.log("STK Push Callback URL:", finalCallbackURL);

    const data = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phoneNumber,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: phoneNumber,
      CallBackURL: finalCallbackURL,
      AccountReference: accountReference.substring(0, 12),
      TransactionDesc: transactionDesc.substring(0, 13),
    };

    console.log("STK Push Request:", JSON.stringify(data, null, 2));

    const accessToken = await getAccessToken();

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      data,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log("STK Push Response:", JSON.stringify(response.data, null, 2));

    if (response.data.ResponseCode === "0") {
      return {
        success: true,
        checkoutRequestId: response.data.CheckoutRequestID,
        merchantRequestId: response.data.MerchantRequestID,
        responseCode: response.data.ResponseCode,
        responseDescription: response.data.ResponseDescription,
      };
    } else {
      return {
        success: false,
        error: response.data.ResponseDescription || "STK push failed",
        responseCode: response.data.ResponseCode,
      };
    }
  } catch (error) {
    console.error("STK Push error:", error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.errorMessage || error.message,
    };
  }
};

module.exports = { stkPush, getAccessToken };
