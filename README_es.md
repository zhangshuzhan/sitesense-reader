<div align="right">
  <a href="README.md">English</a> |
  <a href="README_zh.md">简体中文</a> |
  <a href="README_ru.md">Русский</a> |
  <strong>Español</strong> |
  <a href="README_fr.md">Français</a> |
  <a href="README_ar.md">العربية</a>
</div>

<p align="center">
  <img src="icon.svg" width="128" height="128" alt="RSS Reader Logo">
</p>

<h1 align="center">RSS Reader</h1>

<p align="center">
  <strong>Un lector RSS de escritorio local-first con herramientas de IA opcionales.</strong>
</p>

<p align="center">
  <a href="https://github.com/JinxinWonderWorld/RSS-Reader/releases"><img src="https://img.shields.io/github/v/release/JinxinWonderWorld/RSS-Reader?color=blue&label=Descargar" alt="Releases"></a>
  <img src="https://img.shields.io/badge/Version-0.2.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/Platform-macOS-lightgrey" alt="Platform">
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Built_with-Tauri_2-24C8DB?logo=tauri&logoColor=white" alt="Tauri"></a>
</p>

<p align="center">
  <a href="#resumen">Resumen</a> •
  <a href="#funciones">Funciones</a> •
  <a href="#novedades-en-020">Novedades</a> •
  <a href="#descarga">Descarga</a> •
  <a href="#desarrollo">Desarrollo</a> •
  <a href="#arquitectura">Arquitectura</a>
</p>

---

<p align="center">
  <img src="imgs/screenshot.png" alt="RSS Reader screenshot" width="800">
</p>

## Resumen

RSS Reader es una aplicación de escritorio Tauri 2 para leer feeds RSS, Atom y JSON. Guarda los datos localmente en SQLite, reduce el coste de actualización con peticiones condicionales y añade flujos opcionales de IA para resúmenes, traducción y puntuación de artículos.

La aplicación sigue el flujo nativo de macOS: `Command+W` cierra la ventana y mantiene la app activa en el Dock, mientras que `Command+Q` cierra la aplicación por completo.

## Funciones

### Lectura y gestión de feeds
- Suscripción a feeds RSS, Atom y JSON.
- Importación y exportación de suscripciones con OPML.
- Vistas para todos los artículos, no leídos, destacados y favoritos.
- Organización por feeds, etiquetas y grupos.
- Búsqueda local de texto completo.
- Listas virtualizadas para colecciones grandes de artículos.

### Rendimiento y trabajo en segundo plano
- Almacenamiento local de artículos, feeds, reglas y ajustes.
- Uso de `ETag` y `Last-Modified` para omitir feeds sin cambios.
- Actualización de feeds en Rust con concurrencia limitada.
- Programador ligero en segundo plano cuando se cierra la ventana principal.
- Pausa de tareas pesadas de UI e IA cuando no hay ventana abierta.
- Carga bajo demanda del renderizado de artículos, saneamiento HTML, Markdown y resaltado de código.
- Proxy `rss-media://` limitado para medios que necesitan caché o peticiones Range.
- Carga de videos incrustados solo después de una acción del usuario.

### Herramientas de IA opcionales
- Configuración de perfiles compatibles con OpenAI o Anthropic.
- Generación de resúmenes de artículos individuales.
- Traducción de contenido de artículos.
- Generación de resúmenes por lote para varios artículos.
- Reglas de automatización y puntuación con IA para clasificar o resaltar artículos.
- Las claves API se guardan en los ajustes locales de la aplicación.

### Experiencia de escritorio
- Comportamiento nativo del menú de macOS para cerrar, reabrir, ocultar y salir.
- Atajos de teclado con interruptor para activarlos o desactivarlos.
- Temas claro, oscuro y del sistema.
- Menús contextuales y acciones por lote para artículos.
- Interfaz en inglés, chino, ruso, español, francés y árabe.

## Novedades en 0.2.0

- Ciclo de vida estándar de macOS: `Command+W` cierra la ventana, `Command+Q` sale de la app.
- Menor consumo en estado oculto al destruir el WebView cuando se cierra la ventana.
- Actualización y limpieza en segundo plano respaldadas por Rust.
- Obtención condicional de feeds con `ETag` y `Last-Modified`.
- Renderizado de artículos diferido y carga multimedia más ligera.
- Nuevo interruptor de atajos de teclado en ajustes.
- Correcciones para restauración de rutas, navegación desde ajustes, recuentos de feeds y sincronización de estado de lectura.

## Descarga

Las compilaciones listas para usar se publican en [GitHub Releases](https://github.com/JinxinWonderWorld/RSS-Reader/releases).

El objetivo de la versión actual es macOS. La configuración de Tauri conserva soporte para Windows y Linux, pero las pruebas de lanzamiento se centran actualmente en macOS.

## Desarrollo

### Requisitos
- [Node.js](https://nodejs.org/) 18 o superior
- [Rust](https://www.rust-lang.org/tools/install) 1.70 o superior

### Inicio rápido

```bash
git clone https://github.com/JinxinWonderWorld/RSS-Reader.git
cd RSS-Reader
npm install
npm run tauri:dev
```

### Comandos útiles

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Ejecutar solo el frontend de Vite |
| `npm run build` | Comprobar tipos y compilar el frontend |
| `npm run tauri:dev` | Ejecutar la app Tauri completa en desarrollo |
| `npm run tauri:build` | Compilar el paquete de lanzamiento |
| `npm test -- --run` | Ejecutar pruebas del frontend |
| `npm run lint` | Ejecutar ESLint |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Ejecutar pruebas de Rust |

## Arquitectura

- `src-tauri/src/app_runtime.rs`: estado runtime, planificación en segundo plano y reglas de limpieza.
- `src-tauri/src/window_lifecycle.rs`: cierre, reapertura y restauración de ventana en macOS.
- `src-tauri/src/feed/`: obtención de feeds, peticiones condicionales y parsing.
- `src-tauri/src/db/`: esquema SQLite y acceso a datos.
- `src-tauri/src/media_protocol.rs`: proxy multimedia limitado y respuestas Range.
- `src-tauri/src/ai.rs`: resúmenes de IA, traducción, resúmenes por lote y cola.
- `src/services/runtime.ts`: puente del frontend hacia comandos runtime de Rust.
- `src/stores/`: stores Zustand para feeds, ajustes, reglas, UI e historial de búsqueda.
- `src/components/`: componentes React y renderizado diferido de artículos.
