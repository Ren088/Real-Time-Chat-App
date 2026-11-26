const DEFAULT_ROOMS = ['general', 'random', 'music', 'gaming'];

const me = { id: Math.random().toString(36).slice(2, 10), name: '', room: 'general' };
let rooms = [...DEFAULT_ROOMS];
let messages = [];
let peers = {};
let typers = {};
let unread = {};
let lastSender = null;
let lastTypingSent = 0;
let joinRoom = 'general';
let flashTimer;

const $ = id => document.getElementById(id);
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('pulse-chat-v2') : null;

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

const roomMessages = room => load('pulse:msgs:' + room, []);
const peersIn = room => Object.values(peers).filter(p => p.room === room);
const formatTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const color = text => `hsl(${[...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)}, 55%, 42%)`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function send(data) {
  channel?.postMessage({ ...data, from: me.id, name: me.name, room: me.room });
}

function loadRooms() {
  for (const room of load('pulse:rooms', [])) {
    if (!rooms.includes(room)) rooms.push(room);
  }
}

function flash() {
  $('bars').classList.add('live');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => $('bars').classList.remove('live'), 1400);
}

function addMessage(m) {
  $('log').querySelector('.empty')?.remove();

  const mine = m.sender === me.id;
  const first = m.sender !== lastSender;
  const row = el('div', `row ${mine ? 'me' : 'them'}${first ? ' first' : ''}`);

  if (!mine && first) {
    const who = el('div', 'who', m.name);
    who.style.color = color(m.name);
    row.append(who);
  }
  row.append(el('div', 'bubble', m.text), el('div', 'time', formatTime(m.ts)));

  $('log').append(row);
  lastSender = m.sender;
  $('log').scrollTop = $('log').scrollHeight;
}

function showMessages() {
  $('log').innerHTML = '';
  lastSender = null;
  if (!messages.length) {
    $('log').append(el('div', 'empty', `No messages in #${me.room} yet. Say hello to start the conversation.`));
  }
  messages.forEach(addMessage);
}

function renderSidebar() {
  $('rooms').replaceChildren(...rooms.map(room => {
    const button = el('button', 'room' + (room === me.room ? ' on' : ''));
    button.type = 'button';
    button.onclick = () => switchRoom(room);

    const meta = el('span', 'meta');
    if (unread[room]) meta.append(el('span', 'unread', unread[room]));
    const count = peersIn(room).length + (room === me.room ? 1 : 0);
    meta.append(el('span', '', count || ''));

    button.append(el('span', '', '# ' + room), meta);
    return button;
  }));

  const people = [
    { label: `${me.name} (you)`, name: me.name },
    ...peersIn(me.room).map(p => ({ label: p.name, name: p.name })),
  ];
  $('people').replaceChildren(...people.map(p => {
    const avatar = el('span', 'av', p.name[0].toUpperCase());
    avatar.style.background = color(p.name);
    const chip = el('div', 'chip');
    chip.append(avatar, el('span', '', p.label));
    return chip;
  }));

  $('peoplehead').textContent = `In #${me.room}`;
  $('roomname').textContent = `# ${me.room}`;
  $('roomcount').textContent = people.length === 1 ? '1 person here' : `${people.length} people here`;
  $('count').textContent = `${Object.keys(peers).length + 1} online`;
  $('text').placeholder = `Message #${me.room}`;
}

function renderTyping() {
  const names = Object.values(typers).filter(t => t.room === me.room).map(t => t.name);
  $('typing').textContent =
    !names.length ? '' :
    names.length > 2 ? 'Several people are typing…' :
    `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} typing…`;
}

function switchRoom(room) {
  if (room === me.room) return;
  me.room = room;
  save('pulse:room', room);
  unread[room] = 0;
  typers = {};
  messages = roomMessages(room);
  showMessages();
  renderSidebar();
  renderTyping();
  send({ type: 'presence' });
  $('text').focus();
}

function addRoom() {
  const name = $('newroom').value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  $('newroom').value = '';
  if (!name) return;

  if (!rooms.includes(name)) {
    rooms.push(name);
    save('pulse:rooms', rooms.filter(r => !DEFAULT_ROOMS.includes(r)));
    send({ type: 'room' });
  }
  switchRoom(name);
  renderSidebar();
}

function sendMessage() {
  const text = $('text').value.trim();
  if (!text) return;

  const m = { id: me.id + Date.now(), sender: me.id, name: me.name, room: me.room, text, ts: Date.now() };
  messages = [...roomMessages(me.room), m].slice(-200);
  save('pulse:msgs:' + me.room, messages);

  addMessage(m);
  flash();
  send({ type: 'msg', m });

  $('text').value = '';
  $('text').focus();
}

const handlers = {
  msg(d) {
    const m = d.m;
    if (!rooms.includes(m.room)) { loadRooms(); renderSidebar(); }

    if (m.room === me.room) {
      if (messages.some(x => x.id === m.id)) return;
      messages.push(m);
      delete typers[d.from];
      addMessage(m);
      renderTyping();
    } else {
      unread[m.room] = (unread[m.room] || 0) + 1;
      renderSidebar();
    }
    flash();
  },

  presence(d) {
    const old = peers[d.from];
    peers[d.from] = { name: d.name, room: d.room, seen: Date.now() };
    if (!old || old.room !== d.room) {
      delete typers[d.from];
      renderSidebar();
      renderTyping();
    }
  },

  hello(d) {
    handlers.presence(d);
    send({ type: 'presence' });
  },

  room() {
    loadRooms();
    renderSidebar();
  },

  bye(d) {
    delete peers[d.from];
    delete typers[d.from];
    renderSidebar();
    renderTyping();
  },

  typing(d) {
    typers[d.from] = { name: d.name, room: d.room, seen: Date.now() };
    if (d.room === me.room) { renderTyping(); flash(); }
  },
};

if (channel) {
  channel.onmessage = ({ data }) => {
    if (data && data.from !== me.id) handlers[data.type]?.(data);
  };
}

function start(name, room) {
  me.name = name;
  me.room = room;
  save('pulse:name', name);
  save('pulse:room', room);
  messages = roomMessages(room);

  $('join').style.display = 'none';
  showMessages();
  renderSidebar();
  send({ type: 'hello' });
  $('text').focus();

  setInterval(() => {
    send({ type: 'presence' });
    const now = Date.now();
    let changed = false;
    for (const [id, p] of Object.entries(peers)) {
      if (now - p.seen > 9000) { delete peers[id]; changed = true; }
    }
    for (const [id, t] of Object.entries(typers)) {
      if (now - t.seen > 3000) { delete typers[id]; changed = true; }
    }
    if (changed) { renderSidebar(); renderTyping(); }
  }, 3000);
}

function renderJoinRooms() {
  $('joinrooms').replaceChildren(...rooms.map(room => {
    const button = el('button', 'pick' + (room === joinRoom ? ' on' : ''), '# ' + room);
    button.type = 'button';
    button.onclick = () => { joinRoom = room; renderJoinRooms(); };
    return button;
  }));
}

function updatePreview() {
  const name = $('name').value.trim();
  $('preview').textContent = name ? name[0].toUpperCase() : '?';
  $('preview').style.background = name ? color(name) : '';
}

function tryJoin() {
  const name = $('name').value.trim();
  if (name) start(name, joinRoom);
  else $('name').focus();
}

loadRooms();
const savedRoom = load('pulse:room', 'general');
if (rooms.includes(savedRoom)) joinRoom = savedRoom;
renderJoinRooms();

$('name').value = load('pulse:name', '');
updatePreview();
if (!channel) $('support').textContent = 'This browser doesn’t support live sync between tabs.';

$('name').oninput = updatePreview;
$('name').onkeydown = e => { if (e.key === 'Enter') tryJoin(); };
$('enter').onclick = tryJoin;

$('newroom').onkeydown = e => { if (e.key === 'Enter') addRoom(); };
$('send').onclick = sendMessage;
$('text').onkeydown = e => { if (e.key === 'Enter') sendMessage(); };
$('text').oninput = () => {
  if (Date.now() - lastTypingSent > 1500) {
    lastTypingSent = Date.now();
    send({ type: 'typing' });
  }
};

addEventListener('beforeunload', () => send({ type: 'bye' }));
