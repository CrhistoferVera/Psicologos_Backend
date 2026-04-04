import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';

@Injectable()
export class NotificationsService implements OnModuleInit {
    onModuleInit() {
        if (!admin.apps.length) {
            try {
                console.log('🔥 Inicializando Firebase...');

                if (process.env.FIREBASE_SERVICE_ACCOUNT) {
                    console.log('📦 Usando credenciales desde ENV');

                    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

                    admin.initializeApp({
                        credential: admin.credential.cert(serviceAccount),
                    });
                } else {
                    const serviceAccountPath = path.join(process.cwd(), 'dist', 'firebase-auth.json');

                    console.log('📂 Usando archivo:', serviceAccountPath);

                    const serviceAccount = require(serviceAccountPath);

                    admin.initializeApp({
                        credential: admin.credential.cert(serviceAccount),
                    });
                }

                console.log('✅ Firebase inicializado correctamente');
            } catch (error) {
                console.error('🔥 ERROR INICIALIZANDO FIREBASE:', error);
                console.warn('⚠️ Firebase deshabilitado');
            }
        }
    }

    async sendMulticastNotification(tokens: string[], title: string, body: string, data?: any) {
        if (!admin.apps.length) {
            console.warn('⚠️ Firebase no está inicializado');
            return;
        }

        if (!tokens.length) {
            console.warn('⚠️ No hay tokens para enviar');
            return;
        }

        const stringData = data
            ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
            : {};

        const chunks: string[][] = [];
        for (let i = 0; i < tokens.length; i += 500) {
            chunks.push(tokens.slice(i, i + 500));
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

                if (response.failureCount > 0) {
                    console.warn('⚠️ Tokens fallidos:', response.responses);
                }
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