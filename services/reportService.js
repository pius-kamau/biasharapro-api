const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

class ReportService {
    
    // Generate Excel Report
    async generateExcelReport(data, reportType, businessName) {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = businessName;
        workbook.created = new Date();
        
        let worksheet;
        
        switch(reportType) {
            case 'sales':
                worksheet = workbook.addWorksheet('Sales Report');
                this.addSalesSheet(worksheet, data);
                break;
            case 'inventory':
                worksheet = workbook.addWorksheet('Inventory Report');
                this.addInventorySheet(worksheet, data);
                break;
            case 'invoices':
                worksheet = workbook.addWorksheet('Invoices Report');
                this.addInvoicesSheet(worksheet, data);
                break;
            case 'products':
                worksheet = workbook.addWorksheet('Products Report');
                this.addProductsSheet(worksheet, data);
                break;
            default:
                worksheet = workbook.addWorksheet('Report');
        }
        
        const buffer = await workbook.xlsx.writeBuffer();
        return buffer;
    }
    
    addSalesSheet(worksheet, data) {
        worksheet.mergeCells('A1:F1');
        worksheet.getCell('A1').value = 'SALES REPORT';
        worksheet.getCell('A1').font = { size: 16, bold: true };
        worksheet.getCell('A1').alignment = { horizontal: 'center' };
        
        worksheet.mergeCells('A2:F2');
        worksheet.getCell('A2').value = `Generated: ${new Date().toLocaleString()}`;
        worksheet.getCell('A2').alignment = { horizontal: 'center' };
        
        worksheet.addRow(['Date', 'Invoice #', 'Customer', 'Total (KES)', 'VAT (KES)', 'Status']);
        worksheet.getRow(4).font = { bold: true };
        worksheet.getRow(4).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };
        
        data.forEach(item => {
            worksheet.addRow([
                item.created_at ? new Date(item.created_at).toLocaleDateString() : '',
                item.invoice_number || '',
                item.customer_name || '',
                parseFloat(item.total_amount || 0).toFixed(2),
                parseFloat(item.vat_amount || 0).toFixed(2),
                item.status || ''
            ]);
        });
        
        const totalSum = data.reduce((sum, i) => sum + parseFloat(i.total_amount || 0), 0);
        const vatSum = data.reduce((sum, i) => sum + parseFloat(i.vat_amount || 0), 0);
        
        const totalRow = worksheet.addRow(['', '', 'TOTAL:', totalSum.toFixed(2), vatSum.toFixed(2), '']);
        totalRow.font = { bold: true };
        
        worksheet.columns = [
            { width: 12 }, { width: 15 }, { width: 25 }, { width: 12 }, { width: 12 }, { width: 12 }
        ];
    }
    
    addInventorySheet(worksheet, data) {
    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').value = 'INVENTORY REPORT';
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    
    worksheet.addRow(['Product', 'SKU', 'Stock', 'Selling Price', 'Buying Price', 'Status']);
    worksheet.getRow(3).font = { bold: true };
    
    data.forEach(item => {
        const status = (item.stock_quantity || 0) <= (item.reorder_level || 0) ? 'LOW STOCK' : 'OK';
        worksheet.addRow([
            item.name || '',
            item.sku || '',
            item.stock_quantity || 0,
            parseFloat(item.selling_price || 0).toFixed(2),
            parseFloat(item.buying_price || 0).toFixed(2),
            status
        ]);
    });
    
    worksheet.columns = [
        { width: 30 }, { width: 15 }, { width: 10 }, { width: 15 }, { width: 15 }, { width: 12 }
    ];
}

addProductsSheet(worksheet, data) {
    worksheet.mergeCells('A1:D1');
    worksheet.getCell('A1').value = 'PRODUCTS REPORT';
    worksheet.getCell('A1').font = { size: 16, bold: true };
    
    worksheet.addRow(['Name', 'SKU', 'Price (KES)', 'Stock']);
    worksheet.getRow(3).font = { bold: true };
    
    data.forEach(item => {
        worksheet.addRow([
            item.name || '',
            item.sku || '',
            parseFloat(item.selling_price || 0).toFixed(2),
            item.stock_quantity || 0
        ]);
    });
}
    // Generate PDF Report
    async generatePDFReport(data, reportType, businessName, businessDetails) {
        return new Promise((resolve, reject) => {
            try {
                const chunks = [];
                const doc = new PDFDocument({ margin: 50, size: 'A4' });
                
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);
                
                // Header
                doc.fontSize(20).font('Helvetica-Bold').text(businessName || 'BiasharaPro', { align: 'center' });
                if (businessDetails?.email) {
                    doc.fontSize(10).font('Helvetica').text(businessDetails.email, { align: 'center' });
                }
                if (businessDetails?.phone) {
                    doc.fontSize(10).text(businessDetails.phone, { align: 'center' });
                }
                if (businessDetails?.kra_pin) {
                    doc.fontSize(10).text(`KRA PIN: ${businessDetails.kra_pin}`, { align: 'center' });
                }
                
                doc.moveDown();
                doc.fontSize(14).font('Helvetica-Bold').text(`${reportType.toUpperCase()} REPORT`, { align: 'center' });
                doc.fontSize(9).font('Helvetica').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
                
                doc.moveDown();
                doc.lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
                doc.moveDown();
                
                // Report content
                switch(reportType) {
                    case 'sales':
                        this.addSalesPDF(doc, data);
                        break;
                    case 'inventory':
                        this.addInventoryPDF(doc, data);
                        break;
                    case 'invoices':
                        this.addInvoicesPDF(doc, data);
                        break;
                    default:
                        doc.text('Report data not available');
                }
                
                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }
    
    addSalesPDF(doc, data) {
        let y = doc.y;
        
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('Date', 50, y);
        doc.text('Invoice #', 120, y);
        doc.text('Customer', 200, y);
        doc.text('Total (KES)', 320, y);
        doc.text('Status', 490, y);
        
        y += 20;
        doc.lineWidth(0.5).moveTo(50, y - 5).lineTo(550, y - 5).stroke();
        
        doc.font('Helvetica');
        let totalSum = 0;
        
        data.forEach((item) => {
            if (y > 700) {
                doc.addPage();
                y = 50;
            }
            
            const date = item.created_at ? new Date(item.created_at).toLocaleDateString() : '';
            doc.text(date, 50, y);
            doc.text(item.invoice_number || 'N/A', 120, y);
            doc.text((item.customer_name || 'N/A').substring(0, 25), 200, y);
            doc.text(parseFloat(item.total_amount || 0).toFixed(2), 320, y);
            doc.text(item.status || 'pending', 490, y);
            
            totalSum += parseFloat(item.total_amount || 0);
            y += 20;
        });
        
        y += 10;
        doc.font('Helvetica-Bold');
        doc.text('TOTAL:', 270, y);
        doc.text(totalSum.toFixed(2), 320, y);
    }
    
    addInventoryPDF(doc, data) {
        let y = doc.y;
        
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('Product', 50, y);
        doc.text('SKU', 200, y);
        doc.text('Stock', 300, y);
        doc.text('Price (KES)', 380, y);
        doc.text('Status', 480, y);
        
        y += 20;
        doc.lineWidth(0.5).moveTo(50, y - 5).lineTo(550, y - 5).stroke();
        
        doc.font('Helvetica');
        data.forEach((item) => {
            if (y > 700) {
                doc.addPage();
                y = 50;
            }
            
            const status = (item.stock_quantity || 0) <= (item.reorder_level || 0) ? 'LOW STOCK' : 'OK';
            doc.text((item.name || '').substring(0, 30), 50, y);
            doc.text(item.sku || 'N/A', 200, y);
            doc.text((item.stock_quantity || 0).toString(), 300, y);
            doc.text(parseFloat(item.selling_price || 0).toFixed(2), 380, y);
            doc.fillColor(status === 'LOW STOCK' ? 'red' : 'black').text(status, 480, y).fillColor('black');
            
            y += 20;
        });
    }
    
    addInvoicesPDF(doc, data) {
        let y = doc.y;
        
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('Invoice #', 50, y);
        doc.text('Customer', 130, y);
        doc.text('Date', 230, y);
        doc.text('Amount', 320, y);
        doc.text('Paid', 410, y);
        doc.text('Status', 500, y);
        
        y += 20;
        doc.lineWidth(0.5).moveTo(50, y - 5).lineTo(550, y - 5).stroke();
        
        doc.font('Helvetica');
        data.forEach((item) => {
            if (y > 700) {
                doc.addPage();
                y = 50;
            }
            
            const balance = parseFloat(item.total_amount || 0) - parseFloat(item.amount_paid || 0);
            doc.text(item.invoice_number || 'N/A', 50, y);
            doc.text((item.customer_name || 'N/A').substring(0, 20), 130, y);
            doc.text(item.created_at ? new Date(item.created_at).toLocaleDateString() : '', 230, y);
            doc.text(parseFloat(item.total_amount || 0).toFixed(2), 320, y);
            doc.text(parseFloat(item.amount_paid || 0).toFixed(2), 410, y);
            doc.text(balance === 0 ? 'PAID' : (balance > 0 ? 'PARTIAL' : 'PENDING'), 500, y);
            
            y += 20;
        });
    }
}

module.exports = new ReportService();