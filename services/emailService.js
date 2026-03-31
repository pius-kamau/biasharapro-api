const nodemailer = require("nodemailer");

class EmailService {
  constructor() {
    this.transporter = null;
    this.init();
  }

  init() {
    // Configure email transporter - use Gmail but with simpler settings
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      this.transporter = nodemailer.createTransport({
        service: "gmail", // Use service instead of host/port
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
        tls: {
          rejectUnauthorized: false,
        },
      });
      console.log("✅ Email service initialized (Gmail)");
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
        // No PDF attachment - simpler and faster
      };

      if (this.transporter) {
        const info = await this.transporter.sendMail(mailOptions);
        console.log(`✅ Email sent to ${customerEmail}`);
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
      };

      if (this.transporter) {
        await this.transporter.sendMail(mailOptions);
        console.log(`✅ Receipt sent to ${customerEmail}`);
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

  // Generate Invoice HTML (keep your existing beautiful HTML)
  generateInvoiceHTML(invoice, business) {
    // ... keep your existing generateInvoiceHTML method (the long one)
    // I'm not copying it here to keep this message short, but you keep yours
  }

  // Generate Receipt HTML
  generateReceiptHTML(invoice, business, payment) {
    // ... keep your existing
  }

  // Generate Welcome HTML
  generateWelcomeHTML(user, business) {
    // ... keep your existing
  }

  // Generate Low Stock HTML
  generateLowStockHTML(business, products) {
    // ... keep your existing
  }
}

module.exports = new EmailService();
