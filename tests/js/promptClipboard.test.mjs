import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

const modulePath = path.join(rootDir, 'web/js/utils/promptClipboard.js');
const {
  parsePromptText,
  sanitizePromptItems,
  reorderItems,
  formatPromptItems,
  coerceSeparator,
} = await import(modulePath);

function testSanitizePromptItems() {
  const values = ['  Foo  ', 'foo', 'BAR', 'bar', null, 'baz', 'baz', 'multi\r\nline'];
  const result = sanitizePromptItems(values);
  assert.deepEqual(result, ['Foo', 'BAR', 'baz', 'multi\nline']);
}

function testParsePromptText() {
  const comma = parsePromptText('one, two,three', 'comma');
  assert.deepEqual(comma, ['one', 'two', 'three']);
  const newline = parsePromptText('alpha\n\n beta\r\ngamma');
  assert.deepEqual(newline, ['alpha', 'beta', 'gamma']);
  const pipe = parsePromptText('a|b|c|a', 'pipe');
  assert.deepEqual(pipe, ['a', 'b', 'c']);
}

function testReorderItems() {
  const source = ['one', 'two', 'three'];
  const moved = reorderItems(source, 0, 2);
  assert.deepEqual(moved, ['two', 'three', 'one']);
  assert.deepEqual(source, ['one', 'two', 'three'], 'original array is not mutated');
  const same = reorderItems(source, 5, 1);
  assert.deepEqual(same, source);
}

function testFormatPromptItems() {
  const items = ['one', 'two'];
  assert.equal(formatPromptItems(items, 'comma'), 'one, two');
  assert.equal(formatPromptItems(items, 'newline'), 'one\ntwo');
  assert.equal(formatPromptItems([], 'newline'), '');
}

function testCoerceSeparator() {
  assert.equal(coerceSeparator('comma'), 'comma');
  assert.equal(coerceSeparator('unknown'), 'newline');
}

function run() {
  testSanitizePromptItems();
  testParsePromptText();
  testReorderItems();
  testFormatPromptItems();
  testCoerceSeparator();
  console.log('promptClipboard tests passed');
}

run();
