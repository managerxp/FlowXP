/*
 * Download a printed sheet as a PDF file. The sheet on screen (an invoice, an order, a statement) is drawn to an image and cut into A4 pages,
 * so the PDF looks exactly like the print view. The text in it is a picture (it cannot be selected or searched); the print dialog's
 * "Save as PDF" keeps real text, so both stay available. The two libraries are loaded only when this is used.
 *
 * ponytail: image-based PDF. Move to a server-side PDF (real text, small files) if invoices must be searchable.
 */
const A4 = { w: 210, h: 297 };   // millimetres
const MARGIN = 8;

/** @param element the DOM node to capture   @param filename e.g. "INV-0001.pdf" */
export const downloadPdf = async (element, filename) => {
  if (!element) throw new Error('Nothing to save');
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: Math.max(element.scrollWidth, 800) });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const width = A4.w - MARGIN * 2;
  const pageHeight = A4.h - MARGIN * 2;
  const pxPerMm = canvas.width / width;
  const slice = Math.floor(pageHeight * pxPerMm);   // canvas pixels that fill one page
  for (let y = 0, page = 0; y < canvas.height; y += slice, page += 1) {
    const h = Math.min(slice, canvas.height - y);
    const part = document.createElement('canvas');
    part.width = canvas.width; part.height = h;
    part.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (page > 0) pdf.addPage();
    pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, MARGIN, width, h / pxPerMm);
  }
  pdf.save(String(filename || 'document.pdf').replace(/[^\w.\- ]+/g, '_'));
};
