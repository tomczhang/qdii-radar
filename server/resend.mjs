// Same HTTP provider used by tomcatTravel; credentials stay server-side.
export function createResendTransport({ apiKey, fetchImpl = fetch }) {
  return {
    async sendMail(mail, idempotencyKey) {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, 'User-Agent': 'QDII-Radar-Mail/1.0' },
        body: JSON.stringify({ from: mail.from, to: [mail.to], subject: mail.subject, text: mail.text, headers: mail.headers, ...(mail.replyTo ? { reply_to: mail.replyTo } : {}) }),
        signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error('邮件服务商拒绝请求');
        error.code = `resend_http_${response.status}`;
        error.permanent = (response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status)) || (response.status === 409 && result.name === 'invalid_idempotent_request');
        if (response.status === 429) {
          const retry = response.headers.get('retry-after');
          const milliseconds = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry || '') - Date.now();
          error.retryAfterMs = Number.isFinite(milliseconds) ? Math.max(1000, milliseconds) : 60000;
        }
        throw error;
      }
      if (typeof result.id !== 'string' || !result.id) throw new Error('缺少服务商邮件ID');
      return { messageId: result.id };
    },
  };
}
