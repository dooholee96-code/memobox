import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignRooms, placeNew, freeSlot } from '../js/palace.js';

test('방 자리: 이미 정한 방은 그대로, 새 방은 빈 칸에', () => {
  const first = assignRooms(['inbox', 'resource', 'a1']);
  assert.deepEqual(first, { inbox: { col: 0, row: 0 }, resource: { col: 1, row: 0 }, a1: { col: 2, row: 0 } });
  // a1이 사라지고 b2가 생겨도 inbox·resource는 안 움직이고, b2는 빈 칸(2,0)
  const second = assignRooms(['inbox', 'resource', 'b2'], { inbox: first.inbox, resource: first.resource });
  assert.deepEqual(second.inbox, first.inbox);
  assert.deepEqual(second.b2, { col: 2, row: 0 });
  // 이름 순서가 바뀌어도 저장된 칸 유지
  const third = assignRooms(['b2', 'inbox', 'resource'], second);
  assert.deepEqual(third, second);
});

test('키워드 자리: 처음 보는 것만 빈 칸에, 이미 있는 자리는 안 건드림', () => {
  const items = [{ id: 'x', room: 'inbox' }, { id: 'y', room: 'inbox' }, { id: 'z', room: 'resource' }];
  const pos = { x: { room: 'inbox', x: 16, y: 84 } };
  const fresh = placeNew(items, pos);
  assert.equal(fresh.x, undefined);
  assert.equal(fresh.y.room, 'inbox');
  assert.notDeepEqual([fresh.y.x, fresh.y.y], [16, 84]);
  assert.deepEqual(fresh.z, { room: 'resource', x: 16, y: 84 });
});

test('다른 방으로 옮긴 메모는 새 방에서 자리를 다시 받음', () => {
  const fresh = placeNew([{ id: 'x', room: 'resource' }], { x: { room: 'inbox', x: 200, y: 300 } });
  assert.deepEqual(fresh.x, { room: 'resource', x: 16, y: 84 });
});

test('빈 칸 찾기: 겹치지 않게 옆·아래로', () => {
  const a = freeSlot([]);
  const b = freeSlot([a]);
  const c = freeSlot([a, b]);
  assert.deepEqual(a, { x: 16, y: 84 });
  assert.equal(b.y, 84);
  assert.ok(b.x > a.x);
  assert.ok(c.x > b.x);
  const d = freeSlot([a, b, c]);
  assert.ok(d.y > a.y);
});
