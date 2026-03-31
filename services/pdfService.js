const PDFDocument = require("pdfkit");

class PDFService {
  async generateInvoicePDF(invoice, business, items) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: "A4" });
        const buffers = [];

        doc.on("data", buffers.push.bind(buffers));
        doc.on("end", () => resolve(Buffer.concat(buffers)));
        doc.on("error", reject);

        // Colors
        const navy = "#1e3a5f";
        const gold = "#c4a747";
        const green = "#2e7d32";
        const orange = "#f57c00";
        const gray = "#6c757d";

        let y = 50;

        // HEADER SECTION
        doc.rect(50, y, 495, 85).fill(navy);

        // Company Name
        doc
          .fillColor("white")
          .font("Helvetica-Bold")
          .fontSize(22)
          .text(business.name || "BiasharaPro", 70, y + 20);

        doc
          .fontSize(8)
          .font("Helvetica")
          .text(business.email || "", 70, y + 55)
          .text(`KRA PIN: ${business.kra_pin || "N/A"}`, 70, y + 70);

        // Invoice Title
        doc
          .fillColor(gold)
          .fontSize(26)
          .font("Helvetica-Bold")
          .text("INVOICE", 400, y + 25, { align: "right" });

        doc
          .fillColor("white")
          .fontSize(9)
          .text(`# ${invoice.invoice_number || "N/A"}`, 400, y + 60, {
            align: "right",
          });

        y += 100;

        // STATUS BADGE
        const status = invoice.status || "pending";
        const statusColor = status === "paid" ? green : orange;
        doc.rect(50, y, 80, 25).fill(statusColor);
        doc
          .fillColor("white")
          .fontSize(9)
          .font("Helvetica-Bold")
          .text(status.toUpperCase(), 55, y + 7);

        y += 45;

        // BILL TO & INVOICE DETAILS
        doc
          .fillColor(navy)
          .fontSize(10)
          .font("Helvetica-Bold")
          .text("BILL TO", 50, y);

        doc.fillColor(gray).text("INVOICE DETAILS", 350, y);

        y += 20;

        // Customer Information
        doc
          .fillColor(navy)
          .fontSize(10)
          .font("Helvetica-Bold")
          .text(invoice.customer_name || "N/A", 50, y);

        doc.fillColor(gray).fontSize(9).font("Helvetica");

        let customerY = y + 15;
        if (invoice.customer_phone) {
          doc.text(invoice.customer_phone, 50, customerY);
          customerY += 15;
        }
        if (invoice.customer_email) {
          doc.text(invoice.customer_email, 50, customerY);
        }

        // Invoice Details
        doc
          .fillColor(navy)
          .fontSize(9)
          .font("Helvetica-Bold")
          .text("Invoice Number:", 350, y);
        doc.fillColor(gray).text(invoice.invoice_number || "N/A", 450, y);

        doc.fillColor(navy).text("Date:", 350, y + 18);
        doc
          .fillColor(gray)
          .text(
            invoice.created_at
              ? new Date(invoice.created_at).toLocaleDateString()
              : new Date().toLocaleDateString(),
            450,
            y + 18,
          );

        doc.fillColor(navy).text("Due Date:", 350, y + 36);
        doc
          .fillColor(gray)
          .text(
            invoice.due_date
              ? new Date(invoice.due_date).toLocaleDateString()
              : "Upon receipt",
            450,
            y + 36,
          );

        y += 80;

        // TABLE HEADER
        doc.rect(50, y, 495, 28).fill("#f8f9fa");
        doc.fillColor(navy).fontSize(9).font("Helvetica-Bold");

        doc.text("ITEM", 60, y + 8);
        doc.text("QTY", 300, y + 8);
        doc.text("UNIT PRICE", 380, y + 8);
        doc.text("TOTAL", 480, y + 8);

        y += 28;

        // ITEMS
        let subtotal = 0;
        let rowIndex = 0;

        doc.font("Helvetica").fontSize(9);

        for (const item of items) {
          const itemName = (
            item.product_name ||
            item.description ||
            "Item"
          ).substring(0, 45);
          const qty = item.quantity || 0;
          const price = parseFloat(item.unit_price || 0);
          const total = parseFloat(item.total || 0);

          subtotal += total;

          if (rowIndex % 2 === 1) {
            doc.rect(50, y - 3, 495, 22).fill("#f8f9fa");
          }

          doc.fillColor("#1e293b").text(itemName, 60, y, { width: 220 });
          doc.text(qty.toString(), 300, y);
          doc.text(`KES ${price.toFixed(2)}`, 380, y);
          doc.text(`KES ${total.toFixed(2)}`, 480, y);

          y += 22;
          rowIndex++;

          if (y > 650 && rowIndex < items.length) {
            doc.addPage();
            y = 50;
          }
        }

        y += 15;

        // DIVIDER
        doc
          .strokeColor("#dee2e6")
          .lineWidth(1)
          .moveTo(350, y)
          .lineTo(545, y)
          .stroke();

        y += 12;

        // TOTALS
        const vat = parseFloat(invoice.vat_amount || 0);
        const total = parseFloat(invoice.total_amount || subtotal);
        const amountPaid = parseFloat(invoice.amount_paid || 0);
        const balance = total - amountPaid;

        doc.font("Helvetica").fontSize(9);

        doc.text("Subtotal:", 420, y);
        doc.text(`KES ${subtotal.toFixed(2)}`, 520, y);

        y += 18;
        doc.text("VAT (16%):", 420, y);
        doc.text(`KES ${vat.toFixed(2)}`, 520, y);

        y += 22;
        doc.font("Helvetica-Bold").fontSize(11);
        doc.text("TOTAL:", 420, y);
        doc.fillColor(green).text(`KES ${total.toFixed(2)}`, 520, y);

        if (amountPaid > 0) {
          y += 20;
          doc.font("Helvetica").fontSize(9).fillColor(gray);
          doc.text("Amount Paid:", 420, y);
          doc.fillColor(green).text(`KES ${amountPaid.toFixed(2)}`, 520, y);

          y += 18;
          doc.font("Helvetica-Bold").fontSize(9);
          doc.text("Balance Due:", 420, y);
          doc
            .fillColor(balance > 0 ? orange : green)
            .text(`KES ${balance.toFixed(2)}`, 520, y);
        }

        y += 45;

        // PAYMENT INSTRUCTIONS
        doc.rect(50, y, 495, 50).fill("#f8f9fa");
        doc
          .fillColor(navy)
          .fontSize(8)
          .font("Helvetica-Bold")
          .text("PAYMENT INSTRUCTIONS", 60, y + 8);

        doc.font("Helvetica").fontSize(7);
        doc.text("M-Pesa Paybill: 123456", 60, y + 24);
        doc.text(
          `Account: ${invoice.invoice_number || "INVOICE"}`,
          200,
          y + 24,
        );
        doc.text("Bank: Equity Bank | Account: 1234567890", 60, y + 38);

        y += 65;

        // eTIMS BADGE
        if (invoice.etims_reference) {
          doc.rect(50, y, 495, 30).fill("#fff4e6");
          doc
            .fillColor("#b45309")
            .fontSize(8)
            .font("Helvetica-Bold")
            .text("✓ KRA eTIMS VERIFIED", 70, y + 8);
          doc
            .fontSize(7)
            .text(`Reference: ${invoice.etims_reference}`, 70, y + 20);
          y += 45;
        }

        // FOOTER
        doc
          .fillColor(gray)
          .fontSize(7)
          .font("Helvetica")
          .text("Thank you for your business!", 50, doc.page.height - 35, {
            align: "center",
            width: 495,
          });
        doc.text(
          "This is a computer-generated document.",
          50,
          doc.page.height - 25,
          { align: "center", width: 495 },
        );

        doc.end();
      } catch (error) {
        console.error("PDF Error:", error);
        reject(error);
      }
    });
  }
}

module.exports = new PDFService();
