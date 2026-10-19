// Wraps the compiled Carbon CSS and IBM Plex Sans (Light, Regular, SemiBold; Latin) into one HtmlService file.
// The fonts are inlined as data URLs so the staff page makes no third-party requests.
//   node tools/carbon/embed.js <work folder with node_modules and carbon.css> <output .html>
const fs = require('fs');
const path = require('path');

const [work, out] = process.argv.slice(2);
const fonts = path.join(work, 'node_modules/@ibm/plex-sans/fonts/split/woff2');
const weights = { 300: 'Light', 400: 'Regular', 600: 'SemiBold' };

const faces = Object.entries(weights).map(([weight, name]) => {
  const data = fs.readFileSync(path.join(fonts, `IBMPlexSans-${name}-Latin1.woff2`)).toString('base64');
  return `@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:${weight};font-display:swap;` +
    `src:url(data:font/woff2;base64,${data}) format('woff2')}`;
}).join('');

const version = require(path.join(work, 'node_modules/@carbon/styles/package.json')).version;
const note = `/* Carbon Design System (@carbon/styles ${version}, Apache-2.0) and IBM Plex Sans (SIL OFL 1.1). ` +
  'Licences in tools/carbon/licenses. Built by tools/carbon/build.sh; do not edit by hand. */';
// Sass starts compressed output with a byte-order mark (or @charset) when it contains non-ASCII text. Placed
// after the font rules, that mark would become part of the first selector (.cds--g10) and break it.
const css = fs.readFileSync(path.join(work, 'carbon.css'), 'utf8').replace(/^﻿/, '').replace(/^@charset "UTF-8";/, '');

fs.writeFileSync(out, `<style>${note}${faces}${css}</style>\n`);
console.log(`${out}: ${Math.round(fs.statSync(out).size / 1024)} KB`);
