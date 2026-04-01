class RedisService {
  constructor() {
    this.url = process.env.UPSTASH_REDIS_URL;
    this.token = process.env.UPSTASH_REDIS_TOKEN;
    this.init();
  }

  init() {
    if (this.url && this.token) {
      console.log("✅ Redis connected (Upstash REST API)");
    } else {
      console.log("⚠️ Redis not configured - using memory fallback");
    }
  }

  async _request(command, args = []) {
    if (!this.url || !this.token) {
      return { success: true, simulated: true };
    }

    try {
      const response = await fetch(`${this.url}/${command}/${args.join("/")}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Redis error:", error.message);
      return { error: error.message };
    }
  }

  // Store processed transaction (idempotency)
  async markTransactionProcessed(transactionId, data, ttlSeconds = 86400) {
    if (!this.url || !this.token) {
      console.log(`[SIM] Would store tx: ${transactionId}`);
      return { success: true, simulated: true };
    }

    try {
      await fetch(`${this.url}/setex/${transactionId}/${ttlSeconds}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });
      return { success: true };
    } catch (error) {
      console.error("Redis set error:", error);
      return { success: false, error: error.message };
    }
  }

  // Check if transaction already processed
  async isTransactionProcessed(transactionId) {
    if (!this.url || !this.token) return false;

    try {
      const response = await fetch(`${this.url}/exists/${transactionId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const data = await response.json();
      return data.result === 1;
    } catch (error) {
      console.error("Redis exists error:", error);
      return false;
    }
  }

  // Get transaction data
  async getTransaction(transactionId) {
    if (!this.url || !this.token) return null;

    try {
      const response = await fetch(`${this.url}/get/${transactionId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const data = await response.json();
      return data.result ? JSON.parse(data.result) : null;
    } catch (error) {
      console.error("Redis get error:", error);
      return null;
    }
  }

  // Store M-Pesa checkout request
  async storeCheckoutRequest(checkoutRequestId, invoiceId, amount) {
    if (!this.url || !this.token) {
      console.log(`[SIM] Would store checkout: ${checkoutRequestId}`);
      return { success: true, simulated: true };
    }

    try {
      await fetch(`${this.url}/setex/${checkoutRequestId}/3600`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ invoiceId, amount, status: "pending" }),
      });
      return { success: true };
    } catch (error) {
      console.error("Redis set error:", error);
      return { success: false, error: error.message };
    }
  }

  // Update checkout request status
  async updateCheckoutStatus(checkoutRequestId, status, receiptNumber = null) {
    if (!this.url || !this.token) return { success: true, simulated: true };

    try {
      const data = await this.getTransaction(checkoutRequestId);
      if (data) {
        data.status = status;
        if (receiptNumber) data.receiptNumber = receiptNumber;
        await fetch(`${this.url}/setex/${checkoutRequestId}/3600`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        });
      }
      return { success: true };
    } catch (error) {
      console.error("Redis update error:", error);
      return { success: false, error: error.message };
    }
  }

  // Get checkout request
  async getCheckoutRequest(checkoutRequestId) {
    return await this.getTransaction(checkoutRequestId);
  }
}

module.exports = new RedisService();
