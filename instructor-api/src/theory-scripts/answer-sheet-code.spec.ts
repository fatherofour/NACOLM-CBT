import QRCode from 'qrcode';
import sharp from 'sharp';
import { encodeSheetCode, parseSheetCode, readSheetCode } from './answer-sheet-code.js';

const code = { paperVersionId: 'cmpaper0001xyz', candidateId: 'cmcand0001xyz', questionId: 'cmquest0001xyz', page: 2 };

// An A4-ish white page with the code in the top-right corner and a dark bar
// across the top-left, so we can tell which way up the page came back.
async function fakePage(rotate = 0) {
  const qr = await QRCode.toBuffer(encodeSheetCode(code), { width: 220, margin: 2 });
  const bar = await sharp({ create: { width: 500, height: 40, channels: 3, background: '#000' } }).png().toBuffer();
  const page = await sharp({ create: { width: 1240, height: 1754, channels: 3, background: '#fff' } })
    .composite([
      { input: qr, top: 60, left: 960 },
      { input: bar, top: 80, left: 80 },
    ])
    .jpeg()
    .toBuffer();
  return rotate ? sharp(page).rotate(rotate).jpeg().toBuffer() : page;
}

async function darkTopLeft(img: Buffer) {
  const { data, info } = await sharp(img).greyscale().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => data[y * info.width + x];
  return at(Math.floor(info.width * 0.15), Math.floor(info.height * 0.057)) < 80;
}

describe('answer sheet codes', () => {
  it('round-trips and rejects anything that is not a sheet code', () => {
    expect(parseSheetCode(encodeSheetCode(code))).toEqual(code);
    expect(parseSheetCode('hello')).toBeNull();
    expect(parseSheetCode(encodeSheetCode({ ...code, page: 9 }))).toBeNull();
    expect(parseSheetCode('NACOLM-TS1|a b|c|d|1')).toBeNull();
  });

  it('reads the code from a scanned page', async () => {
    const res = await readSheetCode(await fakePage());
    expect(res?.code).toEqual(code);
    expect(await darkTopLeft(res!.upright)).toBe(true);
  });

  it('turns an upside-down or sideways scan upright', async () => {
    for (const angle of [90, 180, 270]) {
      const res = await readSheetCode(await fakePage(angle));
      expect(res?.code).toEqual(code);
      expect(await darkTopLeft(res!.upright)).toBe(true);
    }
  });

  it('returns null for a page with no code', async () => {
    const blank = await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    expect(await readSheetCode(blank)).toBeNull();
  });
});
