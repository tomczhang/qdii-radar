const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function accountEmail(url, purpose) {
  const link = new URL(url);
  if (!['https:', 'http:'].includes(link.protocol)) throw new Error('账号邮件链接无效');
  if (!['activate', 'reset'].includes(purpose)) throw new Error('账号邮件用途无效');
  const reset = purpose === 'reset';
  const heading = reset ? '重置你的密码' : '激活你的账号';
  const action = reset ? '重置密码' : '激活账号';
  const duration = reset ? '30 分钟' : '24 小时';
  const description = reset
    ? `我们收到了重置 QDII 额度雷达密码的请求，请点击下方按钮设置新密码。该链接在 ${duration}内有效。`
    : `欢迎注册 QDII 额度雷达，请点击下方按钮验证邮箱并激活账号。该链接在 ${duration}内有效。`;
  const footer = reset
    ? '如非本人操作，请忽略此邮件，你的密码不会改变。'
    : '如非本人注册，请忽略此邮件，账号不会被激活。';
  const href = escapeHtml(link.href);
  return {
    subject: reset ? '重设你的 QDII 额度雷达密码' : '激活你的 QDII 额度雷达账号',
    text: `${heading}\n\n${description}\n\n${action}：\n${link.href}\n\n${footer}${reset ? '\n重设密码后，所有设备需要重新登录。' : ''}`,
    // Tables and inline styles keep the action usable in email clients that strip stylesheets.
    html: `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title></head>
<body style="margin:0;padding:0;background-color:#ffffff;color:#171717;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">请在 ${duration}内${action} · QDII 额度雷达</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background-color:#ffffff;">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;border-collapse:collapse;">
<tr><td style="padding:40px 24px 24px;">
<h1 style="margin:0;color:#111111;font-size:28px;line-height:1.4;font-weight:700;">${heading}</h1>
</td></tr>
<tr><td style="padding:8px 24px 36px;color:#595959;font-size:16px;line-height:1.9;">
${description}
</td></tr>
<tr><td style="padding:0 24px 44px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td align="center" bgcolor="#2364e8" style="background-color:#2364e8;border-radius:8px;mso-padding-alt:16px 32px;">
<a href="${href}" target="_blank" style="display:inline-block;border:1px solid #2364e8;border-radius:8px;padding:15px 31px;color:#ffffff;background-color:#2364e8;font-size:16px;line-height:22px;font-weight:700;text-decoration:none;text-align:center;">${action}</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 24px 36px;color:#868690;font-size:13px;line-height:1.9;">
<p style="margin:0 0 8px;">如果按钮无法点击，请复制下方链接，在浏览器中打开：</p>
<a href="${href}" target="_blank" style="color:#2364e8;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${href}</a>
</td></tr>
<tr><td style="padding:0 24px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr><td style="border-top:1px solid #e7e7ec;padding-top:22px;color:#92929c;font-size:13px;line-height:1.9;">${footer}</td></tr></table>
</td></tr>
</table>
</td></tr></table>
</body></html>`,
  };
}
