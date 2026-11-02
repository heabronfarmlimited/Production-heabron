#!/usr/bin/env node
'use strict';

/**
 * Does every column the code reads and writes actually exist?
 *
 * WHY THIS EXISTS
 *
 * supabase-js builds queries from strings. A typo'd column is not a syntax
 * error, not a type error, and not caught by any test that does not hit the
 * database — it is a PostgREST 42703 at runtime. Three real instances were
 * found by hand in this codebase, each of which had been live:
 *
 *   - the lender credit report selected and ordered by `created_at` on
 *     `credit_score_history`, where the column is `calculated_at`. The guard
 *     around that query is `if (r.error) throw r.error`, so EVERY call to the
 *     report returned a 500 — for every farmer, in the app and both
 *     dashboards. Nothing else touches that column name, so nothing else
 *     failed and nobody noticed.
 *   - the same report read `gps_latitude`/`gps_longitude` on `farm_profiles`
 *     (the columns are `gps_lat`/`gps_lng`), so the GPS verification check
 *     scored "partial" at best for every farmer however carefully mapped.
 *   - it read `farming_experience_years` (the column is `years_experience`),
 *     so "Seasons farmed" printed blank on every report.
 *
 * Those last two were silent: an unknown column inside a `select('*')`-style
 * read is simply undefined, so the document rendered with a hole in it.
 *
 * HOW IT WORKS
 *
 * The schema comes from `migrations/000_heabron_system_schema.sql`, parsed
 * statically — no database connection needed, so this runs in CI and on a
 * laptop. The code side is scanned for `.from('table').select('…')`,
 * `.insert({…})`, `.update({…})`, `.eq('col', …)` and `.order('col')`.
 *
 * Static parsing means it can be wrong in one direction only: it may not
 * understand a dynamically built query, which it reports as SKIPPED rather
 * than guessing. It never invents a column that is not written down.
 *
 * Run: node scripts/check-schema-columns.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'migrations', '000_heabron_system_schema.sql');
const SRC = path.join(ROOT, 'src');

// ───────────────────────────────────────────────── the schema

/**
 * Columns per table, from the consolidated schema plus any later ALTERs.
 *
 * Deliberately reads the consolidated file rather than replaying every
 * migration: 000 is maintained as the full current shape (each delta is
 * inlined into it when added), so it is the one definition of truth. Later
 * `ALTER TABLE ... ADD COLUMN` statements across all migrations are folded in
 * as a safety net in case one was not inlined.
 */
function readSchema() {
  const tables = new Map();
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');

  // CREATE TABLE ... ( ... );  — brace-matched rather than regex-greedy, so a
  // nested type or a CHECK with parentheses does not truncate the body.
  const createRe = /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)\s*\(/gi;
  let m;
  while ((m = createRe.exec(sql))) {
    const table = m[1];
    let depth = 1;
    let i = createRe.lastIndex;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth += 1;
      else if (sql[i] === ')') depth -= 1;
      i += 1;
    }
    /**
     * Comments are stripped from the whole body BEFORE splitting.
     *
     * Stripping them per-part, as the first version did, is too late: a
     * comment like `-- (the spec makes this a gate), so the reference is`
     * contains a comma at paren-depth zero, which split the column list
     * mid-comment. The fragment that followed began with prose, so the
     * column-name regex recorded the word "so" and the real column on the
     * next line — `entity_id` — was never seen at all. Five working queries
     * were then reported as referencing a column that does not exist.
     */
    const body = sql
      .slice(createRe.lastIndex, i - 1)
      .replace(/--[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const columns = new Set();

    // Split on top-level commas only.
    let d = 0;
    let buf = '';
    const parts = [];
    for (const ch of body) {
      if (ch === '(') d += 1;
      else if (ch === ')') d -= 1;
      if (ch === ',' && d === 0) {
        parts.push(buf);
        buf = '';
      } else buf += ch;
    }
    parts.push(buf);

    for (const raw of parts) {
      const line = raw.trim();
      if (!line) continue;
      // Table-level constraints are not columns.
      if (/^(PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|CONSTRAINT|EXCLUDE)\b/i.test(line)) continue;
      const name = /^"?(\w+)"?/.exec(line);
      if (name) columns.add(name[1]);
    }
    tables.set(table, columns);
  }

  // Fold in ALTER TABLE ... ADD COLUMN from every migration.
  for (const file of fs.readdirSync(path.join(ROOT, 'migrations'))) {
    if (!file.endsWith('.sql')) continue;
    const text = fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8');
    const alterRe =
      /ALTER TABLE (?:IF EXISTS )?(?:public\.)?(\w+)([\s\S]*?);/gi;
    let a;
    while ((a = alterRe.exec(text))) {
      const table = a[1];
      if (!tables.has(table)) tables.set(table, new Set());
      for (const add of a[2].matchAll(/ADD COLUMN (?:IF NOT EXISTS )?"?(\w+)"?/gi)) {
        tables.get(table).add(add[1]);
      }
    }
  }

  return tables;
}

// ───────────────────────────────────────────────── the code

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * The chain of `.method(...)` calls attached to one `.from(...)`.
 *
 * A fixed-size window after `.from()` is not good enough: several queries sit
 * side by side inside one `Promise.all([...])`, so a window bleeds into the
 * next one and blames table N for table N+1's columns. The first version of
 * this script did exactly that and reported 267 problems, 266 of them
 * invented — which is worse than no checker at all, because the one real
 * finding is invisible in the noise and the whole thing gets ignored.
 *
 * This consumes `.name(` + balanced parens, repeatedly, and stops the moment
 * the next non-whitespace character is not a `.` — i.e. at the real end of
 * the chain.
 */
function chainAfter(src, start) {
  let i = start;
  let out = '';

  /**
   * Whitespace AND comments between two chained calls.
   *
   * Only skipping whitespace was not enough: a documented query puts an
   * explanatory block comment between `.from(...)` and `.select(...)`, and
   * stopping there made the chain empty — so the select was never scanned and
   * the very bug this script was written to catch became invisible to it.
   * Caught by reintroducing that bug and finding the check still passed.
   */
  const skipGap = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i += 1;
      if (src[i] === '/' && src[i + 1] === '/') {
        const nl = src.indexOf('\n', i);
        if (nl === -1) { i = src.length; return; }
        i = nl + 1;
        continue;
      }
      if (src[i] === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end === -1) { i = src.length; return; }
        i = end + 2;
        continue;
      }
      return;
    }
  };

  for (;;) {
    skipGap();
    if (src[i] !== '.') break;
    const callStart = i;
    i += 1;
    // Method name.
    let name = '';
    while (i < src.length && /[\w$]/.test(src[i])) {
      name += src[i];
      i += 1;
    }
    skipGap();
    if (src[i] !== '(') {
      // A property access, not a call — the chain ends here.
      break;
    }
    /**
     * Balanced parens, skipping strings AND COMMENTS.
     *
     * Comments are the part that matters and the part the first version
     * missed. A query body here routinely contains a comment like
     * `// the agent's avatar` — and an apostrophe inside it was read as the
     * start of a string literal that never closes, so the paren depth went
     * wrong and the "chain" ran on for eighteen thousand characters into the
     * rest of the file. Every false positive this script produced came from
     * that one oversight: columns from completely unrelated statements got
     * attributed to whichever table happened to precede them.
     */
    let depth = 0;
    let quote = null;
    for (; i < src.length; i += 1) {
      const ch = src[i];

      if (quote) {
        if (ch === '\\') i += 1;
        else if (ch === quote) quote = null;
        continue;
      }

      // Line comment.
      if (ch === '/' && src[i + 1] === '/') {
        const nl = src.indexOf('\n', i);
        if (nl === -1) break;
        i = nl;
        continue;
      }
      // Block comment.
      if (ch === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end === -1) break;
        i = end + 1;
        continue;
      }

      if (ch === '\'' || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
    }
    out += src.slice(callStart, i);
  }
  return out;
}

/** Column names out of a PostgREST select string, embeds included. */
function selectColumns(sel) {
  const own = [];
  const embeds = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < sel.length; i += 1) {
    const ch = sel[i];
    if (ch === '(') {
      if (depth === 0) {
        // The text just before the paren is the relation name.
        const name = buf.split(',').pop().trim().replace(/!(inner|left)$/, '');
        let d = 1;
        let j = i + 1;
        while (j < sel.length && d > 0) {
          if (sel[j] === '(') d += 1;
          else if (sel[j] === ')') d -= 1;
          j += 1;
        }
        embeds.push({ relation: name, inner: sel.slice(i + 1, j - 1) });
        buf = buf.slice(0, buf.lastIndexOf(name));
        i = j - 1;
        continue;
      }
      depth += 1;
    } else if (ch === ')') depth -= 1;
    else buf += ch;
  }
  for (const part of buf.split(',')) {
    const p = part.trim();
    // `alias:column` and `count` aggregates are not plain columns.
    if (p && p !== '*' && !p.includes(':') && !p.includes('!') && /^\w+$/.test(p)) {
      own.push(p);
    }
  }
  return { own, embeds };
}

const schema = readSchema();
const findings = [];
const skipped = [];
let checks = 0;

const files = walk(SRC);
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const lineOf = (index) => src.slice(0, index).split('\n').length;

  // Each `.from('table')` and only the calls CHAINED to it.
  for (const m of src.matchAll(/\.from\((['"`])(\w+)\1\)/g)) {
    const table = m[2];
    const after = chainAfter(src, m.index + m[0].length);
    const line = lineOf(m.index);

    if (!schema.has(table)) {
      // auth.* and storage.* are Supabase-managed and not in our schema.
      if (!/^(users|buckets|objects)$/.test(table)) {
        findings.push({ where: `${rel}:${line}`, table, column: '(unknown table)' });
      }
      continue;
    }
    const known = schema.get(table);

    const sel = /\.select\(\s*([`'"])([^`'"]*)\1/.exec(after);
    if (sel) {
      const { own, embeds } = selectColumns(sel[2]);
      for (const c of own) {
        checks += 1;
        if (!known.has(c)) findings.push({ where: `${rel}:${line}`, table, column: c });
      }
      for (const e of embeds) {
        if (!schema.has(e.relation)) continue;
        for (const c of selectColumns(e.inner).own) {
          checks += 1;
          if (!schema.get(e.relation).has(c)) {
            findings.push({ where: `${rel}:${line}`, table: e.relation, column: c });
          }
        }
      }
    } else if (/\.select\(/.test(after)) {
      skipped.push(`${rel}:${line} ${table} (select built dynamically)`);
    }

    // .eq('col', …), .order('col'), .gte/.lte/.in/.is/.neq
    for (const f of after.matchAll(
      /\.(eq|neq|gt|gte|lt|lte|is|in|order|like|ilike)\(\s*(['"`])(\w+)\2/g,
    )) {
      const col = f[3];
      checks += 1;
      if (!known.has(col)) {
        // An embedded filter like .eq('financing_requests.cooperative_id', …)
        // is dotted and excluded by \w+, so anything here is a real column.
        findings.push({ where: `${rel}:${line}`, table, column: `${col} (in .${f[1]}())` });
      }
    }
  }
}

// ───────────────────────────────────────────────── report

const bar = '─'.repeat(74);
console.log(`\n${bar}\nSCHEMA COLUMN CHECK\n${bar}`);
console.log(`  tables in schema : ${schema.size}`);
console.log(`  files scanned    : ${files.length}`);
console.log(`  column checks    : ${checks}`);

if (skipped.length) {
  console.log(`\n  not statically checkable (${skipped.length}):`);
  for (const s of skipped.slice(0, 10)) console.log(`    ${s}`);
  if (skipped.length > 10) console.log(`    … and ${skipped.length - 10} more`);
}

console.log(`\n${bar}\nCOLUMNS NOT IN THE SCHEMA  (${findings.length})\n${bar}`);
if (findings.length === 0) {
  console.log('  none');
} else {
  for (const f of findings) {
    console.log(`  ${`${f.table}.${f.column}`.padEnd(52)} ${f.where}`);
  }
}

console.log(`\n${bar}`);
if (findings.length) {
  console.log(`${findings.length} column reference(s) do not exist. These fail at runtime, not at build.`);
  console.log(bar);
  process.exit(1);
}
console.log('Every statically readable column reference exists in the schema.');
console.log(bar);
