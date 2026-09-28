// Raw text extraction for the two file types DocumentsController accepts.
// No OCR — a scanned/image-only PDF has no text layer and yields nothing.
export async function extractText(buffer: Buffer, filename: string): Promise<string> {
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
