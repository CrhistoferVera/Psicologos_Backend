import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer'
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { join } from 'path';

@Module({
    imports: [MailerModule.forRootAsync({
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
            transport: {
                host: configService.get<string>('MAIL_HOST'),
                port: configService.get<number>('MAIL_PORT'),
                secure: true,
                auth: {
                    user: configService.get<string>('MAIL_USER'),
                    pass: configService.get<string>('MAIL_PASS'),
                },
            },
            defaults: {
                from: `"${configService.get<string>('MAIL_FROM')}" <${configService.get<string>('MAIL_USER')}>`,
            },
            template: {
                dir: join(__dirname,'templates'),
                adapter: new HandlebarsAdapter({
                    eq: (a, b) => a === b,
                    formatDate: (date) => new Date(date).toLocaleDateString(),
                }),
                options: {
                    strict: true,
                }
            }
        }),
        inject: [ConfigService]
    })],
    providers: [MailService],
    exports: [MailService], // para usar Mail en otros modulos
})
export class MailModule { }