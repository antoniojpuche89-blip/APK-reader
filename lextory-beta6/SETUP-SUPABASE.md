# Activar cuentas y sincronización de Lextory

La interfaz de cuenta está preparada, pero el registro e inicio de sesión permanecen deshabilitados hasta conectar un proyecto Supabase.

## 1. Crear el proyecto
1. Crea un proyecto Supabase y elige una región adecuada para tus usuarios.
2. En Authentication → URL Configuration añade:
   - https://antoniojpuche89-blip.github.io/APK-reader/
   - https://antoniojpuche89-blip.github.io/APK-reader/delete-account.html
3. Activa Email como proveedor de acceso. Configura un SMTP de producción antes de abrir el registro al público.

## 2. Crear las tablas
Ejecuta supabase/migrations/20261108_lextory_cloud_sync.sql en el SQL Editor. Las políticas RLS hacen que cada usuario solo pueda consultar y modificar sus datos.

## 3. Desplegar eliminación de cuenta
Despliega supabase/functions/delete-account/index.ts como Edge Function llamada delete-account. Configura en el entorno del servidor los secretos SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY. Nunca publiques la service-role key en GitHub Pages.

## 4. Configurar la clave pública
En lextory-beta6/supabase-config.js rellena url y publishableKey con la Project URL y la clave pública (anon/publishable) de tu proyecto. No uses una clave secreta. Vuelve a publicar y comprueba registro, correo de confirmación, login, sincronización en dos dispositivos y eliminación.

## Qué se sincroniza
Se sincroniza el porcentaje, página/CFI de lectura y vocabulario. No se suben archivos ni portadas. Para continuar en otro dispositivo, el usuario importa allí su propia copia del libro; la huella SHA-256 de una muestra y el tamaño permiten asociar el progreso.

Antes del registro público: configura SMTP, límites antiabuso, copias de seguridad y la política de privacidad final. Prueba RLS con dos cuentas distintas y comprueba que ningún usuario puede leer los datos de otro.


## Conexión activada en Supabase (8 de noviembre de 2026)

El proyecto Lextory ya tiene el esquema de sincronización aplicado. La app usa la URL del proyecto y la clave **publishable** en el navegador. No añadas nunca una clave secret/service-role a archivos públicos.

Antes de permitir el registro real, configura en Supabase Authentication → URL Configuration:
- Site URL: https://antoniojpuche89-blip.github.io/APK-reader/
- Redirect URL permitida: https://antoniojpuche89-blip.github.io/APK-reader/

El envío de correos de confirmación/restablecimiento debe configurarse con SMTP propio antes de abrir el registro al público. El SMTP de prueba gestionado por Supabase tiene límites y no es un servicio de entrega de producción.
