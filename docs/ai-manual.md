# AI integration: short manual

LatexFrog uses AI in two places. Both use the same keys, and both are optional. Without keys the editor works as before.

1. **Auto sync with AI merging:** saves your work, syncs with GitHub, and calls the AI only when a real conflict appears.
2. **Compile error explanations** in the Problems panel.

The full reference is in [autosync.md](autosync.md).

## 1. Setting up the keys

1. Publish the project to GitHub from **Source Control → Publish**, then press **Sync** once by hand so git has your sign-in.
2. In Source Control, under the branch bar, the **Auto sync** line appears. The key icon opens **AI keys for merging**.
3. Add one key per row, in the order they should be tried:
   - **Google Gemini:** key from Google AI Studio. Default model `gemini-flash-latest`. If it is overloaded, use `gemini-flash-lite-latest`.
   - **xAI Grok:** key from console.x.ai (starts with `xai-`). Default model `grok-3-mini`.
   - **OpenAI-compatible:** Groq, OpenRouter, or a local Ollama. Set the base URL, for example `http://localhost:11434/v1` for Ollama (no key needed).
4. Press **Test** on each row. The state is *Works*, *Out of quota until …*, *Rejected*, or *Failed*.
5. Tick **Auto sync** and choose the interval (30 s to 5 min, default 1 min). The choice is kept per project.

Keys are encrypted with the operating system keychain (Electron `safeStorage`), stored in the app's user data folder, never in the project. Once saved, a key is not shown again; only its last four characters are.

Use each key within its provider's terms, one per person, as the provider gives it.

## 2. What happens on each auto sync round

1. Unsaved edits are written to disk. The files ticked in Source Control are saved as a version named `Auto sync <time>`. Unticked files stay local.
2. Fetch, take in remote changes, push. With no conflict, that is all. No AI is called.
3. On a conflict, each conflicting block is sent to the AI with your side, the remote side, and a few lines of context. The AI returns the merged block.
4. The answer is used only if every block in every file passes these checks:
   - no conflict markers remain;
   - every `\label`, `\ref`, `\cite`, `\includegraphics`, and `\input` from either side is kept, unless a side removed it on purpose;
   - no keyed command is invented;
   - environments are balanced when both sides agree;
   - each side's new text is kept (it may be reworded), and almost nothing is added that neither side wrote;
   - the model confirms it kept both meanings.
5. If everything passes, the merge is saved and pushed, and a notice names the files and the provider. The sparkle icon lists the conflicts the AI settled, for review.
6. If anything fails, the merge is undone completely and the project returns to its previous state. Auto sync stops and explains why. Use **Resolve by hand** to open the conflict editor, or **Try again** to resume. It also resumes by itself once the branch moves.

### Key rotation

Keys are tried from the top of the list. A key that runs out of quota rests until the provider's reset time (or for a minute, or an hour for daily quotas), and the next key handles the request. A rejected key rests for a day, or until you edit it. A timeout or an overloaded model (30 s, HTTP 5xx) rests the key for 30 seconds. If every key fails, you are told and given a button that opens the keys.

## 3. Compile error explanations (Problems panel)

- **Local rules first, no AI:** when a known rule names a missing package, **Load the … package** adds the `\usepackage` to the main file's preamble.
- **Automatic, once:** with *Explain unknown errors when a compile fails* ticked (the default), one call is made only when the compile failed and its first error is not recognized by any rule. Later errors are usually a cascade and are not sent.
- **On request:** every error has **Explain with AI**.
- **Never twice:** each error gets a fingerprint (message, failing command, and source text, without line numbers or paths). Answers are cached across sessions and reused for the same error.
- **Budget:** at most 10 calls per hour. The strip at the top of Problems shows how many remain.
- **Small prompt:** only the error, its log excerpt, and 21 numbered source lines around it. The whole document is never sent.
- **Fixes are offered, never applied alone:** for a small slip inside those lines (a brace, a misspelled command, a column count), the answer includes corrected lines as a diff. **Apply this fix** writes them only if those lines are still exactly what the AI saw. A fix that grows the range by more than three lines is refused.

The explanation is written in the language of the document text.

## 4. Limits

- The merged result is **not compiled** before it is accepted. The checks are structural. Compiling through `lv-sidecar` is planned.
- Figures, PDFs, and files that one side deleted cannot be merged as text. They always go to you.
- Without a base version (git's default conflict style), a line that one side deleted and the other kept reads as kept.
- The auto sync flow was tested with unit tests and with a live Gemini call. It had not yet been run end to end inside the app with a forced conflict.

## 5. Security note

Keys pasted into a chat stay in that chat's history. Revoke them and create new ones, and enter the new keys only in the app.

---

# Integración con IA: manual breve

LatexFrog usa IA en dos lugares. Ambos usan las mismas keys y los dos son opcionales. Sin keys, el editor funciona igual que antes.

1. **Auto sync con merge por IA:** guarda tu trabajo, sincroniza con GitHub y llama a la IA solo cuando hay un conflicto real.
2. **Explicaciones de errores de compilación** en el panel Problems.

La referencia completa está en [autosync.md](autosync.md).

## 1. Configurar las keys

1. Publicá el proyecto en GitHub desde **Source Control → Publish** y hacé **Sync** una vez a mano, para que git tenga tu login.
2. En Source Control, debajo de la barra de rama, aparece la línea **Auto sync**. El ícono de llave abre **AI keys for merging**.
3. Agregá una key por fila, en el orden en que deben probarse:
   - **Google Gemini:** key de Google AI Studio. Modelo por defecto `gemini-flash-latest`. Si está saturado, usá `gemini-flash-lite-latest`.
   - **xAI Grok:** key de console.x.ai (empieza con `xai-`). Modelo por defecto `grok-3-mini`.
   - **Compatible con OpenAI:** Groq, OpenRouter o Ollama local. Hay que poner la URL base, por ejemplo `http://localhost:11434/v1` para Ollama (sin key).
4. Apretá **Test** en cada fila. El estado puede ser *Works*, *Out of quota until …*, *Rejected* o *Failed*.
5. Tildá **Auto sync** y elegí el intervalo (de 30 s a 5 min, por defecto 1 min). La elección se guarda por proyecto.

Las keys se guardan cifradas con el llavero del sistema operativo (Electron `safeStorage`), en la carpeta de datos de la app, nunca en el proyecto. Una vez guardadas no se vuelven a mostrar; solo se ven los últimos cuatro caracteres.

Usá cada key dentro de los términos de su proveedor: una por persona, tal como la entrega cada uno.

## 2. Qué pasa en cada ronda de auto sync

1. Los cambios sin guardar se escriben a disco. Los archivos tildados en Source Control se guardan como una versión llamada `Auto sync <hora>`. Los destildados quedan solo en tu máquina.
2. Fetch, traer cambios remotos y push. Si no hay conflicto, eso es todo. No se llama a ninguna IA.
3. Ante un conflicto, cada bloque en conflicto se envía a la IA con tu lado, el lado remoto y unas líneas de contexto. La IA devuelve el bloque fusionado.
4. La respuesta se usa solo si cada bloque de cada archivo pasa estos controles:
   - no quedan marcadores de conflicto;
   - se conservan todos los `\label`, `\ref`, `\cite`, `\includegraphics` e `\input` de ambos lados, salvo que un lado los haya borrado a propósito;
   - no se inventa ningún comando con clave;
   - los entornos quedan balanceados cuando ambos lados coinciden;
   - se conserva el texto nuevo de cada lado (puede estar reformulado), y casi no se agrega texto que ninguno escribió;
   - el modelo confirma que conservó los dos significados.
5. Si todo pasa, el merge se guarda y se envía, y un aviso indica los archivos y el proveedor. El ícono de destello lista los conflictos que resolvió la IA, para revisarlos.
6. Si algo falla, el merge se deshace por completo y el proyecto vuelve a su estado anterior. Auto sync se detiene y explica por qué. Usá **Resolve by hand** para abrir el editor de conflictos, o **Try again** para reanudar. También se reanuda solo cuando la rama cambia.

### Rotación de keys

Las keys se prueban de arriba hacia abajo. Una key sin cuota descansa hasta que se renueve (o un minuto, o una hora si la cuota es diaria), y la siguiente atiende la solicitud. Una key rechazada descansa un día, o hasta que la edites. Un timeout o un modelo sobrecargado (30 s, HTTP 5xx) hace descansar la key 30 segundos. Si fallan todas, se avisa y hay un botón que lleva a las keys.

## 3. Explicaciones de errores de compilación (panel Problems)

- **Primero reglas locales, sin IA:** cuando una regla conocida indica un paquete faltante, **Load the … package** agrega el `\usepackage` al preámbulo del archivo principal.
- **Automático, una sola vez:** con *Explain unknown errors when a compile fails* tildado (por defecto), se hace una llamada solo cuando la compilación falló y su primer error no lo reconoce ninguna regla. Los errores siguientes suelen ser cascada y no se envían.
- **Bajo pedido:** cada error tiene **Explain with AI**.
- **Nunca dos veces:** cada error tiene una huella (mensaje, comando que falla y texto de la fuente, sin números de línea ni rutas). Las respuestas se guardan entre sesiones y se reutilizan para el mismo error.
- **Presupuesto:** como máximo 10 llamadas por hora. La franja superior de Problems muestra cuántas quedan.
- **Prompt chico:** solo el error, su fragmento del log y 21 líneas numeradas alrededor. Nunca se manda el documento entero.
- **Los arreglos se ofrecen, nunca se aplican solos:** ante un desliz chico dentro de esas líneas (una llave, un comando mal escrito, una columna de más), la respuesta trae las líneas corregidas como diff. **Apply this fix** las escribe solo si siguen siendo exactamente lo que vio la IA. Un arreglo que agrande el rango en más de tres líneas se rechaza.

La explicación se escribe en el idioma del texto del documento.

## 4. Límites

- El resultado del merge **no se compila** antes de aceptarlo. Los controles son estructurales. Compilar a través de `lv-sidecar` está planeado.
- Figuras, PDFs y archivos que un lado borró no se pueden fusionar como texto. Siempre van a vos.
- Sin una versión base (el estilo de conflicto por defecto de git), una línea que un lado borró y el otro conservó se lee como conservada.
- El flujo de auto sync se probó con tests unitarios y con una llamada en vivo a Gemini. Todavía no se corrió de punta a punta dentro de la app con un conflicto forzado.

## 5. Nota de seguridad

Las keys pegadas en un chat quedan en el historial de ese chat. Revocalas, creá nuevas y cargalas solo en la app.
