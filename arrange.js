'use strict';
/*
  Puts the site's files into their folders.

  The site expects three folders: src, src/engines and public. Uploading through GitHub's web page can
  drop every file into one place with no folders at all. This script runs before the site starts
  (see "postinstall" and "start" in package.json) and moves each file to where it belongs.

  If the folders are already there, it does nothing. It is safe to run any number of times.
*/
const fs = require('fs');
const path = require('path');

const LAYOUT = {
  'src': ['card.js', 'config.js', 'db.js', 'errors.js', 'jobs.js', 'legal.json', 'limits.js', 'lyrics.js', 'notify.js', 'occasions.json', 'page.html', 'photo.js', 'sections.js', 'sheet.js', 'touches.js', 'vendors.js'],
  'src/engines': ['index.js', 'elevenlabs.js', 'mock.js', 'mureka.js', 'sunoapi.js'],
  'public': ['common.js', 'gift.html', 'gift.js', 'index.html', 'join.js', 'make.js', 'styles.css', 'testimonials.json'],
};

let moved = 0;
const missing = [];
for (const [dir, files] of Object.entries(LAYOUT)) {
  for (const name of files) {
    const loose = path.join(__dirname, name), placed = path.join(__dirname, dir, name);
    if (fs.existsSync(loose)) {
      // A loose copy is the one that was just uploaded, so it replaces whatever is in the folder.
      fs.mkdirSync(path.dirname(placed), { recursive: true });
      fs.renameSync(loose, placed);
      moved++;
    } else if (!fs.existsSync(placed)) {
      missing.push(dir + '/' + name);
    }
  }
}

if (moved) console.log(`arrange: moved ${moved} file${moved === 1 ? '' : 's'} into src, src/engines and public.`);
if (missing.length) {
  console.error('arrange: these files are missing, so the site cannot start. Upload them again:\n  ' + missing.join('\n  '));
  process.exit(1);
}
