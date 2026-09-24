function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export async function sendMagicLink(env: Env, to: string, link: string) {
  const text = [
    'Here is your sign-in link for desktop.fyi:',
    '',
    link,
    '',
    'It works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.',
  ].join('\n')

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:34em">
<p>Here is your sign-in link for <strong>desktop.fyi</strong>:</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Sign in</a></p>
<p style="color:#666;font-size:13px">Or paste this into your browser:<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<p style="color:#666;font-size:13px">It works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.</p>
</div>`

  await env.EMAIL.send({
    to,
    from: env.EMAIL_FROM,
    subject: 'Your desktop.fyi sign-in link',
    text,
    html,
  })
}
