const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

/**
 * Convert a PDF file to page images using pdfjs-dist + node-canvas
 * Returns array of image file paths
 */
async function convertPdfToImages(pdfFilePath, outputDir) {

  const pdfData = new Uint8Array(fs.readFileSync(pdfFilePath));
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const numPages = pdf.numPages;

  fs.mkdirSync(outputDir, { recursive: true });

  const images = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const scale = 2.0; // High quality
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');

    // Fill white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    await page.render({
      canvasContext: ctx,
      viewport: viewport,
    }).promise;

    const imgPath = path.join(outputDir, `page_${i}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(imgPath, buffer);
    images.push({ pageNumber: i, path: imgPath });
  }

  return { numPages, images };
}

/**
 * Get page image path for a paper (convert if not already done)
 */
async function getPageImages(paperId, pdfFilePath) {
  const outputDir = path.join('uploads', 'page-images', paperId);

  // Check if already converted
  if (fs.existsSync(outputDir)) {
    const files = fs.readdirSync(outputDir)
      .filter(f => f.startsWith('page_') && f.endsWith('.png'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/page_(\d+)/)[1]);
        const numB = parseInt(b.match(/page_(\d+)/)[1]);
        return numA - numB;
      });

    if (files.length > 0) {
      return {
        numPages: files.length,
        images: files.map((f, idx) => ({
          pageNumber: idx + 1,
          path: path.join(outputDir, f)
        }))
      };
    }
  }

  // Convert PDF to images
  return await convertPdfToImages(pdfFilePath, outputDir);
}

module.exports = { convertPdfToImages, getPageImages };
