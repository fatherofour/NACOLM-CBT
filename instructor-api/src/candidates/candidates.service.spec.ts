import { CandidatesService } from './candidates.service.js';
import { verifyPassword } from '../auth/password.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('CandidatesService.resetPin', () => {
  it('returns the new PIN as a roster row and stores only its hash', async () => {
    let stored = '';
    const prisma = {
      candidate: {
        update: async ({ data }: { data: { pinHash: string } }) => {
          stored = data.pinHash;
          return { armyNumber: 'NA/26/0412', rank: 'Cdt', fullName: 'A. Okafor' };
        },
      },
    } as unknown as PrismaService;

    const row = await new CandidatesService(prisma).resetPin('c1');

    expect(row).toEqual({ armyNumber: 'NA/26/0412', rank: 'Cdt', fullName: 'A. Okafor', pin: expect.stringMatching(/^\d{6}$/) });
    expect(stored).not.toContain(row.pin);
    expect(await verifyPassword(row.pin, stored)).toBe(true);
  });
});
