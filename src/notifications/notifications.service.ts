import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';

@Injectable()
export class NotificationsService implements OnModuleInit {
    onModuleInit() {
        if (!admin.apps.length) {
            const serviceAccountPath = path.join(process.cwd(), 'firebase-auth.json');
            try {
                admin.initializeApp({
                    credential: admin.credential.cert(require(serviceAccountPath)),
                });
            } catch {
                console.warn('⚠️  firebase-auth.json no encontrado. Las notificaciones push estarán deshabilitadas.');
            }
        }
    }

    async sendPushNotification(token: string, title: string, body: string, data?: any) {
        const message: admin.messaging.Message = {
            token: token, //lo genera Firebase automáticamente en el dispositivo (celular) cuando la app se instala o abre por primera vez.
            notification: {
                title: title,
                body: body,
            },
            data: data || {}, // Información extra (ej: id de la solicitud)
            android: {
                priority: 'high',
                notification: {
                    channelId: 'default', // Importante para Android 8+
                },
            },
            apns: {
                payload: {
                    aps: {
                        contentAvailable: true, // Para despertar la app en iOS
                    },
                },
            },
        };

        try {
            const response = await admin.messaging().send(message);
            console.log('Notificación enviada con éxito:', response);
            return response;
        } catch (error) {
            console.error('Error enviando notificación:', error);
            throw error;
        }
    }
}