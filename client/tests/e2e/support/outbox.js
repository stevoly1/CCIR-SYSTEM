import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { expect } from '@playwright/test';

// The journey server writes each email here (EMAIL_OUTBOX_DIR, test-only) instead of sending it.
export const OUTBOX_DIR = path.join(tmpdir(), 'ccir-e2e-outbox');

const messages = () => (fs.existsSync(OUTBOX_DIR) ? fs.readdirSync(OUTBOX_DIR).sort() : [])
  .map((file) => JSON.parse(fs.readFileSync(path.join(OUTBOX_DIR, file), 'utf8')));

// The newest message of a kind sent to an address, waiting for it to arrive.
export const latestMessage = async (to, kind) => {
  let found;
  await expect.poll(() => {
    found = messages().filter((m) => m.to === to && m.kind === kind).at(-1);
    return Boolean(found);
  }, { message: `no ${kind} email to ${to}` }).toBe(true);
  return found;
};

export const latestLink = async (to, kind) => (await latestMessage(to, kind)).links[0];

// A link of a kind to an address other than `previous`: the one a resend produced, once it arrives.
export const newerLink = async (to, kind, previous) => {
  let link;
  await expect.poll(() => {
    link = messages().filter((m) => m.to === to && m.kind === kind).at(-1)?.links[0];
    return Boolean(link) && link !== previous;
  }, { message: `no new ${kind} link to ${to}` }).toBe(true);
  return link;
};
