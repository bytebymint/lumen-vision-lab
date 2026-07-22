# Contributing

## Local setup

Use Windows PowerShell from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

The app listens on `http://127.0.0.1:5000`. Camera access works on localhost. Do not add code that uploads webcam frames or persists biometric media.

## Before opening a pull request

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Get-ChildItem .\static\js\*.js | ForEach-Object { node --check $_.FullName }
```

Keep generated runtime state out of commits: `.venv`, `.cache`, `.temp`, `data/*.db`, logs, and browser package folders are ignored.

## Scope and style

- Keep model, cache, database, and tool paths relative to the repository root.
- Preserve local-only processing. Flask receives metrics for Focus Monitor sessions only; browser video must remain in the browser.
- Do not add credentials, API keys, recordings, screenshots, or personal data.
- Prefer focused tests for changed routes and controls. Run the full suite before merging.
