const nodemailer = require("nodemailer");
const dns = require("dns");

// Force IPv4 for all DNS lookups
dns.setDefaultResultOrder("ipv4first");

class EmailService {
  constructor() {
    this.transporter = null;
    this.init();
  }

  init() {
    // Configure email transporter - use Gmail with IPv4 fix
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      this.transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
        tls: {
          rejectUnauthorized: false,
        },
        // Force IPv4
        family: 4,
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 30000,
      });

      // Verify connection
      this.transporter.verify((error, success) => {
        if (error) {
          console.error("⚠️ Gmail SMTP failed:", error.message);
        } else {
          console.log("✅ Email service initialized with Gmail SMTP (IPv4)");
        }
      });
    } else {
      console.log("⚠️ Email not configured - check EMAIL_USER and EMAIL_PASS");
    }
  }

  // Send invoice email - NO PDF ATTACHMENT
  async sendInvoiceEmail(invoice, business, pdfBuffer = null) {
    try {
      const customerEmail = invoice.customer_email;
      if (!customerEmail) {
        console.log("No customer email, skipping");
        return { success: false, message: "No customer email" };
      }

      const subject = `Invoice ${invoice.invoice_number} from ${business.name}`;
      const html = this.generateInvoiceHTML(invoice, business);

      const mailOptions = {
        from: `"${business.name}" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        subject: subject,
        html: html,
        // Add headers to avoid spam
        headers: {
          "X-Priority": "3",
          "X-Mailer": "BiasharaPro",
        },
      };

      if (this.transporter) {
        const info = await this.transporter.sendMail(mailOptions);
        console.log(`✅ Invoice email sent to ${customerEmail}`);
        return { success: true };
      } else {
        console.log("📧 [SIMULATION] Would send email to:", customerEmail);
        return { success: true, simulated: true };
      }
    } catch (error) {
      console.error("Email error:", error.message);
      return { success: false, error: error.message };
    }
  }

  // Send receipt email
  async sendReceiptEmail(invoice, business, payment) {
    try {
      const customerEmail = invoice.customer_email;
      if (!customerEmail) {
        return { success: false, message: "No customer email" };
      }

      const subject = `Payment Receipt - Invoice ${invoice.invoice_number}`;
      const html = this.generateReceiptHTML(invoice, business, payment);

      const mailOptions = {
        from: `"${business.name}" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        subject: subject,
        html: html,
        headers: {
          "X-Priority": "3",
          "X-Mailer": "BiasharaPro",
        },
      };

      if (this.transporter) {
        await this.transporter.sendMail(mailOptions);
        console.log(`✅ Receipt email sent to ${customerEmail}`);
        return { success: true };
      } else {
        console.log("📧 [SIMULATION] Receipt would be sent");
        return { success: true, simulated: true };
      }
    } catch (error) {
      console.error("Receipt error:", error.message);
      return { success: false, error: error.message };
    }
  }

  // Send welcome email
  async sendWelcomeEmail(user, business) {
    try {
      const subject = `Welcome to ${business.name} - BiasharaPro`;
      const html = this.generateWelcomeHTML(user, business);

      const mailOptions = {
        from: `"BiasharaPro" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: subject,
        html: html,
        headers: {
          "X-Priority": "3",
          "X-Mailer": "BiasharaPro",
        },
      };

      if (this.transporter) {
        await this.transporter.sendMail(mailOptions);
        console.log(`✅ Welcome email sent to ${user.email}`);
        return { success: true };
      } else {
        console.log("📧 [SIMULATION] Welcome email would be sent");
        return { success: true, simulated: true };
      }
    } catch (error) {
      console.error("Welcome email error:", error.message);
      return { success: false, error: error.message };
    }
  }

  // Send low stock alert
  async sendLowStockAlert(business, products) {
    try {
      const adminEmail = business.email;
      const subject = `Low Stock Alert - ${business.name}`;
      const html = this.generateLowStockHTML(business, products);

      const mailOptions = {
        from: `"BiasharaPro" <${process.env.EMAIL_USER}>`,
        to: adminEmail,
        subject: subject,
        html: html,
        headers: {
          "X-Priority": "1",
          "X-Mailer": "BiasharaPro",
        },
      };

      if (this.transporter) {
        await this.transporter.sendMail(mailOptions);
        console.log(`✅ Low stock alert sent to ${adminEmail}`);
        return { success: true };
      } else {
        console.log("📧 [SIMULATION] Low stock alert would be sent");
        return { success: true, simulated: true };
      }
    } catch (error) {
      console.error("Low stock alert error:", error.message);
      return { success: false, error: error.message };
    }
  }

  // Generate Professional Invoice HTML
  generateInvoiceHTML(invoice, business) {
    const status = invoice.status || "pending";
    const subtotal = parseFloat(invoice.subtotal || 0).toFixed(2);
    const vatAmount = parseFloat(invoice.vat_amount || 0).toFixed(2);
    const totalAmount = parseFloat(invoice.total_amount || 0).toFixed(2);
    const amountPaid = parseFloat(invoice.amount_paid || 0).toFixed(2);
    const balance = (
      parseFloat(invoice.total_amount || 0) -
      parseFloat(invoice.amount_paid || 0)
    ).toFixed(2);

    const itemsHtml =
      invoice.items
        ?.map(
          (item) => `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${item.product_name || item.description || "Item"}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">${item.quantity || 0}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">KES ${parseFloat(item.unit_price || 0).toFixed(2)}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">KES ${parseFloat(item.total || 0).toFixed(2)}</td>
           </tr>
        `,
        )
        .join("") ||
      '<tr><td colspan="4" style="padding: 12px; text-align: center;">No items</td></tr>';

    const statusColor = status === "paid" ? "#10b981" : "#f59e0b";
    const statusText = status.toUpperCase();

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Invoice ${invoice.invoice_number || ""}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: 'Inter', Arial, sans-serif; 
                    background: #f8fafc; 
                    padding: 40px 20px;
                    line-height: 1.5;
                }
                .invoice-container {
                    max-width: 800px;
                    margin: 0 auto;
                    background: white;
                    border-radius: 20px;
                    box-shadow: 0 20px 40px -12px rgba(0,0,0,0.1);
                    overflow: hidden;
                }
                .invoice-header {
                    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
                    padding: 40px;
                    color: white;
                }
                .header-content {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    flex-wrap: wrap;
                    gap: 20px;
                }
                .company-info h1 {
                    font-size: 28px;
                    margin-bottom: 8px;
                    font-weight: 700;
                }
                .company-info p {
                    color: #94a3b8;
                    font-size: 14px;
                    margin: 4px 0;
                }
                .invoice-title {
                    text-align: right;
                }
                .invoice-title h2 {
                    font-size: 32px;
                    font-weight: 700;
                    margin-bottom: 8px;
                }
                .invoice-title .status {
                    display: inline-block;
                    padding: 6px 16px;
                    background: ${statusColor};
                    border-radius: 30px;
                    font-size: 12px;
                    font-weight: 600;
                    color: white;
                }
                .invoice-details {
                    display: flex;
                    justify-content: space-between;
                    padding: 30px 40px;
                    background: #f8fafc;
                    border-bottom: 1px solid #e2e8f0;
                    flex-wrap: wrap;
                    gap: 20px;
                }
                .detail-box h3 {
                    font-size: 12px;
                    font-weight: 600;
                    color: #64748b;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    margin-bottom: 12px;
                }
                .detail-box p {
                    font-size: 14px;
                    color: #1e293b;
                    margin: 4px 0;
                    font-weight: 500;
                }
                .items-table {
                    padding: 0 40px 30px;
                }
                .items-table table {
                    width: 100%;
                    border-collapse: collapse;
                }
                .items-table th {
                    text-align: left;
                    padding: 12px;
                    background: #f1f5f9;
                    font-weight: 600;
                    font-size: 13px;
                    color: #475569;
                }
                .totals {
                    padding: 0 40px 30px;
                    text-align: right;
                    border-top: 2px solid #e2e8f0;
                    margin-top: 20px;
                }
                .totals-row {
                    display: flex;
                    justify-content: flex-end;
                    gap: 40px;
                    margin-top: 20px;
                }
                .totals-item {
                    text-align: right;
                }
                .totals-item .label {
                    font-size: 14px;
                    color: #64748b;
                    margin-bottom: 4px;
                }
                .totals-item .value {
                    font-size: 20px;
                    font-weight: 700;
                    color: #1e293b;
                }
                .grand-total {
                    margin-top: 15px;
                    padding-top: 15px;
                    border-top: 2px solid #e2e8f0;
                }
                .grand-total .value {
                    font-size: 28px;
                    color: #10b981;
                }
                .footer {
                    background: #f8fafc;
                    padding: 30px 40px;
                    text-align: center;
                    border-top: 1px solid #e2e8f0;
                }
                .footer p {
                    font-size: 12px;
                    color: #94a3b8;
                    margin: 8px 0;
                }
                .etims-badge {
                    background: #fef3c7;
                    padding: 12px;
                    border-radius: 8px;
                    margin: 20px 0;
                    text-align: center;
                }
                @media (max-width: 600px) {
                    .invoice-header, .invoice-details, .items-table, .totals, .footer {
                        padding-left: 20px;
                        padding-right: 20px;
                    }
                    .header-content {
                        flex-direction: column;
                        text-align: center;
                    }
                    .invoice-title {
                        text-align: center;
                    }
                    .totals-row {
                        flex-direction: column;
                        gap: 10px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="invoice-container">
                <div class="invoice-header">
                    <div class="header-content">
                        <div class="company-info">
                            <h1>${business.name || "BiasharaPro"}</h1>
                            <p>${business.email || ""}</p>
                            <p>KRA PIN: ${business.kra_pin || "N/A"}</p>
                            <p>Phone: ${business.phone || "N/A"}</p>
                        </div>
                        <div class="invoice-title">
                            <h2>INVOICE</h2>
                            <div class="status">${statusText}</div>
                        </div>
                    </div>
                </div>

                <div class="invoice-details">
                    <div class="detail-box">
                        <h3>BILL TO</h3>
                        <p><strong>${invoice.customer_name || "N/A"}</strong></p>
                        ${invoice.customer_phone ? `<p>${invoice.customer_phone}</p>` : ""}
                        ${invoice.customer_email ? `<p>${invoice.customer_email}</p>` : ""}
                    </div>
                    <div class="detail-box">
                        <h3>INVOICE DETAILS</h3>
                        <p><strong>Invoice #:</strong> ${invoice.invoice_number || "N/A"}</p>
                        <p><strong>Date:</strong> ${invoice.created_at ? new Date(invoice.created_at).toLocaleDateString() : new Date().toLocaleDateString()}</p>
                        <p><strong>Due Date:</strong> ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : "Upon receipt"}</p>
                    </div>
                </div>

                <div class="items-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th style="text-align: center;">Quantity</th>
                                <th style="text-align: right;">Unit Price</th>
                                <th style="text-align: right;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                        </tbody>
                    </table>
                </div>

                <div class="totals">
                    <div class="totals-row">
                        <div class="totals-item">
                            <div class="label">Subtotal</div>
                            <div class="value">KES ${subtotal}</div>
                        </div>
                        <div class="totals-item">
                            <div class="label">VAT (16%)</div>
                            <div class="value">KES ${vatAmount}</div>
                        </div>
                    </div>
                    <div class="grand-total">
                        <div class="totals-item">
                            <div class="label">TOTAL</div>
                            <div class="value">KES ${totalAmount}</div>
                        </div>
                    </div>
                    ${
                      amountPaid > 0
                        ? `
                    <div class="totals-row" style="margin-top: 20px;">
                        <div class="totals-item">
                            <div class="label">Amount Paid</div>
                            <div class="value" style="color: #10b981;">KES ${amountPaid}</div>
                        </div>
                        <div class="totals-item">
                            <div class="label">Balance Due</div>
                            <div class="value" style="color: ${balance > 0 ? "#f59e0b" : "#10b981"};">KES ${balance}</div>
                        </div>
                    </div>
                    `
                        : ""
                    }
                </div>

                ${
                  invoice.etims_qr_code
                    ? `
                <div class="etims-badge">
                    <p style="font-weight: 600; color: #92400e;">✓ KRA eTIMS Verified</p>
                    <p style="font-size: 11px;">Reference: ${invoice.etims_reference || "N/A"}</p>
                </div>
                `
                    : ""
                }

                <div class="footer">
                    <p><strong>Payment Instructions</strong></p>
                    <p>M-Pesa Paybill: 123456 | Account: ${invoice.invoice_number || "INVOICE"}</p>
                    <p>Bank: Equity Bank | Account: 1234567890 | Branch: Nairobi</p>
                    <hr style="margin: 15px 0; border: none; border-top: 1px solid #e2e8f0;">
                    <p>Thank you for your business!</p>
                    <p style="font-size: 10px;">This is a computer-generated document. No signature required.</p>
                </div>
            </div>
        </body>
        </html>
    `;
  }

  // Generate Receipt HTML
  generateReceiptHTML(invoice, business, payment) {
    const amountPaid = parseFloat(invoice.amount_paid || 0).toFixed(2);
    const totalAmount = parseFloat(invoice.total_amount || 0).toFixed(2);
    const balance = (
      parseFloat(invoice.total_amount || 0) -
      parseFloat(invoice.amount_paid || 0)
    ).toFixed(2);
    const paymentAmount = parseFloat(payment?.amount || 0).toFixed(2);

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Payment Receipt</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #27ae60; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; }
                .payment-details { background: #f9f9f9; padding: 15px; margin: 20px 0; border-radius: 5px; }
                .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>PAYMENT RECEIPT</h1>
                </div>
                <div class="content">
                    <div class="payment-details">
                        <p><strong>Receipt for Invoice:</strong> ${invoice.invoice_number || "N/A"}</p>
                        <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                        <p><strong>Customer:</strong> ${invoice.customer_name || "N/A"}</p>
                        <p><strong>Amount Paid:</strong> KES ${paymentAmount}</p>
                        <p><strong>Payment Method:</strong> ${payment?.payment_method || "M-Pesa"}</p>
                        ${payment?.mpesa_receipt_number ? `<p><strong>M-Pesa Receipt:</strong> ${payment.mpesa_receipt_number}</p>` : ""}
                        <p><strong>Total Paid to Date:</strong> KES ${amountPaid}</p>
                        <p><strong>Remaining Balance:</strong> KES ${balance}</p>
                    </div>
                </div>
                <div class="footer">
                    <p>${business.name || "BiasharaPro"} | ${business.email || ""}</p>
                    <p>Thank you for your payment!</p>
                </div>
            </div>
        </body>
        </html>
    `;
  }

  // Generate Welcome HTML
  generateWelcomeHTML(user, business) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Welcome to BiasharaPro</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #3498db; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; }
                .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Welcome to BiasharaPro!</h1>
                </div>
                <div class="content">
                    <p>Hello ${user.first_name || user.email},</p>
                    <p>Your business <strong>${business.name}</strong> has been successfully registered on BiasharaPro.</p>
                    <p>You can now:</p>
                    <ul>
                        <li>Manage your products and inventory</li>
                        <li>Create professional invoices</li>
                        <li>Accept M-Pesa payments</li>
                        <li>Generate KRA eTIMS compliant invoices</li>
                        <li>View real-time business reports</li>
                    </ul>
                    <p>Login to your dashboard: <a href="${process.env.CLIENT_URL || "http://localhost:3000"}">${process.env.CLIENT_URL || "http://localhost:3000"}</a></p>
                    <p>Thank you for choosing BiasharaPro!</p>
                </div>
                <div class="footer">
                    <p>BiasharaPro - Business Management for Kenyan SMEs</p>
                </div>
            </div>
        </body>
        </html>
    `;
  }

  // Generate Low Stock HTML
  generateLowStockHTML(business, products) {
    const productsHtml = products
      .map(
        (p) => `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${p.name}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${p.stock_quantity}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${p.reorder_level}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${p.reorder_level - p.stock_quantity}</td>
          </tr>
        `,
      )
      .join("");

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Low Stock Alert</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #e67e22; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th { background: #e67e22; color: white; padding: 10px; }
                .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>⚠️ Low Stock Alert</h1>
                </div>
                <div class="content">
                    <p>Hello ${business.name},</p>
                    <p>The following products are running low on stock and need reordering:</p>
                    <table>
                        <thead>
                            <tr><th>Product</th><th>Current Stock</th><th>Reorder Level</th><th>Order Needed</th></tr>
                        </thead>
                        <tbody>
                            ${productsHtml}
                        </tbody>
                    </table>
                    <p>Please restock these items to avoid running out.</p>
                    <p>Login to your dashboard to create purchase orders: <a href="${process.env.CLIENT_URL || "http://localhost:3000"}">${process.env.CLIENT_URL || "http://localhost:3000"}</a></p>
                </div>
                <div class="footer">
                    <p>BiasharaPro - Automated Stock Alerts</p>
                </div>
            </div>
        </body>
        </html>
    `;
  }
}

module.exports = new EmailService();
