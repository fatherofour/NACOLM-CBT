import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, DUMMY_HASH } from './password.js';
import { LoginThrottle } from './login-throttle.js';
import { readCookie } from './auth.service.js';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('correct horse batterx', h)).toBe(false);
  });

  it('never matches the dummy hash or a malformed one', async () => {
    expect(await verifyPassword('', DUMMY_HASH)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});

describe('login throttle', () => {
  it('locks after five failures within the window and unlocks after 15 minutes', () => {
    let t = 0;
    const th = new LoginThrottle(() => t);
    for (let i = 0; i < 4; i++) th.recordFailure('NA/1');
    expect(th.lockedFor('NA/1')).toBe(0);
    th.recordFailure('NA/1');
    expect(th.lockedFor('NA/1')).toBe(15 * 60 * 1000);
    t += 15 * 60 * 1000;
    expect(th.lockedFor('NA/1')).toBe(0);
  });

  it('forgets failures after a success', () => {
    const th = new LoginThrottle(() => 0);
    for (let i = 0; i < 4; i++) th.recordFailure('NA/2');
    th.recordSuccess('NA/2');
    th.recordFailure('NA/2');
    expect(th.lockedFor('NA/2')).toBe(0);
  });
});

describe('readCookie', () => {
  it('finds a cookie among others', () => {
    expect(readCookie('a=1; nacolm_session=abc%3D; b=2', 'nacolm_session')).toBe('abc=');
    expect(readCookie(undefined, 'nacolm_session')).toBeUndefined();
  });
});
