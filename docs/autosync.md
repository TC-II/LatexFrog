# Auto sync with AI merging

Auto sync keeps a project level with its GitHub remote while you write. Every interval it saves your work as a version, takes in the remote's versions and sends yours. When both sides changed the same lines, the AI keys you listed settle each conflicting block. You hear about it only when they cannot.

## Setting it up

1. Open the project and put it on GitHub: Source Control panel, **Publish** (or clone an existing repository). Press **Sync** once by hand, so git has your sign-in.
2. In the Source Control panel, the **Auto sync** line sits under the branch bar. Click the key icon to open **AI keys for merging**.
3. Add keys, one per row, in the order they should be tried:
   - **Google Gemini**: a key from Google AI Studio. Default model `gemini-flash-latest`. Use `gemini-flash-lite-latest` when the default is overloaded.
   - **xAI Grok**: a key from console.x.ai (starts with `xai-`). Default model `grok-3-mini`.
   - **OpenAI-compatible**: any service with `/chat/completions`. Set the base URL: Groq `https://api.groq.com/openai/v1`, OpenRouter `https://openrouter.ai/api/v1`, a local Ollama `http://localhost:11434/v1` (no key needed).
4. Press **Test** on each row. The state reads *Works*, *Out of quota until …*, *Rejected* or *Failed*. Hover it for the provider's message.
5. Tick **Auto sync** and choose how often (30 s to 5 min, default 1 min). The choice is kept per project.

Keys are encrypted with the operating system's keychain (Electron `safeStorage`) in the app's user data folder, never in the project. Once saved, a key is never shown again; only its last four characters are.

## What happens each round

1. Unwritten edits go to disk, and the files ticked in the Source Control panel are saved as a version named `Auto sync <time>`. Files you unticked stay local.
2. Sync: fetch, take in, send. With no conflict, that is all. No AI is called.
3. On a conflict, the merge is started. For each conflicting block, the AI gets your side, the remote's side and a few lines of context, and returns the merged block.
4. The answer is used only if every block in every file passes these checks:
   - no conflict markers left
   - every `\label`, `\ref`, `\cite`, `\includegraphics` and `\input` from either side kept, unless a side deliberately removed it
   - no keyed command invented
   - environments balanced when both sides agree
   - each side's new words kept (a few may be reworded), and almost nothing added that neither side wrote
   - the model itself sure it kept both meanings
5. If all pass, the merge is saved and sent, and a toast names the files and the provider. The sparkle icon lists the conflicts the AI settled, for review.
6. If anything fails, the merge is undone completely and the project is exactly as before. Auto sync stops and says why. **Resolve by hand** opens the app's own conflict editor, and **Try again** resumes. It also resumes on its own once the branch moves (after you resolve or sync).

## Key rotation

Keys are tried from the top. A key that runs out of quota rests until the provider's reset time (or a minute, or an hour for daily quotas), and the next key takes the request. A rejected key rests for a day or until you edit it. A timeout or an overloaded model (30 s, HTTP 5xx) rests the key for 30 seconds. When every key fails, you are told, with a button to the keys.

## Limits

- The merged result is not compiled before it is accepted. The checks above are structural. Compiling the merge through `lv-sidecar` is planned.
- Figures, PDFs and files one side deleted cannot be merged by text. They always go to you.
- Without a base version (git's default conflict style), a line one side deleted and the other kept reads as kept.

## Testing outside the app

`LV_AI_KEYS_FILE=/path/keys.json` makes the main process read keys from a JSON list (`[{"provider":"gemini","key":"…","model":""}]`) instead of the keychain. Keep that file outside the repository.

# AI explanations for compile errors

The same keys explain compile errors in the **Problems** panel, spent with care.

- **Local first, free.** Texpile's rule table already gives a hint for the common errors. When a rule names a missing package, **Load the … package** adds it to the main file's preamble, with no AI.
- **Automatic, once.** With *Explain unknown errors when a compile fails* ticked (the default), one call is made only when the compile failed and its first error is one no rule recognises. Later errors are mostly its cascade and are not sent.
- **On request.** Every error has **Explain with AI**.
- **Never twice.** Each error gets a fingerprint (message, offending command and source text, without line numbers or paths). An answer is cached across sessions and reused wherever the same error appears again.
- **Budget.** At most 10 calls in any hour. The strip at the top of Problems shows what is left.
- **Small prompt.** Only the error, its log slice and the 21 numbered source lines around it are sent, never the document.
- **Fixes are offered, never applied alone.** When the slip is small and inside the lines shown (a brace, a misspelled command, a column count), the answer carries the corrected lines, shown as a diff. **Apply this fix** writes them only if those lines are still exactly what the AI saw, and refuses a fix that grows the range by more than three lines.

The explanation is written in the language of the document text.

The top of Problems also shows when auto sync stopped, with **Try again** and **Resolve by hand**, so one panel holds what needs attention.
