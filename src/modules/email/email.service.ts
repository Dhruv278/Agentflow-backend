import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import {
  verificationEmailHtml,
  verificationEmailText,
  passwordResetEmailHtml,
  passwordResetEmailText,
  welcomeEmailHtml,
  welcomeEmailText,
  invoiceEmailHtml,
  invoiceEmailText,
  type InvoiceEmailData,
  type WelcomeEmailData,
} from './email-templates.js';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private readonly fromEmail: string;
  private readonly appUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.fromEmail =
      this.configService.get<string>('SMTP_USER') ?? 'noreply@agentflow.app';
    this.appUrl =
      this.configService.get<string>('APP_URL') ?? 'http://localhost:3000';
  }

  onModuleInit(): void {
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (user && pass) {
      const port = parseInt(
        this.configService.get<string>('SMTP_PORT') ?? '587',
        10,
      );
      this.transporter = createTransport({
        host: this.configService.get<string>('SMTP_HOST') ?? 'smtp.gmail.com',
        port,
        secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });
      this.logger.log(
        {
          host: this.configService.get<string>('SMTP_HOST') ?? 'smtp.gmail.com',
          port,
          user,
        },
        'SMTP transport created — verifying connection...',
      );

      this.transporter.verify().then(() => {
        this.logger.log('SMTP connection verified — emails ready');
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as Record<string, unknown>)?.['code'] ?? 'UNKNOWN';
        this.logger.error(
          { error: msg, code },
          'SMTP connection FAILED — emails will not work. Check SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.',
        );
      });
    } else {
      this.logger.warn(
        'SMTP_USER / SMTP_PASS not configured — emails will be logged instead of sent',
      );
    }
  }

  async sendVerificationEmail(
    to: string,
    name: string,
    rawToken: string,
  ): Promise<void> {
    const url = `${this.appUrl}/set-password?token=${rawToken}`;
    await this.send({
      to,
      subject: 'Verify your email — AgentFlow',
      text: verificationEmailText(name, url),
      html: verificationEmailHtml(name, url),
      actionUrl: url,
    });
  }

  async sendPasswordResetEmail(
    to: string,
    name: string,
    rawToken: string,
  ): Promise<void> {
    const url = `${this.appUrl}/reset-password?token=${rawToken}`;
    await this.send({
      to,
      subject: 'Reset your password — AgentFlow',
      text: passwordResetEmailText(name, url),
      html: passwordResetEmailHtml(name, url),
      actionUrl: url,
    });
  }

  async sendWelcomeEmail(to: string, name: string, plan: string): Promise<void> {
    const data: WelcomeEmailData = {
      name,
      plan,
      dashboardUrl: `${this.appUrl}/dashboard`,
      pricingUrl: `${this.appUrl}/pricing`,
    };
    await this.send({
      to,
      subject: 'Your account is ready — AgentFlow',
      text: welcomeEmailText(data),
      html: welcomeEmailHtml(data),
      actionUrl: data.dashboardUrl,
    });
  }

  async sendInvoiceEmail(to: string, data: InvoiceEmailData): Promise<void> {
    const html = invoiceEmailHtml(data).replace(
      'APP_URL_PLACEHOLDER',
      this.appUrl,
    );
    const text = invoiceEmailText(data);
    await this.send({
      to,
      subject: `Payment receipt — AgentFlow ${data.plan}`,
      text,
      html,
      actionUrl: `${this.appUrl}/billing`,
    });
  }

  private async send(params: {
    to: string;
    subject: string;
    text: string;
    html: string;
    actionUrl: string;
  }): Promise<void> {
    if (!this.transporter) {
      this.logger.debug(
        { to: params.to, subject: params.subject, actionUrl: params.actionUrl },
        'DEV MODE — email not sent, use this URL',
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from: `"AgentFlow" <${this.fromEmail}>`,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });

      this.logger.log(
        { to: params.to, subject: params.subject },
        'Email sent successfully',
      );
    } catch (err: unknown) {
      const errObj = err instanceof Error ? err : new Error(String(err));
      const code = (err as Record<string, unknown>)?.['code'] ?? 'UNKNOWN';
      const command = (err as Record<string, unknown>)?.['command'] ?? '';
      this.logger.error(
        {
          to: params.to,
          subject: params.subject,
          error: errObj.message,
          code,
          command,
          host: this.configService.get<string>('SMTP_HOST') ?? 'smtp.gmail.com',
          port: this.configService.get<string>('SMTP_PORT') ?? '587',
        },
        'SMTP email failed',
      );
      throw new InternalServerErrorException(
        'Unable to send email. Please try again later.',
      );
    }
  }
}
