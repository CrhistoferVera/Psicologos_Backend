import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma.service';

@Injectable()
export class NotificationsService implements OnModuleInit {
    constructor(private readonly prisma: PrismaService) {}
    onModuleInit() {
        if (!admin.apps.length) {
            try {
                const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
                if (!base64) {
                    console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT_BASE64 no configurado. Las notificaciones push estarán deshabilitadas.');
                    return;
                }
                const serviceAccount = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                });
                console.log(`✅ Firebase inicializado correctamente. Proyecto: ${serviceAccount.project_id}`);
            } catch {
                console.warn('⚠️  Error inicializando Firebase. Las notificaciones push estarán deshabilitadas.');
            }
        }
    }
    

    async sendMulticastNotification(tokens: string[], title: string, body: string, data?: any) {
        if (!admin.apps.length) {
            console.warn('⚠️ Firebase no está inicializado');
            return;
        }

        const validTokens = tokens.filter(t => t && t.trim().length > 0);
        if (!validTokens.length) {
            console.warn('⚠️ No hay tokens válidos para enviar');
            return;
        }

        const stringData = data
            ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
            : {};

        const chunks: string[][] = [];
        for (let i = 0; i < validTokens.length; i += 500) {
            chunks.push(validTokens.slice(i, i + 500));
        }

        for (const chunk of chunks) {
            try {
                const message: admin.messaging.MulticastMessage = {
                    tokens: chunk,
                    notification: { title, body },
                    data: stringData,
                    android: { priority: 'high', notification: { channelId: 'default' } },
                    apns: { payload: { aps: { contentAvailable: true } } },
                };

                const response = await admin.messaging().sendEachForMulticast(message);

                console.log('📤 Multicast enviado:', {
                    success: response.successCount,
                    failed: response.failureCount,
                });

                // Limpiar tokens obsoletos de la DB
                response.responses.forEach((resp, idx) => {
                    if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
                        const invalidToken = chunk[idx];
                        this.prisma.user.updateMany({
                            where: { fcmToken: invalidToken },
                            data: { fcmToken: null },
                        }).catch(() => {});
                    }
                });
            } catch (error) {
                console.error('🔥 Error enviando multicast:', error);
            }
        }
    }

    async sendPushNotification(token: string, title: string, body: string, data?: any) {
        if (!admin.apps.length) {
            console.warn('⚠️ Firebase no está inicializado');
            return null;
        }

        if (!token) {
            console.warn('⚠️ Token vacío');
            return null;
        }

        const message: admin.messaging.Message = {
            token: token,
            notification: {
                title,
                body,
            },
            data: data
                ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
                : {},
            android: {
                priority: 'high',
                notification: {
                    channelId: 'default',
                },
            },
            apns: {
                payload: {
                    aps: {
                        contentAvailable: true,
                    },
                },
            },
        };

        try {
            const response = await admin.messaging().send(message);

            console.log('✅ Notificación enviada:', response);

            return response;
        } catch (error: any) {
            console.error('🔥 Error enviando notificación:', {
                message: error?.message,
                code: error?.code,
                stack: error?.stack,
            });

            // 🔴 IMPORTANTE: NO lanzar error
            return null;
        }
    }
}