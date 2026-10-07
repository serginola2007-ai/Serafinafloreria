'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
let bad = 0;
for (const f of walk(path.join(__dirname, '..'))) { try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.error(f + '\n' + e.stderr); } }
if (bad) process.exit(1); console.log('sintaxis OK');
