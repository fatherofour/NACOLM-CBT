import jsQRModule from 'jsqr';
import sharp, { type Sharp } from 'sharp';

// jsqr is CommonJS; under NodeNext its callable sits on .default.
const jsQR = jsQRModule.default;

// Printed as a QR code in the top-right corner of every answer sheet page, so
// a bulk scan can be filed to the right candidate and question without anyone
// typing it in. Plain IDs, no secrets: the instructor still checks every scan.
const PREFIX = 'NACOLM-TS1';
const ID = /^[A-Za-z0-9_-]{6,64}$/;
export const MAX_SHEET_PAGES = 4;

export interface SheetCode {
  paperVersionId: string;
  candidateId: string;
  questionId: string;
  page: number;
}

export function encodeSheetCode(c: SheetCode): string {
  return [PREFIX, c.paperVersionId, c.candidateId, c.questionId, c.page].join('|');
}

export function parseSheetCode(text: string): SheetCode | null {
  const parts = text.trim().split('|');
  if (parts.length !== 5 || parts[0] !== PREFIX) return null;
  const [, paperVersionId, candidateId, questionId, pageText] = parts;
  const page = Number(pageText);
  if (![paperVersionId, candidateId, questionId].every((id) => ID.test(id))) return null;
  if (!Number.isInteger(page) || page < 1 || page > MAX_SHEET_PAGES) return null;
  return { paperVersionId, candidateId, questionId, page };
}

export interface ReadResult {
  code: SheetCode;
  /** The page, turned upright using the QR code's orientation, as a JPEG. */
  upright: Buffer;
}

async function decode(img: Sharp) {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const hit = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, {
    inversionAttempts: 'dontInvert',
  });
  return hit ? { hit, width: info.width } : null;
}

/** Finds the answer-sheet code on a scanned page, or null if there isn't a readable one. */
export async function readSheetCode(scan: Buffer): Promise<ReadResult | null> {
  const page = await sharp(scan).rotate().jpeg({ quality: 90 }).toBuffer();
  const meta = await sharp(page).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return null;

  // Phone photos are large; the code is easy to find at moderate resolution,
  // and the corner crop catches small codes the full-page pass misses.
  const attempts = [
    () => sharp(page).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }),
    () => sharp(page).extract({ left: Math.floor(w / 2), top: 0, width: Math.ceil(w / 2), height: Math.ceil(h * 0.35) }),
    () => sharp(page).extract({ left: 0, top: Math.floor(h * 0.65), width: Math.ceil(w / 2), height: Math.ceil(h * 0.35) }),
    () => sharp(page),
  ];
  for (const attempt of attempts) {
    const found = await decode(attempt()).catch(() => null);
    if (!found) continue;
    const code = parseSheetCode(found.hit.data);
    if (!code) continue;
    const { topLeftCorner: tl, topRightCorner: tr } = found.hit.location;
    const angle = Math.round((Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI / 90) * 90;
    const turn = ((360 - angle) % 360 + 360) % 360;
    const upright = turn ? await sharp(page).rotate(turn).jpeg({ quality: 90 }).toBuffer() : page;
    return { code, upright };
  }
  return null;
}
