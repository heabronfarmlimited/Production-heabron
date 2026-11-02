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

// ───────────────────────────────────────────────── the enum types

/**
 * Enum labels, and which column is of which enum type.
 *
 * WHY: an enum comparison against a label that does not exist is not an empty
 * result. Postgres raises 22P02 and the whole request fails. The admin Yield
 * Verification screen shipped sending `status=unverified` on a column whose
 * type is `yield_verification_status` (`pending | verified | rejected`), so
 * its default tab returned 400 and the table showed nothing — which looks
 * exactly like a working list with no records in it.
 *
 * A column check cannot catch that: `verification_status` exists. Only the
 * VALUE is wrong, so the value needs checking too.
 */
function readEnums() {
  const labels = new Map();
  const columnEnum = new Map(); // table -> Map(column -> enum type)
  const files = fs
    .readdirSync(path.join(ROOT, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8');

    for (const m of sql.matchAll(/CREATE TYPE (?:public\.)?(\w+) AS ENUM\s*\(([\s\S]*?)\)/gi)) {
      if (!labels.has(m[1])) {
        labels.set(m[1], [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]));
      }
    }
    // `ALTER TYPE … ADD VALUE IF NOT EXISTS 'x'` is how later labels arrive on
    // an existing database; they count just as much as the original list.
    for (const m of sql.matchAll(
      /ALTER TYPE (?:public\.)?(\w+) ADD VALUE (?:IF NOT EXISTS )?'([^']*)'/gi,
    )) {
      const list = labels.get(m[1]);
      if (list && !list.includes(m[2])) list.push(m[2]);
    }
  }

  const typed = (table, column, type) => {
    if (!labels.has(type)) return;
    if (!columnEnum.has(table)) columnEnum.set(table, new Map());
    columnEnum.get(table).set(column, type);
  };

  for (const file of files) {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8');

    // CREATE TABLE bodies — same brace-matched read as readSchema().
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
      const body = sql
        .slice(createRe.lastIndex, i - 1)
        .replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      for (const line of body.split(/,(?![^(]*\))/)) {
        const def = /^\s*"?(\w+)"?\s+(?:public\.)?(\w+)/.exec(line);
        if (def) typed(table, def[1], def[2]);
      }
    }

    for (const a of sql.matchAll(/ALTER TABLE (?:IF EXISTS )?(?:public\.)?(\w+)([\s\S]*?);/gi)) {
      for (const add of a[2].matchAll(
        /ADD COLUMN (?:IF NOT EXISTS )?"?(\w+)"?\s+(?:public\.)?(\w+)/gi,
      )) {
        typed(a[1], add[1], add[2]);
      }
    }
  }

  return { labels, columnEnum };
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
const { labels: enumLabels, columnEnum } = readEnums();
const findings = [];
const badValues = [];
const skipped = [];
let checks = 0;
let valueChecks = 0;

/** The enum type of `table.column`, or null when the column is not an enum. */
const enumTypeOf = (table, column) => columnEnum.get(table)?.get(column) || null;

/**
 * Records a literal written to an enum column, if it is not a label.
 *
 * Only string literals are judged. A variable, a template literal with an
 * interpolation, or anything computed is left alone — a checker that guesses
 * is worse than no checker, which this codebase learned the hard way.
 */
function checkEnumValue({ table, column, value, where, how }) {
  const type = enumTypeOf(table, column);
  if (!type) return;
  const allowed = enumLabels.get(type);
  if (!allowed) return;
  valueChecks += 1;
  if (!allowed.includes(value)) {
    badValues.push({ where, table, column, type, value, allowed, how });
  }
}

/**
 * `key: 'literal'` pairs of an object literal, and only those.
 *
 * Matching `(\w+)\s*:\s*'…'` anywhere in the body is not good enough, and the
 * first version of this did exactly that: a ternary inside a value —
 *
 *     nin_verification_status: r.status === 'verified' ? r.status : 'failed',
 *
 * ends in `status : 'failed'`, which that pattern reads as the property
 * `status` being set to `failed`, and reported a working write as broken. So
 * the body is split on top-level commas (strings and nesting respected) and
 * each part must be a whole `key: 'literal'` and nothing else. A computed
 * value is then simply not checkable, which is the correct answer for it.
 */
function objectLiteralPairs(body) {
  const parts = [];
  let buf = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      buf += ch;
      if (ch === '\\') {
        buf += body[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  parts.push(buf);

  const pairs = [];
  for (const raw of parts) {
    const part = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const m = /^(\w+)\s*:\s*(['"])([^'"\\]*)\2$/.exec(part);
    if (m) pairs.push({ key: m[1], value: m[3] });
  }
  return pairs;
}

/**
 * The object literal a name was last assigned before `before`, as text.
 *
 * Writes in this codebase are almost never inline: they are built as
 * `const row = { … }` and then `.insert(row)`. Checking only inline literals
 * would therefore miss nearly every write, including the one that sets a
 * season's verification status. Returns null when the name is not bound to a
 * plain object literal, which leaves it unchecked rather than guessed at.
 */
function objectLiteralFor(src, name, before) {
  const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`, 'g');
  let last = null;
  let m;
  while ((m = re.exec(src)) && m.index < before) last = m;
  if (!last) return null;
  let depth = 1;
  let i = last.index + last[0].length;
  let quote = null;
  for (; i < src.length && depth > 0; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '/' && src[i + 1] === '/') i = src.indexOf('\n', i);
    else if (ch === '/' && src[i + 1] === '*') i = src.indexOf('*/', i + 2) + 1;
    else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (i < 0) return null;
  }
  return src.slice(last.index + last[0].length, i - 1);
}

/** String literals passed to a filter: `.eq('col', 'value')`, `.in('col', ['a','b'])`. */
function filterValues(argsText) {
  // Everything after the first top-level comma.
  const comma = argsText.indexOf(',');
  if (comma === -1) return [];
  const rest = argsText.slice(comma + 1);
  // A template literal or an identifier means the value is computed; only
  // plain quoted strings are checkable.
  if (/\$\{/.test(rest)) return [];
  return [...rest.matchAll(/(['"])([^'"\\]*)\1/g)].map((m) => m[2]);
}

/**
 * Checks the filters and writes in one fragment of a query against `table`.
 *
 * Shared by the two ways a query is written here: chained straight onto
 * `.from(…)`, and applied later to a variable holding the builder.
 */
function checkFragment({ table, known, fragment, base, rel, line, lineOf, src }) {
  const at = (offset) => (base === null ? `${rel}:${line}` : `${rel}:${lineOf(base + offset)}`);

  // .eq('col', …), .order('col'), .gte/.lte/.in/.is/.neq
  for (const f of fragment.matchAll(
    /\.(eq|neq|gt|gte|lt|lte|is|in|order|like|ilike)\(\s*(['"`])(\w+)\2([^)]*)\)/g,
  )) {
    const col = f[3];
    checks += 1;
    if (!known.has(col)) {
      // An embedded filter like .eq('financing_requests.cooperative_id', …)
      // is dotted and excluded by \w+, so anything here is a real column.
      findings.push({ where: `${rel}:${line}`, table, column: `${col} (in .${f[1]}())` });
      continue;
    }
    if (f[1] === 'eq' || f[1] === 'neq' || f[1] === 'in') {
      for (const value of filterValues(f[4])) {
        checkEnumValue({ table, column: col, value, where: at(f.index), how: `.${f[1]}()` });
      }
    }
  }

  /**
   * Literals written into an enum column by an insert or an update.
   *
   * A filter with a bad label fails loudly. A WRITE with a bad label fails
   * loudly too — but only on the code path that performs it, which may be a
   * rejection branch nobody exercises until a real rejection happens.
   */
  for (const w of fragment.matchAll(/\.(insert|update|upsert)\(\s*\{([\s\S]*?)\}\s*[,)]/g)) {
    for (const pair of objectLiteralPairs(w[2])) {
      checkEnumValue({
        table,
        column: pair.key,
        value: pair.value,
        where: at(w.index),
        how: `.${w[1]}()`,
      });
    }
  }

  // `.insert(row)` where `row` is a `const row = { … }` nearby.
  if (base !== null) {
    for (const w of fragment.matchAll(/\.(insert|update|upsert)\(\s*(\w+)\s*[,)]/g)) {
      const body = objectLiteralFor(src, w[2], base);
      if (!body) continue;
      for (const pair of objectLiteralPairs(body)) {
        checkEnumValue({
          table,
          column: pair.key,
          value: pair.value,
          where: at(w.index),
          how: `.${w[1]}(${w[2]})`,
        });
      }
    }
  }
}

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

    checkFragment({
      table,
      known,
      fragment: after,
      base: m.index + m[0].length,
      rel,
      line,
      lineOf,
      src,
    });
  }

  /**
   * Filters applied to a query held in a VARIABLE, not chained to `.from()`.
   *
   * Every list endpoint in this codebase is written as
   *
   *     let q = sb.from('seasonal_productions').select(…);
   *     if (status) q = q.eq('verification_status', status);
   *
   * and `chainAfter` stops at the end of the first statement, so none of
   * those conditional filters were ever checked — a blind spot big enough to
   * hide the whole of every list route. Found by reintroducing the
   * `status=unverified` bug and watching the check still pass.
   *
   * The region attributed to the variable runs from the assignment to the end
   * of the enclosing top-level function (a `}` in column 0), or to the next
   * `… = sb.from(` assignment of the SAME name, whichever comes first — so a
   * function that builds two queries in turn does not cross-contaminate.
   */
  for (const v of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*\w+\s*\n?\s*\.from\((['"`])(\w+)\2\)/g)) {
    const [, name, , table] = v;
    if (!schema.has(table)) continue;
    const start = v.index + v[0].length;
    const endOfFn = src.indexOf('\n}', start);
    const reassign = new RegExp(`\\b${name}\\s*=\\s*\\w+\\s*\\n?\\s*\\.from\\(`).exec(src.slice(start));
    let end = endOfFn === -1 ? src.length : endOfFn;
    if (reassign) end = Math.min(end, start + reassign.index);
    const region = src.slice(start, end);

    // Only `name.method(…)` calls, so a second query built in the same
    // function is not misattributed. `chainAfter` does the balanced-paren,
    // string- and comment-aware read, exactly as for a literal chain.
    for (const use of region.matchAll(new RegExp(`\\b${name}\\b(?=\\s*\\.)`, 'g'))) {
      const at = start + use.index + use[0].length;
      checkFragment({
        table,
        known: schema.get(table),
        fragment: chainAfter(src, at),
        base: at,
        rel,
        line: lineOf(at),
        lineOf,
        src,
      });
    }
  }
}

// ───────────────────────────────────────────────── enums.js against the schema

/**
 * `src/utils/enums.js` hard-codes the labels so the validators can reject a
 * bad status before it reaches Postgres. Hard-coded means it can drift, so it
 * is compared against the migrations here: add a label to the schema and this
 * fails until it is added there too.
 */
const enumDrift = [];
{
  // eslint-disable-next-line global-require
  const { ENUM_LABELS } = require(path.join(SRC, 'utils', 'enums.js'));
  for (const [type, declared] of Object.entries(ENUM_LABELS)) {
    const actual = enumLabels.get(type);
    if (!actual) {
      enumDrift.push(`${type}: declared in enums.js but not in any migration`);
      continue;
    }
    const missing = actual.filter((l) => !declared.includes(l));
    const extra = declared.filter((l) => !actual.includes(l));
    if (missing.length) enumDrift.push(`${type}: missing in enums.js -> ${missing.join(', ')}`);
    if (extra.length) enumDrift.push(`${type}: in enums.js but not in the schema -> ${extra.join(', ')}`);
  }
}

// ───────────────────────────────────────────────── report

const bar = '─'.repeat(74);
console.log(`\n${bar}\nSCHEMA COLUMN CHECK\n${bar}`);
console.log(`  tables in schema : ${schema.size}`);
console.log(`  enum types       : ${enumLabels.size}`);
console.log(`  files scanned    : ${files.length}`);
console.log(`  column checks    : ${checks}`);
console.log(`  enum value checks: ${valueChecks}`);

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

console.log(`\n${bar}\nVALUES THAT ARE NOT LABELS ON THEIR ENUM  (${badValues.length})\n${bar}`);
if (badValues.length === 0) {
  console.log('  none');
} else {
  for (const b of badValues) {
    console.log(`  ${b.table}.${b.column} ${b.how} = "${b.value}"   ${b.where}`);
    console.log(`      ${b.type} allows: ${b.allowed.join(' | ')}`);
  }
}

console.log(`\n${bar}\nenums.js AGAINST THE MIGRATIONS  (${enumDrift.length})\n${bar}`);
if (enumDrift.length === 0) {
  console.log('  in sync');
} else {
  for (const d of enumDrift) console.log(`  ${d}`);
}

console.log(`\n${bar}`);
if (findings.length || badValues.length || enumDrift.length) {
  if (findings.length) {
    console.log(`${findings.length} column reference(s) do not exist. These fail at runtime, not at build.`);
  }
  if (badValues.length) {
    console.log(`${badValues.length} value(s) are not labels on their enum. Postgres answers these with 22P02 — the request fails, it does not return nothing.`);
  }
  if (enumDrift.length) {
    console.log(`${enumDrift.length} enum definition(s) in src/utils/enums.js no longer match the migrations.`);
  }
  console.log(bar);
  process.exit(1);
}
console.log('Every statically readable column reference exists, every enum value is a real label,');
console.log('and src/utils/enums.js matches the migrations.');
console.log(bar);
