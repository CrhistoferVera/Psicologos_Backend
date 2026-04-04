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
    /**
     * primero se envia la notificación a Firebase usando el token FCM del usuario, el título y el cuerpo del mensaje. Firebase se encarga de entregar esa notificación al dispositivo móvil del usuario.
     * El token FCM lo genera Firebase automáticamente en el dispositivo (celular) cuando la app se instala o abre por primera vez. Si el token cambia (ej: reinstalación de la app, cambio de dispositivo), el cliente debe llamar a esta ruta para actualizarlo en el backend. De lo contrario, las notificaciones push podrían no llegar al usuario porque el backend estaría usando un token obsoleto.
     * El parámetro "data" es opcional y se puede usar para enviar información adicional que la app móvil pueda necesitar para manejar la notificación (ej: id de una solicitud). Esta información se envía como parte de la carga útil de la notificación y la app móvil puede acceder a ella cuando recibe la notificación.
     */
    async sendMulticastNotification(tokens: string[], title: string, body: string, data?: any) {
        if (!tokens.length) return;

        const stringData = data ? Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
        ) : {};

        // Firebase permite máximo 500 tokens por batch
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
                await admin.messaging().sendEachForMulticast(message);
            } catch (error) {
                console.error('Error enviando multicast:', error);
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
            data: data ? Object.fromEntries(
                Object.entries(data).map(([k, v]) => [k, String(v)])
            ) : {}, // Firebase exige que todos los valores sean strings
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