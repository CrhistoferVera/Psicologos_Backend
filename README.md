# Pachamama Backend — API Reference

**Base URL:** `http://localhost:4000`
**Swagger UI:** `http://localhost:4000/docs`

---

## Variables de entorno requeridas

Crea un archivo `.env` en la raíz del proyecto:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/pachamama
JWT_SECRET=tu_secreto_jwt
PORT=4000
FRONTEND_URL=http://localhost:3000

# Evolution API (WhatsApp OTP)
EVOLUTION_API_URL=http://tu-evolution-api-host
EVOLUTION_API_INSTANCE=nombre_instancia
EVOLUTION_API_KEY=tu_api_key

# Cloudinary (subida de archivos)
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
# O por separado:
# CLOUDINARY_CLOUD_NAME=tu_cloud_name
# CLOUDINARY_API_KEY=tu_api_key
# CLOUDINARY_API_SECRET=tu_api_secret
```

## Correr el proyecto

```bash
npm install
npm run start:dev
```

---

## Flujo de registro (usuario nuevo)

```
[1] POST /auth/send-otp           → llega código por WhatsApp
[2] POST /auth/verify-otp         → responde { needsProfile: true, tempToken }
[3] POST /auth/complete-registration → responde { access_token, user }
```

## Flujo de login (usuario existente)

```
[1] POST /auth/send-otp           → llega código por WhatsApp
[2] POST /auth/verify-otp         → responde { access_token, user }  ← listo
```

---

## Endpoints de Autenticación

### 1. Enviar OTP por WhatsApp

```
POST /auth/send-otp
```

**Body:**
```json
{
  "phoneNumber": "5491112345678"
}
```

> El número debe incluir código de país sin `+`. Ejemplo Argentina: `549` + número local.

**Respuesta `200`:**
```json
{
  "message": "Código OTP enviado por WhatsApp. Expira en 5 minutos."
}
```

---

### 2. Verificar OTP

```
POST /auth/verify-otp
```

**Body:**
```json
{
  "phoneNumber": "5491112345678",
  "code": "123456"
}
```

**Respuesta A — usuario existente `200`:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "phoneNumber": "5491112345678",
    "firstName": "Juan",
    "lastName": "Pérez",
    "email": "juan@example.com",
    "role": "USER",
    "isProfileComplete": true
  }
}
```

**Respuesta B — usuario nuevo `200`:**
```json
{
  "needsProfile": true,
  "tempToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

> Guardar `tempToken` para el siguiente paso. Expira en **10 minutos**.

---

### 3. Completar registro (solo usuarios nuevos)

```
POST /auth/complete-registration
```

**Body:**
```json
{
  "tempToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "firstName": "Juan",
  "lastName": "Pérez",
  "email": "juan@example.com",
  "password": "miPassword123",
  "confirmPassword": "miPassword123"
}
```

> `email` es opcional. `password` mínimo 6 caracteres. `password` y `confirmPassword` deben coincidir.

**Respuesta `201`:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "phoneNumber": "5491112345678",
    "firstName": "Juan",
    "lastName": "Pérez",
    "email": "juan@example.com",
    "role": "USER",
    "isProfileComplete": true
  }
}
```

---

### 4. Login con email y contraseña (alternativo)

```
POST /auth/login
```

**Body:**
```json
{
  "email": "juan@example.com",
  "password": "miPassword123"
}
```

**Respuesta `200`:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { ... }
}
```

---

## Endpoints de Usuarios

> Los endpoints con 🔒 requieren el header:
> ```
> Authorization: Bearer <access_token>
> ```

### 5. 🔒 Obtener perfil propio

```
GET /users/profile
```

**Respuesta `200`:**
```json
{
  "id": "uuid",
  "phoneNumber": "5491112345678",
  "firstName": "Juan",
  "lastName": "Pérez",
  "email": "juan@example.com",
  "role": "USER",
  "isProfileComplete": true
}
```

---

### 6. Obtener usuario por ID

```
GET /users/:id
```

**Respuesta `200`:**
```json
{
  "id": "uuid",
  "phoneNumber": "5491112345678",
  "firstName": "Juan",
  "lastName": "Pérez",
  ...
}
```

---

### 7. 🔒 Editar número de teléfono

```
PATCH /users/edit-phone-number
```

**Body:**
```json
{
  "phoneNumber": "5491199998888"
}
```

**Respuesta `200`:**
```json
{
  "success": true,
  "message": "Número de teléfono actualizado correctamente",
  "phoneNumber": "5491199998888"
}
```

---

### 8. 🔒 Cambiar contraseña

```
PATCH /users/edit-password
```

**Body:**
```json
{
  "oldPassword": "miPassword123",
  "newPassword": "nuevoPassword456"
}
```

**Respuesta `200`:**
```json
{
  "success": true,
  "message": "Contraseña actualizada correctamente"
}
```

---

## Endpoints de Anfitrionas

> Todos los endpoints de anfitrionas requieren:
> ```
> Authorization: Bearer <access_token_de_admin>
> ```
> Solo usuarios con `role: "ADMIN"` pueden acceder.

### 9. 🔒 Registrar anfitriona (solo ADMIN)

```
POST /anfitrionas
Content-Type: multipart/form-data
```

El admin registra a la anfitriona. La anfitriona **no puede registrarse a sí misma**.

**Campos del form-data:**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `firstName` | texto | Sí | Nombres |
| `lastName` | texto | Sí | Apellidos |
| `phoneNumber` | texto | Sí | Teléfono con código de país (ej: `59171234567`) |
| `dateOfBirth` | texto | Sí | Fecha de nacimiento en formato ISO: `1995-06-15` |
| `cedula` | texto | Sí | Número de cédula de identidad |
| `username` | texto | Sí | Nombre de usuario único |
| `email` | texto | No | Email (opcional) |
| `idDoc` | archivo | No | Documento de identidad (imagen JPG/PNG o PDF) |

**Cómo configurar en Postman:**
1. Método: `POST`, URL: `http://localhost:4000/anfitrionas`
2. Tab **Authorization** → Bearer Token → pegar `access_token` de un admin
3. Tab **Body** → seleccionar `form-data`
4. Agregar cada campo como `Text`, y `idDoc` como `File`

**Respuesta exitosa `201`:**
```json
{
  "user": {
    "id": "uuid",
    "phoneNumber": "59171234567",
    "email": null,
    "firstName": "Camila",
    "lastName": "Sanches Carrillo",
    "isProfileComplete": true,
    "role": "ANFITRIONA",
    "createdAt": "2026-03-06T00:00:00.000Z",
    "updatedAt": "2026-03-06T00:00:00.000Z",
    "lastLogin": null
  },
  "profile": {
    "id": "uuid",
    "userId": "uuid",
    "dateOfBirth": "1995-06-15T00:00:00.000Z",
    "cedula": "34535355",
    "username": "cristina_princ",
    "idDocUrl": "pachamama/anfitrionas/uuid/identity/id_doc_...",
    "idDocPublicId": "pachamama/anfitrionas/uuid/identity/id_doc_...",
    "createdAt": "2026-03-06T00:00:00.000Z",
    "updatedAt": "2026-03-06T00:00:00.000Z"
  }
}
```

---

### 10. 🔒 Listar todas las anfitrionas (solo ADMIN)

```
GET /anfitrionas
```

**Respuesta exitosa `200`:**
```json
[
  {
    "id": "uuid",
    "phoneNumber": "59171234567",
    "firstName": "Camila",
    "lastName": "Sanches Carrillo",
    "email": null,
    "isProfileComplete": true,
    "createdAt": "2026-03-06T00:00:00.000Z",
    "anfitrionaProfile": {
      "id": "uuid",
      "dateOfBirth": "1995-06-15T00:00:00.000Z",
      "cedula": "34535355",
      "username": "cristina_princ",
      "idDocUrl": "...",
      "idDocPublicId": "..."
    }
  }
]
```

---

### 11. 🔒 Obtener anfitriona por ID (solo ADMIN)

```
GET /anfitrionas/:id
```

> `:id` es el `userId` (UUID del usuario).

**Respuesta exitosa `200`:**
```json
{
  "id": "uuid",
  "phoneNumber": "59171234567",
  "firstName": "Camila",
  "lastName": "Sanches Carrillo",
  "email": null,
  "isProfileComplete": true,
  "createdAt": "2026-03-06T00:00:00.000Z",
  "anfitrionaProfile": {
    "id": "uuid",
    "dateOfBirth": "1995-06-15T00:00:00.000Z",
    "cedula": "34535355",
    "username": "cristina_princ",
    "idDocUrl": "...",
    "idDocPublicId": "..."
  }
}
```

---

## Migraciones de base de datos

Después de cualquier cambio en `prisma/schema.prisma`, correr:

```bash
npx prisma migrate dev --name <nombre_descriptivo>
```

Migraciones aplicadas hasta ahora:
- `init` — tablas iniciales (`users`)
- `add-anfitrione-profile` — tabla `anfitrione_profiles` con relación a `users`

---

## Errores comunes

| Código | Causa |
|--------|-------|
| `400`  | OTP inválido o expirado / contraseñas no coinciden / `tempToken` expirado |
| `401`  | Email o contraseña incorrectos / JWT inválido o ausente |
| `403`  | Intentar acceder a endpoint de ADMIN sin serlo |
| `404`  | Usuario no encontrado |
| `409`  | Teléfono, email, cédula o username ya registrado |
| `500`  | Error al enviar WhatsApp o subir archivo a Cloudinary |
