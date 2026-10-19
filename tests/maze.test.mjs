import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallLayout } from '../js/maze.js';

test('벽 칸: 앞→오른쪽→뒤→왼쪽으로 돌아가며 한 칸씩, 새 키워드는 뒤에 붙음', () => {
  const a = wallLayout(5);
  assert.deepEqual(a.cells.map((c) => c.wall), [0, 1, 2, 3, 0]);
  assert.deepEqual(a.cells[4], { wall: 0, col: 1, row: 0 });
  // 하나 늘어도 앞의 다섯 자리는 그대로
  assert.deepEqual(wallLayout(6).cells.slice(0, 5), a.cells);
});

test('벽 칸 수: 키워드가 많아지면 칸을 잘게', () => {
  assert.equal(wallLayout(8).cols, 3);
  assert.equal(wallLayout(40).cols, 4);
  assert.equal(wallLayout(80).cols, 5);
  assert.ok(wallLayout(0).rows >= 2);
});
