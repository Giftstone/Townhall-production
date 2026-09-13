// server/services/notifier.js
const nodemailer = require('nodemailer');

let transporterPromise = null;
let mailMode = 'unset'; // 'smtp' | 'ethereal' | 'json'

function getFrontendBase() {
  return (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.CORS_ORIGIN ||
    'http://localhost:5173'
  ).split(',')[0].trim();
}

/**
 * Build a transporter.
 * Priority:
 *  1. Explicit SMTP (EMAIL_HOST + EMAIL_USER + EMAIL_PASS)
 *  2. Auto Ethereal test account (dev-friendly, messages viewable via preview URL)
 *  3. JSON transport (logs email body to console — last resort)
 */
async function getTransporter() {
  if (transporterPromise) return transporterPromise;

  transporterPromise = (async () => {
    const host = process.env.EMAIL_HOST || process.env.SMTP_HOST;
    const user = process.env.EMAIL_USER || process.env.SMTP_USER;
    const pass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
    const port = Number(process.env.EMAIL_PORT || process.env.SMTP_PORT || 587);
    const secure = String(process.env.EMAIL_SECURE || 'false') === 'true';

    if (host && user && pass && !user.includes('your_ethereal')) {
      mailMode = 'smtp';
      console.log(`📧 Mail: SMTP ${host}:${port} as ${user}`);
      return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
    }

    // Auto-create Ethereal inbox for local/dev so reset emails actually work
    try {
      const testAccount = await nodemailer.createTestAccount();
      mailMode = 'ethereal';
      console.log('📧 Mail: Ethereal test account (dev)');
      console.log(`   user: ${testAccount.user}`);
      console.log(`   pass: ${testAccount.pass}`);
      console.log('   Preview sent messages at the URL logged after each send.');
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
    } catch (err) {
      mailMode = 'json';
      console.warn('📧 Mail: Ethereal unavailable — using JSON transport (emails only log to console)');
      console.warn('   Reason:', err.message);
      return nodemailer.createTransport({ jsonTransport: true });
    }
  })();

  return transporterPromise;
}

function logPreview(info, label) {
  const url = nodemailer.getTestMessageUrl(info);
  if (url) console.log(`✅ ${label} preview:`, url);
  else if (mailMode === 'json') {
    try {
      console.log(`✅ ${label} (json):`, JSON.parse(info.message));
    } catch {
      console.log(`✅ ${label} sent (no preview URL)`);
    }
  } else {
    console.log(`✅ ${label} accepted:`, info.messageId || info.response);
  }
  return url || null;
}

async function sendMail(options) {
  const transporter = await getTransporter();
  const from =
    process.env.EMAIL_FROM ||
    `"Townhall" <${process.env.EMAIL_USER || 'noreply@townhall.local'}>`;
  const info = await transporter.sendMail({ from, ...options });
  const previewUrl = logPreview(info, options.subject || 'email');
  return { info, previewUrl, mailMode };
}

// ─── Status update ───────────────────────────────────────────────────────────
const sendReportUpdate = async (userEmail, reportTitle, newStatus) => {
  try {
    await sendMail({
      to: userEmail,
      subject: `Update on your report: ${reportTitle}`,
      text: `Your report "${reportTitle}" has been updated. Status: ${newStatus}.`,
      html: `
        <div style="font-family:sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:8px;">
          <h2 style="color:#c8a97e;">Townhall Update</h2>
          <p>Your report <strong>"${reportTitle}"</strong> is now:
            <strong>${newStatus}</strong>.</p>
        </div>`,
    });
  } catch (error) {
    console.error('❌ sendReportUpdate failed:', error.message);
  }
};

// ─── Welcome ─────────────────────────────────────────────────────────────────
const sendWelcomeEmail = async (userEmail, userName) => {
  try {
    const base = getFrontendBase();
    await sendMail({
      to: userEmail,
      subject: `Welcome to Townhall, ${userName}!`,
      html: `
        <div style="font-family:sans-serif;padding:20px;">
          <h1 style="color:#c8a97e;">Welcome to Townhall</h1>
          <p>Hi <strong>${userName}</strong>, your citizen account is ready.</p>
          <p><a href="${base}/login" style="background:#c8a97e;color:#0d0f14;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Sign in</a></p>
        </div>`,
    });
  } catch (error) {
    console.error('❌ sendWelcomeEmail failed:', error.message);
  }
};

// ─── Approval notify ─────────────────────────────────────────────────────────
const sendReportForApproval = async (recipients, report) => {
  if (!recipients || recipients.length === 0) return;
  try {
    await sendMail({
      to: recipients.join(','),
      subject: `New incident report: ${report.title}`,
      text: `Title: ${report.title}\nCategory: ${report.category}\nLocation: ${report.location || '—'}`,
    });
  } catch (error) {
    console.error('❌ sendReportForApproval failed:', error.message);
  }
};

// ─── Password reset ──────────────────────────────────────────────────────────
/**
 * @returns {{ previewUrl: string|null, mailMode: string }}
 */
const sendPasswordResetEmail = async (userEmail, userName, { resetLink, code }) => {
  const html = `
    <div style="font-family:sans-serif;padding:24px;max-width:480px;border:1px solid #e2e8f0;border-radius:12px;">
      <h2 style="color:#c8a97e;margin:0 0 12px;">Reset your Townhall password</h2>
      <p>Hi ${userName || 'there'},</p>
      <p>We received a request to reset your password. Use the button below or enter this code:</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:700;color:#0d0f14;background:#f8fafc;padding:12px 16px;border-radius:8px;text-align:center;">${code}</p>
      <p style="margin:20px 0;">
        <a href="${resetLink}" style="background:#c8a97e;color:#0d0f14;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Choose a new password
        </a>
      </p>
      <p style="color:#64748b;font-size:13px;">This link and code expire in <strong>1 hour</strong>. If you did not request a reset, you can ignore this email.</p>
    </div>`;

  const text = [
    `Townhall password reset`,
    `Code: ${code}`,
    `Link: ${resetLink}`,
    `Expires in 1 hour.`,
  ].join('\n');

  try {
    const { previewUrl, mailMode: mode } = await sendMail({
      to: userEmail,
      subject: 'Townhall password reset code',
      text,
      html,
    });
    return { previewUrl, mailMode: mode, ok: true };
  } catch (error) {
    console.error('❌ sendPasswordResetEmail failed:', error.message);
    return { previewUrl: null, mailMode, ok: false, error: error.message };
  }
};

module.exports = {
  sendReportUpdate,
  sendWelcomeEmail,
  sendReportForApproval,
  sendPasswordResetEmail,
  getFrontendBase,
  getMailMode: () => mailMode,
};
