#!/usr/bin/env node
/**
 * sync-approuter.mjs - copies app/* (excluding app/router itself) into
 * app/router/resources/, which is what the approuter actually serves.
 *
 * Why this exists: app/router/resources/ used to be hand-mirrored file by
 * file for every UI change, and had already silently drifted (logout.html
 * differed between the two copies) before this script existed. Single
 * source of truth is app/ - never edit app/router/resources/ directly.
 *
 * Run: node scripts/sync-approuter.mjs   (also wired as npm run sync:approuter)
 */
import { cpSync, rmSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root   = dirname(dirname(fileURLToPath(import.meta.url)));
const src    = join(root, 'app');
const target = join(root, 'app', 'router', 'resources');

if (existsSync(target)) rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

// Copy each top-level entry of app/ except 'router' itself (target lives
// inside app/router/, so app/ can't be copied wholesale onto it).
for (const entry of readdirSync(src)) {
  if (entry === 'router') continue;
  cpSync(join(src, entry), join(target, entry), { recursive: true });
}

console.log(`synced ${src} -> ${target}`);
