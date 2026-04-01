const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { query } = require("../config/database");

const generateInvoiceEmailHTML = (invoice, business) => {
  const itemsHtml = invoice.items
    .map(
      (item) => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${item.product_name}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: center;">${item.quantity}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">KES ${item.unit_price.toLocaleString()}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">KES ${item.total.toLocaleString()}</td>
        </tr>
    `,
    )
    .join("");

  const balance = invoice.total_amount - invoice.amount_paid;

  return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Invoice ${invoice.invoice_number}</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #1e293b; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; }
                .invoice-details { background: #f8fafc; padding: 15px; margin: 20px 0; border-radius: 8px; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th { background: #f1f5f9; padding: 10px; text-align: left; }
                .total { font-size: 18px; font-weight: bold; text-align: right; margin-top: 20px; }
                .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
                .status-paid { color: #10b981; }
                .status-pending { color: #f59e0b; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>INVOICE</h1>
                    <p>${business.name}</p>
                </div>
                <div class="content">
                    <div class="invoice-details">
                        <p><strong>Invoice #:</strong> ${invoice.invoice_number}</p>
                        <p><strong>Date:</strong> ${new Date(invoice.created_at).toLocaleDateString()}</p>
                        <p><strong>Customer:</strong> ${invoice.customer_name}</p>
                        ${invoice.customer_email ? `<p><strong>Email:</strong> ${invoice.customer_email}</p>` : ""}
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th style="text-align: center;">Qty</th>
                                <th style="text-align: right;">Unit Price</th>
                                <th style="text-align: right;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                        </tbody>
                    </table>

                    <div class="total">
                        <p>Subtotal: KES ${invoice.subtotal.toLocaleString()}</p>
                        <p>VAT (16%): KES ${invoice.vat_amount.toLocaleString()}</p>
                        <p><strong>Total: KES ${invoice.total_amount.toLocaleString()}</strong></p>
                        <p>Amount Paid: KES ${invoice.amount_paid.toLocaleString()}</p>
                        <p><strong>Balance Due: KES ${balance.toLocaleString()}</strong></p>
                        <p class="${balance === 0 ? "status-paid" : "status-pending"}">Status: ${balance === 0 ? "PAID" : "PENDING"}</p>
                    </div>

                    ${
                      invoice.etims_reference
                        ? `
                    <div style="background: #fef3c7; padding: 12px; border-radius: 8px; margin: 20px 0; text-align: center;">
                        <p style="color: #92400e;">✓ KRA eTIMS Verified</p>
                        <p style="font-size: 11px;">Reference: ${invoice.etims_reference}</p>
                    </div>
                    `
                        : ""
                    }
                </div>
                <div class="footer">
                    <p>${business.name} | KRA PIN: ${business.kra_pin}</p>
                    <p>Thank you for your business!</p>
                </div>
            </div>
        </body>
        </html>
    `;
};

// ... import your existing controllers

router.post("/:id/email", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    const { businessId } = req.user;

    if (!email) {
      return res.status(400).json({ error: "Email address required" });
    }

    const invoiceResult = await query(
      `SELECT i.*, b.name as business_name, b.email as business_email, b.kra_pin
             FROM invoices i
             JOIN businesses b ON i.business_id = b.id
             WHERE i.id = $1 AND i.business_id = $2`,
      [id, businessId],
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const invoice = invoiceResult.rows[0];

    const itemsResult = await query(
      `SELECT product_name, quantity, unit_price, total
             FROM invoice_items
             WHERE invoice_id = $1`,
      [id],
    );

    invoice.items = itemsResult.rows;

    const html = generateInvoiceEmailHTML(invoice, {
      name: invoice.business_name,
      email: invoice.business_email,
      kra_pin: invoice.kra_pin,
    });

    const { Resend } = require("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      from: `"${invoice.business_name}" <${process.env.EMAIL_FROM || "noreply@biasharapro.onrender.com"}>`,
      to: [email],
      subject: `Invoice ${invoice.invoice_number} from ${invoice.business_name}`,
      html: html,
    });

    if (error) {
      console.error("Resend error:", error);
      return res.status(500).json({ error: "Failed to send email" });
    }

    res.json({
      success: true,
      message: "Invoice emailed successfully",
      data: { messageId: data.id },
    });
  } catch (error) {
    console.error("Email invoice error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// ... your other routes (getInvoices, createInvoice, etc.)

module.exports = router;
