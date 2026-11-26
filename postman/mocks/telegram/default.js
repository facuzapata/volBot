/* Contract subset: https://core.telegram.org/bots/api. Synthetic token and chats ONLY. */
const http = require('http');
const prefix = 'telegram.commands.';
const read = async (key, fallback) => (await pm.state.get(prefix + key)) ?? fallback;
const write = (key, value) => pm.state.set(prefix + key, value);
const server = http.createServer(async (req, res) => {
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const body = req.body ?? await new Promise((resolve) => {
    let raw = '';
    req.on('data', (part) => { raw += part; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/__control' && req.method === 'POST') {
    await write('scenario', body.scenario ?? 'default');
    await write('webhook', body.webhook ?? '');
    await write('updates', body.updates ?? []);
    await write('messages', []);
    await write('requests', []);
    return json(200, { ok: true });
  }
  if (pathname === '/__state') return json(200, {
    messages: await read('messages', []), requests: await read('requests', []),
  });
  const route = /^\/bot999999:SIMULATION_TOKEN\/(getMe|getWebhookInfo|getUpdates|sendMessage)$/.exec(pathname);
  if (!route || req.method !== 'POST') return json(501, { ok: false, description: 'Not modeled by this contract subset' });
  const method = route[1];
  const requests = await read('requests', []);
  requests.push({ method, body });
  await write('requests', requests);
  const scenario = await read('scenario', 'default');
  if (scenario === 'unauthorized') return json(401, { ok: false, error_code: 401, description: 'Unauthorized' });
  if (method === 'getUpdates') {
    if (scenario === 'conflict') return json(409, { ok: false, error_code: 409, description: 'Conflict' });
    if (scenario === 'rate-limit') return json(429, { ok: false, error_code: 429, parameters: { retry_after: 2 } });
    if (scenario === 'html-error') {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      return res.end('<html>Bad Gateway</html>');
    }
    if (scenario === 'delayed') await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (method === 'getMe') return json(200, { ok: true, result: { id: 999999, is_bot: true, username: 'VolBot_Test', first_name: 'Test bot' } });
  if (method === 'getWebhookInfo') return json(200, { ok: true, result: { url: await read('webhook', ''), pending_update_count: 0 } });
  if (method === 'getUpdates') {
    if (body.offset !== undefined && (!Number.isSafeInteger(body.offset) || body.offset < 0))
      return json(400, { ok: false, error_code: 400, description: 'Invalid offset' });
    const updates = (await read('updates', [])).filter((update) => body.offset === undefined || update.update_id >= body.offset);
    // An offset acknowledges earlier updates, just as Telegram specifies.
    await write('updates', updates);
    return json(200, { ok: true, result: updates.slice(0, body.limit ?? 100) });
  }
  if (method === 'sendMessage') {
    if (!body.chat_id || typeof body.text !== 'string' || !body.text.length || body.text.length > 4096)
      return json(400, { ok: false, error_code: 400, description: 'Invalid message' });
    const messages = await read('messages', []);
    messages.push({ chat_id: body.chat_id, text: body.text });
    await write('messages', messages);
    return json(200, { ok: true, result: { message_id: messages.length, date: 1795694400,
      chat: { id: Number(body.chat_id), type: 'private' }, text: body.text } });
  }
});
server.listen(process.env.PORT || 4500);
