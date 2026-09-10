import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/state.ts';

const ev = (name: string, extra: Record<string, unknown> = {}) => ({ hook: { hook_event_name: name, session_id: 's1', cwd: '/tmp/x', ...extra } });

test('SubagentStart/Stop vedou seznam subagentů', () => {
  const st = new Store();
  st.apply(ev('SessionStart'));
  st.apply(ev('SubagentStart', { agent_id: 'a1', agent_type: 'Explore', description: 'hledá usage' }));
  st.apply(ev('SubagentStart', { agent_id: 'a2', agent_type: 'general-purpose' }));
  const s = st.sessions.get('s1')!;
  assert.equal(s.subagents.length, 2);
  assert.equal(s.subagents[0].description, 'hledá usage');
  assert.equal(s.subagents[1].description, 'general-purpose');
  st.apply(ev('SubagentStop', { agent_id: 'a1' }));
  assert.deepEqual(s.subagents.map(a => a.id), ['a2']);
});

test('SubagentStop bez id odebere nejstaršího', () => {
  const st = new Store();
  st.apply(ev('SessionStart'));
  st.apply(ev('SubagentStart', { agent_id: 'a1' }));
  st.apply(ev('SubagentStart', { agent_id: 'a2' }));
  st.apply(ev('SubagentStop'));
  assert.deepEqual(st.sessions.get('s1')!.subagents.map(a => a.id), ['a2']);
});

test('projectResolver přiřadí projectId podle cwd', () => {
  const st = new Store();
  st.projectResolver = cwd => (cwd.startsWith('/tmp/x') ? 'proj-x' : undefined);
  st.apply(ev('SessionStart'));
  assert.equal(st.sessions.get('s1')!.projectId, 'proj-x');
});

test('idle_prompt nepřepne hotové sezení na čeká a tick ho nechá hotové', () => {
  const st = new Store();
  st.apply(ev('SessionStart'));
  st.apply(ev('Stop', { last_assistant_message: 'hotovo' }));
  st.apply(ev('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }));
  const s = st.sessions.get('s1')!;
  assert.equal(s.status, 'completed');
  s.statusSince -= 10 * 60_000;
  st.tick(() => true);
  assert.equal(s.status, 'completed');
});

test('hotové sezení otevřené v aplikaci je viděné, nový tah to zruší', () => {
  const st = new Store();
  let focused = 0;
  st.desktopResolver = () => ({ desktopId: 'local_x', title: 'T', lastFocusedAt: focused });
  st.apply(ev('SessionStart'));
  st.apply(ev('Stop'));
  const s = st.sessions.get('s1')!;
  assert.ok(!s.seen);
  focused = Date.now() + 1000;
  st.refreshDesktop();
  assert.equal(s.seen, true);
  st.apply(ev('UserPromptSubmit', { user_prompt: 'dál' }));
  assert.equal(s.seen, false);
});

test('markSeen: otevření z Kanclu označí hotové jako viděné', () => {
  const st = new Store();
  st.apply(ev('SessionStart'));
  st.apply(ev('Stop'));
  st.markSeen('s1');
  assert.equal(st.sessions.get('s1')!.seen, true);
});
