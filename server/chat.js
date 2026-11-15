const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export class RoomChat {
  messages = []; sequence = 0; sent = new Map();
  exchange(member, members, body, now = Date.now()) {
    const after = body.after === undefined ? 0 : body.after;
    if (!Number.isSafeInteger(after) || after < 0) fail(400, 'Invalid chat cursor.');
    const players = [...members.values()];
    if (body.deleteId !== undefined) {
      if (body.text !== undefined) fail(400, 'Choose one chat action.');
      const target = Number.isSafeInteger(body.deleteId) && this.messages.find(message => message.id === body.deleteId);
      if (!target || target.sender !== member.token) fail(404, 'Message unavailable.');
      if (!target.deleted) {
        target.deleted = true; target.text = ''; target.reply = null; target.updated = ++this.sequence;
        for (const message of this.messages) if (message.reply?.id === target.id) { message.reply = { id: target.id, name: target.name, text: '', deleted: true }; message.updated = ++this.sequence; }
      }
    }
    if (body.text !== undefined) {
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 500) fail(400, 'Enter a message of 1–500 characters.');
      const recipient = body.to == null ? null : players.find(player => player.id === body.to);
      if (body.to != null && (!Number.isInteger(body.to) || !recipient || recipient === member)) fail(400, 'Choose another player who is still in the room.');
      let reply = null;
      if (body.replyTo != null) {
        const original = Number.isSafeInteger(body.replyTo) && this.messages.find(message => message.id === body.replyTo);
        const sameConversation = original && !original.deleted && (recipient ? ((original.sender === member.token && original.recipient === recipient.token) || (original.sender === recipient.token && original.recipient === member.token)) : original.recipient === null);
        if (!sameConversation) fail(400, 'That message is unavailable in this conversation.');
        reply = { id: original.id, name: original.name, text: original.text, ...(original.color === undefined ? {} : { color: original.color }) };
      }
      if (now - (this.sent.get(member.token) ?? -Infinity) < 500) fail(429, 'Please wait a moment before sending another message.');
      this.sent.set(member.token, now);
      for (const token of this.sent.keys()) if (!players.some(player => player.token === token)) this.sent.delete(token);
      this.messages.push({ id: ++this.sequence, from: member.id, name: member.name, color: member.chatColor ?? member.color, to: recipient?.id ?? null, toName: recipient?.name ?? null, text: body.text.trim(), reply, time: now, sender: member.token, recipient: recipient?.token ?? null });
      if (this.messages.length > 200) this.messages.shift();
    }
    return { you: member.id, players: players.map(({ id, name, chatColor, color }) => ({ id, name, color: chatColor ?? color })), cursor: this.sequence, messages: this.messages.filter(message => (message.updated ?? message.id) > after && (message.recipient === null || message.sender === member.token || message.recipient === member.token)).map(({ sender, recipient, ...message }) => message) };
  }
}
