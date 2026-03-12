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

La anfitriona **no puede registrarse a sí misma**. El flujo requiere 2 pasos:

#### Paso 1 — El admin obtiene su token

```
POST /auth/send-otp
Content-Type: application/json

{
  "phoneNumber": "59171000001"
}
```

```
POST /auth/verify-otp
Content-Type: application/json

{
  "phoneNumber": "59171000001",
  "code": "482910"
}
```

Respuesta:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "role": "ADMIN", ... }
}
```

> El usuario admin debe existir en la DB con `role = 'ADMIN'`. Para asignarlo en desarrollo:
> ```sql
> UPDATE users SET role = 'ADMIN' WHERE phone_number = '59171000001';
> ```

---

#### Paso 2 — El admin crea la anfitriona

```
POST /anfitrionas
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: multipart/form-data
```

**Campos del form-data:**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `firstName` | texto | Sí | Nombres |
| `lastName` | texto | Sí | Apellidos |
| `phoneNumber` | texto | Sí | Teléfono con código de país (ej: `59171234567`) |
| `dateOfBirth` | texto | Sí | Fecha de nacimiento ISO: `1995-06-15` |
| `cedula` | texto | Sí | Número de cédula de identidad |
| `username` | texto | Sí | Nombre de usuario único |
| `email` | texto | No | Email (opcional) |
| `idDoc` | archivo | No | Documento de identidad (JPG, PNG o PDF) |

**Cómo configurarlo en Postman:**
1. Método `POST`, URL: `http://localhost:4000/anfitrionas`
2. Tab **Auth** → Type: `Bearer Token` → pegar el `access_token` del admin
3. Tab **Body** → seleccionar `form-data`
4. Agregar cada campo con tipo `Text`, y `idDoc` con tipo `File`

**Ejemplo de valores:**

| Key | Value |
|-----|-------|
| `firstName` | `Camila` |
| `lastName` | `Sanches Carrillo` |
| `phoneNumber` | `59175555555` |
| `dateOfBirth` | `1995-06-15` |
| `cedula` | `34535355` |
| `username` | `cristina_princ` |
| `email` | `camila@gmail.com` |
| `idDoc` | _(seleccionar archivo)_ |

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

---

## Endpoints Públicos — Área Cliente

> Estos endpoints **no requieren autenticación**. Cualquier cliente puede llamarlos sin `Authorization` header.
> Son los únicos endpoints que consume el frontend en la zona del cliente por ahora.

---

### Listado de anfitrionas (feed del cliente)

```
GET /anfitrionas/public
```

Sin parámetros. Devuelve todas las anfitrionas con `isActive: true` e `isProfileComplete: true`.

**Respuesta `200`:**
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Maria Lopez",
      "avatar": "https://res.cloudinary.com/.../avatar.jpg",
      "shortDescription": "Conversaciones alegres 🌸✨",
      "rateCredits": 10,
      "mainImage": "https://res.cloudinary.com/.../main.jpg",
      "images": [
        "https://res.cloudinary.com/.../img1.jpg",
        "https://res.cloudinary.com/.../img2.jpg"
      ],
      "isOnline": true
    }
  ]
}
```

**Campos de la respuesta:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | `string` (UUID) | ID del usuario anfitriona — se usa para navegar al detalle |
| `name` | `string` | Nombre completo (`firstName + lastName`) |
| `avatar` | `string \| null` | URL de imagen circular del perfil (Cloudinary) |
| `shortDescription` | `string \| null` | Texto corto del campo `bio` en el perfil |
| `rateCredits` | `number \| null` | Créditos por conversación. `null` si no fue configurado |
| `mainImage` | `string \| null` | Primera imagen del perfil. Es `images[0]` |
| `images` | `string[]` | Todas las imágenes del perfil, ordenadas por `sortOrder` |
| `isOnline` | `boolean` | Estado de disponibilidad (actualizado manualmente por ahora) |

**Cómo lo usa el frontend:**
- Función: `src/services/hostesses.ts` → `getPublicHostesses()`
- Pantalla: `app/(cliente)/index.tsx` — llama `getPublicHostesses()` en el `useEffect` inicial

**Campos UI pendientes de backend** (el mapper los rellena con defaults hasta que estén):

| Campo UI | Default actual | Qué agregar al backend cuando esté listo |
|----------|---------------|------------------------------------------|
| `likesCount` | `0` | Campo `likesCount` en `AnfitrioneProfile` o tabla de likes |
| `isPopular` | `false` | Lógica de popularidad (likes, actividad, etc.) |
| `isFavorite` | `false` | Requiere autenticación: consultar favoritos por `userId` del cliente |
| `solPrice` | `undefined` | Campo `solPrice` en `AnfitrioneProfile` si se maneja precio en soles |

---

### Perfil público de una anfitriona

```
GET /anfitrionas/public/:id
```

**Parámetro:** `:id` es el UUID del usuario anfitriona.

**Respuesta `200`:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Maria Lopez",
  "username": "maria_lopez",
  "age": 28,
  "bio": "Conversaciones alegres, siempre disponible 🌸",
  "avatar": "https://res.cloudinary.com/.../avatar.jpg",
  "coverImage": "https://res.cloudinary.com/.../img1.jpg",
  "images": [
    "https://res.cloudinary.com/.../img1.jpg",
    "https://res.cloudinary.com/.../img2.jpg"
  ],
  "rateCredits": 10,
  "isOnline": true
}
```

**Campos de la respuesta:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | `string` (UUID) | ID de la anfitriona |
| `name` | `string` | Nombre completo |
| `username` | `string` | Nombre de usuario único |
| `age` | `number \| null` | Edad calculada automáticamente desde `dateOfBirth`. `null` si no tiene fecha |
| `bio` | `string \| null` | Descripción larga del perfil |
| `avatar` | `string \| null` | URL del avatar (Cloudinary) |
| `coverImage` | `string \| null` | Imagen de portada. Por ahora deriva de `images[0]` |
| `images` | `string[]` | Galería completa ordenada por `sortOrder` |
| `rateCredits` | `number \| null` | Créditos por conversación |
| `isOnline` | `boolean` | Estado de disponibilidad |

**Error `404`** si el id no corresponde a una anfitriona activa:
```json
{
  "message": "Anfitriona no encontrada.",
  "statusCode": 404
}
```

**Cómo lo usa el frontend:**
- Función: `src/services/hostesses.ts` → `getPublicHostessProfile(id)`
- Pantalla: `app/(cliente)/anfitrionas/[id].tsx` — recibe `id` por parámetro de ruta

**Secciones del perfil UI y su origen en backend:**

| Sección UI | Componente | Origen |
|------------|-----------|--------|
| Header (foto + nombre + online) | `ProfileHeader` | `avatar`, `coverImage`, `name`, `isOnline` |
| Galería de imágenes | `GallerySection` | `images[]` |
| Mensaje introductorio | `IntroCard` | `bio` |
| Ítems de confianza | `TrustSection` | Hardcoded en mapper — pendiente de backend |
| Historias destacadas | `HighlightStoriesRow` | Array vacío `[]` — pendiente de backend |

**Campos pendientes de backend para completar HU2:**

| Sección UI | Qué agregar al backend |
|------------|----------------------|
| `highlightedStories` | Nuevo modelo en `AnfitrioneProfile`: `id`, `title`, `emoji`, `locked` |
| `trustItems` | Campo calculado o hardcoded con `emoji`, `label`, `value` |

---

### Flujo completo frontend → backend

```
[Cliente abre el app]
       │
       ▼
app/(cliente)/index.tsx
  └─ getPublicHostesses()
     └─ GET /anfitrionas/public
        └─ mapListItemToAnfitriona() → Anfitriona[]
           └─ renderiza PostCard por cada anfitriona
                  │
                  │  [Toca una anfitriona / "Ver perfil"]
                  ▼
       app/(cliente)/anfitrionas/[id].tsx
         └─ getPublicHostessProfile(id)
            └─ GET /anfitrionas/public/:id
               └─ mapDetailToProfile() → AnfitrioneProfileDetail
                  └─ renderiza ProfileHeader + GallerySection
                              + IntroCard + TrustSection
```
