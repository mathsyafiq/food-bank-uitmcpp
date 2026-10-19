// Alert emails (CLAUDE.md section 8). Emails never include student IDs, keys or names.

function alertRecipients_() {
  return Db.read('Staff').filter((s) => truthy_(s.active) && truthy_(s.receives_alerts)).map((s) => String(s.email));
}

function adminRecipients_() {
  return Db.read('Staff').filter((s) => truthy_(s.active) && String(s.role).toLowerCase() === 'admin').map((s) => String(s.email));
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlTable_(headers, rows) {
  const cell = 'style="border:1px solid #ccc;padding:4px 8px;text-align:left"';
  return '<table style="border-collapse:collapse">' +
    '<tr>' + headers.map((h) => '<th ' + cell + '>' + escapeHtml_(h) + '</th>').join('') + '</tr>' +
    rows.map((r) => '<tr>' + r.map((v) => '<td ' + cell + '>' + escapeHtml_(v) + '</td>').join('') + '</tr>').join('') +
    '</table>';
}

function sendMail_(to, subject, html) {
  if (!to.length) return false;
  const settings = getSettings_();
  const link = settings.staff_url ? '<p><a href="' + escapeHtml_(settings.staff_url) + '">Open the staff app</a></p>' : '';
  MailApp.sendEmail({
    to: to.join(','),
    subject: subject,
    htmlBody: html + link + '<p style="color:#666">Food Bank UiTMCPP. Sent automatically.</p>',
    name: 'Food Bank UiTMCPP',
  });
  return true;
}
