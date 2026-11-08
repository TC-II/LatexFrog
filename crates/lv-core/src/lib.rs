//! Core de Latex Frog. Biblioteca sin dependencias de Tauri: se prueba sin interfaz y la capa de `src-tauri` sólo
//! la expone. Todas las rutas del protocolo son relativas a la raíz del proyecto y llevan `/`.

// No se llama `aux`: es un nombre reservado de Windows (`aux.rs` se crea pero git no lo puede agregar).
pub mod auxiliares;
pub mod build;
pub mod candado;
pub mod cocinero;
pub mod doctor;
pub mod cola;
pub mod composicion;
pub mod config;
pub mod detectar;
pub mod error;
pub mod etiquetas;
pub mod figcache;
pub mod figimages;
pub mod figures;
pub mod formato;
pub mod fsio;
pub mod fswatch;
pub mod graph;
pub mod historial;
pub mod live;
pub mod logparse;
pub mod macros;
pub mod migration;
pub mod piezas;
pub mod procesos;
pub mod procs;
pub mod project;
pub mod search;
pub mod session;
pub mod symbols;
pub mod synctex;
