const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

/**
 * NodeCanvasFactory - required for pdfjs-dist v3 with node-canvas
 * pdfjs-dist expects a canvas factory that creates canvas/context pairs
 */
class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/**
 * Convert a PDF file to page images using pdfjs-dist + node-canvas
 */
async function convertPdfToImages(pdfFilePath, outputDir) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

  const pdfData = new Uint8Array(fs.readFileSync(pdfFilePath));
  const canvasFactory = new NodeCanvasFactory();

  const pdf = await pdfjsLib.getDocument({
    data: pdfData,
    canvasFactory: canvasFactory,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/',
  }).promise;

  const numPages = pdf.numPages;
  fs.mkdirSync(outputDir, { recursive: true });

  const images = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const scale = 2.0;
    const viewport = page.getViewport({ scale });

    // Create canvas via factory
    const { canvas, context } = canvasFactory.create(
      Math.floor(viewport.width),
      Math.floor(viewport.height)
    );

    // White background
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Render PDF page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvasFactory: canvasFactory,
    }).promise;

    const imgPath = path.join(outputDir, `page_${i}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(imgPath, buffer);
    images.push({ pageNumber: i, path: imgPath });

    // Cleanup
    page.cleanup();
  }

  pdf.cleanup();
  pdf.destroy();

  return { numPages, images };
}

/**
 * Get page images for a paper (converts PDF if not already done)
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

  return await convertPdfToImages(pdfFilePath, outputDir);
}

module.exports = { convertPdfToImages, getPageImages };
