// backend/src/utils/emailService.js
// Thin wrapper around Resend. Swap the implementation here if we migrate
// to a different provider later — callers don't need to change.

const APP_URL = process.env.APP_URL || 'https://datadatasteve.github.io/ripfit-app';
const FROM_ADDRESS = process.env.RESEND_FROM || 'onboarding@resend.dev';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Send a raw email via Resend's REST API.
// Using fetch directly so we don't need to add the resend npm package —
// Node 18+ has fetch built in and Northflank runs Node 18.
async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    // No key configured — log the email to console so dev flow still works.
    console.log('[emailService] No RESEND_API_KEY set. Would have sent:');
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body: ${html}`);
    return { ok: true, simulated: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('[emailService] Resend error:', data);
    throw new Error(data.message || 'Failed to send email');
  }

  return data;
}

// Send account verification email.
// token: the raw UUID token stored on the user record.
async function sendVerificationEmail(toEmail, token) {
  const verifyUrl = `${APP_URL}?verify=${token}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #111; color: #f0f0f0; border-radius: 8px;">
      <h1 style="font-size: 1.5em; margin-bottom: 8px; color: #fff;">Welcome to RipFit</h1>
      <p style="color: #aaa; margin-bottom: 24px;">Confirm your email address to activate your account.</p>
      <a href="${verifyUrl}"
         style="display: inline-block; padding: 14px 28px; background: #7c3aed; color: #fff;
                text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 1em;">
        Verify Email
      </a>
      <p style="margin-top: 24px; font-size: 0.85em; color: #666;">
        Or copy this link into your browser:<br/>
        <span style="color: #aaa; word-break: break-all;">${verifyUrl}</span>
      </p>
      <p style="margin-top: 32px; font-size: 0.8em; color: #555;">
        If you didn't create a RipFit account, you can ignore this email.
      </p>
    </div>
  `;

  return sendEmail({
    to: toEmail,
    subject: 'Verify your RipFit account',
    html,
  });
}

// Send password reset email (placeholder for later).
async function sendPasswordResetEmail(toEmail, token) {
  const resetUrl = `${APP_URL}?reset=${token}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #111; color: #f0f0f0; border-radius: 8px;">
      <h1 style="font-size: 1.5em; margin-bottom: 8px; color: #fff;">Reset your password</h1>
      <p style="color: #aaa; margin-bottom: 24px;">Click below to set a new password for your RipFit account.</p>
      <a href="${resetUrl}"
         style="display: inline-block; padding: 14px 28px; background: #7c3aed; color: #fff;
                text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 1em;">
        Reset Password
      </a>
      <p style="margin-top: 24px; font-size: 0.85em; color: #666;">
        This link expires in 1 hour. If you didn't request a reset, ignore this email.
      </p>
    </div>
  `;

  return sendEmail({
    to: toEmail,
    subject: 'Reset your RipFit password',
    html,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };

