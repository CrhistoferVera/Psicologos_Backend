import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  constructor() {
    const cloudinaryUrl = process.env.CLOUDINARY_URL;

    if (cloudinaryUrl) {
      try {
        const u = new URL(cloudinaryUrl);
        const cloudName = u.hostname;
        const apiKey = decodeURIComponent(u.username);
        const apiSecret = decodeURIComponent(u.password);

        if (!cloudName || !apiKey || !apiSecret)
          throw new Error('Invalid CLOUDINARY_URL');

        cloudinary.config({
          cloud_name: cloudName,
          api_key: apiKey,
          api_secret: apiSecret,
          secure: true,
        });

        return;
      } catch {
        throw new InternalServerErrorException('CLOUDINARY_URL inválida.');
      }
    }

    // Fallback por si se usa variables separadas
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      throw new InternalServerErrorException(
        'Faltan variables de Cloudinary. Usa CLOUDINARY_URL o CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET.',
      );
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  async uploadDepositProof(params: {
    file: Express.Multer.File;
    userId: string;
    depositId: string;
    referenceCode: string;
    isPrivate?: boolean;
  }): Promise<{ secureUrl: string; publicId: string }> {
    const { file, userId, depositId, isPrivate } = params;

    const isImage = file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';
    if (!isImage && !isPdf) {
      throw new InternalServerErrorException('Tipo de archivo no soportado.');
    }

    const resourceType: 'image' | 'raw' = isImage ? 'image' : 'raw';
    const folder = `pachamama/users/${userId}/deposits/${depositId}`;
    const publicId = `proof_${Date.now()}`;

    if (isPrivate) {
      const uploaded = await this.uploadPrivate({
        file,
        folder,
        publicId,
        resourceType,
      });

      const signedUrl = this.getSignedUrl({
        publicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
        expiresInSeconds: 10 * 60,
      });

      return { secureUrl: signedUrl, publicId: uploaded.publicId };
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, public_id: publicId, resource_type: resourceType },
        (error, result) => {
          if (error || !result?.secure_url) {
            return reject(
              new InternalServerErrorException(
                'No se pudo subir el comprobante a Cloudinary.',
              ),
            );
          }
          resolve({ secureUrl: result.secure_url, publicId: result.public_id });
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  async uploadVerificationFile(params: {
    file: Express.Multer.File;
    userId: string;
    isPrivate?: boolean;
  }): Promise<{ secureUrl: string; publicId: string }> {
    const { file, userId, isPrivate } = params;
    const isImage = file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';
    if (!isImage && !isPdf) {
      throw new InternalServerErrorException('Tipo de archivo no soportado.');
    }
    const resourceType: 'image' | 'raw' = isImage ? 'image' : 'raw';
    const folder = `pachamama/users/${userId}/verification`;
    const publicId = `proof_${Date.now()}`;

    if (isPrivate) {
      const uploaded = await this.uploadPrivate({
        file,
        folder,
        publicId,
        resourceType,
      });

      const signedUrl = this.getSignedUrl({
        publicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
        expiresInSeconds: 10 * 60,
      });

      return { secureUrl: signedUrl, publicId: uploaded.publicId };
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, public_id: publicId, resource_type: resourceType },
        (error, result) => {
          if (error || !result?.secure_url) {
            return reject(
              new InternalServerErrorException(
                'No se pudo subir el comprobante a Cloudinary.',
              ),
            );
          }
          resolve({ secureUrl: result.secure_url, publicId: result.public_id });
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  async uploadWithdrawalProof(params: {
    file: Express.Multer.File;
    userId: string;
    withdrawalId: string;
    isPrivate?: boolean;
  }): Promise<{ secureUrl: string; publicId: string }> {
    const { file, userId, withdrawalId, isPrivate } = params;

    // Validar tipo de archivo
    const isImage = file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';
    if (!isImage && !isPdf) {
      throw new InternalServerErrorException('Tipo de archivo no soportado.');
    }

    const resourceType: 'image' | 'raw' = isImage ? 'image' : 'raw';
    const folder = `pachamama/users/${userId}/withdrawals/${withdrawalId}`;
    const publicId = `proof_${Date.now()}`;

    if (isPrivate) {
      const uploaded = await this.uploadPrivate({
        file,
        folder,
        publicId,
        resourceType,
      });

      const signedUrl = this.getSignedUrl({
        publicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
        expiresInSeconds: 10 * 60,
      });

      return { secureUrl: signedUrl, publicId: uploaded.publicId };
    }

    // Subida a Cloudinary
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, public_id: publicId, resource_type: resourceType },
        (error, result) => {
          if (error || !result?.secure_url) {
            return reject(
              new InternalServerErrorException(
                'No se pudo subir el comprobante de retiro a Cloudinary.',
              ),
            );
          }
          resolve({ secureUrl: result.secure_url, publicId: result.public_id });
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  async uploadPrivate(params: {
    file: Express.Multer.File;
    folder: string;
    publicId: string;
    resourceType: 'image' | 'video' | 'raw';
  }): Promise<{ publicId: string; resourceType: 'image' | 'video' | 'raw'; bytes: number; format?: string }> {
    const { file, folder, publicId, resourceType } = params;

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: resourceType,
          type: 'authenticated',
          overwrite: true,
          invalidate: true,
        },
        (error, result) => {
          if (error || !result?.public_id) {
            return reject(
              new InternalServerErrorException(
                'No se pudo subir el archivo a Cloudinary.',
              ),
            );
          }

          resolve({
            publicId: result.public_id,
            resourceType: resourceType,
            bytes: result.bytes ?? 0,
            format: result.format,
          });
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  getSignedUrl(params: {
    publicId: string;
    resourceType: 'image' | 'video' | 'raw';
    expiresInSeconds: number;
    version?: number;
  }): string {
    const { publicId, resourceType, expiresInSeconds, version } = params;
    const expiresAt = Math.floor(Date.now() / 1000) + Math.max(1, expiresInSeconds);

    return cloudinary.url(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
      sign_url: true,
      expires_at: expiresAt,
      secure: true,
      ...(version ? { version } : {}),
    });
  }

  async uploadAnfitrioneIdDoc(params: {
    file: Express.Multer.File;
    userId: string;
  }): Promise<{ secureUrl: string; publicId: string }> {
    const { file, userId } = params;

    const isImage = file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';
    if (!isImage && !isPdf) {
      throw new InternalServerErrorException(
        'Tipo de archivo no soportado. Solo imágenes o PDF.',
      );
    }

    const resourceType: 'image' | 'raw' = isImage ? 'image' : 'raw';
    const folder = `pachamama/anfitrionas/${userId}/identity`;
    const publicId = `id_doc_${Date.now()}`;

    const uploaded = await this.uploadPrivate({
      file,
      folder,
      publicId,
      resourceType,
    });

    return { secureUrl: uploaded.publicId, publicId: uploaded.publicId };
  }

  // SERVICIO PARA SUBIR COMPROBANTES DE DEPÓSITO
  async uploadDepositPaymentProof(params: {
    file: Express.Multer.File;
    userId: string;
  }): Promise<{ secureUrl: string; publicId: string }> {
    const { file, userId } = params;

    //  Validar que sea imagen o PDF
    const isImage = file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';

    if (!isImage && !isPdf) {
      throw new BadRequestException('Tipo de archivo no soportado. Solo imágenes o PDF.');
    }

    // Definir carpeta y nombre (pachamama/users/ID_USUARIO/deposits)
    const resourceType: 'image' | 'raw' = isImage ? 'image' : 'raw';
    const folder = `pachamama/users/${userId}/deposits/comprobantes`;
    const publicId = `proof_${Date.now()}`;

    // Subir a Cloudinary mediante Stream
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: 'auto',
        },
        (error, result) => {
          if (error || !result?.secure_url) {
            return reject(
              new InternalServerErrorException('Error al subir el comprobante a Cloudinary.'),
            );
          }
          resolve({
            secureUrl: result.secure_url,
            publicId: result.public_id
          });
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  async uploadHistoryMedia(params: {
    file: Express.Multer.File;
    userId: string;
  }): Promise<{ secureUrl: string; publicId: string; resourceType: 'image' | 'video' }> {
    const { file, userId } = params;

    // 1. Detectar si es imagen o video
    const isImage = file.mimetype.startsWith('image/');
    const isVideo = file.mimetype.startsWith('video/');

    if (!isImage && !isVideo) {
      throw new InternalServerErrorException('Formato no permitido. Solo imágenes o videos.');
    }

    const resourceType = isImage ? 'image' : 'video';
    const folder = `pachamama/users/${userId}/histories`;
    const publicId = `history_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: resourceType,

        },
        (error, result) => {
          if (error || !result?.secure_url) {
            return reject(new InternalServerErrorException('Error al subir media a Cloudinary.'));
          }
          resolve({
            secureUrl: result.secure_url,
            publicId: result.public_id,
            resourceType: resourceType
          });
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  async uploadAnfitrioneAvatar(params: {
    file: Express.Multer.File;
    userId: string;
  }): Promise<{ secureUrl: string; publicId: string }> {
    const { file, userId } = params;

    if (!file.mimetype.startsWith('image/')) {
      throw new InternalServerErrorException('Solo se permiten imágenes para el avatar.');
    }

    const folder = `pachamama/anfitrionas/${userId}/avatar`;
    const publicId = `avatar_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, public_id: publicId, resource_type: 'image' },
        (error, result) => {
          if (error || !result?.secure_url) {
            return reject(new InternalServerErrorException('Error al subir el avatar a Cloudinary.'));
          }
          resolve({ secureUrl: result.secure_url, publicId: result.public_id });
        },
      );
      uploadStream.end(file.buffer);
    });
  }

  async uploadCoverImage(params: {
    file: Express.Multer.File;
    userId: string;
  }): Promise<{ secureUrl: string; publicId: string }> {
    const { file, userId } = params;

    if (!file.mimetype.startsWith('image/')) {
      throw new InternalServerErrorException('Solo se permiten imágenes para el banner.');
    }

    const folder = `pachamama/anfitrionas/${userId}/cover`;
    const publicId = `cover_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, public_id: publicId, resource_type: 'image' },
        (error, result) => {
          if (error || !result?.secure_url) {
            return reject(new InternalServerErrorException('Error al subir el banner a Cloudinary.'));
          }
          resolve({ secureUrl: result.secure_url, publicId: result.public_id });
        },
      );
      uploadStream.end(file.buffer);
    });
  }

  //ELIMINAR UNA HISTORIA DE UNA ANFITRIONA
  async deleteHistoryMedia(publicId: string, type: 'image' | 'video') {
    try {
      await cloudinary.uploader.destroy(publicId, { invalidate: true, resource_type: type });

    } catch (error) {
      throw new InternalServerErrorException('Error al eliminar el archivo de cloudinary.');
    }
  }

  // ─── Galería permanente de anfitriona ─────────────────────────────────────

  async uploadGalleryImage(params: {
    file: Express.Multer.File;
    userId: string;
  }): Promise<{ secureUrl: string; publicId: string }> {
    const { file, userId } = params;

    if (!file.mimetype.startsWith('image/')) {
      throw new InternalServerErrorException('Solo se permiten imágenes para la galería.');
    }

    const folder = `pachamama/anfitrionas/${userId}/gallery`;
    const publicId = `gallery_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, public_id: publicId, resource_type: 'image' },
        (error, result) => {
          if (error || !result?.secure_url) {
            return reject(
              new InternalServerErrorException('Error al subir imagen de galería a Cloudinary.'),
            );
          }
          resolve({ secureUrl: result.secure_url, publicId: result.public_id });
        },
      );
      uploadStream.end(file.buffer);
    });
  }

  async deleteGalleryImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, { invalidate: true, resource_type: 'image' });
    } catch {
      throw new InternalServerErrorException('Error al eliminar la imagen de galería de Cloudinary.');
    }
  }
}