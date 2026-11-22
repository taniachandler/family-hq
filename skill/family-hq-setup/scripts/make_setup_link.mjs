#!/usr/bin/env node
// Same as make_setup_link.py, for computers with Node instead of Python.
// Usage:  node make_setup_link.mjs https://their-site.netlify.app setup.json
import { readFileSync } from 'node:fs';

const fail = (msg) => { console.error(`Problem: ${msg}`); process.exit(1); };

const [site0, path] = process.argv.slice(2);
if (!site0 || !path) fail('usage: make_setup_link.mjs <site link> <setup.json>');
const site = site0.trim().replace(/\/+$/, '');
if (!site.startsWith('https://')) fail('the site link should start with https://');
const data = JSON.parse(readFileSync(path, 'utf8'));

const people = data.people || [];
const names = people.map((p) => String(p.name || '').trim());
if (!names.length || names.some((n) => !n)) fail('add at least one person, each with a name');
const lower = new Set(names.map((n) => n.toLowerCase()));
if (lower.size !== names.length) fail('two people have the same name');
if (!people.some((p) => p.role === 'adult')) fail("at least one person must have role 'adult'");
for (const [night, slots] of Object.entries(data.chart || {})) {
  for (const s of slots) if (!lower.has(String(s.who || '').trim().toLowerCase())) fail(`${night}: '${s.who}' isn't in the list of people`);
}

const code = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
console.log(`${site}/#/setup/${code}`);
