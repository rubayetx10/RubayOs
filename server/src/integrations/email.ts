import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProd } from '../config/env';
import { logger } from '../config/logger';

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends an email. Without SMTP_HOST (development) the message is printed to the server log instead,
 * so password-reset links can be copied from the terminal.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!env.SMTP_HOST) {
    if (isProd) throw new Error('SMTP is not configured');
    logger.info({ to: mail.to, subject: mail.subject }, `EMAIL (console mode)\n${mail.text}`);
    return;
  }
  await getTransporter().sendMail({ from: env.MAIL_FROM, ...mail });
}

/** Never lets an email failure break the main flow. */
export async function sendMailSafe(mail: Mail): Promise<void> {
  try {
    await sendMail(mail);
  } catch (err) {
    logger.error({ err, to: mail.to }, 'Failed to send email');
  }
}
