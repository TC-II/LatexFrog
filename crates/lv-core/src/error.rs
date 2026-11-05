//! Error único del core. El frontend recibe `ErrorInfo` (tipo y mensaje) para poder distinguir, por ejemplo, un
//! conflicto de versión de un error de disco.

use serde::Serialize;
use std::fmt;

#[derive(Debug)]
pub enum Error {
    /// Ruta que no es relativa a la raíz, o que se escapa de ella.
    InvalidPath(String),
    NotFound(String),
    /// El archivo no se puede abrir como texto (binario, UTF-16, UTF-8 inválido).
    NotText(String),
    /// El texto que se quiere escribir no es válido (trae `\r`).
    InvalidText(String),
    /// El archivo cambió en disco desde que se leyó.
    Conflict { disk_version: String },
    Io(String),
    /// Ya hay un build corriendo.
    Busy,
    /// No se pudo lanzar `latexmk`.
    NoLatexmk(String),
    /// Otra instancia de la app tiene abierto este proyecto (candado en `.latexfrog/lock`): acá no se compila ni se cocina.
    Locked(u32),
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::InvalidPath(m) => write!(f, "invalid path: {m}"),
            Error::NotFound(m) => write!(f, "not found: {m}"),
            Error::NotText(m) => write!(f, "cannot open as text: {m}"),
            Error::InvalidText(m) => write!(f, "invalid text: {m}"),
            Error::Conflict { .. } => write!(f, "the file changed on disk since it was opened"),
            Error::Io(m) => write!(f, "disk error: {m}"),
            Error::Busy => write!(f, "a compile is already running"),
            Error::NoLatexmk(m) => write!(f, "could not start latexmk: {m}"),
            Error::Locked(pid) => write!(f, "this project is open in another instance of the app (PID {pid}): nothing compiles or bakes here, so two queues do not step on the same .latexfrog and cache"),
            Error::Other(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for Error {}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct ErrorInfo {
    pub kind: String,
    pub message: String,
    /// Sólo para `conflict`: la versión que tiene el disco ahora.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk_version: Option<String>,
}

impl Error {
    pub fn info(&self) -> ErrorInfo {
        let kind = match self {
            Error::InvalidPath(_) => "invalid_path",
            Error::NotFound(_) => "not_found",
            Error::NotText(_) => "not_text",
            Error::InvalidText(_) => "invalid_text",
            Error::Conflict { .. } => "conflict",
            Error::Io(_) => "io",
            Error::Busy => "busy",
            Error::NoLatexmk(_) => "no_latexmk",
            Error::Locked(_) => "locked",
            Error::Other(_) => "other",
        };
        ErrorInfo {
            kind: kind.into(),
            message: self.to_string(),
            disk_version: match self {
                Error::Conflict { disk_version } => Some(disk_version.clone()),
                _ => None,
            },
        }
    }
}

impl From<ErrorInfo> for String {
    fn from(e: ErrorInfo) -> String {
        e.message
    }
}
