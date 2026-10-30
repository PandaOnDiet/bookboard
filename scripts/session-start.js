// Prints the project's pinned notes and open tasks so Claude reads them at the
// start of every session. Plain stdout from a SessionStart hook becomes context.
// With --capsule (/bookboard:capsule) it prints the board as text to paste into a
// new chat instead: no instructions for Claude, the last 5 done, nothing written.
const fs = require('fs');
const path = require('path');

const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const file = path.join(dir, '.board', 'board.md');
const capsule = process.argv.includes('--capsule');
if (!fs.existsSync(file)) {
  if (capsule) process.stdout.write('No board in this project yet (.board/board.md).\n');
  process.exit(0);
}

const text = fs.readFileSync(file, 'utf8');

// Split the file into "## Heading" sections, line by line.
const sections = {};
let cur = null;
for (const line of text.split(/\r?\n/)) {
  const h = line.match(/^## (.+?)\s*$/);
  if (h) { cur = h[1]; sections[cur] = []; continue; }
  if (cur && line.trim()) sections[cur].push(line);
}
const section = name => (sections[name] || []).join('\n');

const parts = [
  ['Pinned notes', section('Pinned notes')],
  ['In progress', section('In progress')],
  ['To do', section('To do')],
  ['Parked', section('Parked')],
].filter(([, body]) => body);

if (capsule) {
  const done = (sections['Done'] || []).slice(0, 5); // newest first on the board
  if (done.length) parts.push(['Done (last 5)', done.join('\n')]);
  process.stdout.write(`Bookboard capsule: ${path.basename(dir)}\n\n` + parts.map(([n, b]) => '## ' + n + '\n' + b).join('\n\n') + '\n');
  process.exit(0);
}
if (!parts.length) process.exit(0);

let out = 'Project board (.board/board.md). Follow the pinned notes. Tick tasks when their work is done (bookboard skill).\n\n'
  + parts.map(([n, b]) => '## ' + n + '\n' + b).join('\n\n');
if (out.length > 9000) out = out.slice(0, 9000) + '\n… (board truncated; read .board/board.md for the rest)';
process.stdout.write(out + '\n');
