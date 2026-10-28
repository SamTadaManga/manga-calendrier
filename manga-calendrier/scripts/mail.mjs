// Envoi d'un e-mail avec pièces jointes par SMTP (Gmail : smtp.gmail.com, port 465, mot de passe d'application), sans dépendance.
import tls from 'node:tls';
import net from 'node:net';

const b64 = (b) => Buffer.from(b).toString('base64');
const wrap = (s) => s.replace(/(.{76})/g, '$1\r\n');
const enc = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

/** Construit le message MIME (texte + pièces jointes). Exporté pour les tests. */
export function buildMessage({ from, to, subject, text, attachments = [], boundary = `=_pt_${Date.now().toString(36)}` }) {
  const head = [`From: ${from}`, `To: ${to}`, `Subject: ${enc(subject)}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`].join('\r\n');
  const parts = [`--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(text))}`];
  for (const a of attachments) parts.push(`--${boundary}\r\nContent-Type: ${a.type || 'application/octet-stream'}; name="${a.filename}"\r\nContent-Disposition: attachment; filename="${a.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(a.content))}`);
  return `${head}\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--\r\n`;
}

export function sendMail({ host = 'smtp.gmail.com', port = 465, secure = true, user, pass, from, to, subject, text, attachments }) {
  const message = buildMessage({ from: from || user, to, subject, text, attachments }).replace(/^\./gm, '..');
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    sock.setEncoding('utf8'); sock.setTimeout(60000, () => { sock.destroy(); reject(new Error('SMTP : délai dépassé')); });
    let buf = ''; let waiter = null;
    sock.on('data', (d) => { buf += d; const lines = buf.split('\r\n'); if (lines.length > 1 && /^\d{3} /.test(lines[lines.length - 2] || '')) { const out = buf; buf = ''; const w = waiter; waiter = null; w?.(out); } });
    sock.on('error', reject);
    const read = () => new Promise((r) => { waiter = r; });
    const cmd = async (c, ok) => { if (c !== null) sock.write(`${c}\r\n`); const r = await read(); if (!r.trimEnd().split('\r\n').pop().startsWith(ok)) throw new Error(`SMTP : ${r.trim().slice(0, 200)}`); };
    (async () => {
      await cmd(null, '220');
      await cmd('EHLO prochaintome.fr', '250');
      await cmd('AUTH LOGIN', '334'); await cmd(b64(user), '334'); await cmd(b64(pass), '235');
      await cmd(`MAIL FROM:<${(from || user).replace(/.*<|>.*/g, '')}>`, '250');
      await cmd(`RCPT TO:<${to}>`, '250');
      await cmd('DATA', '354');
      sock.write(`${message}\r\n.\r\n`); const r = await read(); if (!r.trimEnd().split('\r\n').pop().startsWith('250')) throw new Error(`SMTP : ${r.trim().slice(0, 200)}`);
      await cmd('QUIT', '221').catch(() => {});
      sock.end(); resolve();
    })().catch((e) => { sock.destroy(); reject(e); });
  });
}
