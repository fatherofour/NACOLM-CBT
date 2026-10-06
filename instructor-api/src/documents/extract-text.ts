// Raw text extraction for uploaded documents, and page images for the AI to
// read when a paper has no usable text (handwritten, scanned or photographed).

export const IMAGE_FILE = /\.(jpe?g|png)$/i;
const MAX_PAGES = 30;

export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  if (IMAGE_FILE.test(filename)) return '';
  if (/\.docx$/i.test(filename)) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

/** Typed text worth parsing, as opposed to a scan's empty or near-empty text layer. */
export function hasUsableText(text: string): boolean {
  return (text.match(/[A-Za-z]/g) ?? []).length >= 200;
}

/** Each page as an image: the file itself for a photo, or rendered PDF pages. */
export async function pageImages(buffer: Buffer, filename: string): Promise<Buffer[]> {
  if (IMAGE_FILE.test(filename)) return [buffer];
  if (!/\.pdf$/i.test(filename)) return [];
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const shots = await parser.getScreenshot({ first: MAX_PAGES, scale: 2, imageBuffer: true, imageDataUrl: false });
    return shots.pages.map((p) => Buffer.from(p.data));
  } finally {
    await parser.destroy();
  }
}
