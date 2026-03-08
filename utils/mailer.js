const { Resend } = require('resend');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send OTP email to the user via Resend
 * @param {string} toEmail - Recipient email address
 * @param {string} otp - 6-digit OTP code
 */
async function sendOTPEmail(toEmail, otp) {
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to: [toEmail],
    subject: 'Your OTP Verification Code',
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: auto; background: #0f0f1a; border-radius: 16px; padding: 40px; color: #fff;">
        <div style="text-align: center; margin-bottom: 30px;">
          <div style="font-size: 48px;">🔐</div>
          <h1 style="color: #a78bfa; margin: 10px 0; font-size: 24px;">Email Verification</h1>
          <p style="color: #8892b0; font-size: 14px; margin: 0;">Use the code below to verify your email address.</p>
        </div>
        <div style="background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 12px; padding: 30px; text-align: center; margin: 20px 0;">
          <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 0 0 10px;">Your One-Time Password</p>
          <div style="letter-spacing: 12px; font-size: 36px; font-weight: 800; color: #fff; font-family: monospace;">${otp}</div>
          <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 15px 0 0;">Expires in <strong>10 minutes</strong></p>
        </div>
        <p style="color: #8892b0; font-size: 13px; text-align: center; margin-top: 20px;">
          If you didn't request this, please ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #1e1e2e; margin: 20px 0;">
        <p style="color: #4b5563; font-size: 11px; text-align: center;">© 2026 SecureAuth. All rights reserved.</p>
      </div>
    `
  });

  if (error) {
    throw new Error(error.message || 'Failed to send email via Resend');
  }

  console.log(`✅ OTP email sent to ${toEmail} (Resend ID: ${data.id})`);
}

module.exports = { sendOTPEmail };
