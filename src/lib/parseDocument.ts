import mammoth from 'mammoth';

const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

interface PdfTextItem { str?: string }
interface PdfTextContent { items: PdfTextItem[] }
interface PdfPage { getTextContent(): Promise<PdfTextContent> }
interface PdfDocument { numPages: number; getPage(n: number): Promise<PdfPage> }
interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(source: { data: Uint8Array }): { promise: Promise<PdfDocument> };
}

declare global {
  interface Window { pdfjsLib?: PdfJsLib }
}

let pdfjsLoaded: Promise<PdfJsLib> | null = null;

function loadPdfJs(): Promise<PdfJsLib> {
  if (pdfjsLoaded) return pdfjsLoaded;
  pdfjsLoaded = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${PDFJS_CDN}/pdf.min.js`;
    script.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) { reject(new Error('pdf.js failed to load')); return; }
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
      resolve(lib);
    };
    script.onerror = () => reject(new Error('Failed to load pdf.js'));
    document.head.appendChild(script);
  });
  return pdfjsLoaded;
}

export async function parseDocument(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return parsePdf(file);
  if (ext === 'docx') return parseDocx(file);
  if (ext === 'txt') return parseTxt(file);
  throw new Error(`Unsupported file type: .${ext}`);
}

async function parsePdf(file: File): Promise<string> {
  const lib = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str || '').join(' '));
  }
  return pages.join('\n\n');
}

async function parseDocx(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

async function parseTxt(file: File): Promise<string> {
  return file.text();
}
