import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { join } from 'path';

function parseBoolean(value?: string | null) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return null;
}

@Module({
    imports: [MailerModule.forRootAsync({
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => {
            const host = configService.get<string>('MAIL_HOST');
            const portValue = configService.get<string>('MAIL_PORT') ?? '465';
            const parsedPort = Number(portValue);
            const port = Number.isFinite(parsedPort) ? parsedPort : 465;
            const secureFromEnv = parseBoolean(configService.get<string>('MAIL_SECURE'));
            const secure = secureFromEnv ?? port === 465;

            return {
                transport: {
                    host,
                    port,
                    secure,
                    auth: {
                        user: configService.get<string>('MAIL_USER'),
                        pass: configService.get<string>('MAIL_PASS'),
                    },
                },
                defaults: {
                    from: `"${configService.get<string>('MAIL_FROM')}" <${configService.get<string>('MAIL_USER')}>`,
                },
                template: {
                    dir: join(__dirname, 'templates'),
                    adapter: new HandlebarsAdapter({
                        eq: (a, b) => a === b,
                        formatDate: (date) => new Date(date).toLocaleDateString(),
                    }),
                    options: {
                        strict: true,
                    },
                },
            };
        },
        inject: [ConfigService]
    })],
    providers: [MailService],
    exports: [MailService], // para usar Mail en otros modulos
})
export class MailModule { }
