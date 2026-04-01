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

    // For testing, use the Resend account email (07299kama@gmail.com)
    // In production, you'll use the customer's email after domain verification
    const testEmail = "07299kama@gmail.com";

    const { data, error } = await resend.emails.send({
      from: `"${invoice.business_name}" <onboarding@resend.dev>`,
      to: [testEmail],
      subject: `Invoice ${invoice.invoice_number} from ${invoice.business_name}`,
      html: html,
    });

    if (error) {
      console.error("Resend error:", error);
      return res.status(500).json({ error: "Failed to send email" });
    }

    res.json({
      success: true,
      message: `Invoice emailed to ${testEmail} (test mode)`,
      data: { messageId: data.id, sentTo: testEmail },
    });
  } catch (error) {
    console.error("Email invoice error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});
