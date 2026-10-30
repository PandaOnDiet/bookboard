// The board capsule: the board as plain text to paste into a new chat; nothing is written.
// Run: node --test scripts/
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const run = (dir, ...args) => execFileSync(process.execPath, [path.join(__dirname, 'session-start.js'), ...args],
  { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });

const board = (text) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookboard-'));
  fs.mkdirSync(path.join(dir, '.board'));
  fs.writeFileSync(path.join(dir, '.board', 'board.md'), text);
  return dir;
};

test('capsule: pinned notes, open work and the last 5 done, without instructions meant for Claude', () => {
  const done = Array.from({ length: 7 }, (_, i) => `- [x] done ${i}`).join('\n');
  const dir = board(`# Board\n\n## Pinned notes\n- Tests first\n\n## To do\n- [ ] Add login\n\n## In progress\n- [ ] Fix sync\n\n## Parked\n- [ ] Mac build\n\n## Done\n${done}\n`);
  const before = fs.readdirSync(path.join(dir, '.board'));
  const c = run(dir, '--capsule');
  assert.match(c, new RegExp(`^Bookboard capsule: ${path.basename(dir)}`));
  for (const s of ['## Pinned notes\n- Tests first', '## In progress\n- [ ] Fix sync', '## To do\n- [ ] Add login', '## Parked\n- [ ] Mac build']) assert.ok(c.includes(s), s);
  // The board keeps Done newest first, so the last 5 done are the top 5.
  assert.ok(c.includes('## Done (last 5)') && c.includes('done 0') && c.includes('done 4') && !c.includes('done 5'), 'not the last 5 done');
  assert.ok(!/Tick tasks|bookboard skill/.test(c), 'session instructions leaked into the capsule');
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.board')), before, 'a file was written');
});

test('capsule without a board says so instead of printing nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookboard-'));
  assert.match(run(dir, '--capsule'), /No board in this project yet/);
});

test('the session-start output is unchanged by the capsule mode', () => {
  const dir = board('## Pinned notes\n- Tests first\n\n## Done\n- [x] old\n');
  const s = run(dir);
  assert.match(s, /^Project board \(\.board\/board\.md\)\. Follow the pinned notes\./);
  assert.ok(!s.includes('old'), 'done tasks reached the session context');
});
