import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { env } from '@/config/env.js';
import { logger } from './logger.js';

const sesClient = new SESClient({ region: env.SES_REGION });

interface EmailOptions {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

/**
 * Gửi email qua AWS SES
 */
export const sendEmail = async (options: EmailOptions): Promise<void> => {
  try {
    const command = new SendEmailCommand({
      Source: env.SES_FROM_EMAIL,
      Destination: {
        ToAddresses: [options.to],
      },
      Message: {
        Subject: {
          Data: options.subject,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: options.htmlBody,
            Charset: 'UTF-8',
          },
          Text: options.textBody
            ? {
                Data: options.textBody,
                Charset: 'UTF-8',
              }
            : undefined,
        },
      },
    });

    const response = await sesClient.send(command);
    logger.info(`Email sent successfully to ${options.to}. MessageId: ${response.MessageId}`);
  } catch (error) {
    logger.error(`Failed to send email to ${options.to}:`, error);
    throw error;
  }
};

/**
 * Gửi OTP qua email để xác thực
 */
export const sendVerificationEmail = async (email: string, otp: string): Promise<void> => {
  const htmlBody = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 50px auto; background-color: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          .header { text-align: center; margin-bottom: 30px; }
          .header h1 { color: #333; margin: 0; }
          .content { margin: 20px 0; }
          .otp-box { background-color: #f0f0f0; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0; }
          .otp-box .otp-code { font-size: 32px; font-weight: bold; color: #2563eb; letter-spacing: 5px; }
          .otp-box .otp-expiry { color: #666; font-size: 12px; margin-top: 10px; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Xác thực Email</h1>
          </div>
          <div class="content">
            <p>Xin chào,</p>
            <p>Bạn vừa đăng ký tài khoản tại Zalogram. Vui lòng sử dụng mã OTP dưới đây để hoàn tất đăng ký:</p>
            <div class="otp-box">
              <div class="otp-code">${otp}</div>
              <div class="otp-expiry">Mã này sẽ hết hạn trong 5 phút</div>
            </div>
            <p>Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email này.</p>
          </div>
          <div class="footer">
            <p>© 2026 Zalogram. Tất cả quyền được bảo lưu.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const textBody = `
Xác thực Email - Zalogram

Xin chào,

Bạn vừa đăng ký tài khoản tại Zalogram. Vui lòng sử dụng mã OTP dưới đây để hoàn tất đăng ký:

${otp}

Mã này sẽ hết hạn trong 5 phút.

Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email này.

© 2026 Zalogram. Tất cả quyền được bảo lưu.
  `;

  await sendEmail({
    to: email,
    subject: 'Mã xác thực email - Zalogram',
    htmlBody,
    textBody,
  });
};

/**
 * Gửi OTP qua email để đặt lại mật khẩu
 */
export const sendPasswordResetEmail = async (email: string, otp: string): Promise<void> => {
  const htmlBody = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 50px auto; background-color: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          .header { text-align: center; margin-bottom: 30px; }
          .header h1 { color: #333; margin: 0; }
          .content { margin: 20px 0; }
          .otp-box { background-color: #f0f0f0; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0; }
          .otp-box .otp-code { font-size: 32px; font-weight: bold; color: #dc2626; letter-spacing: 5px; }
          .otp-box .otp-expiry { color: #666; font-size: 12px; margin-top: 10px; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Đặt lại mật khẩu</h1>
          </div>
          <div class="content">
            <p>Xin chào,</p>
            <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Vui lòng sử dụng mã OTP dưới đây:</p>
            <div class="otp-box">
              <div class="otp-code">${otp}</div>
              <div class="otp-expiry">Mã này sẽ hết hạn trong 5 phút</div>
            </div>
            <p>Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email này.</p>
          </div>
          <div class="footer">
            <p>© 2026 Zalogram. Tất cả quyền được bảo lưu.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const textBody = `
Đặt lại mật khẩu - Zalogram

Xin chào,

Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Vui lòng sử dụng mã OTP dưới đây:

${otp}

Mã này sẽ hết hạn trong 5 phút.

Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email này.

© 2026 Zalogram. Tất cả quyền được bảo lưu.
  `;

  await sendEmail({
    to: email,
    subject: 'Mã đặt lại mật khẩu - Zalogram',
    htmlBody,
    textBody,
  });
};
