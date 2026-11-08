# Lextory — hoja de ruta para Google Play

## Estado
La edición web/PWA sigue siendo la base. Esta publicación no es todavía un paquete Android AAB listo para Play Console. No se deben anunciar anuncios, voces IA ni compras como funciones activas.

## Free
- Importar y leer EPUB/PDF, Gutenberg, traducción y diccionario contextual.
- Vocabulario, tarjetas de memoria y voz local.
- Sincronización básica de progreso y vocabulario cuando el backend esté conectado.
- Publicidad discreta en biblioteca/catálogo, nunca sobre el texto de lectura; solo tras configurar AdMob y el consentimiento correspondiente.

## Lextory Plus
- Sin anuncios.
- Voces neuronales de IA con selección de acento, velocidad y narración natural.
- Audiolibro avanzado: continuidad real, temporizador de sueño, controles de auriculares, reproducción en segundo plano y descargas de audio cuando se disponga de derechos.
- Vocabulario ampliado, estadísticas, objetivos y listas de lectura.
- La sincronización del progreso y los datos básicos debe seguir siendo independiente de la suscripción para no bloquear los datos personales.

## Trabajo obligatorio antes de Google Play
1. Empaquetar con una integración Android nativa (por ejemplo, Capacitor) y añadir comportamiento propio más allá de una WebView básica.
2. Apuntar como mínimo a Android 16/API 36 para nuevas apps y actualizaciones desde el 31 de agosto de 2026.
3. Integrar Google Play Billing para Premium; validar y gestionar las compras en backend.
4. Integrar AdMob con identificadores de prueba primero, Google UMP y consentimiento/configuración de privacidad para usuarios del EEE y Reino Unido.
5. Completar Data Safety, política de privacidad y contacto del responsable, clasificación de contenido, gráficos, capturas, pruebas cerradas y el enlace web de eliminación de cuenta.
6. Probar importación de archivos grandes, offline, TalkBack, accesibilidad, rotación, memoria, recuperación de conexión y restauración en segundo dispositivo.

## IA y costes
Las voces IA deben generarse desde un backend que proteja la clave del proveedor. Medir coste por minuto/caracteres, cuotas, caché y límites por usuario antes de venderlas. No incluir claves de IA en JavaScript.

## Publicidad
No insertar banners durante la lectura. Usar espacios limitados en biblioteca o catálogo, frecuencia moderada y nunca mostrar anuncios a Premium. En el EEE, configurar UMP y obtener/actualizar el consentimiento exigido antes de solicitar anuncios personalizados.

## Criterio de lanzamiento
No publicar hasta tener backend, sincronización probada, Billing, AdMob/UMP, páginas legales finales, pruebas de extremo a extremo y AAB firmado.
