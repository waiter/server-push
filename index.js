const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { parse } = require('url'); 

const datas = [];
const callbacks = {};

const server = http.createServer().listen(3000);
server.on('request', (req, res) => {
  const { pathname, query } = parse(req.url, true);
  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    return res.end(fs.readFileSync('static/index.html'));
  } else if (pathname.startsWith('/static/')) {
    res.statusCode = 200;
    return res.end(fs.readFileSync(pathname.substring(1)));
  } else if (pathname === '/api/push') {
    if (query.info) {
      datas.push(query.info);
      const d = JSON.stringify([query.info]);
      Object.keys(callbacks).forEach(k => callbacks[k](d));
    }
  } else if (pathname === '/api/polling') {
    const id = parseInt(query.id || '0', 10) || 0;
    res.writeHead(200, { 'Content-Type': 'application/json;' });
    return res.end(JSON.stringify(datas.slice(id)));
  } else if (pathname === '/api/long-polling') {
    const id = parseInt(query.id || '0', 10) || 0;
    const cbk = 'long-polling';
    delete callbacks[cbk];
    const data = datas.slice(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (data.length) {
      return res.end(JSON.stringify(data));
    }
    req.on('close', () => {
      delete callbacks[cbk];
    });
    callbacks[cbk] = (d) => {
      res.end(d);
    };
    return;
  } else if (pathname === '/api/sse') {
    const cbk = 'sse';
    delete callbacks[cbk];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(datas)}\n\n`);
    callbacks[cbk] = (d) => {
      res.write(`data: ${d}\n\n`);
    };
    req.on('close', () => {
      delete callbacks[cbk];
    });
    return;
  } else if (pathname === '/api/iframe') {
    const cbk = 'iframe';
    delete callbacks[cbk];
    res.write(`<script>window.parent.change(${JSON.stringify(datas)});</script>`);
    callbacks[cbk] = (d) => {
      res.write(`<script>window.parent.change(${d});</script>`);
    };
    req.on('close', () => {
      delete callbacks[cbk];
    });
    return;
  }

  res.write('hello world');
  res.end();
});

server.on('upgrade', (req, socket) => {
  const cbk = 'ws';
  delete callbacks[cbk];
  const acceptKey = req.headers['sec-websocket-key']; 
  const hash = generateAcceptValue(acceptKey); 
  const responseHeaders = [ 'HTTP/1.1 101 Web Socket Protocol Handshake', 'Upgrade: WebSocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${hash}` ];
  socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');
  socket.write(constructReply(datas));
  callbacks[cbk] = (d) => {
    socket.write(constructReply(d));
  }
  socket.on('close', () => {
    delete callbacks[cbk];
  });
});

function generateAcceptValue (acceptKey) {
  return crypto
  .createHash('sha1')
  .update(acceptKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'binary')
  .digest('base64');
}

function constructReply (data) {
  // Convert the data to JSON and copy it into a buffer
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  const jsonByteLength = Buffer.byteLength(json);
  // Note: we're not supporting > 65535 byte payloads at this stage 
  const lengthByteCount = jsonByteLength < 126 ? 0 : 2; 
  const payloadLength = lengthByteCount === 0 ? jsonByteLength : 126; 
  const buffer = Buffer.alloc(2 + lengthByteCount + jsonByteLength); 
  // Write out the first byte, using opcode `1` to indicate that the message 
  // payload contains text data 
  buffer.writeUInt8(0b10000001, 0); 
  buffer.writeUInt8(payloadLength, 1); 
  // Write the length of the JSON payload to the second byte 
  let payloadOffset = 2; 
  if (lengthByteCount > 0) { 
    buffer.writeUInt16BE(jsonByteLength, 2); payloadOffset += lengthByteCount; 
  } 
  // Write the JSON data to the data buffer 
  buffer.write(json, payloadOffset); 
  return buffer;
}