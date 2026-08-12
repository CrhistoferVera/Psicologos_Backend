import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);

    constructor(private readonly mailerService: MailerService) { }

    private getErrorCode(error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error) {
            return String((error as { code?: unknown }).code ?? 'UNKNOWN');
        }
        return 'UNKNOWN';
    }

    //METODO PARA ENVIAR NOTIFICACION DE ESTADO DE DEPÓSITO
    async sendDepositStatusNotification(
        email: string,
        firstName: string,
        status: 'APPROVED' | 'REJECTED',
        credits: number,
        reason?: string | null
    ) {
        try {
            const subject = status === 'APPROVED'
                ? 'Tu recarga ha sido aprobada'
                : 'Tu recarga ha sido rechazada';

            await this.mailerService.sendMail({
                to: email,
                subject: subject,
                template: 'deposit-status', // nombre del archivo .hbs
                context: {
                    firstName,
                    status,
                    credits,
                    reason,
                    date: new Date().toLocaleDateString('es-BO', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    }),
                },
            });

            this.logger.log(`📧 Email enviado a ${email} - Estado: ${status}`);
        } catch (error) {
            this.logger.error(`Error enviando email a ${email}. code=${this.getErrorCode(error)}`);
        }
    }

    //METODO PARA ENVIAR CODIGO DE RECUPERACION DE CONTRASEÑA
    async sendPasswordResetEmail(
        email: string,
        firstName: string,
        code: string,
        expiresInMinutes = 15,
    ) {
        try {
            await this.mailerService.sendMail({
                to: email,
                subject: 'Recuperacion de contrasena - SanaMente',
                template: 'reset-password',
                context: {
                    firstName,
                    code,
                    expiresInMinutes,
                },
            });
            this.logger.log(`📧 Email de recuperación enviado a ${email}`);
        } catch (error) {
            this.logger.error(`Error enviando email de recuperación a ${email}. code=${this.getErrorCode(error)}`);
            throw new ServiceUnavailableException(
                'No se pudo enviar el correo de recuperacion en este momento. Intenta nuevamente.',
            );
        }
    }

    //METODO PARA ENVIAR CODIGO OTP DE VERIFICACION DE CUENTA (REGISTRO)
    async sendOtpEmail(
        email: string,
        firstName: string,
        code: string,
        expiresInMinutes = 15,
    ) {
        try {
            await this.mailerService.sendMail({
                to: email,
                subject: 'Codigo de verificacion - SanaMente',
                template: 'verify-otp',
                context: {
                    firstName,
                    code,
                    expiresInMinutes,
                },
            });
            this.logger.log(`📧 Codigo OTP enviado a ${email}`);
        } catch (error) {
            this.logger.error(`Error enviando codigo OTP a ${email}. code=${this.getErrorCode(error)}`);
            throw new ServiceUnavailableException(
                'No se pudo enviar el codigo de verificacion en este momento. Intenta nuevamente.',
            );
        }
    }

    //METODO PARA ENVIAR NOTIFICACION DE ESTADO DE SOLICITUD DE RETIRO
    async sendWithdrawalRequestNotification(
        email: string,
        firstName: string,
        status: 'APPROVED' | 'REJECTED',
        credits: number,
        soles: number,
        reason?: string | null
    ) {
        try {
            const subject = status === 'APPROVED'
                ? 'Tu solicitud de retiro fue aprobada'
                : 'Tu solicitud de retiro fue rechazada';

            await this.mailerService.sendMail({
                to: email,
                subject,
                template: 'withdrawal-status',
                context: {
                    firstName,
                    status,
                    credits,
                    soles,
                    reason,
                    date: new Date().toLocaleDateString('es-BO', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    }),
                },
            });

            this.logger.log(`📧 Email retiro enviado a ${email} - Estado: ${status}`);
        } catch (error) {
            this.logger.error(`Error enviando email de retiro a ${email}. code=${this.getErrorCode(error)}`);
        }
    }
}
