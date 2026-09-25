#!/usr/bin/env node
// Catches the "two contexts at once" mistake:
//
//   onclick="fn('${esc(name)}')"     <-- WRONG
//
// A value there sits inside a JS string literal, which itself sits inside an
// HTML attribute. The browser HTML-decodes the attribute BEFORE parsing the
// JS, so esc()'s &#39; becomes a bare apostrophe and ends the string early.
// The handler then fails to compile and the control silently does nothing —
// no error a user would notice, the button just stops working.
//
// That is not a theoretical ordering argument; it was confirmed in a browser
// (an entity-escaped quote produced a null handler, a backslash-escaped one
// produced a working function).
//
// The correct form supplies its own quotes:
//
//   onclick="fn(${jsArg(name)})"     <-- RIGHT
//
// jsArg() JSON-encodes first (handling the JS layer), then escapes & " < >
// (the HTML layer), so decoding yields exactly the JSON literal again.
import { readFileSync, readdirSync } from 'node:fs';

const FILES = [...readdirSync('.').filter((f) => f.endsWith('.html')), 'auth.js', 'app-main.js'];

// Specifically: esc() output inside a quoted JS string in an event attribute.
//
// Deliberately NOT flagging every `fn('${x}')`. Those are widespread (the
// app interpolates record ids into handlers everywhere) and ids are UUIDs, so
// flagging them would produce ~100 hits and the check would be ignored. The
// precise, always-wrong pattern is esc() in that position: esc() exists to
// make a value safe, and there it does the opposite. That is worth failing a
// build over.
//
// Interpolating free text without esc() at all is a separate concern, tracked
// on its own rather than folded in here.
const BAD = /\bon[a-z]+\s*=\s*"[^"]*?(['`])[^"]*?\$\{[^}]*\besc\s*\(/i;

let failed = 0;
let scanned = 0;

for (const file of FILES) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  scanned++;
  text.split('\n').forEach((line, i) => {
    if (!/\bon[a-z]+\s*=/i.test(line)) return;
    if (!BAD.test(line)) return;
    failed++;
    console.error(`FAIL  ${file}:${i + 1}`);
    console.error(`      ${line.trim().slice(0, 150)}`);
    console.error(`      A value is interpolated into a JS string inside an event attribute.`);
    console.error(`      Use  fn(\${jsArg(value)})  with no surrounding quotes.`);
  });
}

if (failed) {
  console.error(
    `\ncheck-html-contexts: ${failed} double-context interpolation(s).\n` +
    `esc() does not make a value safe inside a JS string — see the note at the\n` +
    `top of this file, and jsArg() in app-main.js / crm.html.`
  );
} else {
  console.log(`check-html-contexts: ${scanned} file(s) scanned, no double-context interpolation`);
}
process.exit(failed ? 1 : 0);
